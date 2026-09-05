// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Remove Unused Pads: `DIALOG_UNUSED_PAD_LAYERS::updatePadsAndVias`, and the
 * `FlashLayer` rule it arms.
 *
 * Most of these tests pin behaviour a reasonable engineer would "tidy up":
 * `BOARD::LayerDepth`'s mixed units, a micro via that is not special-cased, a
 * pad and a via that mean different layers by "keep the ends", and a pad parser
 * that honours `(keep_end_layers no)` where the via parser throws it away.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  DEFAULT_UNUSED_PAD_LAYERS_OPTIONS,
  boardLayerDepth,
  conditionallyFlashed,
  getKeepEndLayers,
  getRemoveUnconnected,
  padFlashState,
  padHasPotentiallyUnusedLayers,
  unconnectedLayerModeOf,
  unusedPadLayersMode,
  updateUnusedPadLayers,
  viaFlashState,
  viaHasPotentiallyUnusedLayers,
  withPadUnconnectedLayerMode,
  withViaUnconnectedLayerMode,
  type UnusedPadLayersOptions,
} from '@ziroeda/pcbnew/src/unused_pad_layers.js';
import type { Board, PcbFootprint, PcbPad, PcbVia } from '@ziroeda/pcbnew/src/types.js';

const EMPTY = { kind: 'list' as const, items: [] };
const P = (x: number, y: number) => ({ x, y });

/** Copper layer ids, as `layerNameToId` numbers them: F=0, B=2, In<n>=2n+2. */
const F_CU = 0;
const B_CU = 2;
const IN1 = 4;
const IN2 = 6;

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 1, name: 'In1.Cu', kind: 'signal' },
    { id: 2, name: 'In2.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
    { id: 37, name: 'F.Mask', kind: 'user' },
  ],
  nets: new Map([[0, '']]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  dimensions: [],
  textBoxes: [],
  tables: [],
  images: [],
  points: [],
  barcodes: [],
  groups: [],
  source: EMPTY,
  ...over,
});

/** The same board with only the two outer copper layers. */
const twoLayer = (over: Partial<Board> = {}): Board =>
  board({
    layers: [
      { id: 0, name: 'F.Cu', kind: 'signal' },
      { id: 31, name: 'B.Cu', kind: 'signal' },
    ],
    ...over,
  });

const via = (
  kind: PcbVia['kind'],
  layers: [string, string],
  over: Partial<PcbVia> = {},
): PcbVia => ({
  at: P(0, 0),
  size: 800000,
  drill: 400000,
  layers,
  kind,
  net: 1,
  source: EMPTY,
  ...over,
});

const pad = (over: Partial<PcbPad> = {}): PcbPad => ({
  number: '1',
  type: 'thru_hole',
  shape: 'circle',
  at: P(0, 0),
  angle: 0,
  size: P(1600000, 1600000),
  drill: { oblong: false, w: 800000, h: 800000 },
  layers: ['*.Cu', '*.Mask'],
  net: 1,
  source: EMPTY,
  ...over,
});

const footprint = (pads: PcbPad[], over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'lib:fp',
  at: P(0, 0),
  angle: 0,
  layer: 'F.Cu',
  pads,
  shapes: [],
  texts: [],
  points: [],
  barcodes: [],
  models: [],
  source: EMPTY,
  ...over,
});

const opts = (over: Partial<UnusedPadLayersOptions> = {}): UnusedPadLayersOptions => ({
  ...DEFAULT_UNUSED_PAD_LAYERS_OPTIONS,
  ...over,
});

// ---------------------------------------------------------------------------

