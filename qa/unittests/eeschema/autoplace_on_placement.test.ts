// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a symbol autoplaces its fields.
 *
 * `SCH_DRAWING_TOOLS::PlaceSymbol` calls `AutoplaceFields( ..., AUTOPLACE_AUTO )`
 * at both of its placement points (sch_drawing_tools.cpp:484-499), gated on
 * `m_AutoplaceFields.enable`, which defaults to true (eeschema_settings.cpp:328).
 * Ours ran the autoplacer only from the O hotkey and the menu, so a placed
 * symbol kept the field positions its library gave it.
 *
 * The part that made this visible is that for most symbols the library
 * positions are NOT where KiCad draws the fields. Connector:Screw_Terminal_01x02
 * stores Reference at (0, 2.54) and Value at (0, -5.08), directly above and
 * below the body, and KiCad shows both stacked to the right of it, because the
 * autoplacer will not leave a field over the pins.
 *
 * Geometry below is the real one from
 * /usr/share/kicad/symbols/Connector.kicad_sym: body (-1.27, 1.27) to
 * (1.27, -3.81), and two pins at x = -5.08, so the left side is the occupied
 * one and right is the free side the autoplacer must choose.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import {
  autoplacedFields,
  autoplacedLibFields,
  autoplacePlacedSymbol,
  libPreviewFields,
} from '@ziroeda/eeschema/src/tools/autoplace_fields.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { SchField, Vec2 } from '@ziroeda/eeschema/src/types.js';

const LIB = `(lib_symbols
  (symbol "Connector:Screw_Terminal_01x02" (pin_names (offset 1.016) hide)
    (property "Reference" "J" (at 0 2.54 0))
    (property "Value" "Screw_Terminal_01x02" (at 0 -5.08 0))
    (symbol "Screw_Terminal_01x02_0_1"
      (rectangle (start -1.27 1.27) (end 1.27 -3.81)))
    (symbol "Screw_Terminal_01x02_1_1"
      (pin passive line (at -5.08 0 0) (length 3.81) (name "Pin_1") (number "1"))
      (pin passive line (at -5.08 -2.54 0) (length 3.81) (name "Pin_2") (number "2")))))`;

/** The symbol as the chooser hands it over: fields still at library positions. */
const doc = readSchematic(
  parse(`(kicad_sch (version 20250114) (generator "x") ${LIB}
    (symbol (lib_id "Connector:Screw_Terminal_01x02") (at 100 100 0) (unit 1) (uuid "j1")
      (property "Reference" "J1" (at 100 97.46 0))
      (property "Value" "Screw_Terminal_01x02" (at 100 105.08 0))))`),
);

const sym = doc.symbols[0]!;
const lib = doc.libSymbols.find((l) => l.libId === 'Connector:Screw_Terminal_01x02');
const OPTS = { allowRejustify: true, alignToGrid: true };

/** The right-hand edge of the body, in schematic IU at the symbol's origin. */
const bodyRight = mmToIU(100 + 1.27);
const field = (fields: readonly SchField[], key: string): SchField => {
  const f = fields.find((x) => x.key === key);
  if (!f) throw new Error(`no ${key} field`);
  return f;
};
/** A field's position; every field in these fixtures carries one. */
const at = (fields: readonly SchField[], key: string): Vec2 => {
  const p = field(fields, key).at;
  if (!p) throw new Error(`${key} has no position`);
  return p;
};

describe('a symbol placed from the chooser', () => {
  it('has its fields moved clear of the pins, to the right of the body', () => {
    const fields = autoplacedFields(sym, lib, OPTS);

    // The claim from KiCad's own render: both fields sit beside the body, not
    // above and below it where the library put them.
    expect(at(fields, 'Reference').x).toBeGreaterThan(bodyRight);
    expect(at(fields, 'Value').x).toBeGreaterThan(bodyRight);
  });

  it('leaves the library positions behind rather than keeping them', () => {
    const fields = autoplacedFields(sym, lib, OPTS);

    // Guards the actual bug: the fields arrived centred on the body's x and
    // stayed there. If the autoplacer ever stops running, x returns to the
    // symbol origin and both of these fail.
    expect(at(fields, 'Reference').x).not.toBe(mmToIU(100));
    expect(at(fields, 'Value').x).not.toBe(mmToIU(100));
  });

  it('stacks Reference above Value, as it does on the sheet', () => {
    const fields = autoplacedFields(sym, lib, OPTS);

    // Schematic Y grows downward, so "above" is the smaller Y. The order is
    // the field order, and swapping them would leave the value on top.
    expect(at(fields, 'Reference').y).toBeLessThan(at(fields, 'Value').y);
  });

  it('left-justifies them, so the text runs away from the body', () => {
    const fields = autoplacedFields(sym, lib, OPTS);

    // fieldHPlacement: on the right side the anchor is the box's left edge and
    // the text is left-justified, which is why KiCad's "Screw_Terminal_01x02"
    // starts beside the body and extends rightward.
    for (const key of ['Reference', 'Value']) {
      expect(field(fields, key).effects?.justify ?? []).toContain('left');
    }
  });
});

