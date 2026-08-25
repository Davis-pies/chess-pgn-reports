import { test, after } from "node:test";
import assert from "node:assert";
import { saveNotebook } from "../src/store.js";
import { bootApp } from "./helpers.mjs";
import { getCurrent, getRenderHooks } from "../src/state.js";

// One app.js instance for the whole file. Each test calls app.reset() to get
// back to the import panel with clean storage. See bootApp's note on why the
// tests must NOT re-import app.js with a cache-busting query string.
const app = await bootApp();
const dom = app.dom;
const alerts = app.alerts;
after(() => app.teardown());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait for a condition instead of guessing a duration. `withLoading` awaits a
// double requestAnimationFrame (~32ms of jsdom frames) *before* running the
// synchronous parse+render, so a fixed delay races the machine: it fits on an
// idle laptop and misses on a loaded CI runner.
const waitFor = async (pred, label, timeout = 5000) => {
	const deadline = Date.now() + timeout;
	while (!pred()) {
		if (Date.now() > deadline)
			throw new Error(`waitFor timed out after ${timeout}ms: ${label}`);
		await sleep(5);
	}
};

// Settle the UI: the loading overlay is present for exactly as long as
// `withLoading` is in flight, so its absence is the "render finished" signal.
const tick = async () => {
	await sleep(5);
	await waitFor(() => !document.getElementById("loading"), "loading overlay");
	await sleep(5);
};

test("full app flow: import PGN, tag a line, render table preview", async () => {
	app.reset();

	let view = doc("view");
	const textarea = view.querySelector("textarea.pgnin");
	assert.ok(textarea, "import panel shown");
	textarea.value = "1. e4 e5 (1... c5 2. Nf3 Nc6) 2. Nf3 Nc6";
	const loadBtn = [...view.querySelectorAll("button")].find((b) =>
		b.textContent.includes("Load"),
	);
	loadBtn.click();
	assert.ok(doc("loading"), "loading overlay appears synchronously on click");
	await tick();
	assert.ok(!doc("loading"), "overlay removed after render");

	// default layout is horizontal; switch to vertical so the tag badge shows
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent === "Vertical")
		.click();
	view = doc("view");
	// Now in labeling view: line editors + a live table preview
	assert.ok(view.querySelector(".markup"), "tagging panel present");
	assert.ok(view.querySelector("table.tbl"), "table preview rendered");
	// main + 1 variation -> 2 line editors
	const editors = view.querySelectorAll(".ledge");
	assert.strictEqual(editors.length, 2);
	// tag the second line as sideline
	const secondRow = editors[1];
	const sidelineBtn = [...secondRow.querySelectorAll("button")].find(
		(b) => b.textContent === "Sideline",
	);
	sidelineBtn.click();
	// a single sideline is ONE line — rendered as a plain row, always visible
	const preview = doc("view").querySelector(".pv-table");
	assert.ok(
		preview.textContent.toLowerCase().includes("sideline"),
		"sideline tag appears in table",
	);

});

