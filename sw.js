// sw.js
// A service worker with one job: to make the page cross-origin isolated, so
// the browser allows SharedArrayBuffer and the multi-threaded Stockfish can
// run. Isolation needs two response headers (COOP and COEP) on the page and
// on every worker script it starts, and GitHub Pages cannot be told to send
// them. This adds them on the way in instead. Nothing is cached: every
// request still goes to the network, exactly as it would without it.
//
// Only same-origin responses are touched. Cross-origin loads (chess.js from
// esm.sh, the full engine from unpkg or jsDelivr) are CORS requests, which
// "require-corp" already accepts, so they pass by untouched. "require-corp"
// rather than "credentialless" because Safari supports only the first.
//
// index.html registers this and reloads once when it first takes over; a
// browser without service workers keeps the single-threaded engine.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
	const req = e.request;
	if (new URL(req.url).origin !== self.location.origin) return;
	e.respondWith(
		fetch(req).then((res) => {
			// opaque and error responses carry no headers that can be changed
			if (res.status === 0) return res;
			const headers = new Headers(res.headers);
			headers.set("Cross-Origin-Opener-Policy", "same-origin");
			headers.set("Cross-Origin-Embedder-Policy", "require-corp");
			return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
		}),
	);
});
