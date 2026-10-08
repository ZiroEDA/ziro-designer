// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * LiveSchPropertiesPanel: the frame holds the panel (EDA_DRAW_FRAME::m_propertiesPanel), so a
 * selection made by the selection tool reaches the grid through PROPERTIES_TOOL ->
 * UpdateProperties, and closing the pane hands it back.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { LiveSchPropertiesPanel } from '@ziroeda/eeschema/widgets/sch_properties_panel_ui.js';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => {
  cleanup();
  SetPgm(null);
});

describe('LiveSchPropertiesPanel', () => {
  it("follows the selection tool through UpdateProperties, and gives the frame's panel back on unmount", () => {
    const h = schToolHarness(schFrame({}));
    openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
    const path = h.frame
      .Schematic()
      .Hierarchy()
      .find((p) => [...p.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)].length > 0)!;
    h.frame.SetCurrentSheet(path);
    const symbol = [...path.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)][0] as SCH_SYMBOL;
    const sel = h.frame.GetToolManager()!.GetTool(SCH_SELECTION_TOOL)!;

    const view = render(<LiveSchPropertiesPanel frame={h.frame} units="mm" />);
    expect(view.container.textContent).toContain('No objects selected');
    expect(h.frame.GetPropertiesPanel()).not.toBe(null);

    act(() => sel.AddItemToSel(symbol));

    expect(view.container.textContent).toContain('Symbol');
    expect(view.container.textContent).toContain(symbol.GetValueProp());

    view.unmount();
    expect(h.frame.GetPropertiesPanel()).toBe(null);
  });
});
