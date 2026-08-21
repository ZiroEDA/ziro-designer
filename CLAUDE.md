# Working on Ziro Designer

Ziro Designer is a port of KiCad 10.0.5 to the browser. The reference source is
pinned at `/home/akshay/kicad-reference` — read that, never KiCad master, because
the parity target is the installed build.

The goal is that a user cannot tell whether they are in KiCad or in ours.

## The central-value rule

**Wherever KiCad gets a value from a shared place, we must get it from ours.
Never a local literal.**

| KiCad asks | we ask |
|---|---|
| the GTK theme (`wxSYS_*`, `gtk-font-name`, the Yaru stylesheet) | the tokens in `designer/src/ui/shell.css` |
| `common/` — `EDA_TEXT`, `SEG`, `StrNumCmp`, `COLOR4D`, `PLOTTER` statics | `common/src/**` |
| a base class every subclass inherits | one shared module, never a per-editor copy |
| its own data table — resistor bands, layer palette | mirror *that data*; do not invent |

**This is not only fonts.** It covers colours, sizes, spacing, row pitch, control
metrics, pen widths, strings, and the widgets themselves.

### Chrome versus data

- **Chrome** is anything the theme decides: a face colour, a border, a font, a
  control height, padding. A literal here means we have drifted, because KiCad
  never wrote one — it asked GTK, and that single answer is why all of KiCad's
  launchers look like each other.
- **Data** is a value KiCad itself hardcodes: the resistor colour-code bands, the
  galvanic series, the built-in colour themes. These stay local, but must mirror
  KiCad's own table rather than our invention.

A surviving literal should carry a comment saying which of the two it is.

### Why this keeps happening

1. `.ze-app`, the root every launcher inherits from, hardcoded `13px` and a
   `"Segoe UI"` stack while `--ui-font-size` and `--ui-font-family` sat unused in
   the same file.
2. The drawing sheet wrote every metric as a literal — label font 11px against
   KiCad's 14.67, row pitch 26 against 37 — and its notebook tabs rendered in
   **Arial**, because a bare `<button>` takes the user-agent font unless
   something says `font: inherit`.
3. The calculator re-invented the GTK theme in `calculator.css`: 13px/system-ui,
   `#1d1f23` fields, `#55585e` borders, and an orange Calculate button that
   exists nowhere in `pcb_calculator`.

### Specificity is the trap that hides the fix

A launcher-local rule at (0,2,0) silently beats a shared widget at (0,1,0), so
fixing the shared thing changes nothing at the call site. The fix is never to
restate the right value locally — it is to state **nothing** locally.

## Verifying a change

- Verify by **mutating the implementation** and confirming a test fails.
  Typecheck every mutant *before* running its tests: one that does not compile is
  a false negative, not a kill. Score build failures separately from survivors.
- **Mutate the test too.** Four shapes of test cannot fail: an expectation
  computed by calling the code under test; a file-level check where the rule is
  per-occurrence; a value nothing ever reads; and a rule scoped to the directory
  a bug was found in.
- If a behaviour change moves **zero** existing expectations, that is the
  finding: the behaviour was never pinned.
- Never re-baseline a moved expectation to whatever the new code prints.
  Re-derive it from the C++ or from a measurement, and say why it is right.
- **Confirm every mutant actually applied.** An edit whose anchor missed leaves
  the file untouched, and an untouched file passes its tests - indistinguishable
  from a mutant that was killed. Assert the file changed before scoring it, and
  commit the baseline first: a sweep that restores with `git checkout --` over
  an uncommitted baseline reverts the feature on its first restore.
- **A number GTK or wx decides can be measured, not guessed.** `qa/probes/`
  builds the widget with wxWidgets and asks it - the same call KiCad makes, on
  this machine, with this theme. That beats reading Yaru's stylesheet, sampling
  a screenshot pixel, or deriving from Pango metrics; all three have been wrong
  here. Two derivations agreeing corroborate only if they are independent.

## CI

`biome check .` judged by the **error count** at `--diagnostic-level=error`
(unused imports are warnings here, not errors), `pnpm -r typecheck`,
`pnpm -r test`, `pnpm -C designer build`.

**The biome baseline is not the same in every tree.** In the main checkout it is
`Found 1 error`, and that one comes from a gitignored `.claude/settings.local.json`.
A fresh worktree does not have that file, so **its baseline is zero** and biome
prints no `Found` line at all. Read the count against the tree you are in: in a
worktree, `Found 1 error` means you have introduced one, not that you are green.
Confirm it by running biome on a pristine worktree of `origin/main` if in doubt.

`designer/save_cost` and `eeschema/writer_kicad_grammar` are wall-clock
assertions and flake under load — re-run in isolation before believing either.

## Durability

Scratch space under `/tmp` is wiped without warning. Anything worth keeping —
findings, captures, harnesses — belongs in `$HOME` or in the repo. Commit each
coherent piece as you finish it rather than at the end.
