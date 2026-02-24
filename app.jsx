import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Search,
  MapPin,
  Calendar,
  Video,
  Star,
  Image as ImageIcon,
} from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { daysMap, venuesList, rawScheduleData } from "./scheduleDb";
import {
  fetchPosterUrl,
  getCachedPosterUrl,
  fetchMovieOverview,
  getCachedMovieOverview,
} from "./tmdbApi";

const MoviePoster = ({ title, details, isTBC }) => {
  const [posterUrl, setPosterUrl] = useState(
    getCachedPosterUrl(title, details) || null,
  );
  const [loading, setLoading] = useState(
    !getCachedPosterUrl(title, details) && !isTBC,
  );
  const [isInView, setIsInView] = useState(false);
  const containerRef = useRef(null);

  // Use an IntersectionObserver to implement lazy-loading
  useEffect(() => {
    if (isTBC || getCachedPosterUrl(title, details)) {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "150px" },
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [title, details, isTBC]);

  useEffect(() => {
    // Wait until the item is visible on screen before making network requests
    const cachedPoster = getCachedPosterUrl(title, details);
    if (!isInView || isTBC || cachedPoster) {
      if (cachedPoster) {
        setPosterUrl(cachedPoster);
        setLoading(false);
      }
      return;
    }

    let isMounted = true;

    const fetchPoster = async () => {
      try {
        const url = await fetchPosterUrl({ title, details });
        if (!isMounted) return;
        setPosterUrl(url);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    // Stagger remaining requests mildly to avoid hammering the API
    const timer = setTimeout(fetchPoster, 200 + Math.random() * 600);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [title, details, isTBC, isInView]);

  if (isTBC) return null;

  return (
    <div
      ref={containerRef}
      className="w-16 h-24 shrink-0 bg-gray-100 rounded-md overflow-hidden flex items-center justify-center border border-gray-200 shadow-sm"
    >
      {loading ? (
        <div className="animate-pulse bg-gray-200 w-full h-full" />
      ) : posterUrl && posterUrl !== "not_found" ? (
        <img
          src={posterUrl}
          alt={`${title} poster`}
          className="w-full h-full object-cover"
        />
      ) : (
        <ImageIcon className="w-6 h-6 text-gray-300" />
      )}
    </div>
  );
};

const MovieOverview = ({ title, details, isTBC, showFullDescription }) => {
  const [overview, setOverview] = useState(
    getCachedMovieOverview(title, details) || null,
  );
  const [loading, setLoading] = useState(
    !getCachedMovieOverview(title, details) && !isTBC,
  );

  useEffect(() => {
    if (isTBC) return;

    const cachedOverview = getCachedMovieOverview(title, details);
    if (cachedOverview) {
      setOverview(cachedOverview);
      setLoading(false);
      return;
    }

    let isMounted = true;
    const timer = setTimeout(
      async () => {
        try {
          const value = await fetchMovieOverview({ title, details });
          if (!isMounted) return;
          setOverview(value);
        } finally {
          if (isMounted) setLoading(false);
        }
      },
      250 + Math.random() * 550,
    );

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [title, details, isTBC]);

  if (isTBC || loading || !overview || overview === "not_found") return null;

  return (
    <div className="relative">
      <p
        className="text-xs text-gray-500 leading-snug"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {overview}
      </p>
      <div
        className={`pointer-events-none absolute left-0 right-0 z-20 mt-1 rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-700 shadow-lg transition-opacity duration-150 ${
          showFullDescription ? "opacity-100" : "opacity-0"
        }`}
      >
        {overview}
      </div>
    </div>
  );
};

// Helper to sort by time properly
const parseTime = (timeStr) => {
  if (!timeStr) return 0;
  const [time, period] = timeStr.split(" ");
  if (!time || !period) return 0;
  let [hours, minutes] = time.split(":").map(Number);
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

const parseDurationMinutes = (details) => {
  const match = details?.match(/(\d+)\s*min/i);
  if (!match) return 120;
  const minutes = Number(match[1]);
  return Number.isFinite(minutes) ? minutes : 120;
};

const formatTimeLower = (totalMinutes) => {
  const minutesInDay = 24 * 60;
  const normalized =
    ((totalMinutes % minutesInDay) + minutesInDay) % minutesInDay;
  let hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const period = hours >= 12 ? "pm" : "am";
  hours = hours % 12 || 12;
  return `${hours}:${String(minutes).padStart(2, "0")}${period}`;
};

const isTbcTitle = (title) =>
  title === "TBC" || title.includes("To Be Announced");

const isOverlapping = (a, b) =>
  a.dayId === b.dayId &&
  a.startMinutes < b.endMinutes &&
  b.startMinutes < a.endMinutes;

const ordinalSuffix = (day) => {
  if (day >= 11 && day <= 13) return "th";
  const lastDigit = day % 10;
  if (lastDigit === 1) return "st";
  if (lastDigit === 2) return "nd";
  if (lastDigit === 3) return "rd";
  return "th";
};

const formatTimelineDayLabel = (dayLabel) => {
  const [weekday, dateText] = dayLabel.split(",").map((part) => part.trim());
  if (!weekday || !dateText) return dayLabel;

  const [dayNumberText, ...monthParts] = dateText.split(" ");
  const dayNumber = Number(dayNumberText);
  const month = monthParts.join(" ");

  if (!Number.isFinite(dayNumber) || !month) return dayLabel;

  return `${dayNumber}${ordinalSuffix(dayNumber)} ${month}, ${weekday}`;
};

export default function App() {
  const [selectedDay, setSelectedDay] = useState("All");
  const [selectedVenue, setSelectedVenue] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMovieIds, setSelectedMovieIds] = useState([]);
  const [hoveredDescriptionCardId, setHoveredDescriptionCardId] =
    useState(null);
  const hoverDelayTimerRef = useRef(null);
  const timelineRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);

  const allScheduleItems = useMemo(
    () =>
      rawScheduleData.map((item, id) => {
        const [dayId, venue, screen, time, title, details] = item;
        const startMinutes = parseTime(time);
        const durationMinutes = parseDurationMinutes(details);
        return {
          id,
          dayId,
          venue,
          screen,
          time,
          title,
          details,
          startMinutes,
          endMinutes: startMinutes + durationMinutes,
          isTBC: isTbcTitle(title),
        };
      }),
    [],
  );

  const selectedIdSet = useMemo(
    () => new Set(selectedMovieIds),
    [selectedMovieIds],
  );

  const conflictingMovieIds = useMemo(() => {
    const conflicts = new Set();
    if (selectedMovieIds.length === 0) return conflicts;

    const selectedItems = allScheduleItems.filter((item) =>
      selectedIdSet.has(item.id),
    );

    allScheduleItems.forEach((item) => {
      if (selectedIdSet.has(item.id) || item.isTBC) return;
      if (selectedItems.some((selected) => isOverlapping(item, selected))) {
        conflicts.add(item.id);
      }
    });

    return conflicts;
  }, [allScheduleItems, selectedIdSet, selectedMovieIds.length]);

  const selectedScheduleItems = useMemo(
    () =>
      allScheduleItems
        .filter((item) => selectedIdSet.has(item.id))
        .sort((a, b) => a.dayId - b.dayId || a.startMinutes - b.startMinutes),
    [allScheduleItems, selectedIdSet],
  );

  const selectedScheduleByDay = useMemo(() => {
    const groups = { 1: [], 2: [], 3: [] };
    selectedScheduleItems.forEach((item) => {
      groups[item.dayId].push(item);
    });
    return groups;
  }, [selectedScheduleItems]);

  const handleToggleSelection = (item) => {
    if (item.isTBC) return;

    setSelectedMovieIds((prev) => {
      const isSelected = prev.includes(item.id);
      if (isSelected) {
        return prev.filter((id) => id !== item.id);
      }
      if (conflictingMovieIds.has(item.id)) {
        return prev;
      }
      return [...prev, item.id];
    });
  };

  const handleCardMouseEnter = (cardId) => {
    if (hoverDelayTimerRef.current) {
      clearTimeout(hoverDelayTimerRef.current);
    }
    hoverDelayTimerRef.current = setTimeout(() => {
      setHoveredDescriptionCardId(cardId);
    }, 1000);
  };

  const handleCardMouseLeave = (cardId) => {
    if (hoverDelayTimerRef.current) {
      clearTimeout(hoverDelayTimerRef.current);
      hoverDelayTimerRef.current = null;
    }
    setHoveredDescriptionCardId((prev) => (prev === cardId ? null : prev));
  };

  const captureTimelineCanvas = async () => {
    if (!timelineRef.current) return null;

    setIsExporting(true);
    try {
      return await html2canvas(timelineRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        onclone: (clonedDocument) => {
          const scrollContainer = clonedDocument.querySelector(
            "[data-timeline-scroll]",
          );
          if (scrollContainer) {
            scrollContainer.style.maxHeight = "none";
            scrollContainer.style.overflow = "visible";
          }
        },
      });
    } catch (error) {
      console.error("Failed to capture timeline:", error);
      return null;
    } finally {
      setIsExporting(false);
    }
  };

  const downloadTimelineImage = async () => {
    const canvas = await captureTimelineCanvas();
    if (!canvas) return;

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "rlff-timeline.png";
    link.click();
  };

  const downloadTimelinePdf = async () => {
    const canvas = await captureTimelineCanvas();
    if (!canvas) return;

    const pdf = new jsPDF({
      orientation: canvas.width > canvas.height ? "landscape" : "portrait",
      unit: "px",
      format: [canvas.width, canvas.height],
    });

    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      0,
      0,
      canvas.width,
      canvas.height,
    );
    pdf.save("rlff-timeline.pdf");
  };

  useEffect(
    () => () => {
      if (hoverDelayTimerRef.current) {
        clearTimeout(hoverDelayTimerRef.current);
      }
    },
    [],
  );

  const filteredAndSortedData = useMemo(() => {
    let filtered = allScheduleItems.filter((item) => {
      const { dayId, venue, title, details } = item;

      const matchesDay =
        selectedDay === "All" || parseInt(selectedDay) === dayId;
      const matchesVenue = selectedVenue === "All" || venue === selectedVenue;

      const searchLower = searchQuery.toLowerCase();
      const matchesSearch =
        title.toLowerCase().includes(searchLower) ||
        details.toLowerCase().includes(searchLower);

      return matchesDay && matchesVenue && matchesSearch;
    });

    filtered.sort((a, b) => a.startMinutes - b.startMinutes);
    return filtered;
  }, [allScheduleItems, selectedDay, selectedVenue, searchQuery]);

  const groupedByDay = useMemo(() => {
    const groups = { 1: [], 2: [], 3: [] };
    filteredAndSortedData.forEach((item) => {
      groups[item.dayId].push(item);
    });
    return groups;
  }, [filteredAndSortedData]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans pb-12">
      {/* Header */}
      <header className="bg-red-700 text-white shadow-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-2 sm:px-3 py-4 sm:py-6">
          <div className="flex items-center gap-3 mb-4">
            <Video className="w-8 h-8" />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              RLFF Schedule
            </h1>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <input
                type="text"
                placeholder="Search films, genres, languages..."
                className="w-full pl-10 pr-4 py-2.5 rounded-lg text-gray-900 border-none focus:ring-2 focus:ring-red-400 focus:outline-none"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Venue Filter */}
            <div className="relative sm:w-64">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <select
                className="w-full pl-10 pr-4 py-2.5 rounded-lg text-gray-900 appearance-none bg-white focus:ring-2 focus:ring-red-400 focus:outline-none"
                value={selectedVenue}
                onChange={(e) => setSelectedVenue(e.target.value)}
              >
                <option value="All">All Venues</option>
                {venuesList.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-2 sm:px-3 mt-6 sm:mt-8">
        <div
          className={`grid gap-6 ${selectedScheduleItems.length > 0 ? "lg:grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1"}`}
        >
          <section className="min-w-0">
            {/* Day Toggles */}
            <div className="flex flex-wrap gap-2 mb-8">
              <button
                onClick={() => setSelectedDay("All")}
                className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors ${selectedDay === "All" ? "bg-red-600 text-white shadow" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
              >
                All Days
              </button>
              {[1, 2, 3].map((day) => (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`px-5 py-2 rounded-full text-sm font-semibold transition-colors flex items-center gap-2 ${selectedDay === day ? "bg-red-600 text-white shadow" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                >
                  <Calendar className="w-4 h-4" />
                  {daysMap[day].split(",")[0]}
                </button>
              ))}
            </div>
            <div className="mb-6 p-3 rounded-xl border border-gray-200 bg-white flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-700">
                Selected films:{" "}
                <span className="font-semibold">
                  {selectedScheduleItems.length}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedMovieIds([])}
                  disabled={selectedScheduleItems.length === 0}
                  className="px-3 py-1.5 rounded-md text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Results */}
            {filteredAndSortedData.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-gray-200">
                <Video className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-600">
                  No screenings found
                </h2>
                <p className="text-gray-500 mt-2">
                  Try adjusting your search or filters.
                </p>
              </div>
            ) : (
              <div className="space-y-10">
                {[1, 2, 3].map((day) => {
                  if (groupedByDay[day].length === 0) return null;

                  return (
                    <div key={day} className="space-y-4">
                      {selectedDay === "All" && (
                        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2 border-b-2 border-red-200 pb-2">
                          <Calendar className="text-red-600" /> {daysMap[day]}
                        </h2>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {groupedByDay[day].map((item) => {
                          const {
                            id,
                            venue,
                            screen,
                            time,
                            title,
                            details,
                            isTBC,
                          } = item;
                          const hasMeet = details
                            .toLowerCase()
                            .includes("meet");
                          const isSelected = selectedIdSet.has(id);
                          const isConflicting = conflictingMovieIds.has(id);
                          const isDarkened = !isSelected && isConflicting;

                          return (
                            <div
                              key={id}
                              role="button"
                              tabIndex={isTBC ? -1 : 0}
                              onClick={() => handleToggleSelection(item)}
                              onKeyDown={(event) => {
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  handleToggleSelection(item);
                                }
                              }}
                              onMouseEnter={() => handleCardMouseEnter(id)}
                              onMouseLeave={() => handleCardMouseLeave(id)}
                              className={`p-4 rounded-xl border transition-all flex flex-col h-full ${
                                isSelected
                                  ? "bg-red-50 border-red-400 ring-2 ring-red-300 shadow-md cursor-pointer"
                                  : isTBC
                                    ? "bg-gray-50 border-gray-200 cursor-default"
                                    : "bg-white border-gray-200 shadow-sm hover:shadow-md cursor-pointer"
                              } ${isDarkened ? "opacity-35 grayscale" : ""}`}
                            >
                              <div className="flex gap-4 mb-3">
                                <MoviePoster
                                  title={title}
                                  details={details}
                                  isTBC={isTBC}
                                />

                                <div className="flex-1 min-w-0">
                                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-2 gap-2">
                                    <h3
                                      className={`font-bold text-lg leading-tight break-words ${isTBC ? "text-gray-500 italic" : "text-gray-900"}`}
                                    >
                                      {title}
                                    </h3>
                                  </div>
                                  {isSelected && (
                                    <span className="inline-flex items-center mb-2 text-[11px] font-bold text-red-700 bg-red-100 border border-red-200 rounded px-2 py-0.5">
                                      Selected
                                    </span>
                                  )}

                                  <div className="flex-1">
                                    {details && (
                                      <p className="text-sm text-gray-600 mb-2 leading-snug">
                                        {hasMeet ? (
                                          <span className="flex items-start gap-1">
                                            <Star
                                              className="w-4 h-4 text-amber-500 shrink-0 mt-0.5"
                                              fill="currentColor"
                                            />
                                            <span className="font-medium text-gray-800">
                                              {details}
                                            </span>
                                          </span>
                                        ) : (
                                          details
                                        )}
                                      </p>
                                    )}
                                    <MovieOverview
                                      title={title}
                                      details={details}
                                      isTBC={isTBC}
                                      showFullDescription={
                                        hoveredDescriptionCardId === id
                                      }
                                    />
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center text-xs font-medium text-gray-500 mt-auto pt-3 border-t border-gray-100 gap-1.5">
                                <MapPin className="w-3.5 h-3.5 text-gray-400" />
                                <span className="truncate">{venue}</span>
                                <span className="text-gray-300">•</span>
                                <span>Screen {screen}</span>
                                <span className="text-gray-300">•</span>
                                <span>{time}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {selectedScheduleItems.length > 0 && (
            <aside
              ref={timelineRef}
              className="lg:sticky lg:top-24 self-start h-fit rounded-xl border border-gray-200 bg-white shadow-sm p-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">
                  Your Timeline
                </h2>
                <div
                  className="flex items-center gap-2"
                  data-html2canvas-ignore="true"
                >
                  <button
                    type="button"
                    onClick={downloadTimelineImage}
                    disabled={isExporting}
                    className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    PNG
                  </button>
                  <button
                    type="button"
                    onClick={downloadTimelinePdf}
                    disabled={isExporting}
                    className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    PDF
                  </button>
                </div>
              </div>

              <div
                data-timeline-scroll
                className="space-y-6 max-h-[75vh] overflow-auto"
              >
                {[1, 2, 3].map((day) => {
                  const dayItems = selectedScheduleByDay[day];
                  if (!dayItems || dayItems.length === 0) return null;

                  return (
                    <div key={day}>
                      <h3 className="text-sm font-bold text-gray-800 mb-3">
                        {formatTimelineDayLabel(daysMap[day])}
                      </h3>
                      <div className="space-y-3">
                        {dayItems.map((item) => (
                          <div key={item.id} className="flex gap-3">
                            <div className="flex flex-col items-center">
                              <span className="w-2.5 h-2.5 rounded-full bg-red-500 mt-1" />
                              <span className="w-px flex-1 bg-red-200 mt-1" />
                            </div>
                            <div className="min-w-0 pb-2">
                              <p className="text-xs font-semibold text-red-700">
                                {`${formatTimeLower(item.startMinutes)} - ${formatTimeLower(item.endMinutes)}`}
                              </p>
                              <p className="text-sm font-semibold text-gray-900 leading-tight">
                                {item.title}
                              </p>
                              <p className="text-xs text-gray-600 mt-0.5">
                                {item.venue} • Screen {item.screen}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
