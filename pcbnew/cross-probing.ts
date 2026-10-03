// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * pcbnew/cross-probing.cpp's free functions: `collectItemsForSyncParts`, the
 * parts a board selection names to the schematic, and the cross-probe view
 * change and flash phases both editors share. `PCB_EDIT_FRAME`'s own halves -
 * `FindItemsFromSyncSelection`, `SendSelectItemsToSch` - are the frame's.
 */
import type { CROSS_PROBING_SETTINGS } from '@ziroeda/common/settings/app_settings.js';
import { pcbMmToIU } from '@ziroeda/common/eda_units.js';
import { escapeIpc } from '@ziroeda/common/string_utils.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { FOOTPRINT } from './footprint.js';
import type { PAD } from './pad.js';
import type { PCB_GROUP } from './pcb_group.js';

/** A view: the scale (canvas px per IU) and the world point at the canvas centre. */
export interface CrossProbeView {
  scale: number;
  cx: number;
  cy: number;
}

/** DEFAULT_TEXT_SIZE, 1.0 mm, in PCB IU — the yardstick the ratio is bent against. */
const TEXT_HEIGHT = pcbMmToIU(1.0);

/**
 * The lookup table `ZoomFitCrossProbeBBox` interpolates, mapping "how many
 * default text heights tall is this footprint" to "how much bigger than itself
 * to draw the view". A 0402 wants eight times its own height of board around
 * it; a 200-pin BGA wants none.
 */
const ZOOM_LUT: readonly (readonly [number, number])[] = [
  [1, 8],
  [1.5, 5],
  [3, 3],
  [4.5, 2.5],
  [8, 2.0],
  [12, 1.7],
  [16, 1.5],
  [24, 1.3],
  [32, 1.0],
];

/** Linear interpolation through ZOOM_LUT, flat outside its ends. */
function bendRatio(compRatio: number): number {
  const first = ZOOM_LUT[0]!;
  if (compRatio < first[0]) return first[1];
  for (let i = 0; i < ZOOM_LUT.length - 1; i++) {
    const a = ZOOM_LUT[i]!;
    const b = ZOOM_LUT[i + 1]!;
    if (a[0] <= compRatio && b[0] >= compRatio)
      return a[1] + ((b[1] - a[1]) * (compRatio - a[0])) / (b[0] - a[0]);
  }
  return ZOOM_LUT[ZOOM_LUT.length - 1]![1];
}

/**
 * `PCB_SELECTION_TOOL::ZoomFitCrossProbeBBox` — the view scale a cross-probe
 * should land on, or null to leave the zoom alone.
 *
 * It is deliberately not a zoom-to-fit. Fitting the footprint fills the screen
 * with one part and no board, which is useless for the thing cross-probing is
 * for; so the fit ratio is multiplied by a size-dependent factor that keeps some
 * circuit around it, and the zoom is skipped entirely when it would barely
 * change (`ratio` between 0.5 and 1.0), because re-zooming on every probe is
 * unbearable to watch.
 *
 * `screen` is the visible world size (canvas pixels / scale), matching
 * `view->ToWorld( GetClientSize(), false )`.
 */
export function crossProbeZoomScale(
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
  screen: { x: number; y: number },
  scale: number,
): number | null {
  const width = bbox.maxX - bbox.minX;
  if (width === 0) return null;

  // BOX2I::Inflate( n ) grows each side, so the size gains twice the delta.
  const inflate = Math.round(width * 0.2);
  const bbSize = { x: width + 2 * inflate, y: bbox.maxY - bbox.minY + 2 * inflate };
  const screenSize = { x: Math.max(10, Math.abs(screen.x)), y: Math.max(10, screen.y) };

  let ratio = Math.max(-1, Math.abs(bbSize.y / screenSize.y));
  const kicadRatio = Math.max(Math.abs(bbSize.x / screenSize.x), Math.abs(bbSize.y / screenSize.y));
  let compRatioBent = bendRatio(bbSize.y / TEXT_HEIGHT);

  // A part far wider than it is tall would be cut off at the sides by the
  // height-driven ratio, so those fall back to the plain fit.
  if (bbSize.x > screenSize.x * ratio * compRatioBent) {
    ratio = kicadRatio;
    compRatioBent = 1.0;
  }

  ratio *= compRatioBent;
  return ratio < 0.5 || ratio > 1.0 ? scale / ratio : null;
}

/**
 * Where the view should be after a cross-probe, or null to leave it alone.
 *
 * `PCB_EDIT_FRAME::ExecuteRemoteCommand` (pcbnew/cross-probing.cpp:241-247) and
 * `SCH_SELECTION_TOOL::SyncSelection` (eeschema/tools/sch_selection_tool.cpp:
 * 3515-3529) both spell the same three-step decision, and the nesting is the
 * part that is easy to get wrong:
 *
 *   - a zero-area bounding box has nothing to aim at, so nothing moves;
 *   - `center_on_items` off means the view does not move *at all* — the zoom is
 *     not touched either, because `zoom_to_fit` sits *inside* the
 *     `center_on_items` branch ("ignored if center_on_items is off", per the
 *     struct's own comment at include/settings/app_settings.h:36);
 *   - with `center_on_items` on, `zoom_to_fit` decides only whether the scale
 *     changes; the centring (`FocusOnLocation`) runs either way.
 *
 * `view` is the current scale and the world point at the middle of the canvas;
 * `canvas` is its pixel size. The zoom is computed first and the centring is
 * evaluated against the *new* scale, as upstream does — `ZoomFitCrossProbeBBox`
 * calls `SetScale` before `FocusOnLocation` reads the viewport.
 */
