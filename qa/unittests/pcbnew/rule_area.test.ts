// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rule areas (keepouts) in the file format.
 *
 * A rule area is a `(zone …)` carrying `(keepout …)`. The token is what marks
 * it — ZONE::SetIsRuleArea is called from the keepout case in the parser — and
 * everything else follows: it is not copper, it is never poured, and it forbids
 * whatever its flags name.
 */
import { describe, expect, it } from 'vitest';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { ZONE } from '@ziroeda/pcbnew/zone.js';
import { FormatBoard, ParseBoard } from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

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
  (zone (net 1) (net_name "GND") (layer "F.Cu") (uuid "aaaaaaaa-0000-4000-8000-000000000001") (hatch edge 0.5)
    (connect_pads (clearance 0.2))
    (min_thickness 0.25)
    (fill yes ${opts.islandMode ?? ''} (thermal_gap 0.5) (thermal_bridge_width 0.5))
    (polygon (pts (xy 0 0) (xy 20 0) (xy 20 20) (xy 0 20))))
  ${
    opts.keepout
      ? `(zone (net 0) (net_name "") (layer "F.Cu") (uuid "aaaaaaaa-0000-4000-8000-000000000002") (name "noCopper") (hatch edge 0.5)
    (min_thickness 0.25)
    ${opts.keepout}
    (fill yes)
    (polygon (pts ${opts.ruleAreaPts ?? '(xy 12 0) (xy 20 0) (xy 20 20) (xy 12 20)'})))`
      : ''
  }
)`;

const ALL_FORBIDDEN = `(keepout (tracks not_allowed) (vias not_allowed) (pads not_allowed) (copperpour not_allowed) (footprints not_allowed))`;

const load = (s: string): BOARD => ParseBoard(s);
const ruleAreaOf = (b: BOARD): ZONE | undefined => b.Zones().find((z) => z.GetIsRuleArea());
/** The five keepout flags, in `(keepout …)`'s order. */
const flags = (z: ZONE | undefined) =>
  z && {
    tracks: z.GetDoNotAllowTracks(),
    vias: z.GetDoNotAllowVias(),
    pads: z.GetDoNotAllowPads(),
    copperPour: z.GetDoNotAllowZoneFills(),
    footprints: z.GetDoNotAllowFootprints(),
  };

describe('reading', () => {
  it('marks a zone carrying (keepout …) as a rule area', () => {
    const b = load(src({ keepout: ALL_FORBIDDEN }));
    expect(flags(ruleAreaOf(b))).toEqual({
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

    expect(flags(ruleAreaOf(b))).toEqual({
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

    expect(ruleAreaOf(b)!.GetDoNotAllowPads()).toBe(false);
    expect(ruleAreaOf(b)!.GetDoNotAllowFootprints()).toBe(false);
  });
});

describe('writing', () => {
  it('round-trips an untouched rule area byte for byte', () => {
    // The fixture names no uuids, so the first save mints them; the second
    // save must write the first one's bytes again.
    const once = FormatBoard(load(src({ keepout: ALL_FORBIDDEN })));
    expect(FormatBoard(load(once))).toBe(once);
  });

  /** The board's copper zone turned into a rule area with these flags. */
  const asRuleArea = (f: NonNullable<ReturnType<typeof flags>>): BOARD => {
    const b = load(src());
    const z = b.Zones()[0]!;
    z.SetIsRuleArea(true);
    z.SetDoNotAllowTracks(f.tracks);
    z.SetDoNotAllowVias(f.vias);
    z.SetDoNotAllowPads(f.pads);
    z.SetDoNotAllowZoneFills(f.copperPour);
    z.SetDoNotAllowFootprints(f.footprints);
    return b;
  };

  it('writes each flag as allowed / not_allowed', () => {
    const text = FormatBoard(
      asRuleArea({ tracks: true, vias: false, pads: false, copperPour: true, footprints: false }),
    );
    expect(text).toContain('(tracks not_allowed)');
    expect(text).toContain('(vias allowed)');
    expect(text).toContain('(copperpour not_allowed)');
    expect(text).toContain('(footprints allowed)');
  });

  it('reads back what it wrote', () => {
    const f = { tracks: true, vias: false, pads: true, copperPour: false, footprints: true };

    expect(flags(ruleAreaOf(load(FormatBoard(asRuleArea(f)))))).toEqual(f);
  });
});
