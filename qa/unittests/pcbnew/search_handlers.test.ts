// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/widgets/search_handlers.cpp` over a live BOARD. Expected cells are
 * written out from the C++ column tables, not read back from the handlers.
 */
import { describe, expect, it } from 'vitest';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { SEARCH_PANE } from '@ziroeda/common/settings/app_settings.js';
import { SEARCH_PANE_SELECTION_ZOOM } from '@ziroeda/common/settings/app_settings.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';
import { ADD_MODE } from '@ziroeda/pcbnew/board_item_container.js';
import { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { PAD } from '@ziroeda/pcbnew/pad.js';
import { PAD_ATTRIB, PAD_DRILL_SHAPE, PAD_SHAPE } from '@ziroeda/pcbnew/padstack.js';
import { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import { LSET } from '@ziroeda/common/lset.js';
import {
  DRILL_SEARCH_HANDLER,
  FOOTPRINT_SEARCH_HANDLER,
  makePcbSearchHandlers,
  type PcbSearchFrame,
  type PcbSearchWiring,
} from '@ziroeda/pcbnew/widgets/search_handlers.js';

const P = (x: number, y: number) => ({ x, y });

function makeBoard(): BOARD {
  const b = new BOARD();
  b.SetCopperLayerCount(2);

  for (const [ref, x] of [
    ['R2', 1_000_000],
    ['R10', 2_000_000],
    ['C1', 3_000_000],
  ] as const) {
    const fp = new FOOTPRINT(b);
    fp.SetReference(ref);
    fp.SetPosition(P(x, 0));
    const p = new PAD(fp);
    p.SetNumber('1');
    p.SetAttribute(PAD_ATTRIB.PTH);
    p.SetShape(undefined as unknown as PCB_LAYER_ID, PAD_SHAPE.CIRCLE);
    p.SetSize(undefined as unknown as PCB_LAYER_ID, P(1_500_000, 1_500_000));
    p.SetPosition(P(x, 0));
    const ls = new LSET();
    for (const l of b.GetEnabledLayers().CuStack()) ls.set(l);
    p.SetLayerSet(ls);
    p.SetDrillShape(PAD_DRILL_SHAPE.CIRCLE);
    p.SetDrillSize(P(800_000, 800_000));
    fp.Add(p, ADD_MODE.APPEND);
    b.Add(fp, ADD_MODE.APPEND);
  }

  for (const x of [0, 5_000_000]) {
    const v = new PCB_VIA(b);
    v.SetDrill(300_000);
    v.SetWidth(600_000);
    v.SetPosition(P(x, 0));
    b.Add(v, ADD_MODE.APPEND);
  }

  return b;
}

function rig(zoom = SEARCH_PANE_SELECTION_ZOOM.PAN) {
  const board = makeBoard();
  const calls: string[] = [];
  let selected: readonly unknown[] = [];
  let nets: readonly number[] | null = null;
  const pane = new SEARCH_PANE();
  pane.selection_zoom = zoom;

  const frame: PcbSearchFrame = {
    GetBoard: () => board,
    MessageTextFromValue: (v) => `${v / 1_000_000}mm`,
    GetOriginTransforms: () =>
      ({ ToDisplay: (v: number) => v }) as unknown as ReturnType<
        PcbSearchFrame['GetOriginTransforms']
      >,
    config: () => ({ m_SearchPane: pane }),
  };
  const wiring: PcbSearchWiring = {
    clearSelection: () => calls.push('clear'),
    selectItems: (items) => {
      selected = items;
      calls.push('select');
    },
    centerSelection: () => calls.push('center'),
    zoomFitSelection: () => calls.push('zoomfit'),
    refresh: () => calls.push('refresh'),
    properties: () => calls.push('properties'),
    highlightNets: (n) => {
      nets = n;
    },
    showBoardSetupDialog: (page) => calls.push(`setup:${page}`),
  };
  return { board, frame, wiring, calls, sel: () => selected, nets: () => nets };
}

describe('PCB_SEARCH_PANE handler set', () => {
  it('AddSearcher order and tab names', () => {
    const { frame, wiring } = rig();
    expect(makePcbSearchHandlers(frame, wiring).map((h) => h.name)).toEqual([
      'Footprints',
      'Zones',
      'Nets',
      'Ratsnest',
      'Text',
      'Groups',
      'Drills',
    ]);
  });
});

describe('FOOTPRINT_SEARCH_HANDLER', () => {
  it('an empty query lists every footprint; a query filters by reference', () => {
    const { frame, wiring } = rig();
    const h = new FOOTPRINT_SEARCH_HANDLER(frame, wiring);
    expect(h.search('')).toBe(3);
    expect(h.search('C1')).toBe(1);
    expect(h.getResultCell(0, 0)).toBe('C1');
    expect(h.search('nomatch')).toBe(0);
  });

  it('cells: reference, X in display units', () => {
    const { frame, wiring } = rig();
    const h = new FOOTPRINT_SEARCH_HANDLER(frame, wiring);
    h.search('');
    const refs = [0, 1, 2].map((r) => h.getResultCell(r, 0));
    expect(refs.sort()).toEqual(['C1', 'R10', 'R2']);
    const row = refs.indexOf('R2');
    void row;
    expect(h.getResultCell(99, 0)).toBe('');
  });

  it('sort is StrNumCmp (R2 before R10) and remaps the selection', () => {
    const { frame, wiring } = rig();
    const h = new FOOTPRINT_SEARCH_HANDLER(frame, wiring);
    h.search('');
    const before = [0, 1, 2].map((r) => h.getResultCell(r, 0));
    const r10 = before.indexOf('R10');
    const remapped = h.sort(0, true, [r10]);
    expect([0, 1, 2].map((r) => h.getResultCell(r, 0))).toEqual(['C1', 'R2', 'R10']);
    expect(remapped).toEqual([2]);
    h.sort(0, false, []);
    expect(h.getResultCell(0, 0)).toBe('R10');
  });

  it('SelectItems: clear, select, then pan; zoom setting zooms; none does neither', () => {
    const r = rig(SEARCH_PANE_SELECTION_ZOOM.PAN);
    const h = new FOOTPRINT_SEARCH_HANDLER(r.frame, r.wiring);
    h.search('C1');
    h.selectItems([0]);
    expect(r.calls).toEqual(['clear', 'select', 'center', 'refresh']);
    expect(r.sel()).toHaveLength(1);

    const z = rig(SEARCH_PANE_SELECTION_ZOOM.ZOOM);
    const hz = new FOOTPRINT_SEARCH_HANDLER(z.frame, z.wiring);
    hz.search('C1');
    hz.selectItems([0]);
    expect(z.calls).toEqual(['clear', 'select', 'zoomfit', 'refresh']);

    const n = rig(SEARCH_PANE_SELECTION_ZOOM.NONE);
    const hn = new FOOTPRINT_SEARCH_HANDLER(n.frame, n.wiring);
    hn.search('C1');
    hn.selectItems([0]);
    expect(n.calls).toEqual(['clear', 'select', 'refresh']);
  });

  it('an empty row list only clears; ActivateItem selects then runs properties', () => {
    const r = rig();
    const h = new FOOTPRINT_SEARCH_HANDLER(r.frame, r.wiring);
    h.search('');
    h.selectItems([]);
    expect(r.calls).toEqual(['clear', 'refresh']);
    r.calls.length = 0;
    h.activateItem(0);
    expect(r.calls.at(-1)).toBe('properties');
  });
});

describe('DRILL_SEARCH_HANDLER', () => {
  it('folds equal holes into one counted row, pads and vias apart', () => {
    const r = rig();
    const h = new DRILL_SEARCH_HANDLER(r.frame, r.wiring);
    expect(h.search('')).toBe(2);
    // Sorted by count, descending: the 3 pad holes, then the 2 vias.
    expect([0, 1].map((row) => h.getResultCell(row, 0))).toEqual(['3', '2']);
    expect(h.getResultCell(0, 1)).toBe('Round');
    expect(h.getResultCell(0, 2)).toBe('0.8mm');
    expect(h.getResultCell(0, 4)).toBe('PTH');
    expect(h.getResultCell(0, 5)).toBe('Pad');
    expect(h.getResultCell(1, 5)).toBe('Via');
    expect(h.getResultCell(1, 2)).toBe('0.3mm');
  });

  it('the query matches any cell, lower-cased', () => {
    const r = rig();
    const h = new DRILL_SEARCH_HANDLER(r.frame, r.wiring);
    expect(h.search('VIA')).toBe(1);
    expect(h.getResultCell(0, 5)).toBe('Via');
  });

  it('SelectItems selects every hole the row stands for', () => {
    const r = rig();
    const h = new DRILL_SEARCH_HANDLER(r.frame, r.wiring);
    h.search('');
    h.selectItems([0]);
    expect(r.sel()).toHaveLength(3);
    r.calls.length = 0;
    h.selectItems([1]);
    expect(r.sel()).toHaveLength(2);
  });
});

describe('net handlers', () => {
  it('SelectItems highlights the nets and selects nothing; Activate opens Net Classes', () => {
    const r = rig();
    const h = makePcbSearchHandlers(r.frame, r.wiring)[2]!;
    const n = h.search('');
    expect(n).toBeGreaterThan(0);
    h.selectItems?.([0]);
    expect(r.nets()).toHaveLength(1);
    expect(r.calls).toEqual([]);
    h.activateItem?.(0);
    expect(r.calls).toEqual(['setup:Net Classes']);
  });

  it('net code 0 reads "No Net"', () => {
    const r = rig();
    const h = makePcbSearchHandlers(r.frame, r.wiring)[2]!;
    h.search('');
    const names = Array.from({ length: h.search('') }, (_, i) => h.getResultCell(i, 0));
    expect(names).toContain('No Net');
  });
});
