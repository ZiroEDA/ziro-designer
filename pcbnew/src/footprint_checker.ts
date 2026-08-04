// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The Footprint Checker: a footprint checked against itself.
 * Counterpart: `DIALOG_FOOTPRINT_CHECKER::runChecks`
 * (pcbnew/dialogs/dialog_footprint_checker.cpp:82) and the `FOOTPRINT::Check*`
 * / `PAD::CheckPad` family it drives (pcbnew/footprint.cpp, pcbnew/pad.cpp).
 *
 * ## Why this is not part of `runDrc`
 *
 * It looks like a subset of board DRC and is not one. It is a *different entry
 * point* with a deliberately different rule set: no clearance, no annular ring,
 * no connectivity, no courtyard *overlap* (that one is board DRC's
 * `drc_test_provider_courtyard_clearance`). Everything it does test, it tests
 * at **clearance 0** — there is no rule engine, no netclass and no Board Setup
 * value anywhere in the upstream code path. A `DrcOptions` reaching this module
 * would be a sign something had gone wrong.
 *
 * The other half of the reason is that it runs in the *footprint editor*, on a
 * board holding exactly one footprint at the origin. Upstream therefore writes
 * the footprint-level marker positions as a literal `{0, 0}`: the footprint
 * anchor. On a board-coordinate model the faithful equivalent is `fp.at`, which
 * is what this module emits.
 *
 * ## Emission order is part of the contract
 *
 * Markers are appended to a list and the tree shows them in insertion order
 * within a severity, so the order is observable:
 *
 *   malformed courtyard → missing courtyard → attribute mismatch → pads
 *   → shorting pads → [net-tie groups → net ties] → clipped silk
 *
 * The two net-tie checks run only when `isNetTie(fp)`.
 *
 * ## Upstream oddities reproduced rather than repaired
 *
 *   - A *malformed* courtyard yields BOTH a malformed and a missing marker,
 *     because the missing test asks `OutlineCount() == 0` and a conversion that
 *     failed left zero outlines behind.
 *   - `SHAPE_SEGMENT::Collide( const SEG&, int )` measures with only the
 *     *calling* hole's width, so the too-close test is asymmetric and its
 *     result depends on which pad comes first in the file.
 *   - `CheckNetTiePadGroups`' "appears in more than one net-tie pad group"
 *     branch cannot fire; it is kept as an unreachable guard.
 *   - `DRCE_SILK_MASK_CLEARANCE`'s settings key is `silk_over_copper` while its
 *     title is "Silkscreen clipped by solder mask". The key is what severities
 *     are stored under, so the key is what is kept.
 *
 * ## What is deliberately not covered
 *
 *   - `CheckNetTies` builds its copper outlines from drawings, **zones** and
 *     **fields**. Footprint-local zones are not in the Board model at all, and
 *     fields carry no geometry, so this port sees graphics only. A net tie
 *     drawn as a zone will silently pass.
 *   - `CheckClippedSilk` likewise sees graphics as the silk side and graphics
 *     plus pads as the mask side; upstream is the same except that its
 *     "drawings" include text-derived shapes, which our model splits into
 *     `fp.texts` with no polygon builder in pcbnew.
 *   - `chainOutlines` implements only the chaining half of
 *     `ConvertOutlineToPolygon`, so `(not a closed shape)` is the only
 *     malformed-courtyard message reachable; `(self-intersecting)` and the
 *     degenerate-size family are not ported.
 *   - Marker *positions* for the two rules whose upstream position comes out of
 *     `SHAPE::Collide`'s `aLocation` out-parameter — shorting pads and clipped
 *     silk — are the primary item's own position instead. That location is a
 *     by-product of whichever collision solver the shape pair happens to pick
 *     and has no closed form; the set of violations is unaffected.
 */

import { pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import {
  booleanAdd,
  booleanSubtract,
  type Polygon,
} from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import { allowsMissingCourtyard, buildCourtyard } from './courtyard.js';
import {
  graphicShapes,
  likelyFootprintAttribute,
  padShapes,
  primitiveShapes,
  type DrcItemRef,
  type DrcViolation,
} from './drc/drc_engine.js';
import { segSeg, shapeBBox, shapeDist, type Shape } from './drc/drc_geometry.js';
import { segmentsForRadius, shapeToPolygon } from './zone_filler.js';
import type { PadPrimitive, PcbFootprint, PcbPad, PcbShape } from './types.js';

/** `GetMaxError()`: the board's `m_MaxError`, whose default is ARC_HIGH_DEF. */
const MAX_ERROR = mmToIU(0.005);

/** `min_drill_size` in `PAD::doCheckPad`, in IU. */
const MIN_DRILL_SIZE = 4;

/** The three layers `FOOTPRINT::CheckNetTies` iterates, verbatim. In1.Cu
 *  stands in for every inner layer, so copper on In2.Cu is never tested. */
const NET_TIE_LAYERS = ['F.Cu', 'In1.Cu', 'B.Cu'] as const;

// ---------------------------------------------------------------------------
// Small predicates over the model.

/** `IsCopperLayer` by name. */
const isCopper = (layer: string): boolean => /\.Cu$/.test(layer);

/**
 * `BOARD_ITEM::IsOnLayer` for a pad, whose layer list may hold the file's
 * wildcards. `*.Cu` is every copper layer, `*.Mask` both masks, and so on —
 * matching on the suffix covers all three without a stackup to expand against.
 */
function padOnLayer(pad: PcbPad, layer: string): boolean {
  return pad.layers.some((l) => l === layer || (l.startsWith('*.') && layer.endsWith(l.slice(1))));
}

/** `( GetLayerSet() & LSET::AllCuMask() ).any()`. */
const padIsOnCopper = (pad: PcbPad): boolean => pad.layers.some((l) => isCopper(l) || l === '*.Cu');

/** `( GetLayerSet() & LSET::InternalCuMask() ).count() != 0`. */
const padHasInnerCopper = (pad: PcbPad): boolean =>
  pad.layers.some((l) => /^In\d+\.Cu$/.test(l) || l === '*.Cu');

const drillX = (pad: PcbPad): number => pad.drill?.w ?? 0;
const drillY = (pad: PcbPad): number => pad.drill?.h ?? 0;

/** `PAD::HasHole`. */
const hasHole = (pad: PcbPad): boolean => drillX(pad) > 0 && drillY(pad) > 0;

/** `PAD::HasDrilledHole` — a hole that is *round*. A slot is not one, which is
 *  why the shorting-pad hole rules skip slots entirely. */
const hasDrilledHole = (pad: PcbPad): boolean => hasHole(pad) && drillX(pad) === drillY(pad);

/** KiCad `RotatePoint`: PCB screen coords turn clockwise for a positive angle. */
function rotatePoint(p: Vec2, deg: number): Vec2 {
  if (!deg) return p;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos };
}

