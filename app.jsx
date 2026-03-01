import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Image as ImageIcon,
  MapPin,
  Play,
  Save,
  Search,
  Star,
  Upload,
  Video,
} from "lucide-react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { daysMap, rawScheduleData, venuesList } from "./scheduleDb";
import {
  fetchLetterboxdUrl,
  fetchOriginalTitle,
  fetchMovieOverview,
  fetchPosterUrl,
  fetchTrailerUrl,
  getCachedLetterboxdUrl,
  getCachedMovieOverview,
  getCachedOriginalTitle,
  getCachedPosterUrl,
  getCachedTrailerUrl,
} from "./tmdbApi";

const DAYS = [1, 2, 3];
const OVERVIEW_CLAMP_STYLE = {
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};
const DAY_BTN =
  "px-5 py-2 rounded-full text-sm font-semibold transition-colors";
const CARD_BASE = "p-4 rounded-xl border transition-all flex flex-col h-full";
const TMDB_FETCH_DELAY_BASE_MS = 40;
const TMDB_FETCH_DELAY_JITTER_MS = 120;
const MIN_PRIORITY = 1;
const MAX_PRIORITY = 3;
const PRIORITY_LABELS = {
  1: "Priority 1",
  2: "Priority 2",
  3: "Priority 3",
};
const PRIORITY_CARD_CLASSES = {
  1: "bg-amber-50 border-amber-400 ring-2 ring-amber-200 shadow-md cursor-pointer",
  2: "bg-orange-50 border-orange-400 ring-2 ring-orange-200 shadow-md cursor-pointer",
  3: "bg-red-50 border-red-500 ring-2 ring-red-300 shadow-md cursor-pointer",
};
const PRIORITY_BADGE_CLASSES = {
  1: "text-amber-800 bg-amber-100 border-amber-200",
  2: "text-orange-800 bg-orange-100 border-orange-200",
  3: "text-red-700 bg-red-100 border-red-200",
};
const makeDayGroups = () => ({ 1: [], 2: [], 3: [] });
const groupByDay = (items) =>
  items.reduce(
    (groups, item) => ((groups[item.dayId] ??= []).push(item), groups),
    makeDayGroups(),
  );
const getTmdbFetchDelay = () =>
  TMDB_FETCH_DELAY_BASE_MS + Math.random() * TMDB_FETCH_DELAY_JITTER_MS;
const parseDurationMinutes = (details) => {
  const minutes = Number(details?.match(/(\d+)\s*min/i)?.[1]);
  return Number.isFinite(minutes) ? minutes : 120;
};
const isTbcTitle = (title) =>
  title === "TBC" || title.includes("To Be Announced");
const isOverlapping = (a, b) =>
  a.dayId === b.dayId &&
  a.startMinutes < b.endMinutes &&
  b.startMinutes < a.endMinutes;
const ordinalSuffix = (day) =>
  day >= 11 && day <= 13
    ? "th"
    : day % 10 === 1
      ? "st"
      : day % 10 === 2
        ? "nd"
        : day % 10 === 3
          ? "rd"
          : "th";
const cardClass = (
  isSelected,
  isTBC,
  isDarkened,
  priority = 0,
  isWatchlistMode = false,
) => {
  const selectedClass =
    isWatchlistMode && PRIORITY_CARD_CLASSES[priority]
      ? PRIORITY_CARD_CLASSES[priority]
      : "bg-red-50 border-red-400 ring-2 ring-red-300 shadow-md cursor-pointer";
  return `${CARD_BASE} ${isSelected ? selectedClass : isTBC ? "bg-gray-50 border-gray-200 cursor-default" : "bg-white border-gray-200 shadow-sm hover:shadow-md cursor-pointer"} ${isDarkened ? "opacity-35 grayscale" : ""}`;
};

