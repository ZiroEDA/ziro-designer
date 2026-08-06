// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The connection point that makes the router's world a graph.
 * Counterpart: `pcbnew/router/pns_joint.h` (`JOINT`).
 *
 * Almost every predicate here answers one question the router asks while
 * following a track, and the exact threshold in each is the difference between
 * picking up a whole trace and picking up one segment of it. Four things are
 * worth stating before the tests:
 *
 * - **Identity is position and net; merging additionally needs layers.**
 *   `equals` ignores layers and `overlaps` does not, and they are not
 *   interchangeable — a via's joint and a segment's joint at the same point are
 *   equal, and only merge because their layer spans touch.
 * - **Unlinking the last item empties the layer span.** Since an empty span
 *   overlaps nothing, a dangling joint stops being findable and stops merging.
 *   That is the whole garbage-collection story for joints.
 * - **`merge` appends links without the duplicate check `link` performs.** So a
 *   joint merged with itself would double its list; callers guard by testing
 *   `overlaps` first, which `merge` also does.
 * - **`isLineCorner` has two shapes.** Exactly two links is the ordinary case.
 *   More than two links with exactly two of them tracks is the *locked* case,
 *   and it is refused outright unless locked segments are being followed —
 *   because the extra links are the virtual vias the router itself dropped
 *   around the locked segment.
 */
import { describe, expect, it } from 'vitest';
import { LineMarker } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { jointTagsEqual, PnsJoint } from '@ziroeda/pcbnew/src/router/pns_joint.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsArc } from '@ziroeda/pcbnew/src/router/pns_arc.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsSolid } from '@ziroeda/pcbnew/src/router/pns_solid.js';
import { PnsVia, PnsVVia } from '@ziroeda/pcbnew/src/router/pns_via.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';

const L0 = (): PnsLayerRange => new PnsLayerRange(0);

const seg = (width = 100, net: NetHandle = 1, layer = 0): PnsSegment => {
  const s = new PnsSegment({ seg: { a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }, width }, net);
  s.setLayers(new PnsLayerRange(layer));
  return s;
};

const arc = (width = 100, net: NetHandle = 1): PnsArc => {
  const a = new PnsArc(
    { p0: { x: 0, y: 0 }, arcMid: { x: 500, y: 500 }, p1: { x: 1000, y: 0 }, width },
    net,
  );
  a.setLayers(L0());
  return a;
};

const via = (net: NetHandle = 1): PnsVia => {
  const v = new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0, 31), 600, 300, net);
  return v;
};

const joint = (net: NetHandle = 1, layers = L0()): PnsJoint =>
  new PnsJoint({ x: 0, y: 0 }, layers, net);

describe('PnsJoint identity', () => {
  it('is position and net, layers ignored', () => {
    const a = new PnsJoint({ x: 10, y: 20 }, new PnsLayerRange(0), 1);
    const b = new PnsJoint({ x: 10, y: 20 }, new PnsLayerRange(31), 1);
    expect(a.equals(b)).toBe(true);

    expect(a.equals(new PnsJoint({ x: 10, y: 21 }, new PnsLayerRange(0), 1))).toBe(false);
    expect(a.equals(new PnsJoint({ x: 10, y: 20 }, new PnsLayerRange(0), 2))).toBe(false);
  });

  it('overlaps additionally requires the layer spans to touch', () => {
    const a = new PnsJoint({ x: 10, y: 20 }, new PnsLayerRange(0, 3), 1);
    expect(a.overlaps(new PnsJoint({ x: 10, y: 20 }, new PnsLayerRange(3, 9), 1))).toBe(true);
    expect(a.overlaps(new PnsJoint({ x: 10, y: 20 }, new PnsLayerRange(4, 9), 1))).toBe(false);
  });

  it('the net lives in the tag, not in the item base', () => {
    const j = joint(5);
    expect(j.net()).toBe(5);
    j.setNet(9); // ITEM::SetNet writes m_net, which JOINT::Net() does not read
    expect(j.net()).toBe(5);
    expect(j.tag().net).toBe(5);
  });

  it('the tag equality helper matches the joint’s own', () => {
    const a = joint(1);
    const b = joint(1);
    expect(jointTagsEqual(a.tag(), b.tag())).toBe(true);
    expect(jointTagsEqual(a.tag(), joint(2).tag())).toBe(false);
  });

  it('a default joint sits at the origin on no net and no layers', () => {
    const j = new PnsJoint();
    expect(j.pos()).toEqual({ x: 0, y: 0 });
    expect(j.net()).toBeNull();
    expect(j.layers().start()).toBe(-1);
  });
});

