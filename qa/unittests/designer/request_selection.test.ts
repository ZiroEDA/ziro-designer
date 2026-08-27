// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Hover-to-act: an editing command with nothing selected acts on the item under
 * the cursor, and does not leave it selected afterwards.
 *
 * `SCH_SELECTION_TOOL::RequestSelection` (eeschema/tools/sch_selection_tool.cpp
 * :1945-1994) is where every editing command gets its target:
 *
 *     if( m_selection.Empty() )
 *     {
 *         VECTOR2D cursorPos = getViewControls()->GetCursorPosition( true );
 *         ClearSelection();
 *         SelectPoint( cursorPos, aScanTypes );
 *         m_selection.SetIsHover( true );
 *         m_selection.ClearReferencePoint();
 *     }
 *     else        // Trim an existing selection by aFilterList
 *     {
 *         for( int i = (int) m_selection.GetSize() - 1; i >= 0; --i )
 *         {
 *             EDA_ITEM* item = (EDA_ITEM*) m_selection.GetItem( i );
 *             if( !item->IsType( aScanTypes ) )
 *                 unselect( item );
 *         }
 *     }
 *
 * So "hover a symbol and press R to rotate it" is not a rotate feature. Rotate,
 * Mirror, Delete, Move, Drag, Duplicate, Properties, Autoplace Fields, Show
 * Datasheet, Copy as Text, Lock and Sync Sheet Pins all ask the same function,
 * and each hands it its own `aScanTypes` list. The clear-on-finish half is
 * `if( selection.IsHover() ) m_toolMgr->RunAction( ACTIONS::selectionClear )`,
 * at sch_edit_tool.cpp:1278, :1491, :2502, :2561, :2571, :3421 and :3614, and
 * sch_editor_control.cpp:1772, :1849 and :2852.
 *
 * Each command is asserted separately on purpose: the bug being fixed here was
 * that the hover machinery existed and exactly one caller read it, so "R works"
 * passing while Delete still ignored the cursor is the precise failure shape.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/src/sch_io/sexpr/read-schematic.js';
import { collectAndGuess } from '@ziroeda/eeschema/src/tools/sch_collectors.js';
import { refId, type ItemRef } from '@ziroeda/eeschema/src/tools/hittest.js';
import {
  AnyItems,
  AttributeItems,
  DeletableItems,
  MovableItems,
  RotatableItems,
  SheetItems,
  SymbolItems,
  isScanType,
  schItemKind,
  selectPoint,
  trimToScanTypes,
  type ScanTypes,
} from '@ziroeda/eeschema/src/tools/sch_request_selection.js';
import {
  clearHoverSelection,
  isHoverSelection,
  requestSelection,
  type HoverSelection,
} from '@ziroeda/designer/src/editors/schematic/hover_selection.js';
import { mmToIU } from '@ziroeda/common/src/eda_units.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/src/types.js';

const rawR = readFileSync(
  fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)),
  'utf8',
);
const R = readSymbolLib(parse(rawR))[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);
const rBlock = rawR.slice(rawR.indexOf('(symbol "'), rawR.lastIndexOf(')'));

const doc: Schematic = readSchematic(
  parse(`(kicad_sch (version 20250114) (lib_symbols ${rBlock})
    (symbol (lib_id "R") (at 100 100 0) (unit 1) (uuid "r1")
      (property "Reference" "R1" (at 103 98 0))
      (property "Value" "10k" (at 103 102 0)))
    (sheet (at 40 40) (size 20 20) (uuid "s1")
      (property "Sheetname" "Sub" (at 40 39 0))
      (property "Sheetfile" "sub.kicad_sch" (at 40 61 0)))
    (wire (pts (xy 60 60) (xy 80 60)) (stroke (width 0) (type default)) (uuid "w1")))`),
);

const SYMBOL = refId('symbol', 'r1', 0);
const WIRE = refId('line', 'w1', 0);
const SHEET = refId('sheet', 's1', 0);

const at = (x: number, y: number): Vec2 => ({ x: mmToIU(x), y: mmToIU(y) });

/**
 * What the canvas hands `requestSelection`: `collectAndGuess` at the snapped
 * cursor. The accuracy is the collector's grid term on a 1.27 mm grid
 * (`max( 5 px, |(GRID,GRID)| / 2 )`), which is what it is at any usable zoom.
 */
const under = (p: Vec2): readonly ItemRef[] =>
  collectAndGuess(doc, LIB, p, Math.hypot(mmToIU(1.27), mmToIU(1.27)) / 2, mmToIU(0.15));