/**
 * `PAD::GetEffectiveHoleShape` (pad.cpp:1360). A round drill is a *zero-length*
 * segment whose width is the diameter; a slot carries the milled axis. The
 * halving is integer division upstream, so an odd drill diameter loses a
 * nanometre — reproduced, because the shorting-pad test compares against it.
 */
function padHoleSegment(pad: PcbPad): { a: Vec2; b: Vec2; width: number } | null {
  if (!pad.drill) return null;

  const halfX = Math.trunc(drillX(pad) / 2);
  const halfY = Math.trunc(drillY(pad) / 2);
  let halfWidth = halfX;
  let halfLen: Vec2 = { x: 0, y: 0 };

  if (pad.drill.oblong) {
    halfWidth = Math.min(halfX, halfY);
    halfLen = { x: halfX - halfWidth, y: halfY - halfWidth };
  }

  const d = rotatePoint(halfLen, pad.angle);

  return {
    a: { x: pad.at.x - d.x, y: pad.at.y - d.y },
    b: { x: pad.at.x + d.x, y: pad.at.y + d.y },
    width: halfWidth * 2,
  };
}

/**
 * `PAD::ShapePos` minus `GetPosition()`: how far the copper sits from the hole.
 *
 * `padShapes()` centres every shape on `pad.at`, which is the *hole* centre;
 * upstream draws the copper at `GetPosition() + RotatePoint( offset )` and
 * leaves the hole where it is. Rather than move the copper — which would change
 * board DRC for every offset pad — the two rules that care about the pair move
 * the *hole* by the negation, which is the same relative geometry.
 */
function padShapeOffset(pad: PcbPad): Vec2 {
  const o = pad.drill?.offset;
  return o ? rotatePoint(o, pad.angle) : { x: 0, y: 0 };
}

/** A graphic's focus point, the same one the board-level providers report. */
const shapePos = (s: PcbShape): Vec2 => s.start ?? s.center ?? s.pts?.[0] ?? { x: 0, y: 0 };

// ---------------------------------------------------------------------------
// Polygons.
//
// `shapeToPolygon` speaks polygon-clipping's [x, y] pairs and kimath's booleans
// speak {x, y}; converting is the boundary between the two, and casting across
// it instead yields NaN coordinates that merge into a polygon-shaped nothing.

type Ring = [number, number][];

const toKimath = (geoms: unknown[]): Polygon[] =>
  (geoms as Ring[][]).map((geom) => geom.map((ring) => ring.map(([x, y]) => ({ x, y }))));

/** Union of a list of polygon sets, folded left. */
function union(parts: Polygon[]): Polygon[] {
  let out: Polygon[] = [];
  for (const p of parts) out = out.length === 0 ? [p] : booleanAdd(out, [p]);
  return out;
}

/**
 * `ERROR_OUTSIDE`'s radius correction. `shapeToPolygon` inscribes its arcs, so
 * every polygon it builds is an `ERROR_INSIDE` one. Growing the radius by the
 * sagitta of one segment turns it into a polygon that *encloses* the true
 * shape, which is what upstream asks for when it tessellates a hole.
 *
 * The vertices themselves are our tessellator's rather than
 * `TransformOvalToPolygon`'s; what matters — and what this reproduces — is the
 * *sign* of the error, since the PTH copper test subtracts one from the other
 * and a hole rounded the wrong way would leave a 5 nm ring of phantom copper.
 */
function errorOutsideGrow(radius: number): number {
  if (radius <= 0) return 0;
  const n = segmentsForRadius(radius, MAX_ERROR);
  return radius * (1 - Math.cos(Math.PI / n));
}

/** `TransformShapeToPolygon( …, ERROR_INSIDE )` over a pad's copper. */
const padOutlinePolys = (pad: PcbPad): Polygon[] =>
  union(padShapes(pad).flatMap((s) => toKimath(shapeToPolygon(s, 0, MAX_ERROR))));

/** `TransformOvalToPolygon( hole, …, ERROR_OUTSIDE )`, shifted into the pad
 *  shape's frame (see `padShapeOffset`). */
