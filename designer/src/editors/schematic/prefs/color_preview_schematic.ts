// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The sample schematic Preferences > Colors previews —
 * `PANEL_EESCHEMA_COLOR_SETTINGS::createPreviewItems`
 * (`eeschema/dialogs/panel_eeschema_color_settings.cpp:245-470`).
 *
 * It is not the open project and it is not a file on disk: upstream builds the
 * items in code, one per colour worth showing — a wire, a bus and its two
 * entries, notes lines, a plain text, a local / global / hierarchical label, a
 * junction, a no-connect, an op-amp with three pins, and a sheet with a pin —
 * over a User page of 6000 x 5000 mils whose title block reads "Color Preview".
 * Every coordinate below is upstream's own `MILS_POINT`, converted to the
 * millimetres the file format uses (`x mils * 0.0254`).
 *
 * Written as `.kicad_sch` text and parsed rather than assembled as TypeScript
 * objects, for two reasons: the s-expression IS the schematic model's own
 * language, so the transcription can be read against the C++ line by line; and
 * it goes through the same reader every real document does, so the preview
 * cannot drift into a shape the renderer does not otherwise meet.
 *
 * The preview is drawn by the ordinary `renderSchematic` with the theme the
 * page is editing, which is the whole point of it: change a colour and this
 * repaints in that colour, exactly as upstream's `KIGFX::VIEW` does.
 */
import { parse } from '@ziroeda/sexpr';
import { readSchematic, type Schematic } from '@ziroeda/eeschema';

/**
 * The uuid of the one item `createPreviewItems` selects, `t2` — `LABEL_{0}`
 * (`panel_eeschema_color_settings.cpp:355`). Our renderer takes a selection as
 * a set of item ids, and `refId` is the uuid, so the document has to name it.
 */
const SELECTED_LABEL_UUID = '00000000-0000-0000-0000-00000000la00';

/** `schIUScale.MilsToIU( n )` in the file format's millimetres. */
const mil = (n: number): string => (n * 0.0254).toFixed(4);

/**
 * `m_titleBlock->SetDate( wxDateTime::Now().FormatDate() )` (`:254`).
 *
 * `FormatDate` is the C locale's `%x` — "08/31/2026" on this machine — and
 * `toLocaleDateString` is the browser's own answer to the same question. The
 * preview does therefore change from day to day, exactly as KiCad's does.
 */
const today = (): string => new Date().toLocaleDateString();

/**
 * `m_page->SetWidthMils( 6000 ); m_page->SetHeightMils( 5000 )` (`:255-256`)
 * with `PAGE_SIZE_TYPE::User`, and the title `_( "Color Preview" )` (`:252`).
 */
