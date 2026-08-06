// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The router item base and the two things built directly on it — the unique-id
 * carrier and the link holder — plus `ITEM_SET`.
 * Counterparts: `pns_item.h/.cpp`, `pns_linked_item.h`, `pns_link_holder.h`,
 * `pns_itemset.h/.cpp`.
 *
 * The cases worth leading with are the ones that look like mistakes:
 *
 * - **`isFreePad` inherits exactly one level.** It reads the parent pad or
 *   via's raw flag, not its `isFreePad()`, so free-ness does not propagate down
 *   a chain. Since free-pad-ness suppresses clearance entirely, getting this
 *   wrong in either direction silently changes what the router will route over.
 * - **`unmark()` with no argument clears every bit**, because the default is
 *   `-1` and the body is `&= ~aMarker`. `NODE::Commit` relies on it.
 * - **`ITEM_SET::filterMarker` ignores its `invert` argument.** Upstream takes
 *   the parameter and never reads it. Reproduced, and pinned here so nobody
 *   "fixes" it into a divergence.
 * - **`relevantShapeLayers` answers `[-1]` when neither side varies by layer.**
 *   `-1` is a sentinel meaning "ask once", not a layer, so the union of two
 *   sentinels would be wrong in a way that costs one wasted query per pair.
 */
import { describe, expect, it } from 'vitest';
import {
  LineMarker,
  PnsItem,
  PnsKind,
  PnsLinkHolder,
} from '@ziroeda/pcbnew/src/router/pns_item.js';
import { PnsItemSet } from '@ziroeda/pcbnew/src/router/pns_itemset.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import { PnsVia } from '@ziroeda/pcbnew/src/router/pns_via.js';

/** A minimal concrete item, for the parts of ITEM that no subclass changes. */
class TestItem extends PnsItem {
  constructor(kind: PnsKind = PnsKind.SOLID_T) {
    super(kind);
  }

  clone(): TestItem {
    const t = new TestItem(this.kind());
    t.copyFrom(this);
    return t;
  }

  /** Lets a test hang a free pad / via above this one. */
  parentItem: PnsItem | null = null;

  override parentPadVia(): PnsItem | null {
    return this.parentItem;
  }
}

class TestHolder extends PnsLinkHolder {
  constructor() {
    super(PnsKind.LINE_T);
  }

  clone(): TestHolder {
    const h = new TestHolder();
    h.copyFrom(this);
    h.copyLinks(this);
    return h;
  }
}

const seg = (net: unknown = 1): PnsSegment =>
  new PnsSegment({ a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }, net);

describe('PnsItem kinds', () => {
  it('ofKind is a mask test, so one item matches several bits', () => {
    const s = new TestItem(PnsKind.SEGMENT_T);
    expect(s.ofKind(PnsKind.SEGMENT_T)).toBe(true);
    expect(s.ofKind(PnsKind.SEGMENT_T | PnsKind.ARC_T)).toBe(true);
    expect(s.ofKind(PnsKind.VIA_T)).toBe(false);
    expect(s.ofKind(PnsKind.ANY_T)).toBe(true);
  });

  it('LINKED_ITEM_MASK_T selects exactly solid, segment, arc, via and hole', () => {
    const mask = PnsKind.LINKED_ITEM_MASK_T;
    for (const k of [
      PnsKind.SOLID_T,
      PnsKind.SEGMENT_T,
      PnsKind.ARC_T,
      PnsKind.VIA_T,
      PnsKind.HOLE_T,
    ]) {
      expect(new TestItem(k).ofKind(mask)).toBe(true);
    }
    for (const k of [PnsKind.LINE_T, PnsKind.JOINT_T, PnsKind.DIFF_PAIR_T]) {
      expect(new TestItem(k).ofKind(mask)).toBe(false);
    }
  });

  it('kindStr names every kind, and anything else is "unknown"', () => {
    const names: [PnsKind, string][] = [
      [PnsKind.ARC_T, 'arc'],
      [PnsKind.LINE_T, 'line'],
      [PnsKind.SEGMENT_T, 'segment'],
      [PnsKind.VIA_T, 'via'],
      [PnsKind.JOINT_T, 'joint'],
      [PnsKind.SOLID_T, 'solid'],
      [PnsKind.DIFF_PAIR_T, 'diff-pair'],
      [PnsKind.HOLE_T, 'hole'],
    ];
    for (const [kind, name] of names) expect(new TestItem(kind).kindStr()).toBe(name);
    expect(new TestItem(PnsKind.INVALID_T).kindStr()).toBe('unknown');
    expect(new TestItem(PnsKind.ANY_T).kindStr()).toBe('unknown');
  });
});

