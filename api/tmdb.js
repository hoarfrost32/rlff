import { resolveTmdbMovie } from "../tmdbCore.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { title, details = "" } = req.body || {};
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "Missing title" });
  }

  try {
    const result = await resolveTmdbMovie({
      title,
      details,
      tmdbToken: process.env.TMDB_READ_ACCESS_TOKEN,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("TMDB server error:", error);
    return res
      .status(500)
      .json({
        posterUrl: "not_found",
        overview: "not_found",
        trailerUrl: "not_found",
      });
  }
}
