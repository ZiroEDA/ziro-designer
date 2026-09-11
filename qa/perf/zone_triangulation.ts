// How long each zone fill of a board takes to triangulate, the way the GL
// recorder does it (triangulateRings over every polygon a zone has on a
// layer), to see which polygons make the jetson baseboard's open spend 5 s in
// earcut. See README.md for the vite-node invocation.
import { readFileSync } from 'node:fs';
import { parse } from '@ziroeda/sexpr';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { triangulateRings } from '@ziroeda/designer/src/render/gl/holes.js';

const file = process.argv[2]!;
const board = readBoard(parse(readFileSync(file, 'utf8')));
const rows: {
  zone: number;
  layer: string;
  polys: number;
  pts: number;
  ms: number;
  tris: number;
}[] = [];
let total = 0;
board.zones.forEach((z, zi) => {
  for (const f of z.fills) {
    const rings = f.polys.map((p) => p.map((q) => ({ x: q.x, y: q.y })));
    const pts = rings.reduce((s, r) => s + r.length, 0);
    const t0 = performance.now();
    const tri = triangulateRings(rings);
    const ms = performance.now() - t0;
    total += ms;
    rows.push({ zone: zi, layer: f.layer, polys: rings.length, pts, ms, tris: tri.length / 3 });
  }
});
rows.sort((a, b) => b.ms - a.ms);
console.log(`${rows.length} zone fills, ${total.toFixed(0)} ms total`);
for (const r of rows.slice(0, 12))
  console.log(
    `  zone ${r.zone} ${r.layer.padEnd(8)} ${String(r.polys).padStart(4)} polys ${String(r.pts).padStart(7)} pts  ${r.ms.toFixed(0).padStart(6)} ms  ${r.tris} tris  (${((r.ms * 1000) / r.pts).toFixed(1)} us/pt)`,
  );

// --- KiCad's answer: partitionPolyIntoRegularCellGrid (shape_poly_set.cpp:3098),
// 1 cm cells, two checkerboard intersections, fracture, then triangulate each
// cell. Prototype timing on the slowest fills.
import {
  BooleanOp,
  booleanOp,
  fractureNoSimplify,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
const partition = (outline: { x: number; y: number }[], size: number) => {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of outline) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX,
    h = maxY - minY;
  if (w === 0 || h === 0) return [outline];
  let nx: number, ny: number;
  if (w > h) {
    nx = Math.floor(w / size);
    ny = Math.floor((h / w) * nx) + 1;
  } else {
    ny = Math.floor(h / size);
    nx = Math.floor((w / h) * ny) + 1;
  }
  nx = Math.max(nx, 1);
  ny = Math.max(ny, 1);
  const odd: Polygon[] = [],
    even: Polygon[] = [];
  for (let yy = 0; yy < ny; yy++)
    for (let xx = 0; xx < nx; xx++) {
      const x0 = Math.round(minX + (w * xx) / nx),
        y0 = Math.round(minY + (h * yy) / ny);
      const x1 = Math.round(minX + (w * (xx + 1)) / nx),
        y1 = Math.round(minY + (h * (yy + 1)) / ny);
      const cell: Polygon = [
        [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
      ];
      ((xx ^ yy) & 1 ? odd : even).push(cell);
    }
  const subject: Polygon[] = [[outline]];
  const a = fractureNoSimplify(booleanOp(subject, odd, BooleanOp.INTERSECT));
  const b = fractureNoSimplify(booleanOp(subject, even, BooleanOp.INTERSECT));
  return [...a, ...b];
};
console.log('\npartitioned (1 cm cells):');
for (const r of rows.slice(0, 6)) {
  const f = board.zones[r.zone]!.fills.find((f) => f.layer === r.layer)!;
  const rings = f.polys.map((p) => p.map((q) => ({ x: q.x, y: q.y })));
  const t0 = performance.now();
  const cells = rings.flatMap((ring) => partition(ring, 1e7));
  const t1 = performance.now();
  let tris = 0;
  for (const c of cells) tris += triangulateRings([c]).length / 3;
  const t2 = performance.now();
  console.log(
    `  zone ${r.zone} ${r.layer.padEnd(8)} ${r.pts} pts -> ${cells.length} cells: partition ${(t1 - t0).toFixed(0)} ms + triangulate ${(t2 - t1).toFixed(0)} ms = ${(t2 - t0).toFixed(0)} ms (was ${r.ms.toFixed(0)} ms), ${tris} tris`,
  );
}
