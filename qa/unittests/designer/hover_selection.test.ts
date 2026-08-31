// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A right-click makes a *hover* selection, and a hover selection gets no
 * point-editor handles.
 *
 * `SCH_SELECTION_TOOL::Main`'s right-click branch (sch_selection_tool.cpp:992)
 * picks an item up only when nothing is selected yet, and marks what it picked
 * as disposable:
 *
 *     if( m_selection.Empty() )
 *     {
 *         ClearSelection();
 *         SelectPoint( evt->Position(), { SCH_LOCATE_ANY_T }, nullptr, &selCancelled );
 *         m_selection.SetIsHover( true );
 *     }
 *     …
 *     if( !selCancelled )
 *         m_menu->ShowContextMenu( m_selection );
 *
 * That is the whole of the reported behaviour: right-click a sheet cold and the
 * menu comes up over a highlighted sheet with no resize grips on it; right-click
 * one that a left-click already selected and the grips stay, because that branch
 * never runs and the selection — flag and all — is left alone.
 */
import { describe, it, expect } from 'vitest';
import {
  editHandlesVisible,
  isHoverSelection,
  rightClickSelection,
  type HoverSelection,
} from '@ziroeda/designer/src/editors/schematic/hover_selection.js';

const EMPTY: HoverSelection = { selection: new Set(), hover: null };

/** A left-click: a plain, persistent selection of one item. */
const leftClick = (id: string): HoverSelection => ({ selection: new Set([id]), hover: null });

/** Group promotion, off by default — one item selects itself. */
const alone = (id: string): string[] => [id];

const handles = (s: HoverSelection): boolean => editHandlesVisible(s, false);

describe('right-clicking an unselected sheet', () => {
  const after = rightClickSelection(EMPTY, 'sheet-1', alone);

  it('selects it, so the menu and the highlight have something to act on', () => {
    expect([...after.selection]).toEqual(['sheet-1']);
  });

  it('marks the selection as a hover', () => {
    expect(isHoverSelection(after)).toBe(true);
  });

  it('shows no resize handles — the reported bug', () => {
    expect(handles(after)).toBe(false);
  });

  it('promotes through a group, as any other pick does', () => {
    const grouped = rightClickSelection(EMPTY, 'sym-1', () => ['sym-1', 'sym-2']);
    expect([...grouped.selection].sort()).toEqual(['sym-1', 'sym-2']);
    // Two items, so no handles for that reason as well as the hover.
    expect(handles(grouped)).toBe(false);
  });
});

describe('right-clicking a sheet that was already left-clicked', () => {
  const before = leftClick('sheet-1');
  const after = rightClickSelection(before, 'sheet-1', alone);

  it('changes nothing at all', () => {
    expect(after).toBe(before);
    expect(isHoverSelection(after)).toBe(false);
  });

  it('keeps the handles it already had', () => {
    expect(handles(after)).toBe(true);
  });
});

describe('a left-click', () => {
  it('shows the handles', () => {
    expect(handles(leftClick('sheet-1'))).toBe(true);
  });

  it('clears a hover selection made before it', () => {
    // Even on the same item: a new selection is a new set, and the flag was
    // pinned to the old one.
    const after: HoverSelection = {
      selection: new Set(['sheet-1']),
      hover: rightClickSelection(EMPTY, 'sheet-1', alone).hover,
    };
    expect(isHoverSelection(after)).toBe(false);
    expect(handles(after)).toBe(true);
  });
});

describe('right-clicking the same sheet twice', () => {
  it('does not promote the hover selection into a real one', () => {
    // The second click finds it already selected and takes the other branch,
    // which touches neither the selection nor its flag. Clearing the flag there
    // would make the handles appear on the second click alone.
    const once = rightClickSelection(EMPTY, 'sheet-1', alone);
    const twice = rightClickSelection(once, 'sheet-1', alone);
    expect(isHoverSelection(twice)).toBe(true);
    expect(handles(twice)).toBe(false);
  });
});

describe('right-clicking empty canvas', () => {
  it('leaves a real selection real', () => {
    // Nothing was hit, so nothing is picked up and nothing is re-flagged; the
    // handles of whatever was selected stay where they were.
    const after = rightClickSelection(leftClick('sheet-1'), null, alone);
    expect(handles(after)).toBe(true);
  });
});

describe('the other two things that hide the handles', () => {
  it('more than one item selected', () => {
    // `selection.Size() != 1` returns from SCH_POINT_EDITOR::Main first.
    expect(handles({ selection: new Set(['a', 'b']), hover: null })).toBe(false);
  });

  it('an item still being drawn', () => {
    // `if( selection.Front()->IsNew() ) return 0;` — a shape riding the cursor
    // must not sprout grips mid-draw.
    expect(editHandlesVisible(leftClick('sheet-1'), true)).toBe(false);
  });
});

describe("right-clicking inside a selection's own box", () => {
  /**
   * `SCH_SELECTION_TOOL::Main` re-picks a non-empty selection only when the
   * click has left its bounding box by more than a grid square
   * (sch_selection_tool.cpp:654-672). The reported symptom: with a symbol
   * selected, right-clicking its reference field opened the *field's* menu,
   * because the field is a different item id and that was the whole of the old
   * test. A field is inside its symbol's box, so upstream never re-picks there.
   */
  const symbol = leftClick('sym-1');

  it('keeps the selection whatever is under the pointer', () => {
    expect(rightClickSelection(symbol, 'field-1', alone, false)).toBe(symbol);
    expect(rightClickSelection(symbol, 'pin-3', alone, false)).toBe(symbol);
    // Even a wholly unrelated item that happens to overlap the box.
    expect(rightClickSelection(symbol, 'wire-9', alone, false)).toBe(symbol);
  });

  it('re-picks once the click is a grid square outside the box', () => {
    const after = rightClickSelection(symbol, 'wire-9', alone, true);
    expect([...after.selection]).toEqual(['wire-9']);
    expect(isHoverSelection(after)).toBe(true);
  });

  it('does not re-pick outside the box when nothing was hit', () => {
    // `if( CollectHits( … ) )` — with nothing there the original selection and
    // its menu survive.
    expect(rightClickSelection(symbol, null, alone, true)).toBe(symbol);
  });

  it('still picks up an item cold, wherever the click landed', () => {
    // The empty branch runs first and does not consult the box at all.
    expect([...rightClickSelection(EMPTY, 'field-1', alone, false).selection]).toEqual(['field-1']);
    expect([...rightClickSelection(EMPTY, 'field-1', alone, true).selection]).toEqual(['field-1']);
  });

  it('defaults to keeping the selection', () => {
    // The parameter is optional, and the safe default is upstream's common
    // case: a click inside the box changes nothing.
    expect(rightClickSelection(symbol, 'field-1', alone)).toBe(symbol);
  });
});
