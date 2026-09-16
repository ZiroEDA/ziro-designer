// KiCad's copy of delaunator (thirdparty/delaunator): the ratsnest's
// triangulation. The expectations are the Delaunay properties themselves —
// the triangle count Euler gives for a point set with a known hull, an
// empty circumcircle for every triangle — not the port's own output.
import { describe, expect, it } from 'vitest';
import { Delaunator, INVALID_INDEX } from '@ziroeda/kimath/src/thirdparty/delaunator.js';

function inCircle(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  px: number,
  py: number,
): boolean {
  const dx = ax - px;
  const dy = ay - py;
  const ex = bx - px;
  const ey = by - py;
  const fx = cx - px;
  const fy = cy - py;
  const ap = dx * dx + dy * dy;
  const bp = ex * ex + ey * ey;
  const cp = fx * fx + fy * fy;
  return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) < 0;
}

describe('Delaunator', () => {
  it('a square with its centre gives the four triangles fanned from the centre', () => {
    const coords = [0, 0, 10, 0, 10, 10, 0, 10, 5, 5];
    const d = new Delaunator(coords);
    expect(d.triangles.length / 3).toBe(4);
    // every triangle has the centre (index 4) as a vertex
    for (let i = 0; i < d.triangles.length; i += 3) {
      expect([d.triangles[i], d.triangles[i + 1], d.triangles[i + 2]]).toContain(4);
    }
    // the four hull edges have no twin
    let hullEdges = 0;
    for (const h of d.halfedges) if (h === INVALID_INDEX) hullEdges++;
    expect(hullEdges).toBe(4);
  });

  it('a random set satisfies Euler (2n - 2 - h triangles) and the empty-circumcircle property', () => {
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % 100000;
    };
    const n = 200;
    const coords: number[] = [];
    for (let i = 0; i < n; i++) coords.push(rnd(), rnd());
    const d = new Delaunator(coords);

    // hull size from the linked list
    let h = 0;
    let e = d.hull_start;
    do {
      h++;
      e = d.hull_next[e]!;
    } while (e !== d.hull_start);

    expect(d.triangles.length / 3).toBe(2 * n - 2 - h);

    for (let i = 0; i < d.triangles.length; i += 3) {
      const [a, b, c] = [d.triangles[i]!, d.triangles[i + 1]!, d.triangles[i + 2]!];
      for (let p = 0; p < n; p++) {
        if (p === a || p === b || p === c) continue;
        expect(
          inCircle(
            coords[2 * a]!,
            coords[2 * a + 1]!,
            coords[2 * b]!,
            coords[2 * b + 1]!,
            coords[2 * c]!,
            coords[2 * c + 1]!,
            coords[2 * p]!,
            coords[2 * p + 1]!,
          ),
        ).toBe(false);
      }
    }
  });

  it('refuses a degenerate (colinear) set as the C++ does', () => {
    expect(() => new Delaunator([0, 0, 1, 1, 2, 2, 3, 3])).toThrow('not triangulation');
  });
});
