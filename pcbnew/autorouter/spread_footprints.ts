// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Spreading freshly added footprints out. Counterpart:
 * `pcbnew/autorouter/spread_footprints.cpp` (SpreadFootprints), with
 * GetRefDesPrefix / GetTrailingInt from `common/refdes_utils.cpp` and
 * `common/string_utils.cpp`.
 *
 * When a netlist update adds footprints they all arrive at one point, which would
 * leave them stacked on top of each other. This lays them out in a free area below
 * the board in three nested passes:
 *
 *  1. within a sheet, footprints of identical size are arranged into a block, rows
 *     or columns depending on which way round they are, wrapped so a block does not
 *     become a 5:1 sliver, and ordered by reference designator;
 *  2. the blocks of one sheet are packed against each other;
 *  3. the sheets themselves are packed, each with a margin around it.
 *
 * Packing at steps 2 and 3 is rectpack2d's empty-spaces packer, so the result is the
 * same compact arrangement KiCad produces.
 */

import { getTrailingInt } from '@ziroeda/common/string_utils.js';
import { pcbMmToIU as mmToIU } from '@ziroeda/common/eda_units.js';
import { findBestPacking, type RectWH } from '@ziroeda/rectpack2d';
import type { FOOTPRINT } from '../footprint.js';
import { kiidPathAsString } from '@ziroeda/common/kiid.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** Placement is calculated in 0.01 mm units, to keep the search cheap. */
const SCALE = mmToIU(0.01);

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const boxWidth = (b: Box): number => b.maxX - b.minX;
const boxHeight = (b: Box): number => b.maxY - b.minY;

const mergeBox = (into: Box | null, b: Box): Box =>
  into
    ? {
        minX: Math.min(into.minX, b.minX),
        minY: Math.min(into.minY, b.minY),
        maxX: Math.max(into.maxX, b.maxX),
        maxY: Math.max(into.maxY, b.maxY),
      }
    : { ...b };

const inflate = (b: Box, by: number): Box => ({
  minX: b.minX - by,
  minY: b.minY - by,
  maxX: b.maxX + by,
  maxY: b.maxY + by,
});

/** GetRefDesPrefix, everything up to the trailing digits and question marks. */
export function getRefDesPrefix(refDes: string): string {
  let end = refDes.length;
  while (end > 0) {
    const ch = refDes[end - 1]!;
    if (ch !== '?' && !(ch >= '0' && ch <= '9')) break;
    end--;
  }
  return refDes.slice(0, end);
}

/**
 * What the spread reads of a footprint: its box WITHOUT text, the path of the
 * sheet its symbol lives on (`GetPath().AsString()`), and its reference.
 */
interface SpreadSubject {
  box: Box;
  path: string;
  reference: string;
}

/** compareFootprintsbyRef, reference prefix, then the trailing number. */
function compareFootprintsByRef(a: SpreadSubject, b: SpreadSubject): number {
  const refA = a.reference;
  const refB = b.reference;
  const prefixA = getRefDesPrefix(refA);
  const prefixB = getRefDesPrefix(refB);
  if (prefixA !== prefixB) return prefixA < prefixB ? -1 : 1;
  return getTrailingInt(refA) - getTrailingInt(refB);
}

/**
 * spreadRectangles, pack `rects` (in IU) into a square area, growing the search
 * area by 20% until every rectangle fits. Returns the top-left corner each
 * rectangle was given, in IU.
 */
function spreadRectangles(rects: readonly RectWH[], areaSize: number): Vec2[] {
  const scaled = rects.map((r) => ({
    w: Math.max(1, Math.trunc(r.w / SCALE)),
    h: Math.max(1, Math.trunc(r.h / SCALE)),
  }));

  let maxSide = Math.max(1, Math.trunc(areaSize / SCALE));

  for (let attempt = 0; attempt < 2000; attempt++) {
    const result = findBestPacking(scaled, { maxBinSide: maxSide, discardStep: 1 });
    if (result.placements.every((p) => p !== null)) {
      return result.placements.map((p) => ({
        x: (p?.x ?? 0) * SCALE,
        y: (p?.y ?? 0) * SCALE,
      }));
    }
    maxSide = Math.trunc(maxSide * 1.2) + 1;
  }

  // Give up and lay them out in a row: overlapping components are better than
  // components off screen.
  let x = 0;
  return rects.map((r) => {
    const at = { x, y: 0 };
    x += r.w;
    return at;
  });
}

/** One group of same-size footprints of one sheet. */
interface SizeBlock {
  /** The size all its footprints share, plus the component gap. */
  size: { x: number; y: number };
  footprints: SpreadSubject[];
  /** Bounding box of the block once its footprints are arranged. */
  box: Box | null;
}

