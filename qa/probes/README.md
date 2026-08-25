# Asking the real toolkit

KiCad declares almost none of its own appearance. A control's colour, height,
padding and font come from GTK, and its dialog-unit sizes come from wxWidgets
asking GTK for a character cell. So when we need one of those numbers, there are
four ways to get it, and they are not equally good:

1. read Yaru's stylesheet - tells you what the theme declares, not what wx does
   with it;
2. sample a pixel out of a screenshot - one pixel, and only of whatever widget
   happened to be under it;
3. build the widget in Python with python-gi - measures the toolkit, but not the
   widget wx creates;
4. **build the widget with wxWidgets and ask it** - the same call KiCad makes,
   on this machine, with this theme and this font.

Only the fourth answers the question we are usually asking. The probes here do
that. They are small programs, not part of CI, and they exist so a number in
`designer/src/ui/shell.css` can carry a measurement instead of a guess.

## Building and running

The toolchain is already installed on the dev box (`libwxgtk3.2-dev`,
`libgtk-3-dev`, `g++`).

    cd qa/probes
    g++ -Wno-deprecated-declarations -o swatch_probe swatch_probe.cpp \
        $(wx-config --cxxflags --libs core,base) $(pkg-config --cflags --libs gtk+-3.0)

    env -i HOME="$HOME" PATH=/usr/bin:/bin USER="$USER" DISPLAY=:0 \
        XAUTHORITY="$XAUTHORITY" XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
        GDK_BACKEND=x11 ./swatch_probe

## Two things that will waste a run

**`env -i` is not optional.** A shell started from VS Code inherits the editor's
snap environment, and the snap's `libpthread` gets loaded ahead of the system
one:

    symbol lookup error: /snap/core20/.../libpthread.so.0:
    undefined symbol: __libc_pthread_init, version GLIBC_PRIVATE

Clearing `LD_LIBRARY_PATH` alone does not fix it. Scrub the whole environment
and put back only what GTK needs.

**`XAUTHORITY` is not `~/.Xauthority`.** On a Wayland session with Xwayland it
is `/run/user/<uid>/.mutter-Xwaylandauth.<random>`, the suffix changes per
session, and `~/.Xauthority` does not exist at all. Read it from the parent
environment rather than hardcoding a path. Get it wrong and you get
"Unable to initialize GTK+", then a segfault, because `wxEntryStart` carries on
with a null display.

## What is here

`swatch_probe.cpp` - font, `GetCharWidth()`, `GetCharHeight()`, DPI, and
`ConvertDialogToPixels` for the four `COLOR_SWATCH` dialog-unit constants.

`entry_probe.cpp` - a real `wxTextCtrl` measured three ways: what wx reports,
what the GTK style context of wx's own `GtkEntry` says, and the pixel that is
actually painted when the widget is rendered to a surface.

## What they settled

`COLOR_SWATCH` sizes. Two hand derivations from Pango metrics gave 42x22 and
26x22 for `SWATCH_MEDIUM`. The toolkit says **48x23**. Both derivations were
wrong in the same two places: `GetCharWidth()` returns 8, not the 7 that Pango's
`approximate_char_width` suggests, and `ConvertDialogToPixels` rounds where the
hand arithmetic truncated. The two derivations agreeing on 22 looked like
corroboration and was not - they shared the arithmetic, so they shared the
error.

The rule that came out of it: **any dialog-unit to pixel derivation here must
round, not truncate**, and two methods only corroborate when they are actually
independent.

`--field-bg`. The token carried a comment saying Yaru declares `#272727` for a
bare `GtkEntry` but that wx renders one level lighter, so the token was
`#282828`. A real `wxTextCtrl` reports `#272727` from all three of the methods
above, including the painted pixel. wx does not render lighter.

Three cross-checks fell out of the same run and all agree with the tree: the
parent `wxPanel` background is `#373737` (`--content-bg`), a disabled entry is
`#2a2a2a` (`--ctl-face-disabled`), and an entry allocates 34 px tall
(`--ctl-height`).

`chooser_cells_probe.cpp` - the file chooser's tree view: every column, every
cell renderer's `xpad`/`ypad`/fixed size and its position inside its column, the
column header button's padding, and the row's background versus cell area. Takes
a directory and a wildcard as arguments.

    ./chooser_cells_probe /home/akshay "All files (*)|*"

**Point it at a directory.** A chooser with no folder set opens on *Recent*,
whose tree view carries a different column set (Name / Location / Size / Type /
Accessed). Two numbers shipped wrong because they were read there - the row
height and the Type column width - so the probe prints the directory it was
given, and every reading should say which mode it was taken in.

It also prints how many `GtkTreeView`s the dialog contains, because the mistake
that started this was `next(w for w in ws if isinstance(w, Gtk.TreeView))`
picking one by position rather than by identity.

## `eseries_grid_probe.cpp`

`PANEL_ESERIES_DISPLAY` paints its grid rules with
`parent->GetBackgroundColour()` (panel_eseries_display.cpp:73-84), where the
parent is the frame's `wxTreebook`. That is a value GTK decides, and our CSS
had asserted it without a measurement — `--chrome-bg2`, documented as
`wxSYS_COLOUR_WINDOW`, was the plausible alternative. The probe builds the
wxTreebook and asks it:

    treebook GetBackgroundColour       rgb(44, 44, 44)  #2C2C2C
    wxSYS_COLOUR_WINDOW                rgb(39, 39, 39)  #272727
    wxGrid default label bg            rgb(55, 55, 55)  #373737

so `--chrome-bg` was right and is now measured rather than inferred, and the
stripe-gap columns' `GetLabelBackgroundColour()` is confirmed as `--ctl-face`.

## `stripline_oracle.cpp` — an engine oracle, not a widget one

The odd one out. It builds no widget and asks GTK nothing; it exists because
KiCad 10.0.5 ships no `test_stripline.cpp` and our stripline port had no direct
expectations at all, only the coupled-stripline vectors reaching it sideways.

Its two function bodies are KiCad's own source text, copied verbatim from
`common/transline_calculations/stripline.cpp` (`Analyse`, `lineImpedance`) and
`transline_calculation_base.cpp:147-159` (`SkinDepth`, `UnitPropagationDelay`),
with `GetParameter( TCP::X )` rewritten as a plain double. Nothing else is
changed. So what it prints is C++'s arithmetic, compiled by this machine's
compiler — an oracle the TypeScript under test cannot have influenced, which is
the whole reason it is worth having:

    g++ -O2 -o stripline_oracle stripline_oracle.cpp && ./stripline_oracle

The rows go straight into `qa/unittests/pcb_calculator/stripline_oracle.test.ts`.
The same trick is available for any of the other transline models, all of which
are similarly self-contained.

## Writing a new one

Copy either file. The pattern is `wxEntryStart`, `CallOnInit`, build the widget
you care about on a `wxFrame`, print, then return `false` from `OnInit` so no
main loop starts. If the widget needs to be styled and allocated before it can
be measured, show the frame and pump the GTK main loop a few times first, as
`entry_probe.cpp` does.

Measuring a widget is not changing one. A shared widget's number moves every
launcher, so a measurement goes to whoever owns that call, with the widget named
and the method shown.
