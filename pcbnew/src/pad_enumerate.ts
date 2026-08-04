// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Renumber Pads": pad enumeration by click order.
 * Counterpart: `PAD_TOOL::EnumeratePads` (pcbnew/tools/pad_tool.cpp:295) with
 * `SEQUENTIAL_PAD_ENUMERATION_PARAMS` (pcbnew/dialogs/dialog_enum_pads.h) and
 * `FOOTPRINT::GetNextPadNumber` (pcbnew/footprint.cpp:3551).
 *
 * ## It is not a batch renumber
 *
 * Nothing here sorts pads, walks them left-to-right, or skips pads that already
 * have a number. The order is the order the mouse touched them and every pad
 * touched is overwritten unconditionally — duplicate pad numbers within one
 * footprint are a perfectly reachable outcome and upstream neither warns nor
 * prevents it. `getNextPadNumber`'s uniqueness probing belongs to the *Add Pad*
 * tool and is deliberately not consulted by the enumeration path.
 *
 * ## The two rules that a reimplementation gets wrong
 *
 * **The line walk runs backwards.** One mouse event can cover several pads, so
 * upstream subdivides the segment from the previous cursor position to the
 * current one and hit-tests each sample. It walks `testpoint = to - j*step` for
 * ascending `j`, i.e. from the *current* cursor back towards the previous one.
 * The pad under the cursor right now is therefore numbered *first* and the one
 * you swept past earliest is numbered *last*. Iterating from→to reverses the
 * numbering of every fast drag.
 *
 * **De-duplication is consecutive-only.** `selectedPads.unique()` is
 * `std::list::unique`, which collapses adjacent equal elements and nothing
 * else. A set would change behaviour: if the sampled line leaves a pad and
 * returns to it inside one event, the pad appears twice non-adjacently, and on
 * a click the second occurrence immediately *un*-numbers what the first one
 * numbered and hands the number back to the recycle queue.
 *
 * ## The recycle queue
 *
 * Clicking a pad that this session already numbered undoes it and returns its
 * number to `storedPadNumbers`, a **FIFO**: released numbers are pushed to the
 * back and handed out from the front. Release 3 then 5 and the next two fresh
 * pads get 3 then 5, not 5 then 3. A *drag* across an already-numbered pad does
 * nothing at all; only a discrete click undoes.
 *
 * ## What is a caller's job, not this module's
 *
 * `accuracy` is a parameter because upstream's is `KiROUND(5 * onePixelInIU)` —
 * five *screen* pixels in IU, so it changes with zoom and only the canvas knows
 * it. Guessing a fixed IU tolerance would be wrong at every zoom but one.
 *
 * `isVisible` stands in for upstream's `checkVisibility` lambda, which consults
 * `KIGFX::VIEW` for per-item visibility, per-layer visibility, the high-contrast
 * active-layer set and `ViewGetLOD(layer, view) < view->GetScale()`. We have no
 * level-of-detail model at all, so LOD culling is omitted rather than invented;
 * the caller supplies whatever visibility it can express.
 *
 * Undo is likewise the caller's: upstream uses a `BOARD_COMMIT` that reverts
 * every rename on Escape and pushes them all under one label on double-click.
 * These functions are pure state transitions, so the editor snapshots the
 * footprint before starting and restores that snapshot to cancel.
 *
 * ## Known fidelity gap
 *
 * Hit testing goes through `padHit` (edit-footprint.ts), the model-level test
 * every other pcbnew selection path uses. It is bounding-box only for every pad
 * shape, whereas upstream tests the pad's fully-built effective polygon. Circles
 * and roundrects therefore collect slightly wider than KiCad near their corners.
 * Using a second, different hit test here would make the tool disagree with the
 * editor's own selection, which is the worse of the two inconsistencies.
 */

import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { EuclideanNormI, divideI } from '@ziroeda/kimath/src/math/vector2.js';
import { padHit, patchPad } from './edit-footprint.js';
import { getRefDesPrefix, getTrailingInt } from './spread_footprints.js';
import { isCopperLayerName } from './swap_layers.js';
import type { PcbFootprint, PcbPad } from './types.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

/** The label both commit paths push, `commit.Push( _( "Renumber Pads" ) )`. */
export const PAD_ENUMERATION_COMMIT_LABEL = 'Renumber Pads';