describe('BOARD::LayerDepth', () => {
  it('measures inner-to-inner in layer-id space, so one step scores 2', () => {
    // Copper ids go up in twos. A depth of 1 for adjacent inner layers would
    // make every buried via fail the dialog's `> 1` gate.
    expect(boardLayerDepth(board(), IN1, IN2)).toBe(2);
  });

  it('substitutes the copper count for B.Cu, mixing id space with index space', () => {
    // F.Cu -> B.Cu on four layers is 3 (count - 1), neither 2 (the raw id gap)
    // nor 6 (the deepest inner id). Normalising either side changes which vias
    // the dialog offers to strip.
    expect(boardLayerDepth(board(), F_CU, B_CU)).toBe(3);
    expect(boardLayerDepth(twoLayer(), F_CU, B_CU)).toBe(1);
  });

  it('orders its arguments before substituting, so B.Cu as the shallow end stays id 2', () => {
    // The swap happens first: (In1, B.Cu) becomes (B.Cu, In1) and only the
    // deeper end is ever rewritten, so B.Cu keeps its raw id here.
    expect(boardLayerDepth(board(), IN1, B_CU)).toBe(2);
    expect(boardLayerDepth(board(), B_CU, IN1)).toBe(2);
  });

  it('scores a degenerate span zero', () => {
    expect(boardLayerDepth(board(), IN1, IN1)).toBe(0);
  });
});

describe('which items have potentially unused layers', () => {
  it('skips a through via on a two-layer board', () => {
    // There is no third layer to take copper off; flagging it would dirty the
    // file for nothing.
    expect(viaHasPotentiallyUnusedLayers(twoLayer(), via('through', ['F.Cu', 'B.Cu']))).toBe(false);
    expect(viaHasPotentiallyUnusedLayers(board(), via('through', ['F.Cu', 'B.Cu']))).toBe(true);
  });

  it('does not special-case a micro via', () => {
    // Upstream tests only VIATYPE::THROUGH, so a micro via falls to the depth
    // branch and passes. Adding a micro-via exemption would be a silent
    // divergence from KiCad on every HDI board.
    expect(viaHasPotentiallyUnusedLayers(board(), via('micro', ['F.Cu', 'In1.Cu']))).toBe(true);
  });

  it('accepts a buried via one layer deep and rejects a degenerate one', () => {
    expect(viaHasPotentiallyUnusedLayers(board(), via('blind', ['In1.Cu', 'In2.Cu']))).toBe(true);
    expect(viaHasPotentiallyUnusedLayers(board(), via('blind', ['In1.Cu', 'In1.Cu']))).toBe(false);
  });

  it('falls back to the layer count when an endpoint is not a known layer', () => {
    // Upstream's `startLayer < 0` (UNDEFINED_LAYER) guard. Without it a
    // corrupt via would take a NaN depth and silently never be offered.
    expect(viaHasPotentiallyUnusedLayers(board(), via('blind', ['Nonsense', 'In2.Cu']))).toBe(true);
    expect(viaHasPotentiallyUnusedLayers(twoLayer(), via('blind', ['Nonsense', 'B.Cu']))).toBe(
      false,
    );
  });

  it('accepts plated through-hole pads and nothing else', () => {
    // An NPTH pad spans the stack too, but has no net, so "unused" is
    // meaningless for it; SMD and edge-connector pads are single-layer.
    expect(padHasPotentiallyUnusedLayers(pad())).toBe(true);
    expect(padHasPotentiallyUnusedLayers(pad({ type: 'np_thru_hole' }))).toBe(false);
    expect(padHasPotentiallyUnusedLayers(pad({ type: 'smd' }))).toBe(false);
    expect(padHasPotentiallyUnusedLayers(pad({ type: 'connect' }))).toBe(false);
  });
});

describe('the mode the two buttons write', () => {
  it('picks remove_except_start_and_end while "Keep outside layers" is ticked', () => {
    expect(unusedPadLayersMode(true, true)).toBe('remove_except_start_and_end');
  });

  it('picks remove_all once the user unticks it', () => {
    // The checkbox defaults ON, so this branch is only reached deliberately —
    // and it is the one that lets copper vanish from F.Cu and B.Cu.
    expect(unusedPadLayersMode(true, false)).toBe('remove_all');
  });

  it('ignores the checkbox when restoring', () => {
    // `if( aRemoveLayers )` guards the keep-flag setter, and
    // SetRemoveUnconnected(false) has already collapsed the enum.
    expect(unusedPadLayersMode(false, true)).toBe('keep_all');
    expect(unusedPadLayersMode(false, false)).toBe('keep_all');
  });
});

