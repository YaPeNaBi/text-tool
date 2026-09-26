# ASCII Diagram Editor — Architecture & Plan

Status: **M0–M6 landed; M7–M10 partial; M12–M14 specified and scaffolded.** Drawing,
typing, recognition, drill-through selection, moving, resizing, sticky connectors and
files work end to end on the web, covered by 116 unit tests and 31 browser tests. The
desktop build (M9) is the standing gap; composition, route finding and tables (M12–M14)
are the newly defined work.
Model: **Option C (grid-first + recognition)** — decided by you.
Revision: 7 (2026-08-18)

Companion documents:
- [behaviour-goals.md](behaviour-goals.md) — the precise behavioural contract, with IDs cited from code and tests
- [intuitive/](intuitive) — how it should *feel*, drawn out case by case: five documents of scenarios and the rules they settle
- [intuitive/plan.md](intuitive/plan.md) — how those rules become modules; the design behind M12–M14
- this file — architecture, technology and milestones

---

## 1. Assessment of the existing project (discovered)

I inspected `C:\Users\Yanik Perez\Desktop\away projects\ascii writer` in full.

| Question | Finding |
|---|---|
| Repository structure | **Empty.** Zero files, zero subdirectories, including hidden ones. |
| Git repository | **No.** `git status` → `fatal: not a git repository`. No `.git` anywhere up the tree. |
| Tech stack | **None yet.** No `package.json`, config files, lockfiles, or source. |
| Entry points | **None.** |
| Build system | **None.** |
| Existing components | **None.** |
| Existing diagram/editor functionality | **None.** Nothing to reuse, extend, or work around. |

**Adjacent folders:** `away projects\local server\` (Python file manager) and a standalone `index.html`. Grepped for `ascii|diagram|canvas|grid` — no matches. **You confirmed these are separate projects.** Out of scope.

**Toolchain on this machine (discovered):** Node **v22.19.0**, npm **11.6.4**. `pnpm` and `bun` not installed. Windows 10, PowerShell.

**Not yet present, required by your decisions:** a **Rust toolchain** (for desktop packaging, §6) — not currently installed.

**Licensing (recommendation):** ASCIIFlow is Apache-2.0. Build from our own model rather than porting its source, so attribution never becomes a question.

---

## 2. The document model — Option C (your decision)

> **Your decision, restated:** the document is a sparse map of `(x, y) → character`. Drawing a box immediately stamps `┌ ┐ └ ┘ + - |` into that map. Shapes stay editable through a **select mode** that algorithmically recognises a whole shape by analysing the cells around a seed point and following the lines outward.

This is now settled and the rest of this document is built on it. Two consequences worth naming up front, because they reorder everything:

- **Text export becomes free.** The document *is* the output. `toText()` is a bounding box and a row join. No rasterizer, no render pipeline, no divergence between what's on screen and what lands on the clipboard.
- **The recognizer becomes the heart of the product.** In a scene-first model the hard part is the render pipeline; here that difficulty moves wholesale into recognition. You already identified this — "shape recognition will be the real challenge." Agreed, and the plan below is organised around de-risking exactly that.

### 2.1 A cell is a character (your decision)

I proposed caching a 4-bit N/E/S/W connectivity mask per cell. **You rejected it, and that is the shipped design.** A cell is a `string`; the document is `Map<"x,y", string>` and nothing more.

Your reasoning was that a stored mask means recomputation and caching where per-interaction processing of the affected cells would do. That is right about the economics: a trace only walks the component under the cursor, which is small, so deriving connectivity on demand costs essentially nothing. The mask would have bought disambiguation, not speed — and disambiguation is available anyway from the glyph plus its neighbours.

**How connectivity works instead** (`src/core/charset/charsets.ts`, `src/core/grid/grid.ts`):

- Each known line glyph *declares* the directions it can connect to — `─` is E\|W, `┌` is S\|E, and so on (B-CONN-02).
- Two cells are adjacent only when **both** declare a connection toward each other, so a `─` beside a `│` is correctly not connected (B-CONN-03).
- The genuinely ambiguous glyphs are only `+` and `┼`. They declare all four directions and are then narrowed against the neighbours that actually connect back (B-CONN-04). This is where the mask would have helped, and it turns out to be about fifteen lines of code.
- Anything not in the glyph table is text: connectivity zero, never traced through (B-CONN-06).

Three things fall out of this that the mask version would only have approximated:

1. **A `.txt` file is a complete, exact document.** No sidecar, no metadata, nothing to re-infer on load, nothing that can drift out of sync with the characters.
2. **Drawn, pasted and hand-edited content are literally indistinguishable**, so B-REC-02 is true by construction rather than by discipline. The test suite covers a box drawn by the tool and the same box pasted as ASCII art; the recognizer cannot tell them apart because there is nothing to tell apart.
3. **The CRDT swap gets simpler** — `Map<string, string>` is about the friendliest shape a collaborative document can have (§7).

### 2.2 Provenance hints — optional, never load-bearing

When the box tool draws a box, it *knows* it drew a box. Stamping an optional `origin` id onto those cells would let the recognizer short-circuit: if a traced component's cells all share one `origin`, trust it and skip the matchers.

**Not built, and rightly so** — it is the same class of stored metadata you rejected in §2.1, and it carries a worse risk: if `origin` ever becomes *required* for an operation to work, we have quietly rebuilt a scene-first model with worse ergonomics.

Recorded here as a deliberate non-choice (D8). Revisit only if profiling shows recognition is too slow, which the current shape of the algorithm makes unlikely — a trace touches one component, not the document. If it is ever added, the invariant is: *with all `origin` fields stripped, the geometric recognizer must still return the provenance answer among its candidates.*

---

## 3. The recognizer (recommendation) — the core component

A pure function: `recognize(grid, seed) → Candidate[]`, ranked. No DOM, no state, fully golden-testable. Four stages.

```
  Grid + seed cell
        │
        │ ① trace        BFS over connected line-cells
        ▼                (adjacency derived from glyphs + neighbours)
  Component { cells }
        │
        │ ② segmentize   nodes = cells with degree ≠ 2
        ▼                edges = maximal straight runs between nodes
  RunGraph { nodes, runs }
        │
        │ ③ match        every registered matcher scores the graph
        ▼
  Candidate[]           ranked: contains-seed, then smallest, then most specific
        │
        │ ④ enrich       attach interior text, arrowheads, handles
        ▼
  Selection
