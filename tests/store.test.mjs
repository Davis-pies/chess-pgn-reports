import { test } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";
import {
	saveNotebook,
	loadNotebook,
	listNotebooks,
	deleteNotebook,
} from "../src/store.js";

// store.js reads/writes the bare `localStorage` global, same as the browser;
// stand one up via jsdom for each test so entries don't leak between tests.
function withStorage(fn) {
	const dom = new JSDOM("", { url: "http://localhost/" });
	global.localStorage = dom.window.localStorage;
	try {
		return fn();
	} finally {
		delete global.localStorage;
	}
}

test("saveNotebook / loadNotebook round-trip", () => {
	withStorage(() => {
		const lines = [
			{ isMain: true, moves: [{ san: "e4", ply: 0 }], name: "Mainline" },
			{
				isMain: false,
				tag: "sideline",
				moves: [{ san: "e4", ply: 0 }, { san: "c5", ply: 1 }],
				name: "Sicilian",
				meta: { note: "spicy" },
				marks: { 1: "!" },
				comments: [{ ply: 1, text: "sharp" }],
			},
		];
		const ok = saveNotebook("abc", { name: "My Book", pgn: "1. e4 c5", lines });
		assert.strictEqual(ok, true, "save reports success");

		const loaded = loadNotebook("abc");
		assert.ok(loaded, "notebook loads back");
		assert.strictEqual(loaded.name, "My Book");
		assert.strictEqual(loaded.pgn, "1. e4 c5");
		assert.strictEqual(loaded.main, "e4"); // keyFor the mainline's moves
		assert.strictEqual(loaded.tags.length, 2);
		const side = loaded.tags.find((t) => t.key === "e4 c5");
		assert.ok(side, "sideline tag entry present");
		assert.strictEqual(side.tag, "sideline");
		assert.strictEqual(side.name, "Sicilian");
		assert.deepStrictEqual(side.meta, { note: "spicy" });
		assert.deepStrictEqual(side.marks, { 1: "!" });
		assert.deepStrictEqual(side.comments, [{ ply: 1, text: "sharp" }]);
	});
});

test("saveNotebook returns false and does not throw when setItem throws", () => {
	withStorage(() => {
		// jsdom's Storage writes through any property assignment on the
		// instance to the backing store (per the WebStorage named-property
		// setter spec), so `localStorage.setItem = fn` silently no-ops
		// instead of overriding the method — stub it on the prototype.
		const proto = Object.getPrototypeOf(global.localStorage);
		const origSetItem = proto.setItem;
		proto.setItem = () => {
			throw new Error("QuotaExceededError");
		};
		try {
			const lines = [{ isMain: true, moves: [{ san: "e4", ply: 0 }] }];
			let ok;
			assert.doesNotThrow(() => {
				ok = saveNotebook("full", { name: "N", pgn: "1. e4", lines });
			});
			assert.strictEqual(ok, false, "failure is surfaced to the caller");
		} finally {
			proto.setItem = origSetItem;
		}
	});
});

test("loadNotebook returns null for corrupt JSON instead of throwing", () => {
	withStorage(() => {
		global.localStorage.setItem("ott:bad", "{not json");
		let result;
		assert.doesNotThrow(() => {
			result = loadNotebook("bad");
		});
		assert.strictEqual(result, null);
	});
});

test("listNotebooks tolerates a corrupt entry alongside a valid one", () => {
	withStorage(() => {
		const lines = [{ isMain: true, moves: [{ san: "e4", ply: 0 }] }];
		saveNotebook("good", { name: "Good Book", pgn: "1. e4", lines });
		global.localStorage.setItem("ott:bad", "{not json");

		let list;
		assert.doesNotThrow(() => {
			list = listNotebooks();
		});
		list.sort((a, b) => a.id.localeCompare(b.id));
		assert.deepStrictEqual(list, [
			{ id: "bad", name: "" },
			{ id: "good", name: "Good Book" },
		]);
	});
});

test("deleteNotebook removes only the targeted key", () => {
	withStorage(() => {
		const lines = [{ isMain: true, moves: [{ san: "e4", ply: 0 }] }];
		saveNotebook("keep", { name: "Keep", pgn: "1. e4", lines });
		saveNotebook("gone", { name: "Gone", pgn: "1. e4", lines });

		deleteNotebook("gone");

		assert.strictEqual(loadNotebook("gone"), null);
		assert.ok(loadNotebook("keep"), "untouched entry survives");
		const ids = listNotebooks()
			.map((n) => n.id)
			.sort();
		assert.deepStrictEqual(ids, ["keep"]);
	});
});
