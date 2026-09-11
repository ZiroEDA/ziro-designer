// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Local Ratsnest tool reaches one hop from the clicked pads, no further.
 *
 * `RATSNEST_VIEW_ITEM::ViewDraw` decides per AIRWIRE from the two end items'
 * `GetLocalRatsnestVisible()` (`ratsnest_view_item.cpp:230-245`): with the
 * global ratsnest hidden, either end on shows the wire; with it shown, either
 * end off hides it. Ours collected the clicked pads' nets and drew every
 * airwire on them, so clicking one LED lit the whole of GND.
 */
import { describe, expect, it } from 'vitest';
import {
  airwireShown,
  localRatsnestKey,
  toggleLocalRatsnest,
  type RatsnestEdge,
} from '@ziroeda/pcbnew';

/** An airwire on net 1 between pad `a` of footprint `fa` and pad `b` of `fb`. */
const wire = (
  fa: number | undefined,
  a: number | undefined,
  fb: number | undefined,
  b: number | undefined,
): RatsnestEdge => ({
  net: 1,
  ax: 0,
  ay: 0,
  bx: 1,
  by: 1,
  aLayer: 'through',
  bLayer: 'through',
  aFootprint: fa,
  bFootprint: fb,
  aPad: a,
  bPad: b,
});

const none = new Set<string>();
const led = new Set([localRatsnestKey(0, 0), localRatsnestKey(0, 1)]);

describe('with the global ratsnest hidden', () => {
  it('shows nothing until a pad is toggled', () => {
    expect(airwireShown(wire(0, 0, 1, 0), false, none)).toBe(false);
  });

  it('shows the airwire that leaves a toggled pad', () => {
    expect(airwireShown(wire(0, 0, 1, 0), false, led)).toBe(true);
    // ...from either end.
    expect(airwireShown(wire(1, 0, 0, 1), false, led)).toBe(true);
  });

  it('does NOT show the next airwire on the same net', () => {
    // LED (fp 0) -> R (fp 1) is lit; R -> D (fp 2) on the same GND is not.
    expect(airwireShown(wire(1, 0, 2, 0), false, led)).toBe(false);
  });

  it('a track end or via holds the global flag, so pad-to-track needs the pad', () => {
    expect(airwireShown(wire(0, 0, undefined, undefined), false, led)).toBe(true);
    expect(airwireShown(wire(1, 0, undefined, undefined), false, led)).toBe(false);
  });
});

describe('with the global ratsnest shown, the tool turns airwires OFF', () => {
  it('every airwire shows by default', () => {
    expect(airwireShown(wire(0, 0, 1, 0), true, none)).toBe(true);
    expect(airwireShown(wire(0, 0, undefined, undefined), true, none)).toBe(true);
  });

  it('either toggled end hides the airwire', () => {
    expect(airwireShown(wire(0, 0, 1, 0), true, led)).toBe(false);
    expect(airwireShown(wire(1, 0, 0, 1), true, led)).toBe(false);
    expect(airwireShown(wire(1, 0, 2, 0), true, led)).toBe(true);
  });
});

describe('one click of the tool', () => {
  it('a pad flips', () => {
    const once = toggleLocalRatsnest(none, false, { kind: 'pad', footprint: 3, pad: 2 });
    expect([...once]).toEqual(['3:2']);
    expect(toggleLocalRatsnest(once, false, { kind: 'pad', footprint: 3, pad: 2 }).size).toBe(0);
  });

  it('a footprint follows its FIRST pad, not a majority', () => {
    // enable = !fp->Pads()[0]->GetLocalRatsnestVisible(): pad 0 is on, so
    // the click turns the whole part off even though pads 1 and 2 were off.
    const partial = new Set(['5:0']);
    const off = toggleLocalRatsnest(partial, false, {
      kind: 'footprint',
      footprint: 5,
      padCount: 3,
    });
    expect(off.size).toBe(0);
    const on = toggleLocalRatsnest(off, false, { kind: 'footprint', footprint: 5, padCount: 3 });
    expect([...on].sort()).toEqual(['5:0', '5:1', '5:2']);
  });

  it('with the global ratsnest shown, a footprint click turns it OFF', () => {
    const off = toggleLocalRatsnest(none, true, { kind: 'footprint', footprint: 5, padCount: 2 });
    expect([...off].sort()).toEqual(['5:0', '5:1']);
    expect(airwireShown(wire(5, 1, 6, 0), true, off)).toBe(false);
  });

  it('empty board puts every pad back to the global setting', () => {
    expect(toggleLocalRatsnest(led, false, null).size).toBe(0);
  });

  it('does not touch a part with no pads', () => {
    expect(
      toggleLocalRatsnest(led, false, { kind: 'footprint', footprint: 9, padCount: 0 }),
    ).toEqual(led);
  });
});