function holeOutlinePolys(pad: PcbPad): Polygon[] {
  const hole = padHoleSegment(pad);
  if (!hole) return [];

  const off = padShapeOffset(pad);
  const r = hole.width / 2;
  const shape: Shape = {
    kind: 'stadium',
    a: { x: hole.a.x - off.x, y: hole.a.y - off.y },
    b: { x: hole.b.x - off.x, y: hole.b.y - off.y },
    r,
  };

  return toKimath(shapeToPolygon(shape, errorOutsideGrow(r), MAX_ERROR));
}

const isEmptyPolys = (polys: Polygon[]): boolean =>
  polys.every((poly) => poly.length === 0 || poly[0]!.length < 3);

// ---------------------------------------------------------------------------
// Net-tie pad groups.

/**
 * `FOOTPRINT::IsNetTie` (footprint.h:523): at least one non-empty group string.
 * A footprint carrying `(net_tie_pad_groups "")` is therefore *not* a net tie,
 * and neither net-tie check runs on it.
 */
export function isNetTie(fp: PcbFootprint): boolean {
  return (fp.netTiePadGroups ?? []).some((g) => g !== '');
}

/**
 * `FOOTPRINT::MapPadNumbersToNetTieGroups` (footprint.cpp:4078).
 *
 * Seeded with every pad number at -1, then each group's comma-separated names
 * overwrite their entry with the group's index. Because the map is keyed by pad
 * *number*, a number listed in two groups does not error and does not belong to
 * both — the last group silently wins. A name matching no pad still gets an
 * entry, which is what makes the unknown-pad-number check possible.
 */
export function mapPadNumbersToNetTieGroups(fp: PcbFootprint): Map<string, number> {
  const map = new Map<string, number>();

  for (const pad of fp.pads) map.set(pad.number, -1);

  const flush = (name: string, group: number): void => {
    // wxString::Trim( true ).Trim( false ) — both ends.
    const trimmed = name.trim();
    if (trimmed !== '') map.set(trimmed, group);
  };

  const groups = fp.netTiePadGroups ?? [];

  for (let ii = 0; ii < groups.length; ii++) {
    let esc = false;
    let name = '';

    for (const ch of groups[ii]!) {
      if (esc) {
        // A backslash escapes whatever follows, so `\,` is a literal comma in
        // a pad number and `\\` a literal backslash.
        esc = false;
        name += ch;
        continue;
      }

      // Upstream switches on `static_cast<unsigned char>( ch )`, truncating a
      // non-ASCII character to its low byte: a pad number containing U+012C is
      // read as containing a comma. That is an upstream bug and it is mirrored
      // here, because a footprint must parse the same way in both tools.
      switch (ch.codePointAt(0)! & 0xff) {
        case 0x5c: // '\\'
          esc = true;
          break;
        case 0x2c: // ','
          flush(name, ii);
          name = '';
          break;
        default:
          name += ch;
          break;
      }
    }

    // The tail after the last comma is a real name; a trailing lone backslash
    // set `esc` and is simply dropped.
    flush(name, ii);
  }

  return map;
}

/**
 * `std::map<wxString, int>::operator[]` default-constructs a missing value to
 * **0**, not -1 — group zero. The map is seeded from every pad, so no caller
 * inside this module can reach that, but the fallback is upstream's rather than
 * a friendlier invention.
 */
const groupOf = (map: Map<string, number>, number: string): number => map.get(number) ?? 0;

/**
 * `FOOTPRINT::GetNetTiePads` (footprint.cpp:4133). The list INCLUDES `pad`
 * itself; upstream only ever asks whether it contains some *other* pad, so
 * excluding it would be a divergence for no gain. And because the map is keyed
 * by pad number, asking for one of several pads sharing a number returns every
 * pad whose number is in that group, duplicates included.
 */
export function getNetTiePads(fp: PcbFootprint, pad: PcbPad): PcbPad[] {
  const map = mapPadNumbersToNetTieGroups(fp);
  const groupIdx = groupOf(map, pad.number);

  if (groupIdx < 0) return [];

  return fp.pads.filter((p) => groupOf(map, p.number) === groupIdx);
}

// ---------------------------------------------------------------------------
// Pads.

export interface PadFinding {
  code: 'padstack' | 'padstack_invalid' | 'through_hole_pad_without_hole';
  detail: string;
}

/**
 * `PAD::CheckPad` (pad.cpp:3197) together with `PAD::doCheckPad` (pad.cpp:3312).
 *
 * Order matters: `CheckPad` runs `doCheckPad` over the padstack's unique layers
 * *first*, then its own body. Our model has only NORMAL padstacks, whose
 * `ForEachUniqueLayer` yields exactly one pseudo-layer, so `doCheckPad` runs
 * once per pad and the per-layer loop collapses away.
 *
 * `aForPadProperties` is what the Pad Properties dialog passes and the
 * footprint checker does not. It enables exactly one extra rule — the hole must
 * lie fully inside the copper — which the footprint checker leaves to the
 * board's annular-ring provider.
 */
