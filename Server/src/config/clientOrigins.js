const DEFAULT_CLIENT_ORIGIN = "http://localhost:3000";

function getAllowedClientOrigins(env = process.env) {
  const configuredOrigins =
    env.CLIENT_URLS || env.CLIENT_URL || DEFAULT_CLIENT_ORIGIN;
  const origins = configuredOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error("CLIENT_URLS must contain at least one client origin.");
  }

  return new Set(
    origins.map((origin) => {
      let parsed;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error(`Invalid client origin in CLIENT_URLS: ${origin}`);
      }

      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.pathname !== "/" ||
        parsed.search ||
        parsed.hash ||
        parsed.username ||
        parsed.password
      ) {
        throw new Error(`Invalid client origin in CLIENT_URLS: ${origin}`);
      }

      return parsed.origin;
    }),
  );
}

function getVercelPreviewHostPattern(env = process.env) {
  const project = env.VERCEL_PREVIEW_PROJECT?.trim().toLowerCase();
  const team = env.VERCEL_PREVIEW_TEAM?.trim().toLowerCase();
  if (!project && !team) return null;

  const isSlug = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  if (!project || !team || !isSlug(project) || !isSlug(team)) {
    throw new Error(
      "VERCEL_PREVIEW_PROJECT and VERCEL_PREVIEW_TEAM must be valid Vercel slugs.",
    );
  }

  return new RegExp(
    `^${project}-git-[a-z0-9-]+-${team}\\.vercel\\.app$`,
  );
}

function isAllowedVercelPreviewOrigin(origin, hostPattern) {
  if (!hostPattern) return false;

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  return (
    parsed.protocol === "https:" &&
    parsed.origin === origin &&
    hostPattern.test(parsed.hostname)
  );
}

function createClientOriginCallback(allowedOrigins, previewHostPattern = null) {
  return (origin, callback) => {
    callback(
      null,
      !origin ||
        allowedOrigins.has(origin) ||
        isAllowedVercelPreviewOrigin(origin, previewHostPattern),
    );
  };
}

module.exports = {
  createClientOriginCallback,
  getAllowedClientOrigins,
  getVercelPreviewHostPattern,
};
