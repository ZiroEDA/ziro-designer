// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every flag in `read-board.ts` that upstream reads with
 * `PCB_IO_KICAD_SEXPR_PARSER::parseMaybeAbsentBool`
 * (pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr_parser.cpp:265).
 *
 * Two things are being pinned, and they need separate assertions:
 *
 * 1. **the grammar** — that a bare positional token and an argument-less list
 *    both read as the call site's `aDefaultValue`, and that the explicit
 *    `yes`/`no` overrides it;
 * 2. **the default itself** — which is `true` at every one of these sites bar
 *    `prefer_zone_connections`. Each call site therefore gets its own
 *    assertion driven by the *bare* form, so flipping any single
 *    `whenPresent` argument moves an expectation here. A table-shaped test
 *    that asserted "they are all true" would pass with any one of them wrong.
 *
 * The `.kicad_pcb` and `.kicad_mod` fixtures under `qa/data/` are bytes KiCad
 * itself wrote; see the READMEs beside them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readBoard, readFootprintFile } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import { serializeFootprint } from '@ziroeda/pcbnew/src/write-footprint.js';

const dataFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../data/${rel}`, import.meta.url)), 'utf8');

// ---------------------------------------------------------------------------
// Real KiCad output
// ---------------------------------------------------------------------------

describe('files KiCad wrote', () => {
  it('hides the Value text bitmap2component marked with a bare `hide`', () => {
    // `(fp_text value "LOGO" (at 0.75 0) (layer "F.SilkS") hide …)`, written by
    // the installed KiCad 10.0.5's own bitmap2component. Before the port this
    // came back `hide: false`: the file loaded clean and one field was wrong.
    const fp = readFootprintFile(
      parse(dataFile('bitmap2component/kicad_square24_300dpi.kicad_mod')),
    )!;
    const value = fp.texts.find((t) => t.kind === 'value')!;
    expect(value.hide).toBe(true);
    // The reference text in the same file carries no `hide` at all.
    expect(fp.texts.find((t) => t.kind === 'reference')!.hide).toBe(false);
  });

  it('keeps that hidden Value hidden across a write and a re-read', () => {
    // We re-emit `(hide yes)` rather than the bare token, so the round trip is
    // also the proof that the two spellings mean the same thing to us.
    const fp = readFootprintFile(
      parse(dataFile('bitmap2component/kicad_square24_300dpi.kicad_mod')),
    )!;
    const back = readFootprintFile(parse(serializeFootprint(fp)))!;
    expect(back.texts.find((t) => t.kind === 'value')!.hide).toBe(true);
    expect(back.texts.find((t) => t.kind === 'reference')!.hide).toBe(false);
  });

  it('hides both bare-`hide` footprint texts of a v20220211 board', () => {
    // qa/data/pcbnew/issue10906.kicad_pcb — KiCad's own corpus.
    const board = readBoard(parse(dataFile('pcbnew/issue10906.kicad_pcb')));
    const hidden = board.footprints.flatMap((f) => f.texts).filter((t) => t.hide);
    expect(hidden).toHaveLength(2);
    expect(hidden.map((t) => t.kind).sort()).toEqual(['reference', 'value']);

    const back = readBoard(parse(serializeBoard(board)));
    expect(back.footprints.flatMap((f) => f.texts).filter((t) => t.hide)).toHaveLength(2);
  });

  it('reads the bare `bold` inside `(font …)` of a v20220621 board', () => {
    // qa/data/pcbnew/connection_width_rules.kicad_pcb has six
    // `(effects (font (size 0.2 0.2) (thickness 0.04) bold) …)` texts and no
    // other text at all, so "some are bold" cannot pass by accident.
    const board = readBoard(parse(dataFile('pcbnew/connection_width_rules.kicad_pcb')));
    expect(board.texts.length).toBeGreaterThan(0);
    expect(board.texts.every((t) => t.bold === true)).toBe(true);
    expect(board.texts.every((t) => t.italic === false)).toBe(true);

    const back = readBoard(parse(serializeBoard(board)));
    expect(back.texts.every((t) => t.bold === true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// One assertion per call site, driven by the bare form
// ---------------------------------------------------------------------------

const boardWith = (body: string) =>
  readBoard(parse(`(kicad_pcb (version 20241229) (generator "test") ${body})`));

describe('the default at each call site', () => {
  const teardrops = (inner: string) =>
    boardWith(
      `(via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0) (teardrops ${inner}))`,
    ).vias[0]!.teardrops!;

  it('enabled: parseMaybeAbsentBool( true ) at :682', () => {
    // TEARDROP_PARAMETERS's ctor leaves m_Enabled false, so a bare token that
    // read as its own default would be indistinguishable from an absent one.
    expect(teardrops('(enabled)').enabled).toBe(true);
    expect(teardrops('enabled').enabled).toBe(true);
    expect(teardrops('(enabled no)').enabled).toBe(false);
    expect(teardrops('(best_length_ratio 0.5)').enabled).toBe(false);
  });

  it('allow_two_segments: parseMaybeAbsentBool( true ) at :686', () => {
    expect(teardrops('(allow_two_segments)').allowUseTwoTracks).toBe(true);
    expect(teardrops('allow_two_segments').allowUseTwoTracks).toBe(true);
    expect(teardrops('(allow_two_segments no)').allowUseTwoTracks).toBe(false);
  });

  it('prefer_zone_connections: parseMaybeAbsentBool( FALSE ) at :690, stored inverted', () => {
    // The one call site on this list whose default is false, and upstream
    // negates it into m_TdOnPadsInZones. A bare token therefore means
    // "prefer_zone_connections = false", i.e. teardrops DO go on pads in zones.
    expect(teardrops('(prefer_zone_connections)').tdOnPadsInZones).toBe(true);
    expect(teardrops('prefer_zone_connections').tdOnPadsInZones).toBe(true);
    expect(teardrops('(prefer_zone_connections yes)').tdOnPadsInZones).toBe(false);
    expect(teardrops('(prefer_zone_connections no)').tdOnPadsInZones).toBe(true);
  });

  it('curved_edges: parseMaybeAbsentBool( true ) at :720', () => {
    expect(teardrops('(curved_edges)').curvedEdges).toBe(true);
    expect(teardrops('curved_edges').curvedEdges).toBe(true);
    expect(teardrops('(curved_edges no)').curvedEdges).toBe(false);
  });

  const dimension = (fmt: string, style: string) =>
    boardWith(
      `(dimension (type aligned) (layer "Dwgs.User") (pts (xy 0 0) (xy 10 0)) ` +
        `(format ${fmt}) (style (thickness 0.1) (arrow_length 1) ${style}))`,
    ).dimensions[0]!;

  it('suppress_zeroes: parseMaybeAbsentBool( true ) at :4727', () => {
    expect(dimension('(units 3) (suppress_zeroes)', '').format!.suppressZeroes).toBe(true);
    expect(dimension('(units 3) suppress_zeroes', '').format!.suppressZeroes).toBe(true);
    expect(dimension('(units 3) (suppress_zeroes no)', '').format!.suppressZeroes).toBe(false);
  });

  it('keep_text_aligned: parseMaybeAbsentBool( true ) at :4802', () => {
    expect(dimension('(units 3)', '(keep_text_aligned)').style.keepTextAligned).toBe(true);
    expect(dimension('(units 3)', 'keep_text_aligned').style.keepTextAligned).toBe(true);
    expect(dimension('(units 3)', '(keep_text_aligned no)').style.keepTextAligned).toBe(false);
  });

  const grText = (effects: string) =>
    boardWith(`(gr_text "x" (at 0 0) (layer "F.SilkS") (effects ${effects}))`).texts[0]!;

  it('bold: parseMaybeAbsentBool( true ) at :803', () => {
    expect(grText('(font (size 1 1) bold)').bold).toBe(true);
    expect(grText('(font (size 1 1) (bold))').bold).toBe(true);
    expect(grText('(font (size 1 1) (bold no))').bold).toBe(false);
    expect(grText('(font (size 1 1))').bold).toBe(false);
  });

  it('italic: parseMaybeAbsentBool( true ) at :807', () => {
    expect(grText('(font (size 1 1) italic)').italic).toBe(true);
    expect(grText('(font (size 1 1) (italic))').italic).toBe(true);
    expect(grText('(font (size 1 1) (italic no))').italic).toBe(false);
    expect(grText('(font (size 1 1))').italic).toBe(false);
  });

  it('hide inside (effects …): parseMaybeAbsentBool( true ) at :841', () => {
    // parseEDA_TEXT's own hide, the pre-v7 location.
    expect(grText('(font (size 1 1)) hide').hide).toBe(true);
    expect(grText('(font (size 1 1)) (hide)').hide).toBe(true);
    expect(grText('(font (size 1 1)) (hide no)').hide).toBe(false);
    expect(grText('(font (size 1 1))').hide).toBe(false);
  });

  const fpText = (tokens: string) =>
    boardWith(
      `(footprint "L:F" (layer "F.Cu") (at 0 0) ` +
        `(fp_text value "V" (at 0 0) (layer "F.Fab") ${tokens} (effects (font (size 1 1)))))`,
    ).footprints[0]!.texts[0]!;

  it('hide on the text item: parseMaybeAbsentBool( true ) at :3913', () => {
    expect(fpText('hide').hide).toBe(true);
    expect(fpText('(hide)').hide).toBe(true);
    expect(fpText('(hide no)').hide).toBe(false);
    expect(fpText('').hide).toBe(false);
  });

  const model = (tokens: string) =>
    boardWith(
      `(footprint "L:F" (layer "F.Cu") (at 0 0) (model "x.step" ${tokens} (offset (xyz 0 0 0))))`,
    ).footprints[0]!.models[0]!;

  it('hide on a 3D model: parseMaybeAbsentBool( true ) at :955', () => {
    expect(model('hide').hide).toBe(true);
    expect(model('(hide)').hide).toBe(true);
    expect(model('(hide no)').hide).toBe(false);
    expect(model('').hide).toBe(false);
  });

  const footprint = (tokens: string) =>
    boardWith(`(footprint "L:F" (layer "F.Cu") ${tokens} (at 0 0))`).footprints[0]!;

  it('locked on a footprint: parseMaybeAbsentBool( true ) at :5074', () => {
    // The bare form is how `(module …)` wrote it before 6.0.
    expect(footprint('locked').locked).toBe(true);
    expect(footprint('(locked)').locked).toBe(true);
    expect(footprint('(locked no)').locked).toBe(false);
    expect(footprint('').locked).toBe(false);
  });

  // Segments (:7389), arcs (:7294), vias (:7591), graphic shapes (:3611),
  // text boxes (:4181) and dimensions (:4951) all share one reader helper, so
  // each item kind gets its own row: a single-kind assertion could not tell a
  // helper that stopped being reached from one that is still right.
  const lockable: Array<
    [string, string, (b: ReturnType<typeof boardWith>) => boolean | undefined]
  > = [
    [
      'segment',
      '(segment (start 0 0) (end 1 1) (width 0.2) (layer "F.Cu") (net 0) TOKEN)',
      (b) => b.tracks[0]!.locked,
    ],
    [
      'arc',
      '(arc (start 0 0) (mid 1 0) (end 1 1) (width 0.2) (layer "F.Cu") (net 0) TOKEN)',
      (b) => b.arcs[0]!.locked,
    ],
    [
      'via',
      '(via (at 5 5) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0) TOKEN)',
      (b) => b.vias[0]!.locked,
    ],
    [
      'gr_line',
      '(gr_line (start 0 0) (end 1 1) (stroke (width 0.1) (type default)) (layer "F.SilkS") TOKEN)',
      (b) => b.shapes[0]!.locked,
    ],
    [
      'gr_text_box',
      '(gr_text_box "t" (start 0 0) (end 5 5) (layer "F.SilkS") TOKEN)',
      (b) => b.textBoxes[0]!.locked,
    ],
    [
      'dimension',
      '(dimension (type aligned) (layer "Dwgs.User") (pts (xy 0 0) (xy 9 0)) ' +
        '(style (thickness 0.1) (arrow_length 1)) TOKEN)',
      (b) => b.dimensions[0]!.locked,
    ],
  ];

  for (const [name, template, pick] of lockable) {
    it(`locked on a ${name}: parseMaybeAbsentBool( true )`, () => {
      expect(pick(boardWith(template.replace('TOKEN', 'locked')))).toBe(true);
      expect(pick(boardWith(template.replace('TOKEN', '(locked)')))).toBe(true);
      expect(pick(boardWith(template.replace('TOKEN', '(locked no)')))).toBe(false);
      expect(pick(boardWith(template.replace('TOKEN', '')))).toBeUndefined();
    });
  }

  const via = (tokens: string) =>
    boardWith(`(via (at 5 5) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0) ${tokens})`)
      .vias[0]!;
  const pad = (tokens: string) =>
    boardWith(
      `(footprint "L:F" (layer "F.Cu") (at 0 0) ` +
        `(pad "1" thru_hole circle (at 0 0) (size 1 1) (drill 0.5) (layers "*.Cu") ${tokens}))`,
    ).footprints[0]!.pads[0]!;

  it('remove_unused_layers / keep_end_layers / start_end_only: parseMaybeAbsentBool( true )', () => {
    // :6366 and :6373 on a pad; :7497, :7503 and :7509 on a via. Both the
    // argument-less list and the bare token have to reach the same place.
    expect(via('(remove_unused_layers)').unconnectedLayerMode).toBe('remove_all');
    expect(via('remove_unused_layers').unconnectedLayerMode).toBe('remove_all');
    expect(via('(keep_end_layers)').unconnectedLayerMode).toBe('remove_except_start_and_end');
    expect(via('keep_end_layers').unconnectedLayerMode).toBe('remove_except_start_and_end');
    expect(via('(start_end_only)').unconnectedLayerMode).toBe('start_end_only');
    expect(via('start_end_only').unconnectedLayerMode).toBe('start_end_only');
    expect(pad('(remove_unused_layers)').unconnectedLayerMode).toBe('remove_all');
    expect(pad('remove_unused_layers').unconnectedLayerMode).toBe('remove_all');
    // A via ignores an explicit `no` (it only ever calls the setter with true),
    // a pad applies it — so the default is not the only thing under test here.
    expect(via('(remove_unused_layers no)').unconnectedLayerMode).toBeUndefined();
    expect(pad('(remove_unused_layers no)').unconnectedLayerMode).toBe('keep_all');
  });
});

// ---------------------------------------------------------------------------
// Expecting( "yes or no" )
// ---------------------------------------------------------------------------

describe('a malformed flag is an error, not a default', () => {
  it('refuses a board whose `hide` argument is not a boolean', () => {
    expect(() =>
      boardWith(
        '(gr_text "x" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1)) (hide sometimes)))',
      ),
    ).toThrow(/Expecting "yes or no"/);
  });

  it('accepts `true`/`false`, which pcbnew — unlike eeschema — allows', () => {
    // pcb_io_kicad_sexpr_parser.cpp:274 and :276.
    expect(
      boardWith('(gr_text "x" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1) (bold true))))')
        .texts[0]!.bold,
    ).toBe(true);
    expect(
      boardWith('(gr_text "x" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1) (bold false))))')
        .texts[0]!.bold,
    ).toBe(false);
  });
});