test("inline boards: flat shows one per line; grouped shows only expanded groups", async () => {
	app.reset();

	// cache-busted import starts with fresh state (empty lines), so we're at
	// the import panel already — no reset needed
	const textarea = doc("view").querySelector("textarea.pgnin");
	// 3 lines: mainline + 2 variations that share a divergence fork at ply 2
	// both start 1... c5 2. Nf3 and then split into Nc6 / Nf6
	textarea.value = "1. e4 e5 (1... c5 2. Nf3 Nc6) (1... c5 2. Nf3 Nf6) 2. Nf3";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();
	// enable inline boards via the "Board diagrams" checkbox
	const label = [...doc("view").querySelectorAll("label")].find((l) =>
		l.textContent.includes("Board diagrams"),
	);
	label.querySelector("input").click();

	// grouped view is the default; the fork group starts collapsed
	assert.strictEqual(
		doc("view").querySelectorAll(".ledge-board").length,
		1,
		"only the mainline board shows while groups are collapsed",
	);

	// expand the fork group: its lone-line children are themselves collapsed,
	// so no new boards yet — expanding the line reveals its editor/board
	const fork = doc("view").querySelector(".markup details.lgroup");
	fork.open = true;
	fork.dispatchEvent(new dom.window.Event("toggle"));
	assert.strictEqual(
		doc("view").querySelectorAll(".ledge-board").length,
		1,
		"lone-line children stay collapsed: no boards until each is expanded",
	);

	// expand the first lone-line child: its editor + board appear (scoped
	// query — jsdom's document-wide querySelector skips <details> content)
	const fork2 = doc("view").querySelector(".markup details.lgroup");
	const leaf = fork2.querySelector(".lgroup-body > details.lgroup");
	assert.ok(leaf, "lone-line child rendered under the fork");
	leaf.open = true;
	leaf.dispatchEvent(new dom.window.Event("toggle"));
	const leaf2 = doc("view")
		.querySelector(".markup details.lgroup")
		.querySelector(".lgroup-body > details.lgroup");
	assert.strictEqual(
		leaf2.querySelectorAll(".ledge-board").length,
		1,
		"expanding a lone line shows its board",
	);

	// flat view shows a board for every line
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent === "Flat")
		.click();
	assert.strictEqual(doc("view").querySelectorAll(".ledge-board").length, 3);

});

test("lone-line editor groups are collapsible details, closed by default", async () => {
	app.reset();

	// one variation = one lone line in the trie (no fork)
	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value = "1. e4 e5 (1... c5 2. Nf3) 2. Nf3";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	const det = doc("view").querySelector(".markup details.lgroup");
	assert.ok(det, "lone line renders as a details group");
	assert.strictEqual(det.open, false, "collapsed by default");
	assert.ok(det.querySelector("summary").textContent.includes("1 line"));

	// expanding reveals the line editor
	det.open = true;
	det.dispatchEvent(new dom.window.Event("toggle"));
	const det2 = doc("view").querySelector(".markup details.lgroup");
	assert.ok(det2.open, "expanded after toggle");
	assert.ok(det2.querySelector(".ledge"), "line editor present when open");

});

test("print table: split-by-trie checkbox toggles per-branch tables", async () => {
	app.reset();

	const textarea = doc("view").querySelector("textarea.pgnin");
	// two variations with DIFFERENT first moves = two top-level branches
	textarea.value = "1. e4 e5 (1... c5 2. Nf3) (1... e6 2. d4) 2. Nf3";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	// default: split off, fits -> one print table
	assert.strictEqual(
		doc("view").querySelectorAll(".pv-htable table.tbl").length,
		1,
		"one table when split-by-trie is off",
	);

	const lab = [...doc("view").querySelectorAll("label")].find((l) =>
		l.textContent.includes("split table by trie"),
	);
	lab.querySelector("input").click();

	// split ON still packs tiny branches into ONE shared table (no per-branch
	// tables for single-line tries) — compactness over per-branch sections
	assert.strictEqual(
		doc("view").querySelectorAll(".pv-htable table.tbl").length,
		1,
		"single-line branches pack into one table even with split on",
	);

});

test("print table: wide notebooks pack into multiple tables, oversized forks chunk at sub-forks", async () => {
	app.reset();

	// 16 variations share 1... c5 2. Nf3 Nc6 and fork at white's 3rd move:
	// one top-level branch of 16 lines — over the 15-line cap
	const thirds = [
		"Bb5",
		"Bc4",
		"Be2",
		"d4",
		"d3",
		"c3",
		"a3",
		"b3",
		"g3",
		"h3",
		"a4",
		"b4",
		"c4",
		"Na3",
		"Nc3",
		"Qe2",
	];
	const pgn =
		"1. e4 e5 " +
		thirds.map((t) => `(1... c5 2. Nf3 Nc6 3. ${t})`).join(" ") +
		" 2. Nf3";
	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value = pgn;
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	// >15 lines: the wide branch is cut at its sub-forks into multiple tables,
	// each at most 16 columns (mainline + 15)
	const tables = doc("view").querySelectorAll(".pv-htable table.tbl");
	assert.ok(tables.length >= 2, "wide notebook splits into multiple tables");
	[...tables].forEach((t) =>
		assert.ok(
			t.querySelectorAll("tr:first-child th").length <= 15,
			"each printed table stays within ply + mainline + 13 lines",
		),
	);

});

