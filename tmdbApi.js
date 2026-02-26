const posterCache = {};
const overviewCache = {};
const trailerCache = {};
const letterboxdCache = {};
const lookupInflight = {};

const getCacheKey = (title, details = "") => `${title}__${details}`;

export const getCachedPosterUrl = (title, details = "") =>
  posterCache[getCacheKey(title, details)] || null;

export const getCachedMovieOverview = (title, details = "") =>
  overviewCache[getCacheKey(title, details)] || null;
export const getCachedTrailerUrl = (title, details = "") =>
  trailerCache[getCacheKey(title, details)] || null;
export const getCachedLetterboxdUrl = (title, details = "") =>
  letterboxdCache[getCacheKey(title, details)] || null;

const slugify = (value) =>
  (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['".,!?&:()[\]{}]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const deriveLetterboxdUrl = ({
  tmdbId,
  resolvedTitle = "",
  releaseDate = "",
  fallbackTitle = "",
}) => {
  if (tmdbId) return `https://letterboxd.com/tmdb/${tmdbId}`;
  const year = (releaseDate || "").slice(0, 4);
  const slugBase = slugify(resolvedTitle) || slugify(fallbackTitle);
  if (!slugBase) return "not_found";
  const slugWithYear =
    Number.isFinite(Number(year)) && year.length === 4
      ? `${slugBase}-${year}`
      : slugBase;
  return `https://letterboxd.com/film/${slugWithYear}/`;
};

const fetchTmdbRecord = async ({ title, details = "" }) => {
  const res = await fetch("/api/tmdb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, details }),
  });
  if (!res.ok) throw new Error(`TMDB API request failed (${res.status})`);
  const data = await res.json();
  return {
    posterUrl: data?.posterUrl || "not_found",
    overview: data?.overview || "not_found",
    trailerUrl: data?.trailerUrl || "not_found",
    letterboxdUrl: deriveLetterboxdUrl({
      tmdbId: data?.tmdbId,
      resolvedTitle: data?.resolvedTitle,
      releaseDate: data?.releaseDate,
      fallbackTitle: title,
    }),
  };
};

const resolveTmdbRecord = async ({ title, details = "" }) => {
  const cacheKey = getCacheKey(title, details);
  if (lookupInflight[cacheKey]) return lookupInflight[cacheKey];
  lookupInflight[cacheKey] = fetchTmdbRecord({ title, details });
  try {
    return await lookupInflight[cacheKey];
  } finally {
    delete lookupInflight[cacheKey];
  }
};

export const fetchPosterUrl = async ({ title, details = "" }) => {
  const cacheKey = getCacheKey(title, details);
  if (posterCache[cacheKey]) return posterCache[cacheKey];

  try {
    const { posterUrl, overview, trailerUrl, letterboxdUrl } =
      await resolveTmdbRecord({
        title,
        details,
      });
    posterCache[cacheKey] = posterUrl;
    overviewCache[cacheKey] = overview;
    trailerCache[cacheKey] = trailerUrl;
    letterboxdCache[cacheKey] = letterboxdUrl;
    return posterUrl;
  } catch (error) {
    console.error("Failed to fetch poster for", title, error.message);
    posterCache[cacheKey] = "not_found";
    overviewCache[cacheKey] = "not_found";
    trailerCache[cacheKey] = "not_found";
    letterboxdCache[cacheKey] = "not_found";
    return "not_found";
  }
};

export const fetchMovieOverview = async ({ title, details = "" }) => {
  const cacheKey = getCacheKey(title, details);
  if (overviewCache[cacheKey]) return overviewCache[cacheKey];

  try {
    const { posterUrl, overview, trailerUrl, letterboxdUrl } =
      await resolveTmdbRecord({
        title,
        details,
      });
    overviewCache[cacheKey] = overview;
    if (!posterCache[cacheKey]) posterCache[cacheKey] = posterUrl;
    if (!trailerCache[cacheKey]) trailerCache[cacheKey] = trailerUrl;
    if (!letterboxdCache[cacheKey]) letterboxdCache[cacheKey] = letterboxdUrl;
    return overview;
  } catch (error) {
    console.error("Failed to fetch overview for", title, error.message);
    overviewCache[cacheKey] = "not_found";
    return "not_found";
  }
};

export const fetchTrailerUrl = async ({ title, details = "" }) => {
  const cacheKey = getCacheKey(title, details);
  if (trailerCache[cacheKey]) return trailerCache[cacheKey];

  try {
    const { posterUrl, overview, trailerUrl, letterboxdUrl } =
      await resolveTmdbRecord({
        title,
        details,
      });
    trailerCache[cacheKey] = trailerUrl;
    if (!posterCache[cacheKey]) posterCache[cacheKey] = posterUrl;
    if (!overviewCache[cacheKey]) overviewCache[cacheKey] = overview;
    if (!letterboxdCache[cacheKey]) letterboxdCache[cacheKey] = letterboxdUrl;
    return trailerUrl;
  } catch (error) {
    console.error("Failed to fetch trailer for", title, error.message);
    trailerCache[cacheKey] = "not_found";
    return "not_found";
  }
};

export const fetchLetterboxdUrl = async ({ title, details = "" }) => {
  const cacheKey = getCacheKey(title, details);
  if (letterboxdCache[cacheKey]) return letterboxdCache[cacheKey];

  try {
    const { posterUrl, overview, trailerUrl, letterboxdUrl } =
      await resolveTmdbRecord({
        title,
        details,
      });
    letterboxdCache[cacheKey] = letterboxdUrl;
    if (!posterCache[cacheKey]) posterCache[cacheKey] = posterUrl;
    if (!overviewCache[cacheKey]) overviewCache[cacheKey] = overview;
    if (!trailerCache[cacheKey]) trailerCache[cacheKey] = trailerUrl;
    return letterboxdUrl;
  } catch (error) {
    console.error("Failed to fetch letterboxd URL for", title, error.message);
    letterboxdCache[cacheKey] = "not_found";
    return "not_found";
  }
};
