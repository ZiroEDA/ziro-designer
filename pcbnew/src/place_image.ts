// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Placing a reference image.
 * Counterpart: `DRAWING_TOOL::PlaceReferenceImage`.
 *
 * ## Two clicks with a file picker between them
 *
 * The first click opens a file dialog; the picture then rides the cursor as a
 * preview until a second click drops it. That middle step is the reason this
 * tool cannot be a two-point drag like the other drawing tools: between the
 * clicks there is a modal the user can cancel, and cancelling has to leave the
 * tool armed rather than half-placed.
 *
 * So the state machine has three states, not two: `awaiting-file` before
 * anything is chosen, `placing` while the image follows the cursor, and the
 * commit that ends it. Upstream expresses the same thing with a nullable
 * `image` pointer and a `while( Wait() )` loop.
 *
 * ## Escape means two different things
 *
 * With an image on the cursor, Escape throws *that image* away and leaves the
 * tool running, ready for another file. With no image, Escape ends the tool.
 * Upstream's `cleanup()` / `PopTool` split is exactly this, and getting it
 * backwards is the difference between "I picked the wrong file" costing one
 * keystroke and costing a re-activation.
 *
 * (Upstream's `immediateMode` — the tool invoked with an image already in hand,
 * from a paste or a drag-and-drop — ends the tool on either branch. We have no
 * caller that supplies one, so there is nothing here to model it with; the
 * entry point simply always starts empty.)
 *
 * ## The picture is centred on the cursor
 *
 * `PCB_REFERENCE_IMAGE`'s position is the middle of the image, so the preview
 * and the committed item both sit centred under the cursor rather than hanging
 * down and right of it. `imageBBox` already builds boxes that way; this is the
 * placement half of the same convention.
 */
import type { PcbImage } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** Where the tool is between clicks. */
export type ImagePlaceStep = 'awaiting-file' | 'placing';

export interface ImagePlaceState {
  step: ImagePlaceStep;
  /** The image riding the cursor; absent until a file has been chosen. */
  image?: PcbImage;
}

/** `PlaceReferenceImage` before its first click: armed, holding nothing. */
export function startPlaceImage(): ImagePlaceState {
  return { step: 'awaiting-file' };
}

/**
 * A fresh `PCB_REFERENCE_IMAGE` on the active layer at the cursor.
 *
 * `scale` is deliberately left off rather than set to 1: the writer omits a
 * scale of 1, so storing one would make a round-trip add a token KiCad never
 * writes. Same reasoning as the model's.
 */
export function newReferenceImage(data: string, at: Vec2, layer: string): PcbImage {
  return { at, layer, data, source: { kind: 'list', items: [] } };
}

/**
 * The file dialog came back with a PNG: the image starts following the cursor.
 *
 * Upstream also handles the dialog being cancelled, by `continue`-ing the event
 * loop — here that is simply not calling this, which is why there is no
 * cancelled branch to model.
 */
export function fileChosen(
  state: ImagePlaceState,
  data: string,
  at: Vec2,
  layer: string,
): ImagePlaceState {
  if (state.step !== 'awaiting-file') return state;
  return { step: 'placing', image: newReferenceImage(data, at, layer) };
}

/**
 * The preview follows the cursor; before a file is chosen there is nothing to move.
 *
 * `DRAWING_TOOL::PlaceReferenceImage` (pcbnew/tools/drawing_tool.cpp:845), where
 * a mouse motion does `image->SetPosition( cursorPos )` -- an absolute position
 * on a tool's preview item, not a translation of a committed one. eeschema's
 * same-named `moveImage` (eeschema/src/tools/move.ts) is `SCH_BITMAP::Move`,
 * which offsets a placed item. Only the name is shared.
 */
export function moveImage(state: ImagePlaceState, at: Vec2): ImagePlaceState {
  if (state.step !== 'placing' || !state.image) return state;
  return { ...state, image: { ...state.image, at } };
}

/**
 * The second click. Returns the image to commit and the state the tool carries
 * on in — armed again, since upstream stays in the tool for a second image.
 */
export function clickImage(
  state: ImagePlaceState,
  at: Vec2,
): { state: ImagePlaceState; commit?: PcbImage } {
  if (state.step !== 'placing' || !state.image) return { state };
  return { state: startPlaceImage(), commit: { ...state.image, at } };
}

/**
 * Escape. Discards the image on the cursor if there is one and stays armed;
 * otherwise reports that the tool itself should end.
 */
export function cancelPlaceImage(state: ImagePlaceState): {
  state: ImagePlaceState;
  exitTool: boolean;
} {
  if (state.step === 'placing') return { state: startPlaceImage(), exitTool: false };
  return { state, exitTool: true };
}