/** The cursor over the symbol's body, over the wire, over the sheet, over air. */
const ON_SYMBOL = under(at(100, 100));
const ON_WIRE = under(at(70, 60));
const ON_SHEET = under(at(50, 50));
const ON_NOTHING = under(at(200, 200));

const EMPTY: HoverSelection = { selection: new Set(), hover: null };
/** A selection the user made themselves: no hover flag. */
const selected = (...ids: string[]): HoverSelection => ({ selection: new Set(ids), hover: null });
/** Neither the Selection Filter nor a group changes anything in this fixture. */
const resolve = (id: string): string[] => [id];

/**
 * One command: its `aScanTypes` list, and — stated as data, not read back out
 * of the list — whether a symbol is one of the types it takes. Deriving that
 * from `scanTypes.has('symbol')` would compute the expectation by asking the
 * code under test, and a table mutated to drop symbols would then still pass.
 */
const COMMANDS: { name: string; scanTypes: ScanTypes; takesSymbols: boolean }[] = [
  {
    name: 'rotate CCW / CW (SCH_EDIT_TOOL::Rotate, :967)',
    scanTypes: RotatableItems,
    takesSymbols: true,
  },
  {
    name: 'mirror H / V (SCH_EDIT_TOOL::Mirror, :1297)',
    scanTypes: RotatableItems,
    takesSymbols: true,
  },
  {
    name: 'autoplace fields (SCH_EDIT_TOOL::AutoplaceFields, :2463)',
    scanTypes: RotatableItems,
    takesSymbols: true,
  },
  {
    name: 'delete (SCH_EDIT_TOOL::DoDelete, :2226)',
    scanTypes: DeletableItems,
    takesSymbols: true,
  },
  {
    name: 'move / drag (SCH_MOVE_TOOL::Main, :1109)',
    scanTypes: MovableItems,
    takesSymbols: true,
  },
  {
    name: 'duplicate (SCH_EDITOR_CONTROL::doCopy, :1654)',
    scanTypes: AnyItems,
    takesSymbols: true,
  },
  {
    name: 'properties (SCH_EDIT_TOOL::Properties, :2570)',
    scanTypes: AnyItems,
    takesSymbols: true,
  },
  {
    name: 'copy as text (SCH_EDITOR_CONTROL::CopyAsText, :1842)',
    scanTypes: AnyItems,
    takesSymbols: true,
  },
  {
    name: 'show datasheet (SCH_EDITOR_CONTROL, :2845)',
    scanTypes: SymbolItems,
    takesSymbols: true,
  },
  // The one command in this list whose types exclude a symbol.
  { name: 'sync sheet pins (SCH_EDIT_TOOL, :3403)', scanTypes: SheetItems, takesSymbols: false },
  {
    name: 'lock / unlock (SCH_EDIT_TOOL::SetAttribute, :3533)',
    scanTypes: AttributeItems,
    takesSymbols: true,
  },
];

describe.each(COMMANDS)('$name, with nothing selected', ({ scanTypes, takesSymbols }) => {
  it('takes exactly what its scan types admit from under the cursor', () => {
    const req = requestSelection(doc, EMPTY, scanTypes, ON_SYMBOL, resolve);
    expect([...req.target]).toEqual(takesSymbols ? [SYMBOL] : []);
  });

  if (takesSymbols) {
    it('marks what it picked up as a hover selection', () => {
      const req = requestSelection(doc, EMPTY, scanTypes, ON_SYMBOL, resolve);
      expect(isHoverSelection(req.state)).toBe(true);
    });

    it('does not leave the symbol selected once the command finishes', () => {
      const req = requestSelection(doc, EMPTY, scanTypes, ON_SYMBOL, resolve);
      expect([...clearHoverSelection(req.state).selection]).toEqual([]);
    });
  }

  it('takes nothing at all with the cursor over empty sheet', () => {
    const req = requestSelection(doc, EMPTY, scanTypes, ON_NOTHING, resolve);
    expect(req.target.size).toBe(0);
    expect(isHoverSelection(req.state)).toBe(false);
  });
});

describe.each(COMMANDS)('$name, with a selection the user made', ({ scanTypes, takesSymbols }) => {
  it('ignores what is under the cursor and uses the selection', () => {
    // The cursor is over the wire; the symbol is what is selected.
    const state = selected(SYMBOL);
    const req = requestSelection(doc, state, scanTypes, ON_WIRE, resolve);
    expect([...req.target]).toEqual(takesSymbols ? [SYMBOL] : []);
  });

  it('leaves that selection alone when the command finishes', () => {
    const state = selected(SYMBOL);
    const req = requestSelection(doc, state, scanTypes, ON_WIRE, resolve);
    expect(isHoverSelection(req.state)).toBe(false);
    // Only a hover selection is thrown away. The user's own survives, whatever
    // the type trim left of it — which for a sheet-only command is nothing.
    expect(clearHoverSelection(req.state)).toBe(req.state);
    expect([...req.state.selection]).toEqual(takesSymbols ? [SYMBOL] : []);
  });
});