```

**Stage ① — trace.** `[built]` Two cells are adjacent when both declare a connection toward each other: `A` allows `E` *and* `A+E` allows `W`. Component size is capped at 20 000 cells, beyond which it degrades to a raw cell-set selection rather than hanging the UI.

**Stage ② — segmentize.** `[built]` Collapse the pixel-level component into a graph: nodes are endpoints, corners and junctions; edges are straight runs. A 40×20 box becomes 4 nodes and 4 runs. Every matcher then operates on a structure with tens of elements, not thousands of cells — which is what makes this fast enough to run on every click.

*Current state:* the run graph is in (`recognize/segmentize.ts`) and the path matchers read degrees off it. The box matcher still works directly on the cell set — is it exactly the perimeter of its own bounding box? — which stays the cheapest correct test for the common case. What the graph has **not** yet been used for is ranking: finding *several* candidate rectangles inside one component, which is what nested and edge-sharing boxes need.

**Stage ③ — match.** A registry of matchers, each `(graph, seed) → Candidate | null`:

| Matcher | Detects |
|---|---|
| `rect` | 4-cycle of axis-aligned runs → **Box**. Returns the *smallest* rect containing the seed first; nested and adjacent rects each become separate candidates. |
| `polyline` | Open path between two degree-1 endpoints → **Line** |
| `arrow` | Polyline with an arrowhead glyph (`> < ^ v ▶ ◀ ▲ ▼`) at an endpoint → **Arrow** |
| `textRun` | Contiguous non-line glyphs on one row, whitespace-bounded → **Text** |
| `component` | Fallback: the whole traced set. Always succeeds, so selection is never a dead end. |

**Stage ④ — enrich.** For a closed shape, text cells strictly inside its bounds become its label (drag-together behaviour is configurable). Arrowheads adjacent to a path's endpoints join the path.

### 3.1 Ambiguity is inherent — design for it, don't fight it

Two boxes sharing an edge trace as one component. A line touching a box does too. There is no correct answer available from geometry alone, so the UI has to offer the choice:

- **Ranking:** contains-seed → smallest area → most specific matcher.
- **Drill-through:** repeated clicks on the same cell cycle candidates outward — cell → smallest rect → enclosing rect → whole component. Same mental model as group-drilling in vector editors. Status bar names the current interpretation ("Box 12×5").
- **Stickiness:** once a candidate is selected, it is pinned in session state for the duration of the interaction. Recognition never re-runs mid-drag. Invalidated on any document mutation.

### 3.2 Why this is the right thing to build first

The recognizer is pure, headless, and has zero UI dependencies. It can be built and hardened against golden fixtures — an ASCII text file plus a seed coordinate plus an expected shape — **before any canvas exists**. Recognition is where the bugs will live, and it is also the single most testable part of the system. That combination is why it lands at M4, ahead of the interactive select mode that consumes it.

---

## 4. Stamping, junctions and charsets (recommendation)

Drawing is the inverse of recognition and much simpler. Every tool produces a **`CellDiff`** — `Map<CellKey, string | null>` (null = erase) — which is the *only* way the document is ever mutated.

```
 tool gesture ──► stamper ──► CellDiff ──► store.apply(diff) ──► history