export function checkPad(pad: PcbPad, forPadProperties: boolean): PadFinding[] {
  const out: PadFinding[] = [];
  const bad = (code: PadFinding['code'], detail: string): void => {
    out.push({ code, detail });
  };

  // ----- doCheckPad ------------------------------------------------------

  // A custom pad takes its nominal size from its bounding box and skips the
  // positive-size test entirely; a circle takes its diameter from x alone, so
  // a zero y is legal there and nowhere else.
  let padSize = pad.size;

  if (pad.shape === 'custom') padSize = padBoundingBoxSize(pad);
  else if (padSize.x <= 0 || (padSize.y <= 0 && pad.shape !== 'circle'))
    bad('padstack_invalid', '(Pad must have a positive size)');

  // The copper gate is real: an aperture pad — paste only, no copper — with a
  // drill runs none of the hole rules.
  if (padIsOnCopper(pad) && drillX(pad) > 0) {
    // Below four IU a hole cannot be turned into a polygon at all.
    if (drillX(pad) <= MIN_DRILL_SIZE || drillY(pad) <= MIN_DRILL_SIZE)
      bad('padstack_invalid', `(PTH pad hole size must be larger than ${MIN_DRILL_SIZE} nm)`);

    if (pad.type === 'thru_hole') {
      const copper = booleanSubtract(padOutlinePolys(pad), holeOutlinePolys(pad));

      if (isEmptyPolys(copper)) {
        bad('padstack', '(PTH pad hole leaves no copper)');
      } else if (forPadProperties) {
        const outside = booleanSubtract(holeOutlinePolys(pad), padOutlinePolys(pad));
        if (!isEmptyPolys(outside)) bad('padstack', '(PTH pad hole not fully inside copper)');
      }
    } else {
      // Only the hole's *centre* need be in the copper. Testing the exact pad
      // shapes rather than their tessellation is strictly closer to upstream's
      // question than re-deriving the polygon would be.
      const off = padShapeOffset(pad);
      const probe: Shape = {
        kind: 'circle',
        c: { x: pad.at.x - off.x, y: pad.at.y - off.y },
        r: 0,
      };

      if (!padShapes(pad).some((s) => shapeDist(s, probe) <= 0))
        bad('padstack', '(pad hole not inside pad shape)');
    }
  }

  if ((pad.localClearance ?? 0) < 0)
    bad('padstack', '(negative local clearance values have no effect)');

  // Three-valued: an absent margin is not a zero one, and only a *stated*
  // negative margin is checked.
  const maskMargin = pad.localSolderMaskMargin;

  if (maskMargin !== undefined && maskMargin < 0) {
    const absMargin = Math.abs(maskMargin);

    if (pad.shape === 'custom') {
      // At most one finding: upstream breaks out of the loop on the first
      // primitive the margin would swallow.
      for (const prim of pad.primitives ?? []) {
        const box = primitiveBBox(prim);
        if (!box) continue;

        if (absMargin > box.maxX - box.minX || absMargin > box.maxY - box.minY) {
          bad(
            'padstack',
            '(negative solder mask clearance is larger than some shape primitives; results may be surprising)',
          );
          break;
        }
      }
    } else if (absMargin > padSize.x || absMargin > padSize.y) {
      bad(
        'padstack',
        '(negative solder mask clearance is larger than pad; no solder mask will be generated)',
      );
    }
  }

  // Paste is the pad grown by the margin plus a fraction of its own size.
  // KiROUND rounds half away from zero; Math.round rounds half towards +inf,
  // which differs on every negative half-integer.
  const pasteMargin = pad.localSolderPasteMargin ?? 0;
  const ratio = pad.localSolderPasteMarginRatio ?? 0;
  const pasteX = padSize.x + pasteMargin + KiROUND(padSize.x * ratio);
  const pasteY = padSize.y + pasteMargin + KiROUND(padSize.y * ratio);

  if (pasteX <= 0 || pasteY <= 0)
    bad(
      'padstack',
      '(negative solder paste margin is larger than pad; no solder paste mask will be generated)',
    );

  // An if/else-if chain upstream, so at most one arm runs.
  if (pad.shape === 'roundrect') {
    const r = pad.roundrectRatio ?? 0;
    if (r < 0) bad('padstack_invalid', '(negative corner radius is not allowed)');
    else if (r > 0.5) bad('padstack', '(corner size will make pad circular)');
  } else if (pad.shape === 'trapezoid') {
    // Strictly greater: a delta exactly equal to the opposing size is legal.
    const dx = pad.delta?.x ?? 0;
    const dy = pad.delta?.y ?? 0;
    if (Math.abs(dx) > pad.size.y || Math.abs(dy) > pad.size.x)
      bad('padstack_invalid', '(trapezoid delta is too large)');
  }

  // Upstream's CHAMFERED_RECT is a third arm of that chain. Our model has no
  // such shape token — a chamfer is `chamferRatio`/`chamfer[]` carried
  // alongside `shape: 'roundrect'` — so the only way to reach the rule at all
  // is to test the ratio whenever it is stated. Both messages are
  // padstack_INVALID, unlike the roundrect pair above.
  //
  // The 0.5 thresholds are the tree's standing divergence: upstream compares
  // against 50.0 while the getter returns the 0..0.5 fraction the file stores,
  // so upstream's comparison can never fire. Half the smaller dimension is the
  // radius that actually makes the pad circular, which is what the message says.
  const chamfer = pad.chamferRatio;

  if (chamfer !== undefined) {
    if (chamfer < 0) bad('padstack_invalid', '(negative corner chamfer is not allowed)');
    else if (chamfer > 0.5) bad('padstack_invalid', '(corner chamfer is too large)');
  }

  if (pad.shape === 'custom') {
    const merged = union(padShapes(pad).flatMap((s) => toKimath(shapeToPolygon(s, 0, MAX_ERROR))));
    if (merged.length > 1)
      bad('padstack_invalid', '(custom pad shape must resolve to a single polygon)');
  }

  // ----- CheckPad's own body --------------------------------------------

  const onFrontCu = padOnLayer(pad, 'F.Cu');
  const onBackCu = padOnLayer(pad, 'B.Cu');

  if (!onFrontCu && !onBackCu) {
    if ((drillX(pad) || drillY(pad)) && pad.type !== 'np_thru_hole')
      bad(
        'padstack',
        '(plated through holes normally have a copper pad on at least one outer layer)',
      );
  }

  const prop = pad.padProperty;
  const npth = pad.type === 'np_thru_hole';

  if ((prop === 'pad_prop_fiducial_glob' || prop === 'pad_prop_fiducial_loc') && npth)
    bad('padstack', "('fiducial' pads are normally plated)");

  if (prop === 'pad_prop_testpoint' && npth)
    bad('padstack', "('testpoint' pads are normally plated)");

  if (prop === 'pad_prop_heatsink' && npth)
    bad('padstack', "('heatsink' pads are normally plated)");

  if (prop === 'pad_prop_castellated' && pad.type !== 'thru_hole')
    bad('padstack', "('castellated' pads are normally PTH)");

  if (prop === 'pad_prop_bga' && pad.type !== 'smd')
    bad('padstack', "('BGA' property is for SMD pads)");

  if (prop === 'pad_prop_mechanical' && pad.type !== 'thru_hole')
    bad('padstack', "('mechanical' pads are normally PTH)");

  // HasDrilledHole() is false for a slot *and* for no hole at all, so a PTH
  // press-fit pad with no drill trips this too, not only an oblong one.
  if (prop === 'pad_prop_pressfit' && (pad.type !== 'thru_hole' || !hasDrilledHole(pad)))
    bad('padstack', "('press-fit' pads are normally PTH with round holes)");

  // A C++ switch with one shared NPTH/PTH arm and a deliberate fallthrough
  // from CONN into SMD.
  if (pad.type === 'np_thru_hole' || pad.type === 'thru_hole') {
    if (drillX(pad) <= 0 || (drillY(pad) <= 0 && (pad.drill?.oblong ?? false)))
      bad('through_hole_pad_without_hole', '');
  } else {
    if (pad.type === 'connect' && (padOnLayer(pad, 'B.Paste') || padOnLayer(pad, 'F.Paste')))
      bad('padstack', '(connector pads normally have no solder paste; use a SMD pad instead)');

    // KI_FALLTHROUGH: a connector pad gets every SMD rule below as well.
    if (drillX(pad) > 0 || drillY(pad) > 0) bad('padstack_invalid', '(SMD pad has a hole)');

    if (onFrontCu && onBackCu) {
      bad('padstack', '(SMD pad has copper on both sides of the board)');
    } else if (onFrontCu) {
      if (padOnLayer(pad, 'B.Mask'))
        bad('padstack', '(SMD pad has copper and mask layers on different sides of the board)');
      else if (padOnLayer(pad, 'B.Paste'))
        bad('padstack', '(SMD pad has copper and paste layers on different sides of the board)');
    } else if (onBackCu) {
      if (padOnLayer(pad, 'F.Mask'))
        bad('padstack', '(SMD pad has copper and mask layers on different sides of the board)');
      else if (padOnLayer(pad, 'F.Paste'))
        bad('padstack', '(SMD pad has copper and paste layers on different sides of the board)');
    } else if (padHasInnerCopper(pad)) {
      // Only an inner-copper-only pad has "no outer layers". One with no copper
      // at all — a paste aperture — says nothing and is reported as nothing.
      bad('padstack', '(SMD pad has no outer layers)');
    }
  }

  return out;
}

