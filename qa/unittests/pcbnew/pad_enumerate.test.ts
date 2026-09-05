// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Renumber Pads" pad enumeration.
 * Counterpart: `PAD_TOOL::EnumeratePads` (pcbnew/tools/pad_tool.cpp:295).
 *
 * The interesting behaviour is all ordering and bookkeeping, not arithmetic, so
 * the geometry fixtures use pads one internal unit across placed exactly on the
 * expected sample points. That makes the assertions sensitive to a single IU of
 * drift in the line walk — which is the point, since the sample step is an
 * integer division and the step vector is rounded rather than truncated.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readFootprintFile } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeFootprint } from '@ziroeda/pcbnew/src/write-footprint.js';
import { EuclideanNormI, divideI } from '@ziroeda/kimath/src/math/vector2.js';
import {
  applyPadEnumeration,
  getNextPadNumber,
  padCanHaveNumber,
  padEnumerationAccuracy,
  padEnumerationHitOrder,
  padEnumerationNumber,
  padEnumerationPreview,
  padEnumerationPrompt,
  padIsAperturePad,
  padIsOnLayer,
  startPadEnumeration,
  DEFAULT_PAD_ENUMERATION_PARAMS,
  PAD_ENUMERATION_COMMIT_LABEL,
  PAD_ENUMERATION_SAMPLE_STEP_IU,
  type SequentialPadEnumerationParams,
} from '@ziroeda/pcbnew/src/pad_enumerate.js';
import type { PcbFootprint, PcbPad } from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };

const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '',
  type: 'smd',
  shape: 'rect',
  at: { x: 0, y: 0 },
  angle: 0,
  size: { x: 500000, y: 500000 },
  layers: ['F.Cu'],
  source: EMPTY,
  ...over,
});

const footprint = (pads: PcbPad[]): PcbFootprint => ({
  lib: 'test:FP',
  at: { x: 0, y: 0 },
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  source: EMPTY,
});

const numbers = (fp: PcbFootprint): string[] => fp.pads.map((p) => p.number);

// ----- number construction ----------------------------------------------------

describe('pad number construction', () => {
  it('concatenates the prefix with a plain decimal', () => {
    // wxString::Format("%s%d"): no zero padding and no separator. Padding here
    // would make every renumbered board differ from KiCad's.
    expect(padEnumerationNumber({ startNumber: 1, step: 1, prefix: 'A' }, 7)).toBe('A7');
    expect(padEnumerationNumber({ startNumber: 1, step: 1, prefix: 'A' }, 123)).toBe('A123');
  });

  it('treats a missing prefix as the empty string', () => {
    // std::optional::value_or(""). If this ever emitted "undefined" the pad
    // numbers would be unusable, which is exactly the sort of thing a default
    // parameter silently introduces.
    expect(padEnumerationNumber({ startNumber: 1, step: 1 }, 4)).toBe('4');
  });

  it('permits the pad number "0"', () => {
    // Both spin controls have a minimum of 0, so "0" is a legal outcome and the
    // engine must not "helpfully" start at 1.
    expect(padEnumerationNumber({ startNumber: 0, step: 1 }, 0)).toBe('0');
  });

  it('defaults to start 1, step 1, no prefix', () => {
    // SEQUENTIAL_PAD_ENUMERATION_PARAMS's member initialisers.
    expect(DEFAULT_PAD_ENUMERATION_PARAMS.startNumber).toBe(1);
    expect(DEFAULT_PAD_ENUMERATION_PARAMS.step).toBe(1);
    expect(DEFAULT_PAD_ENUMERATION_PARAMS.prefix).toBeUndefined();
  });

  it('names the undo entry exactly as upstream pushes it', () => {
    // Both exit paths push this literal; a different label would split one
    // session across two undo entries in the UI layer.
    expect(PAD_ENUMERATION_COMMIT_LABEL).toBe('Renumber Pads');
  });
});

// ----- which pads may be numbered ---------------------------------------------

