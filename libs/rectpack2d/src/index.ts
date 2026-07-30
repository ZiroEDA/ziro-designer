// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Rectangle bin packing. Counterpart: `thirdparty/rectpack2d/rectpack2d/`
 * (rect_structs.h, insert_and_split.h, empty_spaces.h, best_bin_finder.h,
 * finders_interface.h), the header-only library KiCad vendors and uses to spread
 * footprints and to pack Gerber/plot page layouts.
 *
 * The algorithm is the "empty spaces" splitting packer: the bin starts as one free
 * rectangle; inserting an image takes the most recently created free space that
 * fits, places the image in its top-left corner and splits what is left into one
 * tiny and one large space (which leaves better openings for later rectangles than
 * two medium ones would). `findBestPacking` then binary-searches for the smallest
 * square bin that still takes every rectangle, trying several input orderings and
 * keeping whichever produced the smallest bin.
 */

export interface RectWH {
  w: number;
  h: number;
}

/** rect_xywh, also `space_rect`, the free-space rectangle type. */
export interface RectXYWH {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const area = (r: RectWH | RectXYWH): number => r.w * r.h;
export const perimeter = (r: RectWH | RectXYWH): number => 2 * r.w + 2 * r.h;
const maxSide = (r: RectWH): number => (r.h > r.w ? r.h : r.w);
const minSide = (r: RectWH): number => (r.h < r.w ? r.h : r.w);
const pathologicalMult = (r: RectWH): number => (maxSide(r) / minSide(r)) * area(r);

/** created_splits, the free spaces left after an insertion; null means "did not fit". */
type CreatedSplits = RectXYWH[] | null;

/**
 * insert_and_split, place `im` in the top-left of space `sp` and return the spaces
 * left over, or null when the image does not fit.
 */
function insertAndSplit(im: RectWH, sp: RectXYWH): CreatedSplits {
  const freeW = sp.w - im.w;
  const freeH = sp.h - im.h;

  // The image is bigger than the candidate empty space; look further.
  if (freeW < 0 || freeH < 0) return null;

  // The image fits exactly: delete the space and create no splits.
  if (freeW === 0 && freeH === 0) return [];

  // Exactly one dimension matches: delete the space and create a single split.
  if (freeW > 0 && freeH === 0) return [{ x: sp.x + im.w, y: sp.y, w: freeW, h: sp.h }];
  if (freeW === 0 && freeH > 0) return [{ x: sp.x, y: sp.y + im.h, w: sp.w, h: freeH }];

  // Strictly smaller in both dimensions. Split along the axis with more room left,
  // which gives one tiny and one huge space rather than two medium ones.
  if (freeW > freeH) {
    return [
      { x: sp.x + im.w, y: sp.y, w: freeW, h: sp.h }, // bigger split
      { x: sp.x, y: sp.y + im.h, w: im.w, h: freeH }, // lesser split
    ];
  }

  return [
    { x: sp.x, y: sp.y + im.h, w: sp.w, h: freeH }, // bigger split
    { x: sp.x + im.w, y: sp.y, w: freeW, h: im.h }, // lesser split
  ];
}

/**
 * empty_spaces with default_empty_spaces, the bin being packed. Flipping is not
 * ported: every KiCad caller passes `flipping_option::DISABLED`.
 */
export class EMPTY_SPACES {
  private spaces: RectXYWH[] = [];
  private currentAabb: RectWH = { w: 0, h: 0 };

  constructor(bin: RectWH = { w: 0, h: 0 }) {
    this.reset(bin);
  }

  reset(bin: RectWH): void {
    this.currentAabb = { w: 0, h: 0 };
    this.spaces = [{ x: 0, y: 0, w: bin.w, h: bin.h }];
  }