describe('updatePadsAndVias scope', () => {
  const withItems = (): Board =>
    board({
      vias: [via('through', ['F.Cu', 'B.Cu'])],
      footprints: [footprint([pad(), pad({ number: '2', type: 'smd', layers: ['F.Cu'] })])],
    });

  it('changes nothing with the dialog’s out-of-the-box settings', () => {
    // Every checkbox but "Keep outside layers" ships unchecked, so pressing
    // "Remove Unused Layers" straight away is a no-op. A port that defaulted
    // Pads/Vias to true would strip a board the user only glanced at.
    const r = updateUnusedPadLayers(withItems(), true, DEFAULT_UNUSED_PAD_LAYERS_OPTIONS);

    expect(r.pads).toBe(0);
    expect(r.vias).toBe(0);
    expect(unconnectedLayerModeOf(r.board.footprints[0]!.pads[0]!)).toBe('keep_all');
    expect(unconnectedLayerModeOf(r.board.vias[0]!)).toBe('keep_all');
  });

  it('touches only PTH pads when Pads is ticked, and leaves vias alone', () => {
    const r = updateUnusedPadLayers(withItems(), true, opts({ pads: true }));

    expect(r.pads).toBe(1);
    expect(r.vias).toBe(0);
    expect(unconnectedLayerModeOf(r.board.footprints[0]!.pads[0]!)).toBe(
      'remove_except_start_and_end',
    );
    // The SMD pad must not gain the field: upstream writes the tokens for
    // PAD_ATTRIB::PTH only, and an SMD pad carrying one would confuse KiCad.
    expect(r.board.footprints[0]!.pads[1]!.unconnectedLayerMode).toBeUndefined();
  });

  it('writes remove_all when "Keep outside layers" is unticked', () => {
    const r = updateUnusedPadLayers(
      withItems(),
      true,
      opts({ pads: true, vias: true, preserveExternalLayers: false }),
    );

    expect(unconnectedLayerModeOf(r.board.footprints[0]!.pads[0]!)).toBe('remove_all');
    expect(unconnectedLayerModeOf(r.board.vias[0]!)).toBe('remove_all');
    expect(getKeepEndLayers(r.board.vias[0]!)).toBe(false);
    expect(getRemoveUnconnected(r.board.vias[0]!)).toBe(true);
  });

  it('resets everything in scope to keep_all on "Restore All Layers"', () => {
    const stripped = updateUnusedPadLayers(withItems(), true, opts({ pads: true, vias: true }));
    const r = updateUnusedPadLayers(stripped.board, false, opts({ pads: true, vias: true }));

    expect(unconnectedLayerModeOf(r.board.footprints[0]!.pads[0]!)).toBe('keep_all');
    expect(unconnectedLayerModeOf(r.board.vias[0]!)).toBe('keep_all');
  });

  it('leaves a two-layer through via untouched even when restoring', () => {
    // The eligibility gate applies to both buttons, so a remove_all flag on a
    // via the dialog will not consider survives "Restore All Layers". Moving
    // the gate to the remove path only would quietly "fix" that.
    const b = twoLayer({
      vias: [via('through', ['F.Cu', 'B.Cu'], { unconnectedLayerMode: 'remove_all' })],
    });
    const r = updateUnusedPadLayers(b, false, opts({ vias: true }));

    expect(r.vias).toBe(0);
    expect(unconnectedLayerModeOf(r.board.vias[0]!)).toBe('remove_all');
  });
});

