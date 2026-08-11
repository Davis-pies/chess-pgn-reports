// Browser glue: import PGN, tag each line, render the table, persist notebook.
import { parsePgn } from './pgn.js';
import { collectLines } from './tree.js';
import { grid } from './table.js';
import { renderTable } from './render.js';
import { saveNotebook, listNotebooks, loadNotebook, deleteNotebook, keyFor } from './store.js';

let current = { id: null, name: '', pgn: '', lines: [], orientation: 'vertical', showBoards: false };

const $ = (id) => document.getElementById(id);

function el(tag, props, children = []) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  (Array.isArray(children) ? children : [children]).forEach((c) =>
    typeof c === 'string' ? e.appendChild(document.createTextNode(c)) : e.appendChild(c)
  );
  return e;
}

function movesText(line, head = 6) {
  return line.moves.slice(0, head).map((m) => m.san).join(' ') + (line.moves.length > head ? ' …' : '');
}

function renderApp() {
  const v = $('view');
  v.replaceChildren();
  v.appendChild(viewRoot());
}

function viewRoot() {
  const wrap = el('div', { className: 'app' });
  if (!current.lines.length) {
    wrap.appendChild(importPanel());
    return wrap;
  }
  const top = el('div', { className: 'toolbar' });
  top.appendChild(
    el('button', { onclick: () => { current = { id:null, name:'', pgn:'', lines:[], orientation:'vertical', showBoards:false }; renderApp(); }, textContent: 'New / Import' })
  );
  const name = el('input', { value: current.name, placeholder: 'Notebook name', className: 'name' });
  name.oninput = () => { current.name = name.value; };
  top.appendChild(name);
  const save = el('button', { textContent: 'Save' });
  save.onclick = () => {
    if (!current.name) current.name = 'Untitled';
    saveNotebook(current.id || (current.id = 'n' + Date.now()), { name: current.name, pgn: current.pgn, lines: current.lines });
    save.textContent = 'Saved ✓';
    setTimeout(() => (save.textContent = 'Save'), 1200);
  };
  top.appendChild(save);
  wrap.appendChild(top);

  wrap.appendChild(notebookList());

  wrap.appendChild(orientationToggle());
  wrap.appendChild(markupPanel());
  wrap.appendChild(tablePreview());
  wrap.appendChild(exportBar());
  return wrap;
}

// Live table preview; this is what print/PDF renders (controls hidden by CSS).
function tablePreview() {
  const box = el('div', { className: 'preview' });
  box.appendChild(el('h3', { textContent: 'Table' }));
  renderTable(box, grid(current.lines), current.orientation, { showBoards: current.showBoards });
  return box;
}

function notebookList() {
  const items = listNotebooks();
  const box = el('div', { className: 'notebooks' });
  if (!items.length) return box;
  items
    .filter((n) => n.id !== current.id)
    .forEach((n) => {
      const b = el('button', { className: 'chip', textContent: `Open: ${n.name || n.id}` });
      b.onclick = () => openNotebook(n.id);
      const del = el('button', { className: 'chip danger', textContent: '✕' });
      del.onclick = () => { if (confirm(`Delete "${n.name}"?`)) { deleteNotebook(n.id); box.remove(); } };
      const cell = el('span', {}, [b, del]);
      box.appendChild(cell);
    });
  return box;
}

function openNotebook(id) {
  const nb = loadNotebook(id);
  if (!nb) return;
  try {
    const { nodes } = parsePgn(nb.pgn);
    if (!nodes.length) return;
    const lines = collectLines(nodes);
    // re-apply tags
    lines.forEach((l) => {
      const k = keyFor(l.moves);
      const t = (nb.tags || []).find((x) => x.key === k);
      if (t) { l.tag = t.tag; l.name = t.name; l.meta = t.meta || {}; }
    });
      current = { id, name: nb.name, pgn: nb.pgn, lines, orientation: current.orientation, showBoards: current.showBoards };
    } catch { current = { id: null, name: '', pgn: '', lines: [], orientation: 'vertical', showBoards: false }; }
  renderApp();
}