type Box = { minX: number; minY: number; maxX: number; maxY: number };

const mergeBox = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

/**
 * `PAD::GetBoundingBox`, which `buildEffectiveShape` builds by merging every
 * layer's shape box with the *hole* segment's box. That last part is why a
 * tiny SMD pad sat over a big drill still has a big box, and it is observable:
 * `CheckShortingPads` uses the box as its cheap reject.
 */
function padBoundingBox(pad: PcbPad): Box {
  let box: Box | null = null;

  for (const s of padShapes(pad)) box = box ? mergeBox(box, shapeBBox(s)) : shapeBBox(s);

  const hole = padHoleSegment(pad);

  if (hole) {
    const hb = shapeBBox({ kind: 'stadium', a: hole.a, b: hole.b, r: hole.width / 2 });
    box = box ? mergeBox(box, hb) : hb;
  }

  return box ?? { minX: pad.at.x, minY: pad.at.y, maxX: pad.at.x, maxY: pad.at.y };
}

const padBoundingBoxSize = (pad: PcbPad): Vec2 => {
  const b = padBoundingBox(pad);
  return { x: b.maxX - b.minX, y: b.maxY - b.minY };
};

/**
 * A custom pad primitive's own bounding box, in the pad's local frame — the
 * `identity` placement is what makes it local. An arc's box is its full
 * circle's rather than the swept extent, which is wider than upstream's; it
 * only ever makes the negative-mask-margin rule slightly *less* likely to fire.
 */
function primitiveBBox(prim: PadPrimitive): Box | null {
  const identity = (p: Vec2): Vec2 => p;
  let box: Box | null = null;

  for (const s of primitiveShapes(prim, identity))
    box = box ? mergeBox(box, shapeBBox(s)) : shapeBBox(s);

  return box;
}

// ---------------------------------------------------------------------------
// The seven checks.