describe('updatePadsAndVias with "Selected only"', () => {
  const two = (): Board =>
    board({
      vias: [via('through', ['F.Cu', 'B.Cu']), via('through', ['F.Cu', 'B.Cu'])],
      footprints: [footprint([pad(), pad({ number: '2' })]), footprint([pad({ number: '3' })])],
    });

  it('matches nothing when the caller supplies no selection hook', () => {
    // An empty PCB_SELECTION is the safe reading: better a no-op than a
    // board-wide strip the user did not ask for.
    const r = updateUnusedPadLayers(
      two(),
      true,
      opts({ pads: true, vias: true, selectedOnly: true }),
    );

    expect(r.pads).toBe(0);
    expect(r.vias).toBe(0);
  });

  it('covers every pad of a selected footprint', () => {
    const b = two();
    const target = b.footprints[0]!;
    const r = updateUnusedPadLayers(b, true, opts({ pads: true, selectedOnly: true }), {
      isSelected: (item) => item === target,
    });

    expect(r.pads).toBe(2);
    expect(r.board.footprints[1]!.pads[0]!.unconnectedLayerMode).toBeUndefined();
  });

  it('covers a single selected pad without touching its siblings', () => {
    // Upstream handles PCB_FOOTPRINT_T and PCB_PAD_T in two independent ifs, so
    // a lone pad in the selection is in scope on its own.
    const b = two();
    const target = b.footprints[0]!.pads[1]!;
    const r = updateUnusedPadLayers(b, true, opts({ pads: true, selectedOnly: true }), {
      isSelected: (item) => item === target,
    });

    expect(r.pads).toBe(1);
    expect(r.board.footprints[0]!.pads[0]!.unconnectedLayerMode).toBeUndefined();
    expect(unconnectedLayerModeOf(r.board.footprints[0]!.pads[1]!)).toBe(
      'remove_except_start_and_end',
    );
  });

  it('still applies the via eligibility gate to a selected via', () => {
    const b = twoLayer({ vias: [via('through', ['F.Cu', 'B.Cu'])] });
    const r = updateUnusedPadLayers(b, true, opts({ vias: true, selectedOnly: true }), {
      isSelected: () => true,
    });

    expect(r.vias).toBe(0);
  });
});

