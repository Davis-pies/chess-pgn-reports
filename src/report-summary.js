// The head of the printed report and of the Markdown export: what the opening
// is, where the analysis came from, and what the lines add up to.
//
// Everything below the head is lines and notes, read one at a time. Nothing
// said what the report covered as a whole -- not even its name, since the
// notebook name lives in a toolbar input that does not print -- and the PGN's
// own header (Opening, ECO, the players of a model game) was parsed and then
// thrown away. So the head states those, then counts what follows and tallies
// the lines' final verdicts, which is the question a theory table is read to
// answer: who comes out of this opening better, and how often.
import { headerTags } from "./pgn.js";
import { nagFor, markNag } from "./nags.js";
import { el } from "./dom.js";

// A tag's value, or "" for the PGN spec's unknown placeholders ("?",
// "????.??.??") -- a report printing "? – ?" says nothing.
function known(v) {
  const s = String(v || "").trim();
  return !s || /^[?.\s]*$/.test(s) ? "" : s;
}

// The header facts worth a line each, in reading order: what the opening is,
// then where the source game came from. Empty ones are left out.
export function headerFacts(tags) {
  const t = (k) => known(tags[k]);
  const out = [];
  const opening = [t("Opening"), t("Variation"), t("SubVariation")]
    .filter(Boolean)
    .join(", ");
  const eco = t("ECO");
  if (eco || opening)
    out.push([eco && "ECO " + eco, opening].filter(Boolean).join(" · "));
  // The game line only for a real game: both players named. Without them the
  // event, site and date are the app's own round-trip filler at best -- its
  // PGN export writes the notebook's name as the Event -- so they are left out
  // too rather than printed as facts about a game that was never played.
  if (!t("White") || !t("Black")) return out;
  const year = (t("Date").match(/^\d{4}/) || [""])[0];
  const where = [t("Event"), t("Site")].filter(Boolean).join(", ");
  out.push(
    [t("White") + " – " + t("Black"), [where, year].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", "),
  );
  return out;
}

// Verdict buckets, keyed by NAG code: $10 equal, $13 unclear, and the
// White/Black advantage ladders from slightly better to crushing.
const VERDICTS = [
  { key: "white", label: "White better", codes: [14, 16, 18, 20] },
  { key: "equal", label: "equal", codes: [10, 11, 12] },
  { key: "unclear", label: "unclear", codes: [13] },
  { key: "black", label: "Black better", codes: [15, 17, 19, 21] },
];

// A line's verdict: its line-end evaluation, or failing that an assessment on
// its last move -- which is where an imported PGN puts one ("14. Nd5 $16").
// Move-quality marks (!, ?) are not verdicts and count as none.
export function verdictOf(line) {
  const codes = [];
  const ev = line.meta && line.meta.eval;
  if (ev) codes.push(nagFor(ev));
  const last = line.moves[line.moves.length - 1];
  if (last) codes.push(markNag((line.marks || {})[last.ply], last.ply));
  for (const c of codes) {
    const v = VERDICTS.find((b) => b.codes.includes(c));
    if (v) return v.key;
  }
  return null;
}

// The report's head, as data: the title, the header facts, the counts, and
// the verdict tally (buckets with no lines left out). `g` is grid()'s output,
// so the counts are of what the report prints -- hidden lines are not in it.
export function reportSummary(state, g, notes) {
  const tags = headerTags(state);
  const title =
    (state.name || "").trim() ||
    [known(tags.Opening), known(tags.Variation)].filter(Boolean).join(", ");
  const lines = g.vars.filter((v) => !v.synthetic).map((v) => v.line);
  const foots = g.footNotes.map((f) => f.line);
  const all = [...lines, ...foots];
  const deepest = Math.max(
    0,
    ...all.map((l) => {
      const m = l.moves[l.moves.length - 1];
      return m ? Math.floor(m.ply / 2) + 1 : 0;
    }),
  );
  const noteCount = notes.filter((n) => !n.foot).length;
  const plural = (n, word) => n + " " + word + (n === 1 ? "" : "s");
  const counts = [
    plural(lines.length, "line"),
    foots.length && plural(foots.length, "footnote line"),
    noteCount && plural(noteCount, "note"),
    deepest && "to move " + deepest,
  ].filter(Boolean);
  const tally = new Map(VERDICTS.map((v) => [v.key, 0]));
  let assessed = 0;
  for (const l of all) {
    const v = verdictOf(l);
    if (!v) continue;
    tally.set(v, tally.get(v) + 1);
    assessed++;
  }
  const verdicts = VERDICTS.filter((v) => tally.get(v.key)).map((v) => ({
    key: v.key,
    label: v.label,
    count: tally.get(v.key),
  }));
  return {
    title,
    facts: headerFacts(tags),
    counts,
    verdicts,
    unassessed: all.length - assessed,
  };
}

// "White better 3 · equal 2 · 1 unassessed", or "" when no line has a verdict:
// a tally of nothing but "unassessed" tells the reader nothing.
export function verdictText(s) {
  if (!s.verdicts.length) return "";
  const parts = s.verdicts.map((v) => v.label + " " + v.count);
  if (s.unassessed) parts.push(s.unassessed + " unassessed");
  return parts.join(" · ");
}

// The printed head, above the first card or table.
export function appendReportSummary(box, s, { print = true } = {}) {
  const head = el("div", {
    className: "report-head" + (print ? "" : " noprint"),
  });
  if (s.title) head.appendChild(el("h1", { textContent: s.title }));
  s.facts.forEach((f) =>
    head.appendChild(el("div", { className: "rh-fact", textContent: f })),
  );
  head.appendChild(
    el("div", { className: "rh-counts", textContent: s.counts.join(" · ") }),
  );
  const vt = verdictText(s);
  if (vt)
    head.appendChild(
      el("div", { className: "rh-verdicts", textContent: "Verdicts: " + vt }),
    );
  box.appendChild(head);
}

// The same head as Markdown: a title, then one paragraph line per fact.
export function summaryMarkdown(s) {
  const L = [];
  if (s.title) L.push("# " + s.title, "");
  s.facts.forEach((f) => L.push(f + "  "));
  L.push(s.counts.join(" · ") + "  ");
  const vt = verdictText(s);
  if (vt) L.push("Verdicts: " + vt + "  ");
  // no trailing hard break on the paragraph's last line
  L[L.length - 1] = L[L.length - 1].trimEnd();
  L.push("");
  return L;
}
