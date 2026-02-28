import { resolveTmdbMovie } from "./tmdbCore";

const posterCache = {};
const overviewCache = {};
const trailerCache = {};
const letterboxdCache = {};
const originalTitleCache = {};
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
export const getCachedOriginalTitle = (title, details = "") =>
  originalTitleCache[getCacheKey(title, details)] || null;

const deriveLetterboxdUrl = ({ tmdbId }) =>
  tmdbId ? `https://letterboxd.com/tmdb/${tmdbId}` : "not_found";

const mapRecordData = (data) => ({
  posterUrl: data?.posterUrl || "not_found",
  overview: data?.overview || "not_found",
  trailerUrl: data?.trailerUrl || "not_found",
  originalTitle: data?.originalTitle || "not_found",
  letterboxdUrl: deriveLetterboxdUrl({
    tmdbId: data?.tmdbId,
  }),
});

const fetchTmdbRecordViaApi = async ({ title, details = "" }) => {
  const res = await fetch("/api/tmdb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, details }),
  });
  if (!res.ok) throw new Error(`TMDB API request failed (${res.status})`);
  return mapRecordData(await res.json());
};

const fetchTmdbRecordViaLocalDevToken = async ({ title, details = "" }) => {
  const token = import.meta.env?.VITE_TMDB_READ_ACCESS_TOKEN || "";
  if (!import.meta.env.DEV || !token) {
    throw new Error("Local TMDB token is not available");
  }
  const data = await resolveTmdbMovie({
    title,
    details,
    tmdbToken: token,
  });
  return mapRecordData(data);
};

const isHardNotFoundRecord = (record) =>
  record?.posterUrl === "not_found" &&
  record?.overview === "not_found" &&
  record?.trailerUrl === "not_found" &&
  record?.originalTitle === "not_found" &&
  record?.letterboxdUrl === "not_found";

const fetchTmdbRecord = async ({ title, details = "" }) => {
  try {
    const apiRecord = await fetchTmdbRecordViaApi({ title, details });
    if (!isHardNotFoundRecord(apiRecord)) return apiRecord;
    if (!import.meta.env.DEV || !import.meta.env?.VITE_TMDB_READ_ACCESS_TOKEN) {
      return apiRecord;
    }
    return await fetchTmdbRecordViaLocalDevToken({ title, details });
  } catch (error) {
    if (!import.meta.env.DEV || !import.meta.env?.VITE_TMDB_READ_ACCESS_TOKEN) {
      throw error;
    }
    return await fetchTmdbRecordViaLocalDevToken({ title, details });
  }
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
    const { posterUrl, overview, trailerUrl, letterboxdUrl, originalTitle } =
      await resolveTmdbRecord({
        title,
        details,
      });
    posterCache[cacheKey] = posterUrl;
    overviewCache[cacheKey] = overview;
    trailerCache[cacheKey] = trailerUrl;
    letterboxdCache[cacheKey] = letterboxdUrl;
    originalTitleCache[cacheKey] = originalTitle;
    return posterUrl;
  } catch (error) {
    console.error("Failed to fetch poster for", title, error.message);
    posterCache[cacheKey] = "not_found";
    overviewCache[cacheKey] = "not_found";
    trailerCache[cacheKey] = "not_found";
    letterboxdCache[cacheKey] = "not_found";
    originalTitleCache[cacheKey] = "not_found";
    return "not_found";
  }
};

export const fetchMovieOverview = async ({ title, details = "" }) => {
  const cacheKey = getCacheKey(title, details);
  if (overviewCache[cacheKey]) return overviewCache[cacheKey];

  try {
    const { posterUrl, overview, trailerUrl, letterboxdUrl, originalTitle } =
      await resolveTmdbRecord({
        title,
        details,
      });
    overviewCache[cacheKey] = overview;
    if (!posterCache[cacheKey]) posterCache[cacheKey] = posterUrl;
    if (!trailerCache[cacheKey]) trailerCache[cacheKey] = trailerUrl;
    if (!letterboxdCache[cacheKey]) letterboxdCache[cacheKey] = letterboxdUrl;
    if (!originalTitleCache[cacheKey])
      originalTitleCache[cacheKey] = originalTitle;
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
    const { posterUrl, overview, trailerUrl, letterboxdUrl, originalTitle } =
      await resolveTmdbRecord({
        title,
        details,
      });
    trailerCache[cacheKey] = trailerUrl;
    if (!posterCache[cacheKey]) posterCache[cacheKey] = posterUrl;
    if (!overviewCache[cacheKey]) overviewCache[cacheKey] = overview;
    if (!letterboxdCache[cacheKey]) letterboxdCache[cacheKey] = letterboxdUrl;
    if (!originalTitleCache[cacheKey])
      originalTitleCache[cacheKey] = originalTitle;
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
    const { posterUrl, overview, trailerUrl, letterboxdUrl, originalTitle } =
      await resolveTmdbRecord({
        title,
        details,
      });
    letterboxdCache[cacheKey] = letterboxdUrl;
    if (!posterCache[cacheKey]) posterCache[cacheKey] = posterUrl;
    if (!overviewCache[cacheKey]) overviewCache[cacheKey] = overview;
    if (!trailerCache[cacheKey]) trailerCache[cacheKey] = trailerUrl;
    if (!originalTitleCache[cacheKey])
      originalTitleCache[cacheKey] = originalTitle;
    return letterboxdUrl;
  } catch (error) {
    console.error("Failed to fetch letterboxd URL for", title, error.message);
    letterboxdCache[cacheKey] = "not_found";
    return "not_found";
  }
};

export const fetchOriginalTitle = async ({ title, details = "" }) => {
  const cacheKey = getCacheKey(title, details);
  if (originalTitleCache[cacheKey]) return originalTitleCache[cacheKey];

  try {
    const { posterUrl, overview, trailerUrl, letterboxdUrl, originalTitle } =
      await resolveTmdbRecord({
        title,
        details,
      });
    originalTitleCache[cacheKey] = originalTitle;
    if (!posterCache[cacheKey]) posterCache[cacheKey] = posterUrl;
    if (!overviewCache[cacheKey]) overviewCache[cacheKey] = overview;
    if (!trailerCache[cacheKey]) trailerCache[cacheKey] = trailerUrl;
    if (!letterboxdCache[cacheKey]) letterboxdCache[cacheKey] = letterboxdUrl;
    return originalTitle;
  } catch (error) {
    console.error("Failed to fetch original title for", title, error.message);
    originalTitleCache[cacheKey] = "not_found";
    return "not_found";
  }
};