describe('the file format', () => {
  /** A four-layer stack, so a through via clears the `> 2` eligibility gate. */
  const LAYERS = `(layers (0 "F.Cu" signal) (1 "In1.Cu" signal) (2 "In2.Cu" signal)
      (31 "B.Cu" signal))`;
  const load = (text: string): Board => readBoard(parse(text));

  it('reads a bare token as yes', () => {
    // parseMaybeAbsentBool( true ): old files write `(remove_unused_layers)`.
    const b = load(`(kicad_pcb (version 20240108)
      (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
        (remove_unused_layers) (uuid "v1")))`);

    expect(unconnectedLayerModeOf(b.vias[0]!)).toBe('remove_all');
  });

  it('applies pad tokens in file order, including an explicit no', () => {
    // `SetKeepTopBottom(false)` lands on REMOVE_ALL whatever came before it —
    // the pad parser calls the setter unconditionally. Reading the pair as an
    // enum instead would give keep_all here.
    const b = load(`(kicad_pcb (version 20240108)
      (footprint "lib:fp" (layer "F.Cu") (at 0 0)
        (pad "1" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8)
          (layers "*.Cu" "*.Mask") (remove_unused_layers no) (keep_end_layers no))))`);

    expect(unconnectedLayerModeOf(b.footprints[0]!.pads[0]!)).toBe('remove_all');
  });

  it('ignores a false value on a via, where the pad honours it', () => {
    // The via parser guards every case with `if( parseMaybeAbsentBool( true ) )`.
    const b = load(`(kicad_pcb (version 20240108)
      (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
        (keep_end_layers no) (uuid "v1")))`);

    expect(b.vias[0]!.unconnectedLayerMode).toBeUndefined();
  });

  it('reads the via-only start_end_only token', () => {
    const b = load(`(kicad_pcb (version 20240108)
      (via (at 0 0) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
        (start_end_only yes) (uuid "v1")))`);

    expect(unconnectedLayerModeOf(b.vias[0]!)).toBe('start_end_only');
    // GetRemoveUnconnected is "anything but KEEP_ALL", which is what the
    // writer keys `zone_layer_connections` off.
    expect(getRemoveUnconnected(b.vias[0]!)).toBe(true);
    expect(getKeepEndLayers(b.vias[0]!)).toBe(false);
  });

  it('persists a strip through the writer and back', () => {
    // The model alone is not enough: every item is written from its source
    // node, so an edit that forgets to patch the source is silently lost.
    const src = `(kicad_pcb (version 20240108) (generator "pcbnew") ${LAYERS}
      (net 0 "")
      (via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1) (uuid "v1"))
      (footprint "lib:fp" (layer "F.Cu") (at 0 0) (uuid "f1")
        (pad "1" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8)
          (layers "*.Cu" "*.Mask"))))`;
    const r = updateUnusedPadLayers(load(src), true, opts({ pads: true, vias: true }));
    const back = load(serializeBoard(r.board));

    expect(unconnectedLayerModeOf(back.vias[0]!)).toBe('remove_except_start_and_end');
    expect(unconnectedLayerModeOf(back.footprints[0]!.pads[0]!)).toBe(
      'remove_except_start_and_end',
    );
  });

  it('drops the via tokens on restore, and writes an explicit no on a pad', () => {
    const src = `(kicad_pcb (version 20240108) (generator "pcbnew") ${LAYERS}
      (net 0 "")
      (via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
        (remove_unused_layers yes) (keep_end_layers yes)
        (zone_layer_connections "In1.Cu") (uuid "v1"))
      (footprint "lib:fp" (layer "F.Cu") (at 0 0) (uuid "f1")
        (pad "1" thru_hole circle (at 0 0) (size 1.6 1.6) (drill 0.8)
          (layers "*.Cu" "*.Mask") (remove_unused_layers yes) (keep_end_layers yes)
          (zone_layer_connections "In1.Cu"))))`;
    const r = updateUnusedPadLayers(load(src), false, opts({ pads: true, vias: true }));
    const text = serializeBoard(r.board);

    // KEEP_ALL writes no via token at all, and the zone-override cache goes
    // with it — leaving it behind would resurrect forced-flashed layers.
    expect(text).not.toContain('start_end_only');
    expect(text).not.toContain('zone_layer_connections');
    expect(text).toContain('(remove_unused_layers no)');
    expect(unconnectedLayerModeOf(load(text).vias[0]!)).toBe('keep_all');
    expect(unconnectedLayerModeOf(load(text).footprints[0]!.pads[0]!)).toBe('keep_all');
  });

  it('spells a via built from scratch the way KiCad does', () => {
    // buildViaNode covers source-less vias; remove_all still emits the
    // decorative `(keep_end_layers no)` upstream writes.
    const b = board({
      vias: [via('through', ['F.Cu', 'B.Cu'], { unconnectedLayerMode: 'remove_all' })],
      source: parse('(kicad_pcb (version 20240108))'),
    });
    const text = serializeBoard(b);

    expect(text).toContain('(remove_unused_layers yes)');
    expect(text).toContain('(keep_end_layers no)');
  });

  it('patches a source node rather than rebuilding it', () => {
    const src = `(kicad_pcb (version 20240108) (generator "pcbnew") ${LAYERS} (net 0 "")
      (via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 1)
        (remove_unused_layers yes) (keep_end_layers yes) (uuid "v1")))`;
    const before = load(src);
    const after = withViaUnconnectedLayerMode(before.vias[0]!, 'start_end_only');
    const text = serializeBoard({ ...before, vias: [after] });

    // Switching to START_END_ONLY has to remove the pair, not sit beside it.
    expect(text).toContain('(start_end_only yes)');
    expect(text).not.toContain('remove_unused_layers');
    expect(text).not.toContain('keep_end_layers');
    expect(text).toContain('"v1"');
  });
});