describe('PAD::CanHaveNumber', () => {
  it('counts "*.Cu" as copper', () => {
    // The classic misport: a through-hole pad stores the wildcard, not F.Cu, so
    // a literal-name copper check would call every one of them an aperture and
    // the tool would refuse to number any through-hole footprint.
    expect(padIsAperturePad(pad({ layers: ['*.Cu', '*.Mask'] }))).toBe(false);
    expect(padCanHaveNumber(pad({ type: 'thru_hole', layers: ['*.Cu', '*.Mask'] }))).toBe(true);
  });

  it('counts "F&B.Cu" and "*In.Cu" as copper too', () => {
    // Both are entries in the parser's m_layerMasks table and both expand to
    // copper; missing either turns real pads into apertures.
    expect(padIsAperturePad(pad({ layers: ['F&B.Cu'] }))).toBe(false);
    expect(padIsAperturePad(pad({ layers: ['*In.Cu'] }))).toBe(false);
    expect(padIsAperturePad(pad({ layers: ['In3.Cu'] }))).toBe(false);
  });

  it('rejects a pad with no copper layer at all', () => {
    // PAD::IsAperturePad infers "aperture" from a copperless layer set, since
    // the file format has no attribute for it. A paste-only pad is a stencil
    // aperture and never gets a number.
    expect(padIsAperturePad(pad({ layers: ['F.Paste'] }))).toBe(true);
    expect(padCanHaveNumber(pad({ layers: ['F.Paste', 'F.Mask'] }))).toBe(false);
  });

  it('rejects NPTH pads even when they carry copper', () => {
    // A mounting hole with an annular ring is still NPTH; numbering it would
    // invent a pin that no netlist can ever refer to.
    expect(padCanHaveNumber(pad({ type: 'np_thru_hole', layers: ['*.Cu'] }))).toBe(false);
  });
});

describe('pad layer membership', () => {
  it('expands the file-format wildcards', () => {
    // IsOnLayer decides the collector's primary/secondary split, so a wildcard
    // read literally would push every through-hole pad into the secondary list
    // and reverse the order two overlapping pads are numbered in.
    expect(padIsOnLayer(pad({ layers: ['*.Cu'] }), 'In4.Cu')).toBe(true);
    expect(padIsOnLayer(pad({ layers: ['*.Cu'] }), 'F.Mask')).toBe(false);
    expect(padIsOnLayer(pad({ layers: ['*In.Cu'] }), 'F.Cu')).toBe(false);
    expect(padIsOnLayer(pad({ layers: ['*In.Cu'] }), 'In1.Cu')).toBe(true);
    expect(padIsOnLayer(pad({ layers: ['F&B.Cu'] }), 'B.Cu')).toBe(true);
    expect(padIsOnLayer(pad({ layers: ['F&B.Cu'] }), 'In1.Cu')).toBe(false);
    expect(padIsOnLayer(pad({ layers: ['*.Mask'] }), 'B.Mask')).toBe(true);
  });
});

describe('collector accuracy', () => {
  it('is five screen pixels in IU, rounded', () => {
    // GENERAL_COLLECTORS_GUIDE: KiROUND(5 * onePixelInIU). Zoom-dependent by
    // design — a fixed IU tolerance would be wrong at every zoom but one.
    expect(padEnumerationAccuracy(1000)).toBe(5000);
    expect(padEnumerationAccuracy(0.3)).toBe(2); // 1.5 rounds away from zero
    expect(padEnumerationAccuracy(-1000)).toBe(5000); // abs(view.ToWorld(...).x)
  });
});

// ----- the line walk ----------------------------------------------------------

