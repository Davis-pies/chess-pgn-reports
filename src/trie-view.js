import { buildTrie, leavesOf, countLeaves } from "./tree.js";
import { renderTable, fullmoveLabel } from "./render.js";
import { el } from "./dom.js";
import {
	getCurrent,
	openPaths,
	openTablePaths,
	getRenderHooks,
} from "./state.js";
import { subMaxPly } from "./print.js";
// rerenderTable/rerenderMarkup (app.js shell glue, in-place panel rebuilds)
// and lineEditor (seam 3) are reached through the render-hooks registry
// rather than a static `import ... from "./app.js"` -- see the comment on
// setRenderHooks() in state.js for why.

// Left-panel preview: ONE table. The mainline column is always visible (left
// in horizontal, top row in vertical); each top-level trie branch contributes
// its columns. A collapsed branch is compressed to a single shared-continuation
// column (the moves all its lines have in common up to the fork); clicking that
// column's header expands it back into its individual line columns.
export function renderTrieTable(container, g, orientation) {
	const mainV = g.vars[0]; // mainline sorts first
	const others = g.vars.slice(1);
	const trie = buildTrie(others, mainV);
	const controls = el("div", { className: "orow tbl-controls" });
	controls.appendChild(el("span", { textContent: "Branches: " }));
	const ex = el("button", {
		className: "chip mini",
		textContent: "Expand all",
	});
	ex.onclick = () => {
		openTablePaths.clear();
		trie.children.forEach((c) => collectKeys(c, openTablePaths));
		getRenderHooks().rerenderTable();
	};
	const col = el("button", {
		className: "chip mini",
		textContent: "Collapse all",
	});
	col.onclick = () => {
		openTablePaths.clear();
		getRenderHooks().rerenderTable();
	};
	controls.append(ex, col);
	container.appendChild(controls);
	if (!mainV) return;
	// build the single table's var list: mainline + each branch. A branch with
	// ONE line is a plain column (no collapse affordance). A multi-line branch
	// collapses to a single compact column ("▸ N lines" header, shared moves in
	// its cells); its expanded lines are clickable to collapse the branch again.
	const vars = [mainV];
	trie.children.forEach((c) => {
		if (countLeaves(c) === 1) {
			vars.push(...leavesOf(c));
		} else if (openTablePaths.has(c.key)) {
			const collapse = () => {
				openTablePaths.delete(c.key);
				getRenderHooks().rerenderTable();
			};
			leavesOf(c).forEach((l) => vars.push({ ...l, onclick: collapse }));
		} else {
			vars.push(collapsedVar(c));
		}
	});
	// rows span only the VISIBLE columns — collapsed branches don't stretch the
	// table down to the deepest hidden line
	renderTable(container, { ...g, vars, maxPly: subMaxPly(vars) }, orientation);
}

// A collapsed trie branch as a single column/row of its shared continuation:
// the moves common to all its lines up to the first fork, with divergent cells
// empty. Its header is clickable to expand.
function collapsedVar(node) {
	const shared = sharedMoves(node); // [{ ply, san }] down the single-child chain
	const cells = {};
	shared.forEach((m) => {
		cells[m.ply] = { text: m.san, cls: "collapsed" };
	});
	// ellipsis prefix before the branch's first shared move, like a sideline
	const d = shared.length ? shared[0].ply : 0;
	for (let ply = 0; ply < d; ply++)
		cells[ply] = { text: "…", cls: "ellip" };
	const count = countLeaves(node);
	return {
		tag: "collapse",
		label: "",
		name: `${count} lines`, // compact: the shared moves are in the column cells
		eval: "",
		cells,
		noteByPly: {},
		collapsed: true,
		onclick: () => {
			openTablePaths.add(node.key);
			getRenderHooks().rerenderTable();
		},
	};
}

