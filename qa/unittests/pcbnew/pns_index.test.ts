// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The router's spatial index. Counterpart: `pcbnew/router/pns_index.cpp` (`INDEX`).
 *
 * Three views of one set of items — per layer, per net, and everything — kept
 * in step by `add` and `remove`. What the tests pin down is where those three
 * deliberately *disagree*:
 *
 * - **A multilayer item is filed once per layer**, so a query spanning its
 *   layers visits it once per shared layer and the returned count says so. The
 *   caller's obstacle set collapses the repeats, keyed on the pair of items;
 *   the index does not, and must not.
 * - **An item with the null net handle is not filed by net at all**, so
 *   `getItemsForNet(null)` is empty however many netless items were added.
 * - **A net whose items have all been removed keeps an empty list**, so
 *   `getItemsForNet` answers `[]` and not null for it. The difference is
 *   visible to `NODE::AllItemsInNet`, which branches on null.
 * - **`remove` bails before touching any of the three views** when the item's
 *   layers reach past the last bucket ever created. Widen an item's layer span
 *   after adding it and it can no longer be removed.
 * - **Deferred mode is a real, observable state**: between `setDeferred(true)`
 *   and `buildSpatialIndex()`, queries find nothing while the net map and the
 *   item count are already complete.
 */
import { describe, expect, it } from 'vitest';
import { PnsIndex, type IndexVisitor } from '@ziroeda/pcbnew/src/router/pns_index.js';
import { PnsItem, PnsKind } from '@ziroeda/pcbnew/src/router/pns_item.js';
import { PnsLayerRange } from '@ziroeda/pcbnew/src/router/pns_layerset.js';
import { PnsSegment } from '@ziroeda/pcbnew/src/router/pns_segment.js';
import type { NetHandle } from '@ziroeda/pcbnew/src/router/pns_collision.js';
import type { Shape } from '@ziroeda/pcbnew/src/drc/drc_geometry.js';

/** A horizontal zero-width segment from (x0,y) to (x1,y). */
const seg = (
  x0: number,
  x1: number,
  y: number,
  net: NetHandle,
  layers: PnsLayerRange,
): PnsSegment => {
  const s = new PnsSegment({ a: { x: x0, y }, b: { x: x1, y } }, net);
  s.setLayers(layers);
  return s;
};

/** An item with no shape at all, for the paths that have to cope with one. */
class ShapelessItem extends PnsItem {
  constructor(kind = PnsKind.SOLID_T) {
    super(kind);
  }

  override shape(): Shape | null {
    return null;
  }

  clone(): ShapelessItem {
    const c = new ShapelessItem(this.kind());
    c.copyFrom(this);
    return c;
  }
}

/** Collects what it saw, and which sub-index it was told it was in. */
const collector = (
  stopAfter = Number.POSITIVE_INFINITY,
): IndexVisitor & { seen: PnsItem[]; layers: number[] } => {
  const seen: PnsItem[] = [];
  const layers: number[] = [];
  let context = -1;

  const visitor = ((item: PnsItem): boolean => {
    seen.push(item);
    layers.push(context);
    return seen.length < stopAfter;
  }) as IndexVisitor & { seen: PnsItem[]; layers: number[] };

  visitor.seen = seen;
  visitor.layers = layers;
  visitor.setLayerContext = (l: number): void => {
    context = l;
  };
  visitor.clearLayerContext = (): void => {
    context = -1;
  };
  return visitor;
};