/** `FOOTPRINT::CheckFootprintAttributes` (footprint.cpp:4155). */
function checkFootprintAttributes(fp: PcbFootprint): string[] {
  // FP_SMD and FP_THROUGH_HOLE are separate bits, and a footprint may carry
  // both. That matters: two bits can never equal a one-bit likely attribute, so
  // `(attr smd through_hole)` always reports a mismatch as soon as it has any
  // pad — including the nonsense "(expected 'SMD'; actual 'SMD')".
  const smdBit = fp.attributes?.includes('smd') ?? false;
  const thtBit = fp.attributes?.includes('through_hole') ?? false;
  const setAttr = (smdBit ? 1 : 0) | (thtBit ? 2 : 0);

  const likelyName = likelyFootprintAttribute(fp);
  const likelyAttr = likelyName === 'SMD' ? 1 : likelyName === 'Through hole' ? 2 : 0;

  if (!setAttr || !likelyAttr || setAttr === likelyAttr) return [];

  // FOOTPRINT::GetTypeName (footprint.cpp:1712), checked in this order — so a
  // footprint with both bits reports 'SMD'. 'Other' is unreachable in the
  // message because the emit is gated on setAttr being non-zero.
  const typeName = smdBit ? 'SMD' : thtBit ? 'Through hole' : 'Other';

  return [`(expected '${likelyName}'; actual '${typeName}')`];
}

/** `FOOTPRINT::CheckShortingPads` (footprint.cpp:4198). */
function checkShortingPads(fp: PcbFootprint): DrcViolation[] {
  const out: DrcViolation[] = [];
  const ref = fp.reference ?? fp.lib;
  const refOf = (pad: PcbPad): DrcItemRef => ({
    desc: `Pad ${pad.number} of ${ref}`,
    pos: pad.at,
  });

  // Upstream is a full n² loop guarded by a set of already-checked pointer
  // pairs. The observable effect is that each unordered pair is handled once,
  // at the moment the OUTER loop reaches the earlier pad — which is what makes
  // `pad` the primary of every asymmetric test below.
  for (let i = 0; i < fp.pads.length; i++) {
    const pad = fp.pads[i]!;
    const netTiePads = getNetTiePads(fp, pad);

    for (let j = i + 1; j < fp.pads.length; j++) {
      const other = fp.pads[j]!;

      // Round holes only. A slot is exempt from both hole rules.
      if (hasDrilledHole(pad) && hasDrilledHole(other)) {
        const pos = pad.at;

        if (pad.at.x === other.at.x && pad.at.y === other.at.y) {
          // Exact equality, no epsilon — and an `else` against the next test,
          // so a co-located pair never also reports too-close.
          out.push({
            code: 'holes_co_located',
            message: 'Drilled holes co-located',
            pos,
            items: [refOf(pad), refOf(other)],
          });
        } else {
          const a = padHoleSegment(pad)!;
          const b = padHoleSegment(other)!;

          // SHAPE_SEGMENT::Collide( const SEG&, 0 ) (shape_segment.h:78) is
          // ASYMMETRIC: min_dist is `( m_width + 1 ) / 2` from the *calling*
          // hole alone — integer division — and the other hole is treated as a
          // zero-width axis. Adding B's radius, or using <=, both diverge, and
          // because the pair is visited once the outcome depends on file order.
          const minDist = Math.trunc((a.width + 1) / 2);
          const d = segSeg(a.a, a.b, b.a, b.b);

          if (d === 0 || d < minDist) {
            out.push({
              code: 'hole_to_hole',
              message: 'Drilled hole too close to other hole',
              pos,
              items: [refOf(pad), refOf(other)],
            });
          }
        }
      }

      // SameLogicalPadAs: within one footprint, "both carry the same non-empty
      // number". Two pads sharing a number are one logical pad from before
      // custom shapes existed and are allowed to overlap — but note the
      // `continue` sits *after* the hole block, so they still get hole checks.
      // Two pads with EMPTY numbers are not same-logical and do short.
      if ((pad.number !== '' && pad.number === other.number) || netTiePads.includes(other))
        continue;

      if (!sharesCopperLayer(pad, other)) continue;

      // BOX2I::Intersects counts touching edges as intersecting.
      const boxA = padBoundingBox(pad);
      const boxB = padBoundingBox(other);

      if (
        boxA.maxX < boxB.minX ||
        boxB.maxX < boxA.minX ||
        boxA.maxY < boxB.minY ||
        boxB.maxY < boxA.minY
      )
        continue;

      // One violation per colliding layer of RelevantShapeLayers; both
      // padstacks are NORMAL, so that set is a single pseudo-layer and the
      // pair can be reported at most once.
      const shapesA = padShapes(pad);
      const shapesB = padShapes(other);
      const hit = shapesA.some((sa) => shapesB.some((sb) => shapeDist(sa, sb) <= 0));

      if (hit) {
        out.push({
          code: 'shorting_items',
          message: 'Items shorting two nets',
          pos: pad.at,
          items: [refOf(pad), refOf(other)],
        });
      }
    }
  }

  return out;
}

/** `( a.GetLayerSet() & b.GetLayerSet() & LSET::AllCuMask() ).any()`. */
function sharesCopperLayer(a: PcbPad, b: PcbPad): boolean {
  const wild = (pad: PcbPad): boolean => pad.layers.includes('*.Cu');
  const named = (pad: PcbPad): string[] => pad.layers.filter(isCopper);

  // `*.Cu` is every copper layer, so it meets anything that has any copper.
  if (wild(a)) return wild(b) || named(b).length > 0;
  if (wild(b)) return named(a).length > 0;

  const set = new Set(named(a));
  return named(b).some((l) => set.has(l));
}