test("table preview: mainline always visible, branches collapsed by default", async () => {
	app.reset();

	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value =
		"1. e4 e5 (1... c5 2. Nf3 Nc6) (1... c5 2. Nf3 Nf6) (1... e6 2. d4) 2. Nf3";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	const pv = doc("view").querySelector(".pv-table");
	// ONE single table
	assert.strictEqual(pv.querySelectorAll("table.tbl").length, 1, "one table");
	// header: ply | mainline | collapsed fork | single-line branch = 4 columns
	const headers = pv.querySelectorAll("table.tbl tr:first-child th");
	assert.strictEqual(headers.length, 4, "ply + mainline + fork + single line");
	// only the FORK is collapsible; the single-line branch is a plain column
	assert.strictEqual(
		pv.querySelectorAll("table.tbl th.clickable.collapsed").length,
		1,
		"only the multi-line fork starts collapsed",
	);
	assert.strictEqual(
		pv.querySelectorAll("table.tbl th.clickable").length,
		1,
		"single-line branch is a plain column (no collapse affordance)",
	);
	const mainTh = headers[1];
	assert.ok(
		!mainTh.classList.contains("clickable"),
		"mainline column is always visible (not collapsible)",
	);
	// a collapsed branch column holds its shared continuation moves
	assert.ok(
		pv.querySelectorAll("td.collapsed").length > 0,
		"collapsed branch shows shared moves",
	);

	// expand the fork by clicking its header
	const fork = pv.querySelector("table.tbl th.clickable.collapsed");
	fork.click();
	const pv2 = doc("view").querySelector(".pv-table");
	assert.strictEqual(
		pv2.querySelectorAll("table.tbl th.clickable.collapsed").length,
		0,
		"fork expanded",
	);
	assert.strictEqual(
		pv2.querySelectorAll("table.tbl th.clickable:not(.collapsed)").length,
		2,
		"fork's two line headers are clickable (to collapse)",
	);

	// clicking an expanded line collapses the fork again
	pv2.querySelector("table.tbl th.clickable:not(.collapsed)").click();
	assert.strictEqual(
		doc("view").querySelectorAll(".pv-table th.clickable.collapsed").length,
		1,
		"clicking an expanded line collapses its branch",
	);

	// expand all
	[...doc("view").querySelectorAll(".pv-table button")]
		.find((b) => b.textContent === "Expand all")
		.click();
	assert.strictEqual(
		doc("view").querySelectorAll(".pv-table th.clickable.collapsed").length,
		0,
		"expand all expands the fork",
	);

	// collapse all
	[...doc("view").querySelectorAll(".pv-table button")]
		.find((b) => b.textContent === "Collapse all")
		.click();
	assert.strictEqual(
		doc("view").querySelectorAll(".pv-table th.clickable.collapsed").length,
		1,
		"collapse all collapses the fork",
	);

});

test("table preview: rows span only visible columns, no trailing empty rows", async () => {
	app.reset();

	// a forking branch whose lines reach ply 4 while the mainline stops at ply 2
	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value =
		"1. e4 e5 (1... c5 2. Nf3 Nc6 3. Bb5) (1... c5 2. Nf3 Nc6 3. a4) 2. Nf3";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	// collapsed: rows span the deepest VISIBLE column (shared moves end at ply 3)
	const rows = doc("view").querySelectorAll(".pv-table table.tbl tr");
	assert.strictEqual(
		rows.length,
		5,
		"collapsed branch does not stretch rows to the hidden deep plies (header + ply 0..3)",
	);

	// expand the branch: rows extend to the deepest line (ply 4)
	doc("view").querySelector(".pv-table th.clickable.collapsed").click();
	const rows2 = doc("view").querySelectorAll(".pv-table table.tbl tr");
	assert.strictEqual(
		rows2.length,
		6,
		"expanded branch extends rows to its deepest ply (header + ply 0..4)",
	);

});

