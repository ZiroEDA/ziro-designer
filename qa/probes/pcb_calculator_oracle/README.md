# Asking the real `pcb_calculator`

The calculator engine has KiCad's own QA vectors and passes 99/99, but every one
of those calls an engine function directly. Nothing had ever gone in through a
*panel*, and that is exactly where five bugs sat this week - Stripline showed the
`a` field and threw the number away, a unit selector converted the value beside
it where KiCad only recalculates, Track Width's cross-section ignored the width
selector's unit. Every engine test passed through all five.

So the end-to-end panel tests
(`qa/unittests/designer/calc_e2e_{general,power,highspeed,memo}.test.tsx`) need
expectations that our code cannot produce. This directory is where they come
from: the installed `/usr/bin/pcb_calculator` (KiCad 10.0.5), driven and read on
this machine.

## How it reads KiCad

`oracle.py` talks to the running app over **AT-SPI**. wxWidgets on GTK3 exposes
every `wxTextCtrl`, `wxStaticText`, `wxChoice` and `wxButton` on the
accessibility bus, so the harness can:

- read the **exact string** a field displays - `Atspi.Text.get_text`, not OCR
  and not a sampled pixel;
- **type** into a field - `Atspi.EditableText.set_text_contents`, which writes
  the `GtkEntry` buffer and therefore raises the same `wxEVT_TEXT` a keystroke
  does, so the panel recalculates for real;
- **press** a button or radio and **pick** a `wxChoice` item -
  `Atspi.Action.do_action`.

This is the same class of answer as the `wxWidgets` probes next door: the
toolkit is asked, not modelled.

`wxGrid` is the one thing AT-SPI cannot see - it is custom-drawn on a bare
`wxWindow` and its cells are not accessible objects. For the four table panels
(E-Series, Colour Code, Board Classes, Galvanic Corrosion, and the IPC-2221 half
of Electrical Spacing) the harness instead takes the widget's own screen
rectangle from `Atspi.Component.get_extents` and screenshots exactly that. The
captures are the `.png` files here and were read digit by digit.

## Three things that will waste a run

**`Atspi.Selection.select_child` moves nothing on a `wxChoice`.** It returns
`True` and the widget does not change, so every "switch the unit" case silently
measures the DEFAULT unit and agrees with itself. `Atspi.Action.do_action` on
the menu ITEM is what works. This cost a full harvest.

**libatspi caches children.** A stale tree reports the previous page's widgets,
which reads exactly like a page switch that did not happen. `find_app()` clears
the cache on every lookup.

**The VS Code snap environment breaks the launch** with
`symbol lookup error: /snap/core20/.../libpthread.so.0`. `launch.sh` scrubs
`GTK_PATH`, `GTK_EXE_PREFIX`, `LOCPATH`, `XDG_DATA_HOME` and friends and forces
`GDK_BACKEND=x11` so the window is also screenshottable under Xwayland. See
`../README.md`, which hit the same thing.

## Running it

    cp ~/.config/kicad/10.0/pcb_calculator.json ~/kicad-pcbcalc-json.BACKUP
    python3 harvest_power.py        # writes kicad_answers_1.json
    python3 harvest_general.py      # writes kicad_answers_2.json
    python3 harvest_transline.py    # writes kicad_answers_3.json

`oracle.py` rewrites `~/.config/kicad/10.0/pcb_calculator.json` to choose the
opening page, and KiCad rewrites it again on exit. **Back it up first and
restore it afterwards** - it is a real user's config. `oracle.restore()` does
both. Close the app by PID (`oracle.kill_all()`); never `xkill`, which has taken
`mutter-x11-frames` and the whole desktop down here before.

Every case name in the JSON files matches a comment in the test that consumes
it.

## What it found

- **Electrical Spacing** shipped the IPC-2221C (Dec 2023) table: eight classes
  `B1 B2 B3 B4 B5 A6 A7 A8`. KiCad 10.0.5 ships seven, `B1 B2 B3 B4 A5 A6 A7`,
  with different numbers under four shared headings. Fixed to mirror KiCad.
- **Cable Size** computed AWG diameters from `0.000127 * 92^((36-n)/39)` where
  KiCad hardcodes a 34-entry radius table. AWG12 printed 2.05253 mm against
  KiCad's 2.05232 mm. Fixed to KiCad's table.