describe('PnsJoint linking', () => {
  it('link refuses duplicates', () => {
    const j = joint();
    const s = seg();
    j.link(s);
    j.link(s);
    expect(j.linkCount()).toBe(1);
  });

  it('linkCount takes a kind mask', () => {
    const j = joint();
    j.link(seg());
    j.link(seg());
    j.link(via());
    expect(j.linkCount()).toBe(3);
    expect(j.linkCount(-1)).toBe(3);
    expect(j.linkCount(8 /* SEGMENT_T */)).toBe(2);
  });

  it('unlinking the last item empties the layer span, so the joint matches nothing', () => {
    const j = joint();
    const a = seg();
    const b = seg();
    j.link(a);
    j.link(b);

    expect(j.unlink(a)).toBe(false);
    expect(j.layers().start()).toBe(0);

    expect(j.unlink(b)).toBe(true);
    expect(j.layers().start()).toBe(-1);
    expect(j.layers().overlaps(new PnsLayerRange(0))).toBe(false);
  });

  it('via() finds the first via linked, and null when there is none', () => {
    const j = joint();
    j.link(seg());
    expect(j.via()).toBeNull();

    const v = via();
    j.link(v);
    j.link(via());
    expect(j.via()).toBe(v);
  });
});

describe('PnsJoint.merge', () => {
  it('does nothing at all when the two do not overlap', () => {
    const a = new PnsJoint({ x: 0, y: 0 }, new PnsLayerRange(0), 1);
    const b = new PnsJoint({ x: 0, y: 0 }, new PnsLayerRange(31), 1);
    b.link(seg());
    b.lock();

    a.merge(b);
    expect(a.linkCount()).toBe(0);
    expect(a.isLocked()).toBe(false);
    expect(a.layers().end()).toBe(0);
  });

  it('widens the layer span, inherits the lock and takes the links', () => {
    const a = new PnsJoint({ x: 0, y: 0 }, new PnsLayerRange(0, 3), 1);
    const b = new PnsJoint({ x: 0, y: 0 }, new PnsLayerRange(2, 9), 1);
    const s = seg();
    b.link(s);
    b.lock();

    a.merge(b);
    expect([a.layers().start(), a.layers().end()]).toEqual([0, 9]);
    expect(a.isLocked()).toBe(true);
    expect(a.linkList()).toEqual([s]);
  });

  it('never *un*-locks: merging an unlocked joint into a locked one leaves it locked', () => {
    const a = joint();
    a.lock();
    a.merge(joint());
    expect(a.isLocked()).toBe(true);
  });

  it('appends links without the duplicate check, unlike link()', () => {
    const s = seg();
    const a = joint();
    a.link(s);

    const b = joint();
    b.link(s);

    a.merge(b);
    expect(a.linkCount()).toBe(2); // the same item, twice
  });

  it('the joint lock is its own flag, not the MK_LOCKED marker bit', () => {
    const j = joint();
    j.mark(LineMarker.MK_LOCKED);
    expect(j.isLocked()).toBe(false);
    j.lock();
    expect(j.isLocked()).toBe(true);
    j.lock(false);
    expect(j.isLocked()).toBe(false);
  });
});

describe('PnsJoint.isLineCorner', () => {
  it('is true for two tracks of the same width, and false when the widths differ', () => {
    const same = joint();
    same.link(seg(100));
    same.link(seg(100));
    expect(same.isLineCorner()).toBe(true);

    const different = joint();
    different.link(seg(100));
    different.link(seg(200));
    expect(different.isLineCorner()).toBe(false);
  });

  it('counts an arc as a track', () => {
    const j = joint();
    j.link(seg(100));
    j.link(arc(100));
    expect(j.isLineCorner()).toBe(true);
  });

  it('is false when either segment is locked, unless locked segments are allowed', () => {
    const j = joint();
    const a = seg(100);
    a.mark(LineMarker.MK_LOCKED);
    j.link(a);
    j.link(seg(100));

    expect(j.isLineCorner()).toBe(false);
    expect(j.isLineCorner(true)).toBe(true);
  });

  it('is false for a via meeting a track, and for a lone track', () => {
    const withVia = joint();
    withVia.link(seg());
    withVia.link(via());
    expect(withVia.isLineCorner()).toBe(false);

    const lone = joint();
    lone.link(seg());
    expect(lone.isLineCorner()).toBe(false);
  });

  it('with more than two links it is refused outright unless locked segs are followed', () => {
    const j = joint();
    j.link(seg(100));
    j.link(seg(100));
    j.link(new PnsVVia({ x: 0, y: 0 }, 0, 600, 1));

    expect(j.isLineCorner()).toBe(false);
    expect(j.isLineCorner(true)).toBe(true); // the virtual via is skipped
  });

  it('...and a *real* via among the extra links refuses it even then', () => {
    const j = joint();
    j.link(seg(100));
    j.link(seg(100));
    j.link(via());
    expect(j.isLineCorner(true)).toBe(false);
  });

  it('...and the widths still have to match in that branch', () => {
    const j = joint();
    j.link(seg(100));
    j.link(seg(200));
    j.link(new PnsVVia({ x: 0, y: 0 }, 0, 600, 1));
    expect(j.isLineCorner(true)).toBe(false);
  });
});

