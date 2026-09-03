// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Defaults for New Objects" (Preferences > Schematic Editor > Editing
 * Options), which `SCH_DRAWING_TOOLS` stamps onto an item as it is created.
 *
 * These are defaults for NEW objects and not a theme: nothing re-reads the
 * preference afterwards, so a sheet drawn while the border default was red
 * stays red when the default changes. Both halves of that matter — the value
 * has to reach the item, and it has to stop there.
 */
import { describe, expect, it } from 'vitest';
import { parse, serialize } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib, writeSchematic } from '@ziroeda/eeschema';
import { makeSheet } from '@ziroeda/eeschema/src/tools/build-graphics.js';
import { addItems } from '@ziroeda/eeschema/src/tools/mutate.js';
import {
  applyNewPowerSymbolType,
  NewPowerSymbols,
} from '@ziroeda/eeschema/src/tools/new_object_defaults.js';

const MM = 10000;
const AT = { x: 100 * MM, y: 100 * MM };
const SIZE = { w: 30 * MM, h: 20 * MM };
const EMPTY = readSchematic(
  parse(
    '(kicad_sch (version 20250114) (generator "eeschema") (sheet_instances (path "/" (page "1"))))',
  ),
);

/** The sheet as it would be WRITTEN, which is the only thing that survives. */
const written = (sheet: ReturnType<typeof makeSheet>): string =>
  serialize(writeSchematic(addItems({ sheets: [sheet] }).apply(EMPTY)));

describe('the border of a sheet as it is drawn', () => {
  it('is the default line thickness, in mils, not a fixed 6', () => {
    // `SetBorderWidth( schIUScale.MilsToIU( cfg->m_Drawing.default_line_thickness ) )`
    // (`sch_drawing_tools.cpp:3444`).
    expect(makeSheet(AT, SIZE, 'S', 's.kicad_sch', { borderWidthMils: 12 }).stroke?.width).toBe(
      Math.round(12 * 0.0254 * MM),
    );
    expect(makeSheet(AT, SIZE, 'S', 's.kicad_sch', { borderWidthMils: 6 }).stroke?.width).toBe(
      Math.round(6 * 0.0254 * MM),
    );
  });

  it('falls back to DEFAULT_LINE_WIDTH_MILS when the caller says nothing', () => {
    expect(makeSheet(AT, SIZE, 'S', 's.kicad_sch').stroke?.width).toBe(Math.round(6 * 0.0254 * MM));
  });

  it('reaches the file, not only the model', () => {
    // A model field the writer never emits is a setting that silently vanishes
    // on the next save.
    expect(written(makeSheet(AT, SIZE, 'S', 's.kicad_sch', { borderWidthMils: 12 }))).toContain(
      '(width 0.3048)',
    );
  });

  it('takes the default border colour', () => {
    const sheet = makeSheet(AT, SIZE, 'S', 's.kicad_sch', { borderColor: [255, 0, 0, 1] });
    expect(sheet.stroke?.color).toEqual([255, 0, 0, 1]);
    expect(written(sheet)).toContain('(color 255 0 0');
  });

  it('has no colour of its own when the preference is unset', () => {
    // `COLOR4D::UNSPECIFIED` means "take the theme's", which for us is an
    // absent colour — writing black would pin every new sheet to black.
    const sheet = makeSheet(AT, SIZE, 'S', 's.kicad_sch', { borderWidthMils: 6 });
    expect(sheet.stroke?.color).toBeUndefined();
    expect(sheet.fillColor).toBeUndefined();
  });

  it('takes the default background colour', () => {
    const sheet = makeSheet(AT, SIZE, 'S', 's.kicad_sch', { backgroundColor: [0, 0, 255, 0.5] });
    expect(sheet.fillColor).toEqual([0, 0, 255, 0.5]);
    expect(written(sheet)).toContain('(color 0 0 255');
  });
});

const lib = (body: string) =>
  readSymbolLib(
    parse(`(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor")
  ${body})`),
  );

const GLOBAL_VCC = `(symbol "power:VCC" (power) (pin_names (offset 0)) (exclude_from_sim no) (in_bom yes) (on_board yes)
    (property "Reference" "#PWR" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "Value" "VCC" (at 0 3.556 0) (effects (font (size 1.27 1.27))))
    (property "ki_keywords" "global power" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "ki_description" "Power symbol creates a global label" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (symbol "VCC_0_1" (pin power_in line (at 0 0 90) (length 0) (name "VCC" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))))`;