test("deleting one saved workbook removes only its row, not the whole list", async () => {
	app.reset();
	// pre-seed two saved notebooks directly via store.js (avoids a
	// same-millisecond id collision that saving twice through the UI could
	// hit), then load and leave a notebook so "New / Import" re-renders the
	// import panel with both already listed
	const lineFor = (san) => [{ isMain: true, moves: [{ san, ply: 0 }] }];
	await app.loadPgn("1. e4 e5");
	saveNotebook("bookA", { name: "Book A", pgn: "1. e4", lines: lineFor("e4") });
	saveNotebook("bookB", { name: "Book B", pgn: "1. d4", lines: lineFor("d4") });
	app.clickText("New / Import");

	let box = doc("view").querySelector(".notebooks");
	assert.ok(box, "notebooks panel present");
	assert.ok(box.querySelector(".nb-head"), "header present before delete");

	const rowA = [...box.querySelectorAll("span")].find((s) =>
		s.textContent.includes("Book A"),
	);
	assert.ok(rowA, "Book A row present");
	const delA = [...rowA.querySelectorAll("button")].find(
		(b) => b.textContent === "✕",
	);
	delA.click();

	box = doc("view").querySelector(".notebooks");
	assert.ok(box, "notebooks panel still present after deleting one entry");
	assert.ok(
		box.querySelector(".nb-head"),
		"header still present — the whole list wasn't wiped",
	);
	assert.ok(
		[...box.querySelectorAll("span")].some((s) =>
			s.textContent.includes("Book B"),
		),
		"the untouched workbook's row is still visible",
	);
	assert.ok(
		![...box.querySelectorAll("span")].some((s) =>
			s.textContent.includes("Book A"),
		),
		"the deleted workbook's row is gone",
	);

});

test("Save surfaces a storage failure instead of silently losing the notebook", async () => {
	app.reset();

	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value = "1. e4 e5";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	// jsdom's Storage writes any property assignment through to the backing
	// store (named-property setter per the WebStorage spec), so a plain
	// `localStorage.setItem = fn` silently no-ops instead of overriding the
	// method — stub it on the prototype instead.
	const proto = Object.getPrototypeOf(global.localStorage);
	const origSetItem = proto.setItem;
	proto.setItem = () => {
		throw new Error("QuotaExceededError");
	};
	try {
		const saveBtn = [...doc("view").querySelectorAll("button")].find(
			(b) => b.textContent === "Save",
		);
		saveBtn.click();
		assert.strictEqual(alerts.length, 1, "failure is surfaced via alert");
		assert.notStrictEqual(
			saveBtn.textContent,
			"Saved ✓",
			"button does not falsely claim success",
		);
	} finally {
		proto.setItem = origSetItem;
	}

});

test("opening a saved notebook carries forward the dragged side panel width", async () => {
	app.reset();

	const textarea = doc("view").querySelector("textarea.pgnin");
	textarea.value = "1. e4 e5";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	const nameInput = doc("view").querySelector("input.name");
	nameInput.value = "Book A";
	nameInput.dispatchEvent(new dom.window.Event("input"));
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent === "Save")
		.click();

	// drag the side-resize handle to a non-default width
	const handle = doc("view").querySelector(".side-resize");
	handle.dispatchEvent(new dom.window.Event("mousedown"));
	dom.window.document.dispatchEvent(
		new dom.window.MouseEvent("mousemove", { clientX: 555 }),
	);
	dom.window.document.dispatchEvent(new dom.window.MouseEvent("mouseup"));
	assert.strictEqual(
		dom.window.document.documentElement.style.getPropertyValue("--side-w"),
		"555px",
		"drag applied",
	);

	// back to the import panel, then reopen the notebook we just saved
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent === "New / Import")
		.click();
	const openBtn = [...doc("view").querySelectorAll("button")].find((b) =>
		b.textContent.includes("Open: Book A"),
	);
	assert.ok(openBtn, "saved notebook listed");
	openBtn.click();
	await tick();

	assert.strictEqual(
		dom.window.document.documentElement.style.getPropertyValue("--side-w"),
		"555px",
		"the dragged side panel width survives opening a saved notebook",
	);

});

