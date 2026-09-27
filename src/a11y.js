// src/a11y.js
// Plumbing for keyboard and screen-reader users that more than one view needs.
//
// The app redraws by replacing whole subtrees (see renderApp), which is at
// odds with two things assistive technology relies on: a live region has to
// exist before its text changes for the change to be read out, and focus is
// lost with the element that had it. So the live region here lives outside the
// redrawn tree, and focus is carried across a redraw by a key that names the
// control rather than by the node itself.

// A polite live region, made once on the body and reused: text put in it is
// read out without moving focus. The same text twice in a row is still read,
// since stepping back and forward to one move is two announcements.
export function announce(text) {
	let r = document.getElementById("sr-live");
	if (!r) {
		r = document.createElement("div");
		r.id = "sr-live";
		r.className = "sr-only";
		r.setAttribute("role", "status");
		r.setAttribute("aria-live", "polite");
		document.body.appendChild(r);
	}
	r.textContent = r.textContent === text ? text + "\u00a0" : text;
}

// What to call a control so the same control can be found in a redrawn tree:
// its element and the class that says what it is, and which of those it is in
// `root`. Null for anything without such a class. The chips all start
// "chip mini", so the style classes are passed over for the one after them.
const STYLE = new Set(["chip", "mini", "primary", "on", "at", "active", "shared", "has-note"]);
export function focusKey(root, node) {
	if (!node || node === root || !root.contains(node)) return null;
	const cls = [...node.classList].find((c) => !STYLE.has(c));
	if (!cls || !/^[\w-]+$/.test(cls)) return null;
	const sel = node.tagName.toLowerCase() + "." + cls;
	return { sel, n: [...root.querySelectorAll(sel)].indexOf(node) };
}

// Focus the control a key names, if the redrawn tree still has one enabled.
// Returns whether it did.
export function restoreFocus(root, key) {
	if (!key) return false;
	const all = root.querySelectorAll(key.sel);
	const node = all[Math.min(key.n, all.length - 1)];
	if (!node || node.disabled) return false;
	node.focus();
	return true;
}

// Keep Tab and Shift+Tab inside a dialog: from the last control to the first
// and back, as a modal window should, so tabbing never wanders into the page
// behind it. Call from the dialog's keydown.
const TABBABLE =
	'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function trapTab(box, e) {
	if (e.key !== "Tab") return;
	const all = [...box.querySelectorAll(TABBABLE)].filter((n) => !n.hidden && !n.closest("[hidden]"));
	if (!all.length) return;
	const first = all[0];
	const last = all[all.length - 1];
	const at = document.activeElement;
	if (e.shiftKey && (at === first || !box.contains(at) || at === box)) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && (at === last || !box.contains(at))) {
		e.preventDefault();
		first.focus();
	}
}