describe('PAD::FlashLayer', () => {
  it('keeps every layer while the mode is keep_all', () => {
    expect(padFlashState(pad(), 'In1.Cu')).toBe('flashed');
  });

  it('keeps F.Cu and B.Cu under remove_except_start_and_end', () => {
    // This is the "outside layers" promise: a through-hole pad you can still
    // solder. It holds regardless of connectivity.
    const p = pad({ unconnectedLayerMode: 'remove_except_start_and_end' });

    expect(padFlashState(p, 'F.Cu')).toBe('flashed');
    expect(padFlashState(p, 'B.Cu')).toBe('flashed');
    expect(padFlashState(p, 'In1.Cu')).toBe('if-connected');
  });

  it('offers no such protection under remove_all', () => {
    // The whole difference between the two modes. Treating F.Cu as always kept
    // would make the unticked checkbox indistinguishable from the ticked one.
    const p = pad({ unconnectedLayerMode: 'remove_all' });

    expect(padFlashState(p, 'F.Cu')).toBe('if-connected');
    expect(padFlashState(p, 'In1.Cu')).toBe('if-connected');
  });

  it('ignores connectivity entirely under start_end_only', () => {
    const p = pad({ unconnectedLayerMode: 'start_end_only' });

    expect(padFlashState(p, 'F.Cu')).toBe('flashed');
    expect(padFlashState(p, 'In1.Cu')).toBe('removed');
  });

  it('answers for F.Cu when asked about a front tech layer', () => {
    // FrontBoardTechMask folds onto F_Cu before the PTH block, so a pad whose
    // front ring is conditional has a conditional mask opening too.
    const p = pad({ unconnectedLayerMode: 'remove_all' });

    expect(padFlashState(p, 'F.Mask')).toBe('if-connected');
    // F.CrtYd is in FrontTechMask but NOT FrontBoardTechMask, so it does not
    // fold and stays plainly flashed.
    expect(padFlashState(pad({ layers: ['*.Cu', 'F.CrtYd'] }), 'F.CrtYd')).toBe('flashed');
  });

  it('reports a layer the pad is not on as removed', () => {
    expect(padFlashState(pad({ layers: ['F.Cu'] }), 'In1.Cu')).toBe('removed');
  });

  it('removes an NPTH pad whose drill swallows it', () => {
    // Zero or negative annulus. Upstream compares `>=`, so a drill exactly the
    // pad's width already has no copper.
    const swallowed = pad({
      type: 'np_thru_hole',
      size: P(800000, 800000),
      drill: { oblong: false, w: 800000, h: 800000 },
    });

    expect(padFlashState(swallowed, 'F.Cu')).toBe('removed');
    // One nanometre of ring and the copper is back.
    expect(padFlashState({ ...swallowed, size: P(800001, 800001) }, 'F.Cu')).toBe('flashed');
  });

  it('needs the drill shape to match the pad shape before swallowing it', () => {
    // A round drill in an oval pad keeps its copper however large it is: the
    // oval branch requires PAD_DRILL_SHAPE::OBLONG.
    const oval = pad({
      type: 'np_thru_hole',
      shape: 'oval',
      size: P(800000, 400000),
      drill: { oblong: false, w: 4000000, h: 4000000 },
    });

    expect(padFlashState(oval, 'F.Cu')).toBe('flashed');
    expect(
      padFlashState({ ...oval, drill: { oblong: true, w: 4000000, h: 4000000 } }, 'F.Cu'),
    ).toBe('removed');
  });

  it('keeps an offset NPTH pad, whose ring is not symmetric', () => {
    const offset = pad({
      type: 'np_thru_hole',
      size: P(800000, 800000),
      drill: { oblong: false, w: 800000, h: 800000, offset: P(100000, 0) },
    });

    expect(padFlashState(offset, 'F.Cu')).toBe('flashed');
  });
});