/** `FOOTPRINT::CheckNetTiePadGroups` (footprint.cpp:4378). */
function checkNetTiePadGroups(fp: PcbFootprint): string[] {
  const out: string[] = [];
  const map = mapPadNumbersToNetTieGroups(fp);
  const seen = new Set<string>();

  // Upstream iterates a std::map, i.e. in LEXICOGRAPHIC order of pad number —
  // not file order and not group order. A plain JS Map iterates in insertion
  // order, which is a different and wrong sequence; the default sort is UTF-16
  // code-unit order, which is what wxString::operator< gives.
  for (const padNumber of [...map.keys()].sort()) {
    // FindPadByNumber: the first pad with that exact number.
    const pad = fp.pads.find((p) => p.number === padNumber);

    if (!pad) {
      out.push(`(net-tie pad group contains unknown pad number ${padNumber})`);
    } else if (seen.has(pad.number)) {
      // Unreachable, and kept anyway so the code still reads as a mirror: the
      // map's keys are distinct by construction and FindPadByNumber returns a
      // pad whose number equals the key, so this set never rejects. A port that
      // iterated the raw group strings instead would emit violations upstream
      // never produces.
      out.push(`(pad ${padNumber} appears in more than one net-tie pad group)`);
    } else {
      seen.add(pad.number);
    }
  }

  return out;
}

/**
 * `FOOTPRINT::CheckNetTies` (footprint.cpp:4267).
 *
 * PADS ARE NOT PART OF THE COPPER SET. The outlines are built from drawings
 * (plus zones and fields, which our model does not carry) and pads are merely
 * *indexed against* them — the net-tie trace is the thing being examined. A
 * port that added pads to the polygon set would merge every touching pad pair
 * into one outline and report shorts everywhere.
 */
function checkNetTies(fp: PcbFootprint): DrcViolation[] {
  const out: DrcViolation[] = [];
  const map = mapPadNumbersToNetTieGroups(fp);
  const ref = fp.reference ?? fp.lib;
  const copperItems = fp.shapes.filter((s) => isCopper(s.layer));

  if (copperItems.length === 0) return out;

  for (const layer of NET_TIE_LAYERS) {
    const onLayer = copperItems.filter((s) => s.layer === layer);
    if (onLayer.length === 0) continue;

    // `Simplify()` is a self-union: two shapes forming one trace become ONE
    // outline, which is exactly what makes the rest of this work.
    const outlines = union(
      onLayer.flatMap((s) =>
        graphicShapes(s).flatMap((sh) => toKimath(shapeToPolygon(sh, 0, MAX_ERROR))),
      ),
    )
      .map((poly) => poly[0])
      .filter((ring): ring is Vec2[] => !!ring && ring.length >= 3);

    // No layer filter on the pad: GetEffectiveShape falls back through
    // EffectiveLayerFor, so a pad not on `layer` is still tested. One pad can
    // land in several outlines; pads are appended in file order.
    const byOutline = new Map<number, PcbPad[]>();

    for (const pad of fp.pads) {
      const shapes = padShapes(pad);

      outlines.forEach((ring, ii) => {
        const poly: Shape = { kind: 'poly', pts: ring, r: 0 };
        if (!shapes.some((s) => shapeDist(s, poly) <= 0)) return;
        byOutline.set(ii, [...(byOutline.get(ii) ?? []), pad]);
      });
    }

    // std::map<int, …>: ascending outline index.
    for (const ii of [...byOutline.keys()].sort((a, b) => a - b)) {
      const pads = byOutline.get(ii)!;
      if (pads.length <= 1) continue;

      const firstPad = pads[0]!;
      const firstGroupIdx = groupOf(map, firstPad.number);

      // Every pad is compared against pads[0] only, never pairwise. Three
      // ungrouped pads on one outline therefore yield two violations, both
      // naming pads[0].
      for (let k = 1; k < pads.length; k++) {
        const thisPad = pads[k]!;
        const thisGroupIdx = groupOf(map, thisPad.number);

        if (thisGroupIdx >= 0 && thisGroupIdx === firstGroupIdx) continue;

        // The integer-truncated midpoint of the two pad centres, then snapped
        // onto the outline boundary — not left at the midpoint.
        const mid: Vec2 = {
          x: Math.trunc((firstPad.at.x + thisPad.at.x) / 2),
          y: Math.trunc((firstPad.at.y + thisPad.at.y) / 2),
        };
        const pos = nearestPointOnRing(outlines[ii]!, mid);

        // The first copper item that hit-tests the snapped position at 1 IU.
        const shorting = copperItems.find((s) =>
          graphicShapes(s).some((sh) => shapeDist(sh, { kind: 'circle', c: pos, r: 0 }) <= 1),
        );

        const padRefs: DrcItemRef[] = [
          { desc: `Pad ${firstPad.number} of ${ref}`, pos: firstPad.at },
          { desc: `Pad ${thisPad.number} of ${ref}`, pos: thisPad.at },
        ];

        out.push({
          code: 'shorting_items',
          message: 'Items shorting two nets',
          pos,
          // Three refs with the graphic FIRST when one was found, two otherwise.
          items: shorting
            ? [{ desc: `Graphic on ${shorting.layer}`, pos: shapePos(shorting) }, ...padRefs]
            : padRefs,
        });
      }
    }
  }

  return out;
}

/** `SHAPE_LINE_CHAIN::NearestPoint`. */
function nearestPointOnRing(ring: Vec2[], p: Vec2): Vec2 {
  let best = p;
  let bestD = Infinity;

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
    const q = { x: a.x + t * abx, y: a.y + t * aby };
    const d = Math.hypot(q.x - p.x, q.y - p.y);

    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }

  return best;
}

