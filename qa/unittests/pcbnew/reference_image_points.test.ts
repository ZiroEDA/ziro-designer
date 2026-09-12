// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A reference image's five edit handles, and what dragging each one does.
 * Counterpart: `REFERENCE_IMAGE_POINT_EDIT_BEHAVIOR` (`pcb_point_editor.cpp`).
 *
 * The point editor's own header used to say reference images were "not covered
 * … none of which we model", and by the time it said so we did model them:
 * `PcbImage` carries the scale and the transform offset that behaviour needs.
 * So a selected image had no handles at all — the manual describes five, and
 * the four corners are the only way to scale one by dragging.
 *
 * The arithmetic is worth stating because none of it is obvious:
 *
 *  - the fifth point is the transform ORIGIN, and upstream reuses the rectangle
 *    centre's slot for it (`REFIMG_ORIGIN = RECT_CENTER`) because an image has
 *    no centre handle to collide with;
 *  - dragging a corner does not resize the box, it SCALES the image about that
 *    origin — one ratio for both axes, which is what keeps the aspect the
 *    manual promises ("The proportions of the image are always maintained");
 *  - dragging a corner through the origin would turn the picture inside out, so
 *    the vector is clamped to zero and the minimum size takes over.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  boardEditHandles,
  dragBoardHandle,
  editablePointItems,
} from '@ziroeda/pcbnew/src/point_editor.js';
import { imageBBox } from '@ziroeda/pcbnew/src/image_geometry.js';
import { boardItemId } from '@ziroeda/pcbnew/src/edit-board.js';
import type { Board, PcbImage } from '@ziroeda/pcbnew/src/types.js';

/**
 * A 2x2 red PNG, so `pngPixelSize` has something real to read.
 *
 * Two pixels at the 300 ppi `BITMAP_BASE` falls back to is 0.169 mm across, so
 * every fixture below carries a scale that puts the box comfortably over the
 * 50-mil floor. Without one the clamp is the only thing the drag does, and a
 * test of the RATIO measures the clamp instead — which is how the first draft
 * of this file "found" a ratio of 7.5 where it expected 2.
 */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAF0lEQVQI12P8z8DAwMDAxMDAwMDAAAAOEwEBs1TRTQAAAABJRU5ErkJggg==';

const image = (over: Partial<PcbImage> = {}): PcbImage => ({
  at: { x: 100_000_000, y: 50_000_000 },
  layer: 'F.SilkS',
  data: PNG,
  ...over,
});

const boardWith = (img: PcbImage): Board =>
  ({
    tracks: [],
    arcs: [],
    shapes: [],
    zones: [],
    dimensions: [],
    images: [img],
    texts: [],
    textBoxes: [],
    tables: [],
    barcodes: [],
    footprints: [],
    vias: [],
    pads: [],
    layers: [],
  }) as unknown as Board;

const ID = boardItemId('image', 0);

describe('the five points MakePoints makes', () => {
  const board = boardWith(image());
  const handles = boardEditHandles(board, ID);
  const box = imageBBox(board.images[0]!);

  it('is four corners and the transform origin, in upstream’s order', () => {
    expect(handles).toHaveLength(5);
    expect(handles.map((h) => h.at)).toEqual([
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
      // `refImage.GetPosition() + refImage.GetTransformOriginOffset()`, and the
      // offset starts at nothing, so it begins at the centre — which is what
      // the manual means by "It is initially located in the center of the
      // image, so the image scales equally in all directions from its center."
      { x: board.images[0]!.at.x, y: board.images[0]!.at.y },
    ]);
  });

  it('puts the origin where the offset says once it has one', () => {
    const moved = boardWith(image({ transformOffset: { x: 3_000_000, y: -2_000_000 } }));
    expect(boardEditHandles(moved, ID)[4]?.at).toEqual({ x: 103_000_000, y: 48_000_000 });
  });

  it('is offered for a whole board, so the editor finds images at all', () => {
    expect(editablePointItems(board)).toContain(ID);
  });
});

describe('dragging the origin moves only the origin', () => {
  it('stores the offset from the box’s own centre, and no scale changes', () => {
    // "As the other points didn't move, we can get the image extent from them":
    // the new offset is measured against `( topLeft + botRight ) / 2`.
    const board = boardWith(image());
    const origin = boardEditHandles(board, ID)[4]!;
    const next = dragBoardHandle(board, ID, origin, { x: 104_000_000, y: 51_000_000 });
    expect(next.images[0]?.transformOffset).toEqual({ x: 4_000_000, y: 1_000_000 });
    expect(next.images[0]?.scale).toBe(board.images[0]?.scale);
  });
});

