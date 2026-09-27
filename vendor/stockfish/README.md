# Stockfish 19 — WebAssembly builds

Unmodified files from the [`stockfish`](https://www.npmjs.com/package/stockfish)
npm package, version 19.0.0 (Stockfish.js by Nathan Rugg / Chess.com, built from
[Stockfish](https://github.com/official-stockfish/Stockfish)):

- `stockfish-19-lite-single.js` + `stockfish-19-lite-single.wasm` — the lite
  build (small network), served with the app. The default.
- `stockfish-19-single.js` — the loader for the full build. Its 99 MB
  `stockfish-19-single.wasm` is **not** in the repository: the app downloads it
  on request from an npm mirror (unpkg, then jsDelivr), or takes a copy the user
  downloaded, and keeps it in the browser's IndexedDB. The loader is handed the
  stored file as a `blob:` URL in its hash (`src/engine.js`, `fullWorker`).

Licensed under the GNU General Public License v3 — see `COPYING.txt`. Source:
<https://github.com/nmrugg/stockfish.js> and
<https://github.com/official-stockfish/Stockfish>.

The app runs the engine as a separate program in a Web Worker and talks to it
only over the UCI text protocol. Single-threaded builds are used because they
need no cross-origin-isolation headers, which GitHub Pages cannot send.

To update: `npm pack stockfish@<version>`, copy `bin/*-lite-single.*` and
`bin/*-single.js` here, and update the version above, the worker names in
`src/engine.js`, and `FULL` (file name, size, URLs) in `src/engine-store.js`.
