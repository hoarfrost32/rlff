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
  for (const chunk of chunks) {
    const iso = LANGUAGE_TO_ISO[chunk];
    if (!iso) continue;
    languageLabel = chunk;
    languageIso = iso;
    break;
  }

  const genreIds = new Set();
  for (const chunk of chunks) {
    for (const [genreLabel, genreId] of GENRE_ENTRIES) {
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
  return Array.from(
    new Set(
      [
        originalTitleHint,
        withDirector,
        hintWithLanguage,
        full,
        withLanguage,
        withoutLeadingArticle,
        full.split(":")[0].trim(),
        full.split(",")[0].trim(),
      ].filter(Boolean),
    ),
  ).slice(0, 3);
};

const buildTmdbSearchRequests = ({ title, details = "" }) => {
  const cleanedTitle = cleanMovieTitle(title);
  const metadata = parseDetailsMetadata(details);
  const originalTitleHint = getOriginalTitleHint(title);
  const directorHint = getDirectorHint(title);
  const preferredTitle = originalTitleHint || cleanedTitle;
  const requests = buildQueryCandidates(
    title,
    metadata,
    originalTitleHint,
    directorHint,
  ).map((query) => ({
    query,
    url: `https://api.themoviedb.org/3/search/movie?${new URLSearchParams({ query, include_adult: "false", page: "1" }).toString()}`,
  }));
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

  if (metadata.languageIso) {
    if (movie.original_language !== metadata.languageIso)
      return Number.NEGATIVE_INFINITY;
  }
  if (titleScore < MIN_ACCEPTED_SCORE) return Number.NEGATIVE_INFINITY;

  let score = titleScore + (metadata.languageIso ? 1000 : 0);
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
    const res = await fetch(`https://api.themoviedb.org/3/movie/${movieId}/credits`, {
      headers,
    });
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

  const ranked = Array.from(scoredById.values()).sort((a, b) => b.score - a.score);
  let best = ranked[0];

  if (directorHint) {
    const normalizedDirectorHint = normalize(directorHint);
    const shortlist = ranked
      .filter((candidate) => Number.isFinite(candidate.score) && candidate.score >= MIN_ACCEPTED_SCORE)
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
    return { posterUrl: "not_found", overview: "not_found" };
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
    return { posterUrl: "not_found", overview: "not_found" };
  }

  return {
    posterUrl: best.movie?.poster_path
      ? `${TMDB_IMAGE_BASE}${best.movie.poster_path}`
      : "not_found",
    overview: best.movie?.overview?.trim() || "not_found",
  };
};
