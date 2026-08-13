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
import { pcbMmToIU } from '@ziroeda/common/src/eda_units.js';
import { escapeIpc } from '@ziroeda/common/src/string_utils.js';
import { boardItemId } from './edit-board.js';
import type { Board } from './types.js';

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
