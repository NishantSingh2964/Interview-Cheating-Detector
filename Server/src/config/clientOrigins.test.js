const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createClientOriginCallback,
  getAllowedClientOrigins,
  getVercelPreviewHostPattern,
} = require("./clientOrigins");

test("reads and normalizes a comma-separated client origin allowlist", () => {
  const origins = getAllowedClientOrigins({
    CLIENT_URLS: " https://app.example.com/, https://preview.example.com ",
    CLIENT_URL: "https://legacy.example.com",
  });

  assert.deepEqual([...origins], [
    "https://app.example.com",
    "https://preview.example.com",
  ]);
});

test("falls back to the legacy client URL and local default", () => {
  assert.deepEqual(
    [...getAllowedClientOrigins({ CLIENT_URL: "https://app.example.com" })],
    ["https://app.example.com"],
  );
  assert.deepEqual([...getAllowedClientOrigins({})], ["http://localhost:3000"]);
});

test("rejects values that are not origins", () => {
  assert.throws(
    () => getAllowedClientOrigins({ CLIENT_URLS: "https://app.example.com/path" }),
    /Invalid client origin/,
  );
});

test("matches only HTTPS branch previews for the configured Vercel project and team", () => {
  const pattern = getVercelPreviewHostPattern({
    VERCEL_PREVIEW_PROJECT: "interview-cheating-de",
    VERCEL_PREVIEW_TEAM: "nishant-rajs-projects-b88f299e",
  });
  const validateOrigin = createClientOriginCallback(
    new Set(["https://interview-cheating-detector.vercel.app"]),
    pattern,
  );
  const checkOrigin = (origin) =>
    new Promise((resolve, reject) => {
      validateOrigin(origin, (error, allowed) => {
        if (error) reject(error);
        else resolve(allowed);
      });
    });

  return Promise.all([
    checkOrigin(
      "https://interview-cheating-de-git-6ab59a-nishant-rajs-projects-b88f299e.vercel.app",
    ),
    checkOrigin(
      "https://interview-cheating-de-git-feature-fix-nishant-rajs-projects-b88f299e.vercel.app",
    ),
    checkOrigin("https://other-project-git-main-nishant-rajs-projects-b88f299e.vercel.app"),
    checkOrigin("https://interview-cheating-de-git-main-someone-else.vercel.app"),
    checkOrigin("http://interview-cheating-de-git-main-nishant-rajs-projects-b88f299e.vercel.app"),
    checkOrigin("https://interview-cheating-de-git-main-nishant-rajs-projects-b88f299e.vercel.app.attacker.test"),
  ]).then(([commitPreview, branchPreview, wrongProject, wrongTeam, insecure, spoofed]) => {
    assert.equal(commitPreview, true);
    assert.equal(branchPreview, true);
    assert.equal(wrongProject, false);
    assert.equal(wrongTeam, false);
    assert.equal(insecure, false);
    assert.equal(spoofed, false);
  });
});

test("requires both Vercel slugs when preview matching is configured", () => {
  assert.throws(
    () => getVercelPreviewHostPattern({ VERCEL_PREVIEW_PROJECT: "my-project" }),
    /VERCEL_PREVIEW_PROJECT and VERCEL_PREVIEW_TEAM/,
  );
});

test("allows configured origins and requests without an Origin header", () => {
  const validateOrigin = createClientOriginCallback(
    new Set(["https://app.example.com"]),
  );
  const checkOrigin = (origin) =>
    new Promise((resolve, reject) => {
      validateOrigin(origin, (error, allowed) => {
        if (error) reject(error);
        else resolve(allowed);
      });
    });

  return Promise.all([
    checkOrigin("https://app.example.com"),
    checkOrigin(undefined),
    checkOrigin("https://other.example.com"),
  ]).then(([allowed, originless, rejected]) => {
    assert.equal(allowed, true);
    assert.equal(originless, true);
    assert.equal(rejected, false);
  });
});