describe('the sampled mouse path', () => {
  // Pads one IU across, sitting exactly on the sample points a 0.2 mm drag
  // produces: to=0, then -66667 and -133334 (0.2 mm / 3 segments, rounded).
  // The fourth sits on the *previous* cursor position.
  const dotted = footprint([
    pad({ number: 'a', at: { x: 0, y: 0 }, size: { x: 1, y: 1 } }),
    pad({ number: 'b', at: { x: -66667, y: 0 }, size: { x: 1, y: 1 } }),
    pad({ number: 'c', at: { x: -133334, y: 0 }, size: { x: 1, y: 1 } }),
    pad({ number: 'd', at: { x: -200000, y: 0 }, size: { x: 1, y: 1 } }),
  ]);

  it('walks backwards from the current cursor towards the previous one', () => {
    // The single most counter-intuitive fact in the tool: within one event the
    // pad under the cursor *now* is numbered first. Iterating from→to instead
    // reverses the numbering of every drag that crosses more than one pad, and
    // the assertion below would come back [3, 2, 1].
    expect(padEnumerationHitOrder(dotted, { x: -200000, y: 0 }, { x: 0, y: 0 }, 0, 'F.Cu')).toEqual(
      [0, 1, 2],
    );
  });

  it('never samples the previous cursor position itself', () => {
    // The last sample is at to - (segments-1)*step, which always stops one step
    // short of `from`. Pad 'd' sits exactly on `from` and is therefore missed —
    // a "tidied" loop running j <= segments would number it and diverge.
    expect(
      padEnumerationHitOrder(dotted, { x: -200000, y: 0 }, { x: 0, y: 0 }, 0, 'F.Cu'),
    ).not.toContain(3);
  });

  it('rounds the step vector rather than truncating it', () => {
    // 200000/3 is 66666.67: rounding puts samples on -66667 and -133334,
    // truncating puts them on -66666 and -133332. With one-IU pads only the
    // rounded walk hits 'b' and 'c', so truncation collapses the result to [0].
    expect(divideI({ x: 200000, y: 0 }, 3)).toEqual({ x: 66667, y: 0 });
    expect(
      padEnumerationHitOrder(dotted, { x: -200000, y: 0 }, { x: 0, y: 0 }, 0, 'F.Cu'),
    ).toHaveLength(3);
  });

  it('always takes at least one sample, at the current cursor', () => {
    // segments = distance/step + 1. Without the +1 a stationary click would
    // take no samples at all and the tool would never number anything.
    expect(padEnumerationHitOrder(dotted, { x: 0, y: 0 }, { x: 0, y: 0 }, 0, 'F.Cu')).toEqual([0]);
  });

  it('samples every 0.1 mm of travel', () => {
    // int(0.1 * IU_PER_MM). A coarser interval skips pads on a fast drag, which
    // is the entire reason the line walk exists.
    expect(PAD_ENUMERATION_SAMPLE_STEP_IU).toBe(100000);
  });

  it('uses the integer EuclideanNorm, special cases and all', () => {
    // `segments` is an integer division by 100000, so one IU of difference in
    // the distance changes the sample count at exact multiples of 0.1 mm.
    expect(EuclideanNormI({ x: 3, y: 4 })).toBe(5);
    expect(EuclideanNormI({ x: 2, y: 3 })).toBe(4); // 3.606 rounds up, not down
    expect(EuclideanNormI({ x: 0, y: -7 })).toBe(7);
    expect(EuclideanNormI({ x: -7, y: 0 })).toBe(7);
    expect(EuclideanNormI({ x: 5, y: 5 })).toBe(7); // 7.07 -> 7, the 45° case
    expect(EuclideanNormI({ x: 0, y: 0 })).toBe(0);
  });

  it('skips pads that cannot have a number and pads the caller hides', () => {
    // CanHaveNumber runs inside the collector loop, and checkVisibility stands
    // in for the VIEW query we cannot make. Either one leaking through would
    // hand numbers to stencil apertures or to pads on a hidden layer.
    const mixed = footprint([
      pad({ number: 'a', at: { x: 0, y: 0 }, layers: ['F.Paste'] }),
      pad({ number: 'b', at: { x: 0, y: 0 }, type: 'np_thru_hole', layers: ['*.Cu'] }),
      pad({ number: 'c', at: { x: 0, y: 0 } }),
      pad({ number: 'd', at: { x: 0, y: 0 } }),
    ]);
    expect(padEnumerationHitOrder(mixed, { x: 0, y: 0 }, { x: 0, y: 0 }, 0, 'F.Cu')).toEqual([
      2, 3,
    ]);
    expect(
      padEnumerationHitOrder(mixed, { x: 0, y: 0 }, { x: 0, y: 0 }, 0, 'F.Cu', (i) => i !== 2),
    ).toEqual([3]);
  });

  it('honours the hit accuracy the caller passes', () => {
    // The pad is 0.5 mm across, so its edge is 250000 IU out; a cursor 300000
    // away is only inside once the caller's zoom-derived slop reaches 50000.
    const one = footprint([pad({ at: { x: 0, y: 0 } })]);
    const at = { x: 300000, y: 0 };
    expect(padEnumerationHitOrder(one, at, at, 0, 'F.Cu')).toEqual([]);
    expect(padEnumerationHitOrder(one, at, at, 50000, 'F.Cu')).toEqual([0]);
  });
});

