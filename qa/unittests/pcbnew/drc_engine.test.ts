/**
 * DRC engine slice 1 (pcbnew/src/drc/drc_engine.ts): copper clearance with
 * netclass resolution, track width, via diameter/annular/drill and
 * hole-to-hole checks. IU = 100 nm (0.1 mm = 1000 IU… MM = 10000 IU).
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readBoard, runDrc, type DrcOptions } from '@ziroeda/pcbnew';

const MM = 10000;

/** A tiny two-net board built from real board text (via the real parser). */
function board(extra: string): ReturnType<typeof readBoard> {
  return readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
      (general (thickness 1.6))
      (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
      (net 0 "") (net 1 "GND") (net 2 "VCC")
      ${extra}
    )`),
  );
}

const OPTS: DrcOptions = {
  minClearance: 0.2 * MM,
  minTrackWidth: 0.2 * MM,
  minViaDiameter: 0.5 * MM,
  minViaAnnulus: 0.1 * MM,
  minThroughHole: 0.3 * MM,
  minHoleToHole: 0.25 * MM,
};

describe('drc engine (slice 1)', () => {
  it('flags two different-net tracks closer than the clearance', () => {
    // 0.25mm-wide tracks, centerlines 0.4mm apart -> gap 0.15mm < 0.2mm.
    const b = board(`
      (segment (start 0 0) (end 10 0) (width 0.25) (layer "F.Cu") (net 1))
      (segment (start 0 0.4) (end 10 0.4) (width 0.25) (layer "F.Cu") (net 2))
    `);
    const v = runDrc(b, OPTS);
    const clearance = v.filter((x) => x.code === 'clearance');
    expect(clearance).toHaveLength(1);
    expect(clearance[0]!.message).toContain('0.2 mm');
    expect(clearance[0]!.message).toContain('0.15 mm');
  });

  it('same net / different layer / far apart pairs pass', () => {
    const b = board(`
      (segment (start 0 0) (end 10 0) (width 0.25) (layer "F.Cu") (net 1))
      (segment (start 0 0.4) (end 10 0.4) (width 0.25) (layer "F.Cu") (net 1))
      (segment (start 0 0.4) (end 10 0.4) (width 0.25) (layer "B.Cu") (net 2))
      (segment (start 0 5) (end 10 5) (width 0.25) (layer "F.Cu") (net 2))
    `);
    expect(runDrc(b, OPTS).filter((x) => x.code === 'clearance')).toHaveLength(0);
  });

  it('netclass clearance overrides the board minimum (worst rule wins)', () => {
    // Gap is 0.35mm: fine for the 0.2mm board min, violating a 0.5mm class.
    const b = board(`
      (segment (start 0 0) (end 10 0) (width 0.25) (layer "F.Cu") (net 1))
      (segment (start 0 0.6) (end 10 0.6) (width 0.25) (layer "F.Cu") (net 2))
    `);
    expect(runDrc(b, OPTS).filter((x) => x.code === 'clearance')).toHaveLength(0);
    const withClass = runDrc(b, {
      ...OPTS,
      clearanceOf: (net) => (net === 2 ? 0.5 * MM : 0),
    });
    const hits = withClass.filter((x) => x.code === 'clearance');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('0.5 mm');
  });

  it('flags a pad-to-track clearance violation', () => {
    // 1mm square pad at origin (edge at x=0.5mm); track edge at 0.575mm.
    const b = board(`
      (footprint "R" (at 0 0)
        (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND")))
      (segment (start 0.7 -2) (end 0.7 2) (width 0.25) (layer "F.Cu") (net 2))
    `);
    const hits = runDrc(b, OPTS).filter((x) => x.code === 'clearance');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.items.map((i) => i.desc).join()).toContain('Pad 1');
  });

  it('roundrect corners are exact (no false positive in the corner radius)', () => {
    // 1x1mm roundrect, ratio 0.25 -> corner radius 0.25mm: corner circle
    // center (0.25,0.25). A 0.1mm track point at (0.663,0.663) has an exact
    // gap of ~0.284mm (> 0.2 clearance), the OUTER RECTANGLE approximation
    // would report ~0.18mm and falsely flag it.
    const clear = board(`
      (footprint "R" (at 0 0)
        (pad "1" smd roundrect (at 0 0) (size 1 1) (roundrect_rratio 0.25) (layers "F.Cu") (net 1 "GND")))
      (segment (start 0.663 0.663) (end 0.664 0.664) (width 0.1) (layer "F.Cu") (net 2))
    `);
    expect(runDrc(clear, OPTS).filter((x) => x.code === 'clearance')).toHaveLength(0);
    // Closer in, the exact gap (~0.124mm) violates.
    const tight = board(`
      (footprint "R" (at 0 0)
        (pad "1" smd roundrect (at 0 0) (size 1 1) (roundrect_rratio 0.25) (layers "F.Cu") (net 1 "GND")))
      (segment (start 0.55 0.55) (end 0.551 0.551) (width 0.1) (layer "F.Cu") (net 2))
    `);
    expect(runDrc(tight, OPTS).filter((x) => x.code === 'clearance')).toHaveLength(1);
  });

  it('chamfer+roundrect pads are exact (polygon + corner circles)', () => {
    // 1x1mm pad, top-left chamfered (ratio 0.3 -> 0.3mm cut), other corners
    // rounded rr=0.25 * 1 = 0.25mm. A point near the top-RIGHT rounded
    // corner: exact gap from the corner circle (center (0.25,-0.25), r
    // 0.25). At (0.663,-0.663): gap = 0.5841 - 0.25 - 0.05 = 0.284 > 0.2.
    const clear = board(`
      (footprint "R" (at 0 0)
        (pad "1" smd roundrect (at 0 0) (size 1 1) (roundrect_rratio 0.25)
          (chamfer_ratio 0.3) (chamfer top_left) (layers "F.Cu") (net 1 "GND")))
      (segment (start 0.663 -0.663) (end 0.664 -0.664) (width 0.1) (layer "F.Cu") (net 2))
    `);
    expect(runDrc(clear, OPTS).filter((x) => x.code === 'clearance')).toHaveLength(0);
    // Near the chamfered top-left corner the cut edge (from (-0.2,-0.5) to
    // (-0.5,-0.2), the line x+y=-0.7) is the boundary: (-0.47,-0.47) is
    // 0.24/sqrt(2) = 0.1697mm away, minus 0.05 track = ~0.12 gap -> violates.
    const tight = board(`
      (footprint "R" (at 0 0)
        (pad "1" smd roundrect (at 0 0) (size 1 1) (roundrect_rratio 0.25)
          (chamfer_ratio 0.3) (chamfer top_left) (layers "F.Cu") (net 1 "GND")))
      (segment (start -0.47 -0.47) (end -0.471 -0.471) (width 0.1) (layer "F.Cu") (net 2))
    `);
    expect(runDrc(tight, OPTS).filter((x) => x.code === 'clearance')).toHaveLength(1);
  });

  it('arc tracks collide with exact arc geometry', () => {
    // Quarter arc of radius 10mm about the origin, 0.2mm wide; a track just
    // outside at x=12: exact gap = 2 - 0.1 - 0.1 = 1.8mm.
    const b = board(`
      (arc (start 10 0) (mid 7.0711 7.0711) (end 0 10) (width 0.2) (layer "F.Cu") (net 1))
      (segment (start 12 0) (end 12 1) (width 0.2) (layer "F.Cu") (net 2))
    `);
    const hits = runDrc(b, { ...OPTS, minClearance: 2 * MM }).filter((x) => x.code === 'clearance');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain('actual 1.8 mm');
  });

  it('blind vias only exist on their span layers', () => {
    const four = (extra: string): ReturnType<typeof readBoard> =>
      readBoard(
        parse(`(kicad_pcb (version 20241229) (generator "test")
          (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (6 "In2.Cu" signal) (2 "B.Cu" signal))
          (net 0 "") (net 1 "GND") (net 2 "VCC")
          ${extra})`),
      );
    const track = `(segment (start 0.4 0) (end 0.4 1) (width 0.2) (layer "B.Cu") (net 2))`;
    const blind = four(
      `(via blind (at 0 0) (size 0.6) (drill 0.3) (layers "F.Cu" "In1.Cu") (net 1)) ${track}`,
    );
    expect(runDrc(blind, OPTS).filter((x) => x.code === 'clearance')).toHaveLength(0);
    const through = four(
      `(via (at 0 0) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1)) ${track}`,
    );
    expect(runDrc(through, OPTS).filter((x) => x.code === 'clearance')).toHaveLength(1);
  });

  it('checks widths, via sizes, drills and hole spacing', () => {
    const b = board(`
      (segment (start 0 0) (end 10 0) (width 0.1) (layer "F.Cu") (net 1))
      (via (at 20 0) (size 0.4) (drill 0.25) (layers "F.Cu" "B.Cu") (net 1))
      (via (at 20.32 0) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 1))
    `);
    const codes = runDrc(b, OPTS).map((x) => x.code);
    expect(codes).toContain('track_width'); // 0.1 < 0.2
    expect(codes).toContain('via_diameter'); // 0.4 < 0.5
    expect(codes).toContain('annular_width'); // (0.4-0.25)/2 = 0.075 < 0.1
    expect(codes).toContain('drill_out_of_range'); // 0.25 < 0.3
    expect(codes).toContain('hole_to_hole'); // 0.32 - 0.125 - 0.15 = 0.045 < 0.25
  });
});