// A note carried by several lines (either from identical PGN comment text, or
// written across a shared-position group by the note editor) is ONE note. The
// printed Notes list must show it once, not once per line carrying it.
test("print notes: a note shared by several lines is listed once", async () => {
	app.reset();

	const textarea = doc("view").querySelector("textarea.pgnin");
	// both variations carry the identical comment at the same ply -> one note
	textarea.value =
		"1. e4 e5 2. Nf3 (2. Bc4 Nc6 {tricky bishop}) (2. d4 exd4 {tricky bishop}) Nc6";
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	const boxes = [...global.document.querySelectorAll(".print-notes")];
	const tables = [...global.document.querySelectorAll(".pv-htable table.tbl")];
	const rows = [...global.document.querySelectorAll(".print-notes .nt")];
	assert.strictEqual(
		rows.length,
		1,
		`one row per distinct note, not one per line carrying it. ` +
			`boxes=${boxes.length} tables=${tables.length} rows=${rows.length} ` +
			`texts=${JSON.stringify(rows.map((r) => r.textContent))}`,
	);

});

const GROUP_PGN = "1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) 2. Nf3";

async function loadGroupPgn() {
	app.reset();
	const view = doc("view");
	view.querySelector("textarea.pgnin").value = GROUP_PGN;
	[...view.querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();
}

test("the group Footnote chip tags every line under the group", async () => {
	await loadGroupPgn();

	const group = doc("view").querySelector(".markup details.lgroup");
	const chip = group.querySelector("summary .chip.groupfoot");
	assert.ok(chip, "group summary carries a Footnote chip");
	assert.ok(!chip.className.includes("on"), "off to start");

	chip.click();
	await tick();
	const after = doc("view").querySelector(".markup details.lgroup");
	assert.ok(
		after.querySelector("summary .chip.groupfoot").className.includes("on"),
		"chip reads on once every line is tagged",
	);
	assert.strictEqual(
		doc("view").querySelectorAll(".notes .nt").length,
		1,
		"the group renders as one note",
	);

	after.querySelector("summary .chip.groupfoot").click();
	await tick();
	assert.ok(
		!doc("view")
			.querySelector(".markup details.lgroup summary .chip.groupfoot")
			.className.includes("on"),
		"clicking again clears the whole group",
	);
});

test("the group chip reads partial when only some lines are footnotes", async () => {
	await loadGroupPgn();
	const lines = getCurrent().lines.filter((l) => !l.isMain);
	lines[0].tag = "foot";
	getRenderHooks().renderApp();
	await tick();
	const chip = doc("view").querySelector(
		".markup details.lgroup summary .chip.groupfoot",
	);
	assert.ok(chip.className.includes("partial"), "dimmed, not on");
	assert.ok(!chip.className.includes("on"));
});

test("clicking the group chip does not toggle the group open or shut", async () => {
	await loadGroupPgn();
	const before = doc("view").querySelector(".markup details.lgroup").open;
	doc("view").querySelector(".markup summary .chip.groupfoot").click();
	await tick();
	assert.strictEqual(
		doc("view").querySelector(".markup details.lgroup").open,
		before,
		"the summary's default toggle is suppressed",
	);
});

test("a collapsed one-line group carries the chips without expanding", async () => {
	app.reset();
	const view = doc("view");
	view.querySelector("textarea.pgnin").value =
		"1. e4 e5 (1... c5 2. Nf3) 2. Nf3";
	[...view.querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();
	const group = doc("view").querySelector(".markup details.lgroup");
	assert.ok(group, "a group is rendered for the lone line");
	assert.strictEqual(group.open, false, "still collapsed");
	["groupfoot", "grouphide", "groupsolo"].forEach((cls) =>
		assert.ok(
			group.querySelector("summary .chip." + cls),
			cls + " is reachable without expanding",
		),
	);
});

test("a one-line group's chips act on its single line", async () => {
	app.reset();
	const view = doc("view");
	view.querySelector("textarea.pgnin").value =
		"1. e4 e5 (1... c5 2. Nf3) 2. Nf3";
	[...view.querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();
	const line = getCurrent().lines.find((l) => !l.isMain);

	doc("view")
		.querySelector(".markup details.lgroup summary .chip.groupfoot")
		.click();
	await tick();
	assert.strictEqual(line.tag, "foot", "the Footnote chip tagged the line");

	doc("view")
		.querySelector(".markup details.lgroup summary .chip.grouphide")
		.click();
	await tick();
	assert.strictEqual(line.hidden, true, "the Hide chip hid the line");
	assert.ok(
		doc("view").querySelector(".hidden-drawer"),
		"and it moved into the drawer",
	);
});

function doc(id) {
	return global.document.getElementById(id);
}

// Hidden lines must KEEP receiving notes added at a shared move: computeShared
// is deliberately NOT filtered (see the spec's decisions section). This guard
// fails loudly if someone later filters it.
test("a note added at a shared move still reaches a hidden line", async () => {
	await loadGroupPgn();
	const hidden = getCurrent().lines.find((l) =>
		l.moves.some((m) => m.san === "Nc3"),
	);
	hidden.hidden = true;
	getRenderHooks().renderApp();
	await tick();

	// select the shared 1... c5 move on the line that is still visible
	const chip = [
		...doc("view").querySelectorAll(".markup .ledge .move-chip"),
	].find((b) => b.textContent.includes("c5"));
	assert.ok(chip, "a shared c5 move chip is present");
	chip.click();
	await tick();

	const box = doc("view").querySelector(".markup .cedit");
	assert.ok(box, "the comment editor opened");
	box.querySelector("input.lno").value = "shared idea";
	[...box.querySelectorAll("button")]
		.find((b) => b.textContent === "Add note")
		.click();
	await tick();

	assert.ok(
		(hidden.comments || []).some((c) => c.text === "shared idea"),
		"the hidden line received the shared note",
	);
});

test("the group Hide chip hides every line under the group", async () => {
	await loadGroupPgn();
	const chip = doc("view").querySelector(
		".markup details.lgroup summary .chip.grouphide",
	);
	assert.ok(chip, "group summary carries a Hide chip");
	assert.ok(!chip.className.includes("on"), "off to start");

	chip.click();
	await tick();
	assert.strictEqual(
		getCurrent().lines.filter((l) => l.hidden).length,
		2,
		"both lines under the group are hidden",
	);
});

test("the drawer's group Hide chip brings a whole group back", async () => {
	await loadGroupPgn();
	doc("view")
		.querySelector(".markup details.lgroup summary .chip.grouphide")
		.click();
	await tick();
	assert.strictEqual(getCurrent().lines.filter((l) => l.hidden).length, 2);

	// in the drawer the same chip reads "Hidden" and restores the group
	const chip = doc("view").querySelector(
		".hidden-drawer details.lgroup summary .chip.grouphide",
	);
	assert.ok(chip, "the drawer's group carries the chip");
	assert.ok(chip.className.includes("on"), "it reads on for a hidden group");
	chip.click();
	await tick();
	assert.strictEqual(getCurrent().lines.filter((l) => l.hidden).length, 0);
});

test("group Focus hides every line outside the group", async () => {
	app.reset();
	const view = doc("view");
	view.querySelector("textarea.pgnin").value =
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... e6) 2. Nf3";
	[...view.querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	doc("view")
		.querySelector(".markup details.lgroup summary .chip.groupsolo")
		.click();
	await tick();
	const gone = getCurrent().lines.find((l) =>
		l.moves.some((m) => m.san === "e6"),
	);
	assert.strictEqual(gone.hidden, true, "the line outside the group is hidden");
});

test("a hidden line leaves the editor list and enters the drawer", async () => {
	await loadGroupPgn();
	const before = doc("view").querySelectorAll(".markup .ledge").length;
	const gone = getCurrent().lines.find((l) =>
		l.moves.some((m) => m.san === "Nc3"),
	);
	gone.hidden = true;
	getRenderHooks().renderApp();
	await tick();

	const drawer = doc("view").querySelector(".hidden-drawer");
	assert.ok(drawer, "the drawer appears once something is hidden");
	assert.strictEqual(drawer.querySelector("summary").textContent, "Hidden (1)");
	assert.strictEqual(
		doc("view").querySelectorAll(".markup .ledge").length -
			drawer.querySelectorAll(".ledge").length,
		before - 1,
		"the hidden line is gone from the editor list itself",
	);
});

test("no drawer when nothing is hidden", async () => {
	await loadGroupPgn();
	assert.strictEqual(doc("view").querySelector(".hidden-drawer"), null);
});

test("the drawer's Show all brings every hidden line back", async () => {
	await loadGroupPgn();
	getCurrent().lines.forEach((l) => {
		if (!l.isMain) l.hidden = true;
	});
	getRenderHooks().renderApp();
	await tick();

	[...doc("view").querySelectorAll(".hidden-drawer button")]
		.find((b) => b.textContent === "Show all")
		.click();
	await tick();
	assert.strictEqual(getCurrent().lines.filter((l) => l.hidden).length, 0);
	assert.strictEqual(doc("view").querySelector(".hidden-drawer"), null);
});

test("the flat view also drops hidden lines", async () => {
	await loadGroupPgn();
	[...doc("view").querySelectorAll("button")]
		.find((b) => b.textContent === "Flat")
		.click();
	await tick();
	const before = doc("view").querySelectorAll(".markup > .ledge").length;
	const gone = getCurrent().lines.find((l) =>
		l.moves.some((m) => m.san === "Nc3"),
	);
	gone.hidden = true;
	getRenderHooks().renderApp();
	await tick();
	assert.strictEqual(
		doc("view").querySelectorAll(".markup > .ledge").length,
		before - 1,
	);
});

test("opening a drawer group does not open its twin in the editor", async () => {
	// two c5 lines hidden and one c5 line left visible, so the SAME trie key
	// exists in the editor and in the drawer at once
	app.reset();
	const view = doc("view");
	view.querySelector("textarea.pgnin").value =
		"1. e4 e5 (1... c5 2. Nf3) (1... c5 2. Nc3) (1... c5 2. d4) 2. Nf3";
	[...view.querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	getCurrent()
		.lines.filter((l) =>
			l.moves.some((m) => m.san === "Nc3" || m.san === "d4"),
		)
		.forEach((l) => (l.hidden = true));
	getRenderHooks().renderApp();
	await tick();

	const drawerGroup = doc("view").querySelector(
		".hidden-drawer details.lgroup",
	);
	assert.ok(drawerGroup, "the drawer groups its hidden lines");
	drawerGroup.open = true;
	drawerGroup.dispatchEvent(new dom.window.Event("toggle"));
	await tick();

	const editorGroups = [
		...doc("view").querySelectorAll(".markup details.lgroup"),
	].filter((d) => !d.closest(".hidden-drawer"));
	editorGroups.forEach((g) =>
		assert.ok(!g.open, "the editor's same-key group stayed closed"),
	);
});

test("Collapse all folds the live notes panel but leaves the section open", async () => {
	await loadGroupPgn();
	// tag the whole group so the notes panel has a group footnote to fold
	doc("view")
		.querySelector(".markup details.lgroup summary .chip.groupfoot")
		.click();
	await tick();

	const notes = () => doc("view").querySelector("details.notes");
	const chip = (txt) =>
		[...notes().querySelectorAll("summary .chip")].find(
			(b) => b.textContent === txt,
		);
	assert.ok(notes().open, "the section starts expanded");
	assert.ok(
		notes().querySelector("details.nt.ngroup").open,
		"so does the group note",
	);

	chip("Collapse all").click();
	assert.ok(notes().open, "the section itself stays open");
	assert.ok(
		[...notes().querySelectorAll("details")].every((d) => !d.open),
		"everything inside it folded",
	);
	assert.ok(chip("Expand all"), "the chips are still reachable");

	chip("Expand all").click();
	assert.ok(notes().open, "Expand all reopens the section");
	assert.ok(
		notes().querySelector("details.nt.ngroup").open,
		"and the group inside it",
	);
});

test("a folded note stays folded across an unrelated re-render", async () => {
	await loadGroupPgn();
	doc("view")
		.querySelector(".markup details.lgroup summary .chip.groupfoot")
		.click();
	await tick();

	const group = () => doc("view").querySelector("details.notes details.nt");
	group().open = false;
	await sleep(5); // <details> fires `toggle` asynchronously
	// rename a line — a full renderApp(), nothing to do with the notes panel
	const name = doc("view").querySelector(".markup .ledge input.ln");
	name.value = "Renamed";
	name.dispatchEvent(new dom.window.Event("change"));
	await tick();
	assert.strictEqual(group().open, false, "the fold survived the re-render");
});

// The parent group's own header text, so a Focus on one of its children can be
// checked to have left that level standing.
const NESTED_PGN =
	"1. e4 c5 2. Nf3 d6 " +
	"(2... Nc6 3. d4 cxd4 4. Nxd4 g6 " +
	"(4... e5 5. Nb5 d6 6. N1c3 a6) " +
	"(4... Nf6 5. Nc3 e5 6. Ndb5 d6) 5. c4 Bg7) " +
	"(2... e6 3. d4 cxd4 4. Nxd4 a6 5. Bd3) " +
	"3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6";

const groupNamed = (txt) =>
	[...doc("view").querySelectorAll(".markup details.lgroup")].find((d) =>
		d.querySelector("summary").firstChild.textContent.includes(txt),
	);

test("focusing a child group keeps its parent standing as a group", async () => {
	app.reset();
	const view = doc("view");
	view.querySelector("textarea.pgnin").value = NESTED_PGN;
	[...view.querySelectorAll("button")]
		.find((b) => b.textContent.includes("Load"))
		.click();
	await tick();

	const parent = groupNamed("4.Nxd4");
	assert.ok(parent, "the 2...Nc6 … 4.Nxd4 group is there to start");
	const child = [...parent.querySelectorAll("details.lgroup")].find((d) =>
		d.querySelector("summary").firstChild.textContent.includes("4...g6"),
	);
	assert.ok(child, "with 4...g6 nested inside it");

	child.querySelector("summary .chip.groupsolo").click();
	await tick();

	// the siblings and the 2...e6 branch are hidden — that part already worked
	const hidden = getCurrent().lines.filter((l) => l.hidden);
	assert.ok(
		hidden.some((l) => l.moves.some((m) => m.san === "e5")),
		"a sibling of the focused child is hidden",
	);
	assert.ok(
		hidden.some((l) => l.moves.some((m) => m.san === "Bd3")),
		"the unrelated 2...e6 branch is hidden",
	);

	// …and the parent is still its own level rather than merged into the child
	const after = groupNamed("4.Nxd4");
	assert.ok(after, "the parent group survives the focus");
	assert.ok(
		!after.querySelector("summary").firstChild.textContent.includes("4...g6"),
		"its header did not swallow the focused child",
	);
	assert.ok(
		[...after.querySelectorAll("details.lgroup")].some((d) =>
			d.querySelector("summary").firstChild.textContent.includes("4...g6"),
		),
		"the focused child is nested inside it",
	);
});
