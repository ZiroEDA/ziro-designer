// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The toolbar ids routed to the frame's TOOL_MANAGER on the live canvas (`?schgal=1`, W2): each
 * resolves to the TOOL_ACTION toolbars_sch_editor.cpp puts on that button, and every one has a
 * tool registered for it, so a click does something.
 */
import { resolve } from 'node:path';
import { ACTIONS } from '@ziroeda/common/tool/actions.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { GAL_ROUTED_IDS, schToolbarAction } from '@ziroeda/eeschema/toolbars_sch_editor.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

describe('schToolbarAction', () => {
  it("maps the toolbar's own names to the actions upstream puts on those buttons", () => {
    expect(schToolbarAction('select')).toBe(ACTIONS.selectSetRect);
    expect(schToolbarAction('selectLasso')).toBe(ACTIONS.selectSetLasso);
    expect(schToolbarAction('delete')).toBe(ACTIONS.deleteTool);
    expect(schToolbarAction('placeText')).toBe(SCH_ACTIONS.placeSchematicText);
    expect(schToolbarAction('busEntry')).toBe(SCH_ACTIONS.placeBusWireEntry);
    expect(schToolbarAction('drawWire')).toBe(SCH_ACTIONS.drawWire);
    expect(schToolbarAction('undo')).toBe(ACTIONS.undo);
  });

  it('leaves file, dialog and navigation buttons on the record path', () => {
    for (const id of ['save', 'schematicSetup', 'plot', 'erc', 'navUp', 'toggleGrid', 'nope'])
      expect(schToolbarAction(id)).toBeNull();
  });

  it('every routed id resolves, and some tool on the live frame answers it', () => {
    const h = schToolHarness(schFrame({}));
    openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
    const mgr = h.frame.GetToolManager()!;
    const unanswered: string[] = [];

    for (const id of GAL_ROUTED_IDS) {
      const action = schToolbarAction(id);
      expect(action, id).not.toBeNull();
      // RunAction answers whether a tool handled it; whatever started is cancelled again.
      if (!mgr.RunAction(action!)) unanswered.push(id);
      mgr.RunAction(ACTIONS.cancelInteractive);
    }

    expect(unanswered).toEqual([]);
  });
});
