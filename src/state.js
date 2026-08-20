// Shared mutable state read and written by app.js and the extracted view
// modules (print.js, trie-view.js, line-editor.js, export.js).
//
// `current` is reassigned WHOLESALE (not mutated in place) by freshState()
// in app.js -- every "start over" path builds a brand new object and swaps
// it in. A module that did `import { current } from "./state.js"` would
// still see that reassignment (ES module bindings are live references), but
// using explicit get/set functions instead makes that intent unambiguous
// and sidesteps any doubt about binding timing across the circular imports
// this refactor introduces (app.js imports view-building functions from
// these modules, and those modules import state back from here / call back
// into app.js for re-renders). `sharedInfo` is reassigned the same way, for
// the same reason.
let current = null;
export function getCurrent() {
	return current;
}
export function setCurrent(v) {
	current = v;
	return current;
}

// Trie groups the user expanded in the markup (line editor) panel — details
// open state survives re-renders. Mutated in place (add/delete/clear), so a
// plain shared reference is fine.
export const openPaths = new Set();

// Trie groups the user expanded in the TABLE preview — separate from the
// editor's openPaths: expanding a table branch does not expand the editor.
export const openTablePaths = new Set();

// Identical-move tracking: which lines carry each shared move (same
// position reached + same SAN). Recomputed wholesale by computeShared() in
// app.js before every render — { byLine: line -> Map(ply -> id), idLines:
// id -> [lines] }.
let sharedInfo = {};
export function getSharedInfo() {
	return sharedInfo;
}
export function setSharedInfo(v) {
	sharedInfo = v;
	return sharedInfo;
}

// Render callbacks owned by app.js (renderApp/rerenderTable/rerenderMarkup
// close over app.js's own module-level `tableBox`/`markupBox`; lineEditor is
// seam 3, not yet extracted). The extracted view modules call back into
// app.js through this registry instead of a static `import ... from
// "./app.js"`.
//
// Why this matters: app.js is a normal ES module, cached by resolved URL --
// but the test suite deliberately re-imports it with a cache-busting query
// string per test (`"../src/app.js?t=2"`, etc.) to get fresh module-level
// state for each test. A seam module's static `import { rerenderTable }
// from "./app.js"` resolves once, the first time that (singleton) seam
// module is loaded, and keeps pointing at THAT app.js instance forever --
// so a later test's clicks would silently rerender into a previous test's
// (detached) DOM. Routing the call through a registry that app.js
// re-populates every time its own module body runs (see the
// setRenderHooks() call near the top of app.js) keeps it pointed at
// whichever app.js instance is actually live.
let renderHooks = {};
export function getRenderHooks() {
	return renderHooks;
}
export function setRenderHooks(h) {
	renderHooks = h;
	return renderHooks;
}
