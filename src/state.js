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
