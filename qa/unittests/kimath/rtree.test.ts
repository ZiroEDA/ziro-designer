// The R-tree every KiCad spatial index is built on (thirdparty/rtree.h):
// a query must return exactly the rectangles that overlap, before and after
// removals, and the nearest-neighbour walk must come out in distance order.
// The expectations are brute force over the same rectangles, not the tree.
import { describe, expect, it } from 'vitest';
import { RTree } from '@ziroeda/kimath/src/thirdparty/rtree.js';

type R = [number, number, number, number];

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s % 1000;
  };
}

function overlaps(a: R, q: R): boolean {
  return !(a[0] > q[2] || q[0] > a[2] || a[1] > q[3] || q[1] > a[3]);
}

describe('RTree', () => {
  const rnd = lcg(12345);
  const rects: R[] = [];
  for (let i = 0; i < 500; i++) {
    const x = rnd();
    const y = rnd();
    rects.push([x, y, x + (rnd() % 50), y + (rnd() % 50)]);
  }

  it('finds exactly the overlapping rectangles, even after node splits', () => {
    const t = new RTree<number>(2);
    rects.forEach((r, i) => t.Insert([r[0], r[1]], [r[2], r[3]], i));
    expect(t.Count()).toBe(500);

    for (let q = 0; q < 100; q++) {
      const x = rnd();
      const y = rnd();
      const qr: R = [x, y, x + 100, y + 100];
      const got = new Set<number>();
      const n = t.Search([qr[0], qr[1]], [qr[2], qr[3]], (id) => {
        got.add(id);
        return true;
      });
      const want = new Set<number>();
      rects.forEach((r, i) => {
        if (overlaps(r, qr)) want.add(i);
      });
      expect(got).toEqual(want);
      expect(n).toBe(want.size);
    }
  });

  it('a callback returning false stops the search and reports it', () => {
    const t = new RTree<number>(2);
    rects.forEach((r, i) => t.Insert([r[0], r[1]], [r[2], r[3]], i));
    const finished = { value: true };
    let seen = 0;
    t.Search([0, 0], [1000, 1000], () => ++seen < 3, finished);
    expect(seen).toBe(3);
    expect(finished.value).toBe(false);
  });

  it('removes by rectangle and id, reinserting the orphaned subtrees', () => {
    const t = new RTree<number>(2);
    rects.forEach((r, i) => t.Insert([r[0], r[1]], [r[2], r[3]], i));
    for (let i = 0; i < 250; i++) {
      const r = rects[i]!;
      // false = found and removed
      expect(t.Remove([r[0], r[1]], [r[2], r[3]], i)).toBe(false);
    }
    // a second removal of the same item is "not found"
    expect(t.Remove([rects[0]![0], rects[0]![1]], [rects[0]![2], rects[0]![3]], 0)).toBe(true);
    expect(t.Count()).toBe(250);

    for (let q = 0; q < 100; q++) {
      const x = rnd();
      const y = rnd();
      const qr: R = [x, y, x + 100, y + 100];
      const got = new Set<number>();
      t.Search([qr[0], qr[1]], [qr[2], qr[3]], (id) => {
        got.add(id);
        return true;
      });
      const want = new Set<number>();
      rects.forEach((r, i) => {
        if (i >= 250 && overlaps(r, qr)) want.add(i);
      });
      expect(got).toEqual(want);
    }
  });

  it('a 3-dimensional tree keeps the extra axis (the connectivity layer span)', () => {
    const t = new RTree<string>(3);
    t.Insert([0, 0, 0], [0, 10, 10], 'front');
    t.Insert([5, 0, 0], [5, 10, 10], 'inner');
    t.Insert([0, 0, 0], [9, 10, 10], 'through');
    const hits: string[] = [];
    t.Search([5, 1, 1], [5, 2, 2], (d) => {
      hits.push(d);
      return true;
    });
    expect(hits.sort()).toEqual(['inner', 'through']);
  });

  it('NearestNeighbors walks out in distance order and stops when told to', () => {
    const t = new RTree<number>(2);
    rects.forEach((r, i) => t.Insert([r[0], r[1]], [r[2], r[3]], i));
    const p = [500, 500];
    const dist = (q: readonly number[], i: number): number => {
      const r = rects[i]!;
      const cx = (r[0] + r[2]) / 2;
      const cy = (r[1] + r[3]) / 2;
      return (cx - q[0]!) ** 2 + (cy - q[1]!) ** 2;
    };
    const nn = t.NearestNeighbors(
      p,
      (n) => n >= 5,
      () => true,
      dist,
    );
    expect(nn.length).toBe(5);
    const brute = rects.map((_, i) => [dist(p, i), i] as const).sort((a, b) => a[0] - b[0]);
    expect(nn.map(([d]) => d)).toEqual(brute.slice(0, 5).map(([d]) => d));
  });
});