/**
 * `GENERAL_COLLECTORS_GUIDE`'s `m_accuracy = KiROUND( 5 * m_onePixelInIU )`.
 * Screen pixels, not IU — see `padEnumerationAccuracy`.
 */
export const PAD_ENUMERATION_ACCURACY_PX = 5;

/**
 * `int( 0.1 * pcbIUScale.IU_PER_MM )`: the mouse path is sampled every 0.1 mm.
 * Spelled as a constant because `segments` is an *integer* division by it, so a
 * one-IU change in the travelled distance changes the sample count at exact
 * multiples of it.
 */
export const PAD_ENUMERATION_SAMPLE_STEP_IU = 100000;

/** `PAD_TOOL::Reset( MODEL_RELOAD )` seeds `m_lastPadNumber` with the literal "1". */
export const DEFAULT_LAST_PAD_NUMBER = '1';

/**
 * `SEQUENTIAL_PAD_ENUMERATION_PARAMS`.
 *
 * The dialog's widget limits — prefix at most 4 characters, both spin controls
 * 0..999 inclusive — are UI constraints and are deliberately not enforced here,
 * because upstream does not enforce them either. `startNumber` 0 with an empty
 * prefix legitimately produces the pad number "0", and `step` 0 is a legal (and
 * destructive, see `applyPadEnumeration`) setting.
 *
 * `prefix` is `std::optional` upstream but only ever distinguishable from `''`
 * before the dialog has been accepted once — `value_or("")` erases the
 * difference everywhere it is read.
 */
export interface SequentialPadEnumerationParams {
  startNumber: number;
  step: number;
  prefix?: string;
}

export const DEFAULT_PAD_ENUMERATION_PARAMS: SequentialPadEnumerationParams = {
  startNumber: 1,
  step: 1,
};

/** What a rename recorded so a later click can undo it. */
export interface PadEnumerationUndo {
  /** The numeric value handed out, to be recycled if the rename is undone. */
  value: number;
  /** The pad number that was displaced. */
  previous: string;
}

export interface PadEnumerationState {
  readonly params: SequentialPadEnumerationParams;
  /** `seqPadNum`, the next never-yet-used value. */
  readonly seqPadNum: number;
  /** `storedPadNumbers`, the FIFO of released values: front is next out. */
  readonly storedPadNumbers: readonly number[];
  /**
   * `oldNumbers`, keyed by the **new** number string rather than by pad
   * identity — exactly as upstream keys its `std::map`. Two pads that end up
   * with the same string therefore share one entry and the second rename
   * overwrites the first.
   */
  readonly oldNumbers: ReadonlyMap<string, PadEnumerationUndo>;
  /**
   * Indices into `PcbFootprint.pads` that this session has numbered. Upstream
   * abuses `PAD::IsSelected()` for this, having cleared the selection at tool
   * start and clearing every pad's flag on exit.
   */
  readonly enumerated: ReadonlySet<number>;
  /** `PAD_TOOL::m_lastPadNumber`, which the Add Pad tool consumes afterwards. */
  readonly lastPadNumber: string;
}

/** `wxString::Format( "%s%d", prefix.value_or( "" ), aValue )`. */
export function padEnumerationNumber(
  params: SequentialPadEnumerationParams,
  value: number,
): string {
  return `${params.prefix ?? ''}${value}`;
}

/** `GENERAL_COLLECTORS_GUIDE`'s accuracy, given the canvas's IU per screen pixel. */
export function padEnumerationAccuracy(onePixelInIU: number): number {
  return KiROUND(PAD_ENUMERATION_ACCURACY_PX * Math.abs(onePixelInIU));
}

/**
 * Does one `(layers …)` token cover `layer`? The parser's `m_layerMasks` table
 * (pcb_io_kicad_sexpr_parser.cpp:118): the wildcards are file-level shorthand
 * that our reader stores verbatim, so they have to be expanded on every read.
 */
