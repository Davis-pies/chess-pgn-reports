# Stockfish 19 — WebAssembly builds

Unmodified files from the [`stockfish`](https://www.npmjs.com/package/stockfish)
npm package, version 19.0.0 (Stockfish.js by Nathan Rugg / Chess.com, built from
[Stockfish](https://github.com/official-stockfish/Stockfish)):

- `stockfish-19-lite.js` + `stockfish-19-lite.wasm` — the multi-threaded lite
  build (small network), served with the app. The default.
- `stockfish-19-lite-single.js` + `stockfish-19-lite-single.wasm` — the same,
  single-threaded, for a page that is not cross-origin isolated.
- `stockfish-19.js` and `stockfish-19-single.js` — the loaders for the full
  build, multi- and single-threaded. Their 99 MB `.wasm` files are **not** in
  the repository: the app downloads the one it needs on request from an npm
  mirror (unpkg, then jsDelivr), or takes a copy the user downloaded, and keeps
  it in the browser's IndexedDB. The loader is handed the stored file as a
  `blob:` URL in its hash (`src/engine.js`, `fullWorker`), and passes it on to
  the threads it starts.

Licensed under the GNU General Public License v3 — see `COPYING.txt`. Source:
<https://github.com/nmrugg/stockfish.js> and
<https://github.com/official-stockfish/Stockfish>.

The app runs the engine as a separate program in a Web Worker and talks to it
only over the UCI text protocol. The multi-threaded builds need
`SharedArrayBuffer`, which browsers allow only on a cross-origin isolated
page. GitHub Pages cannot send the COOP/COEP headers for that, so `sw.js` (a
service worker at the site root) adds them; where it cannot run, the
single-threaded builds are used.

To update: `npm pack stockfish@<version>`, copy `bin/*-lite.*`, `bin/*-lite-single.*`,
`bin/stockfish-<version>.js` and `bin/*-single.js` here, and update the version above, the worker names in
`src/engine.js`, and `FULL` (file name, size, URLs) in `src/engine-store.js`.