describe('dragging a corner scales about the origin', () => {
  const board = boardWith(image({ scale: 20 }));
  const box = imageBBox(board.images[0]!);

  it('takes the ratio of the two distances from the origin', () => {
    // The origin is the centre here, so a corner dragged to twice its distance
    // doubles the scale — one ratio, both axes.
    const corner = boardEditHandles(board, ID)[2]!; // bottom right
    const at = board.images[0]!.at;
    const twice = { x: at.x + (box.maxX - at.x) * 2, y: at.y + (box.maxY - at.y) * 2 };
    const next = dragBoardHandle(board, ID, corner, twice);
    // Not exact, and it should not be: `imageBBox` rounds the box to whole
    // nanometres, so the corner the drag starts from is already quantised and
    // the ratio inherits that. Upstream's is integer arithmetic throughout and
    // loses the same fraction.
    expect(next.images[0]?.scale).toBeCloseTo(40, 3);
  });

  it('keeps the aspect ratio whatever the drag does to it', () => {
    // Drag the corner far out on X only: upstream still uses ONE ratio, taken
    // from the euclidean lengths, so the picture cannot be stretched.
    const corner = boardEditHandles(board, ID)[2]!;
    const at = board.images[0]!.at;
    const next = dragBoardHandle(board, ID, corner, { x: at.x + 40_000_000, y: box.maxY });
    const after = imageBBox(next.images[0]!);
    const before = { w: box.maxX - box.minX, h: box.maxY - box.minY };
    expect((after.maxX - after.minX) / (after.maxY - after.minY)).toBeCloseTo(
      before.w / before.h,
      6,
    );
  });

  it('will not let a corner cross the origin and turn it inside out', () => {
    // `if( sign( newCorner->x ) != sign( oldCorner.x ) || … ) *newCorner = 0`,
    // and then the 50-mil floor is what the image lands on.
    const corner = boardEditHandles(board, ID)[2]!;
    const at = board.images[0]!.at;
    const next = dragBoardHandle(board, ID, corner, { x: at.x - 10_000_000, y: at.y - 10_000_000 });
    const after = imageBBox(next.images[0]!);
    // It lands ON the floor, and that is the whole assertion: without the
    // clamp the vector keeps its LENGTH — a corner dragged 10 mm past the
    // origin is further away than it started, so the picture would balloon
    // instead of collapsing. "Positive and non-zero" was true either way, which
    // is how this test first passed against a build with the clamp deleted.
    expect(after.maxX - after.minX).toBeCloseTo(1_270_000, -3);
    expect(after.maxY - after.minY).toBeLessThanOrEqual(1_270_001);
  });

  it('clamps to 50 mils per axis, which is 1.27 mm in board IU', () => {
    // `std::max( newSize.x, EDA_UNIT_UTILS::Mils2IU( pcbIUScale, 50 ) )` on both
    // axes, then the SMALLER ratio wins so neither can go under it.
    const corner = boardEditHandles(board, ID)[2]!;
    const at = board.images[0]!.at;
    const next = dragBoardHandle(board, ID, corner, { x: at.x + 1, y: at.y + 1 });
    const after = imageBBox(next.images[0]!);
    expect(Math.max(after.maxX - after.minX, after.maxY - after.minY)).toBeGreaterThanOrEqual(
      1_270_000,
    );
  });
});

describe('and the canvas draws what a selected or half-placed image needs', () => {
  const EDITOR = readFileSync(
    fileURLToPath(new URL('../../../designer/src/editors/pcb/PcbEditor.tsx', import.meta.url)),
    'utf8',
  );
  const RENDER = readFileSync(
    fileURLToPath(new URL('../../../designer/src/editors/pcb/renderBoard.ts', import.meta.url)),
    'utf8',
  );

  it('dims a placed image by the image opacity, as the painter does', () => {
    // `color.a *= m_imageOpacity` (`pcb_painter.cpp:578`). Appearance > Objects
    // has had the slider all along and `DEFAULT_OPACITY.images` has been 0.6;
    // the value simply never reached the renderer, so every reference image
    // painted at full strength over the board it is meant to sit under.
    expect(RENDER).toContain('imageOpacity: number;');
    expect(RENDER).toContain('opts.imageOpacity * la');
    expect(EDITOR).toContain('imageOpacity: opacity.images,');
  });

  it('previews the PICTURE while it rides the cursor, not a rectangle', () => {
    // `m_view->AddToPreview( image, false )` puts the item itself in the view,
    // so what follows the cursor is the image. This drew a bare outline, which
    // is why nothing appeared until the click committed it.
    expect(EDITOR).toContain('imageCacheRef.current.ensure(live.data, requestDraw)');
    expect(EDITOR).toMatch(/ctx\.globalAlpha = opacity\.images;\s*\n\s*ctx\.drawImage\(bitmap,/);
  });

  it('boxes a selected one in LAYER_ANCHOR, which is what selection means here', () => {
    // A raster has no stroke to brighten, so `draw( PCB_REFERENCE_IMAGE )` draws
    // a bounding box instead — the one item whose selection is not "repaint it
    // brightened".
    expect(EDITOR).toContain('drawOpts.theme?.special.anchor');
  });
});

describe('the two ways a picture failed to appear at all', () => {
  const EDITOR = readFileSync(
    fileURLToPath(new URL('../../../designer/src/editors/pcb/PcbEditor.tsx', import.meta.url)),
    'utf8',
  );

  it('a finished decode dirties the raster, not just the blit', () => {
    // The image pass draws into an offscreen canvas that `draw()` blits, and
    // the pass running while a payload is still decoding draws the fallback
    // OUTLINE. `startCrispRender`'s guard is
    // `viewMatchesCache() && !sceneDirtyRef.current`, so on a freshly loaded
    // board — view unmoved, scene clean — a bare `requestDraw` re-blits that
    // outline for ever. A red rectangle where the picture should be, until you
    // nudged the item and dirtied the scene by accident.
    const cb = EDITOR.slice(
      EDITOR.indexOf('imageCacheRef.current.ensure(img.data'),
      EDITOR.indexOf('const steps = buildDrawSteps'),
    );
    expect(cb).toContain('sceneDirtyRef.current = true;');
  });

  it('the handles effect reads the board it depends on, not the ref', () => {
    // An effect keyed on `board` that read `boardRef.current` could compute
    // handles from a different board than the one it woke for, and
    // `boardEditHandles` answers `[]` for an index that board has not got —
    // no handles until something else re-ran it.
    const fx = EDITOR.slice(
      EDITOR.indexOf('// PCB_POINT_EDITOR shows its points for a *single* selected item'),
      EDITOR.indexOf('}, [selection, board]);'),
    );
    expect(fx).toContain('const brd = board ?? boardRef.current;');
  });
});
