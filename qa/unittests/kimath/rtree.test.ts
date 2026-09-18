// The R-tree every KiCad spatial index is built on (thirdparty/rtree.h):
// a query must return exactly the rectangles that overlap, before and after
// removals, and the nearest-neighbour walk must come out in distance order.
// The expectations are brute force over the same rectangles, not the tree.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RTree, RTreeIntReal } from '@ziroeda/kimath/src/thirdparty/rtree.js';

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

describe("RTree visit order against KiCad's rtree.h", () => {
  // qa/probes/rtree_order_oracle/rtree_order_oracle.cpp: KiCad's own header
  // over a fixed rectangle set, once as `RTree<intptr_t, int, 2, double>`
  // (every spatial index) and once as `RTree<intptr_t, intptr_t, 2, intptr_t>`
  // (splitCollinearOutlines). The order the callback sees the ids in is the
  // tree's structure — the quadratic split and PickBranch tie-breaks — so
  // the port must reproduce it, not only the set.
  type ORACLE = { rects: R[]; queries: R[]; double: number[][]; intptr: number[][] };
  const load = (name: string): ORACLE =>
    JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../fixtures/${name}.json`, import.meta.url)), 'utf8'),
    ) as ORACLE;

  const orders = (tree: RTree<number>, o: ORACLE): number[][] => {
    o.rects.forEach((r, i) => tree.Insert([r[0], r[1]], [r[2], r[3]], i));
    return o.queries.map((q) => {
      const order: number[] = [];
      tree.Search([q[0], q[1]], [q[2], q[3]], (id) => {
        order.push(id);
        return true;
      });
      return order;
    });
  };

  for (const name of ['rtree_order_oracle_nm', 'rtree_order_oracle_unit']) {
    it(`${name}: the double tree visits in the C++ order`, () => {
      const o = load(name);
      expect(orders(new RTree<number>(2), o)).toEqual(o.double);
    });

    it(`${name}: the intptr_t tree visits in the C++ order`, () => {
      const o = load(name);
      expect(orders(new RTreeIntReal<number>(2), o)).toEqual(o.intptr);
    });
  }

  it('the unit fixture tells the two instantiations apart', () => {
    const o = load('rtree_order_oracle_unit');
    expect(o.double).not.toEqual(o.intptr);
  });
});

/**
 * The tree's SHAPE, not just its answers: which branch an insert descends and
 * how a full node splits are `PickBranch` / `ChoosePartition` / `PickSeeds`,
 * volume arithmetic over combined rectangles. The port computes those volumes
 * without building the temporaries the C++ keeps on the stack, and this pins
 * that the arithmetic — hence the tree, hence the visit order every query
 * reports items in — did not move: the checksums were recorded from the port
 * as it was before that change, over 20 000 random inserts and 50 queries.
 */
describe('RTree visit order', () => {
  let seed = 777;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const fnv = (s: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  const run = (dims: number, t: RTree<number>, n: number): string => {
    for (let i = 0; i < n; i++) {
      const mn: number[] = [];
      const mx: number[] = [];
      for (let d = 0; d < dims; d++) {
        const lo = Math.floor(rnd() * 2e8 - 1e8);
        mn.push(lo);
        mx.push(lo + Math.floor(rnd() * 5e6));
      }
      t.Insert(mn, mx, i);
    }
    const orders: string[] = [];
    for (let q = 0; q < 50; q++) {
      const mn: number[] = [];
      const mx: number[] = [];
      for (let d = 0; d < dims; d++) {
        const lo = Math.floor(rnd() * 2e8 - 1e8);
        mn.push(lo);
        mx.push(lo + Math.floor(rnd() * 4e7));
      }
      const o: number[] = [];
      t.Search(mn, mx, (id) => {
        o.push(id);
        return true;
      });
      orders.push(o.join(','));
    }
    return fnv(orders.join('|'));
  };

  it('is the order the tree reported before the volume temporaries went', () => {
    // The three run in sequence on one generator, as they were recorded.
    expect(run(2, new RTree<number>(2), 20000)).toBe('275de6c6');
    expect(run(3, new RTree<number>(3), 20000)).toBe('e103cf00');
    expect(run(2, new RTreeIntReal<number>(2), 5000)).toBe('d1448273');
  });
});

/**
 * The intptr_t tree's volumes are int64 in the C++. The port holds one in a
 * double while it is below 2^53 and in a BigInt from there on, so the value
 * must equal the int64 formula either side of that line: with a half-extent
 * of 2^27 the sum of squares passes 2^54, where a double keeps only every
 * fourth integer, and a port that stayed in doubles would hand the split
 * heuristics a rounded volume.
 */
describe('RTreeIntReal volume arithmetic', () => {
  class Probe extends RTreeIntReal<number> {
    volume(mn: number[], mx: number[]): number | bigint {
      return this.CalcRectVolumeInt(new Float64Array([...mn, ...mx]), 0);
    }
    combined(a: [number[], number[]], b: [number[], number[]]): number | bigint {
      return this.CombinedRectVolumeInt(
        new Float64Array([...a[0], ...a[1]]),
        0,
        new Float64Array([...b[0], ...b[1]]),
        0,
      );
    }
  }
  // ( (int64) max - (int64) min ) * 0.5f truncated, squared and summed in
  // int64, times (intptr_t) 3.141593f == 3: the C++ arithmetic, in BigInt.
  const int64Volume = (mn: number[], mx: number[]): bigint => {
    let s = 0n;
    for (let d = 0; d < 2; d++) {
      const h = BigInt(Math.trunc(Math.fround(mx[d]! - mn[d]!) * 0.5));
      s += h * h;
    }
    return s * 3n;
  };

  it('equals the int64 formula below, at and past 2^53', () => {
    const probe = new Probe(2);
    const cases: [number[], number[]][] = [
      [
        [0, 0],
        [10, 10],
      ], // tiny: stays a double
      [
        [0, 0],
        [2 ** 28 - 2, 2],
      ], // half-extents 2^27 - 1 and 1: just under
      [
        [0, 0],
        [2 ** 28, 2],
      ], // 2^54 + 1: a double would round it to 2^54
      [
        [0, 0],
        [2 ** 28, 6],
      ], // 2^54 + 9 -> a double gives 2^54 + 8
      [
        [-(2 ** 30), -(2 ** 30)],
        [2 ** 30 - 1, 2 ** 30 - 1],
      ], // a whole int32 board
      // A width converts to float first, so a half-extent has at most 24
      // significant bits and its square is always exact; what rounds is the
      // SUM of two squares of different magnitude, and the product by 3.
      // Half-extents 94906264 and 17559: each square exact, the sum
      // 9007199254756177 is past 2^53 and odd -- a double cannot hold it.
      [
        [0, 0],
        [189812528, 35118],
      ],
      // Half-extents 60000000 and 1: the sum 3600000000000001 is below 2^53,
      // three times it is past and odd.
      [
        [0, 0],
        [120000000, 2],
      ],
      // Half-extents 94906264 and 17321: the sum is just under 2^53 and exact,
      // times 3 is not.
      [
        [0, 0],
        [189812528, 34642],
      ],
    ];
    for (const [mn, mx] of cases) {
      const v = probe.volume(mn, mx);
      expect(BigInt(v), `${mn} .. ${mx}`).toBe(int64Volume(mn, mx));
    }
  });

  it('combines two rectangles to the int64 volume of their union rectangle', () => {
    const probe = new Probe(2);
    const a: [number[], number[]] = [
      [0, 0],
      [2 ** 28, 4],
    ];
    const b: [number[], number[]] = [
      [2 ** 28, 2],
      [2 ** 29, 8],
    ];
    const v = probe.combined(a, b);
    expect(BigInt(v)).toBe(int64Volume([0, 0], [2 ** 29, 8]));
    // and the difference the heuristics take is exact: 3 * ((2^28)^2 - (2^27)^2 + 4^2 - 2^2)
    const area = probe.volume(a[0], a[1]);
    expect(BigInt(v) - BigInt(area)).toBe(3n * ((1n << 56n) - (1n << 54n) + 16n - 4n));
  });
});