describe('PnsJoint shape predicates', () => {
  it('isNonFanoutVia wants exactly one via and two tracks, virtuals excluded', () => {
    const j = joint();
    j.link(via());
    j.link(seg());
    j.link(seg());
    expect(j.isNonFanoutVia()).toBe(true);

    j.link(new PnsVVia({ x: 0, y: 0 }, 0, 600, 1)); // virtual: not counted
    expect(j.isNonFanoutVia()).toBe(true);

    j.link(seg());
    expect(j.isNonFanoutVia()).toBe(false);
  });

  it('isStitchingVia is a via with nothing else attached', () => {
    const j = joint();
    j.link(via());
    expect(j.isStitchingVia()).toBe(true);

    j.link(seg());
    expect(j.isStitchingVia()).toBe(false);
  });

  it('isTrivialEndpoint is a lone segment — an arc does not count', () => {
    const j = joint();
    j.link(seg());
    expect(j.isTrivialEndpoint()).toBe(true);

    const a = joint();
    a.link(arc());
    expect(a.isTrivialEndpoint()).toBe(false);
  });

  it('isTraceWidthChange wants exactly two segments of unequal width', () => {
    const change = joint();
    change.link(seg(100));
    change.link(seg(200));
    expect(change.isTraceWidthChange()).toBe(true);

    const same = joint();
    same.link(seg(100));
    same.link(seg(100));
    expect(same.isTraceWidthChange()).toBe(false);
  });

  it('isTraceWidthChange is false as soon as a via is present', () => {
    const j = joint();
    j.link(seg(100));
    j.link(seg(200));
    j.link(via());
    expect(j.isTraceWidthChange()).toBe(false);
  });

  it('isTraceWidthChange counts *segments* for the pair, so one segment is not enough', () => {
    const j = joint();
    j.link(seg(100));
    j.link(arc(200));
    expect(j.isTraceWidthChange()).toBe(false);
  });
});

describe('PnsJoint.nextSegment', () => {
  it('returns the one other track, which is what makes a line followable', () => {
    const j = joint();
    const a = seg();
    const b = seg();
    j.link(a);
    j.link(b);
    expect(j.nextSegment(a)).toBe(b);
    expect(j.nextSegment(b)).toBe(a);
  });

  it('returns null at a fork: two candidates are not a line', () => {
    const j = joint();
    const a = seg();
    j.link(a);
    j.link(seg());
    j.link(seg());
    expect(j.nextSegment(a)).toBeNull();
  });

  it('returns null the moment a solid or a via is attached', () => {
    for (const other of [via(), new PnsSolid()]) {
      const j = joint();
      const a = seg();
      j.link(a);
      j.link(seg());
      j.link(other);
      expect(j.nextSegment(a)).toBeNull();
    }
  });

  it('skips a virtual via only when locked segments are being followed', () => {
    const j = joint();
    const a = seg();
    const b = seg();
    j.link(a);
    j.link(b);
    j.link(new PnsVVia({ x: 0, y: 0 }, 0, 600, 1));

    expect(j.nextSegment(a)).toBeNull();
    expect(j.nextSegment(a, true)).toBe(b);
  });

  it('will not step onto a locked segment unless allowed to', () => {
    const j = joint();
    const a = seg();
    const locked = seg();
    locked.mark(LineMarker.MK_LOCKED);
    j.link(a);
    j.link(locked);

    expect(j.nextSegment(a)).toBeNull();
    expect(j.nextSegment(a, true)).toBe(locked);
  });

  it('ignores tracks on another net or another layer', () => {
    const otherNet = joint();
    const a = seg(100, 1);
    otherNet.link(a);
    otherNet.link(seg(100, 2));
    expect(otherNet.nextSegment(a)).toBeNull();

    const otherLayer = joint();
    const b = seg(100, 1, 0);
    otherLayer.link(b);
    otherLayer.link(seg(100, 1, 31));
    expect(otherLayer.nextSegment(b)).toBeNull();
  });
});

describe('PnsJoint copying', () => {
  it('copy() takes the tag, the layers, the lock and its own link list', () => {
    const a = new PnsJoint({ x: 3, y: 4 }, new PnsLayerRange(0, 3), 7);
    const s = seg();
    a.link(s);
    a.lock();

    const b = a.copy();
    expect(b.pos()).toEqual({ x: 3, y: 4 });
    expect(b.net()).toBe(7);
    expect(b.isLocked()).toBe(true);
    expect(b.linkList()).toEqual([s]);

    b.unlink(s);
    expect(a.linkCount()).toBe(1); // the lists are separate
  });

  it('clone() throws, because upstream asserts there', () => {
    expect(() => joint().clone()).toThrow(/Clone/);
  });
});