describe('the gate the placement tool applies', () => {
  it('autoplaces when the preference is on, which is its default', () => {
    const placed = autoplacePlacedSymbol(sym, lib, true, OPTS);

    expect(at(placed.fields, 'Reference').x).toBeGreaterThan(bodyRight);
    expect(at(placed.fields, 'Value').x).toBeGreaterThan(bodyRight);
  });

  it('leaves the symbol exactly alone when the preference is off', () => {
    // `if( m_frame->eeconfig()->m_AutoplaceFields.enable )` guards both call
    // sites, so with it off a placed symbol has to keep the library positions.
    const placed = autoplacePlacedSymbol(sym, lib, false, OPTS);

    expect(placed).toBe(sym);
    expect(at(placed.fields, 'Reference').x).toBe(mmToIU(100));
  });

  it('takes the sheet into account only once the symbol has landed', () => {
    // The two upstream calls differ in the screen argument alone, so it has to
    // actually reach the algorithm. A drawable area that stops just past the
    // body makes the right-hand side unusable: a field placed there would run
    // off the page, which `collidingSides` counts as a collision. The symbol
    // still on the cursor has no screen and cannot know that.
    const landedSheet = {
      doc,
      libById: new Map(doc.libSymbols.map((l) => [l.libId, l])),
      drawableArea: {
        minX: mmToIU(80),
        minY: mmToIU(80),
        maxX: mmToIU(112),
        maxY: mmToIU(125),
      },
    };

    const onCursor = autoplacePlacedSymbol(sym, lib, true, OPTS);
    const landed = autoplacePlacedSymbol(sym, lib, true, OPTS, landedSheet);

    expect(landed.fields).not.toEqual(onCursor.fields);
  });
});

describe('the chooser preview autoplaces the library symbol too', () => {
  it('moves the library symbol own properties beside the body', () => {
    // `SYMBOL_PREVIEW_WIDGET::DisplaySymbol` autoplaces before it measures
    // (symbol_preview_widget.cpp:229-233), which is why KiCad's preview shows
    // "J" and "Screw_Terminal_01x02" stacked to the right of the terminal
    // rather than above and below it.
    const fields = autoplacedLibFields(lib!, true, OPTS);

    // Library coordinates, so the body's right edge is at x = 1.27mm.
    expect(at(fields, 'Reference').x).toBeGreaterThan(mmToIU(1.27));
    expect(at(fields, 'Value').x).toBeGreaterThan(mmToIU(1.27));
  });

  it('hands back the library own properties when the preference is off', () => {
    expect(autoplacedLibFields(lib!, false, OPTS)).toBe(lib!.properties);
  });

  it('starts from the library positions, which are above and below', () => {
    // Guards the fixture rather than the code: if the library ever stored the
    // fields beside the body already, the test above would pass for the wrong
    // reason and prove nothing about the autoplacer.
    expect(at(lib!.properties, 'Reference').x).toBe(0);
    expect(at(lib!.properties, 'Value').x).toBe(0);
  });
});