describe('PnsIndex.add', () => {
  it('files an item under everything at once', () => {
    const idx = new PnsIndex();
    const s = seg(0, 1000, 0, 5, new PnsLayerRange(0));
    idx.add(s);

    expect(idx.size()).toBe(1);
    expect(idx.contains(s)).toBe(true);
    expect(idx.getItemsForNet(5)).toEqual([s]);
    expect([...idx]).toEqual([s]);
  });

  it('refuses an item with no layers, which upstream asserts on', () => {
    const idx = new PnsIndex();
    const s = new PnsSegment({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, 1);
    expect(() => idx.add(s)).toThrow(/no layers/);
  });

  it('does not file an item on the null net', () => {
    const idx = new PnsIndex();
    idx.add(seg(0, 1000, 0, null, new PnsLayerRange(0)));
    expect(idx.size()).toBe(1);
    expect(idx.getItemsForNet(null)).toBeNull();
  });

  it('files net handle 0, which is a handle and not the null one', () => {
    const idx = new PnsIndex();
    const s = seg(0, 1000, 0, 0, new PnsLayerRange(0));
    idx.add(s);
    expect(idx.getItemsForNet(0)).toEqual([s]);
  });

  it('adding the same item twice files it in the net list twice', () => {
    const idx = new PnsIndex();
    const s = seg(0, 1000, 0, 5, new PnsLayerRange(0));
    idx.add(s);
    idx.add(s);
    expect(idx.size()).toBe(1); // a set
    expect(idx.getItemsForNet(5)).toEqual([s, s]); // a list
  });

  it('an item with no shape on a layer is simply not filed on it', () => {
    const idx = new PnsIndex();
    const ghost = new ShapelessItem();
    ghost.setLayers(new PnsLayerRange(0));
    idx.add(ghost);

    expect(idx.size()).toBe(1);

    const probe = seg(0, 1000, 0, 9, new PnsLayerRange(0));
    const v = collector();
    expect(idx.query(probe, 0, v)).toBe(0);
  });
});

describe('PnsIndex.query', () => {
  const build = (): { idx: PnsIndex; near: PnsSegment; far: PnsSegment; deep: PnsSegment } => {
    const idx = new PnsIndex();
    const near = seg(0, 1000, 0, 1, new PnsLayerRange(0));
    const far = seg(0, 1000, 100000, 2, new PnsLayerRange(0));
    const deep = seg(0, 1000, 0, 3, new PnsLayerRange(31));
    idx.add(near);
    idx.add(far);
    idx.add(deep);
    return { idx, near, far, deep };
  };

  it('visits only what is within the distance, and only on the item’s layers', () => {
    const { idx, near } = build();
    const probe = seg(0, 1000, 10, 9, new PnsLayerRange(0));
    const v = collector();

    expect(idx.query(probe, 100, v)).toBe(1);
    expect(v.seen).toEqual([near]);
  });

  it('widening the distance brings the far item in', () => {
    const { idx } = build();
    const probe = seg(0, 1000, 10, 9, new PnsLayerRange(0));
    const v = collector();

    expect(idx.query(probe, 100000, v)).toBe(2);
  });

  it('tells the visitor which sub-index it is walking', () => {
    const { idx, near, deep } = build();
    const probe = seg(0, 1000, 0, 9, new PnsLayerRange(0, 31));
    const v = collector();

    idx.query(probe, 0, v);
    expect(v.seen).toEqual([near, deep]);
    expect(v.layers).toEqual([0, 31]);
  });

  it('clears the layer context when the query is done', () => {
    const { idx } = build();
    const probe = seg(0, 1000, 0, 9, new PnsLayerRange(0));
    const v = collector();

    idx.query(probe, 0, v);
    v.seen.length = 0;
    v.layers.length = 0;

    // A second query with no matches must not leave a stale context behind
    // either; the fresh one is set before any visit.
    idx.query(seg(0, 1000, 0, 9, new PnsLayerRange(31)), 0, v);
    expect(v.layers).toEqual([31]);
  });

  it('counts a multilayer item once per layer it shares with the query', () => {
    const idx = new PnsIndex();
    const through = seg(0, 1000, 0, 1, new PnsLayerRange(0, 3));
    idx.add(through);

    const probe = seg(0, 1000, 0, 9, new PnsLayerRange(0, 3));
    const v = collector();

    expect(idx.query(probe, 0, v)).toBe(4);
    expect(v.seen).toEqual([through, through, through, through]);
    expect(v.layers).toEqual([0, 1, 2, 3]);
  });

  it('stops when the visitor says so', () => {
    const idx = new PnsIndex();
    idx.add(seg(0, 1000, 0, 1, new PnsLayerRange(0)));
    idx.add(seg(0, 1000, 1, 2, new PnsLayerRange(0)));
    idx.add(seg(0, 1000, 2, 3, new PnsLayerRange(0)));

    const v = collector(2);
    expect(idx.query(seg(0, 1000, 0, 9, new PnsLayerRange(0)), 10, v)).toBe(2);
    expect(v.seen).toHaveLength(2);
  });

  it('an item of no kind at all is not queried for', () => {
    const { idx } = build();
    const invalid = new ShapelessItem(PnsKind.INVALID_T);
    invalid.setLayers(new PnsLayerRange(0));

    const v = collector();
    expect(idx.query(invalid, 100000, v)).toBe(0);
    expect(v.seen).toEqual([]);
  });

  it('queryShape searches every bucket, treating all layers as colliding', () => {
    const { idx, near, far, deep } = build();
    const shape: Shape = { kind: 'circle', c: { x: 500, y: 0 }, r: 1 };
    const v = collector();

    expect(idx.queryShape(shape, 200000, v)).toBe(3);
    expect(new Set(v.seen)).toEqual(new Set([near, far, deep]));
  });
});

describe('PnsIndex.remove', () => {
  it('takes the item out of all three views', () => {
    const idx = new PnsIndex();
    const s = seg(0, 1000, 0, 5, new PnsLayerRange(0));
    idx.add(s);
    idx.remove(s);

    expect(idx.size()).toBe(0);
    expect(idx.contains(s)).toBe(false);

    const v = collector();
    expect(idx.query(seg(0, 1000, 0, 9, new PnsLayerRange(0)), 1000, v)).toBe(0);
  });

  it('leaves an empty list behind rather than dropping the net', () => {
    const idx = new PnsIndex();
    const s = seg(0, 1000, 0, 5, new PnsLayerRange(0));
    idx.add(s);
    idx.remove(s);

    expect(idx.getItemsForNet(5)).toEqual([]);
    expect(idx.getItemsForNet(6)).toBeNull();
  });

  it('takes out every occurrence from the net list, not just the first', () => {
    const idx = new PnsIndex();
    const s = seg(0, 1000, 0, 5, new PnsLayerRange(0));
    idx.add(s);
    idx.add(s);
    idx.remove(s);
    expect(idx.getItemsForNet(5)).toEqual([]);
  });

  it('bails entirely when the layers reach past the last bucket ever made', () => {
    const idx = new PnsIndex();
    const s = seg(0, 1000, 0, 5, new PnsLayerRange(0));
    idx.add(s); // creates bucket 0 and nothing more

    // Widening the span after the fact puts it out of the index's reach; the
    // early return happens before the all-items set or the net map is touched.
    s.setLayers(new PnsLayerRange(0, 9));
    idx.remove(s);

    expect(idx.size()).toBe(1);
    expect(idx.getItemsForNet(5)).toEqual([s]);
  });

  it('replace is a remove followed by an add', () => {
    const idx = new PnsIndex();
    const a = seg(0, 1000, 0, 5, new PnsLayerRange(0));
    const b = seg(0, 1000, 0, 6, new PnsLayerRange(0));
    idx.add(a);
    idx.replace(a, b);

    expect(idx.contains(a)).toBe(false);
    expect(idx.contains(b)).toBe(true);
    expect(idx.getItemsForNet(5)).toEqual([]);
    expect(idx.getItemsForNet(6)).toEqual([b]);
  });
});

describe('PnsIndex deferred loading', () => {
  it('registers the metadata but files nothing spatially until told to', () => {
    const idx = new PnsIndex();
    idx.setDeferred(true);

    const s = seg(0, 1000, 0, 5, new PnsLayerRange(0));
    idx.add(s);

    expect(idx.size()).toBe(1);
    expect(idx.getItemsForNet(5)).toEqual([s]);

    const before = collector();
    expect(idx.query(seg(0, 1000, 0, 9, new PnsLayerRange(0)), 1000, before)).toBe(0);

    idx.setDeferred(false);
    idx.buildSpatialIndex();

    const after = collector();
    expect(idx.query(seg(0, 1000, 0, 9, new PnsLayerRange(0)), 1000, after)).toBe(1);
  });

  it('bulk loading replaces bucket contents rather than doubling them', () => {
    const idx = new PnsIndex();
    const s = seg(0, 1000, 0, 5, new PnsLayerRange(0));
    idx.add(s); // filed eagerly
    idx.buildSpatialIndex(); // and again, in bulk

    const v = collector();
    expect(idx.query(seg(0, 1000, 0, 9, new PnsLayerRange(0)), 1000, v)).toBe(1);
  });

  it('fills every layer a multilayer item spans', () => {
    const idx = new PnsIndex();
    idx.setDeferred(true);
    const through = seg(0, 1000, 0, 5, new PnsLayerRange(0, 2));
    idx.add(through);
    idx.setDeferred(false);
    idx.buildSpatialIndex();

    const v = collector();
    expect(idx.query(seg(0, 1000, 0, 9, new PnsLayerRange(0, 2)), 0, v)).toBe(3);
  });
});

describe('PnsIndex.clone', () => {
  it('shares the items but not the containers', () => {
    const idx = new PnsIndex();
    const a = seg(0, 1000, 0, 5, new PnsLayerRange(0));
    idx.add(a);

    const c = idx.clone();
    expect(c.size()).toBe(1);
    expect(c.contains(a)).toBe(true);
    expect(c.getItemsForNet(5)).toEqual([a]);

    c.remove(a);
    expect(idx.size()).toBe(1);
    expect(idx.getItemsForNet(5)).toEqual([a]);

    const v = collector();
    expect(idx.query(seg(0, 1000, 0, 9, new PnsLayerRange(0)), 1000, v)).toBe(1);
  });

  it('does not carry the deferred flag across', () => {
    const idx = new PnsIndex();
    idx.setDeferred(true);

    const c = idx.clone();
    const s = seg(0, 1000, 0, 5, new PnsLayerRange(0));
    c.add(s);

    // The clone files eagerly, because upstream's clone builds a default INDEX
    // and copies exactly three fields — the flag is not one of them.
    const v = collector();
    expect(c.query(seg(0, 1000, 0, 9, new PnsLayerRange(0)), 1000, v)).toBe(1);
  });
});
