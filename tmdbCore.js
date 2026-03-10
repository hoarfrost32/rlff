const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w342";
const MIN_ACCEPTED_SCORE = 25;

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
  italian: "it",
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
const GENRE_ENTRIES = Object.entries(GENRE_TO_ID);

export const normalize = (value) =>
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
  [normalize("ISOLA")]: "Isola",
};

const DIRECTOR_HINTS = {
  [normalize("RESURRECTION")]: "Bi Gan",
  [normalize("THE MERMAID")]: "Tyler Cornack",
  [normalize("MERMAID")]: "Tyler Cornack",
  [normalize("COLORS OF TIME")]: "Cédric Klapisch",
  [normalize("ISOLA")]: "Nora Jaenicke",
};

const RELEASE_YEAR_HINTS = {
  [normalize("ISOLA")]: 2025,
};

const LANGUAGE_HINTS = {
  [normalize("ISOLA")]: "italian",
};

const tokenize = (value) =>
  normalize(value)
    .split(" ")
    .filter((token) => token.length > 1);
const cleanMovieTitle = (title) => title.replace(/\s+/g, " ").trim();
const hasAcceptableScore = (best) =>
  best && Number.isFinite(best.score) && best.score >= MIN_ACCEPTED_SCORE;

const tokenOverlapScore = (a, b) => {
  const aSet = new Set(tokenize(a));
  const bSet = new Set(tokenize(b));
  if (!aSet.size || !bSet.size) return 0;
  let overlap = 0;
  for (const token of aSet) if (bSet.has(token)) overlap += 1;
  return overlap / Math.max(aSet.size, bSet.size);
};

const parseDetailsMetadata = (details = "") => {
  const chunks = details
    .split(",")
    .map((chunk) => normalize(chunk))
    .filter(Boolean);
  let languageLabel = null;
  let languageIso = null;
  let releaseYear = null;
  for (const chunk of chunks) {
    const iso = LANGUAGE_TO_ISO[chunk];
    if (iso) {
      languageLabel = chunk;
      languageIso = iso;
    }
    if (!releaseYear) {
      const yearMatch = chunk.match(/\b(18|19|20)\d{2}\b/);
      if (yearMatch) releaseYear = Number(yearMatch[0]);
    }
    if (languageIso && releaseYear) break;
  }

  const genreIds = new Set();
  for (const chunk of chunks) {
    for (const [genreLabel, genreId] of GENRE_ENTRIES) {
      if (chunk.includes(genreLabel)) genreIds.add(genreId);
    }
  }
  return { languageIso, languageLabel, releaseYear, genreIds };
};

const getOriginalTitleHint = (title) =>
  ORIGINAL_TITLE_HINTS[normalize(cleanMovieTitle(title))] || null;
const getDirectorHint = (title) =>
  DIRECTOR_HINTS[normalize(cleanMovieTitle(title))] || null;
const getReleaseYearHint = (title) =>
  RELEASE_YEAR_HINTS[normalize(cleanMovieTitle(title))] || null;
const getLanguageHint = (title) =>
  LANGUAGE_HINTS[normalize(cleanMovieTitle(title))] || null;

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
  const withYear = metadata.releaseYear ? `${full} ${metadata.releaseYear}` : "";
  const titleForDirector = originalTitleHint || full;
  const withDirector = directorHint
    ? `${titleForDirector} ${directorHint}`
    : "";
  const withDirectorAndYear =
    directorHint && metadata.releaseYear
      ? `${titleForDirector} ${directorHint} ${metadata.releaseYear}`
      : "";
  const hintWithLanguage =
    metadata.languageLabel && originalTitleHint
      ? `${originalTitleHint} ${metadata.languageLabel}`
      : "";
  const hintWithYear =
    metadata.releaseYear && originalTitleHint
      ? `${originalTitleHint} ${metadata.releaseYear}`
      : "";
  return Array.from(
    new Set(
      [
        hintWithYear,
        withDirectorAndYear,
        originalTitleHint,
        withDirector,
        hintWithLanguage,
        withYear,
        full,
        withLanguage,
        withoutLeadingArticle,
        full.split(":")[0].trim(),
        full.split(",")[0].trim(),
      ].filter(Boolean),
    ),
  ).slice(0, 4);
};

