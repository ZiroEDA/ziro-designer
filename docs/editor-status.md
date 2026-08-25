# Which editors are done, and what "done" was measured against

Ten launchers, each a port of a KiCad 10.0.5 frame. This is the record of how
far each has been taken and — more importantly — **what kind of evidence backs
the claim**, because "audited and matching" has already turned out not to mean
"identical" more than once.

## The four levels of evidence

Ranked by how much they are worth. A claim of completeness should say which of
these it rests on.

| | evidence | what it cannot catch |
|---|---|---|
| **E1** | code read against the pinned C++ | anything the code does not say — a control that renders but is never reached |
| **E2** | engine tests with a **real KiCad oracle** (its QA vectors, or files it wrote) | whether the panel reaches the engine at all |
| **E3** | the UI compared against a running KiCad, by a person or by measurement | behaviour: a field that displays and is then discarded |
| **E4** | the frame **driven end to end** and its output compared to real KiCad's | nothing known — this is the standard |

The gap between E2 and E4 is not academic. The PCB Calculator passed 99/99 of
KiCad's own QA vectors and a visual check, and **five of its fourteen panels
still gave wrong answers**, because the vectors called the engine directly and
nobody had typed into a box. Two of the tests that "covered" one of those bugs
asserted `zDiff === 2 * z0Odd` — an expectation computed from the code under
test, which passed while the variable was wrong.

## Status

### Complete

| editor | evidence | closed by |
|---|---|---|
| **PCB Calculator** | E1 + E2 + E3 + **E4** | #108, PRs #613 #617 |
| **Image Converter** | E1 + E2 + E3 + E4 | #105, PR #612 |

**PCB Calculator.** ~180 displayed strings read off real `pcb_calculator` over
the accessibility bus; 179 match character for character. The one that does not
is an E24 resistor formula whose answer depends on unspecified `std::sort`
tie-breaking, and KiCad's own ranking rule prefers ours — documented in the test
with the derivation rather than baselined. 106 settings keys pinned per entry
against a table extracted mechanically from `pcb_calculator_settings.cpp`.
All 39 unit selectors swept. Art files byte-identical to KiCad's own SVG
sources.

**Image Converter.** Conversion compared against files the real
`bitmap2component` wrote (`qa/data/bitmap2component/`), the threshold and
scroller driven when it was built, appearance checked by Akshay. Its output is
deliberately **not** byte-identical — see
`docs/`-adjacent note in the PR and the memory `bitmap2component-output-format`;
that decision is due a revisit now that the bare-atom reader gap is closed
(PR #616).

**A correction worth keeping.** The Drawing Sheet Editor was listed here as
complete after two audits had closed its frame and its tools. A third pass over
the six source files **neither audit had opened** found fifteen further gaps
(#619) — invented status strings, failures shown in the status line where
upstream raises a modal, one printed page where upstream prints two, and a
Preferences dialog with two checkboxes against upstream's four pages.

Nothing about the earlier work was wrong. The claim was: those audits had a
scope, the scope was not the whole editor, and "complete" was read as though it
were. **A completeness claim is only as wide as what was actually opened** —
which is why the table above names the evidence and this one names the files.

### Not complete

| editor | state |
|---|---|
| **Drawing Sheet Editor** (pl_editor) | frame and tools closed (PRs #604 #607 #614 #618, grid dot and axis skip both **measured** off a live pl_editor). **NOT complete**: issue #619 lists 15 gaps in the six source areas no audit had covered, headed by Preferences — upstream has four pages, we have one modal with two checkboxes |
| **Symbol Editor** | audited, PR #606. Open: enable/disable conditions (~150 lines), LIB_TREE chrome, three missing dialogs |
| **Footprint Editor** | audited, PR #608. Open: seven items, headed by the dialog wall — `dialog_pad_properties.cpp` alone is 2492 lines against our 297 total |
| **GerbView** | exporter is a real port of `GBR_TO_PCB_EXPORTER` (PR #605). No mapping dialog; aperture-macro holes export solid |
| **Schematic Editor** | tracker #195 |
| **PCB Editor** | tracker #200 |
| **3D Viewer**, **Project Manager** | not audited as units |

## Things measured once, worth not re-deriving

- **Dialog geometry is remembered per dialog TITLE.** `DIALOG_SHIM::Show`
  restores a saved rect keyed by the title (`dialog_shim.cpp:452-474`), and
  eeschema and pcbnew share `"Page Settings"`. Measured on a clean profile:
  pcbnew's true first open is **736 px** wide, eeschema's session value 923.
  We persist no dialog geometry at all — an app-wide gap, not a Page Settings
  one. `qa/probes/page_settings_width/` measures this.
- **KiCad is single-instance.** Launching a second `pcbnew` opens a window in
  the running process; a clean-profile measurement needs its own `HOME`.
- **The snap environment breaks a KiCad launch** (`__libc_pthread_init`); use
  `env -i` as `qa/probes/` does. A fresh profile shows a **KiCad Setup** dialog
  first.
