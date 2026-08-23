# Nested Footnote Sub-Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A footnote's own notes become lettered sub-notes nested under it, instead of peers of top-level notes in the global numbered list.

**Architecture:** `numberNotes` gains a pre-pass identifying which `(ply, text)` keys appear on at least one non-footnote line. A footnote line's comment whose key is in that set stays a global numbered note; a key exclusive to footnote lines becomes a lettered sub-note on that footnote's entry instead. Letters restart per footnote. Two new renderers in `render.js` emit the sub-note list (DOM and text), and the five consumers place it beneath their footnote.

**Tech Stack:** Vanilla ES modules, no framework. `node --test` with jsdom. `npm run lint` and `npm run knip` both gate CI.

**Spec:** `docs/superpowers/specs/2026-08-22-footnote-as-note-design.md` §4 (amended 2026-08-22)

**Conventions:** Indentation is per-file — `src/notes.js`, `src/render.js`, `src/table.js`, `src/line-editor.js` and their tests use **tabs**; `src/export.js`, `src/print.js`, `src/app.js` and their tests use **2 spaces**. Commit messages: imperative summary, no `feat:`/`fix:` prefixes, no trailers.

**Baseline:** master at `166ca0b`, 140/140 passing, lint and knip clean.

---

## Background for every task

This app turns a chess PGN into a printable opening theory table. Lines are taggable `sideline` or `foot`. A footnote is pulled out of the table and rendered as a numbered note in the single Notes list, anchored by an `[n]` marker on the mainline move it replaces.

Today a footnote's OWN notes (comments on its moves) are also top-level numbered entries in that same list, marked inline in the footnote's move text. That reads badly — `[3]` in the global list can be commentary on a move that only exists inside `[2]`.

`numberNotes(lines)` in `src/notes.js` returns `{entries, byLine}`. Entry kinds:
- ordinary note — `{ply, text, owner, n}`
- footnote — `{ply, owner, n, foot: {name, eval, note, moves, marks, noteByPly, d}}`, no `text`

Five consumers branch on `foot`: the on-screen notes panel (`notesPanel`, `src/export.js`), the print notes block (`renderTableNotes`, `src/print.js`), the Markdown export (`buildMarkdown`, `src/export.js`), the print cards (`renderCards`, `src/render.js`), and the editor's move chips (`moveStrip`, `src/line-editor.js`).

---

### Task 1: Lettered sub-notes in `numberNotes`

**Files:**
- Modify: `src/notes.js`
- Test: `tests/notes.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/notes.test.mjs`:

```js
test("a footnote's own note becomes a lettered sub-note, not a global entry", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const { entries } = numberNotes(s.lines);
	assert.strictEqual(entries.length, 1, "only the footnote is a global entry");
	const foot = entries[0].foot;
	assert.deepStrictEqual(
		foot.subNotes.map((x) => [x.label, x.text]),
		[["a", "knight move"]],
	);
	// and the marker inside the footnote's move text is the letter
	const ply = foot.subNotes[0].ply;
	assert.deepStrictEqual(foot.noteByPly[ply], ["a"]);
});

test("sub-note letters restart per footnote", () => {
	const s = loadState(
		"1. e4 e5 (1... c5 2. Nf3 {sicilian note}) (1... e6 2. d4 {french note}) 2. Nf3",
		{ tags: { 1: "foot", 2: "foot" } },
	);
	const feet = numberNotes(s.lines).entries.filter((e) => e.foot);
	assert.strictEqual(feet.length, 2);
	feet.forEach((f) =>
		assert.deepStrictEqual(
			f.foot.subNotes.map((x) => x.label),
			["a"],
			"each footnote starts its own lettering at a",
		),
	);
});

test("a note shared with a non-footnote line stays global", () => {
	const s = loadState("1. e4 e5 (1... c5 2. Nf3) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const foot = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	// the editor writes one note onto every line in an equal-position group, so
	// the same (ply,text) can sit on a footnote AND a sideline
	s.lines[0].comments = [{ ply: 2, text: "shared" }];
	foot.comments = [{ ply: 2, text: "shared" }];
	const { entries } = numberNotes(s.lines);
	const global = entries.filter((e) => !e.foot);
	assert.deepStrictEqual(
		global.map((e) => e.text),
		["shared"],
		"kept as one global numbered note",
	);
	const footEntry = entries.find((e) => e.foot);
	assert.deepStrictEqual(footEntry.foot.subNotes, [], "not lettered as well");
	assert.deepStrictEqual(
		footEntry.foot.noteByPly[2],
		[global[0].n],
		"the footnote references it by number",
	);
});

test("sub-notes leave the global list shorter and densely numbered", () => {
	const s = loadState(
		"1. e4 {opening} e5 (1... c5 2. Nf3 {inner}) 2. Nf3 {develops}",
		{ tags: { 1: "foot" } },
	);
	const { entries } = numberNotes(s.lines);
	// opening, develops, and the footnote itself — the inner note is NOT here
	assert.deepStrictEqual(
		entries.map((e) => e.n),
		[1, 2, 3],
	);
	assert.ok(
		!entries.some((e) => e.text === "inner"),
		"the footnote's own note left the global list",
	);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --test tests/notes.test.mjs`
