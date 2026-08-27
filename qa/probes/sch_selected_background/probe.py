#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 ZiroEDA and contributors.
"""
What KiCad *actually composites* for a selected item's background fill.

`SCH_PAINTER::getRenderColor` (eeschema/sch_painter.cpp, tail) says:

    else if( aItem->IsSelected() && isBackgroundLayer( aLayer ) )
        // Selected items will be painted over all other items, so make backgrounds
        // translucent so that non-selected overlapping objects are visible
        color = color.WithAlpha( 0.5 );

The screen does not agree. This probe measures what the GAL puts on the glass,
because a colour the compositor decides can be measured rather than guessed.

METHOD
  Real eeschema 10.0.5 (/usr/bin/eeschema, `kicad-cli version` = 10.0.5), the
  user's own config, theme `_builtin_default`, sheet background (245,244,239).
  A generated schematic whose symbol bodies are rectangles with known fills is
  opened, driven by XTEST (Escape / Ctrl+A / a single click -- keyboard and one
  click, never a drag), captured with `import -window`, and sampled at the
  mid-height of each rectangle so no edge antialiasing is included.

  Launching needs the snap env scrubbed, or eeschema dies in libpthread:
    env -u GTK_PATH -u GTK_EXE_PREFIX -u GTK_IM_MODULE_FILE -u GIO_MODULE_DIR \
        -u GTK_MODULES GDK_BACKEND=x11 DISPLAY=:0 setsid eeschema <file>
  Close it by PID. Never xkill a KiCad window here: xkill on one killed GNOME's
  mutter-x11-frames process and no X11 window mapped again until a re-login.

RESULT  (fills_unselected.png / fills_selected.png)
  Nine fills, unselected -> selected, sampled at mid-height:

    fill c              unselected        selected          alpha*c + (1-alpha^2)*bg
    (0,0,0)             (0,0,0)           (184,184,180)     (184,183,179)
    (128,128,128)       (128,128,128)     (248,248,244)     (248,247,243)
    (255,0,0)           (255,0,0)         (255,184,180)     (255,183,179)
    (0,255,0)           (0,255,0)         (184,255,180)     (184,255,179)
    (0,0,255)           (0,0,255)         (184,184,255)     (184,183,255)
    (200,100,50)        (200,100,50)      (255,234,205)     (255,233,204)
    (60,180,220)        (60,180,220)      (214,255,255)     (214,255,255)
    (255,255,255)       (255,255,255)     (255,255,255)     (255,255,255)
    (255,255,194) bg    (255,255,194)     (255,255,255)     (255,255,255)

  Fits 9/9 to within 1 LSB with alpha = 0.5:  out = clamp(0.5*c + 0.75*dst).
  The weights sum to 1.25, so this is NOT any alpha blend.

CONTROLS -- KiCad's compositing is otherwise textbook correct
  * explicit_alpha_unselected.png: UNSELECTED fills at explicit alpha
    0.25/0.5/0.75 over the sheet measure (184,184,180) / (123,122,120) /
    (61,61,60) -- exactly alpha*c + (1-alpha)*bg, 8/8. So the extra weight is
    specific to the selected path, not to translucency.
  * `kicad-cli sch export svg` on the same file emits `fill:#FFFFC2` for the
    body -- KiCad's own plotter resolves the colour exactly as we do, flat.
  * `(fill (type none))` and `(fill (type outline))` are unchanged by selection.
    FILLED_SHAPE is a foreground-layer fill, so that is correct.

WHICH DESTINATION?  (overlap_unselected.png / overlap_selected.png)
  0.5c + 0.75*dst and 0.5c + 0.5*dst + 0.25*bg agree whenever dst is the sheet,
  so they were separated with a dst far from the sheet: a selected grey
  (100,100,100) body overlapping an UNSELECTED opaque black one, clicked on the
  part of the grey body that overhangs, so only the grey is selected.

    region                                  predicted M1   predicted M2   measured
    grey over black (the discriminator)     (50,50,50)     (111,111,110)  (50,50,50)
    grey over sheet (control)               (234,233,229)  (234,233,229)  (234,234,230)
    black alone (still unselected)          (0,0,0)        (0,0,0)        (0,0,0)

  61 levels apart, exact hit on M1. The destination weight follows whatever is
  underneath, not the sheet colour.

MECHANISM (hypothesis, NOT verified against the C++)
  0.75 = 1 - 0.5^2. A destination weight of 1 - alpha^2 instead of 1 - alpha is
  what you get when a buffer's ALPHA channel is blended with GL_SRC_ALPHA where
  it should use GL_ONE, so the alpha is premultiplied twice. Selected items are
  the ones drawn into the GAL's overlay target
  (`m_view->SetLayerTarget( LAYER_SELECT_OVERLAY, KIGFX::TARGET_OVERLAY )`,
  eeschema/sch_draw_panel.cpp:166), which is a separate compositor buffer; the
  cached target's content is opaque, so its composite is lossless and only the
  overlay shows the artifact. That is consistent with every measurement here but
  no line of KiCad source was found stating it.

  This is therefore a MEASUREMENT of observed pixels, not a ported rule. It
  contradicts getRenderColor's stated WithAlpha( 0.5 ) and KiCad's own plotter.
  If KiCad changes its compositor this becomes wrong: re-run this probe.

RE-RUNNING
  python3 probe.py            writes /tmp/.../selbg.kicad_sch and prints the
                              launch line; drive and capture as described above.
"""
import sys

