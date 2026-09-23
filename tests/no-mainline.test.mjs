import { test } from "node:test";
import assert from "node:assert";
import { bootApp } from "./helpers.mjs";

// Per the repo's coverage note: boot ONCE per file, with no cache-busting
// query string, and drive the app through its own UI.
test("the No mainline tickbox reshapes the report and survives a re-render", async (t) => {
  const app = await bootApp();
  t.after(() => app.teardown());

  await app.loadPgn("1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6");
  const box = () =>
    [...app.view().querySelectorAll("label")].find((l) =>
      l.textContent.includes("No mainline"),
    );
  assert.ok(box(), "no No mainline tickbox");
  assert.ok(app.view().querySelectorAll(".main-col").length > 0);
  assert.strictEqual(app.view().querySelectorAll(".maintag").length, 1);

  const tick = (on) => {
    const input = box().querySelector("input");
    input.checked = on;
    input.dispatchEvent(new app.dom.window.Event("change"));
  };

  tick(true);
  await app.settle();

  assert.strictEqual(app.view().querySelectorAll(".main-col").length, 0);
  assert.strictEqual(app.view().querySelectorAll(".maintag").length, 0);
  assert.ok(
    ![...app.view().querySelectorAll("button")].some((b) =>
      b.textContent.includes("Make mainline"),
    ),
    "★ Make mainline still offered",
  );
  // the tickbox stayed ticked through the re-render
  assert.strictEqual(box().querySelector("input").checked, true);
  // every line is in the editor list, the first one included
  const names = [...app.view().querySelectorAll("input.ln")].map((i) => i.value);
  assert.deepStrictEqual(names, ["Line 1", "Line 2"]);

  // unticking restores the mainline
  tick(false);
  await app.settle();
  assert.ok(app.view().querySelectorAll(".main-col").length > 0);
  assert.strictEqual(app.view().querySelectorAll(".maintag").length, 1);
});
