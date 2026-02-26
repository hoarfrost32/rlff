const posterCache = {};
const overviewCache = {};
const trailerCache = {};
const lookupInflight = {};

const getCacheKey = (title, details = "") => `${title}__${details}`;

export const getCachedPosterUrl = (title, details = "") =>
  posterCache[getCacheKey(title, details)] || null;

export const getCachedMovieOverview = (title, details = "") =>
  overviewCache[getCacheKey(title, details)] || null;
export const getCachedTrailerUrl = (title, details = "") =>
  trailerCache[getCacheKey(title, details)] || null;

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
    const { posterUrl, overview, trailerUrl } = await resolveTmdbRecord({
      title,
      details,
    });
    posterCache[cacheKey] = posterUrl;
    overviewCache[cacheKey] = overview;
    trailerCache[cacheKey] = trailerUrl;
    return posterUrl;
  } catch (error) {
    console.error("Failed to fetch poster for", title, error.message);
    posterCache[cacheKey] = "not_found";
    overviewCache[cacheKey] = "not_found";
    trailerCache[cacheKey] = "not_found";
    return "not_found";
  }
};

export const fetchMovieOverview = async ({ title, details = "" }) => {
  const cacheKey = getCacheKey(title, details);
  if (overviewCache[cacheKey]) return overviewCache[cacheKey];

  try {
    const { posterUrl, overview, trailerUrl } = await resolveTmdbRecord({
      title,
      details,
    });
    overviewCache[cacheKey] = overview;
    if (!posterCache[cacheKey]) posterCache[cacheKey] = posterUrl;
    if (!trailerCache[cacheKey]) trailerCache[cacheKey] = trailerUrl;
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
    const { posterUrl, overview, trailerUrl } = await resolveTmdbRecord({
      title,
      details,
    });
    trailerCache[cacheKey] = trailerUrl;
    if (!posterCache[cacheKey]) posterCache[cacheKey] = posterUrl;
    if (!overviewCache[cacheKey]) overviewCache[cacheKey] = overview;
    return trailerUrl;
  } catch (error) {
    console.error("Failed to fetch trailer for", title, error.message);
    trailerCache[cacheKey] = "not_found";
    return "not_found";
  }
};
