// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Net highlighting and cross-probing on the live model: SCH_EDITOR_CONTROL's highlightNet,
 * UpdateNetHighlighting, AssignNetclass, FindNetInInspector, FindSymbolAndItem
 * (sch_editor_control.cpp, cross-probing.cpp) and SCH_EDIT_FRAME::ExecuteRemoteCommand.
 */
import { resolve } from 'node:path';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import type { SCH_ITEM } from '@ziroeda/eeschema/sch_item.js';
import type { SCH_LABEL } from '@ziroeda/eeschema/sch_label.js';
import type { SCH_LINE } from '@ziroeda/eeschema/sch_line.js';
import type { SCH_SYMBOL } from '@ziroeda/eeschema/sch_symbol.js';
import { SCH_ACTIONS } from '@ziroeda/eeschema/tools/sch_actions.js';
import { SCH_EDITOR_CONTROL } from '@ziroeda/eeschema/tools/sch_editor_control.js';
import { SCH_SELECTION_TOOL } from '@ziroeda/eeschema/tools/sch_selection_tool.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProject, schFrame, schToolHarness } from './support/sch_tool_harness.js';

const ORACLE = resolve(__dirname, '../../data/eeschema/netlist_oracle/complex_hierarchy');
const SHEETS = ['complex_hierarchy.kicad_sch', 'ampli_ht.kicad_sch', 'complex_hierarchy.kicad_pro'];

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

const PROBE = {
  on_selection: true,
  center_on_items: false,
  zoom_to_fit: false,
  auto_highlight: true,
  flash_selection: false,
};

function setUp(aHooks: Partial<SCH_EDIT_FRAME_HOOKS> = {}) {
  const h = schToolHarness(
    schFrame({
      crossProbingSettings: () => PROBE as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
      ...aHooks,
    }),
  );
  openProject(h.frame, ORACLE, 'complex_hierarchy', SHEETS);
  const root = h.frame
    .Schematic()
    .Hierarchy()
    .find((p) => p.size() === 1)!;
  h.frame.SetCurrentSheet(root);
  const mgr = h.frame.GetToolManager()!;
  const screen = h.frame.GetScreen()!;
  const label = [...screen.Items().OfType(KICAD_T.SCH_LABEL_T)][0] as SCH_LABEL;
  const netName = label.Connection()!.Name();
  const wires = [...screen.Items().OfType(KICAD_T.SCH_LINE_T)] as SCH_LINE[];
  const onNet = wires.filter((w) => w.IsWire() && w.Connection()?.Name() === netName);
  const offNet = wires.filter(
    (w) => w.IsWire() && w.Connection() && w.Connection()!.Name() !== netName,
  );
  return {
    ...h,
    mgr,
    screen,
    label,
    netName,
    onNet,
    offNet,
    editor: mgr.GetTool(SCH_EDITOR_CONTROL)!,
  };
}

