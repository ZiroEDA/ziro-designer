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
import { fireEvent, render, waitFor } from '@testing-library/react';
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
  (symbol "U_dual" (pin_names (offset 0))
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "U_dual" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "U_dual_1_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
    (symbol "U_dual_2_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
  )
  (symbol "U_derived" (extends "U_dual")
    (property "Value" "U_derived" (at 0 0 0) (effects (font (size 1.27 1.27))))
  )
  (symbol "U_locked" (pin_names (offset 0))
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "U_locked" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (property "ki_locked" "" (at 0 0 0) (effects (font (size 1.27 1.27)) (hide yes)))
    (symbol "U_locked_1_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
    (symbol "U_locked_2_1" (rectangle (start -1 2.54) (end 1 -2.54)
      (stroke (width 0.254) (type default)) (fill (type none))))
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
      // `haveSymbolCond && cond.UndoAvailable()` (:537-538). Opening a symbol
      // does not fill its undo stack — `GetUndoCommandCount()` is 0 until an
      // edit — so both stay dead with the symbol on the canvas. This is the
      // half of the rule the cold frame cannot see: there, `haveSymbolCond`
      // alone is already false, so a frame that lied about the stack depth
      // would still look right.
      Undo: b.Undo,
      Redo: b.Redo,
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
      Undo: true,
      Redo: true,
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

// ---------------------------------------------------------------------------
// The library tree, which is the only way to reach two of the conditions
// ---------------------------------------------------------------------------

/**
 * A project whose `sym-lib-table` registers `Device.kicad_sym`
 * (`project_sym_lib_table.ts`, `eeschema/symbol_lib_table.cpp`). The frame is
 * driven through the tree here rather than through `schematicSymbol`, and that
 * is the point: a symbol handed over by the schematic makes
 * `IsSymbolFromSchematic()` true, which is the term that rescues
 * `IsSymbolEditable()` from the legacy-library test. Every other case in this
 * file therefore cannot see that test at all.
 */
const PROJECT = [
  {
    name: 'sym-lib-table',
    text: `(sym_lib_table (version 7)
  (lib (name "Device")(type "KiCad")(uri "\${KIPRJMOD}/Device.kicad_sym")(options "")(descr ""))
)`,
  },
  { name: 'Device.kicad_sym', text: LIB },
];

/**
 * Mount on the project and expand the one library, returning its tree rows.
 *
 * The rows are `LIB_TREE`'s (`.ze-libtree-row`), because the Libraries pane is
 * now the shared widget — `SYMBOL_TREE_PANE` mounts `LIB_TREE` and nothing
 * else. Two consequences the old selector hid: a row's text is its Item cell
 * PLUS the Description and Value cells, so a row is addressed by `.col-item`;
 * and a click SELECTS rather than expanding, since the expander is the twisty
 * (`wxDataViewCtrl` behaviour, and `LIB_TREE` inherits it).
 */
const openProject = async (): Promise<{
  container: HTMLElement;
  rows: () => HTMLElement[];
  unmount: () => void;
}> => {
  const { container, unmount } = render(
    <SymbolEditor onExitToHome={() => {}} initialProject={PROJECT} />,
  );
  const rows = (): HTMLElement[] =>
    Array.from(container.querySelectorAll('.ze-libtree-row')) as HTMLElement[];
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  const device = rows().find((r) => itemText(r) === 'Device')!;
  // `showResults`' last fallback expands a lone library on its own
  // (`LIB_TREE_MODEL_ADAPTER::UpdateSearchString`), so clicking unconditionally
  // would COLLAPSE it.
  const twisty = device.querySelector('.twisty')!;
  if (!twisty.classList.contains('open')) fireEvent.click(twisty);
  await waitFor(() => expect(rows().some((r) => itemText(r) === 'R')).toBe(true));
  return { container, rows, unmount };
};

/** A tree row's Item cell, which is `GetValue( …, NAME_COL )`. */
const itemText = (row: HTMLElement): string =>
  row.querySelector('.col-item')?.textContent?.trim() ?? '';

describe('with a tree row selected and nothing loaded', () => {
  /**
   * `symbolProperties` is `ENABLE( symbolSelectedInTreeCondition ||
   * ( canEditProperties && haveSymbolCond ) )` (:634). A single click on a
   * tree row selects without opening — `SYMBOL_EDIT_FRAME` opens on
   * double-click too — so this is the state where the FIRST branch is the only
   * one true, and `SYMBOL_EDITOR_CONTROL::EditSymbolProperties` has a path for
   * exactly it. Ours read `haveSymbolCond` alone and greyed the row.
   */
  it('lights Symbol Properties and nothing that needs m_symbol', async () => {
    const { container, rows, unmount } = await openProject();
    fireEvent.click(rows().find((r) => itemText(r) === 'R')!);
    const b = buttons(container);
    unmount();
    expect({
      'Edit symbol properties': b['Edit symbol properties'],
      'Add a rectangle': b['Add a rectangle'],
      'Edit pins in a table': b['Edit pins in a table'],
      'Mirror horizontally': b['Mirror horizontally'],
    }).toEqual({
      'Edit symbol properties': false,
      'Add a rectangle': true,
      'Edit pins in a table': true,
      'Mirror horizontally': true,
    });
  });
});

describe('with a symbol opened from a LIBRARY, not the schematic', () => {
  /**
   * `IsSymbolEditable()` (:2231-2234) is
   * `m_symbol && ( !IsSymbolFromLegacyLibrary() || IsSymbolFromSchematic() )`.
   * Here the second disjunct is false, so the whole expression rests on the
   * legacy test — and a frame that reported every symbol as coming from a
   * legacy library would grey all of this, which no other case in this file
   * would notice.
   */
  it('lights every editing tool', async () => {
    const { container, rows, unmount } = await openProject();
    fireEvent.doubleClick(rows().find((r) => itemText(r) === 'R')!);
    await waitFor(() => expect(buttons(container)['Add a rectangle']).toBe(false));
    const b = buttons(container);
    unmount();
    expect({
      'Add a rectangle': b['Add a rectangle'],
      'Add a pin': b['Add a pin'],
      'Mirror horizontally': b['Mirror horizontally'],
      'Rotate clockwise': b['Rotate clockwise'],
      'Edit pins in a table': b['Edit pins in a table'],
      // Freshly opened: empty undo stack, empty Datasheet field.
      Undo: b.Undo,
      'Show associated datasheet or document': b['Show associated datasheet or document'],
    }).toEqual({
      'Add a rectangle': false,
      'Add a pin': false,
      'Mirror horizontally': false,
      'Rotate clockwise': false,
      'Edit pins in a table': false,
      Undo: true,
      'Show associated datasheet or document': true,
    });
  });
});

// ---------------------------------------------------------------------------
// The top bar, WHOLE, in both states
// ---------------------------------------------------------------------------

/**
 * The top toolbar's every button in declaration order, with the state it
 * actually renders in — `title` -> disabled.
 *
 * Scoped to `.ze-toolbar.horizontal`, which is the one `orientation="horizontal"`
 * `<Toolbar>` this frame mounts, so the left and right bars and the library
 * tree's own buttons stay out of the picture.
 */
const topBar = (root: HTMLElement): Record<string, boolean> => {
  const bar = root.querySelector('.ze-toolbar.horizontal');
  if (!bar) throw new Error('no horizontal toolbar rendered');
  const out: Record<string, boolean> = {};
  // Buttons AND the two `AppendControl` combos: upstream gates those with
  // `wxUpdateUIEvent` handlers of their own — `OnUpdateUnitNumber` is
  // `event.Enable( m_symbol && m_symbol->GetUnitCount() > 1 )` and
  // `OnUpdateBodyStyle` the same for `GetBodyStyleCount()`
  // (`symbol_edit_frame.cpp:861-880`) — so leaving them out would be leaving
  // two of this bar's twenty-two controls unclaimed.
  for (const b of Array.from(bar.querySelectorAll('button, select'))) {
    const title = b.getAttribute('title');
    if (title) out[title] = b.hasAttribute('disabled');
  }
  return out;
};

describe('the whole top bar, against a captured KiCad', () => {
  /**
   * Every button on the bar in ONE expectation, not a hand-picked subset.
   *
   * The subsets above cannot see the bug this pins. `Toolbar` renders a button
   * disabled when EITHER input says so —
   *
   *     const isDisabled = (b: ToolButton): boolean =>
   *       !!b.disabled || !!disabledIds?.has(b.id);      — `ui/Toolbar.tsx`
   *
   * — and `symbolToolbarDisabledIds` only ever produces the second. Three
   * buttons carried the first, a static `disabled: true` meaning "we have not
   * built this yet", and `sym_ui_conditions.test.ts` next door is blind to it
   * by construction. A capture of KiCad 10.0.5's Symbol Editor with no symbol
   * loaded, measured icon by icon (enabled icons peak at luminance 215, the
   * disabled ones at 128 — `wxColour::MakeDisabled` is `0.4*channel + 0.6*70`,
   * `action_toolbar.cpp:708`), says Find, Find and Replace and Zoom to
   * Selection Area are all LIVE there, and ours greyed all three.
   *
   * The `false` entries are as load-bearing as the `true` ones: this is the
   * cold frame, so every `true` has a named condition behind it and every
   * `false` is an action `setupUIConditions` (`symbol_edit_frame.cpp:448-660`)
   * either never names or names as `ENABLE( ShowAlways )`.
   */
  it('greys exactly what a cold KiCad greys', () => {
    const { container, unmount } = render(<SymbolEditor onExitToHome={() => {}} />);
    const b = topBar(container);
    unmount();
    expect(b).toEqual({
      // SCH_ACTIONS::newSymbol — ENABLE( ShowAlways ) (:533)
      'New symbol': false,
      // ACTIONS::saveAll — ENABLE( ShowAlways ) (:528)
      'Save All': false,
      // ACTIONS::save — ENABLE( ShowAlways ) (:529)
      'Save changes': false,
      // haveSymbolCond && cond.UndoAvailable() / RedoAvailable() (:537-538)
      Undo: true,
      Redo: true,
      // ACTIONS::find / findAndReplace get NO SetConditions anywhere in
      // eeschema, and SYMBOL_EDIT_FRAME registers SCH_FIND_REPLACE_TOOL (:432),
      // so both are live upstream on a cold frame. Ours are greyed because the
      // tool is not ported for a LIB_SYMBOL yet — the only two deliberate
      // deviations left on this bar, and the reason they are written out here
      // rather than skipped is so that building the tool moves an expectation.
      Find: true,
      'Find and Replace': true,
      // The zooms: no ENABLE on any of them (`eda_draw_frame.cpp:1363-1374`
      // registers only the three unit CHECKs), and zoomTool is CHECK-only
      // (:561), so all five are live with an empty canvas.
      'Redraw view': false,
      'Zoom in': false,
      'Zoom out': false,
      'Zoom to fit symbol': false,
      'Zoom to Selection Area': false,
      // isEditableInAliasCond (:555-556) / isEditableCond (:558-559)
      'Rotate counterclockwise': true,
      'Rotate clockwise': true,
      'Mirror vertically': true,
      'Mirror horizontally': true,
      // symbolSelectedInTreeCondition || (canEditProperties && haveSymbolCond) (:634)
      'Edit symbol properties': true,
      // isEditableCond && haveSymbolCond (:636)
      'Edit pins in a table': true,
      // haveDatasheetCond (:633)
      'Show associated datasheet or document': true,
      // SCH_ACTIONS::checkSymbol gets no condition at all.
      'Check duplicate and off-grid pins': false,
      // multiUnitModeCond (:640)
      'Synchronized pins mode': true,
      // SCH_ACTIONS::addSymbolToSchematic gets no condition either.
      'Add symbol to schematic': false,
      // OnUpdateBodyStyle / OnUpdateUnitNumber (:861-880): both need a symbol.
      'Select body style': true,
      'Select unit to edit': true,
    });
  });

  /**
   * The contrasting state, so the test above cannot pass by greying everything
   * — or by greying nothing. `R` is a single-unit root symbol with an empty
   * Datasheet field, which is why three entries stay `true` here.
   */
  it('lights the editing half once a root symbol is loaded', async () => {
    const { container, unmount } = render(
      <SymbolEditor
        onExitToHome={() => {}}
        schematicSymbol={{ symbol: sym('R'), unit: 1, bodyStyle: 1, nonce: 1 }}
      />,
    );
    await waitFor(() => expect(topBar(container)['Rotate clockwise']).toBe(false));
    const b = topBar(container);
    unmount();
    expect(b).toEqual({
      'New symbol': false,
      'Save All': false,
      'Save changes': false,
      // GetUndoCommandCount() is 0 on a freshly loaded symbol.
      Undo: true,
      Redo: true,
      Find: true,
      'Find and Replace': true,
      'Redraw view': false,
      'Zoom in': false,
      'Zoom out': false,
      'Zoom to fit symbol': false,
      'Zoom to Selection Area': false,
      'Rotate counterclockwise': false,
      'Rotate clockwise': false,
      'Mirror vertically': false,
      'Mirror horizontally': false,
      'Edit symbol properties': false,
      'Edit pins in a table': false,
      // `R`'s Datasheet field is empty: haveDatasheetCond reads the FIELD.
      'Show associated datasheet or document': true,
      'Check duplicate and off-grid pins': false,
      // Single-unit: IsMultiUnit() false, so still dead.
      'Synchronized pins mode': true,
      'Add symbol to schematic': false,
      // `R` has one unit and one body style, so both combos stay dead even
      // with the symbol on the canvas — the half of :861-880 the cold frame
      // cannot see, where `m_symbol` alone is already false.
      'Select body style': true,
      'Select unit to edit': true,
    });
  });
});

// ---------------------------------------------------------------------------
// Synchronized Pins mode: a CHECK, not only an ENABLE
// ---------------------------------------------------------------------------

/** `aria-pressed` on one top-bar button, which is `Toolbar`'s `isActive`. */
const pressed = (root: HTMLElement, title: string): string | null => {
  const bar = root.querySelector('.ze-toolbar.horizontal');
  const btn = Array.from(bar?.querySelectorAll('button') ?? []).find(
    (b) => b.getAttribute('title') === title,
  );
  if (!btn) throw new Error(`no button titled ${title}`);
  return btn.getAttribute('aria-pressed');
};

const SYNC = 'Synchronized pins mode';

describe('m_SyncPinEdit', () => {
  /**
   * `SYMBOL_EDIT_FRAME`'s constructor writes `m_SyncPinEdit = false`
   * (`symbol_edit_frame.cpp:128`), and `toggleSyncedPinsMode` is
   * `ACTION_CONDITIONS().Enable( multiUnitModeCond ).Check( syncedPinsModeCond )`
   * (:640) — so a cold frame paints that button grey AND flat.
   *
   * Ours painted it grey and CHECKED: `toggleSyncedPinsMode` was a member of
   * `DEFAULT_TOGGLES`, i.e. treated as a sticky user preference that defaults
   * on. In a capture of a real cold Symbol Editor the button's cell is the
   * plain toolbar face rgb(55,55,55); ours was the checked fill rgb(68,48,41).
   * Enabled-ness alone cannot see this, which is why it is `aria-pressed`.
   */
  it('is off, and unlit, on a cold frame', () => {
    const { container, unmount } = render(<SymbolEditor onExitToHome={() => {}} />);
    const state = { pressed: pressed(container, SYNC), disabled: topBar(container)[SYNC] };
    unmount();
    expect(state).toEqual({ pressed: 'false', disabled: true });
  });

  /**
   * `SetCurSymbol` (:968): `m_SyncPinEdit = aSymbol && aSymbol->IsRoot() &&
   * aSymbol->IsMultiUnit() && !aSymbol->UnitsLocked()`. A two-unit root with no
   * `ki_locked` field satisfies all three, so LOADING it turns the mode on —
   * upstream derives the flag from the symbol, it is not remembered.
   */
  it('comes on by itself for a multi-unit symbol with interchangeable units', async () => {
    const { container, unmount } = render(
      <SymbolEditor
        onExitToHome={() => {}}
        schematicSymbol={{ symbol: sym('U_dual'), unit: 1, bodyStyle: 1, nonce: 1 }}
      />,
    );
    await waitFor(() => expect(topBar(container)[SYNC]).toBe(false));
    const state = { pressed: pressed(container, SYNC), disabled: topBar(container)[SYNC] };
    unmount();
    expect(state).toEqual({ pressed: 'true', disabled: false });
  });

  /**
   * The same symbol with `ki_locked` — `LIB_SYMBOL::UnitsLocked()`, serialised
   * as that user field (`sch_io_kicad_sexpr_lib_cache.cpp:466-474`). Both
   * `multiUnitModeCond` and the `SetCurSymbol` assignment carry the same
   * `!UnitsLocked()`, so the button goes back to grey and flat. Without this
   * case a rule that ignored `ki_locked` entirely would still pass above.
   */
  /**
   * `IsMultiUnit()`. `R` is a single-unit root, so the second conjunct of :968
   * is what says no here — without this case a rule that dropped the unit count
   * would still pass every other test in this file, since `U_dual` satisfies
   * every conjunct at once.
   */
  it('stays off for a single-unit symbol', async () => {
    const { container, unmount } = render(
      <SymbolEditor
        onExitToHome={() => {}}
        schematicSymbol={{ symbol: sym('R'), unit: 1, bodyStyle: 1, nonce: 1 }}
      />,
    );
    await waitFor(() => expect(topBar(container)['Rotate clockwise']).toBe(false));
    const state = { pressed: pressed(container, SYNC), disabled: topBar(container)[SYNC] };
    unmount();
    expect(state).toEqual({ pressed: 'false', disabled: true });
  });

  /**
   * `IsRoot()`. `U_derived` extends `U_dual`, so it is multi-unit AND unlocked
   * and only the first conjunct of :968 rules it out. Note the asymmetry with
   * the ENABLE beside it: `multiUnitModeCond` (:609-613) has no `IsRoot()`
   * test, so upstream leaves this button LIVE on a derived multi-unit symbol
   * while `SetCurSymbol` leaves the mode itself off.
   */
  it('stays off for a DERIVED multi-unit symbol, which is still enabled', async () => {
    const { container, unmount } = render(
      <SymbolEditor
        onExitToHome={() => {}}
        schematicSymbol={{ symbol: sym('U_derived'), unit: 1, bodyStyle: 1, nonce: 1 }}
      />,
    );
    await waitFor(() => expect(topBar(container)['Rotate clockwise']).toBe(false));
    const state = { pressed: pressed(container, SYNC), disabled: topBar(container)[SYNC] };
    unmount();
    expect(state).toEqual({ pressed: 'false', disabled: false });
  });

  /**
   * The clearing half of :968. `m_SyncPinEdit` is an ASSIGNMENT on every
   * `SetCurSymbol`, not an "if this symbol qualifies, switch it on" — so
   * opening a plain resistor after a two-unit part turns the mode back off.
   *
   * It takes two loads in one frame to see, and without it a `withSyncPinEdit`
   * that only ever `add`s survives every other case in this file: each of them
   * mounts a fresh frame, where the flag starts off anyway.
   */
  it('goes back off when the next symbol loaded does not qualify', async () => {
    const { container, rerender, unmount } = render(
      <SymbolEditor
        onExitToHome={() => {}}
        schematicSymbol={{ symbol: sym('U_dual'), unit: 1, bodyStyle: 1, nonce: 1 }}
      />,
    );
    await waitFor(() => expect(pressed(container, SYNC)).toBe('true'));
    rerender(
      <SymbolEditor
        onExitToHome={() => {}}
        schematicSymbol={{ symbol: sym('R'), unit: 1, bodyStyle: 1, nonce: 2 }}
      />,
    );
    await waitFor(() => expect(topBar(container)['Edit pins in a table']).toBe(false));
    const state = { pressed: pressed(container, SYNC), disabled: topBar(container)[SYNC] };
    unmount();
    expect(state).toEqual({ pressed: 'false', disabled: true });
  });

  it('stays off for a multi-unit symbol whose units are locked', async () => {
    const { container, unmount } = render(
      <SymbolEditor
        onExitToHome={() => {}}
        schematicSymbol={{ symbol: sym('U_locked'), unit: 1, bodyStyle: 1, nonce: 1 }}
      />,
    );
    await waitFor(() => expect(topBar(container)['Rotate clockwise']).toBe(false));
    const state = { pressed: pressed(container, SYNC), disabled: topBar(container)[SYNC] };
    unmount();
    expect(state).toEqual({ pressed: 'false', disabled: true });
  });
});

describe('the Zoom to Selection Area button', () => {
  /**
   * `ACTIONS::zoomTool` is `AF_ACTIVATE` (`common/tool/actions.cpp:826`): the
   * click ARMS `ZOOM_TOOL`, whose `Main` opens with `m_frame->PushTool( aEvent )`
   * — and `TOOLS_HOLDER::SetTool` puts the action's `GetFriendlyName()` into
   * status-bar field 6 (`common/tool/tools_holder.cpp:72`). So the field
   * reading "Zoom to Selection Area" is what says the button reached the tool,
   * rather than being a live button wired to nothing, which is the failure the
   * static `disabled: true` was hiding.
   */
  it('arms the tool rather than zooming, and says so in field 6', () => {
    const { container, getByTestId, unmount } = render(<SymbolEditor onExitToHome={() => {}} />);
    const before = getByTestId('sym-tool-msg').textContent;
    const bar = container.querySelector('.ze-toolbar.horizontal');
    const btn = Array.from(bar?.querySelectorAll('button') ?? []).find(
      (b) => b.getAttribute('title') === 'Zoom to Selection Area',
    );
    if (!btn) throw new Error('no Zoom to Selection Area button');
    fireEvent.click(btn);
    const after = getByTestId('sym-tool-msg').textContent;
    const lit = btn.getAttribute('aria-pressed');
    unmount();
    // `Select item(s)` is `ACTIONS::selectionTool`'s FriendlyName, which the
    // frame opens on; the point is that the click MOVED it.
    expect({ before, after, lit }).toEqual({
      before: 'Select item(s)',
      after: 'Zoom to Selection Area',
      // TOOLBAR_STATE::TOGGLE + CurrentTool( zoomTool ) (:561): armed = checked.
      lit: 'true',
    });
  });
});
