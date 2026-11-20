// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The anonymous usage counts beyond page views (designer/src/telemetry/usage_events.ts) and
 * the seam common/ reports through (common/usage_hooks.ts): the first edit in each kind of
 * editor, edits per active minute, page load timing, and the small-screen card.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EDA_BASE_FRAME } from '@ziroeda/common/eda_base_frame.js';
import { FRAME_T } from '@ziroeda/common/frame_type.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { PICKED_ITEMS_LIST } from '@ziroeda/common/undo_redo_container.js';
import {
  NoteUsage,
  SetUsageListener,
  type UsageProps,
  WithoutUsage,
} from '@ziroeda/common/usage_hooks.js';
import {
  loadTiming,
  type NavTiming,
  UsageEvents,
} from '@ziroeda/designer/src/telemetry/usage_events.js';

class PCB_LIKE_FRAME extends EDA_BASE_FRAME {
  constructor() {
    super(FRAME_T.FRAME_PCB_EDITOR, pcbIUScale, 'mm');
  }
}

const recorder = () => {
  const sent: [string, Record<string, unknown>][] = [];
  let now = 0;
  const events = new UsageEvents(
    (e, p) => sent.push([e, p]),
    () => now,
  );
  return {
    sent,
    events,
    at: (ms: number) => {
      now = ms;
    },
  };
};

afterEach(() => SetUsageListener(null));

describe('the common/ seam', () => {
  it('an edit pushed on any frame reaches the listener as its frame kind, and nothing else', () => {
    const got: [string, UsageProps][] = [];
    SetUsageListener((e, p) => got.push([e, p]));
    const frame = new PCB_LIKE_FRAME();
    frame.PushCommandToUndoList(new PICKED_ITEMS_LIST());
    frame.PushCommandToUndoList(new PICKED_ITEMS_LIST());
    expect(got).toEqual([
      ['edit', { frame: 'FRAME_PCB_EDITOR' }],
      ['edit', { frame: 'FRAME_PCB_EDITOR' }],
    ]);
    // the edit still lands on the undo list
    expect(frame.GetUndoCommandCount()).toBe(2);
  });

  it('does nothing with no listener, and a listener that throws never reaches the caller', () => {
    expect(() => NoteUsage('edit', { frame: 'x' })).not.toThrow();
    SetUsageListener(() => {
      throw new Error('broken listener');
    });
    const frame = new PCB_LIKE_FRAME();
    expect(() => frame.PushCommandToUndoList(new PICKED_ITEMS_LIST())).not.toThrow();
    expect(frame.GetUndoCommandCount()).toBe(1);
  });
});

describe('WithoutUsage', () => {
  it('silences reports inside, nested or not, and comes back afterwards, even after a throw', () => {
    const got: string[] = [];
    SetUsageListener((e) => got.push(e));
    expect(WithoutUsage(() => 7)).toBe(7);
    WithoutUsage(() => {
      NoteUsage('a');
      WithoutUsage(() => NoteUsage('b'));
      NoteUsage('c');
    });
    expect(got).toEqual([]);
    expect(() =>
      WithoutUsage(() => {
        throw new Error('x');
      }),
    ).toThrow('x');
    NoteUsage('after');
    expect(got).toEqual(['after']);
  });
});

describe('first_edit and edits per minute', () => {
  it('sends first_edit once per kind of editor, with the whole seconds since load', () => {
    const r = recorder();
    r.at(41_600);
    r.events.onEdit('FRAME_SCH');
    r.at(50_000);
    r.events.onEdit('FRAME_SCH');
    r.events.onEdit('FRAME_PCB_EDITOR');
    expect(r.sent).toEqual([
      ['first_edit', { frame: 'FRAME_SCH', s_since_load: 42 }],
      ['first_edit', { frame: 'FRAME_PCB_EDITOR', s_since_load: 50 }],
    ]);
  });

  it('counts every edit for active_minute and starts again from zero after each take', () => {
    const r = recorder();
    for (let i = 0; i < 3; i++) r.events.onEdit('FRAME_SCH');
    r.events.onEdit('FRAME_PCB_EDITOR');
    expect(r.events.takeEdits()).toBe(4);
    expect(r.events.takeEdits()).toBe(0);
    r.events.onEdit('FRAME_SCH');
    expect(r.events.takeEdits()).toBe(1);
  });

  it('routes what common/ reports: edits and the phone card; anything else is ignored', () => {
    const r = recorder();
    r.events.onCommonEvent('edit', { frame: 'FRAME_FOOTPRINT_EDITOR' });
    r.events.onCommonEvent('phone_gate', { action: 'copy' });
    r.events.onCommonEvent('something_else', { frame: 'FRAME_SCH' });
    expect(r.sent.map(([e, p]) => `${e}:${Object.values(p)[0]}`)).toEqual([
      'first_edit:FRAME_FOOTPRINT_EDITOR',
      'phone_gate:copy',
    ]);
    expect(r.events.takeEdits()).toBe(1);
  });
});

describe('phone_gate', () => {
  it('counts the card once per page load, and every use of either button', () => {
    const r = recorder();
    r.events.onGate('shown');
    r.events.onGate('shown');
    r.events.onGate('copy');
    r.events.onGate('copy');
    r.events.onGate('email');
    expect(r.sent).toEqual([
      ['phone_gate', { action: 'shown' }],
      ['phone_gate', { action: 'copy' }],
      ['phone_gate', { action: 'copy' }],
      ['phone_gate', { action: 'email' }],
    ]);
  });
});

describe('load_timing', () => {
  const nav = (o: Partial<NavTiming>): NavTiming => ({
    responseStart: 212.4,
    domContentLoadedEventEnd: 1830.6,
    loadEventEnd: 2410.2,
    transferSize: 5120,
    decodedBodySize: 4096,
    type: 'navigate',
    ...o,
  });

  it('carries the page timings in whole milliseconds and the device facts', () => {
    expect(
      loadTiming(nav({}), { webgl2: true, cores: 8, memoryGb: 4, connection: '4g', dpr: 2 }),
    ).toEqual({
      webgl2: true,
      ttfb_ms: 212,
      dom_ready_ms: 1831,
      load_ms: 2410,
      from_cache: false,
      nav_type: 'navigate',
      cores: 8,
      memory_gb: 4,
      connection: '4g',
      dpr: 2,
    });
  });

  it('marks a page the cache answered (nothing transferred, something decoded)', () => {
    expect(loadTiming(nav({ transferSize: 0 }), { webgl2: true }).from_cache).toBe(true);
    // nothing transferred AND nothing decoded is a cross-origin entry with hidden sizes
    expect(
      loadTiming(nav({ transferSize: 0, decodedBodySize: 0 }), { webgl2: true }).from_cache,
    ).toBe(false);
  });

  it('leaves out what the browser does not say, and still reports WebGL', () => {
    expect(loadTiming(undefined, { webgl2: false })).toEqual({ webgl2: false });
  });
});
