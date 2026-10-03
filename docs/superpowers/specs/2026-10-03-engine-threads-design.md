# Multi-threaded engine

## Goal

Let Stockfish search on several threads, with the count chosen by the viewer.

## Constraint

Stockfish's threaded WebAssembly builds share memory between threads
(`SharedArrayBuffer`), which browsers allow only on a cross-origin isolated
page: one served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. GitHub Pages cannot send custom
headers.

## Design

- **Isolation.** `sw.js`, a service worker at the site root, re-serves every
  same-origin response with the two headers. Cross-origin loads (esm.sh,
  unpkg, jsDelivr) are CORS requests that already satisfy `require-corp` and
  are left alone. `require-corp` rather than `credentialless`, which Safari
  lacks. index.html registers the worker and reloads once when it first takes
  control; a session flag stops a reload loop where isolation still fails.
  The dev server stays byte-for-byte what Pages serves.
- **Builds.** `threadsAvailable()` (isolated and `SharedArrayBuffer` present)
  picks `stockfish-19-lite.js` / `stockfish-19.js` over the `-single` ones.
  Isolation is fixed for a page's life, so the choice is made once.
- **Full engine.** The threaded full build needs its own 99 MB `.wasm`
  (`stockfish-19.wasm`, own SHA-256). `engine-store.js` picks the build for
  the page; storing one deletes the other so a browser never holds both.
- **Thread count.** `setoption name Threads value N` after `uciok`, and on
  change (the running search is stopped, the option sent, the search
  restarted; the cache stands, since more threads find the same results
  faster). Offered from 1 to `navigator.hardwareConcurrency`; starts at
  `min(4, cores - 1)`; remembered in `prefs.js` as `engineThreads`.
- **UI.** A "N threads" select in the engine's settings row, shown only when
  the threaded build runs on more than one core. The build picker's options
  became "Lite" / "Full" so the row still fits a phone held upright.

## Fallback

No service worker (blocked, some private windows) or no isolation: the
single-threaded builds run as before and no thread picker is shown.
