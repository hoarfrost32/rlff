const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const TMDB_READ_ACCESS_TOKEN = import.meta.env.VITE_TMDB_READ_ACCESS_TOKEN;

const posterCache = {};
const overviewCache = {};
const movieDirectorsCache = {};
const movieLookupInflight = {};

const LANGUAGE_TO_ISO = {
  english: "en",
  french: "fr",
  spanish: "es",
  german: "de",
  korean: "ko",
  japanese: "ja",
  marathi: "mr",
  hindi: "hi",
  mandarin: "zh",
  norwegian: "no",
  danish: "da",
  croatian: "hr",
  czech: "cs",
  portuguese: "pt",
  greek: "el",
  dutch: "nl",
  icelandic: "is",
  russian: "ru",
  arabic: "ar",
  flemish: "nl",
};

const GENRE_TO_ID = {
  action: 28,
  adventure: 12,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  horror: 27,
  musical: 10402,
  mystery: 9648,
  romance: 10749,
  "sci-fi": 878,
  scifi: 878,
  thriller: 53,
  war: 10752,
  western: 37,
};

const normalize = (value) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const ORIGINAL_TITLE_HINTS = {
  [normalize("THE LIGHT")]: "Das Licht",
  [normalize("THE PRESIDENT'S CAKE")]: "مملكة القصب",
  [normalize("HEN")]: "Κότα",
  [normalize("THE REDEMPTION")]: "La deuda",
  [normalize("RESURRECTION")]: "Kuangye shidai",
};
const DIRECTOR_HINTS = {
  [normalize("RESURRECTION")]: "Bi Gan",
  [normalize("THE MERMAID")]: "Tyler Cornack",
  [normalize("MERMAID")]: "Tyler Cornack",
  [normalize("COLORS OF TIME")]: "Cédric Klapisch",
};

const tokenize = (value) =>
  normalize(value)
    .split(" ")
    .filter((token) => token.length > 1);

const tokenOverlapScore = (a, b) => {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (!aSet.size || !bSet.size) return 0;

  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap += 1;
  }
  return overlap / Math.max(aSet.size, bSet.size);
};

const cleanMovieTitle = (title) => title.replace(/\s+/g, " ").trim();

const getCacheKey = (title, details = "") => `${title}__${details}`;

const parseDetailsMetadata = (details = "") => {
  const chunks = details
    .split(",")
    .map((chunk) => normalize(chunk))
    .filter(Boolean);

  let languageLabel = null;
  let languageIso = null;
  for (const chunk of chunks) {
    const iso = LANGUAGE_TO_ISO[chunk];
    if (iso) {
      languageLabel = chunk;
      languageIso = iso;
      break;
    }
  }

  const genreIds = new Set();
  for (const chunk of chunks) {
    for (const [genreLabel, genreId] of Object.entries(GENRE_TO_ID)) {
      if (chunk.includes(genreLabel)) genreIds.add(genreId);
    }
  }

  return { languageIso, languageLabel, genreIds };
};

const getOriginalTitleHint = (title) =>
  ORIGINAL_TITLE_HINTS[normalize(cleanMovieTitle(title))] || null;
const getDirectorHint = (title) =>
  DIRECTOR_HINTS[normalize(cleanMovieTitle(title))] || null;

const buildQueryCandidates = (
  title,
  metadata,
  originalTitleHint,
  directorHint,
) => {
  const full = cleanMovieTitle(title);
  const withoutLeadingArticle = full.replace(/^(the|a|an)\s+/i, "").trim();
  const withLanguage = metadata.languageLabel
    ? `${full} ${metadata.languageLabel}`
    : "";
  const titleForDirector = originalTitleHint || full;
  const withDirector = directorHint
    ? `${titleForDirector} ${directorHint}`
    : "";
  const hintWithLanguage =
    metadata.languageLabel && originalTitleHint
      ? `${originalTitleHint} ${metadata.languageLabel}`
      : "";
  const variants = [
    originalTitleHint,
    withDirector,
    hintWithLanguage,
    full,
    withLanguage,
    withoutLeadingArticle,
    full.split(":")[0].trim(),
    full.split(",")[0].trim(),
  ].filter(Boolean);

  return Array.from(new Set(variants)).slice(0, 3);
};

