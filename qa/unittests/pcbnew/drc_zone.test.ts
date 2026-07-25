/** Zone-fill clearance (drc_test_provider_copper_clearance zone pass). */
import { expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readBoard, runDrc } from '@ziroeda/pcbnew';

const MM = 10000;
const base = (extra: string) =>
  readBoard(
    parse(`(kicad_pcb (version 20241229) (generator "test")
      (layers (0 "F.Cu" signal) (2 "B.Cu" signal))
      (net 0 "") (net 1 "GND") (net 2 "VCC") ${extra})`),
  );
const OPTS = {
  minClearance: 0.2 * MM,
  minTrackWidth: 0,
  minViaDiameter: 0,
  minViaAnnulus: 0,
  minThroughHole: 0,
  minHoleToHole: 0,
};

it('flags a track too close to a filled zone of another net', () => {
  const zone = `(zone (net 1) (net_name "GND") (layers "F.Cu")
    (polygon (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10)))
    (filled_polygon (layer "F.Cu") (pts (xy 0 0) (xy 10 0) (xy 10 10) (xy 0 10))))`;
  // Track edge at 10.1mm: gap 0.1 < 0.2 -> violation.
  const bad = base(`${zone}
    (segment (start 10.2 0) (end 10.2 10) (width 0.2) (layer "F.Cu") (net 2))`);
  const hits = runDrc(bad, OPTS).filter((v) => v.code === 'clearance');
  expect(hits).toHaveLength(1);
  expect(hits[0]!.items.map((i) => i.desc).join()).toContain('Zone fill');
  expect(hits[0]!.message).toContain('actual 0.1 mm');
  // Same net, or far enough away: clean.
  const sameNet = base(`${zone}
    (segment (start 10.2 0) (end 10.2 10) (width 0.2) (layer "F.Cu") (net 1))`);
  expect(runDrc(sameNet, OPTS).filter((v) => v.code === 'clearance')).toHaveLength(0);
  const far = base(`${zone}
    (segment (start 10.4 0) (end 10.4 10) (width 0.2) (layer "F.Cu") (net 2))`);
  expect(runDrc(far, OPTS).filter((v) => v.code === 'clearance')).toHaveLength(0);
});
