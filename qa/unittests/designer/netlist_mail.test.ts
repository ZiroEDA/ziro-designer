// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * MAIL_SCH_GET_NETLIST: `PCB_EDIT_FRAME::FetchNetlistFromSchematic`
 * (pcbnew/pcb_edit_frame.cpp:2352) asking, `SCH_EDIT_FRAME::KiwayMailIn`
 * (eeschema/cross-probing.cpp:1028) answering. The answer here is a netlist
 * kicad-cli 10.0.5 wrote.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { KIWAY } from '@ziroeda/common/kiway.js';
import { MAIL_T } from '@ziroeda/common/mail_type.js';
import { SCH_EDIT_FRAME } from '@ziroeda/eeschema/sch_edit_frame.js';
import { FetchNetlistFromSchematic } from '@ziroeda/pcbnew/netlist_from_schematic.js';

const NET = readFileSync(
  new URL(
    '../../data/eeschema/netlist_oracle/issue14657/issue14657.kicad-cli.net',
    import.meta.url,
  ),
  'utf8',
);
const MSG = 'Updating PCB requires a fully annotated schematic.';

function setup(answer: string | null) {
  const kiway = new KIWAY({
    OnKiCadExit: () => {},
    Player: () => true,
    HasProjectManager: () => true,
    ShowProjectManager: () => {},
    CreateKiWindow: () => false,
  });
  const asked: string[] = [];
  const sch = new SCH_EDIT_FRAME({
    crossProbingSettings: () => new CROSS_PROBING_SETTINGS(),
    highlightNet: () => {},
    syncSelection: () => {},
    assignFootprints: () => {},
    saveProject: () => true,
    getNetlist: (m) => {
      asked.push(m);
      return answer;
    },
  });
  sch.SetKiway(kiway);
  kiway.SetPlayerFrame(FRAME_T.FRAME_SCH, sch);
  return { kiway, asked };
}

describe('SCH_EDIT_FRAME answering MAIL_SCH_GET_NETLIST', () => {
  it('replaces the payload with the netlist, given the annotate message to check against', () => {
    const { kiway, asked } = setup('(export)');
    const payload = { value: MSG };
    kiway.ExpressMail(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SCH_GET_NETLIST, payload);
    expect([asked, payload.value]).toEqual([[MSG], '(export)']);
  });

  it('leaves the payload alone when the schematic is not ready to netlist', () => {
    const { kiway } = setup(null);
    const payload = { value: MSG };
    kiway.ExpressMail(FRAME_T.FRAME_SCH, MAIL_T.MAIL_SCH_GET_NETLIST, payload);
    expect(payload.value).toBe(MSG);
  });
});

describe('FetchNetlistFromSchematic', () => {
  it('reads back the netlist the running schematic answers with', () => {
    const { kiway } = setup(NET);
    const got = FetchNetlistFromSchematic(kiway, null, [], MSG);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.netlistText).toBe(NET);
    // The fixture's one (comp (ref "R1") …).
    expect(got.netlist.Components().map((c) => c.GetReference())).toEqual(['R1']);
  });

  it('reports only the annotate message when the payload comes back unchanged', () => {
    const { kiway } = setup(null);
    expect(FetchNetlistFromSchematic(kiway, null, [], MSG)).toEqual({ ok: false, error: MSG });
  });

  it('reports a netlist it cannot read as the reader error', () => {
    const { kiway } = setup('(not a netlist');
    const got = FetchNetlistFromSchematic(kiway, null, [], MSG);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error).toMatch(/^Received an error while reading netlist/);
  });

  it('answers from the project files when no schematic is running (TestStandalone)', () => {
    const kiway = new KIWAY({
      OnKiCadExit: () => {},
      Player: () => true,
      HasProjectManager: () => true,
      ShowProjectManager: () => {},
      CreateKiWindow: () => false,
    });
    const got = FetchNetlistFromSchematic(kiway, null, [], MSG);
    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.error).toMatch(/this project has no schematic/);
  });
});