Expected: FAIL — `subNotes` is undefined, and the inner note is still a global entry.

- [ ] **Step 3: Add the label helper**

Add near the top of `src/notes.js`, beside `anchorPly` (tabs):

```js
// Sub-note labels within one footnote: a, b, ... z, aa, ab, ... Bijective
// base-26, so a 27th sub-note doesn't run past 'z' into punctuation. This is
// the lettering the top-level Footnotes section used to have, reintroduced at
// a much smaller scope: it labels one footnote's own notes, not footnotes.
function subLabel(i) {
	let n = i + 1;
	let s = "";
	while (n > 0) {
		n--;
		s = String.fromCharCode(97 + (n % 26)) + s;
		n = Math.floor(n / 26);
	}
	return s;
}
```

- [ ] **Step 4: Add the shared-key pre-pass**

In `numberNotes`, above the `lines.forEach` loop:

```js
	// A note the editor shared onto a non-footnote line stays a global numbered
	// note; only notes living exclusively on footnote lines become a footnote's
	// own lettered sub-notes. Computed up front because a footnote line can be
	// visited before the sideline that shares its note.
	const isFoot = (l) => !l.isMain && l.tag === "foot";
	const globalKeys = new Set();
	lines.forEach((l) => {
		if (isFoot(l)) return;
		(l.comments || []).forEach((c) => globalKeys.add(c.ply + "|" + c.text));
	});
```

- [ ] **Step 5: Give the footnote entry a `subNotes` array**

In the footnote block, add `subNotes: []` to the `foot` payload, alongside `name`, `eval`, `note`, `moves`, `marks` and `d`.

Keep `footEntries.push([entry, l])` and the post-loop `noteByPly` assignment exactly as they are.

- [ ] **Step 6: Route a footnote line's comments**

Replace the body of the `(l.comments || []).forEach(...)` loop so a footnote line's exclusive notes become sub-notes. The ordinary path is unchanged:

```js
		(l.comments || []).forEach((c) => {
			const k = c.ply + "|" + c.text;
			// exclusive to footnote lines: it belongs under this footnote, lettered
			if (isFoot(l) && !globalKeys.has(k)) {
				const sub = entry.foot.subNotes;
				let at = sub.find((x) => x.ply === c.ply && x.text === c.text);
				if (!at) {
					at = { label: subLabel(sub.length), ply: c.ply, text: c.text };
					sub.push(at);
				}
				const marks = (map[c.ply] = map[c.ply] || []);
				if (!marks.includes(at.label)) marks.push(at.label);
				return;
			}
			let n = seen.get(k);
			if (n === undefined) {
				n = entries.length + 1;
				seen.set(k, n);
				entries.push({ ply: c.ply, text: c.text, owner: l, n });
			}
			const at = (map[c.ply] = map[c.ply] || []);
			if (!at.includes(n)) at.push(n);
		});
```

`entry` is the footnote entry created earlier in this same iteration. Hoist it so it is in scope here — declare `let entry = null;` at the top of the `lines.forEach` callback, assign it in the footnote block, and rely on `isFoot(l)` being false for every other line.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx node --test tests/notes.test.mjs`
Expected: PASS.

Other suites now fail — that is expected and is fixed by Tasks 2-6. In particular the parity guard (`table markers and the notes list agree with footnotes in the mix`) compares a marker set against the number list and will now see letters. **Do not weaken it here**; Task 6 updates it.

- [ ] **Step 8: Lint and commit**

Run: `npm run lint`

```bash
git add src/notes.js tests/notes.test.mjs
git commit -m "Letter a footnote's own notes as sub-notes of that footnote"
```

---

### Task 2: Sub-note renderers in `render.js`

**Files:**
- Modify: `src/render.js`
- Test: `tests/render.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/render.test.mjs`:

```js
test("appendSubNotes renders one labelled row per sub-note", () => {
	const off = installDom();
	const box = document.createElement("div");
	appendSubNotes(box, {
		subNotes: [
			{ label: "a", ply: 2, text: "knight move" },
			{ label: "b", ply: 3, text: "**sharp**" },
		],
	});
	const rows = [...box.querySelectorAll(".subnote")];
	assert.strictEqual(rows.length, 2);
	assert.strictEqual(rows[0].querySelector("sup").textContent, "[a]");
	assert.match(rows[0].textContent, /knight move/);
	assert.ok(rows[1].querySelector("strong"), "text goes through renderInline");
	off();
});

