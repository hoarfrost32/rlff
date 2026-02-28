import { resolveTmdbMovie } from "../tmdbCore.js";
import fs from "node:fs";
import path from "node:path";

const parseEnvContent = (content = "") => {
  const vars = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 1) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
};

let cachedLocalEnv = null;
const readLocalEnv = () => {
  if (cachedLocalEnv) return cachedLocalEnv;
  try {
    const envPath = path.resolve(process.cwd(), ".env.local");
    const envContent = fs.readFileSync(envPath, "utf8");
    cachedLocalEnv = parseEnvContent(envContent);
  } catch {
    cachedLocalEnv = {};
  }
  return cachedLocalEnv;
};

const getTmdbToken = () => {
  const fromRuntime =
    process.env.TMDB_READ_ACCESS_TOKEN ||
    process.env.VITE_TMDB_READ_ACCESS_TOKEN;
  if (fromRuntime) return fromRuntime;
  if (process.env.NODE_ENV === "production") return "";
  const localVars = readLocalEnv();
  return (
    localVars.TMDB_READ_ACCESS_TOKEN ||
    localVars.VITE_TMDB_READ_ACCESS_TOKEN ||
    ""
  );
};

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
    const tmdbToken = getTmdbToken();
    const result = await resolveTmdbMovie({
      title,
      details,
      tmdbToken,
    });
    return res.status(200).json(result);
  } catch (error) {
    console.error("TMDB server error:", error);
    return res.status(500).json({
      posterUrl: "not_found",
      overview: "not_found",
      trailerUrl: "not_found",
    });
  }
}
