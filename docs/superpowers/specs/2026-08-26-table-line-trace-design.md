# Tracing a Line Through the Table — Design

**Goal:** Clicking a line's column in the table preview highlights every cell
that makes up that line, wherever those cells live, and fades the rest.

---

## 1. What is wrong today

Reading one line off the grouped table means stitching three places together.
After `elide()` (see the recursive-table-collapse design, §7), a line's own
column carries only its tail; the moves before it live in the Mainline column
and in each enclosing open group's column:

```
ply  Mainline  ▾ 2 lines  Line A   Line B
1.   e4        …          …        …
     e5        c5         …        …
2.   Nf3       Nf3        …        …
               d6¹        …        …
3.             …          Bb5+     d4     ← Line B is: e4 · c5 Nf3 d6 · d4
```

The elision is right — repeating the shared moves on every line pushed each
line's own continuation off to the right — but it leaves the reader to
reassemble the line by eye, across columns that are not adjacent and at nesting
depths that change as branches open and shut.

## 2. Naming

**Trace**, not focus. `visibility.js` already owns **Focus**, which hides every
other line. This hides nothing: it highlights in place. Reusing the word in the
UI or the code would make two unrelated behaviours share a name.

## 3. The rule

The chain is ordered, and each link spells a **contiguous run** of the line's
moves:

```
[ Mainline column, …enclosing open group columns, the line's own column ]
```

So the plies are handed out in order: each column claims from where the one
above it left off, for as long as it keeps spelling the line's moves.

**A per-ply SAN match is not enough**, and this is the whole reason for the
running index. The mainline of `1. e4 e5 2. Nf3` and the sideline
`1. e4 c5 2. Nf3` both play `Nf3` at ply 2, from different positions. Matching
ply by ply lights the Mainline column *again* after the line has already left
it. Claiming a run stops the Mainline column at the divergence with no index
stored anywhere — the moves simply stop matching. (Found by the first test
written against this rule; the earlier draft of this section had it wrong.)

Nested groups need no extra rule: each contributes its own shared range, and an
elided `…` is not a move, so it is never lit.

A line that ends exactly at its group's fork keeps its last move (elide's rule,
so the column is not empty), which means that move is spelled twice — once on
the group column, once on the line's own. Both light, via a one-ply look-back
before each column's run. Lighting only one would leave a lone unlit cell in a
traced line's own column, which reads as a bug.

A line that ends exactly at its group's fork keeps its last move (that rule
predates this work), so that move is spelled twice — once on the group column,
once on the line's. Both light. Lighting one and not the other would read as a
bug, since they are the same move.

## 4. Where the chain comes from

`pushNode` in `trie-view.js` already threads `depth` and `cut` down the
recursion. It gains a `trail`: the group vars enclosing the node, stashed on
each leaf var it pushes. That is the only change to the trie walk.

The Mainline column is `vars[0]` and is not produced by `pushNode`, so the
chain is assembled as `[mainV, ...v.trail, v]` at trace time.

## 5. `src/trace.js`

A new module, pure and DOM-free so the path logic is testable on its own:

```js
tracedKey(v)          // the var's SAN path — "e4 c5 Nf3 d6 d4"
tracePath(vars, key)  // -> Map(var -> Set(ply)), or null
```

**Keyed by SAN path, not object identity.** `grid()` rebuilds every var on every
render, so a stored var reference would be stale before the next click.

**Unresolvable keys return `null`.** If the traced line's column is gone — its
group folded, the line hidden or focused away — there is nothing to dim and no
stale state to clean up. Re-opening the group brings the trace back. This is
why no clearing hook is needed in the fold, hide, or focus handlers.

## 6. Rendering

`renderTable(container, grid, orientation, trace)` takes a 4th argument,
`{ litByVar, onTrace }`, **supplied only by `renderTrieTable`**.

- Each move cell gets `traced` or `faded`.
- A column header gets `traced` when its column contributes at least one lit
  cell, `faded` otherwise. Derived from `litByVar`, so the header cannot
  disagree with the cells under it.

`appendPrintTables` passes nothing, so the printed report has no dimming and no
click handlers — the same containment the grouping already has, pinned by a
test that sets a trace and asserts print emits neither class.

## 7. Interaction

**Move cells trace; headers fold.**

| Target | Behaviour |
| --- | --- |
| Any move cell, in any column | toggle the trace on that column's line |
| A **line** column's header | toggle the trace on that line |
| A **group** column's header | expand/collapse, unchanged |
| **Clear trace** chip in `.tbl-controls` | clears; shown only while a trace is resolved |

A collapsed group's move cells used to expand it. That made clicking a move to
see where it sits reshape the table under the reader — the one thing a reading
aid should not do. The ▸/▾ header is the labelled fold control and keeps that
job alone.

**What a group column traces: its stem** — every move from ply 0 down to the
last one the column spells out. A group stands in for several lines, so "that
line" has no other well-defined answer; the stem is how the reader *gets* to
the group, which is what the column is showing. It works the same open or shut.

A group column carries `traceKey` (its trie node key) rather than being keyed
by its stem's SAN path: a group whose stem is exactly some line's moves — a
line ending at the fork — would otherwise share that line's key and the two
would trace each other. The stem itself lives on the group var as `moves`,
which is what `tracePath` reads; it cannot reach the cards or the printed
report, because those build from `grid()` directly and this var only ever
enters the preview's list.

The toggle compares against the **resolved** trace rather than the stored key,
so clicking a line whose trace is currently invisible sets it rather than
clearing it. That is the only reading under which the click always does what it
appears to do.

Trace targets get their own `traceable` class rather than reusing `clickable`.
`clickable` means "this folds a branch" everywhere else in the table, and
quietly widening it to a second, unrelated affordance made three existing tests
fail — they count fold controls through it. Both classes set `cursor: pointer`.

Keyboard access follows `wireExpandControl`: focusable, `role="button"`,
Enter/Space, with `aria-pressed` for the toggle state.

No global Esc listener. The chip is discoverable, needs no teardown across
re-renders, and sits with the Expand all / Collapse all controls a reader is
already using.

## 8. Styling

A new `--trace` variable in both themes.

`.tbl tr td.traced` / `.tbl tr th.traced` take a filled accent background,
written at `tr td` specificity so they outrank the zebra striping and the group
shading — the same trick `.grp` uses for the same reason.

**`.faded` dims with `color` only, never `opacity`.** The sticky Mainline and
ply columns have opaque backgrounds that scrolled content would show through if
the cell were made translucent. The traced cells' fill carries the contrast, so
color-dimming is sufficient.

## 9. Testing

- **`tests/trace.test.mjs`** — chain resolution; the mainline prefix lights and
  stops at divergence; group columns light; nested groups; no cross-branch
  bleed; an unresolvable key returns `null`; a line ending at its fork lights
  both copies of its last move.
- **`tests/trie-view.test.mjs`** — cell and header classes; toggle on and off;
  a group column still folds rather than tracing.
- **`tests/print.test.mjs`** — print emits no trace classes with a trace active.

## 10. Out of scope

- No sync with the line editor's move selection.
- No persistence: session-only, like `openTablePaths`.
- No trace on group columns.
