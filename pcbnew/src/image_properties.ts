// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reading and writing a reference image's properties.
 * Counterparts: `DIALOG_REFERENCE_IMAGE_PROPERTIES` and the scale half of
 * `PANEL_IMAGE_EDITOR`.
 *
 * Headless, like the other properties modules: the dialog is layout, this is
 * the part with decisions in it.
 *
 * ## Width, height and scale are one number wearing three hats
 *
 * The dialog shows all three and lets you type in any of them, but the item
 * stores only `(scale …)`. So each field has to be able to drive the other two,
 * and upstream does it through the *current* size rather than the original
 * pixels:
 *
 *     scale' = scale × newWidth / size.x        (size.x = pixels × iuPerPixel × scale)
 *
 * which algebraically is just `newWidth / (pixels × iuPerPixel)`. Going the long
 * way round is not pointless — `size.x` is rounded to whole internal units, so
 * the two forms can differ by a nanometre, and this is the one whose answers
 * match KiCad's.
 *
 * The aspect ratio is not adjustable. Typing a width rewrites the *scale*, so
 * the height moves with it; there is no independent stretch. That is a property
 * of the model — one scale factor — not a limitation of the dialog.
 *
 * ## What the dialog cannot do
 *
 * Upstream's `PANEL_IMAGE_EDITOR` also offers **greyscale conversion**, which
 * rewrites the pixels. That is deliberately absent: our model holds the PNG
 * payload as it was read, and converting would mean decoding, recolouring and
 * re-encoding a raster — real work in a place where nothing else touches
 * pixels, for an effect a user can get before importing. Left out rather than
 * half-done.
 */
import { atom, type SList, type SNode } from '@ziroeda/sexpr/src/index.js';
import { dropChild, mm, parseBoardItemId, patchChild } from './edit-board.js';
import { imageSizeIU } from './image_geometry.js';
import type { Board, PcbImage } from './types.js';

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** Every control on the dialog, flattened. */
export interface ImageValues {
  x: number;
  y: number;
  layer: string;
  locked: boolean;
  scale: number;
  /** Derived from the scale; shown so it can be typed into. */
  width: number;
  height: number;
}

/** The single selected reference image's index, or null. */
export function imageAt(board: Board, selection: Iterable<string>): number | null {
  const ids = [...selection];
  if (ids.length !== 1) return null;
  const ref = parseBoardItemId(ids[0]!);
  if (!ref || ref.kind !== 'image') return null;
  return board.images[ref.index] ? ref.index : null;
}

/** `TransferDataToWindow`: the item's state as the dialog's fields. */
export function collectImageValues(img: PcbImage): ImageValues {
  const size = imageSizeIU(img);
  return {
    x: img.at.x,
    y: img.at.y,
    layer: img.layer,
    locked: img.locked ?? false,
    // An absent `(scale …)` is 1 — the writer omits it at 1.
    scale: img.scale ?? 1,
    width: size.w,
    height: size.h,
  };
}

/**
 * `onWidthChanged`: a typed width becomes a scale, and the height follows.
 *
 * A width of zero or less is ignored rather than clamped, as upstream does — it
 * is what you see mid-typing after clearing the field, and snapping the image
 * to nothing on the way to a real number would be worse than doing nothing.
 * The rejection happens in `sizeForScale`, which is the single gate on the
 * resulting scale; upstream needs its own `newWidth <= 0` test only because its
 * `SetScale` has none. Mutation testing showed a second test here unobservable.
 *
 * The size guard is *not* redundant, though it looks like it: an image whose
 * stored scale is zero — which a hand-edited file can say — measures zero
 * across, and dividing by that gives an infinite scale that no later test
 * rejects.
 */
export function scaleForWidth(img: PcbImage, values: ImageValues, newWidth: number): ImageValues {
  const size = imageSizeIU({ ...img, scale: values.scale });
  if (size.w <= 0) return values;
  return sizeForScale(img, values, (values.scale * newWidth) / size.w);
}

/** `onHeightChanged`, the same the other way round. */
export function scaleForHeight(img: PcbImage, values: ImageValues, newHeight: number): ImageValues {
  const size = imageSizeIU({ ...img, scale: values.scale });
  if (size.h <= 0) return values;
  return sizeForScale(img, values, (values.scale * newHeight) / size.h);
}

/**
 * `onScaleChanged`: the scale drives both size fields.
 *
 * Upstream calls `ChangeDoubleValue` for the two sizes rather than
 * `SetDoubleValue` specifically so that updating them does not fire their own
 * change handlers back — the three fields would otherwise chase each other. In
 * a single pure function that problem cannot arise, which is the point of
 * putting it here rather than in three event handlers.
 */
export function sizeForScale(img: PcbImage, values: ImageValues, newScale: number): ImageValues {
  if (newScale <= 0) return values;
  const size = imageSizeIU({ ...img, scale: newScale });
  return { ...values, scale: newScale, width: size.w, height: size.h };
}

/** `TransferDataFromWindow`: write the dialog's fields back to the board. */
export function applyImageValues(board: Board, index: number, v: ImageValues): Board {
  const img = board.images[index];
  if (!img) return board;

  const before = collectImageValues(img);
  if (JSON.stringify(before) === JSON.stringify(v)) return board;

  const next: PcbImage = {
    ...img,
    at: { x: v.x, y: v.y },
    layer: v.layer,
    locked: v.locked,
    // A scale of exactly 1 goes back to being absent, since that is how the
    // file says it: storing 1 would make an untouched image grow a token on
    // save. `dropChild` below removes it from the source node to match.
    scale: v.scale === 1 ? undefined : v.scale,
  };

  return {
    ...board,
    images: board.images.map((cur, i) =>
      i === index ? { ...next, source: patchImageSource(next, cur.source) } : cur,
    ),
  };
}

/** Rewrite the `(image …)` node's children in place. */
function patchImageSource(img: PcbImage, src: SList): SList {
  if (src.items.length === 0) return src; // built from scratch on save

  let out = patchChild(src, 'at', list(atom('at'), atom(mm(img.at.x)), atom(mm(img.at.y))));
  out = patchChild(out, 'layer', list(atom('layer'), { kind: 'string', value: img.layer }));

  out =
    img.scale === undefined
      ? dropChild(out, 'scale')
      : patchChild(out, 'scale', list(atom('scale'), atom(String(img.scale))));

  out = img.locked
    ? patchChild(out, 'locked', list(atom('locked'), atom('yes')))
    : dropChild(out, 'locked');

  return out;
}