function orientationToggle() {
  const bar = el('div', { className: 'orow' });
  bar.appendChild(el('span', { textContent: 'Layout: ' }));
  const h = el('button', { className: 'chip' + (current.orientation === 'horizontal' ? ' on' : ''), textContent: 'Horizontal' });
  h.onclick = () => { current.orientation = 'horizontal'; renderApp(); };
  const v = el('button', { className: 'chip' + (current.orientation === 'vertical' ? ' on' : ''), textContent: 'Vertical' });
  v.onclick = () => { current.orientation = 'vertical'; renderApp(); };
  bar.append(h, v);
  const b = el('label', {}, ['Board diagrams ', el('input', { type: 'checkbox', checked: current.showBoards })]);
  b.querySelector('input').onchange = (e) => { current.showBoards = e.target.checked; renderApp(); };
  bar.appendChild(b);
  return bar;
}

function markupPanel() {
  const box = el('div', { className: 'markup' });
  box.appendChild(el('h3', { textContent: 'Tag variations — main / minor / footnote' }));
  current.lines.forEach((l, idx) => {
    box.appendChild(lineEditor(l, idx));
  });
  box.appendChild(
    el('button', { className: 'chip', textContent: 'Tag remaining as minor', onclick: () => { current.lines.forEach((l) => { if (!l.tag) { l.tag = 'minor'; } }); renderApp(); } })
  );
  return box;
}

function lineEditor(l, idx) {
  const row = el('div', { className: 'ledge' });
  const tag = l.tag || '';
  const btn = (t, txt) => {
    const b = el('button', { className: 'chip tag ' + t + (tag === t ? ' on' : ''), textContent: txt });
    b.onclick = () => { l.tag = l.tag === t ? null : t; renderApp(); };
    return b;
  };
  row.appendChild(el('div', { className: 'lmoves', textContent: `${idx === 0 ? 'MAINLINE' : 'Line ' + idx}: ${movesText(l)}` }));
  const tags = el('div', { className: 'tags' });
  tags.append(btn('main', 'Main'), btn('minor', 'Minor'), btn('foot', 'Footnote'));
  row.appendChild(tags);
  const name = el('input', { className: 'ln', placeholder: 'name (e.g. Marshall)', value: l.name || '' });
  name.oninput = () => { l.name = name.value; };
  const ev = el('input', { className: 'le', placeholder: 'eval (=, ±, ∞)', value: (l.meta && l.meta.eval) || '' });
  ev.oninput = () => { l.meta = { ...(l.meta||{}), eval: ev.value }; };
  const note = el('input', { className: 'lno', placeholder: 'note', value: (l.meta && l.meta.note) || '' });
  note.oninput = () => { l.meta = { ...(l.meta||{}), note: note.value }; };
  row.append(name, ev, note);
  return row;
}

function exportBar() {
  const bar = el('div', { className: 'export' });
  const printBtn = el('button', { className: 'chip', textContent: 'Print / Save as PDF' });
  printBtn.onclick = () => window.print();
  bar.appendChild(printBtn);
  return bar;
}

function importPanel() {
  const box = el('div', { className: 'panel' });
  box.appendChild(el('h2', { textContent: 'Chess Opening Theory Table Builder' }));
  box.appendChild(el('p', { textContent: 'Import a PGN. Variations in parentheses become separate taggable lines.' }));
  const ta = el('textarea', { className: 'pgnin', rows: 10, placeholder: '1. e4 e5 2. Nf3 Nc6 (2... Nf6 3. d4) 3. Bb5' });
  const file = el('input', { type: 'file', accept: '.pgn,text/plain' });
  file.onchange = () => {
    const f = file.files[0];
    if (f) f.text().then((t) => { ta.value = t; });
  };
  const go = el('button', { textContent: 'Load & Tag' });
  go.onclick = () => {
    try {
      const { nodes } = parsePgn(ta.value);
      if (!nodes.length) { alert('No moves found in PGN'); return; }
      current = { id: current.id, name: '', pgn: ta.value, lines: collectLines(nodes), orientation: 'vertical', showBoards: false };
      renderApp();
    } catch (e) {
      alert('Could not read PGN: ' + e.message);
    }
  };
  box.append(ta, el('div', {}, [file, go]));
  return box;
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('view')) return;
  renderApp();
});