describe('net highlighting', () => {
  it('the fixture has a labelled net with wires on it and wires off it', () => {
    const h = setUp();
    expect(h.netName).not.toBe('');
    expect(h.onNet.length).toBeGreaterThan(0);
    expect(h.offNet.length).toBeGreaterThan(0);
  });

  it('Highlight Net at a wire lights its net and nothing else; again toggles bus members; Clear clears', async () => {
    const h = setUp();
    const wire = h.onNet[0]!;
    h.h.mouse = wire.GetStartPoint();

    h.mgr.RunAction(SCH_ACTIONS.highlightNet);
    await flush();

    expect(h.frame.GetHighlightedConnection()).toBe(h.netName);
    expect(h.onNet.every((w) => w.IsBrightened())).toBe(true);
    expect(h.offNet.some((w) => w.IsBrightened())).toBe(false);
    expect(h.editor.GetHighlightBusMembers()).toBe(false);

    h.mgr.RunAction(SCH_ACTIONS.highlightNet);
    await flush();
    expect(h.editor.GetHighlightBusMembers()).toBe(true);

    h.mgr.RunAction(SCH_ACTIONS.clearHighlight);
    await flush();
    expect(h.frame.GetHighlightedConnection()).toBe('');
    expect(h.onNet.some((w) => w.IsBrightened())).toBe(false);
  });

  it('$NET: from the board highlights the net and says so; without auto_highlight it does nothing', () => {
    const h = setUp();

    h.frame.ExecuteRemoteCommand(`$NET: "${h.netName}"`);

    expect(h.frame.GetHighlightedConnection()).toBe(h.netName);
    expect(h.onNet.every((w) => w.IsBrightened())).toBe(true);

    PROBE.auto_highlight = false;
    try {
      h.frame.ExecuteRemoteCommand('$NET: "nonexistent-net"');
      expect(h.frame.GetHighlightedConnection()).toBe(h.netName);
    } finally {
      PROBE.auto_highlight = true;
    }

    h.frame.ExecuteRemoteCommand('$NET: "nonexistent-net"');
    expect(h.frame.GetHighlightedConnection()).toBe('');
  });

  it('$PART: finds a symbol by reference, reporting found or not found', () => {
    const status: string[] = [];
    const h = setUp();
    (h.frame as unknown as { SetStatusText(t: string): void }).SetStatusText = (t: string) =>
      status.push(t);
    const symbol = [...h.screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)].find(
      (s) => !(s as SCH_SYMBOL).GetRef(h.frame.GetCurrentSheet()).startsWith('#'),
    ) as SCH_SYMBOL;
    const ref = symbol.GetRef(h.frame.GetCurrentSheet());

    h.frame.ExecuteRemoteCommand(`$PART: "${ref.toLowerCase()}"`);
    h.frame.ExecuteRemoteCommand('$PART: "NOPE99"');

    expect(status).toEqual([`${ref.toLowerCase()} found`, 'NOPE99 not found']);
  });

  it('$PART: … $PAD: finds the pin, or says the pin is not there', () => {
    const status: string[] = [];
    const h = setUp();
    (h.frame as unknown as { SetStatusText(t: string): void }).SetStatusText = (t: string) =>
      status.push(t);
    const symbol = [...h.screen.Items().OfType(KICAD_T.SCH_SYMBOL_T)].find(
      (s) =>
        !(s as SCH_SYMBOL).GetRef(h.frame.GetCurrentSheet()).startsWith('#') &&
        (s as SCH_SYMBOL).GetPins().length > 0,
    ) as SCH_SYMBOL;
    const ref = symbol.GetRef(h.frame.GetCurrentSheet());
    const number = symbol.GetPins()[0]!.GetNumber();

    h.frame.ExecuteRemoteCommand(`$PART: "${ref}" $PAD: "${number}"`);
    h.frame.ExecuteRemoteCommand(`$PART: "${ref}" $PAD: "999"`);

    expect(status).toEqual([`${ref} pin ${number} found`, `${ref} found but pin 999 not found`]);
  });

  it('Assign Netclass needs a selection of labelled nets, and offers the dialog their names', async () => {
    const errors: string[] = [];
    const offered: unknown[] = [];
    const h = setUp({
      showModal: (aDialog, _aItems, aArg) => {
        if (aDialog === 'DIALOG_ASSIGN_NETCLASS')
          offered.push((aArg as { netNames: string[] }).netNames);
        return 0;
      },
    });
    (h.frame as unknown as { ShowInfoBarError(m: string): void }).ShowInfoBarError = (m) =>
      errors.push(m);
    const sel = h.mgr.GetTool(SCH_SELECTION_TOOL)!;

    sel.ClearSelection(true);
    h.mgr.RunAction(SCH_ACTIONS.assignNetclass);
    await flush();

    sel.AddItemToSel(h.label as unknown as SCH_ITEM, true);
    h.mgr.RunAction(SCH_ACTIONS.assignNetclass);
    await flush();

    expect(errors).toEqual(['No nets selected.']);
    expect(offered).toEqual([[h.netName]]);
  });

  it('Find Net in Inspector shows the navigator filtered to the selected net and clears the highlight', () => {
    const panes: string[] = [];
    const filters: string[] = [];
    const h = setUp({
      togglePane: (p) => panes.push(p),
      netNavigator: () => ({
        Refresh: () => {},
        SelectItem: () => {},
        GetSelectedItem: () => null,
        IsFrozen: () => false,
        IsShown: () => false,
        SetFilter: (n) => filters.push(n),
      }),
    });
    h.frame.ExecuteRemoteCommand(`$NET: "${h.netName}"`);
    const sel = h.mgr.GetTool(SCH_SELECTION_TOOL)!;
    sel.AddItemToSel(h.onNet[0]!, true);

    h.mgr.RunAction(SCH_ACTIONS.findNetInInspector);

    expect(panes).toEqual(['NetNavigator']);
    expect(filters).toEqual([h.onNet[0]!.Connection()!.GetNetName()]);
    expect(h.frame.GetHighlightedConnection()).toBe('');
  });

  it('SetCrossProbeConnection sends the net name, or clears for none', () => {
    const h = setUp();
    const sent: string[] = [];
    const frame = h.frame as unknown as Record<string, unknown>;
    frame.SendCrossProbeNetName = (n: string) => sent.push(`net ${n}`);
    frame.SendCrossProbeClearHighlight = () => sent.push('clear');

    h.frame.SetCrossProbeConnection(h.label.Connection());
    h.frame.SetCrossProbeConnection(null);

    expect(sent).toEqual([`net ${h.netName}`, 'clear']);
  });
});
