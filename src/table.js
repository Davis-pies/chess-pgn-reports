// Converts tagged lines into a cell grid shared by both (horizontal/vertical)
// table layouts. cell[variation][ply] is undefined where a variation has no
// move at that ply (blank cell), or a display object {text, cls}.
// Shared-prefix plies before a variation's divergence point render as ellipsis.

export function divergence(line, main) {
  let i = 0;
  const a = line.moves;
  const b = main.moves;
  while (i < a.length && i < b.length && a[i].san === b[i].san) i++;
  return i;
}

export function grid(lines) {
  const main = lines.find((l) => l.isMain) || lines[0];
  const vars = lines.map((l) => {
    const d = l.isMain ? 0 : divergence(l, main);
    const cells = {};
    l.moves.forEach((m, i) => {
      let text, cls;
      if (i < d) {
        text = '\u2026'; // ellipsis for shared prefix
        cls = 'ellip';
      } else {
        text = m.san;
        cls = l.isMain
          ? 'main'
          : l.tag === 'main'
            ? 'main'
            : l.tag === 'minor'
              ? 'minor'
              : 'foot';
      }
      cells[m.ply] = { text, cls };
    });
    return {
      name: l.name || '',
      tag: l.tag || 'minor',
      eval: (l.meta && l.meta.eval) || '',
      fen: l.fen,
      cells,
    };
  });
  const maxPly = vars.reduce(
    (m, v) => Math.max(m, ...Object.keys(v.cells).map(Number)),
    0
  );
  return { vars, maxPly, mainMoves: main.moves };
}