describe('PnsItem layers', () => {
  it('setLayers copies, so later edits to the source do not reach the item', () => {
    const src = new PnsLayerRange(0, 3);
    const item = new TestItem();
    item.setLayers(src);
    src.merge(new PnsLayerRange(31));
    expect(item.layers().end()).toBe(3);
  });

  it('layer() is the start of the span', () => {
    const item = new TestItem();
    item.setLayers(new PnsLayerRange(2, 9));
    expect(item.layer()).toBe(2);
  });

  it('setLayer collapses to one layer', () => {
    const item = new TestItem();
    item.setLayers(new PnsLayerRange(0, 31));
    item.setLayer(7);
    expect([item.layers().start(), item.layers().end()]).toEqual([7, 7]);
  });

  it('layersOverlap is the span test', () => {
    const a = new TestItem();
    const b = new TestItem();
    a.setLayers(new PnsLayerRange(0, 3));
    b.setLayers(new PnsLayerRange(3, 9));
    expect(a.layersOverlap(b)).toBe(true);
    b.setLayers(new PnsLayerRange(4, 9));
    expect(a.layersOverlap(b)).toBe(false);
  });
});

describe('PnsItem markers and rank', () => {
  it('unmark() with no argument clears every bit', () => {
    const item = new TestItem();
    item.mark(LineMarker.MK_HEAD | LineMarker.MK_LOCKED | LineMarker.MK_DP_COUPLED);
    item.unmark();
    expect(item.marker()).toBe(0);
  });

  it('unmark(bits) clears only those bits', () => {
    const item = new TestItem();
    item.mark(LineMarker.MK_HEAD | LineMarker.MK_LOCKED);
    item.unmark(LineMarker.MK_LOCKED);
    expect(item.marker()).toBe(LineMarker.MK_HEAD);
    expect(item.isLocked()).toBe(false);
  });

  it('isLocked reads exactly the MK_LOCKED bit', () => {
    const item = new TestItem();
    expect(item.isLocked()).toBe(false);
    item.mark(LineMarker.MK_VIOLATION);
    expect(item.isLocked()).toBe(false);
    item.mark(LineMarker.MK_LOCKED);
    expect(item.isLocked()).toBe(true);
  });

  it('rank starts at -1', () => {
    const item = new TestItem();
    expect(item.rank()).toBe(-1);
    item.setRank(4);
    expect(item.rank()).toBe(4);
  });
});

describe('PnsItem.isFreePad', () => {
  it('is true when the item itself is flagged', () => {
    const item = new TestItem();
    expect(item.isFreePad()).toBe(false);
    item.setIsFreePad();
    expect(item.isFreePad()).toBe(true);
  });

  it('is inherited from the parent pad or via', () => {
    const pad = new TestItem();
    pad.setIsFreePad();
    const hole = new TestItem(PnsKind.HOLE_T);
    hole.parentItem = pad;
    expect(hole.isFreePad()).toBe(true);
  });

  it('inherits exactly one level: the grandparent does not reach through', () => {
    const grandparent = new TestItem();
    grandparent.setIsFreePad();

    const parent = new TestItem();
    parent.parentItem = grandparent;
    expect(parent.isFreePad()).toBe(true); // one level

    const child = new TestItem();
    child.parentItem = parent;
    // parent's *raw flag* is false; only its computed isFreePad() is true, and
    // that is deliberately not what the child reads.
    expect(child.isFreePad()).toBe(false);
  });

  it('setIsFreePad(false) turns it back off', () => {
    const item = new TestItem();
    item.setIsFreePad(true);
    item.setIsFreePad(false);
    expect(item.isFreePad()).toBe(false);
  });
});

