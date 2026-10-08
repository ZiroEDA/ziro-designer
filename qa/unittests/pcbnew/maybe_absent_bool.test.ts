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
import type { EDA_TEXT } from '@ziroeda/common/eda_text.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { BOARD } from '@ziroeda/pcbnew/board.js';
import type { BOARD_ITEM } from '@ziroeda/pcbnew/board_item.js';
import type { FOOTPRINT } from '@ziroeda/pcbnew/footprint.js';
import { UNCONNECTED_LAYER_MODE } from '@ziroeda/pcbnew/padstack.js';
import type { PCB_DIMENSION_BASE } from '@ziroeda/pcbnew/pcb_dimension.js';
import type { PCB_TEXT } from '@ziroeda/pcbnew/pcb_text.js';
import type { PCB_VIA } from '@ziroeda/pcbnew/pcb_track.js';
import {
  FormatBoard,
  FormatFootprintForLibrary,
  ParseBoard,
  ParseFootprintFile,
} from '@ziroeda/pcbnew/pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

const dataFile = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../data/${rel}`, import.meta.url)), 'utf8');

const valueHidden = (fp: FOOTPRINT): boolean => !fp.GetField(FIELD_T.VALUE)!.IsVisible();
const referenceHidden = (fp: FOOTPRINT): boolean => !fp.GetField(FIELD_T.REFERENCE)!.IsVisible();
/**
 * The hidden texts a file can hide: Reference, Value and the fp_texts. The
 * Datasheet and Description fields are born invisible (FOOTPRINT's
 * constructor), so they say nothing about how a `hide` was read.
 */
const hiddenTexts = (fp: FOOTPRINT): EDA_TEXT[] =>
  [
    fp.GetField(FIELD_T.REFERENCE)!,
    fp.GetField(FIELD_T.VALUE)!,
    ...fp.GraphicalItems().filter((t) => t.Type() === KICAD_T.PCB_TEXT_T),
  ].filter((t) => !(t as unknown as EDA_TEXT).IsVisible()) as unknown as EDA_TEXT[];
const boardTexts = (b: BOARD): PCB_TEXT[] =>
  b.Drawings().filter((d) => d.Type() === KICAD_T.PCB_TEXT_T) as PCB_TEXT[];

// ---------------------------------------------------------------------------
// Real KiCad output
// ---------------------------------------------------------------------------

describe('files KiCad wrote', () => {
  it('hides the Value text bitmap2component marked with a bare `hide`', () => {
    // `(fp_text value "LOGO" (at 0.75 0) (layer "F.SilkS") hide …)`, written by
    // the installed KiCad 10.0.5's own bitmap2component.
    const fp = ParseFootprintFile(dataFile('bitmap2component/kicad_square24_300dpi.kicad_mod'));
    expect(valueHidden(fp)).toBe(true);
    // The reference text in the same file carries no `hide` at all.
    expect(referenceHidden(fp)).toBe(false);
  });

  it('keeps that hidden Value hidden across a write and a re-read', () => {
    // We re-emit `(hide yes)` rather than the bare token, so the round trip is
    // also the proof that the two spellings mean the same thing to us.
    const fp = ParseFootprintFile(dataFile('bitmap2component/kicad_square24_300dpi.kicad_mod'));
    const back = ParseFootprintFile(FormatFootprintForLibrary(fp));
    expect(valueHidden(back)).toBe(true);
    expect(referenceHidden(back)).toBe(false);
  });

  it('hides both bare-`hide` footprint texts of a v20220211 board', () => {
    // qa/data/pcbnew/issue10906.kicad_pcb — KiCad's own corpus.
    const board = ParseBoard(dataFile('pcbnew/issue10906.kicad_pcb'));
    const hidden = board.Footprints().flatMap(hiddenTexts);
    expect(hidden).toHaveLength(2);
    expect(board.Footprints().filter(valueHidden)).toHaveLength(1);
    expect(board.Footprints().filter(referenceHidden)).toHaveLength(1);

    const back = ParseBoard(FormatBoard(board));
    expect(back.Footprints().flatMap(hiddenTexts)).toHaveLength(2);
  });

  it('reads the bare `bold` inside `(font …)` of a v20220621 board', () => {
    // qa/data/pcbnew/connection_width_rules.kicad_pcb has six
    // `(effects (font (size 0.2 0.2) (thickness 0.04) bold) …)` texts and no
    // other text at all, so "some are bold" cannot pass by accident.
    const board = ParseBoard(dataFile('pcbnew/connection_width_rules.kicad_pcb'));
    expect(boardTexts(board).length).toBeGreaterThan(0);
    expect(boardTexts(board).every((t) => t.IsBold())).toBe(true);
    expect(boardTexts(board).every((t) => !t.IsItalic())).toBe(true);

    const back = ParseBoard(FormatBoard(board));
    expect(boardTexts(back).every((t) => t.IsBold())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// One assertion per call site, driven by the bare form
// ---------------------------------------------------------------------------

const boardWith = (body: string): BOARD =>
  ParseBoard(`(kicad_pcb (version 20241229) (generator "test") ${body})`);
const firstOf = <T extends BOARD_ITEM>(b: BOARD, type: KICAD_T): T =>
  [...b.Tracks(), ...b.Drawings()].find((i) => i.Type() === type)! as T;

describe('the default at each call site', () => {
  const teardrops = (inner: string) =>
    firstOf<PCB_VIA>(
      boardWith(
        `(via (at 10 10) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0) (teardrops ${inner}))`,
      ),
      KICAD_T.PCB_VIA_T,
    ).GetTeardropParams();

  it('enabled: parseMaybeAbsentBool( true ) at :682', () => {
    // TEARDROP_PARAMETERS's ctor leaves m_Enabled false, so a bare token that
    // read as its own default would be indistinguishable from an absent one.
    expect(teardrops('(enabled)').m_Enabled).toBe(true);
    expect(teardrops('enabled').m_Enabled).toBe(true);
    expect(teardrops('(enabled no)').m_Enabled).toBe(false);
    expect(teardrops('(best_length_ratio 0.5)').m_Enabled).toBe(false);
  });

  it('allow_two_segments: parseMaybeAbsentBool( true ) at :686', () => {
    expect(teardrops('(allow_two_segments)').m_AllowUseTwoTracks).toBe(true);
    expect(teardrops('allow_two_segments').m_AllowUseTwoTracks).toBe(true);
    expect(teardrops('(allow_two_segments no)').m_AllowUseTwoTracks).toBe(false);
  });

  it('prefer_zone_connections: parseMaybeAbsentBool( FALSE ) at :690, stored inverted', () => {
    // The one call site on this list whose default is false, and upstream
    // negates it into m_TdOnPadsInZones.
    expect(teardrops('(prefer_zone_connections)').m_TdOnPadsInZones).toBe(true);
    expect(teardrops('prefer_zone_connections').m_TdOnPadsInZones).toBe(true);
    expect(teardrops('(prefer_zone_connections yes)').m_TdOnPadsInZones).toBe(false);
    expect(teardrops('(prefer_zone_connections no)').m_TdOnPadsInZones).toBe(true);
  });

  it('curved_edges: parseMaybeAbsentBool( true ) at :720', () => {
    expect(teardrops('(curved_edges)').m_CurvedEdges).toBe(true);
    expect(teardrops('curved_edges').m_CurvedEdges).toBe(true);
    expect(teardrops('(curved_edges no)').m_CurvedEdges).toBe(false);
  });

  const dimension = (fmt: string, style: string) =>
    firstOf<PCB_DIMENSION_BASE>(
      boardWith(
        `(dimension (type aligned) (layer "Dwgs.User") (pts (xy 0 0) (xy 10 0)) ` +
          `(format ${fmt}) (style (thickness 0.1) (arrow_length 1) ${style}))`,
      ),
      KICAD_T.PCB_DIM_ALIGNED_T,
    );

  it('suppress_zeroes: parseMaybeAbsentBool( true ) at :4727', () => {
    expect(dimension('(units 3) (suppress_zeroes)', '').GetSuppressZeroes()).toBe(true);
    expect(dimension('(units 3) suppress_zeroes', '').GetSuppressZeroes()).toBe(true);
    expect(dimension('(units 3) (suppress_zeroes no)', '').GetSuppressZeroes()).toBe(false);
  });

  it('keep_text_aligned: parseMaybeAbsentBool( true ) at :4802', () => {
    expect(dimension('(units 3)', '(keep_text_aligned)').GetKeepTextAligned()).toBe(true);
    expect(dimension('(units 3)', 'keep_text_aligned').GetKeepTextAligned()).toBe(true);
    expect(dimension('(units 3)', '(keep_text_aligned no)').GetKeepTextAligned()).toBe(false);
  });

  const grText = (effects: string) =>
    boardTexts(boardWith(`(gr_text "x" (at 0 0) (layer "F.SilkS") (effects ${effects}))`))[0]!;

  it('bold: parseMaybeAbsentBool( true ) at :803', () => {
    expect(grText('(font (size 1 1) bold)').IsBold()).toBe(true);
    expect(grText('(font (size 1 1) (bold))').IsBold()).toBe(true);
    expect(grText('(font (size 1 1) (bold no))').IsBold()).toBe(false);
    expect(grText('(font (size 1 1))').IsBold()).toBe(false);
  });

  it('italic: parseMaybeAbsentBool( true ) at :807', () => {
    expect(grText('(font (size 1 1) italic)').IsItalic()).toBe(true);
    expect(grText('(font (size 1 1) (italic))').IsItalic()).toBe(true);
    expect(grText('(font (size 1 1) (italic no))').IsItalic()).toBe(false);
    expect(grText('(font (size 1 1))').IsItalic()).toBe(false);
  });

  it('hide inside (effects …): parseMaybeAbsentBool( true ) at :841', () => {
    // parseEDA_TEXT's own hide, the pre-v7 location. It is read, but on a BOARD
    // text it changes nothing: "Hidden PCB text is no longer supported",
    // parsePCB_TEXT sets the text visible again (…_parser.cpp:3830-3831).
    expect(grText('(font (size 1 1)) hide').IsVisible()).toBe(true);
    expect(grText('(font (size 1 1)) (hide)').IsVisible()).toBe(true);
    expect(grText('(font (size 1 1)) (hide no)').IsVisible()).toBe(true);
    expect(grText('(font (size 1 1))').IsVisible()).toBe(true);
  });

  const fpValue = (tokens: string) =>
    boardWith(
      `(footprint "L:F" (layer "F.Cu") (at 0 0) ` +
        `(fp_text value "V" (at 0 0) (layer "F.Fab") ${tokens} (effects (font (size 1 1)))))`,
    ).Footprints()[0]!;

  it('hide on the text item: parseMaybeAbsentBool( true ) at :3913', () => {
    expect(valueHidden(fpValue('hide'))).toBe(true);
    expect(valueHidden(fpValue('(hide)'))).toBe(true);
    expect(valueHidden(fpValue('(hide no)'))).toBe(false);
    expect(valueHidden(fpValue(''))).toBe(false);
  });

  const model = (tokens: string) =>
    boardWith(
      `(footprint "L:F" (layer "F.Cu") (at 0 0) (model "x.step" ${tokens} (offset (xyz 0 0 0))))`,
    )
      .Footprints()[0]!
      .Models()[0]!;

  it('hide on a 3D model: parseMaybeAbsentBool( true ) at :955', () => {
    expect(model('hide').m_Show).toBe(false);
    expect(model('(hide)').m_Show).toBe(false);
    expect(model('(hide no)').m_Show).toBe(true);
    expect(model('').m_Show).toBe(true);
  });

  const footprint = (tokens: string) =>
    boardWith(`(footprint "L:F" (layer "F.Cu") ${tokens} (at 0 0))`).Footprints()[0]!;

  it('locked on a footprint: parseMaybeAbsentBool( true ) at :5074', () => {
    // The bare form is how `(module …)` wrote it before 6.0.
    expect(footprint('locked').IsLocked()).toBe(true);
    expect(footprint('(locked)').IsLocked()).toBe(true);
    expect(footprint('(locked no)').IsLocked()).toBe(false);
    expect(footprint('').IsLocked()).toBe(false);
  });

  // Segments (:7389), arcs (:7294), vias (:7591), graphic shapes (:3611),
  // text boxes (:4181) and dimensions (:4951) all share one reader helper, so
  // each item kind gets its own row.
  const lockable: Array<[string, string, KICAD_T]> = [
    [
      'segment',
      '(segment TOKEN (start 0 0) (end 1 1) (width 0.2) (layer "F.Cu") (net 0))',
      KICAD_T.PCB_TRACE_T,
    ],
    [
      'arc',
      '(arc TOKEN (start 0 0) (mid 1 0) (end 1 1) (width 0.2) (layer "F.Cu") (net 0))',
      KICAD_T.PCB_ARC_T,
    ],
    [
      'via',
      '(via TOKEN (at 5 5) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0))',
      KICAD_T.PCB_VIA_T,
    ],
    [
      'gr_line',
      '(gr_line BARE (start 0 0) (end 1 1) (stroke (width 0.1) (type default)) (layer "F.SilkS") LIST)',
      KICAD_T.PCB_SHAPE_T,
    ],
    [
      'gr_text_box',
      '(gr_text_box BARE "t" (start 0 0) (end 5 5) (layer "F.SilkS") LIST)',
      KICAD_T.PCB_TEXTBOX_T,
    ],
    [
      'dimension',
      '(dimension BARE (type aligned) (layer "Dwgs.User") (pts (xy 0 0) (xy 9 0)) ' +
        '(style (thickness 0.1) (arrow_length 1)) LIST)',
      KICAD_T.PCB_DIM_ALIGNED_T,
    ],
  ];

  // The bare word is the legacy form, and the parser takes it only where the
  // 5.99 writer put it: before the first child. BARE and LIST mark the two
  // places a shape and a text box take the two forms.
  const withToken = (template: string, bare: string, list: string): string =>
    template.includes('BARE')
      ? template.replace('BARE', bare).replace('LIST', list)
      : template.replace('TOKEN', bare || list);
  for (const [name, template, type] of lockable) {
    it(`locked on a ${name}: parseMaybeAbsentBool( true )`, () => {
      const locked = (bare: string, list: string): boolean =>
        firstOf(boardWith(withToken(template, bare, list)), type).IsLocked();
      expect(locked('locked', '')).toBe(true);
      expect(locked('', '(locked)')).toBe(true);
      expect(locked('', '(locked no)')).toBe(false);
      // `BOARD_ITEM::m_isLocked` starts false.
      expect(locked('', '')).toBe(false);
    });
  }

  const viaMode = (tokens: string) =>
    firstOf<PCB_VIA>(
      boardWith(`(via (at 5 5) (size 0.8) (drill 0.4) (layers "F.Cu" "B.Cu") (net 0) ${tokens})`),
      KICAD_T.PCB_VIA_T,
    )
      .Padstack()
      .UnconnectedLayerMode();
  const padMode = (tokens: string) =>
    boardWith(
      `(footprint "L:F" (layer "F.Cu") (at 0 0) ` +
        `(pad "1" thru_hole circle (at 0 0) (size 1 1) (drill 0.5) (layers "*.Cu") ${tokens}))`,
    )
      .Footprints()[0]!
      .Pads()[0]!
      .Padstack()
      .UnconnectedLayerMode();

  it('remove_unused_layers / keep_end_layers / start_end_only: parseMaybeAbsentBool( true )', () => {
    // :6366 and :6373 on a pad; :7497, :7503 and :7509 on a via.
    expect(viaMode('(remove_unused_layers)')).toBe(UNCONNECTED_LAYER_MODE.REMOVE_ALL);
    expect(viaMode('(keep_end_layers)')).toBe(UNCONNECTED_LAYER_MODE.REMOVE_EXCEPT_START_AND_END);
    expect(viaMode('(start_end_only)')).toBe(UNCONNECTED_LAYER_MODE.START_END_ONLY);
    expect(padMode('(remove_unused_layers)')).toBe(UNCONNECTED_LAYER_MODE.REMOVE_ALL);
    // A via ignores an explicit `no` (it only ever calls the setter with true),
    // a pad applies it; KEEP_ALL is the padstack's starting mode either way.
    expect(viaMode('(remove_unused_layers no)')).toBe(UNCONNECTED_LAYER_MODE.KEEP_ALL);
    expect(padMode('(remove_unused_layers no)')).toBe(UNCONNECTED_LAYER_MODE.KEEP_ALL);
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
    ).toThrow(/Expecting yes or no/);
  });

  it('accepts `true`/`false`, which pcbnew — unlike eeschema — allows', () => {
    // pcb_io_kicad_sexpr_parser.cpp:274 and :276.
    expect(grTextOf('(bold true)').IsBold()).toBe(true);
    expect(grTextOf('(bold false)').IsBold()).toBe(false);
  });
});

function grTextOf(bold: string): PCB_TEXT {
  return boardTexts(
    boardWith(`(gr_text "x" (at 0 0) (layer "F.SilkS") (effects (font (size 1 1) ${bold})))`),
  )[0]!;
}