test("appendSubNotes renders nothing when a footnote has none", () => {
	const off = installDom();
	const box = document.createElement("div");
	appendSubNotes(box, { subNotes: [] });
	assert.strictEqual(box.childNodes.length, 0);
	off();
});

test("subNoteLines renders the same sub-notes as indented text", () => {
	assert.deepStrictEqual(
		subNoteLines({
			subNotes: [
				{ label: "a", ply: 2, text: "knight move" },
				{ label: "b", ply: 3, text: "sharp" },
			],
		}),
		["   a. knight move", "   b. sharp"],
	);
	assert.deepStrictEqual(subNoteLines({ subNotes: [] }), []);
});
```

Add `appendSubNotes` and `subNoteLines` to the `../src/render.js` import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx node --test tests/render.test.mjs`
Expected: FAIL — `does not provide an export named 'appendSubNotes'`

- [ ] **Step 3: Implement both**

Add to `src/render.js` beside `appendFootnote` (tabs):

```js
// A footnote's own notes, as labelled rows nested under it. Rendered as a
// sibling block rather than inside appendFootnote so each consumer can place
// and indent it — the panel and the print block both style .subnote.
export function appendSubNotes(container, foot) {
	(foot.subNotes || []).forEach((s) => {
		const row = document.createElement("div");
		row.className = "subnote";
		const sup = document.createElement("sup");
		sup.textContent = "[" + s.label + "]";
		row.appendChild(sup);
		const span = document.createElement("span");
		renderInline(span, s.text);
		row.appendChild(span);
		container.appendChild(row);
	});
}

// Same sub-notes for exports with no DOM, one indented line each.
export function subNoteLines(foot) {
	return (foot.subNotes || []).map((s) => "   " + s.label + ". " + s.text);
}
```

- [ ] **Step 4: Run the tests, lint, commit**

Run: `npx node --test tests/render.test.mjs && npm run lint`

`knip` may flag both as unused until Tasks 3-5 consume them. Note it and continue; do not add a fake consumer.

```bash
git add src/render.js tests/render.test.mjs
git commit -m "Add the shared sub-note renderers"
```

---

### Task 3: Nest sub-notes in the on-screen panel

**Files:**
- Modify: `src/export.js` (`notesPanel`), `style.css`
- Test: `tests/export.test.mjs`

- [ ] **Step 1: Write the failing test**

Append to `tests/export.test.mjs`:

```js
test("the notes panel nests a footnote's own notes under it", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  const box = notesPanel();
  const rows = [...box.querySelectorAll(".nt")];
  assert.strictEqual(rows.length, 1, "one top-level row: the footnote");
  const subs = [...box.querySelectorAll(".subnote")];
  assert.strictEqual(subs.length, 1, "its own note is nested, not top-level");
  assert.strictEqual(subs[0].querySelector("sup").textContent, "[a]");
  off();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx node --test tests/export.test.mjs`
Expected: FAIL — no `.subnote` element exists.

- [ ] **Step 3: Render the sub-notes**

In `notesPanel` (`src/export.js`, 2 spaces), inside the `if (note.foot)` branch, after `appendFootnote(span, note.foot)` and after `row.appendChild(span)`, append the sub-notes to the ROW (not to the span, so they are block-level siblings of the footnote text):

```js
    if (note.foot) appendSubNotes(row, note.foot);
```

Place it immediately before `box.appendChild(row)`. Add `appendSubNotes` to the `./render.js` import.

- [ ] **Step 4: Style the indent**

In `style.css`, beside the existing `.nt` rule, add:

```css
.subnote {
  margin-left: 1.6em;
  font-size: 0.95em;
  opacity: 0.85;
}
.subnote sup {
  margin-right: 0.3em;
}
```

Match the file's existing formatting. If `.nt` already sets a left margin or uses different units, follow that convention instead of these literal values — the requirement is that a sub-note is visibly indented under its footnote and reads as subordinate to it.

- [ ] **Step 5: Run the tests, lint, commit**

Run: `npx node --test tests/export.test.mjs && npm run lint`

```bash
git add src/export.js style.css tests/export.test.mjs
git commit -m "Nest a footnote's own notes under it on screen"
```

---