describe('the preview fits the fields it draws, not their anchors', () => {
  it('measures each field as a box with real width', () => {
    // `GetUnitBoundingBox` takes the text extent
    // (symbol_preview_widget.cpp:238-239). "Screw_Terminal_01x02" is twenty
    // characters and far wider than the 2.54mm body, so a box that has no
    // width means the anchor is being measured instead of the text, and the
    // value string hangs off the side of the pane.
    const { boxes } = libPreviewFields(lib!, true, OPTS);
    const value = boxes.find((b) => b.key === 'Value');

    expect(value).toBeDefined();
    expect(value!.box.w).toBeGreaterThan(mmToIU(2.54));
  });

  it('so the fitted extent is wider than the body alone', () => {
    const { boxes } = libPreviewFields(lib!, true, OPTS);
    const right = Math.max(...boxes.map((b) => b.box.x + b.box.w));

    // The body ends at x = 1.27mm; the fitted box has to reach past the value
    // text that sits beyond it.
    expect(right).toBeGreaterThan(mmToIU(1.27) + mmToIU(2.54));
  });

  it('reports boxes for the autoplaced positions, not the library ones', () => {
    const placed = libPreviewFields(lib!, true, OPTS);
    const raw = libPreviewFields(lib!, false, OPTS);

    expect(placed.fields).not.toEqual(raw.fields);
    expect(placed.boxes.map((b) => b.box.x)).not.toEqual(raw.boxes.map((b) => b.box.x));
  });
});

// ---------------------------------------------------------------------------
// the seam a `.ts` module cannot cover
// ---------------------------------------------------------------------------

/**
 * The gate above is reachable and pinned. The last inch is not: the two calls
 * that hand a symbol to it live in `SchematicCanvas.tsx`, inside a component
 * that draws through WebGL and cannot be mounted in this environment.
 *
 * A mutation sweep says so rather than assuming it. With only the assertions
 * above in place, deleting the drop path's call outright, so that a placed
 * symbol keeps its library field positions, which is precisely the bug this
 * change fixes, failed NOT ONE test.
 *
 * So this is a source-text check and it is honest about being one: it pins
 * spelling, not behaviour, in the manner of
 * `editor_default_toggles.test.ts`'s own seam block. The two call sites are
 * asserted separately because the rule is per-occurrence: upstream autoplaces
 * at both of its placement points, and one of them quietly losing its call is
 * the regression worth catching.
 */
const CANVAS = readFileSync(
  fileURLToPath(
    new URL(
      '../../../designer/src/editors/schematic/components/SchematicCanvas.tsx',
      import.meta.url,
    ),
  ),
  'utf8',
);

const RENDERER = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/schematic/render/renderer.ts', import.meta.url),
  ),
  'utf8',
);

const PREVIEW_WIDGET = readFileSync(
  fileURLToPath(
    new URL(
      '../../../designer/src/editors/schematic/widgets/symbol_preview_widget.tsx',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('the preview paints in the theme the user chose', () => {
  it('asks the shared hook, as the editor canvas does', () => {
    // `::GetColorSettings( app_settings->m_ColorTheme )`
    // (symbol_preview_widget.cpp:77-78), not a fixed theme.
    expect(PREVIEW_WIDGET).toContain('useSchematicTheme()');
  });

  it('does not pin itself to KiCad Classic', () => {
    // Classic's LAYER_SCHEMATIC_BACKGROUND is legacy('WHITE'), which is why
    // this pane stayed pure white while the editor drew rgb(245, 244, 239).
    expect(PREVIEW_WIDGET).not.toContain('KICAD_CLASSIC');
  });
});

describe('the chooser preview measures and draws the autoplaced fields', () => {
  it('autoplaces before it measures, so the fit leaves room for them', () => {
    expect(RENDERER).toContain('libPreviewFields(lib, true, {');
  });

  it('draws them, which upstream does and we did not', () => {
    expect(RENDERER).toContain('for (const f of previewFields) drawField(ctx, f, theme, false);');
  });

  it('measures BOTH corners of each field box, not just its origin', () => {
    // Dropping the far corner leaves the fit measuring anchors again, which is
    // the bug this replaced, and every engine-level assertion above still
    // passes because they test the boxes rather than the fit that uses them.
    expect(RENDERER).toContain('inc({ x: b.box.x, y: b.box.y });');
    expect(RENDERER).toContain('inc({ x: b.box.x + b.box.w, y: b.box.y + b.box.h });');
  });
});

describe('the placement paths hand their symbol to the autoplacer', () => {
  it('does it for the symbol still riding the cursor, with no sheet', () => {
    // `AutoplaceFields( nullptr, AUTOPLACE_AUTO )`: dropped = false.
    expect(CANVAS).toContain('onAutoplacePlacement(ghost, placeLib, false)');
  });

  it('does it again for the symbol that lands, with the sheet', () => {
    // `AutoplaceFields( screen, AUTOPLACE_AUTO )`: dropped = true.
    expect(CANVAS).toContain('onAutoplacePlacement(ready, placeLib, true)');
  });
});
