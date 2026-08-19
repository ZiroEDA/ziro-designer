// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The board half of Select on PCB, `PCB_EDIT_FRAME::FindItemsFromSyncSelection`
 * (pcbnew/cross-probing.cpp:481).
 *
 * It reads back the parts `syncSelectionParts` builds and answers with the board
 * items they name. Three rules, none of them guessable from the outside:
 *
 *   - `F<ref>` is an *exact* match on the footprint's reference, escaped the
 *     same way, so a reference containing a comma still matches.
 *   - `S<path>` is a **prefix** match against the footprint's sheet path — which
 *     is the whole reason selecting a sheet selects everything on its subsheets
 *     as well, without anyone having to walk the hierarchy.
 *   - `P<ref>/<pad>` reaches a single pad, and selects the pad rather than the
 *     footprint it belongs to.
 *
 * The result keeps the *parts'* order, not the board's: upstream pairs each hit
 * with the index of the part that found it and sorts on that, because the first
 * item is the one the view gets centred on and it has to be the one the user's
 * selection started from.
 */
import type { CrossProbingSettings } from '@ziroeda/common/src/cross_probing_settings.js';
import { pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import { escapeIpc } from '@ziroeda/common/src/string_utils.js';
import { boardItemId } from './edit-board.js';
import type { Board } from './types.js';

/** A view: the scale (canvas px per IU) and the world point at the canvas centre. */
export interface CrossProbeView {
  scale: number;
  cx: number;
  cy: number;
}

/** A footprint's sheet path, `GetPath().AsString().BeforeLast( '/' )`. */
function sheetPathOf(path: string | undefined): string {
  const at = (path ?? '').lastIndexOf('/');
  const prefix = at === -1 ? '' : (path ?? '').slice(0, at);
  // An empty prefix means a footprint straight off the root sheet; upstream
  // rewrites it to "/" so a root-sheet part can still prefix-match it.
  return prefix === '' ? '/' : prefix;
}

/**
 * The board items `parts` names, as `boardItemId` strings, in the order the
 * parts gave them.
 *
 * Unknown part letters are ignored (`default: break`), so a packet from a newer
 * schematic selects what it can rather than nothing at all.
 */
export function findItemsFromSyncSelection(board: Board, parts: readonly string[]): string[] {
  const hits: { order: number; id: string }[] = [];

  board.footprints.forEach((fp, fi) => {
    const fpSheetPath = sheetPathOf(fp.path);
    // References are compared in their escaped form, as the parts carry them;
    // `escapeIpc` is injective, so this is the same test as unescaping both.
    const ref = escapeIpc(fp.reference ?? '');

    parts.forEach((part, order) => {
      if (part === '') return;
      const data = part.slice(1);

      switch (part[0]) {
        case 'S':
          if (fpSheetPath.startsWith(data)) hits.push({ order, id: boardItemId('footprint', fi) });
          break;
        case 'F':
          if (data === ref) hits.push({ order, id: boardItemId('footprint', fi) });
          break;
        case 'P': {
          // `<ref>/<pad>`: the reference first, so the slash inside it is the
          // separator and any slash of its own arrives escaped.
          if (!data.startsWith(ref)) break;
          const pad = unescapeIpc(data.slice(ref.length + 1));
          fp.pads.forEach((p, pi) => {
            if (p.number === pad) hits.push({ order, id: boardItemId('pad', fi, pi) });
          });
          break;
        }
        default:
          break;
      }
    });
  });

  hits.sort((a, b) => a.order - b.order);
  // One part can name a pad of a footprint another part already selected; the
  // ids are what the caller sets as the selection, so they have to be unique.
  return [...new Set(hits.map((h) => h.id))];
}

/** The three CTX_IPC escapes, undone. */
function unescapeIpc(source: string): string {
  return source.replaceAll('{slash}', '/').replaceAll('{comma}', ',').replaceAll('{dblquote}', '"');
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
  cfg: CrossProbingSettings,
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null,
  view: CrossProbeView,
  canvas: { width: number; height: number },
): CrossProbeView | null {
  // `bbox.GetWidth() != 0 && bbox.GetHeight() != 0`.
  if (!bbox || bbox.maxX <= bbox.minX || bbox.maxY <= bbox.minY) return null;
  if (!cfg.center_on_items) return null;

  const scale = cfg.zoom_to_fit
    ? (crossProbeZoomScale(
        bbox,
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
 * The board items a `$SELECT:` packet should select, or null when the packet is
 * refused and the selection must be left exactly as the user left it.
 *
 * `case MAIL_SELECTION: if( !...on_selection ) break;` (pcbnew/cross-probing.cpp:
 * 733-736). The check sits on `MAIL_SELECTION` alone and `MAIL_SELECTION_FORCE`
 * falls in below it, so a forced probe — the one the cross-probe menu commands
 * issue explicitly — is not subject to the preference.
 */
export function crossProbeSelection(
  cfg: CrossProbingSettings,
  board: Board,
  parts: readonly string[],
  force = false,
): string[] | null {
  if (!cfg.on_selection && !force) return null;
  return findItemsFromSyncSelection(board, parts);
}

/**
 * The net code a `$NET: <name>` probe should highlight: null to refuse the probe
 * outright, 0 for "no such net" (which clears the highlight, upstream's
 * `SetHighlight( false )` when `netcode <= 0`).
 *
 * `if( !crossProbingSettings.auto_highlight ) return;` (pcbnew/cross-probing.cpp:
 * 140) returns *before* the highlight is touched, which is the difference
 * between the two zero-ish answers: refusing leaves whatever was highlighted
 * alone, while an unknown net clears it.
 */
export function crossProbeHighlightNet(
  cfg: CrossProbingSettings,
  board: Board,
  netName: string | null,
): number | null {
  if (!cfg.auto_highlight) return null;
  if (!netName) return 0;
  for (const [code, name] of board.nets) if (name === netName) return code;
  return 0;
}
