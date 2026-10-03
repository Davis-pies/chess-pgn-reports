/* global document -- page.evaluate runs in the browser */
import { readFileSync } from "node:fs";
import { test, expect, loadPgn, FIXTURE } from "./fixtures.mjs";
import { pdfText } from "./pdf.mjs";
import { genPgn } from "../tools/gen-pgn.mjs";

// The printed report as Chrome lays it out on paper. The unit tests build the
// print tables under jsdom, which has no layout: they say which moves and
// notes a table holds, not whether it fits the page or where the page breaks
// fall. These print the page for real and read the PDF back.

// A4 inside Chrome's default margins (about 1cm), the narrowest page a reader
// is likely to print on.
const A4 = { format: "A4", margin: { top: "1cm", bottom: "1cm", left: "1cm", right: "1cm" } };
const A4_WIDTH = 718; // CSS px: 210mm less the two margins
const A4_HEIGHT = 1047; // and 297mm less the two

// One of the print options under the report ("include in print" and so on).
const printOpt = (page, group, label) =>
  page.locator(".optgroup").filter({ hasText: group }).getByLabel(label);

// A PDF run whose text is `str`, at or after position `from` in the stream.
const find = (items, str, from = 0) => {
  const i = items.findIndex((it, k) => k >= from && it.str === str);
  return i < 0 ? null : i;
};

test("a full-width table fits the page and the report prints at full size", async ({ page }) => {
  // 200 lines pack into tables of the full fourteen columns
  await loadPgn(page, genPgn({ vars: 200 }));
  const pdf = await page.pdf(A4);
  const widest = await page.$$eval(".pv-htable table.tbl", (ts) =>
    Math.max(...ts.map((t) => t.rows[0].cells.length)),
  );
  expect(widest).toBe(15); // the ply column, the mainline and 13 lines

  // Laid out at the page's width, nothing runs past its right edge. Chrome
  // shrinks the whole document to fit anything that does.
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: A4_WIDTH, height: 1000 });
  const over = await page.evaluate(() => {
    const edge = document.documentElement.clientWidth;
    return [...document.querySelectorAll(".pv-htable table, .print-stem, .print-notes, .card")]
      .filter((e) => e.getBoundingClientRect().right > edge + 0.5)
      .map((e) => e.className);
  });
  expect(over).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(A4_WIDTH);

  // ...so the PDF's text is the size the stylesheet sets: the notes headings
  // print at 0.75rem, 9pt, not scaled down with the rest of the report.
  const { items } = await pdfText(pdf);
  const heads = items.filter((it) => it.str === "NOTES");
  expect(heads.length).toBeGreaterThan(0);
  for (const h of heads) expect(h.size).toBeCloseTo(9, 0);
});

test("a long line name wraps in its column rather than widening the table", async ({ page }) => {
  await loadPgn(page, genPgn({ vars: 30 }));
  await page.locator(".markup").getByRole("button", { name: "Expand all" }).click();
  const names = page.locator(".markup .ledge input.ln");
  for (const [i, name] of [
    [0, "Accelerated Dragon, Maróczy Bind, Gurgenidze Variation"],
    [1, "Hyperaccelerated-Pterodactyl-Counterattack-Deferred"],
  ]) {
    await names.nth(i).fill(name);
    await names.nth(i).press("Enter");
  }
  await page.pdf(A4);
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: A4_WIDTH, height: 1000 });
  const widths = await page.$$eval(".pv-htable table.tbl", (ts) =>
    ts.map((t) => t.getBoundingClientRect().width),
  );
  expect(Math.max(...widths)).toBeLessThanOrEqual(A4_WIDTH);
  await expect(page.locator(".pv-htable th.var-head").filter({ hasText: "Gurgenidze" })).toHaveCount(1);
});

test("each table prints whole on one page, with its stem above it and its notes after it", async ({ page }) => {
  await loadPgn(page, genPgn({ vars: 50 }));
  // the tables alone, so every "Notes" heading in the PDF is a table's
  await printOpt(page, "Cards", "include in print").uncheck();
  const { pages, items } = await pdfText(await page.pdf({ format: "Letter" }));

  const tables = await page.$$eval(".pv-htable table.tbl", (ts) =>
    ts.map((t) => ({
      stem: t.previousElementSibling?.classList.contains("print-stem") ?? false,
      // Black's rows leave the ply column blank, so the last number in it
      last: [...t.rows].map((r) => r.cells[0].textContent).filter(Boolean).pop(),
      notes: [...t.nextElementSibling.querySelectorAll(".nt > sup")].map((s) => s.textContent),
    })),
  );
  expect(tables.length).toBeGreaterThan(2);
  expect(pages).toBeGreaterThan(tables.length);

  const heads = items.flatMap((it, i) => (it.str === "ply" ? [i] : []));
  expect(heads).toHaveLength(tables.length);
  tables.forEach((t, k) => {
    const at = heads[k];
    const head = items[at];
    const next = k + 1 < heads.length ? heads[k + 1] : items.length;
    const here = items.slice(at, next);
    // the stem is the run just above the header, on the same page
    if (t.stem) expect(items[at - 1].page, `table ${k}'s stem`).toBe(head.page);
    // the table's last move number, in the ply column, is on the header's page
    const last = here.find((it) => it.str === t.last && Math.abs(it.x - head.x) < 20);
    expect(last, `table ${k}'s last row`).toBeTruthy();
    expect(last.page, `table ${k}'s last row`).toBe(head.page);
    // its notes follow it, in number order, all on one page with their heading
    if (!t.notes.length) return;
    const h = find(here, "NOTES");
    expect(h, `table ${k}'s notes`).not.toBeNull();
    const marks = here.slice(h).filter((it) => /^\[\d+\]$/.test(it.str));
    expect(marks.map((m) => m.str)).toEqual(t.notes);
    for (const m of marks) expect(m.page, `table ${k}'s note ${m.str}`).toBe(here[h].page);
    expect(here[h].page).toBeGreaterThanOrEqual(head.page);
  });
});

test("each card prints whole on one page, in report order", async ({ page }) => {
  await loadPgn(page, readFileSync(FIXTURE, "utf8"));
  // the cards alone, so the PDF ends with the last card
  await printOpt(page, "Table", "include in print").uncheck();
  const { items } = await pdfText(await page.pdf(A4));

  // A card taller than the page has to break somewhere; every other card
  // keeps to one page.
  await page.emulateMedia({ media: "print" });
  await page.setViewportSize({ width: A4_WIDTH, height: A4_HEIGHT });
  const cards = await page.$$eval(".pv-cards .card", (cs) =>
    cs.map((c) => ({
      name: c.querySelector(".card-name").textContent,
      tall: c.getBoundingClientRect().height,
    })),
  );
  expect(cards.filter((c) => c.tall <= A4_HEIGHT).length).toBeGreaterThan(cards.length / 2);
  const tags = items.flatMap((it, i) => (/^(MAINLINE|SIDELINE)$/.test(it.str) ? [i] : []));
  expect(tags).toHaveLength(cards.length);
  tags.forEach((at, k) => {
    // the card's name follows its tag
    expect(items[at + 1].str).toBe(cards[k].name);
    if (cards[k].tall > A4_HEIGHT) return;
    const end = k + 1 < tags.length ? tags[k + 1] : items.length;
    const off = items.slice(at, end).filter((it) => it.page !== items[at].page);
    expect(off.map((it) => it.str), `${cards[k].name} runs onto another page`).toEqual([]);
  });
});