```

**Junction resolution at stamp time.** A stamped cell's connectivity is the union of three things: the geometry of the shape being drawn, whatever the existing cell there already connects to, and whatever adjacent cells connect back toward it. One 16-entry table per charset turns that union into a glyph. Corners, T-junctions and crossings all fall out with no special-casing — drawing a box flush against an existing box produces `┬` and `┴` at the shared column, which the test suite pins exactly.

**Charset packs** are plain tables. Two ship (`unicode`, `ascii`); `rounded`, `heavy` and `double` are one file each.

**Trade-off, stated plainly:** because glyphs *are* the document, switching charset is a **document-wide transform**, not a view toggle — it rewrites cells. It is one undoable command, and connectivity is re-derived per cell rather than looked up, so Unicode → ASCII → Unicode round-trips exactly. That round trip is a test, not an aspiration.

**Occlusion — a genuine limitation of grid-first.** The grid has no memory of what sits *under* something. Move a box that was covering a line, and those covered cells are gone.

**Resolved (D9): gesture-scoped restore, and it is already in.** Every frame of a drag recomputes the preview from the *unmodified* document, and the document is written exactly once on release. Dragging a shape across other content and back therefore leaves that content intact, because the intermediate positions were never written at all. What the shape lands on at the end is still overwritten permanently — recoverable only by undo (B-MAN-03, B-MAN-04). Permanent occlusion memory would require a z-ordered shape model, i.e. abandoning Option C.

The same rule is what makes one drag exactly one undo step, so it pays for itself twice.

---

## 5. Import & recognition of existing ASCII art (your decision #2: in scope)

You were right that Option C makes this substantially cheaper, and it's worth being precise about *why*: under a scene-first model, import needs a bespoke parser producing typed shapes. Under Option C, import is **paste into the grid** — always lossless, never fails — and understanding the pasted content is done by **the exact same recognizer already built for select mode**. Import and editing share one engine.

Dropping the stored mask (§2.1) makes this cheaper still. The whole pipeline is `text → cells`, one character per cell, tabs expanded — implemented, 20 lines, in `core/io/text.ts`. There is no inference step on load, because there is nothing to infer *into*. Pasted art is a first-class document the instant it lands.

The test suite already exercises this: it recognises a box the tool drew, and the same box pasted as `+--+` ASCII art, through the identical code path. Nothing distinguishes them, because there is nothing to distinguish.

Consequence for the plan: import needs **no separate recognition milestone**. Every improvement to the recognizer improves import automatically, and vice versa. Import lands at M8 as a thin feature on top of M4's engine.

The remaining hard cases are inherent to ASCII, not to our design — an ambiguous `+`, box-drawing mixed with ASCII fallbacks, tab-indented content, non-monospace-authored art. Handled by the same candidate-ranking machinery, and by normalising tabs on paste.

---

## 6. Delivery targets (your decision #3: web + Windows/Linux/macOS)

The structural requirement this creates is a **platform boundary**, introduced at M0 while it's free:

```ts
interface PlatformAdapter {
  openFile(): Promise<{ name: string; text: string } | null>;
  saveFile(name: string, text: string): Promise<void>;
  saveFileAs(name: string, text: string): Promise<string | null>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  recentFiles(): Promise<string[]>;
  onMenuCommand(handler: (cmd: string) => void): void;
}
```

Three implementations — `platform/web` (File System Access API, with a download fallback for Firefox/Safari), `platform/desktop` (Tauri APIs, native menus and dialogs), and `platform/terminal` (`node:fs`, and a dialog the shell draws on the bottom row). **Nothing else in the codebase may touch a file, a dialog or the clipboard.** One interface, one shared UI, no forked code paths.

### The terminal target (added after M8; not in the original three)

Not a decision that was taken here — a target the boundary turned out to have already paid for. `core/` was DOM-free for testability and `app/` talked only to `platform()`, so a second *shell* over the same store cost one directory (`src/terminal/`, six files) and no change to anything above it. It is worth naming three things it proved, because each was a claim this plan made without evidence:

1. **The boundary was real, not decorative.** A third implementation landed without touching `src/app/**`. The `PlatformAdapter` escape hatch that §6 justified as insurance against WebKitGTK got exercised for something else entirely.
2. **The extraction pressure was the same one the code already knew.** `tools.ts` exists because a list in two places drifts. Gaining a second renderer forced the same move three more times — `ribbon-items.ts` (the key band's rows), `canvas/steps.ts` (the directions and the stride), `canvas/palette.ts` (the colours) — and found a real drift already present: the ribbon's `jk` row had been updated in one copy only.
3. **One dependency direction had to be inverted.** `platform/index.ts` cannot statically import a Node adapter: Rollup follows the import and `node:fs` fails to resolve for the browser. So the shell installs its platform (`installPlatform`) rather than the index picking it, which is the direction `src-tauri/` already worked in.

It runs from source under Node's type stripping, with no build step — which is what makes `allowImportingTsExtensions` and the `.ts` on every import load-bearing rather than stylistic, and the reason the key band's data lives in a `.ts` rather than the `.tsx` that draws it.

What a tty cannot report — key releases, bare modifiers, `Ctrl` and a digit — costs six bindings, listed as data in `terminal/keymap.ts` and pinned by a test so the count cannot grow quietly. See the README for the table.

### Desktop shell: Tauri 2 (recommendation)

| | **Tauri 2** ← recommended | Electron |
|---|---|---|
| Binary size | ~5–15 MB | ~120 MB+ |
| Memory | Low (OS webview) | Full Chromium per app |
| Rendering consistency | **Varies by platform** (WebView2 / WKWebView / WebKitGTK) | Identical everywhere |
| Toolchain | Requires Rust | Node only |

The app's native surface is small — files, clipboard, menus — which is exactly where Tauri is strongest, and a 10 MB dev tool is a materially nicer thing to ship than a 120 MB one.

**The one real risk, and it's specific to this app:** we are building a *character grid*, so we depend on monospace font metrics being sane. WebKitGTK on Linux measures text differently from Chromium. Mitigations, both already in the plan for other reasons: measure metrics at runtime rather than hardcoding them (M1), and add a per-platform visual smoke test to CI (M9). If Linux rendering proves unworkable, swapping to Electron is a shell change, not an architecture change — the `PlatformAdapter` boundary is what makes that true.

**Distribution logistics (decisions D5, D6):** cross-platform builds need a GitHub Actions matrix (`windows-latest`, `ubuntu-latest`, `macos-latest`). macOS distribution outside the App Store needs signing + notarisation (Apple Developer, $99/yr) or users see Gatekeeper warnings. Windows needs a code-signing certificate or users see SmartScreen warnings. These are budget/logistics calls, not technical ones.

**VS Code extension** — noted as future, explicitly *not* a goal. The `core` module staying DOM-free (§7) is what keeps that door open at zero cost, since it's already required for testability.

---

## 7. Multiplayer readiness (your decision #4: door open, not built)

Option C is genuinely *better* positioned for this than a scene-first model would have been, and the reason is worth stating because it shapes the interface below.

A sparse `Map<string, string>` maps almost directly onto a CRDT map (Yjs `Y.Map` or an LWW-map) — and since §2.1 dropped per-cell metadata, the value type is a bare character, which is as simple as a synced document gets. Per-cell last-writer-wins is a defensible merge semantic for a character grid. Compare a scene-first model, where two users concurrently editing one shape's fields need real conflict resolution.

Better still: **recognition is a pure function of the grid.** There is no shared shape identity to synchronise — each client recomputes independently and arrives at the same answer. The hardest part of collaborative structured editors simply doesn't exist here.

Four cheap rules now, so the swap is a one-file change later. Total cost today: effectively zero.

1. **One mutation path.** Every write goes through `useEditor.apply(diff: CellDiff)`. No component ever writes a cell directly. Enforced by lint (§8) — `src/app/**` is forbidden from importing `applyDiff`, with the store as the single exception.
2. **Mutations are cell diffs** — coordinate-keyed and commutative-shaped already.
3. **No array indices or global counters in the document.** Keys are coordinates: stable, conflict-free.
4. **Session state stays out of the document.** Selection, camera, active tool, current recognition — these become presence/awareness data later, and must not be in the synced doc.

Not building: transport, server, auth, presence UI, CRDT dependency.

---

## 8. Technology stack (recommendation)

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Language | **TypeScript**, `strict` | The recognizer is graph code; discriminated unions on candidate kinds catch matcher-registry mistakes at compile time | JS |
| Build | **Vite** | Instant HMR, static output, first-class Tauri support | Next.js (no server); Webpack |
| UI | **React 19** | Chrome only — toolbar, panels, dialogs. Not the canvas | Svelte/Solid fine, smaller ecosystem |
| Canvas | **Canvas 2D**, hand-rolled | `fillText` per visible cell; direct blit from the grid, no render pipeline | DOM-per-cell (dies at scale); WebGL (unjustified) |
| State | **Zustand** | Renderer subscribes outside React, bypassing reconciliation on a hot canvas | Redux (ceremony); Context (re-render storms) |
| Undo/redo | **Hand-rolled `CellDiff` stack** | Cell diffs are *already* their own inverse structure (`{before, after}` per key). Simpler than patch libraries here | Immer patches — unnecessary once the doc is a flat map |
| Desktop | **Tauri 2** | §6 | Electron (fallback if WebKitGTK misbehaves) |
| Testing | **Vitest** + golden fixtures | Core is pure → `art.txt + seed → expected.json`. Highest value per line in this project | Jest (slower with ESM/TS) |
| E2E | **Playwright** from M6 | Drag-draw and drill-through are where regressions hide | — |
| CI | **GitHub Actions**, 3-OS matrix | Required by §6 | — |
| Package manager | **npm** | Already installed; pnpm/bun are not | pnpm/bun |
| Backend | **None** | Local-first; `.txt` on disk | Server, until multiplayer |

**Repo shape:** single Vite app, no monorepo. Hard internal boundary enforced by ESLint `no-restricted-imports`:

- `src/core/**` may not import React, the store, or touch `window`/`document`/`navigator` — **live**
- `src/app/**` may not import `applyDiff`; only `src/app/state/store.ts` may — **live**
- `src/app/**` may not import `src/platform/{web,desktop}/**` directly, only the `PlatformAdapter` interface — *pending, added with M8*

Lint rules that keep §7's multiplayer door, §6's platform split, and the core's testability honest without any human having to remember them.

### Directory layout

`✓` exists · `·` planned

```
src/
  core/                      # pure TS — no DOM, no React, no side effects
  ✓ geom/cell.ts             # Cell, Rect, CellKey math
  ✓ grid/grid.ts             # Grid, CellDiff, applyDiff, connectivity
  ✓ charset/charsets.ts      # mask→glyph tables, declared connectivity, arrowheads
    stamp/
    ✓ box.ts                 # rect → CellDiff, junction merging
    ✓ ellipse.ts             # circle → CellDiff, connected ring
    ✓ path.ts                # line/arrow → CellDiff, elbow, arrowheads
    ✓ erase.ts               # brush footprint + glyph repair
    ✓ text.ts                # typing, insert-mode shifting, paste
    · table.ts               # TableSpec → CellDiff                      (M14)
    recognize/               # ★ the heart
    ✓ trace.ts               #   ① connected component
    ✓ segmentize.ts          #   ② run graph
    ✓ recognize.ts           #   ③ box/ellipse/path/arrow/text + fallback
    ✓ rank.ts                #   ④ candidate ordering + drill-through
    · table.ts               #   the lattice matcher                     (M14)
    derive/                  # facts the characters imply, never stored  (M12)
    · contain.ts             #   children, descendants, container-of
    · label.ts               #   interior text, and how it was aligned
    · gather.ts              #   everything that travels with a shape
    · attach.ts              #   connectors attached to a shape (from route/)
    ops/                     # one planner per user operation            (M12)
    · plan.ts                #   ✓ Plan type, merge, refuse
    · move.ts                #   cascade, membership settle, re-route
    · resize.ts              #   refusals, connector re-route
    · typing.ts              #   grow-to-fit
    · table.ts               #   thirteen spec → spec operations         (M14)
  ✓ transform/               # move.ts, resize.ts, convert.ts
  ✓ history/history.ts       # CellDiff undo stack, run coalescing
  ✓ io/text.ts               # toText, fromText
    route/
    ✓ connectors.ts          # orchestration; sheds finding and side-choice
    · sides.ts               #   side selection, anchor placement, fan-out (M13)
    · cost.ts                #   ✓ terrain and the price list             (M13)
    · astar.ts               #   bounded, direction-aware search          (M13)
  ✓ platform/                # adapter.ts + web/ + desktop/ + index.ts
  app/
  ✓ state/store.ts           # sole mutation path; doc vs session split
  ✓ canvas/                  # camera.ts, renderer.ts, CanvasView.tsx
  ✓ components/              # Toolbar, StatusBar
  · tools/                   # registry, once the switch statement stops paying
✓ tests/                     # stamp, recognize, tools, shapes, connectors (116)
✓ e2e/                       # Playwright — the gesture surface (31 specs)
✓ src-tauri/                 # Rust shell — scaffolded, not yet compiled
tests/golden/                # *.txt + *.seed.json + *.expected.json
```

### The extensibility spine, restated for Option C

In a scene-first model a shape type is one `ShapeDef`. Here it is a **stamper/matcher pair**:

- a **stamper** — how to draw it (`params → CellDiff`)
- a **matcher** — how to recognise it (`RunGraph → Candidate | null`)

Adding cylinders, diamonds, tables or swimlanes later means writing those two functions and registering them. Nothing else changes. That symmetry is the property to protect in review: **if a new shape needs changes outside its stamper, its matcher, and two registry lines, the abstraction is leaking.**

### State split

One store, two clearly separated halves (they can split into two stores if that ever earns its keep):

- **document** — `grid` plus `revision`. Undoable, saved, and the only thing that would ever sync. Mutated exclusively via `apply(diff)`.
- **session** — selection, camera, active tool, charset choice, hover. Not undoable, not saved, not synced.

Conflating these is the classic way editor undo becomes maddening (Ctrl+Z changing your zoom). Free now, painful to retrofit.

**A detail worth recording**, because it bit during verification: gesture state (the in-flight drag) lives in a **ref**, with a state copy only so the canvas redraws. Reading drag state from React state inside a pointer handler goes stale whenever two pointer events land in the same tick — which happens with coalesced events and fast input, not just in synthetic tests. The ref is the source of truth; the state copy is for rendering only.

---

## 9. Milestones

Reordered around Option C. The recognizer is front-loaded because it is the project's main risk and needs no UI to build.

Because you asked for a working frontend now, M2–M6 were sliced vertically rather than completed in order: enough of each to make box → select → move real end to end. What each still owes is listed explicitly.

| # | Milestone | State | Contents / remaining |
|---|---|---|---|
| **M0** | Scaffold | **partial** | ✅ Vite + TS strict + Vitest + Playwright + ESLint with the core-purity, single-mutation-path and platform rules; local git. ⬜ 3-OS CI matrix |
| **M1** | Grid & viewport | **done** | Runtime font metrics, quadrant camera clamped at origin, pan (Space / middle-drag), wheel scroll, Ctrl+wheel zoom anchored on the pointer, direct-blit renderer, pointer→cell mapping, emphasised origin axes |
| **M2** | Typing & erase | **done** | `CellDiff` mutation path, undo/redo, `toText()`, copy, delete, text caret with insert/overwrite modes, typing runs coalesced to one undo step |
| **M3** | Draw tools & charsets | **done** | Box, circle, line, arrow, eraser and text stampers with junction merging and glyph repair; five charset packs including arrowheads; lossless conversion between all of them; live drag preview |
| **M4** | **Recognizer v1** ★ | **done** | trace, segmentize → run graph, box/ellipse/polyline/arrow/textRun matchers, cell-set fallback, candidate ranking. ⬜ *(optional)* golden fixture corpus |
| **M5** | Select mode | **done** | click-to-recognise, drill-through cycling with depth readout, marquee, highlight, stickiness, shift-add/remove, Ctrl+A |
| **M6** | Manipulate | **done** | move by drag and by arrow keys, delete, resize handles on boxes and circles, duplicate, gesture-scoped occlusion restore, one-drag-one-undo, 24 Playwright specs |
| **M7** | Sticky connectors | **partial** | ✅ On move, lines attached to the shape are detected and re-routed orthogonally (L when one end is anchored, Z when both are), in the same diff so one gesture is one undo step; the side is chosen from where the shapes ended up. ⬜ re-route on resize (M12), fan-out and obstacle avoidance (M13) |
| **M8** | I/O & persistence | **partial** | ✅ `.txt` as native format, paste import, recent names, `PlatformAdapter` with web, desktop and terminal implementations. ⬜ autosave, desktop path unverified |
| **M9** | Desktop packaging | **partial** | ✅ Tauri 2 shell, config, capabilities, icons, npm scripts. ⬜ **never compiled** — needs Rust 1.85+; installers, smoke tests, auto-update (D7) |
| **M15** | Terminal build | **done** | `src/terminal/` — a second shell over the same store: input decoder, keymap, mouse, and a cell-diffing renderer, run from source with no build step. Every key the web build has except the six a tty cannot report, and the eraser and freehand work by mouse. 41 specs. Not in the original plan; see §6 |
| **M10** | Extensibility hardening | **partial** | ✅ The circle was added as a stamper/matcher pair plus wiring, which is the proof the contract asked for. ⬜ write the contract down |
| **M12** | **Composition** ★ | specified | Containment, labels and the cascade. `derive/` for facts the characters imply; `ops/` for planners that return one diff or a refusal. Ships nesting §1–6 and content §1–6, §9. Everything below depends on it |
| **M13** | Route finding | specified | `route/astar.ts` over a terrain and a price list, bounded and able to fail; plus connector fan-out. Ships all of [pathfinding.md](intuitive/pathfinding.md) and completes M7 |
| **M14** | Tables | specified | `stampTable` / `matchTable` and thirteen `spec → spec` operations. Ships all of [tables.md](intuitive/tables.md) |
| **M11+** | Future | — | Multiplayer (§7), VS Code extension, SVG/PNG/Mermaid export, auto-layout, templates |

★ = the one the others depend on. M12 is where the shared machinery lives; M13 and M14
are independent of each other once it exists. Full design in
[intuitive/plan.md](intuitive/plan.md).

**M4 is done, and with it the project's main risk.** The run graph, the matchers, and — the part that decides whether this product works — ranking and drill-through. Two boxes sharing an edge are one connected component, and geometry alone cannot say which one you meant; `rank.ts` enumerates every rectangle whose border runs through the click instead of guessing, and repeated clicks walk that list. Being a pure function over text fixtures, it was also the cheapest thing in the project to validate.

**M7 has landed too**, and it turned out to lean on the recognizer rather than needing new machinery: a connector is found by asking which lines run into a shape, and re-routed with the same polyline stamper the line tool uses. The two lessons worth keeping are that a single elbow cannot hold both ends of a box-to-box arrow — parallel approaches need a Z — and that attachment has to be looser than *connection*, because a line drawn up to a `│` only touches it.

**Verified working end to end** (driven in a real browser, not just unit tests): draw an 11×5 box → exactly 28 border cells; click any border cell → recognised as `Box 11×5`; drag → moves, old position empties, new position holds the shape; undo → returns exactly; a second box drawn flush against the first → 51 cells, i.e. the shared column merged rather than duplicating; select-tool clicks and marquees never mutate the document; box glyphs tile with zero seams horizontally and vertically.

---

## 10. Risks & mitigations (recommendation)

| Risk | Severity | Mitigation |
|---|---|---|
| **Recognition ambiguity** — shared edges, nested boxes, lines touching boxes | **High** — inherent to Option C | Candidate ranking + drill-through cycling (§3.1); never silently guess; large golden suite from M4. **Live today:** edge-sharing boxes trace as one component and degrade to a cell set — correct, but the drill-through that makes it *usable* is still owed |
| **Occlusion data loss** — moving a shape destroys what was under it | **High** — inherent to grid-first | Gesture-scoped restore, shipped (§4). Final-position overwrite remains permanent by design; document the limitation in-app |
| Recognizer performance on pathological components | Medium | 20 000-cell trace cap with graceful fallback, shipped. Segmentize to a run graph before matching (M4) |
| Ambiguous `+` misread when narrowing against neighbours | Medium | Falls back to the declared mask when isolated (B-CONN-05); covered by the ASCII-art recognition and round-trip tests |
| Linux WebKitGTK font metrics break the grid | Medium | Runtime metric measurement, shipped and verified (zero seams at dpr 1 on Chromium); per-platform smoke tests (M9); Electron fallback behind `PlatformAdapter` |
| Charset switch is destructive | Low | Connectivity re-derived per cell, so Unicode→ASCII→Unicode is an identity round trip — pinned by test; single undo command |
| Multiplayer retrofit turns out expensive | Low | The four rules in §7; the mutation-path rule is lint-enforced today |
| Scope creep destabilises the core | Low | Every new shape is a stamper/matcher pair; anything that isn't is the signal to revisit this document |

---

## 11. Decisions still open

### Resolved

| | Decision | Outcome |
|---|---|---|
| **#1–#4** | Model, import, targets, multiplayer | Option C; import in scope; web + Windows/Linux/macOS; multiplayer door open but not built |
| **Cell contents** | Store a connectivity mask per cell? | **No.** A cell is a character; connectivity is derived on demand (§2.1) |
| **D1** | Default charset | **Unicode default, ASCII toggle.** Both shipped, conversion is lossless both ways |
| **D2** | Canvas bounds | **Quadrant plane, `(0,0)` top-left, unbounded right and down.** Camera clamped at the origin; `originMode` exists as a field so the Desmos-style infinite plane is a setting, not a refactor |
| **D3** | Native file format | **Plain `.txt`.** Diffable, git-friendly, opens anywhere — and with no per-cell metadata there is nothing a sidecar could even hold |
| **D8** | Provenance hints | **Not built** (§2.2). Same category as the rejected mask |
| **D9** | Occlusion | **Gesture-scoped restore**, shipped |

### Still open

| | Decision | My recommendation |
|---|---|---|
| **D4** | Touch/mobile support in scope? | **Desktop + keyboard first.** Drill-through selection needs real design work on touch |
| **D5** | macOS signing + notarisation budget ($99/yr)? | Needed for a friction-free Mac install; otherwise ship with a documented Gatekeeper workaround |
| **D6** | Windows code-signing certificate? | Same trade-off with SmartScreen. Can be deferred past M9 |
| **D7** | Desktop auto-update? | Tauri's updater is straightforward but needs a signing key and a hosted manifest. Defer to post-M9 |
| **D10** | Will this be published? | **`git init` done** — local repository, no remote. Publication would affect D5/D6 and the licence choice; still open |
| **D11** | Infinite-plane toggle: user-facing setting, or per-document? | Per-document, so a diagram that relies on negative space stays coherent when reopened |

---

## 12. Next step

The recognizer is finished, drill-through included, and connectors now follow the shapes
they point at. It is under test from both ends — 116 unit tests over the pure core, 31
browser tests over the gestures. The risky parts of this project are behind it.

What is missing is no longer capability, it is **composition**. The editor understands
individual shapes very well and understands nothing about how they relate: a box does not
know it contains another, a shape does not know what is written in it, and a route does not
know what is in its way. The five documents in [intuitive/](intuitive) work out what those
relationships should feel like, case by case; [intuitive/plan.md](intuitive/plan.md) works
out the modules.

**Next is M12, composition.** Two new module families, both scaffolded:

- **`derive/`** — containment, labels, attachment and the cascade, all recomputed on every
  gesture and never stored. Keeping them derived is what makes a pasted diagram behave
  identically to a drawn one, which is the equivalence the whole editor rests on.
- **`ops/`** — one pure planner per user operation, each returning a `Plan`: one diff, or a
  refusal with a reason. That turns three rules from discipline into structure — one
  gesture is one undo step, a resize may not destroy what it encloses, and no reflow is
  silent.

M12 ships nesting §1–6 and content §1–6 and §9, which between them are the two most-felt
gaps today: a container that does not carry its contents, and a box that leaves its own
label behind.

After that, in rough order of value:

1. **M13, route finding** — the only genuinely new algorithm in the project, and
   deliberately after M12 so it can be swapped without disturbing anything. Completes M7:
   connectors that go *around* things and fan out instead of merging.
2. **M14, tables** — the largest-looking item and the smallest, because it collapses onto
   the stamper/matcher spine: thirteen operations that are each a few lines of `spec → spec`.
   Probably the highest user value on this list, since tables are where the data in a
   drawing lives.
3. **`rustup update`, then verify the desktop build** — the shell is written and has never
   been compiled. Rust 1.76 here; a dependency needs edition 2024, so 1.85+.
4. **CI (M0)** — a three-OS matrix running `npm run check` and `npm run e2e`. The test
   suites exist now, so this is mostly YAML.
5. **Write down the stamper/matcher contract (M10)** — the circle proved it works, and M14
   will prove it twice; the document that says so is still missing.

The four phases inside M12–M14 are ordered so that stopping after any one leaves the editor
better than before, and only the first is a dependency of the others.