describe('primary and secondary collector lists', () => {
  // Two coincident pads, the back one first in file order.
  const stacked = footprint([
    pad({ number: 'back', layers: ['B.Cu'] }),
    pad({ number: 'front', layers: ['F.Cu'] }),
  ]);

  it('puts active-layer pads ahead of everything else', () => {
    // Collect() appends the secondary list after the primary one, so the active
    // layer wins over file order. Dropping the split would number 'back' first
    // and make the tool feel like it ignores the layer you are working on.
    expect(padEnumerationHitOrder(stacked, { x: 0, y: 0 }, { x: 0, y: 0 }, 0, 'F.Cu')).toEqual([
      1, 0,
    ]);
    expect(padEnumerationHitOrder(stacked, { x: 0, y: 0 }, { x: 0, y: 0 }, 0, 'B.Cu')).toEqual([
      0, 1,
    ]);
  });

  it('de-duplicates only consecutive repeats', () => {
    // std::list::unique. Interleaved primary/secondary hits across two samples
    // give front, back, front, back — non-adjacent repeats that a Set would
    // collapse to two entries, silently deleting the un-numbering quirk below.
    expect(
      padEnumerationHitOrder(stacked, { x: -100000, y: 0 }, { x: 0, y: 0 }, 0, 'F.Cu'),
    ).toEqual([1, 0, 1, 0]);
  });
});

// ----- applying the hits ------------------------------------------------------

describe('applying a click', () => {
  const three = footprint([
    pad({ number: 'x', at: { x: 0, y: 0 } }),
    pad({ number: 'y', at: { x: 1000000, y: 0 } }),
    pad({ number: 'z', at: { x: 2000000, y: 0 } }),
  ]);

  it('hands out start, start+step, start+2*step in touch order', () => {
    // The whole point of the tool. Note nothing is sorted: the order is the
    // order the indexes arrive in.
    const params: SequentialPadEnumerationParams = { startNumber: 5, step: 3, prefix: 'P' };
    let s = startPadEnumeration(params);
    let fp = three;
    for (const i of [2, 0, 1]) {
      const r = applyPadEnumeration(fp, s, [i], true);
      fp = r.footprint;
      s = r.state;
    }
    expect(numbers(fp)).toEqual(['P8', 'P11', 'P5']);
    expect(s.seqPadNum).toBe(14);
  });

  it('overwrites pads that already had numbers, duplicates included', () => {
    // Upstream neither skips numbered pads nor checks for collisions, so the
    // footprint can legitimately end up with two pads called "1". A port that
    // deduplicated would produce a different board from the same clicks.
    const dupes = footprint([pad({ number: '1' }), pad({ number: '2', at: { x: 1000000, y: 0 } })]);
    const s = startPadEnumeration({ startNumber: 1, step: 0 });
    const r = applyPadEnumeration(dupes, s, [0, 1], true);
    expect(numbers(r.footprint)).toEqual(['1', '1']);
  });

  it('does not mutate the footprint or state it was given', () => {
    // The editor holds the pre-session snapshot to serve Escape; if apply
    // mutated in place there would be nothing left to revert to.
    const s = startPadEnumeration(DEFAULT_PAD_ENUMERATION_PARAMS);
    applyPadEnumeration(three, s, [0, 1, 2], true);
    expect(numbers(three)).toEqual(['x', 'y', 'z']);
    expect(s.enumerated.size).toBe(0);
    expect(s.storedPadNumbers).toEqual([]);
  });
});