interface SheetGroup {
  path: string;
  blocks: Map<string, SizeBlock>;
  box: Box | null;
}

export interface SpreadFootprintsOptions {
  /** Keep footprints of one schematic sheet together (aGroupBySheet). */
  groupBySheet?: boolean;
  /** Gap between footprints inside a block (aComponentGap), default 1 mm. */
  componentGap?: number;
  /** Margin around each sheet's area (aGroupGap), default 1.5 mm. */
  groupGap?: number;
}

/**
 * `SpreadFootprints( std::vector<FOOTPRINT*>* aFootprints, VECTOR2I
 * aTargetBoxPosition, bool aGroupBySheet, int aComponentGap, int aGroupGap )`
 * (spread_footprints.cpp:123), on the live footprints: each is moved.
 */
export function SpreadFootprints(
  aFootprints: readonly FOOTPRINT[],
  aTargetBoxPosition: Vec2,
  aGroupBySheet = true,
  aComponentGap: number = mmToIU(1),
  aGroupGap: number = mmToIU(1.5),
): void {
  const deltas = spreadSubjects(
    aFootprints.map((fp) => {
      const b = fp.GetBoundingBox(false);
      return {
        box: { minX: b.GetLeft(), minY: b.GetTop(), maxX: b.GetRight(), maxY: b.GetBottom() },
        path: kiidPathAsString(fp.GetPath()),
        reference: fp.GetReference(),
      };
    }),
    aTargetBoxPosition,
    { groupBySheet: aGroupBySheet, componentGap: aComponentGap, groupGap: aGroupGap },
  );

  aFootprints.forEach((fp, i) => fp.Move(deltas[i]!));
}

