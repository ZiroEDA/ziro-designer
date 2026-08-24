// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Delete, in the Symbol Editor, HIDES a field.
 *
 * `SYMBOL_EDITOR_EDIT_TOOL::DoDelete`
 * (`eeschema/tools/symbol_editor_edit_tool.cpp:796-860`) branches on item type:
 * a `SCH_FIELD_T` gets `field->SetVisible( false )` under the comment
 * `// Hide "deleted" fields`, and only pins and graphics reach
 * `symbol->RemoveDrawItem( item )`. Removing a field outright is the Symbol
 * Properties dialog's job — which is exactly what the infobar tells you when
 * you press Delete on a field that is already hidden.
 *
 * Ours deleted every non-mandatory field against a MANDATORY set written into
 * our own source, so a user field was destroyed by the keystroke KiCad uses to
 * hide it. This is a model divergence, not cosmetics: the field and its value
 * were gone from the file.
 */
import { describe, expect, it } from 'vitest';
import {
  deleteSymbolItems,
  symbolDeleteOutcome,
} from '@ziroeda/designer/src/editors/symbol/edits.js';
import type { LibSymbol } from '@ziroeda/eeschema';

const field = (key: string, hidden = false) => ({
  key,
  value: `${key}-value`,
  at: { x: 0, y: 0 },
  angle: 0,
  effects: { hidden },
});

const pin = (number: string) => ({
  name: 'A',
  number,
  electricalType: 'input',
  shape: 'line',
  at: { x: 0, y: 0 },
  angle: 0,
  length: 100,
  hidden: false,
});

/** Reference and Value (mandatory), plus MPN — a user field ours would delete. */
const symbol = (): LibSymbol =>
  ({
    libId: 'R',
    properties: [field('Reference'), field('Value'), field('MPN'), field('Old', true)],
    units: [{ name: 'R_1_1', pins: [pin('1'), pin('2')], graphics: [] }],
  }) as unknown as LibSymbol;

/** The stable id scheme `symItemId` builds; fields are always on unit 0. */
const fieldId = (i: number): string => `field:0:${i}`;
const pinId = (u: number, i: number): string => `pin:${u}:${i}`;

const keys = (s: LibSymbol): string[] => s.properties.map((f) => f.key);
const hiddenKeys = (s: LibSymbol): string[] =>
  s.properties.filter((f) => f.effects?.hidden).map((f) => f.key);

describe('DoDelete on a field', () => {
  /**
   * The user field survives — hidden, not removed. Asserted on the property
   * list itself, so a mutant that goes back to filtering cannot pass.
   */
  it('hides a user field instead of deleting it', () => {
    const r = deleteSymbolItems(symbol(), new Set([fieldId(2)]));
    expect(keys(r.symbol)).toEqual(['Reference', 'Value', 'MPN', 'Old']);
    expect(hiddenKeys(r.symbol)).toEqual(['MPN', 'Old']);
    expect(r.symbol.properties[2]?.value).toBe('MPN-value');
    expect(r.fieldsHidden).toBe(1);
    expect(r.fieldsAlreadyHidden).toBe(0);
    expect(r.itemsDeleted).toBe(0);
  });

  /**
   * Upstream's branch has no mandatory/optional test at all — every
   * `SCH_FIELD_T` is hidden. Ours kept mandatory fields by name from a set
   * written in our own source; Reference must behave the same as MPN.
   */
  it('hides a mandatory field the same way', () => {
    const r = deleteSymbolItems(symbol(), new Set([fieldId(0)]));
    expect(keys(r.symbol)).toEqual(['Reference', 'Value', 'MPN', 'Old']);
    expect(hiddenKeys(r.symbol)).toContain('Reference');
    expect(r.fieldsHidden).toBe(1);
  });

  /** `else { fieldsAlreadyHidden++; }` — a hidden field is counted, not changed. */
  it('counts an already-hidden field without touching it', () => {
    const r = deleteSymbolItems(symbol(), new Set([fieldId(3)]));
    expect(r.fieldsHidden).toBe(0);
    expect(r.fieldsAlreadyHidden).toBe(1);
    expect(keys(r.symbol)).toEqual(['Reference', 'Value', 'MPN', 'Old']);
  });
});

describe('DoDelete on pins and graphics', () => {
  /** Only these reach `RemoveDrawItem`. */
  it('removes a pin outright', () => {
    const r = deleteSymbolItems(symbol(), new Set([pinId(0, 0)]));
    expect(r.symbol.units[0]?.pins.map((p) => p.number)).toEqual(['2']);
    expect(r.itemsDeleted).toBe(1);
    expect(r.fieldsHidden).toBe(0);
  });
});

describe('the undo description (symbol_editor_edit_tool.cpp:847-860)', () => {
  /** `if( toDelete.size() == 0 )` is checked FIRST, so any real deletion wins. */
  it('is "Delete" whenever a pin or graphic went', () => {
    const r = deleteSymbolItems(symbol(), new Set([pinId(0, 0), fieldId(2)]));
    expect(symbolDeleteOutcome(r)).toEqual({ kind: 'commit', description: 'Delete' });
  });

  /** Singular and plural are different strings upstream. */
  it('is "Hide Field" for one and "Hide Fields" for more', () => {
    expect(symbolDeleteOutcome(deleteSymbolItems(symbol(), new Set([fieldId(2)])))).toEqual({
      kind: 'commit',
      description: 'Hide Field',
    });
    expect(
      symbolDeleteOutcome(deleteSymbolItems(symbol(), new Set([fieldId(0), fieldId(2)]))),
    ).toEqual({ kind: 'commit', description: 'Hide Fields' });
  });

  /** `ShowInfoBarError` — no commit at all, so nothing lands on the undo stack. */
  it('is the Symbol Properties infobar when only hidden fields were picked', () => {
    expect(symbolDeleteOutcome(deleteSymbolItems(symbol(), new Set([fieldId(3)])))).toEqual({
      kind: 'infobar',
      message: 'Use the Symbol Properties dialog to remove fields.',
    });
  });

  /** Nothing selected that DoDelete acts on: no commit and no message. */
  it('is nothing when nothing happened', () => {
    expect(symbolDeleteOutcome(deleteSymbolItems(symbol(), new Set()))).toEqual({ kind: 'none' });
  });
});