const buildTmdbSearchRequests = ({ title, details = "" }) => {
  const cleanedTitle = cleanMovieTitle(title);
  const metadata = parseDetailsMetadata(details);
  const originalTitleHint = getOriginalTitleHint(title);
  const directorHint = getDirectorHint(title);
  const preferredTitle = originalTitleHint || cleanedTitle;
  const queries = buildQueryCandidates(
    title,
    metadata,
    originalTitleHint,
    directorHint,
  );
  const requests = queries.map((query) => {
    const queryParams = new URLSearchParams({
      query,
      include_adult: "false",
      page: "1",
    });

    return {
      query,
      url: `https://api.themoviedb.org/3/search/movie?${queryParams.toString()}`,
    };
  });

  return {
    cleanedTitle,
    preferredTitle,
    originalTitleHint,
    directorHint,
    metadata,
    requests,
  };
};

const scoreMovieCandidate = (movie, normalizedTitle, metadata) => {
  if (!movie?.poster_path) return Number.NEGATIVE_INFINITY;

  const titleCandidates = [
    normalize(movie.title || ""),
    normalize(movie.original_title || ""),
  ].filter(Boolean);

  let score = 0;
  let titleScore = 0;

  if (titleCandidates.some((candidate) => candidate === normalizedTitle)) {
    titleScore = 100;
  } else if (
    titleCandidates.some(
      (candidate) =>
        candidate.includes(normalizedTitle) ||
        normalizedTitle.includes(candidate),
    )
  ) {
    titleScore = 70;
  } else {
    const bestOverlap = Math.max(
      ...titleCandidates.map((candidate) =>
        tokenOverlapScore(candidate, normalizedTitle),
      ),
    );
    titleScore = bestOverlap * 60;
  }
  // Priority 1: language. If language is known, enforce exact match.
  if (metadata.languageIso) {
    if (movie.original_language !== metadata.languageIso) {
      return Number.NEGATIVE_INFINITY;
    }
    score += 1000;
  }

  // Priority 2: title quality.
  score += titleScore;

  // Guardrail: reject weak title matches to avoid unrelated posters.
  if (titleScore < 25) return Number.NEGATIVE_INFINITY;

  if (Array.isArray(movie.genre_ids) && metadata.genreIds.size) {
    let overlap = 0;
    for (const genreId of movie.genre_ids) {
      if (metadata.genreIds.has(genreId)) overlap += 1;
    }
    score += overlap * 10;
  }

  score += Math.min((movie.vote_count || 0) / 500, 8);
  return score;
};

export const getCachedPosterUrl = (title, details = "") =>
  posterCache[getCacheKey(title, details)] || null;

export const getCachedMovieOverview = (title, details = "") =>
  overviewCache[getCacheKey(title, details)] || null;

export const buildPosterRequestDebug = ({ title, details = "" }) => {
  const {
    cleanedTitle,
    preferredTitle,
    originalTitleHint,
    directorHint,
    metadata,
    requests,
  } = buildTmdbSearchRequests({
    title,
    details,
  });

  return {
    method: "GET",
    requests,
    headers: {
      Authorization: "Bearer <redacted>",
      Accept: "application/json",
    },
    body: null,
    query: {
      query: cleanedTitle,
      include_adult: false,
      page: 1,
    },
    derivedMetadata: {
      preferredTitle,
      originalTitleHint,
      directorHint,
      languageIso: metadata.languageIso || null,
      genreIds: Array.from(metadata.genreIds),
    },
  };
};