// The group-level Footnote chip. Its state is read back off the lines rather
// than stored: all tagged reads "on", some reads "partial" (dimmed), none reads
// off. Clicking sets every line unless they are all already set, in which case
// it clears them — so one click always changes something.
function groupFootChip(node) {
	const leaves = leavesOf(node);
	const all = leaves.every((l) => l.tag === "foot");
	const some = !all && leaves.some((l) => l.tag === "foot");
	const chip = el("button", {
		className:
			"chip tag foot groupfoot" + (all ? " on" : some ? " partial" : ""),
		textContent: "Footnote",
	});
	chip.onclick = (e) => {
		// the chip lives in the <summary>, where a click would otherwise toggle
		// the <details> open/closed as well
		e.preventDefault();
		e.stopPropagation();
		leaves.forEach((l) => (l.tag = all ? null : "foot"));
		getRenderHooks().renderApp();
	};
	return chip;
}

// The moves a branch's lines share, from the branch's root child down its
// single-child chain to the first fork (or the leaf).
function sharedMoves(node) {
	const out = [];
	let n = node;
	while (true) {
		out.push({ ply: n.move.ply, san: n.move.san });
		if (n.leaf || n.children.size !== 1) break;
		n = [...n.children.values()][0];
	}
	return out;
}

function branchLabel(move) {
	return fullmoveLabel(move.ply) + move.san;
}

// Shared move path of a branch, accumulated through its single-child chain
// (e.g. "1... c5 2. Nf3") for the group header.
// Collect a node's key and every descendant's key (for "Expand all").
export function collectKeys(node, into) {
	if (node.key) into.add(node.key);
	node.children.forEach((c) => collectKeys(c, into));
}

export function renderTrieNode(
	container,
	node,
	nameCounter,
	path,
	allOpen,
	// which open-state Set to record this trie's <details> in: the editor's
	// openPaths by default, openHiddenPaths for the hidden drawer's own trie
	paths = openPaths,
) {
	const nextPath = path
		? path + "  " + branchLabel(node.move)
		: branchLabel(node.move);
	const boards = getCurrent().showBoards; // inline-boards master toggle
	// single-child chain: inline it, accumulating the path so a long shared
	// continuation shows as one compressed header, not nested single groups
	if (!node.leaf && node.children.size === 1) {
		node.children.forEach((c) =>
			renderTrieNode(container, c, nameCounter, nextPath, allOpen, paths),
		);
		return;
	}
	// every node — fork OR lone line — is a collapsible group, closed by
	// default; header shows the full shared path up to this node
	const det = el("details", { className: "lgroup" });
	det.open = paths.has(node.key);
	det.addEventListener("toggle", () => {
		// only rebuild when the open-state actually changed; jsdom fires a
		// toggle when a rebuilt element gets open=true, and without this guard
		// that rebuild re-schedules another toggle forever
		const had = paths.has(node.key);
		if (det.open && !had) paths.add(node.key);
		else if (!det.open && had) paths.delete(node.key);
		else return;
		getRenderHooks().rerenderMarkup(); // boards appear/disappear with expansion (in-place, so the table scroll keeps its position)
		// ponytail: whole-app re-render; if toggling feels slow on huge files,
		// scope the rebuild to the markup panel only
	});
	const count = countLeaves(node);
	const summary = el("summary", {
		className: "lg-head",
		textContent: `${nextPath} · ${count} line${count === 1 ? "" : "s"}`,
	});
	// Marking a group as a footnote is marking all its lines: the group IS one
	// footnote precisely when every line under it is tagged (see foot-groups.js).
	// A group of one is just a line, and its own editor row already has the chip.
	if (count > 1) summary.appendChild(groupFootChip(node));
	det.appendChild(summary);
	const body = el("div", { className: "lgroup-body" });
	const open = det.open;
	if (node.leaf)
		body.appendChild(
			getRenderHooks().lineEditor(
				node.leaf,
				nameCounter.n++,
				allOpen && open && boards,
			),
		);
	node.children.forEach((c) =>
		renderTrieNode(body, c, nameCounter, "", allOpen && open, paths),
	);
	det.appendChild(body);
	container.appendChild(det);
}