describe('PCB_VIA::FlashLayer', () => {
  const b = board();

  it('keeps the via’s own endpoints under remove_except_start_and_end', () => {
    // The asymmetry with a pad: for a buried via the two kept layers are
    // INNER layers, and the board's outer layers are not special at all.
    const buried = via('blind', ['In1.Cu', 'In2.Cu'], {
      unconnectedLayerMode: 'remove_except_start_and_end',
    });

    expect(viaFlashState(b, buried, 'In1.Cu')).toBe('flashed');
    expect(viaFlashState(b, buried, 'In2.Cu')).toBe('flashed');
    // Not on the via at all, so not merely unflashed — absent.
    expect(viaFlashState(b, buried, 'F.Cu')).toBe('removed');
  });

  it('protects nothing but the endpoints on a through via', () => {
    const v = via('through', ['F.Cu', 'B.Cu'], {
      unconnectedLayerMode: 'remove_except_start_and_end',
    });

    expect(viaFlashState(b, v, 'F.Cu')).toBe('flashed');
    expect(viaFlashState(b, v, 'B.Cu')).toBe('flashed');
    expect(viaFlashState(b, v, 'In1.Cu')).toBe('if-connected');
  });

  it('leaves even the outer layers conditional under remove_all', () => {
    const v = via('through', ['F.Cu', 'B.Cu'], { unconnectedLayerMode: 'remove_all' });

    expect(viaFlashState(b, v, 'F.Cu')).toBe('if-connected');
  });

  it('spans the stack physically, not by layer id', () => {
    // B.Cu is id 2, above every inner layer; walking ids would make an
    // In1->B.Cu via a two-layer via with nothing in between.
    const v = via('blind', ['In1.Cu', 'B.Cu']);

    expect(viaFlashState(b, v, 'In2.Cu')).toBe('flashed');
    expect(viaFlashState(b, v, 'F.Cu')).toBe('removed');
  });

  it('flashes a non-copper layer it reaches, and drops one it does not', () => {
    // An untented via is on F.Mask; the mode never applies to a mask layer.
    const untented = via('through', ['F.Cu', 'B.Cu'], {
      unconnectedLayerMode: 'remove_all',
      source: parse('(via (tenting (front no) (back no)))'),
    });

    expect(viaFlashState(b, untented, 'F.Mask')).toBe('flashed');
    // Tented by the board default, so the mask layer is not part of the via.
    expect(viaFlashState(b, via('through', ['F.Cu', 'B.Cu']), 'F.Mask')).toBe('removed');
  });

  it('ignores connectivity entirely under start_end_only', () => {
    const v = via('through', ['F.Cu', 'B.Cu'], { unconnectedLayerMode: 'start_end_only' });

    expect(viaFlashState(b, v, 'F.Cu')).toBe('flashed');
    expect(viaFlashState(b, v, 'In1.Cu')).toBe('removed');
  });
});

describe('ConditionallyFlashed', () => {
  it('tests the drill endpoints for both keep-the-ends modes', () => {
    // Unlike PAD::FlashLayer, which tests IsExternalCopperLayer for
    // remove_except_start_and_end. Both callers exist upstream; the zone
    // filler uses this one.
    expect(conditionallyFlashed('remove_except_start_and_end', 'F.Cu', 'F.Cu', 'B.Cu')).toBe(false);
    expect(conditionallyFlashed('remove_except_start_and_end', 'In1.Cu', 'F.Cu', 'B.Cu')).toBe(
      true,
    );
    expect(conditionallyFlashed('start_end_only', 'In1.Cu', 'In1.Cu', 'In2.Cu')).toBe(false);
  });

  it('is unconditional at both extremes of the enum', () => {
    expect(conditionallyFlashed('keep_all', 'In1.Cu', 'F.Cu', 'B.Cu')).toBe(false);
    expect(conditionallyFlashed('remove_all', 'F.Cu', 'F.Cu', 'B.Cu')).toBe(true);
  });
});

describe('writing the mode onto one item', () => {
  it('leaves the rest of the pad alone', () => {
    const before = pad({ pinFunction: 'VCC' });
    const after = withPadUnconnectedLayerMode(before, 'remove_all');

    expect(after.pinFunction).toBe('VCC');
    expect(after.number).toBe('1');
    expect(before.unconnectedLayerMode).toBeUndefined();
  });
});