describe('un-numbering', () => {
  const four = footprint([
    pad({ number: 'p', at: { x: 0, y: 0 } }),
    pad({ number: 'q', at: { x: 1000000, y: 0 } }),
    pad({ number: 'r', at: { x: 2000000, y: 0 } }),
    pad({ number: 's', at: { x: 3000000, y: 0 } }),
  ]);

  const clickEach = (indexes: number[]) => {
    let fp = four;
    let s = startPadEnumeration({ startNumber: 1, step: 1 });
    for (const i of indexes) {
      const r = applyPadEnumeration(fp, s, [i], true);
      fp = r.footprint;
      s = r.state;
    }
    return { fp, s };
  };

  it('restores the previous number and recycles the value', () => {
    // Clicking a pad you already numbered is the undo gesture; the released
    // value must come back or the sequence develops holes.
    const { fp, s } = clickEach([0, 1, 0]);
    expect(numbers(fp)).toEqual(['p', '2', 'r', 's']);
    expect(s.storedPadNumbers).toEqual([1]);
    expect(s.seqPadNum).toBe(3);
  });

  it('recycles released values first-in-first-out', () => {
    // push_back / pop_front. Releasing 2 then 1 and clicking two fresh pads
    // gives 2 then 1; a LIFO stack would give 1 then 2, and every board
    // renumbered after an undo would differ from KiCad's.
    const { fp, s } = clickEach([0, 1, 2, 1, 0, 3]);
    expect(s.storedPadNumbers).toEqual([1]);
    expect(numbers(fp)).toEqual(['p', 'q', '3', '2']);
    expect(s.seqPadNum).toBe(4);
  });

  it('previews the oldest released value, not the one just released', () => {
    // The popup reads storedPadNumbers.front(). Because the undo pushes to the
    // back, the number offered next is usually not the one you just freed.
    const { s } = clickEach([0, 1, 2, 1, 0]);
    expect(s.storedPadNumbers).toEqual([2, 1]);
    expect(padEnumerationPreview(s)).toBe(2);
    expect(padEnumerationPrompt(s)).toBe(
      'Click on pad 2\nPress <esc> to cancel all; double-click to finish',
    );
  });

  it('previews the next fresh value when nothing has been released', () => {
    // With an empty queue the popup shows seqPadNum, which is what the user
    // sees before the first click.
    const s = startPadEnumeration({ startNumber: 7, step: 2, prefix: 'K' });
    expect(padEnumerationPreview(s)).toBe(7);
    expect(padEnumerationPrompt(s)).toBe(
      'Click on pad K7\nPress <esc> to cancel all; double-click to finish',
    );
  });

  it('ignores a drag across an already-numbered pad', () => {
    // The undo branch is gated on IsClick(BUT_LEFT). If a drag undid too, then
    // dragging back across your own work would erase it.
    const first = applyPadEnumeration(
      four,
      startPadEnumeration({ startNumber: 1, step: 1 }),
      [0],
      true,
    );
    const dragged = applyPadEnumeration(first.footprint, first.state, [0], false);
    expect(numbers(dragged.footprint)).toEqual(['1', 'q', 'r', 's']);
    expect(dragged.state.storedPadNumbers).toEqual([]);
  });

  it('un-numbers on the second occurrence within one click event', () => {
    // Two coincident pads sampled twice give front, back, front, back, so one
    // click both numbers and un-numbers them. Reachable, and the consequence of
    // consecutive-only de-duplication; a Set would hide it.
    const stacked = footprint([
      pad({ number: 'back', layers: ['B.Cu'] }),
      pad({ number: 'front', layers: ['F.Cu'] }),
    ]);
    const order = padEnumerationHitOrder(stacked, { x: -100000, y: 0 }, { x: 0, y: 0 }, 0, 'F.Cu');
    const r = applyPadEnumeration(
      stacked,
      startPadEnumeration({ startNumber: 1, step: 1 }),
      order,
      true,
    );
    expect(numbers(r.footprint)).toEqual(['back', 'front']);
    expect(r.state.storedPadNumbers).toEqual([1, 2]);
    expect(r.state.enumerated.size).toBe(0);
  });

  it('restores the wrong number when step is 0, exactly as upstream does', () => {
    // oldNumbers is keyed by the NEW number string, so with step 0 every rename
    // overwrites the previous record. Clicking pad 0 again therefore restores
    // pad 1's old number. Reproduced deliberately: a keyed-by-pad map would be
    // an improvement, and improvements are divergences.
    const two = footprint([pad({ number: 'A' }), pad({ number: 'B', at: { x: 1000000, y: 0 } })]);
    const s0 = startPadEnumeration({ startNumber: 1, step: 0 });
    const a = applyPadEnumeration(two, s0, [0], true);
    const b = applyPadEnumeration(a.footprint, a.state, [1], true);
    const c = applyPadEnumeration(b.footprint, b.state, [0], true);
    expect(numbers(c.footprint)).toEqual(['B', '1']);
  });

  it('clears the flag but leaves the number when the record is missing', () => {
    // Upstream wxASSERTs, skips the restore, and still ClearSelected()s. The
    // pad must become numberable again or it would be stuck forever.
    const one = footprint([pad({ number: 'A' })]);
    const a = applyPadEnumeration(one, startPadEnumeration({ startNumber: 1, step: 1 }), [0], true);
    const tampered = {
      footprint: { ...a.footprint, pads: [{ ...a.footprint.pads[0]!, number: 'Z' }] },
      state: a.state,
    };
    const b = applyPadEnumeration(tampered.footprint, tampered.state, [0], true);
    expect(numbers(b.footprint)).toEqual(['Z']);
    expect(b.state.enumerated.has(0)).toBe(false);
    expect(b.state.storedPadNumbers).toEqual([]);
  });
});