function padLayerTokenCovers(token: string, layer: string): boolean {
  if (token === layer) return true;
  if (token === '*.Cu') return isCopperLayerName(layer);
  if (token === '*In.Cu') return /^In\d+\.Cu$/.test(layer);
  if (token === 'F&B.Cu') return layer === 'F.Cu' || layer === 'B.Cu';
  if (/^\*\.(Adhes|Paste|Mask|SilkS|Fab|CrtYd)$/.test(token)) {
    const suffix = token.slice(1);
    return layer === `F${suffix}` || layer === `B${suffix}`;
  }
  return false;
}

/** `BOARD_ITEM::IsOnLayer` for a pad: is `layer` in its layer set? */
export function padIsOnLayer(pad: PcbPad, layer: string): boolean {
  return pad.layers.some((token) => padLayerTokenCovers(token, layer));
}

/**
 * `PAD::IsAperturePad` (pad.h:562) — `( LayerSet() & AllCuMask() ).none()`.
 *
 * There is no aperture attribute in the file format, so a pad with no copper
 * layer *at all* is inferred to be one. Note `*.Cu` is copper: a membership
 * test against concrete layer names would misclassify most through-hole pads.
 */
export function padIsAperturePad(pad: PcbPad): boolean {
  return !pad.layers.some(
    (token) =>
      isCopperLayerName(token) || token === '*.Cu' || token === '*In.Cu' || token === 'F&B.Cu',
  );
}

/** `PAD::CanHaveNumber` (pad.cpp:497): apertures and NPTH pads get no number. */
export function padCanHaveNumber(pad: PcbPad): boolean {
  if (padIsAperturePad(pad)) return false;
  if (pad.type === 'np_thru_hole') return false;
  return true;
}

/** The initial state; the caller separately snapshots the footprint for Escape. */
export function startPadEnumeration(
  params: SequentialPadEnumerationParams,
  lastPadNumber: string = DEFAULT_LAST_PAD_NUMBER,
): PadEnumerationState {
  return {
    params,
    seqPadNum: params.startNumber,
    storedPadNumbers: [],
    oldNumbers: new Map(),
    enumerated: new Set(),
    lastPadNumber,
  };
}

/**
 * The value the prompt offers as "next".
 *
 * Because the queue is FIFO and an undo pushes to the back, this is often *not*
 * the number just released — it is the oldest one still waiting.
 */
export function padEnumerationPreview(state: PadEnumerationState): number {
  return state.storedPadNumbers.length > 0 ? state.storedPadNumbers[0]! : state.seqPadNum;
}

/** `STATUS_TEXT_POPUP`'s two-line prompt; "cancel all" is literal, Escape reverts everything. */
export function padEnumerationPrompt(state: PadEnumerationState): string {
  const next = padEnumerationNumber(state.params, padEnumerationPreview(state));
  return `Click on pad ${next}\nPress <esc> to cancel all; double-click to finish`;
}

/** `std::list::unique`: collapse **adjacent** duplicates only. */
function uniqueConsecutive(values: readonly number[]): number[] {
  return values.filter((value, i) => i === 0 || values[i - 1] !== value);
}

/**
 * The pads one mouse event touches, in the order upstream would number them.
 *
 * `from` is the previous mouse position and `to` the current one. Upstream
 * updates its `oldMousePos` at the bottom of *every* loop iteration whatever
 * the event was, so `from` tracks the previous **event**, not the previous
 * click — a bare mouse move between two clicks shortens the swept segment.
 * On the very first event upstream sets `oldMousePos = mousePos`; callers get
 * that by passing `from === to`, which yields one sample at `to`.
 *
 * Per sample the collector runs twice over the pads in array order: the
 * *primary* pass takes pads on the active layer, then the *secondary* pass
 * takes every other hit pad, because `IncludeSecondary` defaults true and
 * `GENERAL_COLLECTOR::Collect` appends the second list after the first. Two
 * overlapping pads under one cursor are thus resolved by active layer first,
 * then by file order.
 */
