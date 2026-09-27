// The Game info dialog: the PGN header tags the report heads itself with and
// Export PGN writes out -- the opening, and the players, event and date of a
// model game -- editable in the app rather than only in the file.
//
// Edits are kept apart from the PGN, in state.header, and laid over its tags
// (headerTags). Rewriting the stored PGN instead would lose them the moment
// Update PGN swapped that text for a new file; kept apart, they are the
// workbook's own, like a line's name, and survive it.
import { el } from "./dom.js";
import { pgnTags, headerTags } from "./pgn.js";

// The fields offered, in the order a header is read.
export const GAME_FIELDS = [
  ["Opening", "Opening"],
  ["Variation", "Variation"],
  ["ECO", "ECO code"],
  ["White", "White"],
  ["Black", "Black"],
  ["Event", "Event"],
  ["Site", "Site"],
  ["Date", "Date (YYYY.MM.DD)"],
  ["Round", "Round"],
];

// The spec's placeholders read as blank: a field showing "?" invites being
// typed after rather than over.
const blank = (v) => (/^[?.\s]*$/.test(String(v || "")) ? "" : String(v).trim());

// The edits a dialog's values make over the PGN's own tags: only fields that
// differ from the file, so a field left as the file had it keeps following
// the file through a later Update PGN.
export function headerEdits(pgn, values) {
  const src = pgnTags(pgn);
  const out = {};
  for (const [k] of GAME_FIELDS) {
    const v = blank(values[k]);
    if (v !== blank(src[k])) out[k] = v;
  }
  return out;
}

export function openGameInfo(state, done) {
  const prev = document.getElementById("gameinfo");
  if (prev) prev.remove();
  const cur = headerTags(state);
  const ov = el("div", { id: "gameinfo", className: "modal-overlay" });
  const box = el("div", { className: "modal" });
  box.appendChild(el("h3", { textContent: "Game info" }));
  box.appendChild(
    el("p", {
      className: "modal-sub",
      textContent:
        "Heads the report and goes into Export PGN. Leave a field blank to leave it out.",
    }),
  );
  const inputs = {};
  const form = el("div", { className: "gi-fields" });
  for (const [k, label] of GAME_FIELDS) {
    inputs[k] = el("input", { className: "gi-" + k, value: blank(cur[k]) });
    form.appendChild(el("label", { className: "gi-field" }, [label, inputs[k]]));
  }
  const close = () => {
    ov.remove();
    document.removeEventListener("keydown", onKey);
  };
  const save = () => {
    const values = {};
    for (const [k] of GAME_FIELDS) values[k] = inputs[k].value;
    const edits = headerEdits(state.pgn, values);
    if (Object.keys(edits).length) state.header = edits;
    else delete state.header;
    close();
    done();
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
    else if (e.key === "Enter" && e.target.tagName === "INPUT") save();
  };
  document.addEventListener("keydown", onKey);
  ov.onclick = (e) => {
    if (e.target === ov) close();
  };
  box.append(
    form,
    el("div", { className: "modal-actions" }, [
      el("button", { className: "chip", textContent: "Cancel", onclick: close }),
      el("button", {
        className: "chip primary",
        textContent: "Save",
        onclick: save,
      }),
    ]),
  );
  ov.appendChild(box);
  document.body.appendChild(ov);
  inputs.Opening.focus();
}