describe('the last pad number the Add Pad tool inherits', () => {
  it('starts at the literal "1"', () => {
    // PAD_TOOL::Reset(MODEL_RELOAD) seeds m_lastPadNumber = "1".
    expect(startPadEnumeration(DEFAULT_PAD_ENUMERATION_PARAMS).lastPadNumber).toBe('1');
  });

  it('follows the last pad touched, including an undo', () => {
    // SetLastPadNumber is called on both the rename and the un-rename branch,
    // so after undoing a pad the next new pad continues from the *restored*
    // number, not from the sequence.
    const two = footprint([pad({ number: 'A' }), pad({ number: 'B', at: { x: 1000000, y: 0 } })]);
    const s = startPadEnumeration({ startNumber: 1, step: 1 });
    const a = applyPadEnumeration(two, s, [0], true);
    expect(a.state.lastPadNumber).toBe('1');
    const b = applyPadEnumeration(a.footprint, a.state, [0], true);
    expect(b.state.lastPadNumber).toBe('A');
  });
});

// ----- FOOTPRINT::GetNextPadNumber -------------------------------------------

describe('getNextPadNumber', () => {
  const fp = footprint([pad({ number: '1' }), pad({ number: '2' }), pad({ number: '3' })]);

  it('does not pre-increment a number that is free', () => {
    // The probe starts *at* the last number. Incrementing first would leave a
    // gap every time a pad was deleted and replaced.
    expect(getNextPadNumber(fp, '9')).toBe('9');
  });

  it('probes upwards past every number in use', () => {
    expect(getNextPadNumber(fp, '1')).toBe('4');
  });

  it('keeps the prefix and starts a bare prefix at zero', () => {
    // GetTrailingInt("A") is 0, so the first pad in an "A" series is "A0", not
    // "A1" — surprising, and load-bearing for BGA-style numbering.
    expect(getNextPadNumber(fp, 'A')).toBe('A0');
    expect(getNextPadNumber(footprint([pad({ number: 'A0' })]), 'A')).toBe('A1');
    expect(getNextPadNumber(fp, 'B12')).toBe('B12');
  });
});

// ----- persistence ------------------------------------------------------------

describe('writing the number back', () => {
  const SRC = `(footprint "R"
	(version 20241229) (generator "pcbnew")
	(layer "F.Cu")
	(pad "1" smd roundrect (at -0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Paste" "F.Mask")
		(roundrect_rratio 0.25) (pinfunction "A") (pintype "passive"))
	(pad "2" smd roundrect (at 0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Paste" "F.Mask")
		(roundrect_rratio 0.25))
)
`;

  it('survives a save and reload, keeping unmodelled pad fields', () => {
    // The number lives twice: in PcbPad.number and as argument 1 of the pad's
    // source node. Writing only the field round-trips the OLD number to disk,
    // so the rename would appear to work and then vanish on reload.
    const fp = readFootprintFile(parse(SRC))!;
    const order = padEnumerationHitOrder(fp, fp.pads[1]!.at, fp.pads[1]!.at, 0, 'F.Cu');
    expect(order).toEqual([1]);
    const r = applyPadEnumeration(
      fp,
      startPadEnumeration({ startNumber: 9, step: 1 }),
      order,
      true,
    );
    const reread = readFootprintFile(parse(serializeFootprint(r.footprint)))!;
    expect(numbers(reread)).toEqual(['1', '9']);
    expect(serializeFootprint(r.footprint)).toContain('(pinfunction "A")');
  });
});