describe('PnsItem ownership', () => {
  it('belongsTo is identity against the owner', () => {
    const node = {};
    const other = {};
    const item = new TestItem();
    expect(item.belongsTo(node)).toBe(false);
    expect(item.belongsTo(null)).toBe(true);
    item.setOwner(node);
    expect(item.belongsTo(node)).toBe(true);
    expect(item.belongsTo(other)).toBe(false);
  });

  it('a copy is owned by nobody, whatever the original belonged to', () => {
    const node = {};
    const item = new TestItem();
    item.setOwner(node);
    item.setRank(3);
    const copy = item.clone();
    expect(copy.owner()).toBeNull();
    expect(copy.rank()).toBe(3);
  });

  it('owningNode goes through the parent pad/via when there is one', () => {
    const node = {};
    const via = new TestItem(PnsKind.VIA_T);
    via.setOwner(node);

    const hole = new TestItem(PnsKind.HOLE_T);
    hole.setOwner(via);
    expect(hole.owningNode()).toBe(via);

    hole.parentItem = via;
    expect(hole.owningNode()).toBe(node);
  });

  it('setParent seeds the source item, but clearing it does not', () => {
    const item = new TestItem();
    const board = { layer: 'F.Cu' };
    item.setParent(board);
    expect(item.parent()).toBe(board);
    expect(item.getSourceItem()).toBe(board);

    item.setParent(null);
    expect(item.parent()).toBeNull();
    expect(item.getSourceItem()).toBe(board);
  });
});

describe('PnsItem.relevantShapeLayers', () => {
  it('is the single sentinel when neither side varies by layer', () => {
    expect(seg().relevantShapeLayers(seg())).toEqual([-1]);
  });

  it('is the sorted union when one side does vary', () => {
    const via = new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0, 31), 600000, 300000, 1);
    // A NORMAL via reports one slot, ALL_LAYERS.
    expect(via.relevantShapeLayers(seg())).toEqual([-1, 0]);
    expect(seg().relevantShapeLayers(via)).toEqual([-1, 0]);
  });

  it('deduplicates and sorts across two varying items', () => {
    const a = new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0, 31), 600000, 300000, 1);
    const b = new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0, 31), 600000, 300000, 1);
    expect(a.relevantShapeLayers(b)).toEqual([0]);
  });
});

describe('PnsLinkedItem', () => {
  it('hands out a fresh unique id per item, and resetUid takes another', () => {
    const a = seg();
    const b = seg();
    expect(b.uid()).toBeGreaterThan(a.uid());

    const before = a.uid();
    a.resetUid();
    expect(a.uid()).toBeGreaterThan(before);
  });
});

describe('PnsLinkHolder', () => {
  it('link refuses to add the same item twice', () => {
    const h = new TestHolder();
    const s = seg();
    h.link(s);
    h.link(s);
    expect(h.linkCount()).toBe(1);
    expect(h.containsLink(s)).toBe(true);
    expect(h.isLinked()).toBe(true);
  });

  it('unlink of something not linked is a no-op, not an error', () => {
    const h = new TestHolder();
    const a = seg();
    h.link(a);
    h.unlink(seg());
    expect(h.linkCount()).toBe(1);
    h.unlink(a);
    expect(h.linkCount()).toBe(0);
    expect(h.isLinked()).toBe(false);
  });

  it('getLink counts negative indices back from the end', () => {
    const h = new TestHolder();
    const a = seg();
    const b = seg();
    h.link(a);
    h.link(b);
    expect(h.getLink(0)).toBe(a);
    expect(h.getLink(-1)).toBe(b);
    expect(h.getLink(-2)).toBe(a);
  });

  it('clearLinks detaches without touching the items', () => {
    const h = new TestHolder();
    const a = seg();
    h.link(a);
    h.clearLinks();
    expect(h.linkCount()).toBe(0);
    expect(a.owner()).toBeNull();
  });
});

