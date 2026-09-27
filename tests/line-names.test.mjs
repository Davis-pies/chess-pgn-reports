// tests/line-names.test.mjs
import { test, after } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";

const app = await bootApp();
after(() => app.teardown());

// The editor numbers placeholder names ("Line 7") by where it draws a line,
// and everything else reads the name back. The printed tables are drawn
// before the editor, so they used to print the previous render's names:
// blank on the first render after a load, and one out after ticking No
// mainline renumbered every line.
test("printed headers carry the same line names as the editor, on every render", async () => {
  await app.loadPgn("1. e4 c5 2. Nf3 d6 (2... Nc6 3. d4) (2... e6 3. d4) (2... g6) 3. d4 *");
  const names = () => {
    const editor = new Set([...app.view().querySelectorAll("input.ln")].map((i) => i.value));
    app.print();
    const printed = [...app.view().querySelectorAll(".pv-htable table.tbl tr:first-child th")]
      .map((th) => th.textContent)
      .filter((t) => /^Line \d+$/.test(t));
    return { editor, printed };
  };
  let { editor, printed } = names();
  assert.ok(printed.length > 0, "the first render already prints names");
  for (const p of printed) assert.ok(editor.has(p), `${p} is a name the editor shows`);

  const input = [...app.view().querySelectorAll("label")].find((l) => l.textContent.includes("No mainline")).querySelector("input");
  input.checked = true;
  input.dispatchEvent(new app.dom.window.Event("change"));
  await app.settle();
  ({ editor, printed } = names());
  assert.ok(printed.length > 0);
  for (const p of printed) assert.ok(editor.has(p), `after No mainline, ${p} is still the editor's name for it`);
  // and specifically: the stub 2...g6 is called the same thing in both
  const { getCurrent } = await import("../src/state.js");
  const g6 = getCurrent().lines.find((l) => l.moves.map((m) => m.san).join(" ") === "e4 c5 Nf3 g6");
  assert.ok(editor.has(g6.name));
});