const LOCAL_VCC = GLOBAL_VCC.replace('(power)', '(power local)');

const PLAIN_R = `(symbol "Device:R" (pin_numbers (hide yes)) (pin_names (offset 0)) (in_bom yes) (on_board yes)
    (property "Reference" "R" (at 2.032 0 90) (effects (font (size 1.27 1.27))))
    (property "Value" "R" (at 0 0 90) (effects (font (size 1.27 1.27))))
    (property "ki_keywords" "R res resistor" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (symbol "R_0_1" (rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254) (type default)) (fill (type none)))))`;

describe('the power kind a placed power symbol is converted to', () => {
  const globalVcc = lib(GLOBAL_VCC)[0]!;
  const localVcc = lib(LOCAL_VCC)[0]!;
  const plainR = lib(PLAIN_R)[0]!;

  it('is the definition’s own on Default', () => {
    expect(applyNewPowerSymbolType(globalVcc, NewPowerSymbols.Default)).toBe(globalVcc);
    expect(applyNewPowerSymbolType(localVcc, NewPowerSymbols.Default)).toBe(localVcc);
  });

  it('turns a global power symbol local', () => {
    const out = applyNewPowerSymbolType(globalVcc, NewPowerSymbols.Local);
    expect(out.isPower).toBe(true);
    expect(out.isLocalPower).toBe(true);
  });

  it('turns a local power symbol global', () => {
    const out = applyNewPowerSymbolType(localVcc, NewPowerSymbols.Global);
    expect(out.isPower).toBe(true);
    expect(out.isLocalPower).toBe(false);
  });

  /**
   * The comment upstream is emphatic about this and it is the one thing that
   * would be destructive: "Regular (non-power) symbols must never be promoted
   * to power symbols just because the default is set to Global or Local."
   */
  it('never promotes an ordinary symbol, on either setting', () => {
    expect(applyNewPowerSymbolType(plainR, NewPowerSymbols.Local)).toBe(plainR);
    expect(applyNewPowerSymbolType(plainR, NewPowerSymbols.Global)).toBe(plainR);
  });

  it('leaves a symbol that is already the wanted kind alone', () => {
    expect(applyNewPowerSymbolType(localVcc, NewPowerSymbols.Local)).toBe(localVcc);
    expect(applyNewPowerSymbolType(globalVcc, NewPowerSymbols.Global)).toBe(globalVcc);
  });

  /**
   * `sch_drawing_tools.cpp:448-464`: the library's own wording says "global",
   * and a symbol the user is told is local must not describe itself as global.
   */
  it('rewrites the keywords and the description on the way to local', () => {
    const out = applyNewPowerSymbolType(globalVcc, NewPowerSymbols.Local);
    expect(out.properties.find((p) => p.key === 'ki_keywords')?.value).toBe('local power');
    expect(out.properties.find((p) => p.key === 'ki_description')?.value).toBe(
      'Power symbol creates a local label',
    );
  });

  /**
   * And NOT on the way back: "We do not currently have local power symbols in
   * the KiCad library, so don't update any fields" (`:469-470`). Asymmetric on
   * purpose, so this is asserted rather than assumed.
   */
  it('leaves the wording alone on the way to global', () => {
    const local = applyNewPowerSymbolType(globalVcc, NewPowerSymbols.Local);
    const back = applyNewPowerSymbolType(local, NewPowerSymbols.Global);
    expect(back.properties.find((p) => p.key === 'ki_keywords')?.value).toBe('local power');
  });

  it('changes the token the library file carries, not only the flag', () => {
    // The flag alone would be lost the moment the definition is written into a
    // schematic's `lib_symbols`.
    const out = applyNewPowerSymbolType(globalVcc, NewPowerSymbols.Local);
    const tokens = out.source.items.filter(
      (n) => n.kind === 'list' && n.items[0]?.kind === 'atom' && n.items[0].value === 'power',
    );
    expect(tokens).toHaveLength(1);
    expect(JSON.stringify(tokens[0])).toContain('local');
  });
});