const parseTime = (timeStr) => {
  if (!timeStr) return 0;
  const [time, period] = timeStr.split(" ");
  if (!time || !period) return 0;
  let [hours, minutes] = time.split(":").map(Number);
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
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

const formatTimelineDayLabel = (dayLabel) => {
  const [weekday, dateText] = dayLabel.split(",").map((part) => part.trim());
  if (!weekday || !dateText) return dayLabel;
  const [dayNumberText, ...monthParts] = dateText.split(" ");
  const dayNumber = Number(dayNumberText);
  const month = monthParts.join(" ");
  return Number.isFinite(dayNumber) && month
    ? `${dayNumber}${ordinalSuffix(dayNumber)} ${month}, ${weekday}`
    : dayLabel;
};
const dayLabelShort = (dayId) =>
  daysMap[dayId]?.split(",")[0] || `Day ${dayId}`;
const getNextPriority = (currentPriority = 0) =>
  currentPriority >= MAX_PRIORITY ? 0 : currentPriority + 1;
const normalizePriority = (value) => {
  const priority = Number(value);
  return Number.isInteger(priority) &&
    priority >= MIN_PRIORITY &&
    priority <= MAX_PRIORITY
    ? priority
    : 0;
};

const areIdListsEqual = (a = [], b = []) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

const MoviePoster = ({ title, details, isTBC }) => {
  const [posterUrl, setPosterUrl] = useState(
    () => getCachedPosterUrl(title, details) || null,
  );
  const [trailerUrl, setTrailerUrl] = useState(
    () => getCachedTrailerUrl(title, details) || null,
  );
  const [loading, setLoading] = useState(
    () =>
      (!getCachedPosterUrl(title, details) ||
        !getCachedTrailerUrl(title, details)) &&
      !isTBC,
  );
  const [isInView, setIsInView] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (
      isTBC ||
      (getCachedPosterUrl(title, details) &&
        getCachedTrailerUrl(title, details))
    )
      return void setIsInView(true);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setIsInView(true);
        observer.disconnect();
      },
      { rootMargin: "150px" },
    );
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [title, details, isTBC]);

  useEffect(() => {
    const cachedPoster = getCachedPosterUrl(title, details);
    const cachedTrailer = getCachedTrailerUrl(title, details);
    if (!isInView || isTBC || (cachedPoster && cachedTrailer)) {
      if (cachedPoster) {
        setPosterUrl(cachedPoster);
      }
      if (cachedTrailer) setTrailerUrl(cachedTrailer);
      if (cachedPoster && cachedTrailer) setLoading(false);
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      try {
        const [poster, trailer] = await Promise.all([
          fetchPosterUrl({ title, details }),
          fetchTrailerUrl({ title, details }),
        ]);
        if (isMounted) {
          setPosterUrl(poster);
          setTrailerUrl(trailer);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }, getTmdbFetchDelay());

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [title, details, isTBC, isInView]);

  if (isTBC) return null;
  return (
    <div
      ref={containerRef}
      className="relative w-16 h-24 shrink-0 bg-gray-100 rounded-md overflow-hidden flex items-center justify-center border border-gray-200 shadow-sm"
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
      {trailerUrl && trailerUrl !== "not_found" && (
        <button
          type="button"
          aria-label={`Play trailer for ${title}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            window.open(trailerUrl, "_blank", "noopener,noreferrer");
          }}
          className="absolute bottom-1 right-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-black/75 text-white hover:bg-black/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <Play className="h-3.5 w-3.5 fill-current" />
        </button>
      )}
    </div>
  );
};

const MovieOverview = ({ title, details, isTBC, showFullDescription }) => {
  const [overview, setOverview] = useState(
    () => getCachedMovieOverview(title, details) || null,
  );
  const [loading, setLoading] = useState(
    () => !getCachedMovieOverview(title, details) && !isTBC,
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
    const timer = setTimeout(async () => {
      try {
        const value = await fetchMovieOverview({ title, details });
        if (isMounted) setOverview(value);
      } finally {
        if (isMounted) setLoading(false);
      }
    }, getTmdbFetchDelay());

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
        style={OVERVIEW_CLAMP_STYLE}
      >
        {overview}
      </p>
      <div
        className={`pointer-events-none absolute left-0 right-0 z-20 mt-1 rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-700 shadow-lg transition-opacity duration-150 ${showFullDescription ? "opacity-100" : "opacity-0"}`}
      >
        {overview}
      </div>
    </div>
  );
};

const TimelineDay = ({ day, items }) => (
  <div>
    <h3 className="text-sm font-bold text-gray-800 mb-3">
      {formatTimelineDayLabel(daysMap[day])}
    </h3>
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 mt-1" />
            <span className="w-px flex-1 bg-red-200 mt-1" />
          </div>
          <div className="min-w-0 pb-2">
            <p className="text-xs font-semibold text-red-700">{`${formatTimeLower(item.startMinutes)} - ${formatTimeLower(item.endMinutes)}`}</p>
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

const WatchlistTimeline = ({ films }) => (
  <div className="space-y-4">
    {films.map((film) => (
      <div key={film.title} className="flex gap-3">
        <div className="flex flex-col items-center">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 mt-1" />
          <span className="w-px flex-1 bg-red-200 mt-1" />
        </div>
        <div className="min-w-0 pb-2">
          <p className="text-sm font-semibold text-gray-900 leading-tight">
            {film.title}
          </p>
          <div className="mt-1.5 space-y-1">
            {film.screenings.map((screening) => (
              <p key={screening.id} className="text-xs text-gray-600">
                {`${dayLabelShort(screening.dayId)} • ${formatTimeLower(screening.startMinutes)} • ${screening.venue} • Screen ${screening.screen}`}
              </p>
            ))}
          </div>
        </div>
      </div>
    ))}
  </div>
);

const ScreeningCard = ({
  item,
  isSelected,
  selectionPriority,
  isWatchlistMode,
  isConflicting,
  onToggleSelection,
  onMouseEnter,
  onMouseLeave,
  showFullDescription,
}) => {
  const { id, venue, screen, time, title, details, isTBC } = item;
  const isDarkened = !isSelected && isConflicting;
  const hasMeet = details.toLowerCase().includes("meet");
  const [letterboxdUrl, setLetterboxdUrl] = useState(
    () => getCachedLetterboxdUrl(title, details) || null,
  );
  const [originalTitle, setOriginalTitle] = useState(
    () => getCachedOriginalTitle(title, details) || null,
  );

  useEffect(() => {
    if (isTBC) return;
    const cached = getCachedLetterboxdUrl(title, details);
    if (cached) {
      setLetterboxdUrl(cached);
      return;
    }
    let isMounted = true;
    const timer = setTimeout(async () => {
      const value = await fetchLetterboxdUrl({ title, details });
      if (isMounted) setLetterboxdUrl(value);
    }, getTmdbFetchDelay());
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [title, details, isTBC]);

  useEffect(() => {
    if (isTBC) return;
    const cached = getCachedOriginalTitle(title, details);
    if (cached) {
      setOriginalTitle(cached);
      return;
    }
    let isMounted = true;
    const timer = setTimeout(async () => {
      const value = await fetchOriginalTitle({ title, details });
      if (isMounted) setOriginalTitle(value);
    }, getTmdbFetchDelay());
    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [title, details, isTBC]);

  const hasLetterboxd = letterboxdUrl && letterboxdUrl !== "not_found";
  const hasOriginalTitle =
    originalTitle &&
    originalTitle !== "not_found" &&
    originalTitle.trim().toLowerCase() !== title.trim().toLowerCase();
  return (
    <div
      role="button"
      tabIndex={isTBC ? -1 : 0}
      onClick={() => onToggleSelection(item)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onToggleSelection(item);
      }}
      onMouseEnter={() => onMouseEnter(id)}
      onMouseLeave={() => onMouseLeave(id)}
      className={cardClass(
        isSelected,
        isTBC,
        isDarkened,
        selectionPriority,
        isWatchlistMode,
      )}
    >
      <div className="flex gap-4 mb-3">
        <MoviePoster title={title} details={details} isTBC={isTBC} />
        <div className="flex-1 min-w-0">
          <h3
            className={`font-bold text-lg leading-tight break-words mb-2 ${isTBC ? "text-gray-500 italic" : "text-gray-900"}`}
          >
            {hasLetterboxd ? (
              <a
                href={letterboxdUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="underline decoration-red-300 underline-offset-2 hover:text-red-700 hover:decoration-red-500"
              >
                {title}
              </a>
            ) : (
              title
            )}
          </h3>
          {hasOriginalTitle && (
            <p className="text-xs text-gray-500 italic -mt-1 mb-2 break-words">
              {originalTitle}
            </p>
          )}
          {isSelected && (
            <span
              className={`inline-flex items-center mb-2 text-[11px] font-bold border rounded px-2 py-0.5 ${
                isWatchlistMode && PRIORITY_BADGE_CLASSES[selectionPriority]
                  ? PRIORITY_BADGE_CLASSES[selectionPriority]
                  : "text-red-700 bg-red-100 border-red-200"
              }`}
            >
              {isWatchlistMode
                ? PRIORITY_LABELS[selectionPriority] || "Priority"
                : "Selected"}
            </span>
          )}
          {details && (
            <p className="text-sm text-gray-600 mb-2 leading-snug">
              {hasMeet ? (
                <span className="flex items-start gap-1">
                  <Star
                    className="w-4 h-4 text-amber-500 shrink-0 mt-0.5"
                    fill="currentColor"
                  />
                  <span className="font-medium text-gray-800">{details}</span>
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
            showFullDescription={showFullDescription}
          />
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
};

export default function App() {
  const PLAN_COUNT = 3;
  const [selectedDay, setSelectedDay] = useState("All");
  const [selectedVenue, setSelectedVenue] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMovieIds, setSelectedMovieIds] = useState([]);
  const [selectedMoviePriorities, setSelectedMoviePriorities] = useState({});
  const [planVariants, setPlanVariants] = useState(() =>
    Array.from({ length: PLAN_COUNT }, () => null),
  );
  const [activePlanIndex, setActivePlanIndex] = useState(null);
  const [isWatchlistMode, setIsWatchlistMode] = useState(false);
  const [watchlistPlans, setWatchlistPlans] = useState([]);
  const [isWatchlistPlanning, setIsWatchlistPlanning] = useState(false);
  const [hoveredDescriptionCardId, setHoveredDescriptionCardId] =
    useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [selectionImportMessage, setSelectionImportMessage] = useState("");
  const hoverDelayTimerRef = useRef(null);
  const timelineRef = useRef(null);
  const selectionImportInputRef = useRef(null);
  const watchlistPlanRequestIdRef = useRef(0);

  const allScheduleItems = useMemo(
    () =>
      rawScheduleData.map(
        ([dayId, venue, screen, time, title, details], id) => {
          const startMinutes = parseTime(time);
          return {
            id,
            dayId,
            venue,
            screen,
            time,
            title,
            details,
            startMinutes,
            endMinutes: startMinutes + parseDurationMinutes(details),
            isTBC: isTbcTitle(title),
          };
        },
      ),
    [],
  );
  const selectedIdSet = useMemo(
    () => new Set(selectedMovieIds),
    [selectedMovieIds],
  );
  const allScheduleIdSet = useMemo(
    () => new Set(allScheduleItems.map((item) => item.id)),
    [allScheduleItems],
  );
  const allSelectableTitleSet = useMemo(
    () =>
      new Set(
        allScheduleItems
          .filter((item) => !item.isTBC)
          .map((item) => item.title),
      ),
    [allScheduleItems],
  );
  const selectedMovieTitles = useMemo(
    () =>
      Object.keys(selectedMoviePriorities).filter(
        (title) => normalizePriority(selectedMoviePriorities[title]) > 0,
      ),
    [selectedMoviePriorities],
  );
  const selectedTitleSet = useMemo(
    () => new Set(selectedMovieTitles),
    [selectedMovieTitles],
  );
  const selectedScheduleItems = useMemo(
    () =>
      allScheduleItems
        .filter((item) => selectedIdSet.has(item.id))
        .sort((a, b) => a.dayId - b.dayId || a.startMinutes - b.startMinutes),
    [allScheduleItems, selectedIdSet],
  );
  const selectedWatchlistFilms = useMemo(() => {
    if (!selectedTitleSet.size) return [];
    const byTitle = new Map();
    for (const item of allScheduleItems) {
      if (!selectedTitleSet.has(item.title) || item.isTBC) continue;
      const priority = normalizePriority(selectedMoviePriorities[item.title]);
      if (!priority) continue;
      const current = byTitle.get(item.title);
      if (current) {
        current.screenings.push(item);
      } else {
        byTitle.set(item.title, {
          title: item.title,
          priority,
          screenings: [item],
        });
      }
    }
    return Array.from(byTitle.values())
      .map((film) => ({
        ...film,
        screenings: [...film.screenings].sort(
          (a, b) => a.dayId - b.dayId || a.startMinutes - b.startMinutes,
        ),
      }))
      .sort((a, b) => {
        const aFirst = a.screenings[0];
        const bFirst = b.screenings[0];
        return (
          aFirst.dayId - bFirst.dayId ||
          aFirst.startMinutes - bFirst.startMinutes ||
          a.title.localeCompare(b.title)
        );
      });
  }, [allScheduleItems, selectedMoviePriorities, selectedTitleSet]);
  useEffect(() => {
    watchlistPlanRequestIdRef.current += 1;
    const requestId = watchlistPlanRequestIdRef.current;

    if (!selectedWatchlistFilms.length) {
      setWatchlistPlans([]);
      setIsWatchlistPlanning(false);
      return undefined;
    }

    setWatchlistPlans([]);
    setIsWatchlistPlanning(true);
    const worker = new Worker(
      new URL("./watchlistPlanWorker.js", import.meta.url),
      {
        type: "module",
      },
    );

    const handleMessage = (event) => {
      if (requestId !== watchlistPlanRequestIdRef.current) return;
      const payload = event.data || {};
      if (payload.error) {
        console.error("Watchlist planner worker failed:", payload.error);
        setWatchlistPlans([]);
      } else {
        setWatchlistPlans(Array.isArray(payload.plans) ? payload.plans : []);
      }
      setIsWatchlistPlanning(false);
    };

    const handleError = (error) => {
      if (requestId !== watchlistPlanRequestIdRef.current) return;
      console.error("Watchlist planner worker crashed:", error);
      setWatchlistPlans([]);
      setIsWatchlistPlanning(false);
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
    worker.postMessage({
      requestId,
      films: selectedWatchlistFilms,
      desiredPlanCount: PLAN_COUNT,
    });

    return () => {
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
      worker.terminate();
    };
  }, [PLAN_COUNT, selectedWatchlistFilms]);
  const watchlistPlansByIndex = useMemo(
    () =>
      Array.from(
        { length: PLAN_COUNT },
        (_, index) => watchlistPlans[index] || null,
      ),
    [watchlistPlans],
  );
  const selectedScheduleByDay = useMemo(
    () => groupByDay(selectedScheduleItems),
    [selectedScheduleItems],
  );

  const conflictingMovieIds = useMemo(() => {
    const conflicts = new Set();
    if (isWatchlistMode) return conflicts;
    if (!selectedScheduleItems.length) return conflicts;
    for (const item of allScheduleItems) {
      if (selectedIdSet.has(item.id) || item.isTBC) continue;
      if (
        selectedScheduleItems.some((selected) => isOverlapping(item, selected))
      )
        conflicts.add(item.id);
    }
    return conflicts;
  }, [allScheduleItems, isWatchlistMode, selectedIdSet, selectedScheduleItems]);

  const selectedCount = isWatchlistMode
    ? selectedWatchlistFilms.length
    : selectedScheduleItems.length;
  const hasSelections = selectedCount > 0;

  const filteredAndSortedData = useMemo(() => {
    const searchLower = searchQuery.toLowerCase();
    return allScheduleItems
      .filter(
        ({ dayId, venue, title, details }) =>
          (selectedDay === "All" || Number(selectedDay) === dayId) &&
          (selectedVenue === "All" || venue === selectedVenue) &&
          (title.toLowerCase().includes(searchLower) ||
            details.toLowerCase().includes(searchLower)),
      )
      .sort((a, b) => a.startMinutes - b.startMinutes);
  }, [allScheduleItems, selectedDay, selectedVenue, searchQuery]);
  const groupedByDay = useMemo(
    () => groupByDay(filteredAndSortedData),
    [filteredAndSortedData],
  );

  const handleToggleSelection = (item) => {
    if (item.isTBC) return;
    if (isWatchlistMode) {
      setSelectedMoviePriorities((prev) => {
        const currentPriority = normalizePriority(prev[item.title]);
        const nextPriority = getNextPriority(currentPriority);
        if (!nextPriority) {
          if (!currentPriority) return prev;
          const { [item.title]: _removed, ...rest } = prev;
          return rest;
        }
        return { ...prev, [item.title]: nextPriority };
      });
      return;
    }
    setSelectedMovieIds((prev) =>
      prev.includes(item.id)
        ? prev.filter((id) => id !== item.id)
        : conflictingMovieIds.has(item.id)
          ? prev
          : [...prev, item.id],
    );
  };
  const handleCardMouseEnter = (cardId) => {
    if (hoverDelayTimerRef.current) clearTimeout(hoverDelayTimerRef.current);
    hoverDelayTimerRef.current = setTimeout(
      () => setHoveredDescriptionCardId(cardId),
      1000,
    );
  };
  const handleCardMouseLeave = (cardId) => {
    if (hoverDelayTimerRef.current) {
      clearTimeout(hoverDelayTimerRef.current);
      hoverDelayTimerRef.current = null;
    }
    setHoveredDescriptionCardId((prev) => (prev === cardId ? null : prev));
  };
  const applyWatchlistPlan = (index) => {
    if (isWatchlistPlanning) return;
    const selectedPlan = watchlistPlansByIndex[index];
    if (!selectedPlan) return;
    const nextVariants = watchlistPlansByIndex.map((plan) =>
      plan ? plan.map((screening) => screening.id) : null,
    );
    setPlanVariants(nextVariants);
    setActivePlanIndex(index);
    setSelectedMovieIds(nextVariants[index] || []);
    setIsWatchlistMode(false);
  };
  const switchToSavedPlan = (index) => {
    const plan = planVariants[index];
    if (!plan) return;
    setActivePlanIndex(index);
    setSelectedMovieIds(plan);
  };

  const sanitizeSelectionIds = (value) =>
    Array.isArray(value)
      ? Array.from(
          new Set(
            value.filter(
              (id) => Number.isInteger(id) && allScheduleIdSet.has(id),
            ),
          ),
        )
      : [];
  const sanitizeSelectionTitles = (value) =>
    Array.isArray(value)
      ? Array.from(
          new Set(
            value.filter(
              (title) =>
                typeof title === "string" && allSelectableTitleSet.has(title),
            ),
          ),
        )
      : [];
  const sanitizeSelectionPriorities = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const sanitized = {};
    for (const [title, priorityValue] of Object.entries(value)) {
      if (!allSelectableTitleSet.has(title)) continue;
      const priority = normalizePriority(priorityValue);
      if (!priority) continue;
      sanitized[title] = priority;
    }
    return sanitized;
  };
  const downloadSelectionJson = ({
    mode,
    selectedIds = [],
    selectedTitles = [],
    selectedPriorities = {},
    fileName = "rlff-selection.json",
  }) => {
    const sanitizedTitles = sanitizeSelectionTitles(selectedTitles);
    const sanitizedPriorities = sanitizeSelectionPriorities(selectedPriorities);
    const titlesFromPriorities = Object.keys(sanitizedPriorities);
    const normalizedTitles = Array.from(
      new Set([...sanitizedTitles, ...titlesFromPriorities]),
    );
    const payload = {
      exportedAt: new Date().toISOString(),
      type: "rlff-selection",
      mode,
      selectedMovieIds: sanitizeSelectionIds(selectedIds),
      selectedMovieTitles: normalizedTitles,
      selectedMoviePriorities: sanitizedPriorities,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  };
  const exportCurrentSelection = () => {
    if (isWatchlistMode) {
      downloadSelectionJson({
        mode: "watchlist",
        selectedTitles: selectedMovieTitles,
        selectedPriorities: selectedMoviePriorities,
        fileName: "rlff-watchlist-selection.json",
      });
      return;
    }
    downloadSelectionJson({
      mode: "timeline",
      selectedIds: selectedMovieIds,
      fileName: "rlff-timeline-selection.json",
    });
  };
  const exportWatchlistPlan = (index) => {
    if (isWatchlistPlanning) return;
    const plan = watchlistPlansByIndex[index];
    if (!plan) return;
    downloadSelectionJson({
      mode: "timeline",
      selectedIds: plan.map((screening) => screening.id),
      fileName: `rlff-plan-${index + 1}.json`,
    });
  };
  const promptSelectionImport = () => {
    setSelectionImportMessage("");
    selectionImportInputRef.current?.click();
  };
  const handleSelectionImport = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    try {
      const parsed = JSON.parse(await file.text());
      const mode = parsed?.mode === "watchlist" ? "watchlist" : "timeline";
      const nextIds = sanitizeSelectionIds(parsed?.selectedMovieIds);
      const nextTitles = sanitizeSelectionTitles(parsed?.selectedMovieTitles);
      const parsedPriorities = sanitizeSelectionPriorities(
        parsed?.selectedMoviePriorities,
      );
      if (mode === "watchlist") {
        const nextPriorities = { ...parsedPriorities };
        for (const title of nextTitles) {
          if (!nextPriorities[title]) nextPriorities[title] = MIN_PRIORITY;
        }
        setSelectedMoviePriorities(nextPriorities);
        setSelectedMovieIds([]);
        setActivePlanIndex(null);
        setIsWatchlistMode(true);
        setSelectionImportMessage(
          `Imported watchlist (${Object.keys(nextPriorities).length} film${Object.keys(nextPriorities).length === 1 ? "" : "s"}).`,
        );
        return;
      }
      if (Array.isArray(parsed?.planVariants)) {
        const parsedPlanVariants = Array.from(
          { length: PLAN_COUNT },
          (_, index) => {
            const planIds = parsed.planVariants[index];
            if (!Array.isArray(planIds)) return null;
            const ids = sanitizeSelectionIds(planIds);
            return ids.length ? ids : null;
          },
        );
        const parsedActiveIndex = Number.isInteger(parsed?.activePlanIndex)
          ? parsed.activePlanIndex
          : null;
        setPlanVariants(parsedPlanVariants);
        setActivePlanIndex(
          parsedActiveIndex !== null &&
            parsedActiveIndex >= 0 &&
            parsedActiveIndex < PLAN_COUNT &&
            parsedPlanVariants[parsedActiveIndex]
            ? parsedActiveIndex
            : null,
        );
      } else {
        setActivePlanIndex(null);
      }
      setSelectedMovieIds(nextIds);
      setSelectedMoviePriorities({});
      setIsWatchlistMode(false);
      setSelectionImportMessage(
        `Imported timeline selection (${nextIds.length} screening${nextIds.length === 1 ? "" : "s"}).`,
      );
    } catch (error) {
      console.error("Failed to import selection:", error);
      setSelectionImportMessage(
        "Import failed. Please choose a valid selection JSON file.",
      );
    }
  };

  useEffect(() => {
    if (isWatchlistMode || activePlanIndex === null) return;
    setPlanVariants((prev) => {
      const current = prev[activePlanIndex];
      if (!current) return prev;
      if (areIdListsEqual(current, selectedMovieIds)) return prev;
      const next = [...prev];
      next[activePlanIndex] = [...selectedMovieIds];
      return next;
    });
  }, [activePlanIndex, isWatchlistMode, selectedMovieIds]);

  const captureTimelineCanvas = async () => {
    if (!timelineRef.current) return null;
    setIsExporting(true);
    try {
      return await html2canvas(timelineRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        onclone: (doc) => {
          const scrollContainer = doc.querySelector("[data-timeline-scroll]");
          if (!scrollContainer) return;
          scrollContainer.style.maxHeight = "none";
          scrollContainer.style.overflow = "visible";
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
    () => () =>
      hoverDelayTimerRef.current && clearTimeout(hoverDelayTimerRef.current),
    [],
  );

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans pb-12">
      <header className="bg-red-700 text-white shadow-md sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-2 sm:px-3 py-4 sm:py-6">
          <div className="flex items-center gap-3 mb-4">
            <Video className="w-8 h-8" />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              RLFF Schedule
            </h1>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
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
            <div className="relative sm:w-64">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
              <select
                className="w-full pl-10 pr-4 py-2.5 rounded-lg text-gray-900 appearance-none bg-white focus:ring-2 focus:ring-red-400 focus:outline-none"
                value={selectedVenue}
                onChange={(e) => setSelectedVenue(e.target.value)}
              >
                <option value="All">All Venues</option>
                {venuesList.map((venue) => (
                  <option key={venue} value={venue}>
                    {venue}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-2 sm:px-3 mt-6 sm:mt-8">
        <div
          className={`grid gap-6 ${hasSelections ? "lg:grid-cols-[minmax(0,1fr)_340px]" : "grid-cols-1"}`}
        >
          <section className="min-w-0">
            <div className="flex flex-wrap gap-2 mb-8">
              <button
                onClick={() => setSelectedDay("All")}
                className={`${DAY_BTN} ${selectedDay === "All" ? "bg-red-600 text-white shadow" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
              >
                All Days
              </button>
              {DAYS.map((day) => (
                <button
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`${DAY_BTN} flex items-center gap-2 ${selectedDay === day ? "bg-red-600 text-white shadow" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
                >
                  <Calendar className="w-4 h-4" />
                  {daysMap[day].split(",")[0]}
                </button>
              ))}
            </div>

            <div className="mb-6 p-3 rounded-xl border border-gray-200 bg-white flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-gray-700">
                Selected films:{" "}
                <span className="font-semibold">{selectedCount}</span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsWatchlistMode((prev) => !prev)}
                  className={`px-3 py-1.5 rounded-md text-sm font-semibold transition-colors ${isWatchlistMode ? "text-white bg-red-600 hover:bg-red-700" : "text-gray-700 bg-gray-100 hover:bg-gray-200"}`}
                >
                  {isWatchlistMode
                    ? "Watchlist Mode: On"
                    : "Watchlist Mode: Off"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    isWatchlistMode
                      ? setSelectedMoviePriorities({})
                      : setSelectedMovieIds([])
                  }
                  disabled={!hasSelections}
                  className="px-3 py-1.5 rounded-md text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={promptSelectionImport}
                  className="px-3 py-1.5 rounded-md text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 inline-flex items-center gap-1.5"
                >
                  <Upload className="w-4 h-4" />
                  Import JSON
                </button>
                <input
                  ref={selectionImportInputRef}
                  type="file"
                  accept="application/json,.json"
                  onChange={handleSelectionImport}
                  className="hidden"
                />
              </div>
              {selectionImportMessage && (
                <p className="w-full text-xs text-gray-600">
                  {selectionImportMessage}
                </p>
              )}
              {!isWatchlistMode && planVariants.some(Boolean) && (
                <div className="w-full flex flex-wrap items-center gap-2 border-t border-gray-100 pt-2">
                  <span className="text-xs font-semibold text-gray-600">
                    Saved Plans
                  </span>
                  {planVariants.map((plan, index) => (
                    <button
                      key={`saved-plan-${index + 1}`}
                      type="button"
                      onClick={() => switchToSavedPlan(index)}
                      disabled={!plan}
                      className={`px-2.5 py-1.5 rounded-md text-xs font-semibold ${activePlanIndex === index ? "text-white bg-red-600" : "text-gray-700 bg-gray-100 hover:bg-gray-200"} disabled:opacity-40 disabled:cursor-not-allowed`}
                    >
                      {`Plan ${index + 1} (${plan?.length ?? "--"})`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {!filteredAndSortedData.length ? (
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
                {DAYS.map((day) => {
                  const items = groupedByDay[day];
                  if (!items.length) return null;
                  return (
                    <div key={day} className="space-y-4">
                      {selectedDay === "All" && (
                        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2 border-b-2 border-red-200 pb-2">
                          <Calendar className="text-red-600" /> {daysMap[day]}
                        </h2>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {items.map((item) => (
                          <ScreeningCard
                            key={item.id}
                            item={item}
                            isSelected={
                              isWatchlistMode
                                ? selectedTitleSet.has(item.title)
                                : selectedIdSet.has(item.id)
                            }
                            selectionPriority={
                              isWatchlistMode
                                ? normalizePriority(
                                    selectedMoviePriorities[item.title],
                                  )
                                : 0
                            }
                            isWatchlistMode={isWatchlistMode}
                            isConflicting={
                              isWatchlistMode
                                ? false
                                : conflictingMovieIds.has(item.id)
                            }
                            onToggleSelection={handleToggleSelection}
                            onMouseEnter={handleCardMouseEnter}
                            onMouseLeave={handleCardMouseLeave}
                            showFullDescription={
                              hoveredDescriptionCardId === item.id
                            }
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {hasSelections && (
            <aside
              ref={timelineRef}
              className="lg:sticky lg:top-24 self-start h-fit rounded-xl border border-gray-200 bg-white shadow-sm p-4"
            >
              {isWatchlistMode ? (
                <div className="mb-4">
                  <h2 className="text-lg font-bold text-gray-900">
                    Your Watchlist Timeline
                  </h2>
                  <div
                    className="mt-2 flex flex-wrap items-center gap-2"
                    data-html2canvas-ignore="true"
                  >
                    {isWatchlistPlanning && (
                      <span className="text-xs text-gray-500">
                        Rebuilding plans...
                      </span>
                    )}
                    {!isWatchlistPlanning && watchlistPlans.length === 0 && (
                      <span className="text-xs text-gray-500">
                        No feasible plan found yet.
                      </span>
                    )}
                    {watchlistPlansByIndex.map((plan, index) => (
                      <div
                        key={`watchlist-plan-${index + 1}`}
                        className="inline-flex items-stretch"
                      >
                        <button
                          type="button"
                          onClick={() => applyWatchlistPlan(index)}
                          disabled={isWatchlistPlanning || !plan}
                          className="px-2.5 py-1.5 rounded-l-md text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {`Plan ${index + 1} (${plan?.length ?? "--"})`}
                        </button>
                        <button
                          type="button"
                          onClick={() => exportWatchlistPlan(index)}
                          disabled={isWatchlistPlanning || !plan}
                          className="px-2.5 py-1.5 rounded-r-md text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                        >
                          <Save className="w-3.5 h-3.5" />
                          JSON
                        </button>
                      </div>
                    ))}
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
                    <button
                      type="button"
                      onClick={exportCurrentSelection}
                      className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 inline-flex items-center gap-1"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Export
                    </button>
                  </div>
                </div>
              ) : (
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
                    <button
                      type="button"
                      onClick={exportCurrentSelection}
                      className="px-2.5 py-1.5 rounded-md text-xs font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 inline-flex items-center gap-1"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Export
                    </button>
                  </div>
                </div>
              )}
              {isWatchlistMode && (
                <p className="mb-3 text-xs text-gray-600">
                  Click a film card to cycle priority: Priority 1, Priority 2,
                  Priority 3, then deselect.
                  <br />
                  Pick Plan 1, Plan 2, or Plan 3 to exit Watchlist Mode and load
                  that variant in the main schedule. Use each plan's JSON button
                  to export it directly. Planning accounts for travel times
                  (Maison to/from others: 60 min, others: 25 min), max two
                  venues per day, and no return trip to the first venue after
                  switching.
                </p>
              )}
              <div
                data-timeline-scroll
                className="space-y-6 max-h-[75vh] overflow-auto"
              >
                {isWatchlistMode ? (
                  <WatchlistTimeline films={selectedWatchlistFilms} />
                ) : (
                  DAYS.map((day) => {
                    const items = selectedScheduleByDay[day];
                    return items.length ? (
                      <TimelineDay key={day} day={day} items={items} />
                    ) : null;
                  })
                )}
              </div>
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
