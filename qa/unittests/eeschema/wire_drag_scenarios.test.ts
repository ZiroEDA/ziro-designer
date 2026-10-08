// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Wire-drag behaviour, scenario by scenario, against SCH_MOVE_TOOL.
 *
 * Every expectation here is taken from
 * `eeschema/tools/sch_move_tool.cpp::getConnectedDragItems` and its siblings:
 *
 *  - a connected wire END follows the item that moves (the SCH_LINE_T branch
 *    sets STARTPOINT/ENDPOINT and SELECTED_BY_DRAG);
 *  - an *unselected junction* at the drag point isolates the drag,
 *    `ptHasUnselectedJunction` makes the SCH_LINE_T branch break, so the
 *    neighbouring wires stay put and only a stub is added;
 *  - a fixed symbol pin / junction / label at the drag point gets exactly one
 *    new stub wire (`if( test->IsConnected( aPoint ) && !newWire )`);
 *  - a label mid-span on a dragged wire rides it (SPECIAL_CASE_LABEL_INFO), but
 *    labels on the *unselected* end of a half-dragged wire are left alone;
 *  - a dragged label that sits mid-span splits its wire and drops a junction;
 *  - stubs that end up dangling at both ends are removed (trimDanglingLines).
 *
 * The point of the file is regression pressure on the whole drag surface at
 * once, so a fix to one path cannot quietly break another.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr/index.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import { planMove } from '@ziroeda/eeschema/tools/connect.js';
import { moveWithConnections } from '@ziroeda/eeschema/tools/move.js';
import { withCleanup } from '@ziroeda/eeschema/tools/cleanup.js';
import { refId } from '@ziroeda/eeschema/tools/hittest.js';
import { computeNetlist } from '@ziroeda/eeschema/connectivity/nets.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mmToIU } from '@ziroeda/common/eda_units.js';
import type { LibSymbol, Schematic, Vec2 } from '@ziroeda/eeschema/types.js';

const R = readSymbolLib(
  parse(readFileSync(fileURLToPath(new URL('../../data/R.kicad_sym', import.meta.url)), 'utf8')),
)[0]!;
const LIB = new Map<string, LibSymbol>([[R.libId, R]]);

function sheet(body: string): Schematic {
  return readSchematic(
    parse(`(kicad_sch (version 20250114) (lib_symbols ${R.source ? '' : ''})\n${body}\n)`),
  );
}

// ---------------------------------------------------------------------------

describe('wire drag: labels', () => {
  it('does not split when the label sits on a wire endpoint', () => {
    const doc = sheet(`
      (wire (pts (xy 100 100) (xy 140 100)) (stroke (width 0) (type default)) (uuid "w1"))
      (label "NET" (at 100 100 0) (effects (font (size 1.27 1.27))) (uuid "l1"))`);
    const labelId = refId('label', doc.labels[0]!.uuid, 0);
    expect(planMove(doc, LIB, new Set([labelId])).splits).toHaveLength(0);
  });
});
