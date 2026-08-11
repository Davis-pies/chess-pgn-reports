# Chess Opening Theory Table Builder — Design

**Date:** 2026-08-11
**Status:** Approved design (awaiting implementation plan)

## Overview

A single-page static web app that turns a chess PGN into a printable **opening
theory table** in the style of ECO / MCO / Nunn's Chess Openings. The user
imports a PGN, tags each variation as a **main line**, a **minor line**
(shown in parentheses), or a **footnote line** (shown in a numbered list at
the bottom), adds optional metadata, and exports a clean table document —
either as printed HTML or via the browser's **Print → Save as PDF** with
inline SVG board diagrams.

Hosted free on **GitHub Pages** (static files only). No backend, no accounts,
no build step. Data persists per-device in the browser's `localStorage`.

## Architecture

One `index.html` plus CSS and JS, served as static assets. `chess.js` is
loaded from a CDN for PGN parsing and move generation. The app is split into
small, independently testable modules:

- **`pgn`** — parse PGN text → plain variation-tree data (wraps chess.js).
- **`tree`** — walk and tag the variation tree; assign
  main/minor/footnote classification plus per-line metadata.
- **`table`** — convert the tagged tree into a grid model for **horizontal**
  (variations as columns) or **vertical** (variations as rows) layout.
- **`render`** — produce the HTML table and inline SVG board diagrams, plus
  the print stylesheet.
- **`store`** — `localStorage` save / load / list / delete of named notebooks.

Modules communicate through plain data objects. Each can be reasoned about and
tested without the others.

## Core Flow

1. **Import.** Paste PGN text or upload a `.pgn` file. Parsed into a
   variation tree (mainline plus sub-variations) using chess.js.
2. **Tag.** The app walks every variation and prompts the user with buttons:
   - **Main** — the central continuation (rendered bold).
   - **Minor** — shown in parentheses in the table.
   - **Footnote** — assigned a number, rendered in the footnote list at the
     bottom of the table.
   - Optional per-line metadata: **name** (e.g. "Marshall"),
     **evaluation symbol** (`=`, `±`, `∓`, `∞`, `+=`, `=/+`), **move-quality
     marks** (`!`, `?`, `!?`, `?!`), a **prose note**, and flags for
     **transposes elsewhere** (rendered as a dash `–`) and **covered
     elsewhere** (rendered **bold**).
3. **Render.** Builds the table document.
4. **Export.** Browser **Print → Save as PDF**. Board diagrams can be toggled
   on/off to control PDF size.

## Table Rendering

- **Layout toggle:**
  - *Horizontal:* variations extend as **columns** from the shared prefix.
  - *Vertical:* variations are **rows**, with ellipsis `...` for moves that
    repeat the line above.
- **Move-number column** on the left.
- Main lines rendered **bold**; minor lines wrapped in **parentheses**;
  footnotes numbered and collected into a list at the bottom, each with its
  move text and any note.
- **Heading moves** (the moves to reach the position) shown above the table;
  single-move column headers above each variation.
- **Ellipsis** collapsing for repeated moves in vertical layout.
- **Evaluation symbol** at the end of each variation.
- Long/many-column tables are **scrollable horizontally** rather than
  force-fit (no width squish).

## Persistence (localStorage)

- Named tables ("notebooks") saved to browser `localStorage`.
- Notebook list view: **reopen**, **edit**, **duplicate**, **delete**.
- Everything remains client-side; no server storage, no accounts, no sync.

## Out of Scope (v1) — YAGNI

- Accounts / multi-user / cloud sync.
- Engine evaluation / engine-drawn positions.
- Clickable-board move editing (a later enhancement if desired).
- Server-side PDF generation (browser print is sufficient).

## Error Handling

- Invalid / non-parseable PGN surfaces a clear message and lets the user
  correct/retry without losing input.
- Missing `localStorage` or quota failures degrade gracefully (session-only
  mode with a warning).

## Testing

- The pure logic modules — tree tagging, horizontal/vertical layout, ellipsis
  collapse — get small runnable self-check tests (assert-based), no framework.
- No tests for trivial glue/UI wiring.

## Deliverables / Repository

- Static site: `index.html`, CSS, JS modules, notebook persistence.
- Instructions in the README for enabling GitHub Pages on the repo.
- Deployed to GitHub Pages; reachable from desktop and phone browsers.