describe('PnsItemSet', () => {
  const build = (): { set: PnsItemSet; s1: PnsSegment; s2: PnsSegment; v: PnsVia } => {
    const s1 = seg(1);
    s1.setLayers(new PnsLayerRange(0));
    const s2 = seg(2);
    s2.setLayers(new PnsLayerRange(31));
    const v = new PnsVia({ x: 0, y: 0 }, new PnsLayerRange(0, 31), 600000, 300000, 1);

    const set = new PnsItemSet();
    set.add(s1);
    set.add(s2);
    set.add(v);
    return { set, s1, s2, v };
  };

  it('the initial item and ownership go through the constructor', () => {
    const s = seg();
    const owned = new PnsItemSet(s, true);
    expect(owned.size()).toBe(1);
    expect(s.owner()).toBe(owned);

    const unowned = new PnsItemSet(seg());
    expect(unowned.size()).toBe(1);
    expect(new PnsItemSet().empty()).toBe(true);
  });

  it('count(-1) and count(ANY_T) shortcut to the whole size', () => {
    const { set } = build();
    expect(set.count()).toBe(3);
    expect(set.count(-1)).toBe(3);
    expect(set.count(PnsKind.ANY_T)).toBe(3);
    expect(set.count(PnsKind.SEGMENT_T)).toBe(2);
    expect(set.count(PnsKind.SEGMENT_T | PnsKind.VIA_T)).toBe(3);
    expect(set.count(PnsKind.ARC_T)).toBe(0);
  });

  it('the shortcut is why an item of no kind is still counted', () => {
    // INVALID_T is zero, and the mask loop is `kind & mask`, so an item of no
    // kind matches nothing — not even the all-ones mask. Without the shortcut
    // "how many items are in this set" would under-count it.
    const { set } = build();
    set.add(new TestItem(PnsKind.INVALID_T));

    expect(set.count()).toBe(4);
    expect(set.count(-1)).toBe(4);
    expect(set.count(PnsKind.ANY_T)).toBe(4);
    expect(set.count(PnsKind.SEGMENT_T | PnsKind.VIA_T)).toBe(3);
  });

  it('filterKinds keeps the matches and its invert keeps the rest', () => {
    expect(build().set.filterKinds(PnsKind.VIA_T).size()).toBe(1);
    expect(build().set.filterKinds(PnsKind.VIA_T, true).size()).toBe(2);
    expect(build().set.excludeKinds(PnsKind.VIA_T).size()).toBe(2);
  });

  it('filterNet compares handles by identity, invert included', () => {
    expect(build().set.filterNet(1).size()).toBe(2);
    expect(build().set.filterNet(1, true).size()).toBe(1);
    expect(build().set.excludeNet(1).size()).toBe(1);
    expect(build().set.filterNet(99).size()).toBe(0);
  });

  it('filterLayers with a negative end means a single layer', () => {
    expect(build().set.filterLayers(0).size()).toBe(2); // the layer-0 seg and the via
    expect(build().set.filterLayers(31).size()).toBe(2);
    expect(build().set.filterLayers(0, 31).size()).toBe(3);
    expect(build().set.excludeLayers(0).size()).toBe(1);
  });

  it('filterMarker ignores its invert argument — upstream never reads it', () => {
    const { set, s1 } = build();
    s1.mark(LineMarker.MK_HEAD);

    expect(set.clone().filterMarker(LineMarker.MK_HEAD).size()).toBe(1);
    // With a working invert this would be 2. It is not, and must not be.
    expect(set.clone().filterMarker(LineMarker.MK_HEAD, true).size()).toBe(1);
  });

  it('filters mutate in place and return the same set for chaining', () => {
    const { set } = build();
    const returned = set.filterKinds(PnsKind.SEGMENT_T);
    expect(returned).toBe(set);
    expect(set.size()).toBe(2);
  });

  it('erase removes one occurrence, excludeItem removes them all', () => {
    const s = seg();
    const a = new PnsItemSet();
    a.add(s);
    a.add(s);
    a.erase(s);
    expect(a.size()).toBe(1);

    const b = new PnsItemSet();
    b.add(s);
    b.add(s);
    b.excludeItem(s);
    expect(b.size()).toBe(0);
  });

  it('prepend puts an item at the front, where positional reads will see it', () => {
    const { set, s1, v } = build();
    set.prepend(v);
    expect(set.at(0)).toBe(v);
    expect(set.at(1)).toBe(s1);
  });

  it('findByKind walks the matches in order', () => {
    const { set, s1, s2, v } = build();
    expect(set.findByKind(PnsKind.SEGMENT_T)).toBe(s1);
    expect(set.findByKind(PnsKind.SEGMENT_T, 1)).toBe(s2);
    expect(set.findByKind(PnsKind.SEGMENT_T, 2)).toBeNull();
    expect(set.findByKind(PnsKind.VIA_T)).toBe(v);
    expect(set.findByKind(PnsKind.ARC_T)).toBeNull();
  });

  it('findVertex matches either end of a segment and ignores non-segments', () => {
    const { set, s1, v } = build();
    expect(set.findVertex({ x: 0, y: 0 })).toBe(s1);
    expect(set.findVertex({ x: 1000, y: 0 })).toBe(s1);
    expect(set.findVertex({ x: 500, y: 0 })).toBeNull();

    const viaOnly = new PnsItemSet();
    viaOnly.add(v);
    expect(viaOnly.findVertex({ x: 0, y: 0 })).toBeNull();
  });

  it('clone copies the sequence but shares the items', () => {
    const { set, s1 } = build();
    const c = set.clone();
    c.clear();
    expect(set.size()).toBe(3);
    expect(c.size()).toBe(0);
    expect(set.contains(s1)).toBe(true);
  });
});
