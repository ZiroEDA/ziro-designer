// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * JSON_SETTINGS + PROJECT_LOCAL_SETTINGS: the `.kicad_prl` in and out.
 */
import { describe, expect, it } from 'vitest';
import { GAL_LAYER_ID, PCB_LAYER_ID } from '@ziroeda/common/src/layer_ids.js';
import { LSET } from '@ziroeda/common/src/lset.js';
import { HIGH_CONTRAST_MODE } from '@ziroeda/common/src/project/board_project_settings.js';
import { PROJECT_LOCAL_SETTINGS } from '@ziroeda/common/src/project/project_local_settings.js';
import {
  JSON_SETTINGS,
  PARAM,
  PARAM_SCALED,
  ref,
  SETTINGS_LOC,
} from '@ziroeda/common/src/settings/json_settings.js';

describe('JSON_SETTINGS', () => {
  class T extends JSON_SETTINGS {
    m_a = 1;
    m_b = 'x';
    m_nm = 0;
    constructor() {
      super('t', SETTINGS_LOC.NONE, 1);
      this.addParam(new PARAM<number>('deep.a', ref(this, 'm_a'), 1, 0, 10));
      this.addParam(new PARAM<string>('b', ref(this, 'm_b'), 'x'));
      this.addParam(new PARAM_SCALED('deep.mm', ref(this, 'm_nm'), 0, 1 / 1_000_000));
    }
  }

  it('loads a dotted path from a nested tree, and a missing key resets to the default', () => {
    const t = new T();
    t.m_a = 5;
    t.LoadFromJson({ deep: { a: 7 } });

    expect(t.m_a).toBe(7);
    expect(t.m_b).toBe('x'); // absent -> default, not "left alone"
  });

  it('a value outside the range falls back to the DEFAULT, not the nearest bound', () => {
    const t = new T();
    t.LoadFromJson({ deep: { a: 99 } });

    expect(t.m_a).toBe(1);
  });

  it('PARAM_SCALED: the scale is the file unit per IU; a load divides by it, a store multiplies', () => {
    const t = new T();
    t.LoadFromJson({ deep: { mm: 0.25 } });
    expect(t.m_nm).toBe(250_000);

    t.m_nm = 1_500_000;
    expect(t.SaveToJson()).toMatchObject({ deep: { mm: 1.5 } });
  });

  it('Store writes the members back and reports whether anything changed', () => {
    const t = new T();
    // A key the file lacked is one Store has to add, so the first Store after
    // a partial load reports a change; the second, with every key present,
    // does not.
    t.LoadFromJson({ meta: { version: 1 }, deep: { a: 3, mm: 0 }, b: 'y' });
    expect(t.Store()).toBe(false);

    t.m_a = 4;
    expect(t.Store()).toBe(true);
    expect(t.Get<number>('deep.a')).toBe(4);
  });

  it('a file from a later schema is loaded but flagged as a future format', () => {
    const t = new T();
    t.LoadFromJson({ meta: { version: 99 }, deep: { a: 2 } });

    expect(t.m_a).toBe(2);
    expect(t.IsFutureFormat()).toBe(true);
  });
});

describe('PROJECT_LOCAL_SETTINGS', () => {
  it('reads visible items by NAME and leaves the non-user items untouched', () => {
    const s = new PROJECT_LOCAL_SETTINGS('p.kicad_prl');
    s.LoadFromJson({ board: { visible_items: ['tracks', 'vias'] } });

    expect(s.m_VisibleItems.Contains(GAL_LAYER_ID.LAYER_TRACKS)).toBe(true);
    expect(s.m_VisibleItems.Contains(GAL_LAYER_ID.LAYER_VIAS)).toBe(true);
    expect(s.m_VisibleItems.Contains(GAL_LAYER_ID.LAYER_PADS)).toBe(false);
  });

  it('writes an all-hidden set as ["none"], and reads it back as hidden', () => {
    // The explicit marker: a user who hid everything is not a wiped-out array.
    const s = new PROJECT_LOCAL_SETTINGS('p.kicad_prl');
    s.LoadFromJson({ board: { visible_items: ['none'] } });
    expect(s.m_VisibleItems.Contains(GAL_LAYER_ID.LAYER_TRACKS)).toBe(false);

    const out = s.SaveToJson();
    expect((out.board as { visible_items: string[] }).visible_items).toEqual(['none']);
  });

  it('treats an EMPTY visible_items array as corrupted and restores the defaults', () => {
    const s = new PROJECT_LOCAL_SETTINGS('p.kicad_prl');
    s.LoadFromJson({ board: { visible_items: [] } });

    expect(s.m_VisibleItems.Contains(GAL_LAYER_ID.LAYER_TRACKS)).toBe(true);
  });

  it('round-trips the visible layers as hex', () => {
    const s = new PROJECT_LOCAL_SETTINGS('p.kicad_prl');
    const two = new LSET().set(PCB_LAYER_ID.F_Cu).set(PCB_LAYER_ID.B_Cu);
    s.LoadFromJson({ board: { visible_layers: two.FmtHex() } });

    expect(s.m_VisibleLayers.test(PCB_LAYER_ID.F_Cu)).toBe(true);
    expect(s.m_VisibleLayers.test(PCB_LAYER_ID.In1_Cu)).toBe(false);

    const out = s.SaveToJson();
    expect((out.board as { visible_layers: string }).visible_layers).toBe(two.FmtHex());
  });

  it('an enum past its range falls back to the default rather than inventing a member', () => {
    const s = new PROJECT_LOCAL_SETTINGS('p.kicad_prl');
    s.LoadFromJson({ board: { high_contrast_mode: 7 } });

    expect(s.m_ContrastModeDisplay).toBe(HIGH_CONTRAST_MODE.NORMAL);
  });

  it('the selection filter only changes the keys the file names', () => {
    const s = new PROJECT_LOCAL_SETTINGS('p.kicad_prl');
    s.LoadFromJson({ board: { selection_filter: { tracks: false } } });

    expect(s.m_PcbSelectionFilter.tracks).toBe(false);
    expect(s.m_PcbSelectionFilter.vias).toBe(true);
  });

  it('records and finds a file state', () => {
    const s = new PROJECT_LOCAL_SETTINGS('p.kicad_prl');
    s.SaveFileState('a.kicad_pcb', null, true);

    expect(s.GetFileState('a.kicad_pcb')?.open).toBe(true);
    expect(s.GetFileState('b.kicad_pcb')).toBeNull();

    const out = s.SaveToJson();
    const files = (out.project as { files: { name: string; open: boolean }[] }).files;
    expect(files).toEqual([expect.objectContaining({ name: 'a.kicad_pcb', open: true })]);
  });
});