### Task 4: Nest sub-notes in the print notes block and Markdown

**Files:**
- Modify: `src/print.js` (`renderTableNotes`), `src/export.js` (`buildMarkdown`)
- Test: `tests/print.test.mjs`, `tests/export.test.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/print.test.mjs`:

```js
test("a footnote's own notes print nested under it", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3 Nc6 {knight move}) 2. Nf3 Nc6", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  const box = document.createElement("div");
  appendPrintTables(box, grid(s.lines));
  const block = box.querySelector(".print-notes");
  assert.match(block.textContent, /Sicilian/);
  const subs = [...block.querySelectorAll(".subnote")];
  assert.strictEqual(subs.length, 1);
  assert.strictEqual(subs[0].querySelector("sup").textContent, "[a]");
  off();
});
```

Append to `tests/export.test.mjs`:

```js
test("Markdown indents a footnote's own notes under it", () => {
  const off = installDom();
  const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
    tags: { 1: "foot" },
  });
  s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
  const md = buildMarkdown();
  const lines = md.split("\n");
  const i = lines.findIndex((l) => /^1\. Sicilian: /.test(l));
  assert.ok(i > -1, "the footnote is note 1");
  assert.strictEqual(
    lines[i + 1],
    "   a. knight move",
    "its own note follows, indented",
  );
  off();
});
```

- [ ] **Step 2: Run both to verify they fail**

Run: `npx node --test tests/print.test.mjs tests/export.test.mjs`
Expected: FAIL — no `.subnote` in the print block; no indented line in the Markdown.

- [ ] **Step 3: Print block**

In `renderTableNotes` (`src/print.js`, 2 spaces), in the `if (n.foot)` branch, after `row.appendChild(span)` and before `box.appendChild(row)`:

```js
    if (n.foot) appendSubNotes(row, n.foot);
```

Add `appendSubNotes` to the `./render.js` import.

- [ ] **Step 4: Markdown**

In `buildMarkdown` (`src/export.js`), replace the notes `forEach` so a footnote's sub-note lines follow its own line:

```js
    notes.forEach((note) => {
      if (note.foot) {
        L.push(`${note.n}. ${footnoteText(note.foot)}`, ...subNoteLines(note.foot));
      } else {
        L.push(`${note.n}. ${moveRef(note.ply, note.owner)} — ${note.text}`);
      }
    });
```

Add `subNoteLines` to the `./render.js` import.

- [ ] **Step 5: Print cards**

`renderCards` (`src/render.js`) lists a card's notes, rendering a footnote entry with `footnoteText(note.foot)`. Its sub-notes would otherwise vanish from the card view entirely.

A card note is a single text row, so there is nowhere to nest — append the sub-notes to the same string instead, each prefixed by its bracketed label:

```js
					text: note.foot
						? [
								footnoteText(note.foot),
								...(note.foot.subNotes || []).map(
									(x) => "[" + x.label + "] " + x.text,
								),
							].join("  ")
						: strip(note.text),
```

Add a test to `tests/render.test.mjs`:

```js
test("a card's footnote note carries its sub-notes", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	s.lines.find((l) => l.moves.some((m) => m.san === "c5")).name = "Sicilian";
	const g = grid(s.lines);
	const box = document.createElement("div");
	renderCards(box, g, { notes: allNotes() });
	const text = box.querySelector(".card .card-notes").textContent;
	assert.match(text, /Sicilian/);
	assert.match(text, /\[a\] knight move/, "the sub-note travels with it");
	off();
});
```

- [ ] **Step 6: Run the tests, lint, commit**

Run: `npx node --test tests/print.test.mjs tests/export.test.mjs tests/render.test.mjs && npm run lint`

```bash
git add src/print.js src/export.js src/render.js tests/print.test.mjs tests/export.test.mjs tests/render.test.mjs
git commit -m "Nest a footnote's own notes in print, Markdown and cards"
```

---

### Task 5: Sub-note letters on the editor's move chips

**Files:**
- Modify: `src/line-editor.js` (`moveStrip`)
- Test: `tests/line-editor.test.mjs`

`moveStrip` labels each move chip with the numbers of the notes on it, looked up from `allNotes()` by matching `(ply, text)` against the line's own comments. A footnote's own notes are no longer in `allNotes()`, so without this task a footnote line's annotated moves silently lose their markers in the editor.

- [ ] **Step 1: Write the failing test**

Append to `tests/line-editor.test.mjs`:

```js
test("a footnote line's move chip shows its sub-note letter", () => {
	const off = installDom();
	const s = loadState("1. e4 e5 (1... c5 2. Nf3 {knight move}) 2. Nf3", {
		tags: { 1: "foot" },
	});
	const foot = s.lines.find((l) => l.moves.some((m) => m.san === "c5"));
	const sups = [...moveStrip(foot).querySelectorAll("sup")].map(
		(x) => x.textContent,
	);
	assert.ok(
		sups.includes("a"),
		`the sub-note letter marks the chip (got ${JSON.stringify(sups)})`,
	);
	off();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx node --test tests/line-editor.test.mjs`
Expected: FAIL — the chip carries no marker at all.

- [ ] **Step 3: Read the markers from `numberNotes` instead of `allNotes`**

`numberNotes(getCurrent().lines).byLine` already holds exactly the markers for each line — numbers for ordinary notes, letters for a footnote's own — which is precisely what the chip wants, and it is one lookup instead of a filter over every note.

In `src/line-editor.js`, import `numberNotes` (it can replace the `allNotes` import if nothing else in the file uses it — check before removing).

Compute the map ONCE, above the `owned.forEach` loop in `moveStrip`:

```js
	// markers for this line's moves: numbers for ordinary notes, letters for a
	// footnote's own sub-notes. byLine already has them keyed by ply, so this
	// replaces a per-move scan of the whole notes list.
	const marksByPly = numberNotes(getCurrent().lines).byLine.get(l) || {};
```

Then replace the per-move `noteNums` lookup:

```js
		const noteNums = marksByPly[m.ply] || [];
```

Everything downstream is unchanged — `noteNums.join(",")` still produces the superscript, now reading `a` where it used to read a number on a footnote line.

Note the `|| {}` fallback here is NOT the dead-fallback pattern removed elsewhere in this codebase: `moveStrip` can be called with a line that is not in `getCurrent().lines` (tests do exactly that), so the lookup genuinely can miss.

- [ ] **Step 4: Run the tests, lint, commit**

Run: `npx node --test tests/line-editor.test.mjs && npm run lint`
Expected: PASS, including the existing chip tests — an ordinary line's chips must still show their numbers unchanged.

```bash
git add src/line-editor.js tests/line-editor.test.mjs
git commit -m "Mark footnote move chips with their sub-note letters"
```

---

### Task 6: Update the parity guard, README, and verify

**Files:**
- Modify: `tests/notes.test.mjs`, `README.md`

- [ ] **Step 1: Update the parity guard**

The guard `table markers and the notes list agree with footnotes in the mix` asserts that the set of markers gathered from `vars` and `footNotes` equals the list of note numbers. A footnote's markers can now be letters, so that comparison no longer holds as written.

Update it to assert **two** things instead of one, keeping the strength it had:

1. Every NUMERIC marker across `vars` and `footNotes` resolves to a global note anchored at the same ply, and the set of numeric markers equals the set of global note numbers — the original invariant, restricted to numbers.
2. Every LETTER marker inside a footnote's `noteByPly` matches a `label` in that same footnote's `subNotes`, and every sub-note's label is marked on exactly the ply it belongs to — the new invariant, so a sub-note cannot go unmarked or point at the wrong move.

Do not simply drop the letters from the set to make the old assertion pass. The point of this test is that nothing marked is unresolvable and nothing resolvable is unmarked; that has to hold for both marker kinds.

- [ ] **Step 2: Prove the guard still has teeth**

Temporarily break `src/notes.js` — stop pushing the sub-note label into `map[c.ply]` — and confirm the updated guard FAILS. Then revert and confirm `git diff src/notes.js` is empty.

Paste the failure output into your report. A guard that cannot fail is not a guard.

- [ ] **Step 3: Run everything CI runs**

Run: `npm run lint && npm run knip && npm test`
Expected: all three pass. Report the test count.

- [ ] **Step 4: Update the README**

The README's **Tag** and **Render** bullets describe a footnote's own notes as separate numbered entries. Update them: a footnote's own notes are lettered `a`, `b`, `c` and nested under it, restarting per footnote; a note shared with a non-footnote line stays in the global numbered list and is referenced by number.

Match the README's voice. Do not restructure or touch anything unrelated.

- [ ] **Step 5: Commit**

```bash
git add tests/notes.test.mjs README.md
git commit -m "Guard sub-note marker parity and update the README"
```

---

## Done when

- A footnote's own notes render as lettered `[a]`, `[b]` rows nested under it, on screen, in print, and in Markdown, and appear nowhere in the global numbered list.
- Letters restart at `a` for each footnote.
- A note shared with a non-footnote line stays a global numbered note and is referenced by number from inside the footnote.
- A footnote line's move chips show their sub-note letters in the editor.
- `npm run lint && npm run knip && npm test` all pass.