BG = (245, 244, 239)          # LAYER_SCHEMATIC_BACKGROUND, _builtin_default
DEVICE_BACKGROUND = (255, 255, 194)   # LAYER_DEVICE_BACKGROUND, same theme

#: alpha getRenderColor forces onto a selected item's background-layer fill.
SELECTED_ALPHA = 0.5
#: Measured destination weight. 1 - SELECTED_ALPHA**2, not 1 - SELECTED_ALPHA.
SELECTED_DST_WEIGHT = 0.75


def composite(c, dst=BG, alpha=SELECTED_ALPHA, dst_weight=SELECTED_DST_WEIGHT):
    """The measured law, for checking a prediction before capturing."""
    return tuple(min(255, round(alpha * a + dst_weight * b)) for a, b in zip(c, dst))


MEASURED_SELECTED_OVER_SHEET = {
    (0, 0, 0): (184, 184, 180),
    (128, 128, 128): (248, 248, 244),
    (255, 0, 0): (255, 184, 180),
    (0, 255, 0): (184, 255, 180),
    (0, 0, 255): (184, 184, 255),
    (200, 100, 50): (255, 234, 205),
    (60, 180, 220): (214, 255, 255),
    (255, 255, 255): (255, 255, 255),
    DEVICE_BACKGROUND: (255, 255, 255),
}
#: The discriminating capture: selected (100,100,100) over unselected (0,0,0).
MEASURED_OVER_BLACK = ((100, 100, 100), (0, 0, 0), (50, 50, 50))


def _lib(name, hw, hh, col):
    return f'''\t\t(symbol "Probe:{name}"
\t\t\t(pin_names (offset 1.016) (hide yes))
\t\t\t(exclude_from_sim no) (in_bom yes) (on_board yes)
\t\t\t(property "Reference" "J" (at 0 {hh + 6} 0) (effects (font (size 1.27 1.27))))
\t\t\t(property "Value" "{name}" (at 0 {-hh - 6} 0) (effects (font (size 1.27 1.27))))
\t\t\t(symbol "{name}_1_1"
\t\t\t\t(rectangle (start {-hw} {hh}) (end {hw} {-hh})
\t\t\t\t\t(stroke (width 0.254) (type default))
\t\t\t\t\t(fill (type color) (color {col[0]} {col[1]} {col[2]} 1))
\t\t\t\t)
\t\t\t)
\t\t)'''


def _inst(name, uuid, ref, x, y, hh):
    return f'''\t(symbol
\t\t(lib_id "Probe:{name}")
\t\t(at {x} {y} 0)
\t\t(unit 1)
\t\t(exclude_from_sim no) (in_bom yes) (on_board yes) (dnp no)
\t\t(uuid "{uuid}")
\t\t(property "Reference" "{ref}" (at {x} {y - hh - 6} 0) (effects (font (size 1.27 1.27))))
\t\t(property "Value" "{name}" (at {x} {y + hh + 6} 0) (effects (font (size 1.27 1.27))))
\t\t(instances (project "selbg" (path "/11111111-1111-1111-1111-111111111111" (reference "{ref}") (unit 1))))
\t)'''


def overlap_schematic():
    """The discriminating file: grey body over black body.

    The FIRST instance in the file is drawn on TOP, so the grey one -- the one
    that gets selected -- is listed first. Click its overhang, never the
    overlap, or KiCad puts up a disambiguation menu.
    """
    return f'''(kicad_sch
\t(version 20250114)
\t(generator "eeschema")
\t(generator_version "10.0")
\t(uuid "11111111-1111-1111-1111-111111111111")
\t(paper "A3")
\t(lib_symbols
{_lib("BlackBox", 30, 20, (0, 0, 0))}
{_lib("GreyBox", 30, 12, (100, 100, 100))}
\t)
{_inst("GreyBox", "33333333-3333-3333-3333-333333333333", "B1", 190, 120, 12)}
{_inst("BlackBox", "22222222-2222-2222-2222-222222222222", "A1", 150, 120, 20)}
\t(sheet_instances (path "/" (page "1")))
)
'''


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'selbg.kicad_sch'
    with open(out, 'w') as f:
        f.write(overlap_schematic())
    print(f'wrote {out}')
    print('predicted selected grey over black:', composite((100, 100, 100), (0, 0, 0)))
    print('predicted selected grey over sheet:', composite((100, 100, 100)))