const buildTmdbSearchRequests = ({ title, details = "" }) => {
  const cleanedTitle = cleanMovieTitle(title);
  const detailsMetadata = parseDetailsMetadata(details);
  const languageHintLabel = getLanguageHint(title);
  const languageHintIso = languageHintLabel
    ? LANGUAGE_TO_ISO[languageHintLabel] || null
    : null;
  const releaseYearHint = getReleaseYearHint(title);
  const metadata = {
    ...detailsMetadata,
    languageLabel: detailsMetadata.languageLabel || languageHintLabel,
    languageIso: detailsMetadata.languageIso || languageHintIso,
    releaseYear: detailsMetadata.releaseYear || releaseYearHint,
  };
  const originalTitleHint = getOriginalTitleHint(title);
  const directorHint = getDirectorHint(title);
  const preferredTitle = originalTitleHint || cleanedTitle;
  const requests = buildQueryCandidates(
    title,
    metadata,
    originalTitleHint,
    directorHint,
  ).map((query) => {
    const searchParams = {
      query,
      include_adult: "false",
      page: "1",
    };
    if (metadata.releaseYear) {
      searchParams.year = String(metadata.releaseYear);
    }
    return {
      query,
      url: `https://api.themoviedb.org/3/search/movie?${new URLSearchParams(searchParams).toString()}`,
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
    titleScore =
      Math.max(
        ...titleCandidates.map((candidate) =>
          tokenOverlapScore(candidate, normalizedTitle),
        ),
      ) * 60;
  }

  const releaseYear = Number.parseInt((movie.release_date || "").slice(0, 4), 10);

  if (metadata.languageIso) {
    if (movie.original_language !== metadata.languageIso)
      return Number.NEGATIVE_INFINITY;
  }
  if (metadata.releaseYear) {
    if (!Number.isFinite(releaseYear) || releaseYear !== metadata.releaseYear) {
      return Number.NEGATIVE_INFINITY;
    }
  }
  if (titleScore < MIN_ACCEPTED_SCORE) return Number.NEGATIVE_INFINITY;

  let score =
    titleScore + (metadata.languageIso ? 1000 : 0) + (metadata.releaseYear ? 300 : 0);
  if (Array.isArray(movie.genre_ids) && metadata.genreIds.size) {
    let overlap = 0;
    for (const genreId of movie.genre_ids)
      if (metadata.genreIds.has(genreId)) overlap += 1;
    score += overlap * 10;
  }
  score += Math.min((movie.vote_count || 0) / 500, 8);
  return score;
};

const fetchMovieDirectors = async (movieId, headers) => {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${movieId}/credits`,
      {
        headers,
      },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.crew)
      ? data.crew
          .filter((member) => member.job === "Director" && member.name)
          .map((member) => member.name)
      : [];
  } catch {
    return [];
  }
};

const fetchMovieTrailerUrl = async (movieId, headers) => {
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/movie/${movieId}/videos`,
      {
        headers,
      },
    );
    if (!res.ok) return "not_found";
    const data = await res.json();
    const videos = Array.isArray(data?.results) ? data.results : [];
    const youtubeVideos = videos.filter(
      (video) => video?.site === "YouTube" && video?.key,
    );
    if (!youtubeVideos.length) return "not_found";

    const pickBy = (predicate) => youtubeVideos.find(predicate);
    const bestTrailer =
      pickBy((video) => video.official && video.type === "Trailer") ||
      pickBy((video) => video.type === "Trailer") ||
      pickBy((video) => video.official) ||
      youtubeVideos[0];

    return bestTrailer?.key
      ? `https://www.youtube.com/watch?v=${bestTrailer.key}`
      : "not_found";
  } catch {
    return "not_found";
  }
};

const runTmdbSearchRequests = async ({
  requests,
  normalizedTitle,
  metadata,
  directorHint = null,
  headers,
}) => {
  const scoredById = new Map();

  const searchResponses = await Promise.all(
    requests.map(async (request) => {
      try {
        const res = await fetch(request.url, { headers });
        const data = await res.json().catch(() => null);
        return {
          request,
          results: Array.isArray(data?.results) ? data.results : [],
          ok: res.ok,
        };
      } catch {
        return { request, results: [], ok: false };
      }
    }),
  );

  for (const { request, results, ok } of searchResponses) {
    if (!ok) continue;
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

  const ranked = Array.from(scoredById.values()).sort(
    (a, b) => b.score - a.score,
  );
  let best = ranked[0];

  if (directorHint) {
    const normalizedDirectorHint = normalize(directorHint);
    const shortlist = ranked
      .filter(
        (candidate) =>
          Number.isFinite(candidate.score) &&
          candidate.score >= MIN_ACCEPTED_SCORE,
      )
      .slice(0, 5);

    for (const candidate of shortlist) {
      const directors = await fetchMovieDirectors(candidate.movie.id, headers);
      const matched = directors.some((name) => {
        const normalizedName = normalize(name);
        return (
          normalizedName === normalizedDirectorHint ||
          normalizedName.includes(normalizedDirectorHint) ||
          normalizedDirectorHint.includes(normalizedName)
        );
      });
      if (matched) {
        best = candidate;
        break;
      }
    }
  }

  return { best };
};

export const resolveTmdbMovie = async ({ title, details = "", tmdbToken }) => {
  if (!tmdbToken) {
    return {
      posterUrl: "not_found",
      overview: "not_found",
      trailerUrl: "not_found",
      tmdbId: null,
      resolvedTitle: "not_found",
      originalTitle: "not_found",
      releaseDate: "not_found",
    };
  }

  const { preferredTitle, directorHint, metadata, requests } =
    buildTmdbSearchRequests({ title, details });
  const { best } = await runTmdbSearchRequests({
    requests,
    normalizedTitle: normalize(preferredTitle),
    metadata,
    directorHint,
    headers: {
      Authorization: `Bearer ${tmdbToken}`,
      Accept: "application/json",
    },
  });

  if (!hasAcceptableScore(best)) {
    return {
      posterUrl: "not_found",
      overview: "not_found",
      trailerUrl: "not_found",
      tmdbId: null,
      resolvedTitle: "not_found",
      originalTitle: "not_found",
      releaseDate: "not_found",
    };
  }

  const trailerUrl = await fetchMovieTrailerUrl(best.movie.id, {
    Authorization: `Bearer ${tmdbToken}`,
    Accept: "application/json",
  });

  return {
    posterUrl: best.movie?.poster_path
      ? `${TMDB_IMAGE_BASE}${best.movie.poster_path}`
      : "not_found",
    overview: best.movie?.overview?.trim() || "not_found",
    trailerUrl,
    tmdbId: best.movie?.id || null,
    resolvedTitle: best.movie?.title?.trim() || "not_found",
    originalTitle: best.movie?.original_title?.trim() || "not_found",
    releaseDate: best.movie?.release_date?.trim() || "not_found",
  };
};