const fetchMovieDirectors = async (movieId) => {
  if (movieDirectorsCache[movieId]) return movieDirectorsCache[movieId];

  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${movieId}/credits`,
      {
        headers: {
          Authorization: `Bearer ${TMDB_READ_ACCESS_TOKEN}`,
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) return [];

    const data = await res.json();
    const directors = Array.isArray(data?.crew)
      ? data.crew
          .filter((member) => member.job === "Director" && member.name)
          .map((member) => member.name)
      : [];

    movieDirectorsCache[movieId] = directors;
    return directors;
  } catch {
    return [];
  }
};

const runTmdbSearchRequests = async ({
  requests,
  normalizedTitle,
  metadata,
  directorHint = null,
  includeDebug = false,
}) => {
  const scoredById = new Map();
  const debugRequests = [];

  for (const request of requests) {
    const debugEntry = {
      method: "GET",
      url: request.url,
      query: request.query,
    };

    try {
      const res = await fetch(request.url, {
        headers: {
          Authorization: `Bearer ${TMDB_READ_ACCESS_TOKEN}`,
          Accept: "application/json",
        },
      });

      debugEntry.status = res.status;
      debugEntry.ok = res.ok;

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      const results = Array.isArray(data?.results) ? data.results : [];

      if (includeDebug) {
        debugEntry.response = {
          page: data?.page ?? null,
          total_results: data?.total_results ?? null,
          total_pages: data?.total_pages ?? null,
          results_preview: results.slice(0, 10).map((movie) => ({
            id: movie.id,
            title: movie.title,
            original_title: movie.original_title,
            original_language: movie.original_language,
            release_date: movie.release_date,
            genre_ids: movie.genre_ids,
            poster_path: movie.poster_path,
            vote_count: movie.vote_count,
          })),
        };
      }

      if (res.ok) {
        const isPreferredQuery = normalize(request.query) === normalizedTitle;
        const singlePreferredResult = isPreferredQuery && results.length === 1;

        for (const movie of results) {
          if (!movie?.id) continue;
          let score = scoreMovieCandidate(movie, normalizedTitle, metadata);
          if (
            !Number.isFinite(score) &&
            singlePreferredResult &&
            movie.id === results[0].id
          ) {
            score = 1200;
          }
          const existing = scoredById.get(movie.id);
          if (!existing || score > existing.score) {
            scoredById.set(movie.id, { movie, score, query: request.query });
          }
        }
      }
    } catch (error) {
      debugEntry.error = error.message;
    }

    if (includeDebug) debugRequests.push(debugEntry);
  }

  const ranked = Array.from(scoredById.values()).sort(
    (a, b) => b.score - a.score,
  );

  let best = ranked[0];
  const directorChecks = [];
  if (directorHint) {
    const normalizedDirectorHint = normalize(directorHint);
    const shortlist = ranked
      .filter(
        (candidate) =>
          Number.isFinite(candidate.score) && candidate.score >= 25,
      )
      .slice(0, 5);

    for (const candidate of shortlist) {
      const directors = await fetchMovieDirectors(candidate.movie.id);
      const matched = directors.some((name) => {
        const normalizedName = normalize(name);
        return (
          normalizedName === normalizedDirectorHint ||
          normalizedName.includes(normalizedDirectorHint) ||
          normalizedDirectorHint.includes(normalizedName)
        );
      });

      if (includeDebug) {
        directorChecks.push({
          movie_id: candidate.movie.id,
          title: candidate.movie.title,
          directors,
          matched,
        });
      }

      if (matched) {
        best = candidate;
        break;
      }
    }
  }

  return { best, debugRequests, directorChecks };
};

export const fetchPosterDebugData = async ({ title, details = "" }) => {
  const { preferredTitle, directorHint, metadata, requests } =
    buildTmdbSearchRequests({
      title,
      details,
    });

  const requestPreview = buildPosterRequestDebug({ title, details });
  const normalizedTitle = normalize(preferredTitle);

  if (!TMDB_READ_ACCESS_TOKEN) {
    return {
      ...requestPreview,
      error: "Missing VITE_TMDB_READ_ACCESS_TOKEN",
      responses: [],
      chosenMatch: null,
    };
  }

  const { best, debugRequests, directorChecks } = await runTmdbSearchRequests({
    requests,
    normalizedTitle,
    metadata,
    directorHint,
    includeDebug: true,
  });

  const chosenMatch =
    best && Number.isFinite(best.score) && best.score >= 25
      ? {
          id: best.movie.id,
          title: best.movie.title,
          original_title: best.movie.original_title,
          original_language: best.movie.original_language,
          release_date: best.movie.release_date,
          genre_ids: best.movie.genre_ids,
          poster_path: best.movie.poster_path,
          score: best.score,
          matched_from_query: best.query,
          poster_url: best.movie.poster_path
            ? `${TMDB_IMAGE_BASE}${best.movie.poster_path}`
            : null,
        }
      : null;

  return {
    ...requestPreview,
    responses: debugRequests,
    directorChecks,
    chosenMatch,
  };
};

const resolveBestMatch = async ({ title, details = "" }) => {
  const cacheKey = getCacheKey(title, details);
  if (movieLookupInflight[cacheKey]) return movieLookupInflight[cacheKey];

  movieLookupInflight[cacheKey] = (async () => {
    const { preferredTitle, directorHint, metadata, requests } =
      buildTmdbSearchRequests({
        title,
        details,
      });
    const normalizedTitle = normalize(preferredTitle);
    const { best } = await runTmdbSearchRequests({
      requests,
      normalizedTitle,
      metadata,
      directorHint,
      includeDebug: false,
    });
    return best;
  })();

  try {
    return await movieLookupInflight[cacheKey];
  } finally {
    delete movieLookupInflight[cacheKey];
  }
};

export const fetchPosterUrl = async ({ title, details = "" }) => {
  const cacheKey = getCacheKey(title, details);
  if (posterCache[cacheKey]) return posterCache[cacheKey];

  try {
    if (!TMDB_READ_ACCESS_TOKEN) {
      throw new Error("Missing VITE_TMDB_READ_ACCESS_TOKEN");
    }

    const best = await resolveBestMatch({ title, details });

    if (!best || !Number.isFinite(best.score) || best.score < 25) {
      posterCache[cacheKey] = "not_found";
      overviewCache[cacheKey] = "not_found";
      return "not_found";
    }

    const overview = best.movie?.overview?.trim();
    overviewCache[cacheKey] = overview || "not_found";

    if (best.movie?.poster_path) {
      const url = `${TMDB_IMAGE_BASE}${best.movie.poster_path}`;
      posterCache[cacheKey] = url;
      return url;
    }
  } catch (error) {
    console.error("Failed to fetch poster for", title, error.message);
  }

  posterCache[cacheKey] = "not_found";
  overviewCache[cacheKey] = "not_found";
  return "not_found";
};

export const fetchMovieOverview = async ({ title, details = "" }) => {
  const cacheKey = getCacheKey(title, details);
  if (overviewCache[cacheKey]) return overviewCache[cacheKey];

  try {
    if (!TMDB_READ_ACCESS_TOKEN) {
      throw new Error("Missing VITE_TMDB_READ_ACCESS_TOKEN");
    }

    const best = await resolveBestMatch({ title, details });

    if (!best || !Number.isFinite(best.score) || best.score < 25) {
      posterCache[cacheKey] = posterCache[cacheKey] || "not_found";
      overviewCache[cacheKey] = "not_found";
      return "not_found";
    }

    const overview = best.movie?.overview?.trim();
    overviewCache[cacheKey] = overview || "not_found";
    if (!posterCache[cacheKey] && best.movie?.poster_path) {
      posterCache[cacheKey] = `${TMDB_IMAGE_BASE}${best.movie.poster_path}`;
    }
    return overviewCache[cacheKey];
  } catch (error) {
    console.error("Failed to fetch overview for", title, error.message);
  }

  overviewCache[cacheKey] = "not_found";
  return "not_found";
};