describe('the scan types are what separates one command from another', () => {
  it('rotate takes the wire under the cursor', () => {
    expect([...requestSelection(doc, EMPTY, RotatableItems, ON_WIRE, resolve).target]).toEqual([
      WIRE,
    ]);
  });

  it('show datasheet does not, because its list is { SCH_SYMBOL_T }', () => {
    expect(requestSelection(doc, EMPTY, SymbolItems, ON_WIRE, resolve).target.size).toBe(0);
  });

  it('sync sheet pins takes a hovered sheet and nothing else', () => {
    expect([...requestSelection(doc, EMPTY, SheetItems, ON_SHEET, resolve).target]).toEqual([
      SHEET,
    ]);
    expect(requestSelection(doc, EMPTY, SheetItems, ON_WIRE, resolve).target.size).toBe(0);
    expect(requestSelection(doc, EMPTY, SheetItems, ON_SYMBOL, resolve).target.size).toBe(0);
  });

  it('trims a mixed selection to the list, the `else` branch', () => {
    const state = selected(SYMBOL, WIRE, SHEET);
    // Show Datasheet keeps only the symbol …
    expect([...requestSelection(doc, state, SymbolItems, [], resolve).target]).toEqual([SYMBOL]);
    // … Sync Sheet Pins only the sheet …
    expect([...requestSelection(doc, state, SheetItems, [], resolve).target]).toEqual([SHEET]);
    // … and Rotate, whose list covers all three, keeps all three.
    expect([...requestSelection(doc, state, RotatableItems, [], resolve).target].sort()).toEqual(
      [SYMBOL, WIRE, SHEET].sort(),
    );
  });

  it('a trimmed hover selection is still a hover selection', () => {
    // `RequestSelection`'s trim branch never touches `SetIsHover`, so a
    // right-click hover that a later command narrows still gets thrown away.
    const hover = new Set([SYMBOL, WIRE]);
    const req = requestSelection(doc, { selection: hover, hover }, SymbolItems, [], resolve);
    expect([...req.target]).toEqual([SYMBOL]);
    expect(isHoverSelection(req.state)).toBe(true);
    expect(clearHoverSelection(req.state).selection.size).toBe(0);
  });

  it('an untrimmed selection comes back as the very set that went in', () => {
    // Identity is what carries the hover flag, so a no-op trim must not mint a
    // new set: doing so would silently turn a hover selection into a real one.
    const state = selected(SYMBOL);
    expect(trimToScanTypes(doc, state.selection, RotatableItems)).toBe(state.selection);
  });
});

describe('the type tables, transcribed from KiCad', () => {
  it('leaves pins out of every list a command passes', () => {
    // SCH_PIN_T appears in none of RotatableItems, MovableItems or
    // DeletableItems: a pin turns, moves and dies with its symbol.
    for (const list of [RotatableItems, MovableItems, DeletableItems])
      expect(list.has('pin')).toBe(false);
    // It is still selectable, so the unfiltered list has it.
    expect(AnyItems.has('pin')).toBe(true);
  });

  it('keeps no-connects out of MovableItems? no — they are movable and deletable', () => {
    expect(MovableItems.has('noconnect')).toBe(true);
    expect(DeletableItems.has('noconnect')).toBe(true);
    expect(RotatableItems.has('noconnect')).toBe(true);
  });

  it('SetAttribute is symbols and sheets only', () => {
    expect([...AttributeItems].sort()).toEqual(['sheet', 'symbol']);
  });

  it('resolves an id to the kind IsType would test', () => {
    expect(schItemKind(doc, SYMBOL)).toBe('symbol');
    expect(schItemKind(doc, WIRE)).toBe('line');
    expect(schItemKind(doc, SHEET)).toBe('sheet');
    expect(schItemKind(doc, `${SYMBOL}:pin0`)).toBe('pin');
    expect(schItemKind(doc, `${SYMBOL}:field0`)).toBe('field');
    expect(schItemKind(doc, 'no-such-item')).toBe(null);
  });

  it('an id the document does not answer to is not of any type', () => {
    expect(isScanType(doc, 'no-such-item', AnyItems)).toBe(false);
  });

  it('SelectPoint skips candidates the list does not admit', () => {
    // The pick is limited at collection time: over the symbol's body, a
    // sheet-only command must not settle for the symbol.
    expect(selectPoint(ON_SYMBOL, SymbolItems)?.id).toBe(SYMBOL);
    expect(selectPoint(ON_SYMBOL, SheetItems)).toBe(null);
  });
});

