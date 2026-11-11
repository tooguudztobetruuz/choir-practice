// Offline helper for the choir practice site.
// - Keeps the page itself (index.html, config.js, program.json, fonts) so it opens without internet.
// - Plays any track the singer saved with "Save for offline" from this phone instead of Google Drive,
//   including the partial ("Range") requests audio players use for seeking.
const SHELL = "ncc-shell-v1";
const AUDIO = "ncc-audio-v1";
const SHELL_FILES = ["./", "index.html", "config.js", "program.json"];
const audioKey = id => "https://ncc-audio.local/" + id;

self.addEventListener("install", e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });

function driveId(url) {
  const m = url.match(/\/drive\/v3\/files\/([^/?]+)\?alt=media/);
  return m ? decodeURIComponent(m[1]) : null;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const id = driveId(req.url);
  if (id) { e.respondWith(fromSaved(req, id)); return; }
  const u = new URL(req.url);
  if (u.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) e.respondWith(cacheFirst(req));
});

async function fromSaved(req, id) {
  const hit = await (await caches.open(AUDIO)).match(audioKey(id));
  if (!hit) return fetch(req);
  const blob = await hit.blob(), size = blob.size;
  const type = hit.headers.get("content-type") || "audio/mpeg";
  const range = req.headers.get("range");
  if (!range) {
    return new Response(blob, { status: 200, headers: { "Content-Type": type, "Content-Length": String(size), "Accept-Ranges": "bytes" } });
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  let start = m[1] ? +m[1] : 0, end = m[2] ? +m[2] : size - 1;
  if (!m[1] && m[2]) { start = Math.max(0, size - +m[2]); end = size - 1; }
  end = Math.min(end, size - 1);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Type": type, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" },
  });
}

async function networkFirst(req) {
  const c = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === "navigate" ? await c.match("index.html") : null);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const c = await caches.open(SHELL), hit = await c.match(req);
  if (hit) return hit;
  try { const res = await fetch(req); if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }
  catch (e) { return Response.error(); }
}
