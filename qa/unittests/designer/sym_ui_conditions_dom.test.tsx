// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Symbol Editor's greyed-out state, as the frame actually renders it.
 *
 * `sym_ui_conditions.test.ts` pins the rules; this pins the **call site**, and
 * the two are not the same claim. A sweep on another branch put a bug straight
 * back into a call site with every rule-level test green, because nothing
 * asserted that the frame still consulted the rules. Here the real
 * `SymbolEditor` is mounted and its toolbar buttons are read out of the DOM, so
 * dropping `disabledIds={…}` from any one of the three `<Toolbar>`s — or
 * dropping `conds` from `symbolEditorMenus` — fails.
 *
 * The three states are the three the conditions distinguish
 * (`SYMBOL_EDIT_FRAME::setupUIConditions`, `symbol_edit_frame.cpp:448-660`):
 *
 *   - a cold frame:      `m_symbol` is null, so nothing that edits is live;
 *   - a ROOT symbol:     `isEditableCond` and `isEditableInAliasCond` both true;
 *   - a DERIVED symbol:  only `isEditableInAliasCond` — rotate lives, mirror dies.
 *
 * The symbol is handed in through the `schematicSymbol` prop, which is this
 * frame's `MAIL_LIB_EDIT` equivalent, because it is the one way to get a
 * `m_symbol` loaded without a library server behind it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { parse } from '@ziroeda/sexpr';
import { readSymbolLib } from '@ziroeda/eeschema';
import type { LibSymbol } from '@ziroeda/eeschema/src/types.js';
import { SymbolEditor } from '@ziroeda/designer/src/editors/symbol/SymbolEditor.js';

/**
 * `R` is a root symbol with an EMPTY Datasheet field; `R_Small` extends it and
 * carries one. That pairing is deliberate: `haveDatasheetCond` (:627-631) reads
 * the field and not the symbol, which is the rule ours had wrong, and putting
 * the datasheet on the *alias* means neither state can pass by accident.
 */
const LIB = `(kicad_symbol_lib (version 20241209) (generator "qa")
  (symbol "R" (pin_numbers (hide yes)) (pin_names (offset 0))
    (property "Reference" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "R" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "R_0_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
  )
  (symbol "R_Small" (extends "R")
    (property "Value" "R_Small" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "http://example/ds.pdf" (at 0 0 0)
      (effects (font (size 1.27 1.27))))
  )
)`;
const SYMS = new Map(readSymbolLib(parse(LIB)).map((s) => [s.libId, s]));
const sym = (name: string): LibSymbol => {
  const s = SYMS.get(name);
  if (!s) throw new Error(`no symbol ${name}`);
  return s;
};

/**
 * Every toolbar button's tooltip mapped to whether it renders disabled.
 * `Toolbar` puts the `title` on the `<button>`, and the tooltips are
 * `symbolToolbars.ts`' own, so a button whose id is misspelled still appears
 * here — it just never gets greyed, which is what these expectations catch.
 */
const buttons = (root: HTMLElement): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  for (const b of Array.from(root.querySelectorAll('button'))) {
    const title = b.getAttribute('title');
    if (title) out[title] = b.hasAttribute('disabled');
  }
  return out;
};

