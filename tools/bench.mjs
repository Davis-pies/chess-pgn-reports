/* global window, document, KeyboardEvent -- page.evaluate runs in the browser */
// Performance benchmark: `npm run bench`. Times the hot paths in real
// Chromium on synthetic repertoires of growing size (see gen-pgn.mjs); jsdom
// is a poor stand-in for DOM and layout cost. Each time includes the style and
// layout pass the change forces, not only the script. BENCH_SIZES=50,200 picks
// the sizes (variations per workbook).
//
// Needs Playwright, which is not a dependency of the app: it is taken from
// node_modules if present, else from the global install (`npm i -g
// playwright`). Set CHROMIUM to use a browser binary of your own.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, extname, resolve } from "node:path";
import { genPgn } from "./gen-pgn.mjs";

const require = createRequire(import.meta.url);
let chromium;
try {
	({ chromium } = require("playwright"));
} catch {
	const g = require("node:child_process").execSync("npm root -g").toString().trim();
	({ chromium } = require(join(g, "playwright")));
}

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const server = createServer(async (req, res) => {
	const path = join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/\/$/, "/index.html"));
	try {
		const body = await readFile(path);
		res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
		res.end(body);
	} catch {
		res.writeHead(404).end();
	}
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/`;

const SIZES = (process.env.BENCH_SIZES || "50,200,800").split(",").map(Number);
const browser = await chromium.launch({
	executablePath: process.env.CHROMIUM || undefined,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
// the importmap points at esm.sh; serve the installed copy instead, so the
// run needs no network and measures the version the tests pin
const chessJs = await readFile(join(ROOT, "node_modules/chess.js/dist/esm/chess.js"));
await page.route("https://esm.sh/**", (route) =>
	route.fulfill({ body: chessJs, contentType: "text/javascript" }),
);
// no stockfish: the engine is not what is measured
await page.route("**/vendor/stockfish/**", (route) => route.abort());

const rows = [];
const cols = ["vars", "kb", "dom", "load", "rerender", "print", "openAn", "step", "closeAn"];
console.log(cols.map((c) => c.padStart(9)).join(""));
for (const vars of SIZES) {
	await page.goto(base);
	await page.waitForSelector("textarea.pgnin");
	const pgn = genPgn({ vars, len: 30, depth: 4 });
	const r = await page.evaluate(async (pgn) => {
		const ms = (t) => (performance.now() - t).toFixed(1);
		const settle = () => void document.body.offsetHeight; // force style + layout
		const btn = (txt) => [...document.querySelectorAll("button")].find((b) => b.textContent.includes(txt));
		const key = (k) =>
			document.querySelector(".analysis").dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
		const out = { kb: (pgn.length / 1024).toFixed(0) };
		document.querySelector("textarea.pgnin").value = pgn;
		let t = performance.now();
		btn("Load").click();
		while (document.getElementById("loading") || !document.querySelector(".an-toggle")) await new Promise((r) => setTimeout(r, 0));
		settle();
		out.load = ms(t);
		out.dom = document.getElementsByTagName("*").length;
		const table = [...document.querySelectorAll("button")].find((b) => b.textContent === "Table");
		t = performance.now();
		table.click();
		settle();
		out.rerender = ms(t);
		t = performance.now();
		window.dispatchEvent(new Event("beforeprint"));
		settle();
		out.print = ms(t);
		t = performance.now();
		document.querySelector(".an-toggle").click();
		settle();
		out.openAn = ms(t);
		const moves = document.querySelectorAll(".an-wb-line")[0].querySelectorAll(".an-move");
		moves[moves.length - 1].click();
		const N = 5;
		t = performance.now();
		for (let i = 0; i < N; i++) {
			key("ArrowLeft");
			settle();
		}
		for (let i = 0; i < N; i++) {
			key("ArrowRight");
			settle();
		}
		out.step = ((performance.now() - t) / (2 * N)).toFixed(1);
		t = performance.now();
		document.querySelector(".an-overlay").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
		settle();
		out.closeAn = ms(t);
		return out;
	}, pgn);
	rows.push({ vars, ...r });
	console.log(cols.map((c) => String({ vars, ...r }[c]).padStart(9)).join(""));
}
await browser.close();
server.close();

console.log(
	"(Chromium, ms. dom: elements after load. print: building the print view on" +
		" beforeprint. step: mean per arrow key on the analysis board.)",
);
