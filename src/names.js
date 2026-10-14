import { Chess } from "chess.js";
import { fenMap } from "./pgn.js";
import { posKey } from "./audit.js";

// Named positions: a name (and tags) per position key, written in PGN as
// [%name "X"] [%tags "a; b"] commands in the comment on the move that reaches
// the position.

const NAME_RE = /\[%name\s+"([^"]*)"\s*\]/;
const TAGS_RE = /\[%tags\s+"([^"]*)"\s*\]/;

export function readNameCmd(text) {
	const m = NAME_RE.exec(text);
	if (!m) return null;
	const t = TAGS_RE.exec(text);
	const tags = t ? t[1].split(";").map((s) => s.trim()).filter(Boolean) : [];
	return { name: m[1], tags };
}

// A quote would end the command early, so it becomes an apostrophe; a closing
// brace or bracket would end the comment or the command, so it becomes a paren.
const q = (s) => s.replace(/"/g, "'").replace(/[}\]]/g, ")");

export function nameCmd({ name, tags = [] }) {
	const out = `[%name "${q(name)}"]`;
	return tags.length ? `${out} [%tags "${q(tags.join("; "))}"]` : out;
}

export function namesFromNodes(nodes) {
	const names = {};
	const walk = (list) => {
		for (const n of list) {
			if (n.posName && n.fen) {
				const k = posKey(n.fen);
				if (!names[k]) names[k] = n.posName;
			}
			for (const v of n.variations || []) walk(v);
		}
	};
	walk(nodes);
	return names;
}

export function setName(names, fen, name, tags = []) {
	const key = posKey(fen);
	if (!name || !name.trim()) delete names[key];
	else names[key] = { name: name.trim(), tags };
	return names;
}

// Derived, never stored: see "Hierarchy" in the Train mode spec.
export function variationTree(lines, names) {
	const byKey = new Map();
	for (const line of lines) {
		const fens = fenMap(line.moves);
		const sans = [];
		let prev = null; // nearest named position before this point on the line
		for (const m of line.moves) {
			sans.push(m.san);
			const key = posKey(fens.get(m.ply));
			const named = names[key];
			if (!named) continue;
			let v = byKey.get(key);
			if (!v) {
				v = { key, fen: fens.get(m.ply), name: named.name, tags: named.tags || [], parent: prev, also: [], children: [], level: Infinity, orders: [] };
				byKey.set(key, v);
			} else if (prev && prev !== v.parent && prev !== v && !v.also.includes(prev)) v.also.push(prev);
			const order = sans.join(" ");
			if (!v.orders.some((o) => o.join(" ") === order)) v.orders.push([...sans]);
			prev = v;
		}
	}
	const all = [...byKey.values()];
	for (const v of all) if (!v.parent) v.level = 1;
	// relax until stable; a node's parent always exists before it, so every
	// node is reachable from a root
	for (let changed = true; changed; ) {
		changed = false;
		for (const v of all) {
			if (!v.parent) continue;
			const l = 1 + Math.min(v.parent.level, ...v.also.map((a) => a.level));
			if (l < v.level) { v.level = l; changed = true; }
		}
	}
	for (const v of all) if (v.parent) v.parent.children.push(v);
	return { byKey, roots: all.filter((v) => !v.parent) };
}

export function trailOf(sans, names) {
	const chess = new Chess();
	const trail = [];
	for (const [ply, san] of sans.entries()) {
		try {
			chess.move(san);
		} catch {
			break;
		}
		const key = posKey(chess.fen());
		if (names[key]) trail.push({ key, name: names[key].name, ply });
	}
	return trail;
}