  /** Insert one rectangle, returning where it landed, or null when it did not fit. */
  insert(imageRectangle: RectWH): RectXYWH | null {
    // Newest space first: `default_empty_spaces::remove` swaps in the last element,
    // so iterating downwards visits the most recently created spaces first.
    for (let i = this.spaces.length - 1; i >= 0; --i) {
      const candidate = this.spaces[i]!;
      const splits = insertAndSplit(imageRectangle, candidate);
      if (!splits) continue;

      // remove(i): swap the last space into i, then pop.
      this.spaces[i] = this.spaces[this.spaces.length - 1]!;
      this.spaces.pop();
      for (const split of splits) this.spaces.push(split);

      const result: RectXYWH = {
        x: candidate.x,
        y: candidate.y,
        w: imageRectangle.w,
        h: imageRectangle.h,
      };

      // rect_wh::expand_with.
      this.currentAabb = {
        w: Math.max(this.currentAabb.w, result.x + result.w),
        h: Math.max(this.currentAabb.h, result.y + result.h),
      };

      return result;
    }

    return null;
  }

  getRectsAabb(): RectWH {
    return { ...this.currentAabb };
  }
}

/** bin_dimension, which side(s) the bin search shrinks. */
enum BinDimension {
  BOTH = 0,
  WIDTH = 1,
  HEIGHT = 2,
}

/** A failed packing reports the total area it did manage to insert. */
type PackingResult = { ok: true; bin: RectWH } | { ok: false; totalInsertedArea: number };

/**
 * best_packing_for_ordering_impl, binary-search viable bin sizes from
 * `startingBin` downwards. Stops when a bin took every rectangle and the next size
 * to try differs by less than `discardStep`.
 */
function bestPackingForOrderingImpl(
  root: EMPTY_SPACES,
  ordering: readonly RectWH[],
  startingBin: RectWH,
  discardStep: number,
  triedDimension: BinDimension,
): PackingResult {
  const candidateBin: RectWH = { ...startingBin };
  let triesBeforeDiscarding = 0;
  let step = 0;

  if (discardStep <= 0) {
    triesBeforeDiscarding = -discardStep;
    discardStep = 1;
  }

  if (triedDimension === BinDimension.BOTH) {
    candidateBin.w = Math.trunc(candidateBin.w / 2);
    candidateBin.h = Math.trunc(candidateBin.h / 2);
    step = Math.trunc(candidateBin.w / 2);
  } else if (triedDimension === BinDimension.WIDTH) {
    candidateBin.w = Math.trunc(candidateBin.w / 2);
    step = Math.trunc(candidateBin.w / 2);
  } else {
    candidateBin.h = Math.trunc(candidateBin.h / 2);
    step = Math.trunc(candidateBin.h / 2);
  }

  for (;;) {
    root.reset(candidateBin);

    let totalInsertedArea = 0;
    let allInserted = true;

    for (const rect of ordering) {
      if (root.insert(rect)) {
        totalInsertedArea += area(rect);
      } else {
        allInserted = false;
        break;
      }
    }

    if (allInserted) {
      // Attempt was successful. Try with a smaller bin.
      if (step <= discardStep) {
        if (triesBeforeDiscarding > 0) triesBeforeDiscarding--;
        else return { ok: true, bin: { ...candidateBin } };
      }

      if (triedDimension === BinDimension.BOTH) {
        candidateBin.w -= step;
        candidateBin.h -= step;
      } else if (triedDimension === BinDimension.WIDTH) {
        candidateBin.w -= step;
      } else {
        candidateBin.h -= step;
      }

      root.reset(candidateBin);
    } else {
      // Attempt ended with failure. Try with a bigger bin.
      if (triedDimension === BinDimension.BOTH) {
        candidateBin.w += step;
        candidateBin.h += step;
        if (area(candidateBin) > area(startingBin)) return { ok: false, totalInsertedArea };
      } else if (triedDimension === BinDimension.WIDTH) {
        candidateBin.w += step;
        if (candidateBin.w > startingBin.w) return { ok: false, totalInsertedArea };
      } else {
        candidateBin.h += step;
        if (candidateBin.h > startingBin.h) return { ok: false, totalInsertedArea };
      }
    }

    step = Math.max(1, Math.trunc(step / 2));
  }
}

/** best_packing_for_ordering, search both dimensions, then refine each on its own. */
function bestPackingForOrdering(
  root: EMPTY_SPACES,
  ordering: readonly RectWH[],
  startingBin: RectWH,
  discardStep: number,
): PackingResult {
  const best = bestPackingForOrderingImpl(
    root,
    ordering,
    startingBin,
    discardStep,
    BinDimension.BOTH,
  );
  if (!best.ok) return best;

  let bestBin = best.bin;
  for (const dimension of [BinDimension.WIDTH, BinDimension.HEIGHT]) {
    const trial = bestPackingForOrderingImpl(root, ordering, bestBin, discardStep, dimension);
    if (trial.ok) bestBin = trial.bin;
  }

  return { ok: true, bin: bestBin };
}

/** callback_result, a report callback can stop the final placement pass. */
export enum CallbackResult {
  ABORT_PACKING = 0,
  CONTINUE_PACKING = 1,
}

export interface FinderInput {
  maxBinSide: number;
  discardStep: number;
  handleSuccessfulInsertion?: (rect: RectXYWH, index: number) => CallbackResult;
  handleUnsuccessfulInsertion?: (rect: RectWH, index: number) => CallbackResult;
}

export interface PackedRect extends RectXYWH {
  /** Index into the `subjects` array this rectangle came from. */
  index: number;
}

export interface FindBestPackingResult {
  /** The bounding box of the packed rectangles, or null when nothing was packed. */
  aabb: RectWH | null;
  /** Where each subject landed, indexed as in `subjects`; null when it did not fit. */
  placements: (PackedRect | null)[];
}

/**
 * The default orderings find_best_packing tries: by area, perimeter, longest side,
 * width, height, and the "pathological multiplier" (aspect ratio times area).
 */
const DEFAULT_COMPARATORS: ((a: RectWH, b: RectWH) => number)[] = [
  (a, b) => area(b) - area(a),
  (a, b) => perimeter(b) - perimeter(a),
  (a, b) => maxSide(b) - maxSide(a),
  (a, b) => b.w - a.w,
  (a, b) => b.h - a.h,
  (a, b) => pathologicalMult(b) - pathologicalMult(a),
];

/**
 * find_best_packing, pack `subjects` into the smallest square bin that fits them,
 * trying every default ordering and keeping the best. Zero-area rectangles are
 * skipped, as upstream does.
 */
export function findBestPacking(
  subjects: readonly RectWH[],
  input: FinderInput,
  comparators: ((a: RectWH, b: RectWH) => number)[] = DEFAULT_COMPARATORS,
): FindBestPackingResult {
  const maxBin: RectWH = { w: input.maxBinSide, h: input.maxBinSide };
  const placements: (PackedRect | null)[] = subjects.map(() => null);

  const indices = subjects.map((_, i) => i).filter((i) => area(subjects[i]!) > 0);
  if (indices.length === 0) return { aabb: null, placements };

  const root = new EMPTY_SPACES();
  let bestOrder: number[] | null = null;
  let bestTotalInserted = -1;
  let bestBin = maxBin;

  for (const comparator of comparators) {
    const order = [...indices].sort((a, b) => comparator(subjects[a]!, subjects[b]!));
    const packing = bestPackingForOrdering(
      root,
      order.map((i) => subjects[i]!),
      maxBin,
      input.discardStep,
    );

    if (!packing.ok) {
      // Track which ordering inserts the most area, in case every one of them fails
      // to fit into the largest allowed bin.
      if (bestOrder === null && packing.totalInsertedArea > bestTotalInserted) {
        bestOrder = order;
        bestTotalInserted = packing.totalInsertedArea;
      }
    } else if (area(packing.bin) <= area(bestBin)) {
      bestOrder = order;
      bestBin = packing.bin;
    }
  }

  if (!bestOrder) return { aabb: null, placements };

  root.reset(bestBin);

  for (const index of bestOrder) {
    const subject = subjects[index]!;
    const placed = root.insert(subject);

    if (placed) {
      const rect: PackedRect = { ...placed, index };
      placements[index] = rect;
      if (input.handleSuccessfulInsertion?.(rect, index) === CallbackResult.ABORT_PACKING) break;
    } else if (
      input.handleUnsuccessfulInsertion?.(subject, index) === CallbackResult.ABORT_PACKING
    ) {
      break;
    }
  }

  return { aabb: root.getRectsAabb(), placements };
}