export function crossProbeViewChange(
  cfg: CROSS_PROBING_SETTINGS,
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null,
  view: CrossProbeView,
  canvas: { width: number; height: number },
  /**
   * The frame's own `ZoomFitCrossProbeBBox`. Upstream keeps TWO of these — the
   * DECISION below is identical in both frames, but the LUT they interpolate is
   * not (`sch_selection_tool.cpp:3391-3397` against pcbnew's), so the table is
   * the caller's and the nesting is shared.
   */
  zoomScale: (
    bbox: { minX: number; minY: number; maxX: number; maxY: number },
    screen: { x: number; y: number },
    scale: number,
  ) => number | null = crossProbeZoomScale,
): CrossProbeView | null {
  // `bbox.GetWidth() != 0 && bbox.GetHeight() != 0`.
  if (!bbox || bbox.maxX <= bbox.minX || bbox.maxY <= bbox.minY) return null;
  if (!cfg.center_on_items) return null;

  const scale = cfg.zoom_to_fit
    ? (zoomScale(
        bbox,
        // `GetViewport().GetSize()` is the visible rect in WORLD units, not
        // pixels — the ratio it feeds is world-over-world.
        { x: canvas.width / view.scale, y: canvas.height / view.scale },
        view.scale,
      ) ?? view.scale)
    : view.scale;

  // EDA_DRAW_FRAME::FocusOnLocation: centre only when the target is outside the
  // viewport, which is first shrunk by a tenth of its *width* on both axes, as
  // `r.Inflate( -r.GetWidth() / 10 )` does — so a probe onto something already
  // on screen leaves the view where the user put it.
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  const halfW = canvas.width / scale / 2;
  const halfH = canvas.height / scale / 2;
  const inset = halfW * 0.2;
  const outside = Math.abs(cx - view.cx) > halfW - inset || Math.abs(cy - view.cy) > halfH - inset;

  return { scale, cx: outside ? cx : view.cx, cy: outside ? cy : view.cy };
}

/** `m_crossProbeFlashTimer.Start( 500, ... )` (pcbnew/pcb_edit_frame.cpp:677). */
export const CROSS_PROBE_FLASH_INTERVAL_MS = 500;

/**
 * The last phase the timer runs: `if( m_crossProbeFlashPhase > 6 )` stops it
 * (pcbnew/pcb_edit_frame.cpp:752), so phases 0..6 fire — six visible toggles
 * over three seconds, which is the "flash 3 times" the tooltip promises.
 */
export const CROSS_PROBE_FLASH_LAST_PHASE = 6;

/**
 * The selection to show at flash phase `phase`
 * (`PCB_EDIT_FRAME::OnCrossProbeFlashTimer`, pcbnew/pcb_edit_frame.cpp:722-738).
 *
 * Even phases clear the selection, odd phases put it back; the run ends on an
 * odd count so the items are left selected. Upstream flashes by hiding and
 * restoring the *selection*, not by tinting the items, which is why this is a
 * set of ids rather than a render flag.
 */
export function crossProbeFlashSelection(phase: number, ids: readonly string[]): readonly string[] {
  if (phase > CROSS_PROBE_FLASH_LAST_PHASE) return ids;
  return phase % 2 === 0 ? [] : ids;
}

/**
 * `collectItemsForSyncParts` (pcbnew/cross-probing.cpp:305-345): the `$SELECT:`
 * parts naming `aItems` - `F<reference>` a footprint, `P<reference>/<pad>` a
 * pad - with a group walked into its members. `aParts` is a `std::set`: each
 * part once, and read back sorted.
 */
export function collectItemsForSyncParts(aItems: Iterable<EDA_ITEM>, aParts: Set<string>): void {
  for (const item of aItems) {
    switch (item.Type()) {
      case KICAD_T.PCB_GROUP_T: {
        const group = item as unknown as PCB_GROUP;

        collectItemsForSyncParts(group.GetItems(), aParts);
        break;
      }
      case KICAD_T.PCB_FOOTPRINT_T: {
        const footprint = item as unknown as FOOTPRINT;
        const ref = footprint.GetReference();

        aParts.add(`F${escapeIpc(ref)}`);
        break;
      }

      case KICAD_T.PCB_PAD_T: {
        const pad = item as unknown as PAD;
        const ref = pad.GetParentFootprint()!.GetReference();

        aParts.add(`P${escapeIpc(ref)}/${escapeIpc(pad.GetNumber())}`);
        break;
      }

      default:
        break;
    }
  }
}

/** A `std::set<wxString>`'s iteration order: by code point. */
export function sortedSyncParts(aParts: ReadonlySet<string>): string[] {
  return [...aParts].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