beforeEach(() => {
  // The frame asks the dev server for the installed symbol libraries on mount.
  // There is no server here; without this the suite prints an ECONNREFUSED
  // stack per test. The reply is a 404, which is the "no libraries" path.
  vi.stubGlobal('fetch', () =>
    Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('a cold SYMBOL_EDIT_FRAME', () => {
  it('greys what upstream greys with no symbol loaded', async () => {
    const { container, unmount } = render(<SymbolEditor onExitToHome={() => {}} />);
    const b = buttons(container);
    unmount();

    // Dead: everything whose condition needs `m_symbol`.
    expect({
      Undo: b.Undo,
      Redo: b.Redo,
      'Rotate clockwise': b['Rotate clockwise'],
      'Mirror horizontally': b['Mirror horizontally'],
      'Edit symbol properties': b['Edit symbol properties'],
      'Edit pins in a table': b['Edit pins in a table'],
      'Show associated datasheet or document': b['Show associated datasheet or document'],
      'Synchronized pins mode': b['Synchronized pins mode'],
      'Add a pin': b['Add a pin'],
      'Add a rectangle': b['Add a rectangle'],
      'Interactive delete': b['Interactive delete'],
    }).toEqual({
      // haveSymbolCond && UndoAvailable (:537-538)
      Undo: true,
      Redo: true,
      // isEditableInAliasCond (:555) / isEditableCond (:558)
      'Rotate clockwise': true,
      'Mirror horizontally': true,
      // symbolSelectedInTreeCondition || (canEditProperties && haveSymbolCond) (:634)
      'Edit symbol properties': true,
      // isEditableCond && haveSymbolCond (:636)
      'Edit pins in a table': true,
      // haveDatasheetCond (:633)
      'Show associated datasheet or document': true,
      // multiUnitModeCond (:640)
      'Synchronized pins mode': true,
      // EDIT_TOOL( … ) (:645-656)
      'Add a pin': true,
      'Add a rectangle': true,
      'Interactive delete': true,
    });

    // Live: the actions setupUIConditions never names, plus ACTIONS::save,
    // which it names as ShowAlways (:529). All five used to be greyed or, for
    // the drawing tools above, wrongly live.
    expect({
      'New symbol': b['New symbol'],
      'Save changes': b['Save changes'],
      'Save All': b['Save All'],
      'Check duplicate and off-grid pins': b['Check duplicate and off-grid pins'],
      'Add symbol to schematic': b['Add symbol to schematic'],
      'Select item(s)': b['Select item(s)'],
    }).toEqual({
      'New symbol': false,
      'Save changes': false,
      'Save All': false,
      'Check duplicate and off-grid pins': false,
      'Add symbol to schematic': false,
      'Select item(s)': false,
    });
  });
});

/** Mount the frame on `name` and wait for the symbol to finish loading. */
const openOn = async (
  name: string,
): Promise<{ b: Record<string, boolean>; unmount: () => void }> => {
  const { container, unmount } = render(
    <SymbolEditor
      onExitToHome={() => {}}
      schematicSymbol={{ symbol: sym(name), unit: 1, bodyStyle: 1, nonce: 1 }}
    />,
  );
  // The load is async (the manager resolves the library first), so the first
  // paint is still the cold frame. Rotate is live for a root symbol and for an
  // alias alike, which makes it the one signal that says "loaded" for both.
  await waitFor(() => expect(buttons(container)['Rotate clockwise']).toBe(false));
  return { b: buttons(container), unmount };
};

describe('with a ROOT symbol loaded', () => {
  it('lights every editing tool, and still greys Show Datasheet', async () => {
    const { b, unmount } = await openOn('R');
    unmount();
    expect({
      'Rotate clockwise': b['Rotate clockwise'],
      'Rotate counterclockwise': b['Rotate counterclockwise'],
      'Mirror horizontally': b['Mirror horizontally'],
      'Mirror vertically': b['Mirror vertically'],
      'Edit pins in a table': b['Edit pins in a table'],
      'Add a pin': b['Add a pin'],
      'Add a rectangle': b['Add a rectangle'],
      'Interactive delete': b['Interactive delete'],
      // haveDatasheetCond: `R`'s Datasheet field is empty, so the row stays
      // dead even though a symbol is open. This is the case the old rule —
      // "a symbol is loaded" — got wrong, and the one a reader will check.
      'Show associated datasheet or document': b['Show associated datasheet or document'],
      // A single-unit symbol: IsMultiUnit() is false.
      'Synchronized pins mode': b['Synchronized pins mode'],
    }).toEqual({
      'Rotate clockwise': false,
      'Rotate counterclockwise': false,
      'Mirror horizontally': false,
      'Mirror vertically': false,
      'Edit pins in a table': false,
      'Add a pin': false,
      'Add a rectangle': false,
      'Interactive delete': false,
      'Show associated datasheet or document': true,
      'Synchronized pins mode': true,
    });
  });
});

describe('with a DERIVED symbol loaded', () => {
  /**
   * The asymmetry, rendered. `isEditableCond` is
   * `IsSymbolEditable() && !IsSymbolAlias()` (:466-472) and
   * `isEditableInAliasCond` is `IsSymbolEditable()` alone (:474-481);
   * :554-559 gives rotate the second and mirror the first, under the comment
   * "when editing alias field rotations are allowed".
   */
  it('keeps Rotate live and kills Mirror', async () => {
    const { b, unmount } = await openOn('R_Small');
    unmount();
    expect({
      'Rotate clockwise': b['Rotate clockwise'],
      'Rotate counterclockwise': b['Rotate counterclockwise'],
      'Mirror horizontally': b['Mirror horizontally'],
      'Mirror vertically': b['Mirror vertically'],
    }).toEqual({
      'Rotate clockwise': false,
      'Rotate counterclockwise': false,
      'Mirror horizontally': true,
      'Mirror vertically': true,
    });
  });

  it('kills every drawing tool and the pin table', async () => {
    const { b, unmount } = await openOn('R_Small');
    unmount();
    expect({
      'Add a pin': b['Add a pin'],
      'Add a rectangle': b['Add a rectangle'],
      'Add a circle': b['Add a circle'],
      'Draw Lines': b['Draw Lines'],
      'Move the symbol anchor': b['Move the symbol anchor'],
      'Interactive delete': b['Interactive delete'],
      'Edit pins in a table': b['Edit pins in a table'],
    }).toEqual({
      'Add a pin': true,
      'Add a rectangle': true,
      'Add a circle': true,
      'Draw Lines': true,
      'Move the symbol anchor': true,
      'Interactive delete': true,
      'Edit pins in a table': true,
    });
  });

  /** `haveDatasheetCond` again, the other way round: the alias carries the
   *  Datasheet its parent does not, so the row is live here and dead on `R`.
   *  One rule, two symbols, opposite answers — which no "a symbol is open"
   *  test could distinguish. */
  it('lights Show Datasheet, which the root symbol does not', async () => {
    const { b, unmount } = await openOn('R_Small');
    unmount();
    expect(b['Show associated datasheet or document']).toBe(false);
  });
});