export function padEnumerationHitOrder(
  fp: PcbFootprint,
  from: Vec2,
  to: Vec2,
  accuracy: number,
  activeLayer: string,
  isVisible?: (padIndex: number) => boolean,
): number[] {
  const travel = { x: to.x - from.x, y: to.y - from.y };
  const distance = EuclideanNormI(travel);
  // Integer division, then +1: at least one sample even for a standing cursor.
  const segments = Math.trunc(distance / PAD_ENUMERATION_SAMPLE_STEP_IU) + 1;
  const step = divideI(travel, segments);

  const hits: number[] = [];

  for (let j = 0; j < segments; j++) {
    // Backwards: j ascends away from the current cursor towards the old one.
    const testpoint = { x: to.x - j * step.x, y: to.y - j * step.y };

    const collect = (wantActiveLayer: boolean): void => {
      for (let i = 0; i < fp.pads.length; i++) {
        const pad = fp.pads[i]!;
        if (padIsOnLayer(pad, activeLayer) !== wantActiveLayer) continue;
        if (!padHit(pad, testpoint, accuracy)) continue;
        if (!padCanHaveNumber(pad)) continue;
        if (isVisible && !isVisible(i)) continue;
        hits.push(i);
      }
    };

    collect(true);
    collect(false);
  }

  return uniqueConsecutive(hits);
}

/**
 * Apply one event's worth of hits: the body of `for( PAD* pad : selectedPads )`
 * (pad_tool.cpp:466). `isClick` distinguishes `evt->IsClick( BUT_LEFT )` from
 * `evt->IsDrag( BUT_LEFT )` — only a click can undo a rename.
 *
 * Two upstream quirks are reproduced rather than repaired. With `step` 0 every
 * pad gets the same number string, and since `oldNumbers` is keyed by that
 * string each rename overwrites the last one's record, so undoing restores the
 * wrong previous number to all but the most recent pad. And the undo lookup
 * re-reads the pad's *current* number: if anything changed it in between the
 * entry is missing, in which case upstream asserts, leaves the number alone,
 * and still clears the pad's flag. So do we.
 */
export function applyPadEnumeration(
  fp: PcbFootprint,
  state: PadEnumerationState,
  padIndexes: readonly number[],
  isClick: boolean,
): { footprint: PcbFootprint; state: PadEnumerationState } {
  const pads = fp.pads.slice();
  const stored = state.storedPadNumbers.slice();
  const oldNumbers = new Map(state.oldNumbers);
  const enumerated = new Set(state.enumerated);
  let seqPadNum = state.seqPadNum;
  let lastPadNumber = state.lastPadNumber;

  for (const index of padIndexes) {
    const pad = pads[index];
    if (pad === undefined) continue;

    if (!enumerated.has(index)) {
      // A recycled number always wins over a fresh one, and taking it does not
      // advance seqPadNum — that is how released numbers get reused in order.
      let newval: number;

      if (stored.length > 0) {
        newval = stored.shift()!;
      } else {
        newval = seqPadNum;
        seqPadNum += state.params.step;
      }

      const newNumber = padEnumerationNumber(state.params, newval);
      oldNumbers.set(newNumber, { value: newval, previous: pad.number });
      // patchPad, not a field write: the number is also argument 1 of the pad's
      // source node, and setting only the field round-trips the old number.
      pads[index] = patchPad(pad, { number: newNumber });
      lastPadNumber = newNumber;
      enumerated.add(index);
    } else if (isClick) {
      const entry = oldNumbers.get(pad.number);

      if (entry !== undefined) {
        stored.push(entry.value);
        pads[index] = patchPad(pad, { number: entry.previous });
        lastPadNumber = entry.previous;
        oldNumbers.delete(pad.number);
      }

      enumerated.delete(index);
    }
    // A drag over an already-numbered pad is a no-op.
  }

  return {
    footprint: { ...fp, pads },
    state: { ...state, seqPadNum, storedPadNumbers: stored, oldNumbers, enumerated, lastPadNumber },
  };
}

/**
 * `FOOTPRINT::GetNextPadNumber` (footprint.cpp:3551), used by the *Add Pad*
 * tool rather than by enumeration.
 *
 * There is no pre-increment: if `lastPadNumber` is not currently in use it is
 * returned unchanged. `getTrailingInt("A")` is 0, so `getNextPadNumber` for a
 * footprint without an "A0" hands back "A0", not "A1".
 */
export function getNextPadNumber(fp: PcbFootprint, lastPadNumber: string): string {
  const used = new Set(fp.pads.map((pad) => pad.number));
  const prefix = getRefDesPrefix(lastPadNumber);
  let num = getTrailingInt(lastPadNumber);

  while (used.has(`${prefix}${num}`)) num++;

  return `${prefix}${num}`;
}
