import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 4173);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(body));
}

function cleanSubredditName(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?reddit\.com\/r\//i, "")
    .replace(/^\/?r\//i, "")
    .replace(/\/.*$/, "");
}

async function handleReddit(req, res, url) {
  const sub = cleanSubredditName(url.searchParams.get("sub"));
  const after = url.searchParams.get("after") || "";

  if (!/^[A-Za-z0-9_]{2,21}$/.test(sub)) {
    sendJson(res, 400, { error: "Enter a valid subreddit name." });
    return;
  }

  const params = new URLSearchParams({
    limit: "18",
    raw_json: "1"
  });
  if (after) params.set("after", after);

  const redditUrl = `https://www.reddit.com/r/${encodeURIComponent(sub)}/new.json?${params}`;

  try {
    const response = await fetch(redditUrl, {
      headers: {
        "user-agent": "subreddit-scroll-local/1.0 (personal project)",
        "accept": "application/json"
      }
    });

    if (!response.ok) {
      const message = response.status === 404
        ? "That subreddit was not found or is unavailable."
        : `Reddit returned ${response.status}.`;
      sendJson(res, response.status, { error: message });
      return;
    }

    const payload = await response.json();
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 502, {
      error: "Could not reach Reddit from the local server.",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream"
    });
    res.end(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type"
    });
    res.end();
    return;
  }

  if (url.pathname === "/api/reddit") {
    await handleReddit(req, res, url);
    return;
  }

  await handleStatic(req, res, url);
}).listen(port, () => {
  console.log(`Subreddit Scroll is running at http://localhost:${port}`);
});
