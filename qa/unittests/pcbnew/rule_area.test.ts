// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rule areas (keepouts): the model, the file format, and the filler.
 *
 * A rule area is a `(zone …)` carrying `(keepout …)`. The token is what marks
 * it — ZONE::SetIsRuleArea is called from the keepout case in the parser — and
 * everything else follows: it is not copper, it is never poured, and it forbids
 * whatever its flags name.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { fillZones } from '@ziroeda/pcbnew/src/zone_filler.js';
import type { Board, PcbZone } from '@ziroeda/pcbnew/src/types.js';

/** A board with one copper pour and, optionally, a rule area biting into it. */
const src = (
  opts: { keepout?: string; islandMode?: string; ruleAreaPts?: string } = {},
): string => `
(kicad_pcb (version 20240108) (generator test)
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal))
  (net 0 "")
  (net 1 "GND")
  (footprint "R" (layer "F.Cu") (at 5 5)
    (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND")))
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "z1") (hatch edge 0.5)
    (connect_pads (clearance 0.2))
    (min_thickness 0.25)
    (fill yes ${opts.islandMode ?? ''} (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 20 0) (xy 20 20) (xy 0 20))))
  ${
    opts.keepout
      ? `(zone (net 0) (net_name "") (layer "F.Cu") (uuid "ka") (name "noCopper") (hatch edge 0.5)
    (min_thickness 0.25)
    ${opts.keepout}
    (fill yes)
    (polygon (pts ${opts.ruleAreaPts ?? '(xy 12 0) (xy 20 0) (xy 20 20) (xy 12 20)'})))`
      : ''
  }
)`;

const ALL_FORBIDDEN = `(keepout (tracks not_allowed) (vias not_allowed) (pads not_allowed) (copperpour not_allowed) (footprints not_allowed))`;

const load = (s: string): Board => readBoard(parse(s));
const ruleAreaOf = (b: Board): PcbZone | undefined => b.zones.find((z) => z.ruleArea);

describe('reading', () => {
  it('marks a zone carrying (keepout …) as a rule area', () => {
    const b = load(src({ keepout: ALL_FORBIDDEN }));
    expect(ruleAreaOf(b)?.ruleArea).toEqual({
      tracks: true,
      vias: true,
      pads: true,
      copperPour: true,
      footprints: true,
    });
  });

  it('leaves an ordinary copper zone without one', () => {
    expect(ruleAreaOf(load(src()))).toBeUndefined();
  });

  it('reads each flag independently', () => {
    const b = load(
      src({
        keepout: `(keepout (tracks not_allowed) (vias allowed) (pads allowed) (copperpour not_allowed) (footprints allowed))`,
      }),
    );

    expect(ruleAreaOf(b)?.ruleArea).toEqual({
      tracks: true,
      vias: false,
      pads: false,
      copperPour: true,
      footprints: false,
    });
  });

  it('treats a missing flag as allowed, not as inherited', () => {
    // `pads` and `footprints` post-date the token, so an older file has
    // neither; upstream initialises both to allowed before parsing the rest.
    const b = load(
      src({
        keepout: `(keepout (tracks not_allowed) (vias not_allowed) (copperpour not_allowed))`,
      }),
    );

    expect(ruleAreaOf(b)?.ruleArea?.pads).toBe(false);
    expect(ruleAreaOf(b)?.ruleArea?.footprints).toBe(false);
  });
});

describe('writing', () => {
  it('round-trips an untouched rule area byte for byte', () => {
    const text = src({ keepout: ALL_FORBIDDEN });
    expect(serializeBoard(load(text))).toBe(serializeBoard(load(serializeBoard(load(text)))));
  });

  it('emits the flags for a zone built from the model', () => {
    // A source-less zone is written from buildZoneNode rather than echoed.
    const b = load(src());
    const area: PcbZone = {
      ...b.zones[0]!,
      name: 'ka',
      ruleArea: { tracks: true, vias: false, pads: false, copperPour: true, footprints: false },
      source: { kind: 'list', items: [] },
    };

    const text = serializeBoard({ ...b, zones: [area] });
    expect(text).toContain('(tracks not_allowed)');
    expect(text).toContain('(vias allowed)');
    expect(text).toContain('(copperpour not_allowed)');
    expect(text).toContain('(footprints allowed)');
  });

  it('reads back what it wrote', () => {
    const b = load(src());
    const area: PcbZone = {
      ...b.zones[0]!,
      ruleArea: { tracks: true, vias: false, pads: true, copperPour: false, footprints: true },
      source: { kind: 'list', items: [] },
    };

    expect(ruleAreaOf(load(serializeBoard({ ...b, zones: [area] })))?.ruleArea).toEqual(
      area.ruleArea,
    );
  });
});

describe('the filler', () => {
  const fillArea = (b: Board, index = 0): number => {
    const polys = b.zones[index]?.fills.flatMap((f) => f.polys) ?? [];
    // Shoelace, absolute — only the relative size matters here.
    return polys.reduce((sum, poly) => {
      let a = 0;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
        a += (poly[j]!.x + poly[i]!.x) * (poly[j]!.y - poly[i]!.y);
      return sum + Math.abs(a / 2);
    }, 0);
  };

  it('never pours the rule area itself', () => {
    // Island removal set to NEVER is what makes this visible: with the default
    // ALWAYS the pour comes back empty for want of a connection and the bug
    // hides.
    const b = fillZones(
      load(src({ keepout: ALL_FORBIDDEN, islandMode: '(island_removal_mode 1)' })),
    );

    expect(ruleAreaOf(b)?.fills).toEqual([]);
  });

  it('knocks a copperpour keepout out of a pour that overlaps it', () => {
    const without = fillZones(load(src()));
    const with_ = fillZones(load(src({ keepout: ALL_FORBIDDEN })));

    expect(fillArea(without)).toBeGreaterThan(0);
    expect(fillArea(with_)).toBeLessThan(fillArea(without));
  });

  it('leaves the pour alone when copperpour is allowed', () => {
    const allowed = `(keepout (tracks not_allowed) (vias not_allowed) (pads allowed) (copperpour allowed) (footprints allowed))`;

    expect(fillArea(fillZones(load(src({ keepout: allowed }))))).toBeCloseTo(
      fillArea(fillZones(load(src()))),
      3,
    );
  });

  it('knocks out regardless of priority, unlike an ordinary zone', () => {
    // A lower-priority copper zone would not touch the pour; a rule area does,
    // because upstream tests GetIsRuleArea before the priority branch.
    const b = load(src({ keepout: ALL_FORBIDDEN }));
    const area = ruleAreaOf(b)!;
    const bumped: Board = {
      ...b,
      zones: b.zones.map((z) => (z === area ? { ...z, priority: 0 } : { ...z, priority: 5 })),
    };

    expect(fillArea(fillZones(bumped))).toBeLessThan(fillArea(fillZones(load(src()))));
  });

  it('uses the bare outline, with no clearance added', () => {
    // "Keepouts use outline with no clearance" — a clearance would eat a ring
    // of copper the user never asked to lose.
    const b = fillZones(load(src({ keepout: ALL_FORBIDDEN })));
    const xs = b.zones[0]!.fills.flatMap((f) => f.polys.flat()).map((p) => p.x);

    // The area starts at x = 12 mm; the copper may reach it but not pass it.
    expect(Math.max(...xs)).toBeCloseTo(12e6, -4);
  });
});
