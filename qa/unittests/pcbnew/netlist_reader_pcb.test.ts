// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * pcbnew/netlist_reader/{pcb_component,legacy_netlist_reader,netlist}.
 * The expectations are the C++'s: pcb_component.cpp (unique_ptr release),
 * legacy_netlist_reader.cpp (PCB_COMPONENTs out), netlist.cpp LoadFootprints.
 */
import { describe, expect, it } from 'vitest';
import { COMPONENT, NETLIST } from '@ziroeda/common/netlist_reader/netlist.js';
import { Reporter, RPT_SEVERITY_ERROR, RPT_SEVERITY_WARNING } from '@ziroeda/common/reporter.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { LEGACY_NETLIST_READER } from '@ziroeda/pcbnew/netlist_reader/legacy_netlist_reader.js';
import {
  LoadFootprints,
  OnNetlistChanged,
  type NETLIST_FRAME,
} from '@ziroeda/pcbnew/netlist_reader/netlist.js';
import { PCB_COMPONENT } from '@ziroeda/pcbnew/netlist_reader/pcb_component.js';

const LEGACY = `# EESchema Netlist Version 1.1 created  15/5/2008-12:09:21
(
 ( /32568D1E R_0805  R1 10k {Lib=R}
  (    1 GND )
  (    2 NET1 )
 )
 ( /32568D1F $noname  R2 10k {Lib=R}
  (    1 GND )
 )
)
`;

function fp(fpid: string, ref: string): FOOTPRINT {
  const f = new FOOTPRINT(null);
  f.SetFPIDAsString(fpid);
  f.SetReference(ref);
  return f;
}

function frame(over: Partial<NETLIST_FRAME> = {}): NETLIST_FRAME {
  return {
    FindFootprintByPath: () => null,
    FindFootprintByReference: () => null,
    HasFootprintLibraries: () => true,
    loadFootprint: (id) => fp(id, 'REF**'),
    DisplayErrorMessage: () => {},
    SetLastPath: () => {},
    ...over,
  };
}

describe('PCB_COMPONENT', () => {
  it('GetFootprint(true) releases ownership, GetFootprint() does not', () => {
    const c = new PCB_COMPONENT('L:R', 'R1', '1k', '/', []);
    const f = fp('L:R', 'R1');
    c.SetFootprint(f);
    expect(c.GetFootprint()).toBe(f);
    expect(c.GetFootprint(true)).toBe(f);
    expect(c.GetFootprint()).toBeNull();
  });
});

describe('LEGACY_NETLIST_READER', () => {
  it('reads the legacy format into PCB_COMPONENTs', () => {
    const nl = new NETLIST();
    new LEGACY_NETLIST_READER(nl, LEGACY).LoadNetlist();
    expect(nl.GetCount()).toBe(2);
    const r1 = nl.GetComponent(0)!;
    expect(r1 instanceof PCB_COMPONENT).toBe(true);
    expect(r1.GetReference()).toBe('R1');
    expect(r1.GetFPID()).toBe('R_0805');
    expect(r1.GetNetCount()).toBe(2);
    // $noname is an empty footprint, not the word.
    expect(nl.GetComponent(1)!.GetFPID()).toBe('');
  });
});