const PREVIEW_TEXT = `(kicad_sch (version 20250114) (generator "ziro")
  (paper "User" ${mil(6000)} ${mil(5000)})
  (title_block (title "Color Preview") (date "${today()}"))

  ${/* `lines`, `:271-284`: nine wires, two bus segments, four notes lines. */ ''}
  (wire (pts (xy ${mil(1950)} ${mil(1500)}) (xy ${mil(2325)} ${mil(1500)})) (stroke (width ${mil(6)}) (type solid)))
  (wire (pts (xy ${mil(1950)} ${mil(2600)}) (xy ${mil(2350)} ${mil(2600)})) (stroke (width ${mil(6)}) (type solid)))
  (wire (pts (xy ${mil(2150)} ${mil(1700)}) (xy ${mil(2325)} ${mil(1700)})) (stroke (width ${mil(6)}) (type solid)))
  (wire (pts (xy ${mil(2150)} ${mil(2000)}) (xy ${mil(2150)} ${mil(1700)})) (stroke (width ${mil(6)}) (type solid)))
  (wire (pts (xy ${mil(2925)} ${mil(1600)}) (xy ${mil(3075)} ${mil(1600)})) (stroke (width ${mil(6)}) (type solid)))
  (wire (pts (xy ${mil(3075)} ${mil(1600)}) (xy ${mil(3075)} ${mil(2000)})) (stroke (width ${mil(6)}) (type solid)))
  (wire (pts (xy ${mil(3075)} ${mil(1600)}) (xy ${mil(3250)} ${mil(1600)})) (stroke (width ${mil(6)}) (type solid)))
  (wire (pts (xy ${mil(3075)} ${mil(2000)}) (xy ${mil(2150)} ${mil(2000)})) (stroke (width ${mil(6)}) (type solid)))
  ${/* `stroke.SetWidth( MilsToIU( 12 ) )` for a bus (`:298-299`). */ ''}
  (bus (pts (xy ${mil(1750)} ${mil(1300)}) (xy ${mil(1850)} ${mil(1300)})) (stroke (width ${mil(12)}) (type solid)))
  (bus (pts (xy ${mil(1850)} ${mil(2500)}) (xy ${mil(1850)} ${mil(1300)})) (stroke (width ${mil(12)}) (type solid)))
  ${/* LAYER_NOTES keeps the default line style rather than being forced solid. */ ''}
  (polyline (pts (xy ${mil(2350)} ${mil(2125)}) (xy ${mil(2350)} ${mil(2300)})) (stroke (width ${mil(6)}) (type default)))
  (polyline (pts (xy ${mil(2350)} ${mil(2125)}) (xy ${mil(2950)} ${mil(2125)})) (stroke (width ${mil(6)}) (type default)))
  (polyline (pts (xy ${mil(2950)} ${mil(2125)}) (xy ${mil(2950)} ${mil(2300)})) (stroke (width ${mil(6)}) (type default)))
  (polyline (pts (xy ${mil(2950)} ${mil(2300)}) (xy ${mil(2350)} ${mil(2300)})) (stroke (width ${mil(6)}) (type default)))

  ${/* `:315-327`: the no-connect and the two bus-wire entries. */ ''}
  (no_connect (at ${mil(2350)} ${mil(2600)}))
  (bus_entry (at ${mil(1850)} ${mil(1400)}) (size ${mil(100)} ${mil(100)}) (stroke (width 0) (type default)))
  (bus_entry (at ${mil(1850)} ${mil(2500)}) (size ${mil(100)} ${mil(100)}) (stroke (width 0) (type default)))

  ${/* `:329-348`: PLAIN TEXT, two local labels, a global and a hierarchical. */ ''}
  (text "PLAIN TEXT" (at ${mil(2650)} ${mil(2240)} 0) (effects (font (size 1.27 1.27))))
  ${
    /* `t2->SetSelected()` (`:355`) — one item is selected on purpose, so
       LAYER_SELECTION_SHADOWS has something to show. */ ''
  }
  (label "LABEL_{0}" (at ${mil(1975)} ${mil(1500)} 0) (uuid "${SELECTED_LABEL_UUID}")
    (effects (font (size 1.27 1.27)) (justify left bottom)))
  (label "LABEL_{1}" (at ${mil(1975)} ${mil(2600)} 0) (effects (font (size 1.27 1.27)) (justify left bottom)))
  ${
    /* `SCH_GLOBALLABEL`'s own shape is `L_BIDI` (`eeschema/sch_label.cpp:2021`),
       not input, and `SetSpinStyle( SPIN::LEFT )` is 180 degrees with a right
       justification (`SCH_LABEL_BASE::GetSpinStyle`). */ ''
  }
  (global_label "GLOBAL[0..3]" (shape bidirectional) (at ${mil(1750)} ${mil(1300)} 180) (effects (font (size 1.27 1.27)) (justify right)))
  (hierarchical_label "HIER_LABEL" (shape input) (at ${mil(3250)} ${mil(1600)} 0) (effects (font (size 1.27 1.27)) (justify left)))
  (junction (at ${mil(3075)} ${mil(1600)}) (diameter 0) (color 0 0 0 0))

  ${
    /* `:354-440`: the op-amp. A three-point filled polygon on the device layer
       and three pins, drawn at p = (2625, 1600) with the body reaching 200 mils
       either side. `FILLED_WITH_BG_BODYCOLOR` is `(fill (type background))`. */ ''
  }
  (lib_symbols
    (symbol "preview:OPA604" (pin_names (offset 0)) (in_bom no) (on_board no)
      (property "Reference" "U1" (at ${mil(30)} ${mil(260)} 0) (effects (font (size 1.27 1.27)) (justify left)))
      (property "Value" "OPA604" (at ${mil(30)} ${mil(180)} 0) (effects (font (size 1.27 1.27)) (justify left)))
      (symbol "OPA604_0_1"
        (polyline (pts (xy ${mil(-200)} ${mil(200)}) (xy ${mil(200)} ${mil(0)}) (xy ${mil(-200)} ${mil(-200)}) (xy ${mil(-200)} ${mil(200)}))
          (stroke (width ${mil(10)}) (type solid)) (fill (type background))))
      (symbol "OPA604_1_1"
        (pin input line (at ${mil(-300)} ${mil(100)} 0) (length ${mil(100)})
          (name "-" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin input line (at ${mil(-300)} ${mil(-100)} 0) (length ${mil(100)})
          (name "+" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
        (pin output line (at ${mil(300)} ${mil(0)} 180) (length ${mil(100)})
          (name "OUT" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27))))))))
  (symbol (lib_id "preview:OPA604") (at ${mil(2625)} ${mil(1600)} 0) (unit 1)
    (property "Reference" "U1" (at ${mil(2655)} ${mil(1340)} 0) (effects (font (size 1.27 1.27)) (justify left)))
    (property "Value" "OPA604" (at ${mil(2655)} ${mil(1420)} 0) (effects (font (size 1.27 1.27)) (justify left))))

  ${/* `:442-449`: the sheet at (4000,1300), 800 x 1300 mils, and its pin. */ ''}
  (sheet (at ${mil(4000)} ${mil(1300)}) (size ${mil(800)} ${mil(1300)})
    (stroke (width 0) (type solid)) (fill (color 0 0 0 0.0000))
    (property "Sheetname" "SHEET" (at ${mil(4000)} ${mil(1240)} 0) (effects (font (size 1.27 1.27)) (justify left bottom)))
    (property "Sheetfile" "/path/to/sheet" (at ${mil(4000)} ${mil(2660)} 0) (effects (font (size 1.27 1.27)) (justify left top)))
    (pin "SHEET PIN" input (at ${mil(4000)} ${mil(1500)} 180) (effects (font (size 1.27 1.27)) (justify right))))
)`;

/**
 * The preview document, parsed once. It never changes — only the theme it is
 * drawn with does — so there is nothing to rebuild per repaint.
 */
export const COLOR_PREVIEW_SCHEMATIC: Schematic = readSchematic(parse(PREVIEW_TEXT));

/**
 * `t2->SetSelected()` — the selection the preview is drawn with, so the page
 * shows what LAYER_SELECTION_SHADOWS looks like. Nothing else is selected.
 */
export const COLOR_PREVIEW_SELECTION: ReadonlySet<string> = new Set([SELECTED_LABEL_UUID]);
