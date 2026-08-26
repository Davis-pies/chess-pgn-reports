// Local dev server with live reload. `npm run dev`, then edit and save.
//
// Deliberately dependency-free and non-bundling: it serves the exact bytes on
// disk. index.html resolves "chess.js" through an importmap pointing at esm.sh,
// and a bundling dev server would rewrite that bare specifier to a node_modules
// path instead -- so development would resolve a different chess.js from the
// deployed site, which is the one thing a dev server must not do.
//
// The reload snippet is injected into HTML RESPONSES only. index.html on disk
// stays exactly what GitHub Pages serves.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { watch } from "node:fs";
import { join, extname, normalize, sep, resolve } from "node:path";

const ROOT = resolve(process.argv[3] || ".");
const PORT = Number(process.argv[2] || process.env.PORT || 8000);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".pgn": "application/x-chess-pgn; charset=utf-8",
	".md": "text/plain; charset=utf-8",
};

const RELOAD_TAG = `<script>
// injected by tools/dev-server.mjs — not part of the deployed site
(() => {
  const es = new EventSource("/__reload");
  es.onmessage = () => location.reload();
  es.onerror = () => {};
})();
</script>
`;

// Open EventSource responses. A browser tab that goes away closes its request,
// which is the only bookkeeping this needs.
const clients = new Set();

function sendReload() {
	for (const res of clients) res.write("data: reload\n\n");
}

// Files whose change should reload the page: everything the browser actually
// loads. node_modules and .git are left unwatched -- recursively watching them
// costs thousands of inotify handles for files no page ever requests.
const WATCH = ["src", "assets", "index.html", "style.css"];

function startWatching() {
	let timer = null;
	const bump = () => {
		// Editors save in bursts (write, rename, chmod), so one save can fire
		// several events. Coalesce them into a single reload.
		clearTimeout(timer);
		timer = setTimeout(sendReload, 60);
	};
	for (const target of WATCH) {
		try {
			watch(join(ROOT, target), { recursive: true }, bump);
		} catch {
			// a path that does not exist in this checkout is not worth failing over
		}
	}
}

async function resolveFile(pathname) {
	let rel;
	try {
		rel = decodeURIComponent(pathname);
	} catch {
		// a malformed escape ("%zz") is a bad request, not a crash
		return null;
	}
	if (rel.endsWith("/")) rel += "index.html";
	const file = normalize(join(ROOT, rel));
	// Traversal guard: a normalized path that escapes the root is refused
	// rather than served, so "GET /../../.ssh/id_rsa" cannot read outside it.
	if (file !== ROOT && !file.startsWith(ROOT + sep)) return null;
	try {
		const s = await stat(file);
		if (s.isDirectory()) return resolveFile(rel.replace(/\/?$/, "/"));
		return file;
	} catch {
		return null;
	}
}

// The path, without the query or fragment. Deliberately NOT `new URL(req.url,
// base)`: a request for "//" is a protocol-relative URL with an empty host and
// throws, which took the whole server down with it -- one malformed request
// from any tab on the machine should not end the dev session.
function pathOf(req) {
	return (req.url || "/").split("?")[0].split("#")[0] || "/";
}

const server = createServer(async (req, res) => {
	try {
		await handle(req, res);
	} catch (e) {
		// Same reasoning: a bad request answers 500 and the server keeps serving.
		console.error("dev-server:", e.message);
		if (!res.headersSent) {
			res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
		}
		res.end("500");
	}
});

async function handle(req, res) {
	const pathname = pathOf(req);

	if (pathname === "/__reload") {
		res.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});
		res.write(": connected\n\n");
		clients.add(res);
		req.on("close", () => clients.delete(res));
		return;
	}

	const file = await resolveFile(pathname);
	if (!file) {
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		res.end("404 " + pathname);
		return;
	}

	const ext = extname(file).toLowerCase();
	const type = MIME[ext] || "application/octet-stream";
	let body = await readFile(file);
	if (ext === ".html") {
		const html = body.toString("utf8");
		body = Buffer.from(
			html.includes("</body>")
				? html.replace("</body>", RELOAD_TAG + "</body>")
				: html + RELOAD_TAG,
			"utf8",
		);
	}
	res.writeHead(200, {
		"content-type": type,
		// Never cache in dev: a 304 on style.css is a reload that changed nothing.
		"cache-control": "no-store",
		"content-length": body.length,
	});
	res.end(req.method === "HEAD" ? undefined : body);
}

// A malformed HTTP request reaches this instead of the handler; answer and drop
// the socket rather than letting it surface as an unhandled error.
server.on("clientError", (_e, socket) => {
	if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.on("error", (e) => {
	if (e.code === "EADDRINUSE") {
		console.error(
			`port ${PORT} is already in use — try: npm run dev -- ${PORT + 1}`,
		);
		process.exit(1);
	}
	throw e;
});

server.listen(PORT, HOST, () => {
	console.log(`serving ${ROOT}`);
	console.log(`  http://${HOST}:${PORT}/`);
	console.log("  live reload on: " + WATCH.join(", "));
	startWatching();
});