describe('LoadFootprints (PCB_EDIT_FRAME)', () => {
  const build = (): NETLIST => {
    const nl = new NETLIST();
    new LEGACY_NETLIST_READER(nl, LEGACY).LoadNetlist();
    return nl;
  };

  it('reports a symbol with no footprint and loads the one that has one', () => {
    const nl = build();
    const rep = new Reporter();
    LoadFootprints(frame(), nl, rep);
    expect(rep.count(RPT_SEVERITY_ERROR)).toBe(1);
    expect(rep.lines[0]!.message).toBe('No footprint defined for symbol R2.');
    const r1 = nl.GetComponentByReference('R1') as PCB_COMPONENT;
    expect(r1.GetFootprint()?.GetFPIDAsString()).toBe('R_0805');
  });

  it('a footprint missing from every library is an error naming the item', () => {
    const nl = build();
    const rep = new Reporter();
    LoadFootprints(frame({ loadFootprint: () => null }), nl, rep);
    expect(rep.lines.map((l) => l.message)).toContain(
      "R1 footprint 'R_0805' not found in any libraries in the footprint library table.",
    );
  });

  it('an on-board footprint that differs warns unless replacing', () => {
    const nl = build();
    const rep = new Reporter();
    const onBoard = fp('Lib:Other', 'R1');
    LoadFootprints(
      frame({ FindFootprintByReference: (r) => (r === 'R1' ? onBoard : null) }),
      nl,
      rep,
    );
    expect(rep.count(RPT_SEVERITY_WARNING)).toBe(1);
    expect((nl.GetComponentByReference('R1') as PCB_COMPONENT).GetFootprint()).toBeNull();
  });

  it('a legacy (nickname-less) FPID matches a qualified board footprint by item name', () => {
    const rep = new Reporter();
    const onBoard = fp('Lib:R_0805', 'R1');
    LoadFootprints(
      frame({ FindFootprintByReference: (r) => (r === 'R1' ? onBoard : null) }),
      build(),
      rep,
    );
    expect(rep.count(RPT_SEVERITY_WARNING)).toBe(0);
  });

  it('with replace-footprints a differing on-board footprint is reloaded, no warning', () => {
    const nl = build();
    nl.SetReplaceFootprints(true);
    const rep = new Reporter();
    const onBoard = fp('Lib:Other', 'R1');
    LoadFootprints(
      frame({ FindFootprintByReference: (r) => (r === 'R1' ? onBoard : null) }),
      nl,
      rep,
    );
    expect(rep.count(RPT_SEVERITY_WARNING)).toBe(0);
    expect((nl.GetComponentByReference('R1') as PCB_COMPONENT).GetFootprint()).not.toBeNull();
  });

  it('does nothing with no footprint libraries', () => {
    const rep = new Reporter();
    LoadFootprints(frame({ HasFootprintLibraries: () => false }), build(), rep);
    expect(rep.hasMessage()).toBe(false);
  });

  it('a plain COMPONENT is left without a footprint but still reported', () => {
    const nl = new NETLIST();
    nl.AddComponent(new COMPONENT('L:R', 'R9', '1', '/', []));
    const rep = new Reporter();
    LoadFootprints(frame(), nl, rep);
    expect(rep.hasMessage()).toBe(false);
  });
});

describe('OnNetlistChanged', () => {
  it('runs the steps in order and asks for a drag only when footprints were added', () => {
    const calls: string[] = [];
    const mk = (): Parameters<typeof OnNetlistChanged>[0] => {
      const o: Record<string, unknown> = {};
      for (const k of [
        'SetMsgPanel',
        'SynchronizeNetsAndNetClasses',
        'RebuildComponentClasses',
        'InitDrcEngine',
        'RepaintNetLabelsAndTextVars',
        'ClearSelection',
        'SpreadFootprints',
        'SelectItems',
        'Compile_Ratsnest',
        'UpdateVariantSelectionCtrl',
        'Refresh',
      ])
        o[k] = () => calls.push(k);
      return o as unknown as Parameters<typeof OnNetlistChanged>[0];
    };
    expect(OnNetlistChanged(mk(), [])).toBe(false);
    expect(calls).not.toContain('SelectItems');
    expect(calls[0]).toBe('SetMsgPanel');
    calls.length = 0;
    expect(OnNetlistChanged(mk(), [fp('a:b', 'X')])).toBe(true);
    expect(calls.indexOf('SpreadFootprints')).toBeLessThan(calls.indexOf('SelectItems'));
    expect(calls.indexOf('SelectItems')).toBeLessThan(calls.indexOf('Compile_Ratsnest'));
  });
});