/** The three passes over what the spread reads of each footprint. */
function spreadSubjects(
  footprints: readonly SpreadSubject[],
  targetBoxPosition: Vec2,
  options: SpreadFootprintsOptions,
): Vec2[] {
  const groupBySheet = options.groupBySheet ?? true;
  const componentGap = options.componentGap ?? mmToIU(1);
  const groupGap = options.groupGap ?? mmToIU(1.5);

  if (footprints.length === 0) return [];

  // Where each footprint currently is, so the result can be expressed as a delta.
  //
  // `GetBoundingBox( FALSE )` — WITHOUT text — at all four of upstream's call
  // sites (spread_footprints.cpp:137, 210, 213, 245).
  //
  // Not a detail. Measured on the installed 10.0.5 libraries, box with text
  // against box without, in mm:
  //
  //     D_DO-41_SOD81_P10.16mm_Horizontal      12.86 x 3.20  ->  30.01 x 6.64
  //     R_Axial_DIN0207_..._P10.16mm_Horiz.    12.26 x 3.00  ->  43.25 x 6.44
  //     PhoenixContact_MSTBVA_2,5_2-G_1x02     13.00 x 10.01 ->  43.87 x 12.70
  //
  // The height roughly doubles because the reference sits above the part and
  // the value below it, and the WIDTH is worse still — a value string like
  // "R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal" is three times wider
  // than the part it names. Per cell that is 37 mm² of resistor becoming
  // 279 mm², so the block was laid out with seven times the area it needed and
  // the result reads as one big airy grid instead of pcbnew's tight cluster.
  //
  // The proof of the reading is in a pcbnew capture rather than in the source:
  // KiCad's own output has the value text of one part overlapping the outline
  // of the next. A box that included the text could not produce that overlap.
  const boxOf = (fp: SpreadSubject): Box => fp.box;

  // Running position of each footprint through the three passes.
  const position = new Map<SpreadSubject, Box>();
  for (const fp of footprints) position.set(fp, { ...boxOf(fp) });

  const moveTo = (fp: SpreadSubject, origin: Vec2): void => {
    const box = position.get(fp)!;
    const dx = origin.x - box.minX;
    const dy = origin.y - box.minY;
    position.set(fp, {
      minX: box.minX + dx,
      minY: box.minY + dy,
      maxX: box.maxX + dx,
      maxY: box.maxY + dy,
    });
  };
  const moveBy = (fp: SpreadSubject, delta: Vec2): void => {
    const box = position.get(fp)!;
    position.set(fp, {
      minX: box.minX + delta.x,
      minY: box.minY + delta.y,
      maxX: box.maxX + delta.x,
      maxY: box.maxY + delta.y,
    });
  };

  // Fill in the maps: sheet path -> footprint size -> footprints.
  const sheets = new Map<string, SheetGroup>();

  for (const fp of footprints) {
    // GetPath().AsString().BeforeLast( '/' ), the sheet the symbol lives on.
    const path = groupBySheet ? fp.path.slice(0, fp.path.lastIndexOf('/') + 1) : '';
    const box = boxOf(fp);
    const size = { x: boxWidth(box) + componentGap, y: boxHeight(box) + componentGap };
    const sizeKey = `${size.x},${size.y}`;

    const sheet = sheets.get(path) ?? { path, blocks: new Map(), box: null };
    const block = sheet.blocks.get(sizeKey) ?? { size, footprints: [], box: null };
    block.footprints.push(fp);
    sheet.blocks.set(sizeKey, block);
    sheets.set(path, sheet);
  }

  for (const sheet of sheets.values()) {
    // Pass 1: arrange the same-size footprints of each block into rows or columns.
    for (const block of sheet.blocks.values()) {
      const { size } = block;
      const count = block.footprints.length;

      const blockEstimateArea = size.x * size.y * count;
      const initialSide = Math.sqrt(blockEstimateArea);
      const vertical = size.x >= size.y;

      let initialCountPerLine = count;
      const singleLineRatio = 5;

      // Wrap the line if the ratio is not satisfied.
      if (vertical) {
        if ((size.y * count) / size.x > singleLineRatio)
          initialCountPerLine = Math.trunc(initialSide / size.y);
      } else {
        if ((size.x * count) / size.y > singleLineRatio)
          initialCountPerLine = Math.trunc(initialSide / size.x);
      }

      let optimalCountPerLine = Math.max(1, initialCountPerLine);
      let optimalRemainder = count % optimalCountPerLine;

      if (optimalRemainder !== 0) {
        for (
          let i = Math.max(2, initialCountPerLine - 2);
          i <= Math.min(count - 2, initialCountPerLine + 2);
          i++
        ) {
          const r = count % i;
          if (r === 0 || r >= optimalRemainder) {
            optimalCountPerLine = i;
            optimalRemainder = r;
          }
        }
      }

      block.footprints.sort(compareFootprintsByRef);

      block.box = null;
      block.footprints.forEach((fp, i) => {
        const origin = { x: Math.trunc(size.x / 2), y: Math.trunc(size.y / 2) };
        if (vertical) {
          origin.x += size.x * Math.trunc(i / optimalCountPerLine);
          origin.y += size.y * (i % optimalCountPerLine);
        } else {
          origin.x += size.x * (i % optimalCountPerLine);
          origin.y += size.y * Math.trunc(i / optimalCountPerLine);
        }

        moveTo(fp, origin);
        block.box = mergeBox(block.box, inflate(position.get(fp)!, Math.trunc(componentGap / 2)));
      });
    }

    // Pass 2: pack the blocks of this sheet against each other.
    const blocks = [...sheet.blocks.values()];
    const blockRects: RectWH[] = blocks.map((b) =>
      b.box ? { w: boxWidth(b.box), h: boxHeight(b.box) } : { w: 0, h: 0 },
    );
    const blocksArea = blockRects.reduce((sum, r) => sum + r.w * r.h, 0);
    const blockPositions = spreadRectangles(blockRects, Math.sqrt(blocksArea));

    sheet.box = null;
    blocks.forEach((block, i) => {
      if (!block.box) return;
      const target = blockPositions[i] ?? { x: 0, y: 0 };
      const delta = { x: target.x - block.box.minX, y: target.y - block.box.minY };
      for (const fp of block.footprints) {
        moveBy(fp, delta);
        sheet.box = mergeBox(sheet.box, position.get(fp)!);
      }
    });
  }

  // Pass 3: pack the sheet groups, each with a margin around it.
  const sheetList = [...sheets.values()];
  const sheetRects: RectWH[] = sheetList.map((s) => {
    if (!s.box) return { w: 0, h: 0 };
    const rect = inflate(s.box, groupGap);
    return { w: boxWidth(rect), h: boxHeight(rect) };
  });
  const sheetsArea = sheetList.reduce(
    (sum, s) => sum + (s.box ? boxWidth(s.box) * boxHeight(s.box) : 0),
    0,
  );
  const sheetPositions = spreadRectangles(sheetRects, Math.sqrt(sheetsArea));

  sheetList.forEach((sheet, i) => {
    if (!sheet.box) return;
    const target = sheetPositions[i] ?? { x: 0, y: 0 };
    const delta = {
      x: target.x + targetBoxPosition.x - sheet.box.minX,
      y: target.y + targetBoxPosition.y - sheet.box.minY,
    };
    for (const block of sheet.blocks.values()) for (const fp of block.footprints) moveBy(fp, delta);
  });

  // The net translation each footprint needs, in input order.
  return footprints.map((fp) => {
    const from = boxOf(fp);
    const to = position.get(fp)!;
    return { x: to.minX - from.minX, y: to.minY - from.minY };
  });
}