/**
 * `FOOTPRINT::CheckClippedSilk` (footprint.cpp:4401).
 *
 * The silk side is ALWAYS a drawing: a pad on F.SilkS is never examined as
 * silk, only ever as the mask side. Fields are not examined at all, even though
 * `CheckNetTies` deliberately does pull them in — that asymmetry is upstream's.
 *
 * The mask-side shape is the pad's copper UNGROWN: `GetEffectiveShape( F_Mask )`
 * does not apply the solder-mask margin. This is literal clipping at clearance
 * 0, not the Board Setup silk clearance, so the board-level `silk_over_copper`
 * provider's inflation must not appear here.
 */
function checkClippedSilk(fp: PcbFootprint): DrcViolation[] {
  const out: DrcViolation[] = [];
  const ref = fp.reference ?? fp.lib;

  const check = (
    item: PcbShape,
    other: { shapes: Shape[]; ref: DrcItemRef; on: (l: string) => boolean },
  ): void => {
    for (const silk of ['F.SilkS', 'B.SilkS'] as const) {
      const mask = silk === 'F.SilkS' ? 'F.Mask' : 'B.Mask';

      if (item.layer !== silk || !other.on(mask)) continue;

      const itemShapes = graphicShapes(item);
      if (!itemShapes.some((a) => other.shapes.some((b) => shapeDist(a, b) <= 0))) continue;

      const pos = shapePos(item);

      out.push({
        code: 'silk_over_copper',
        message: 'Silkscreen clipped by solder mask',
        pos,
        items: [{ desc: `Graphic on ${item.layer}`, pos }, other.ref],
      });
    }
  };

  for (const item of fp.shapes) {
    // A full inner pass, not j > i: a mutually overlapping pair produces two
    // markers, one from each direction.
    for (const other of fp.shapes) {
      if (other === item) continue;
      check(item, {
        shapes: graphicShapes(other),
        ref: { desc: `Graphic on ${other.layer}`, pos: shapePos(other) },
        on: (l) => other.layer === l,
      });
    }

    for (const pad of fp.pads) {
      check(item, {
        shapes: padShapes(pad),
        ref: { desc: `Pad ${pad.number} of ${ref}`, pos: pad.at },
        on: (l) => padOnLayer(pad, l),
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// The driver.

/**
 * `DIALOG_FOOTPRINT_CHECKER::runChecks` (dialog_footprint_checker.cpp:82).
 *
 * The dialog is a thin driver: it deletes the board's markers, takes the single
 * footprint being edited, and turns seven fixed checks into markers. The order
 * below is that order and is load-bearing.
 */
export function checkFootprint(fp: PcbFootprint): DrcViolation[] {
  const out: DrcViolation[] = [];
  const ref = fp.reference ?? fp.lib;
  const fpRef: DrcItemRef = { desc: `Footprint ${ref}`, pos: fp.at };

  // (1) BuildCourtyardCaches' OUTLINE_ERROR_HANDLER. Upstream's wrapper swaps
  // the two items when the first is null, so a single-item error always reports
  // that item as A — mirrored by carrying only the footprint reference.
  //
  // The error *point* is upstream's dangling endpoint; `chainOutlines` does not
  // carry one, so the footprint anchor stands in.
  const front = buildCourtyard(fp, 'F.CrtYd');
  const back = buildCourtyard(fp, 'B.CrtYd');

  for (const side of [front, back]) {
    if (!side.error) continue;

    out.push({
      code: 'malformed_courtyard',
      message: `Footprint has malformed courtyard ${side.error}`,
      pos: fp.at,
      items: [fpRef],
    });
  }

  // (2) Note there is no `!malformed` guard, and there must not be: upstream
  // asks `OutlineCount() == 0`, and a courtyard that failed to close left zero
  // outlines, so it earns BOTH markers. `(attr allow_missing_courtyard)`
  // suppresses only this one, never the malformed one.
  if (!allowsMissingCourtyard(fp) && front.outlines.length === 0 && back.outlines.length === 0) {
    out.push({
      code: 'missing_courtyard',
      message: 'Footprint has no courtyard defined',
      pos: fp.at,
      items: [fpRef],
    });
  }

  // (3)
  for (const detail of checkFootprintAttributes(fp)) {
    out.push({
      code: 'footprint_type_mismatch',
      message: `Footprint component type doesn't match footprint pads ${detail}`,
      pos: fp.at,
      items: [fpRef],
    });
  }

  // (4) FOOTPRINT::CheckPads, pads in file order.
  for (const pad of fp.pads) {
    const padRef: DrcItemRef = { desc: `Pad ${pad.number} of ${ref}`, pos: pad.at };

    for (const finding of checkPad(pad, false)) {
      const title =
        finding.code === 'padstack'
          ? 'Padstack is questionable'
          : finding.code === 'padstack_invalid'
            ? 'Padstack is not valid'
            : 'Through hole pad has no hole';

      out.push({
        code: finding.code,
        message: finding.detail ? `${title} ${finding.detail}` : title,
        pos: pad.at,
        items: [padRef],
      });
    }
  }

  // (5)
  out.push(...checkShortingPads(fp));

  // (6) Both net-tie checks are gated on IsNetTie().
  if (isNetTie(fp)) {
    for (const detail of checkNetTiePadGroups(fp)) {
      out.push({
        code: 'footprint',
        message: `Footprint is not valid ${detail}`,
        pos: fp.at,
        items: [fpRef],
      });
    }

    out.push(...checkNetTies(fp));
  }

  // (7)
  out.push(...checkClippedSilk(fp));

  return out;
}
