# Stockfish 18 (lite, single-threaded) — WebAssembly build

Unmodified files from the [`stockfish`](https://www.npmjs.com/package/stockfish)
npm package, version 18.0.8 (Stockfish.js by Nathan Rugg / Chess.com, built from
[Stockfish](https://github.com/official-stockfish/Stockfish)):

- `stockfish-18-lite-single.js`
- `stockfish-18-lite-single.wasm`

Licensed under the GNU General Public License v3 — see `COPYING.txt`. Source:
<https://github.com/nmrugg/stockfish.js> and
<https://github.com/official-stockfish/Stockfish>.

The app runs it as a separate program in a Web Worker and talks to it only
over the UCI text protocol (`src/engine.js`). The single-threaded build is used
because it needs no cross-origin-isolation headers, which GitHub Pages cannot
send.

To update: `npm pack stockfish@<version>`, copy the two `bin/*-lite-single.*`
files here, and update the version above.