describe('a pick the Selection Filter rejects selects nothing', () => {
  it('and is not a hover selection either', () => {
    // `SelectPoint` returning false leaves the selection empty; a hover flag on
    // an empty selection would make the next command clear a selection that was
    // never made.
    const req = requestSelection(doc, EMPTY, RotatableItems, ON_SYMBOL, () => []);
    expect(req.target.size).toBe(0);
    expect(isHoverSelection(req.state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The wiring: every command above must reach the seam, not read the selection
// directly. Asserted per command, because the bug was exactly that one caller
// read the hover state and the other twenty did not.
// ---------------------------------------------------------------------------

/** The editor source with whole-line comments removed, so a commented-out call
 *  cannot satisfy any assertion below. */
const editorSource = ((): string => {
  const raw = readFileSync(
    fileURLToPath(
      new URL('../../../designer/src/editors/schematic/SchematicEditor.tsx', import.meta.url),
    ),
    'utf8',
  );
  let inBlock = false;
  return raw
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (inBlock) {
        if (t.includes('*/')) inBlock = false;
        return '';
      }
      if (t.startsWith('/*')) {
        if (!t.includes('*/')) inBlock = true;
        return '';
      }
      return t.startsWith('//') || t.startsWith('*') ? '' : line;
    })
    .join('\n');
})();

/** The `n` characters of the handler that starts at `anchor`. */
function handlerAt(anchor: string, n = 900): string {
  const i = editorSource.indexOf(anchor);
  expect(i, `handler anchor not found (has it been renamed?): ${anchor}`).toBeGreaterThan(-1);
  return editorSource.slice(i, i + n);
}

const WIRING: { name: string; anchor: string; seam: RegExp }[] = [
  {
    name: 'rotate / mirror',
    anchor: 'else if (TX[id])',
    seam: /withSelection\(RotatableItems,/,
  },
  {
    name: 'delete',
    anchor: "else if (id === 'delete')",
    seam: /withSelection\(DeletableItems,/,
  },
  {
    name: 'lock / unlock / toggle lock',
    anchor: "else if (id === 'lock' || id === 'unlock' || id === 'toggleLock')",
    seam: /withSelection\(AttributeItems,/,
  },
  {
    name: 'copy as text',
    anchor: "else if (id === 'copyAsText')",
    seam: /withSelection\(AnyItems,/,
  },
  {
    name: 'sync sheet pins',
    anchor: "id === 'syncSheetPins' || id === 'syncAllSheetPins'",
    seam: /requestTarget\(SheetItems\)/,
  },
  {
    name: 'duplicate',
    anchor: 'const duplicateSelection = useCallback(',
    seam: /requestTarget\(AnyItems\)/,
  },
  {
    name: 'move / drag',
    anchor: "e.key.toLowerCase() === 'm' || e.key.toLowerCase() === 'g'",
    seam: /requestTarget\(MovableItems\)/,
  },
  {
    name: 'autoplace fields',
    anchor: "if (e.key.toLowerCase() === 'o' &&",
    seam: /withSelection\(RotatableItems,/,
  },
  {
    name: 'show datasheet',
    anchor: "if (e.key.toLowerCase() === 'd' && doc)",
    seam: /requestTarget\(SymbolItems\)/,
  },
  {
    name: 'properties (E)',
    anchor: "if (e.key.toLowerCase() === 'e')",
    seam: /requestTarget\(AnyItems\)/,
  },
  {
    name: 'properties (context menu)',
    anchor: "icon: 'properties',",
    seam: /requestTarget\(AnyItems\)/,
  },
];

describe('every editing command resolves its target through the one seam', () => {
  it.each(WIRING)('$name', ({ anchor, seam }) => {
    expect(handlerAt(anchor)).toMatch(seam);
  });

  it('and the seam is RequestSelection, not a per-command hit test', () => {
    // One definition of `requestTarget`, one of `withSelection`, and
    // `requestSelection` imported exactly once — a second copy of the rule is
    // how this drifted the first time.
    expect(editorSource.match(/const requestTarget = useCallback\(/g)).toHaveLength(1);
    expect(editorSource.match(/const withSelection = useCallback\(/g)).toHaveLength(1);
    expect(editorSource.match(/\brequestSelection\(/g)).toHaveLength(1);
  });

  it('and the clear-on-finish half runs clearHoverSelection', () => {
    expect(handlerAt('const finishCommand = useCallback(', 400)).toMatch(/clearHoverSelection\(/);
  });
});
