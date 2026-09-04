// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PCB clipboard: cut / copy / copy-with-reference / paste / paste-special.
 *
 * The payload is text that KiCad also has to read, so wherever a check can be
 * made against the *serialized document* rather than the model it is, and the
 * real demo board is round-tripped end to end.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr';
import { readBoard } from '@ziroeda/pcbnew/src/read-board.js';
import { serializeBoard } from '@ziroeda/pcbnew/src/write-board.js';
import {
  boardItemId,
  deleteBoardItems,
  groupBoardItems,
  setBoardItemsLocked,
} from '@ziroeda/pcbnew/src/edit-board.js';
import {
  PASTE_DEFAULT_REFERENCE,
  PASTE_MODES,
  copySelectionToClipboardText,
  cutSelectionToClipboardText,
  parseClipboardText,
  pasteIntoBoard,
} from '@ziroeda/pcbnew/src/pcb_clipboard.js';
import type {
  Board,
  PcbFootprint,
  PcbPad,
  PcbShape,
  PcbTextItem,
  PcbTrack,
  PcbVia,
  PcbZone,
} from '@ziroeda/pcbnew/src/types.js';

const DEMO = new URL('../../../designer/public/demos/ecc83/ecc83-pp_v2.kicad_pcb', import.meta.url);
const demoBoard = (): Board => readBoard(parse(readFileSync(DEMO, 'utf8')));

/**
 * A board built from real `.kicad_pcb` text, so every item carries the `source`
 * node the writer emits from.
 *
 * The hand-built fixtures below are convenient but they are *source-less*, and
 * the writer's canonical builders are not lossless: `buildPadNode` writes no
 * `(net …)` and `buildZoneNode` writes no `(name …)`. Anything that asserts on
 * those fields has to come through text, which is also how the clipboard is
 * used for real.
 */
const fromText = (body: string, nets = '(net 0 "")'): Board =>
  readBoard(
    parse(
      [
        '(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")',
        '  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (5 "F.SilkS" user) (25 "Edge.Cuts" user))',
        `  ${nets}`,
        body,
        ')',
      ].join('\n'),
    ),
  );

const VIA_TEXT =
  '(via (at 3 3) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 0)' +
  ' (uuid "10000000-0000-4000-8000-000000000001"))';
const TRACK_TEXT =
  '(segment (start 0 0) (end 1 0) (width 0.2) (layer "F.Cu") (net 0)' +
  ' (uuid "10000000-0000-4000-8000-000000000002"))';
const NAMED_ZONE_TEXT =
  '(zone (net 0) (net_name "") (layer "F.Cu")' +
  ' (uuid "10000000-0000-4000-8000-000000000003") (name "keepout")' +
  ' (hatch edge 0.5) (connect_pads (clearance 0.5)) (min_thickness 0.25)' +
  ' (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))' +
  ' (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))';
const LOCKED_NETTED_FP_TEXT =
  '(footprint "L:R" (layer "F.Cu") (uuid "10000000-0000-4000-8000-000000000007") (at 10 10)' +
  ' (locked yes)' +
  ' (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 4 "GND")' +
  '   (uuid "10000000-0000-4000-8000-000000000008")))';
const NETTED_FP_TEXT =
  '(footprint "L:R" (layer "F.Cu") (uuid "10000000-0000-4000-8000-000000000004") (at 10 10)' +
  ' (property "Reference" "R1" (at 0 -2) (layer "F.SilkS")' +
  '   (uuid "10000000-0000-4000-8000-000000000005")' +
  '   (effects (font (size 1 1) (thickness 0.15))))' +
  ' (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 4 "GND")' +
  '   (uuid "10000000-0000-4000-8000-000000000006")))';

const EMPTY = { kind: 'list' as const, items: [] };

const LAYERS = [
  { id: 0, name: 'F.Cu', kind: 'signal' },
  { id: 2, name: 'B.Cu', kind: 'signal' },
  { id: 5, name: 'F.SilkS', kind: 'user' },
  { id: 25, name: 'Edge.Cuts', kind: 'user' },
];

const track = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  net = 0,
): PcbTrack => ({
  start,
  end,
  width: 200000,
  layer: 'F.Cu',
  net,
  source: EMPTY,
});

const via = (
  at: { x: number; y: number },
  layers: [string, string] = ['F.Cu', 'B.Cu'],
): PcbVia => ({
  at,
  size: 600000,
  drill: 300000,
  layers,
  kind: 'through',
  net: 0,
  source: EMPTY,
});

const pad = (at: { x: number; y: number }, number = '1', net?: number): PcbPad => ({
  number,
  type: 'smd',
  shape: 'rect',
  at,
  angle: 0,
  size: { x: 1000000, y: 1000000 },
  layers: ['F.Cu'],
  ...(net === undefined ? {} : { net }),
  source: EMPTY,
});

const fpText = (
  kind: PcbTextItem['kind'],
  text: string,
  at: { x: number; y: number },
): PcbTextItem => ({
  kind,
  text,
  at,
  angle: 0,
  layer: 'F.SilkS',
  size: { x: 1000000, y: 1000000 },
  source: EMPTY,
});

const footprint = (over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'Lib:R',
  at: { x: 10000000, y: 10000000 },
  angle: 0,
  layer: 'F.Cu',
  pads: [],
  shapes: [],
  texts: [],
  points: [],
  models: [],
  source: EMPTY,
  ...over,
});

const shape = (layer: string): PcbShape => ({
  kind: 'line',
  start: { x: 0, y: 0 },
  end: { x: 1000000, y: 0 },
  width: 100000,
  fill: false,
  layer,
  source: EMPTY,
});

const zone = (over: Partial<PcbZone> = {}): PcbZone => ({
  net: 0,
  layers: ['F.Cu'],
  fills: [],
  outline: [
    { x: 0, y: 0 },
    { x: 5000000, y: 0 },
    { x: 5000000, y: 5000000 },
  ],
  source: EMPTY,
  ...over,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20241229,
  layers: LAYERS,
  nets: new Map([[0, '']]),
  footprints: [],
  tracks: [],
  arcs: [],
  vias: [],
  zones: [],
  shapes: [],
  texts: [],
  textBoxes: [],
  tables: [],
  images: [],
  dimensions: [],
  points: [],
  groups: [],
  source: { kind: 'list', items: [{ kind: 'atom', value: 'kicad_pcb' }] },
  ...over,
});

/** Parse a payload, failing the test rather than returning null. */
function mustParse(text: string): NonNullable<ReturnType<typeof parseClipboardText>> {
  const p = parseClipboardText(text);
  expect(p).not.toBeNull();
  return p!;
}

// -----------------------------------------------------------------------------
// payload shape
// -----------------------------------------------------------------------------

describe('copySelectionToClipboardText: the payload document', () => {
  it('is a kicad_pcb document with the board header CLIPBOARD_IO writes', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 1000000, y: 0 })] });
    const text = copySelectionToClipboardText(b, ['track:0']);

    // "we will fake being a .kicad_pcb to get the full parser kicking.
    //  This means we also need layers and nets" (kicad_clipboard.cpp:314).
    expect(text.startsWith('(kicad_pcb')).toBe(true);
    expect(text).toContain('(version 20241229)');
    expect(text).toContain('(layers');
    expect(text).toContain('(0 "F.Cu" signal)');
    expect(text).toContain('(25 "Edge.Cuts" user)');
    expect(text).toContain('(segment');
  });

  it('names us, not pcbnew, in the generator stamp', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 1000000, y: 0 })] });
    const text = copySelectionToClipboardText(b, ['track:0']);
    expect(text).toContain('(generator "ziro_designer")');
    expect(text).not.toContain('"pcbnew"');
  });

  it('declares only the nets its items reference, plus net 0', () => {
    const b = board({
      nets: new Map([
        [0, ''],
        [1, 'GND'],
        [2, 'VCC'],
        [3, 'UNUSED'],
      ]),
      tracks: [track({ x: 0, y: 0 }, { x: 1000000, y: 0 }, 2)],
    });
    const text = copySelectionToClipboardText(b, ['track:0']);
    expect(text).toContain('(net 0 "")');
    expect(text).toContain('(net 2 "VCC")');
    expect(text).not.toContain('"GND"');
    expect(text).not.toContain('"UNUSED"');
  });

  it('declares each net exactly once', () => {
    // The unconnected net is written by the header itself, so a copied item
    // that sits on net 0 must not make it be declared a second time.
    const b = board({
      nets: new Map([
        [0, ''],
        [2, 'VCC'],
      ]),
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000000, y: 0 }, 2),
        track({ x: 0, y: 2000000 }, { x: 1000000, y: 2000000 }, 0),
      ],
    });
    const text = copySelectionToClipboardText(b, ['track:0', 'track:1']);
    expect(text.split('(net 0 "")').length - 1).toBe(1);
    expect(text.split('(net 2 "VCC")').length - 1).toBe(1);
  });

  it("carries the donor board's file version, not a constant", () => {
    const b = {
      ...board({ tracks: [track({ x: 0, y: 0 }, { x: 1000000, y: 0 })] }),
      version: 20230620,
    };
    expect(copySelectionToClipboardText(b, ['track:0'])).toContain('(version 20230620)');
  });

  it("carries the donor board's layer block, not a canned one", () => {
    const b = board({
      layers: [
        { id: 0, name: 'F.Cu', kind: 'signal' },
        { id: 4, name: 'In1.Cu', kind: 'signal', userName: 'Power' },
      ],
      tracks: [track({ x: 0, y: 0 }, { x: 1000000, y: 0 })],
    });
    const text = copySelectionToClipboardText(b, ['track:0']);
    expect(text).toContain('(4 "In1.Cu" signal "Power")');
    expect(mustParse(text).board.layers.map((l) => l.name)).toEqual(['F.Cu', 'In1.Cu']);
  });

  it('writes no net block when nothing copied carries a net', () => {
    const b = board({
      nets: new Map([
        [0, ''],
        [1, 'GND'],
      ]),
      shapes: [shape('Edge.Cuts')],
    });
    const text = copySelectionToClipboardText(b, ['shape:0']);
    expect(text).not.toContain('(net ');
  });

  it('returns the empty string for an empty or unresolvable selection', () => {
    const b = board({ tracks: [track({ x: 0, y: 0 }, { x: 1000000, y: 0 })] });
    expect(copySelectionToClipboardText(b, [])).toBe('');
    expect(copySelectionToClipboardText(b, ['track:99'])).toBe('');
    expect(copySelectionToClipboardText(b, ['nonsense'])).toBe('');
  });

  it('carries every board item kind, not just the ones the move overlay draws', () => {
    const b = fromText([TRACK_TEXT, VIA_TEXT, NAMED_ZONE_TEXT, NETTED_FP_TEXT].join('\n'));
    const ids = ['track:0', 'via:0', 'zone:0', 'footprint:0'];
    const p = mustParse(copySelectionToClipboardText(b, ids));
    expect(p.board.tracks).toHaveLength(1);
    expect(p.board.vias).toHaveLength(1);
    expect(p.board.zones).toHaveLength(1);
    expect(p.board.footprints).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// the reference point
// -----------------------------------------------------------------------------

describe('copySelectionToClipboardText: the reference point', () => {
  it('moves the copy so the reference point lands on the origin', () => {
    // "locate the reference point at (0, 0) in the copied items" — copy->Move( -refPoint ).
    const b = board({ tracks: [track({ x: 7000000, y: 3000000 }, { x: 9000000, y: 3000000 })] });
    const p = mustParse(copySelectionToClipboardText(b, ['track:0'], { x: 7000000, y: 3000000 }));
    expect(p.board.tracks[0]!.start).toEqual({ x: 0, y: 0 });
    expect(p.board.tracks[0]!.end).toEqual({ x: 2000000, y: 0 });
  });

  it('leaves the geometry alone when no reference point is given', () => {
    // VECTOR2I refPoint( 0, 0 ) is the fallback for a selection with none.
    const b = board({ tracks: [track({ x: 7000000, y: 3000000 }, { x: 9000000, y: 3000000 })] });
    const p = mustParse(copySelectionToClipboardText(b, ['track:0']));
    expect(p.board.tracks[0]!.start).toEqual({ x: 7000000, y: 3000000 });
  });

  it('anchors a single-footprint payload on the reference point too', () => {
    const b = board({ footprints: [footprint({ at: { x: 4000000, y: 6000000 } })] });
    const p = mustParse(
      copySelectionToClipboardText(b, ['footprint:0'], { x: 4000000, y: 6000000 }),
    );
    expect(p.board.footprints[0]!.at).toEqual({ x: 0, y: 0 });
  });
});

// -----------------------------------------------------------------------------
// locking
// -----------------------------------------------------------------------------

describe('copySelectionToClipboardText: locks', () => {
  it('unlocks every copied item ("copied items therefore can\'t be locked")', () => {
    const base = board({
      tracks: [track({ x: 0, y: 0 }, { x: 1000000, y: 0 })],
      shapes: [shape('Edge.Cuts')],
      texts: [fpText('user', 'hi', { x: 0, y: 0 })],
      dimensions: [],
    });
    const locked = setBoardItemsLocked(base, new Set(['track:0', 'shape:0', 'text:0']), true);
    const text = copySelectionToClipboardText(locked, ['track:0', 'shape:0', 'text:0']);
    expect(text).not.toContain('(locked');
    const p = mustParse(text);
    expect(p.board.tracks[0]!.locked).toBeFalsy();
    expect(p.board.shapes[0]!.locked).toBeFalsy();
  });

  it('unlocks the kinds setBoardItemsLocked does not reach', () => {
    // Text boxes, tables, images and dimensions are lockable upstream and our
    // reader reads their `(locked …)`, but they are not in
    // setBoardItemsLocked's switch. The clipboard must strip their locks all
    // the same, or a pasted item arrives locked in place.
    const b = fromText(
      '(gr_text_box "x" (start 0 0) (end 5 2) (layer "F.SilkS") (locked yes)' +
        ' (uuid "20000000-0000-4000-8000-000000000001")' +
        ' (effects (font (size 1 1))))',
    );
    expect(b.textBoxes[0]!.locked).toBe(true);
    const text = copySelectionToClipboardText(b, ['textbox:0']);
    expect(text).toContain('gr_text_box');
    expect(text).not.toContain('(locked');
    expect(mustParse(text).board.textBoxes[0]!.locked).toBeFalsy();
  });

  it('copies a locked item all the same (only cut filters locks)', () => {
    const base = board({ tracks: [track({ x: 0, y: 0 }, { x: 1000000, y: 0 })] });
    const locked = setBoardItemsLocked(base, new Set(['track:0']), true);
    const p = mustParse(copySelectionToClipboardText(locked, ['track:0']));
    expect(p.board.tracks).toHaveLength(1);
  });
});

// -----------------------------------------------------------------------------
// the single-footprint payload
// -----------------------------------------------------------------------------

describe('copySelectionToClipboardText: a lone footprint', () => {
  // Built from text: a source-less footprint's pads are emitted by
  // `buildPadNode`, which writes no `(net …)` and no `(locked …)` at all, so
  // the assertions below would hold whether or not the code cleared them.
  const fp = (): Board => fromText(LOCKED_NETTED_FP_TEXT, '(net 0 "") (net 4 "GND")');

  it('is a bare footprint document, not a board', () => {
    const text = copySelectionToClipboardText(fp(), ['footprint:0']);
    expect(text.startsWith('(footprint')).toBe(true);
    expect(text).not.toContain('kicad_pcb');
    expect(parseClipboardText(text)!.form).toBe('footprint');
  });

  it('carries the footprint file header upstream stamps on a clipboard footprint', () => {
    const text = copySelectionToClipboardText(fp(), ['footprint:0']);
    expect(text).toContain('(version 20241229)');
    expect(text).toContain('(generator "ziro_designer")');
    expect(text).toContain('(generator_version "1.0")');
  });

  it('zeroes every pad net to "make the footprint safe to transfer to other pcbs"', () => {
    const donor = fp();
    expect(donor.footprints[0]!.pads[0]!.net).toBe(4); // the donor really has one
    const text = copySelectionToClipboardText(donor, ['footprint:0']);
    expect(text).not.toContain('(net ');
    const p = mustParse(text);
    expect(p.board.footprints[0]!.pads[0]!.net ?? 0).toBe(0);
  });

  it('unlocks it', () => {
    const donor = fp();
    expect(donor.footprints[0]!.locked).toBe(true); // the donor really is locked
    const text = copySelectionToClipboardText(donor, ['footprint:0']);
    expect(text).not.toContain('(locked');
    expect(mustParse(text).board.footprints[0]!.locked).toBeFalsy();
  });

  it('stays a board payload when the footprint is copied alongside anything else', () => {
    const b = { ...fp(), tracks: [track({ x: 0, y: 0 }, { x: 1000000, y: 0 })] };
    const text = copySelectionToClipboardText(b, ['footprint:0', 'track:0']);
    expect(text.startsWith('(kicad_pcb')).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// promotion of children (pads, fields)
// -----------------------------------------------------------------------------

describe('copySelectionToClipboardText: promoting footprint children', () => {
  const donor = (): Board =>
    board({
      footprints: [
        footprint({
          reference: 'R7',
          value: '10k',
          pads: [pad({ x: 10000000, y: 10000000 }, '1'), pad({ x: 12000000, y: 10000000 }, '2')],
          texts: [
            fpText('reference', '${REFERENCE}', { x: 10000000, y: 8000000 }),
            fpText('value', '${VALUE}', { x: 10000000, y: 12000000 }),
          ],
        }),
      ],
    });

  it('wraps a lone pad in a blank footprint, carrying no part identity', () => {
    const p = mustParse(copySelectionToClipboardText(donor(), ['pad:0:1']));
    expect(p.board.footprints).toHaveLength(1);
    const wrapper = p.board.footprints[0]!;
    expect(wrapper.pads).toHaveLength(1);
    expect(wrapper.pads[0]!.number).toBe('2');
    expect(wrapper.reference ?? '').toBe('');
    expect(wrapper.lib).toBe('');
  });

  it('keeps the pad where it was on the board', () => {
    const p = mustParse(copySelectionToClipboardText(donor(), ['pad:0:1']));
    expect(p.board.footprints[0]!.pads[0]!.at).toEqual({ x: 12000000, y: 10000000 });
  });

  it('promotes a field to board text, resolving ${REFERENCE} and ${VALUE}', () => {
    const p = mustParse(copySelectionToClipboardText(donor(), ['fptext:0:0', 'fptext:0:1']));
    expect(p.board.texts.map((t) => t.text).sort()).toEqual(['10k', 'R7']);
    expect(p.board.footprints).toHaveLength(0);
  });

  it('does not promote children whose footprint is itself being copied', () => {
    const p = mustParse(
      copySelectionToClipboardText(donor(), ['footprint:0', 'pad:0:0', 'fptext:0:0']),
    );
    expect(p.board.footprints).toHaveLength(1);
    expect(p.board.footprints[0]!.pads).toHaveLength(2);
    expect(p.board.texts).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// groups
// -----------------------------------------------------------------------------

describe('copySelectionToClipboardText: groups', () => {
  const grouped = (): Board => {
    const b = board({
      tracks: [
        {
          ...track({ x: 0, y: 0 }, { x: 1000000, y: 0 }),
          uuid: 'aaaaaaaa-0000-4000-8000-000000000001',
        },
        {
          ...track({ x: 0, y: 1000000 }, { x: 1000000, y: 1000000 }),
          uuid: 'aaaaaaaa-0000-4000-8000-000000000002',
        },
      ],
      shapes: [{ ...shape('Edge.Cuts'), uuid: 'aaaaaaaa-0000-4000-8000-000000000003' }],
    });
    return groupBoardItems(b, new Set(['track:0', 'track:1']), 'G').board;
  };

  it('takes the group and its members (PCB_GROUP::DeepClone)', () => {
    const p = mustParse(copySelectionToClipboardText(grouped(), ['group:0']));
    expect(p.board.groups).toHaveLength(1);
    expect(p.board.tracks).toHaveLength(2);
    expect(p.board.groups[0]!.members).toHaveLength(2);
  });

  it('drops a member the payload does not contain', () => {
    // A group whose member list names something not on the board — a file
    // written by a tool that deleted the item, or a hand-edited one. Upstream's
    // equivalent is `copy->SetParentGroup( nullptr )` for items whose group is
    // not being copied: a group must never claim what did not travel with it.
    const b = fromText(
      [
        TRACK_TEXT,
        '(group "G" (uuid "30000000-0000-4000-8000-000000000001")' +
          ' (members "10000000-0000-4000-8000-000000000002"' +
          '          "deadbeef-0000-4000-8000-000000000000"))',
      ].join('\n'),
    );
    expect(b.groups[0]!.members).toHaveLength(2);
    const p = mustParse(copySelectionToClipboardText(b, ['group:0']));
    expect(p.board.groups[0]!.members).toEqual(['10000000-0000-4000-8000-000000000002']);
  });

  it('takes a nested group as a group, not as a flat pile of items', () => {
    // PCB_GROUP::DeepClone recurses through PCB_GROUP_T members; the editing
    // expansion (expandGroupIds) would flatten them away.
    const inner = fromText([TRACK_TEXT, VIA_TEXT].join('\n'));
    const withInner = groupBoardItems(inner, new Set(['track:0']), 'inner').board;
    const withOuter = groupBoardItems(withInner, new Set(['group:0', 'via:0']), 'outer').board;
    const p = mustParse(copySelectionToClipboardText(withOuter, ['group:1']));
    expect(p.board.groups.map((g) => g.name).sort()).toEqual(['inner', 'outer']);
    expect(p.board.tracks).toHaveLength(1);
    expect(p.board.vias).toHaveLength(1);
    // The outer group still names the inner one, and the inner still names the track.
    const outer = p.board.groups.find((g) => g.name === 'outer')!;
    const innerG = p.board.groups.find((g) => g.name === 'inner')!;
    expect(outer.members).toContain(innerG.uuid);
    expect(innerG.members).toEqual([p.board.tracks[0]!.uuid]);
  });

  it('will not cut a group whose nested group holds a locked item', () => {
    const base = fromText(TRACK_TEXT);
    const withInner = groupBoardItems(base, new Set(['track:0']), 'inner').board;
    const withOuter = groupBoardItems(withInner, new Set(['group:0']), 'outer').board;
    const locked = setBoardItemsLocked(withOuter, new Set(['track:0']), true);
    expect(cutSelectionToClipboardText(locked, ['group:1']).text).toBe('');
  });
});

// -----------------------------------------------------------------------------
// cut
// -----------------------------------------------------------------------------

describe('cutSelectionToClipboardText', () => {
  const two = (): Board =>
    board({
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000000, y: 0 }),
        track({ x: 0, y: 1000000 }, { x: 1000000, y: 1000000 }),
      ],
    });

  it('is copy followed by delete', () => {
    const b = two();
    const r = cutSelectionToClipboardText(b, ['track:0']);
    expect(r.text).toBe(copySelectionToClipboardText(b, ['track:0']));
    expect(r.board.tracks).toHaveLength(1);
    expect(r.board.tracks[0]!.start).toEqual({ x: 0, y: 1000000 });
  });

  it('neither copies nor deletes a locked item', () => {
    // "we only want to delete the items that were copied to the clipboard,
    //  no more, no fewer" — the lock filter runs inside copyToClipboard.
    const b = setBoardItemsLocked(two(), new Set(['track:0']), true);
    const r = cutSelectionToClipboardText(b, ['track:0', 'track:1']);
    expect(r.lockedItemsFiltered).toBe(true);
    expect(r.cut).toEqual(new Set(['track:1']));
    expect(r.board.tracks).toHaveLength(1);
    expect(r.board.tracks[0]!.locked).toBe(true);
    expect(mustParse(r.text).board.tracks).toHaveLength(1);
  });

  it('cuts nothing and leaves the board alone when everything is locked', () => {
    const b = setBoardItemsLocked(two(), new Set(['track:0', 'track:1']), true);
    const r = cutSelectionToClipboardText(b, ['track:0', 'track:1']);
    expect(r.text).toBe('');
    expect(r.board).toBe(b);
    expect(r.lockedItemsFiltered).toBe(true);
  });

  it('cuts locked items when the frame overrides locks', () => {
    const b = setBoardItemsLocked(two(), new Set(['track:0']), true);
    const r = cutSelectionToClipboardText(b, ['track:0'], undefined, { overrideLocks: true });
    expect(r.lockedItemsFiltered).toBe(false);
    expect(r.board.tracks).toHaveLength(1);
    expect(mustParse(r.text).board.tracks).toHaveLength(1);
  });

  it('refuses a group with a locked descendant', () => {
    const base = board({
      tracks: [
        {
          ...track({ x: 0, y: 0 }, { x: 1000000, y: 0 }),
          uuid: 'bbbbbbbb-0000-4000-8000-000000000001',
        },
      ],
    });
    const g = groupBoardItems(base, new Set(['track:0']), 'G').board;
    const locked = setBoardItemsLocked(g, new Set(['track:0']), true);
    const r = cutSelectionToClipboardText(locked, ['group:0']);
    expect(r.lockedItemsFiltered).toBe(true);
    expect(r.text).toBe('');
  });
});

// -----------------------------------------------------------------------------
// parse
// -----------------------------------------------------------------------------

describe('parseClipboardText', () => {
  it('returns null rather than throwing on anything that is not a payload', () => {
    // CLIPBOARD_IO::Parse wraps the parser in catch (...) { item = nullptr; }
    expect(parseClipboardText('')).toBeNull();
    expect(parseClipboardText('   ')).toBeNull();
    expect(parseClipboardText('hello world')).toBeNull();
    expect(parseClipboardText('(unbalanced')).toBeNull();
    expect(parseClipboardText('(kicad_sch (version 20250114))')).toBeNull();
  });

  it('accepts a board payload and a footprint payload', () => {
    const b = board({
      tracks: [track({ x: 0, y: 0 }, { x: 1000000, y: 0 })],
      footprints: [footprint()],
    });
    expect(parseClipboardText(copySelectionToClipboardText(b, ['track:0']))!.form).toBe('board');
    expect(parseClipboardText(copySelectionToClipboardText(b, ['footprint:0']))!.form).toBe(
      'footprint',
    );
  });

  it('accepts a payload in the shape KiCad 10 writes (names in place of net codes)', () => {
    // KiCad 10's CLIPBOARD_IO writes (net "GND") and declares no nets at all.
    // We must not choke on it; the nets simply arrive unresolved (code 0), the
    // documented limit of reading a v10 payload with a code-based model.
    const kicad10 = [
      '(kicad_pcb (version 20260206) (generator "pcbnew") (generator_version "10.0")',
      '  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))',
      '  (segment (start 1 1) (end 2 1) (width 0.2) (layer "F.Cu") (net "GND")',
      '    (uuid "11111111-2222-4333-8444-555555555555"))',
      ')',
    ].join('\n');
    const p = mustParse(kicad10);
    expect(p.form).toBe('board');
    expect(p.board.tracks).toHaveLength(1);
    expect(p.board.tracks[0]!.net).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// paste
// -----------------------------------------------------------------------------

describe('pasteIntoBoard', () => {
  const src = (): Board =>
    board({
      nets: new Map([
        [0, ''],
        [1, 'GND'],
      ]),
      tracks: [
        {
          ...track({ x: 0, y: 0 }, { x: 1000000, y: 0 }, 1),
          uuid: 'cccccccc-0000-4000-8000-000000000001',
        },
      ],
    });

  it('appends the payload and reports the new ids', () => {
    const dest = board({ tracks: [track({ x: 5000000, y: 5000000 }, { x: 6000000, y: 5000000 })] });
    const p = mustParse(copySelectionToClipboardText(src(), ['track:0']));
    const r = pasteIntoBoard(dest, p);
    expect(r.board.tracks).toHaveLength(2);
    expect(r.newIds).toEqual([boardItemId('track', 1)]);
  });

  it('drops the payload at the offset the caller placed it', () => {
    const p = mustParse(copySelectionToClipboardText(src(), ['track:0'], { x: 0, y: 0 }));
    const r = pasteIntoBoard(board(), p, { offset: { x: 3000000, y: -2000000 } });
    expect(r.board.tracks[0]!.start).toEqual({ x: 3000000, y: -2000000 });
    expect(r.board.tracks[0]!.end).toEqual({ x: 4000000, y: -2000000 });
  });

  it('re-stamps every pasted item with a fresh identifier', () => {
    // const_cast<KIID&>( item->m_Uuid ) = KIID();
    const p = mustParse(copySelectionToClipboardText(src(), ['track:0']));
    const pasted = pasteIntoBoard(board(), p).board.tracks[0]!;
    expect(pasted.uuid).toBeDefined();
    expect(pasted.uuid).not.toBe('cccccccc-0000-4000-8000-000000000001');
    // Pasting twice must not produce two items with the same identifier.
    const again = pasteIntoBoard(
      board(),
      mustParse(copySelectionToClipboardText(src(), ['track:0'])),
    ).board.tracks[0]!;
    expect(again.uuid).not.toBe(pasted.uuid);
  });

  it('re-stamps a footprint’s children too', () => {
    const donor = board({
      footprints: [
        footprint({
          uuid: 'dddddddd-0000-4000-8000-000000000001',
          pads: [
            { ...pad({ x: 10000000, y: 10000000 }), uuid: 'dddddddd-0000-4000-8000-000000000002' },
          ],
          texts: [
            {
              ...fpText('reference', 'R1', { x: 10000000, y: 8000000 }),
              uuid: 'dddddddd-0000-4000-8000-000000000003',
            },
          ],
        }),
      ],
    });
    const p = mustParse(copySelectionToClipboardText(donor, ['footprint:0']));
    const out = pasteIntoBoard(board(), p).board.footprints[0]!;
    expect(out.uuid).not.toBe('dddddddd-0000-4000-8000-000000000001');
    expect(out.pads[0]!.uuid).not.toBe('dddddddd-0000-4000-8000-000000000002');
    expect(out.texts[0]!.uuid).not.toBe('dddddddd-0000-4000-8000-000000000003');
  });

  it('clears a pasted footprint’s schematic path', () => {
    // if( aIsNew ) footprint->SetPath( KIID_PATH() );
    const donor = board({
      footprints: [
        footprint({
          path: '/1111/2222',
          source: parse('(footprint "L:R" (layer "F.Cu") (at 10 10) (path "/1111/2222"))'),
        }),
      ],
    });
    const p = mustParse(copySelectionToClipboardText(donor, ['footprint:0']));
    const r = pasteIntoBoard(board(), p);
    expect(r.board.footprints[0]!.path).toBeUndefined();
    expect(serializeBoard(r.board)).not.toContain('/1111/2222');
  });

  it('gives a pasted zone a name the board does not already use', () => {
    // "A pasted zone must not reuse a name already on the board (issue 23131)"
    const donor = fromText(NAMED_ZONE_TEXT);
    const p = mustParse(copySelectionToClipboardText(donor, ['zone:0']));
    const r = pasteIntoBoard(donor, p);
    expect(r.board.zones[0]!.name).toBe('keepout');
    expect(r.board.zones[1]!.name).toBe('keepout_1');
    // The rename has to reach the file, not just the model.
    expect(serializeBoard(r.board)).toContain('(name "keepout_1")');
  });

  it('makes two same-named zones in one payload unique against each other', () => {
    // The clipboard is text a person can write, so a payload can hold two zones
    // with the same name even though a valid board cannot. Each rename has to
    // see the ones before it, not just the destination board.
    const oneZone = (uuid: string): string =>
      '(zone (net 0) (net_name "") (layer "F.Cu")' +
      ` (uuid "${uuid}") (name "keepout")` +
      ' (hatch edge 0.5) (connect_pads (clearance 0.5)) (min_thickness 0.25)' +
      ' (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))' +
      ' (polygon (pts (xy 0 0) (xy 5 0) (xy 5 5))))';
    const payload = [
      '(kicad_pcb (version 20241229) (generator "pcbnew") (generator_version "9.0")',
      '  (layers (0 "F.Cu" signal) (2 "B.Cu" signal))',
      oneZone('40000000-0000-4000-8000-000000000001'),
      oneZone('40000000-0000-4000-8000-000000000002'),
      ')',
    ].join('\n');
    const r = pasteIntoBoard(fromText(NAMED_ZONE_TEXT), mustParse(payload));
    expect(r.board.zones.map((z) => z.name)).toEqual(['keepout', 'keepout_1', 'keepout_2']);
  });

  it('leaves an unnamed zone unnamed', () => {
    const donor = board({ zones: [zone()] });
    const p = mustParse(copySelectionToClipboardText(donor, ['zone:0']));
    expect(pasteIntoBoard(board(), p).board.zones[0]!.name).toBeUndefined();
  });

  it('points a pasted group at the pasted items, never at the originals', () => {
    const base = board({
      tracks: [
        {
          ...track({ x: 0, y: 0 }, { x: 1000000, y: 0 }),
          uuid: 'eeeeeeee-0000-4000-8000-000000000001',
        },
      ],
    });
    const donor = groupBoardItems(base, new Set(['track:0']), 'G').board;
    const p = mustParse(copySelectionToClipboardText(donor, ['group:0']));
    const r = pasteIntoBoard(donor, p);
    const pastedGroup = r.board.groups[1]!;
    const pastedTrack = r.board.tracks[1]!;
    expect(pastedGroup.members).toEqual([pastedTrack.uuid]);
    expect(pastedGroup.members).not.toContain('eeeeeeee-0000-4000-8000-000000000001');
  });
});

// -----------------------------------------------------------------------------
// nets: plain paste vs "Clear net assignments"
// -----------------------------------------------------------------------------

describe('pasteIntoBoard: nets', () => {
  const donor = (): Board =>
    board({
      nets: new Map([
        [0, ''],
        [1, 'GND'],
        [2, 'SIG'],
      ]),
      tracks: [
        track({ x: 0, y: 0 }, { x: 1000000, y: 0 }, 1),
        track({ x: 0, y: 1000000 }, { x: 1000000, y: 1000000 }, 2),
      ],
    });

  it('maps by name onto the destination board’s own codes', () => {
    // BOARD::MapNets: FindNet( item->GetNetname() ), not the code.
    const dest = board({
      nets: new Map([
        [0, ''],
        [1, 'VCC'],
        [2, 'OTHER'],
        [7, 'GND'],
      ]),
    });
    const p = mustParse(copySelectionToClipboardText(donor(), ['track:0']));
    const r = pasteIntoBoard(dest, p);
    expect(r.board.tracks[0]!.net).toBe(7);
    expect(serializeBoard(r.board)).toContain('(net 7)');
  });

  it('creates a net the destination does not have, and declares it', () => {
    const dest = board({
      nets: new Map([
        [0, ''],
        [1, 'VCC'],
      ]),
      source: parse(
        '(kicad_pcb (version 20241229) (general (thickness 1.6)) (net 0 "") (net 1 "VCC"))',
      ),
    });
    const p = mustParse(copySelectionToClipboardText(donor(), ['track:0']));
    const r = pasteIntoBoard(dest, p);
    expect(r.board.nets.get(2)).toBe('GND');
    expect(r.board.tracks[0]!.net).toBe(2);
    const text = serializeBoard(r.board);
    expect(text).toContain('(net 2 "GND")');
    // The declaration has to survive a save/load, or the paste loses its net.
    expect(readBoard(parse(text)).nets.get(2)).toBe('GND');
  });

  it('gives two payload nets two distinct new codes', () => {
    const dest = board({
      nets: new Map([[0, '']]),
      source: parse('(kicad_pcb (version 20241229) (net 0 ""))'),
    });
    const p = mustParse(copySelectionToClipboardText(donor(), ['track:0', 'track:1']));
    const r = pasteIntoBoard(dest, p);
    const codes = r.board.tracks.map((t) => t.net).sort();
    expect(new Set(codes).size).toBe(2);
    expect(r.board.nets.get(codes[0]!)).toBeDefined();
    expect(r.board.nets.get(codes[1]!)).toBeDefined();
  });

  it('maps a pad’s net as well as a track’s', () => {
    const donorFp = fromText(
      [NETTED_FP_TEXT, TRACK_TEXT.replace('(net 0)', '(net 4)')].join('\n'),
      '(net 0 "") (net 4 "GND")',
    );
    const dest = board({
      nets: new Map([
        [0, ''],
        [9, 'GND'],
      ]),
    });
    const p = mustParse(copySelectionToClipboardText(donorFp, ['footprint:0', 'track:0']));
    const r = pasteIntoBoard(dest, p);
    expect(r.board.footprints[0]!.pads[0]!.net).toBe(9);
    expect(r.board.tracks[0]!.net).toBe(9);
    expect(serializeBoard(r.board)).toContain('(net 9 "GND")');
  });

  it('orphans every connected item when "Clear net assignments" is ticked', () => {
    // item->SetNet( NETINFO_LIST::OrphanedItem() ) — code 0, empty name.
    const p = mustParse(copySelectionToClipboardText(donor(), ['track:0', 'track:1']));
    const r = pasteIntoBoard(board({ nets: new Map([[0, '']]) }), p, { clearNets: true });
    expect(r.board.tracks.map((t) => t.net)).toEqual([0, 0]);
    expect(serializeBoard(r.board)).not.toContain('"GND"');
  });

  it('clears pad and zone nets too', () => {
    const donorFp = board({
      nets: new Map([
        [0, ''],
        [4, 'GND'],
      ]),
      footprints: [footprint({ pads: [pad({ x: 10000000, y: 10000000 }, '1', 4)] })],
      zones: [zone({ net: 4, netName: 'GND' })],
    });
    const p = mustParse(copySelectionToClipboardText(donorFp, ['footprint:0', 'zone:0']));
    const r = pasteIntoBoard(board(), p, { clearNets: true });
    expect(r.board.footprints[0]!.pads[0]!.net ?? 0).toBe(0);
    expect(r.board.zones[0]!.net).toBe(0);
  });

  it('does not remap a footprint payload (its pad nets were cleared at copy time)', () => {
    const donorFp = board({
      nets: new Map([
        [0, ''],
        [4, 'GND'],
      ]),
      footprints: [footprint({ pads: [pad({ x: 10000000, y: 10000000 }, '1', 4)] })],
    });
    const p = mustParse(copySelectionToClipboardText(donorFp, ['footprint:0']));
    expect(p.form).toBe('footprint');
    const dest = board({
      nets: new Map([
        [0, ''],
        [9, 'GND'],
      ]),
    });
    const r = pasteIntoBoard(dest, p);
    expect(r.board.footprints[0]!.pads[0]!.net ?? 0).toBe(0);
    expect(r.board.nets.size).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// paste-special: reference designators
// -----------------------------------------------------------------------------

describe('pasteIntoBoard: reference designators', () => {
  const donor = (): Board =>
    board({
      footprints: [
        footprint({
          uuid: 'ffffffff-0000-4000-8000-000000000001',
          reference: 'R1',
          texts: [fpText('reference', 'R1', { x: 10000000, y: 8000000 })],
          source: parse('(footprint "L:R" (layer "F.Cu") (at 10 10))'),
        }),
      ],
    });
  const dest = (): Board =>
    board({
      footprints: [
        footprint({
          uuid: 'ffffffff-0000-4000-8000-0000000000ff',
          reference: 'R1',
          at: { x: 50000000, y: 50000000 },
        }),
      ],
    });

  it('offers exactly DIALOG_PASTE_SPECIAL’s three choices', () => {
    expect([...PASTE_MODES]).toEqual([
      'unique_annotations',
      'keep_annotations',
      'remove_annotations',
    ]);
  });

  it('keeps the duplicate designator by default (a plain ACTIONS::paste)', () => {
    const p = mustParse(copySelectionToClipboardText(donor(), ['footprint:0']));
    const r = pasteIntoBoard(dest(), p);
    expect(r.board.footprints.map((f) => f.reference)).toEqual(['R1', 'R1']);
  });

  it('clears the designator to REF** on "Clear reference designators"', () => {
    const p = mustParse(copySelectionToClipboardText(donor(), ['footprint:0']));
    const r = pasteIntoBoard(dest(), p, { mode: 'remove_annotations' });
    expect(r.board.footprints[1]!.reference).toBe(PASTE_DEFAULT_REFERENCE);
    expect(PASTE_DEFAULT_REFERENCE).toBe('REF**');
    // The Reference *field* has to change too, or the board renders the old one.
    expect(serializeBoard(r.board)).toContain('REF**');
  });

  it('renumbers the clash on "Assign unique reference designators"', () => {
    const p = mustParse(copySelectionToClipboardText(donor(), ['footprint:0']));
    const r = pasteIntoBoard(dest(), p, { mode: 'unique_annotations' });
    const refs = r.board.footprints.map((f) => f.reference);
    expect(new Set(refs).size).toBe(2);
    expect(refs).toContain('R1');
    expect(refs).toContain('R2');
  });
});

// -----------------------------------------------------------------------------
// pruneItemLayers
// -----------------------------------------------------------------------------

describe('pasteIntoBoard: pruning items by layer', () => {
  const donor = (): Board =>
    board({
      layers: [...LAYERS, { id: 4, name: 'In1.Cu', kind: 'signal' }],
      tracks: [track({ x: 0, y: 0 }, { x: 1000000, y: 0 })],
      shapes: [{ ...shape('In1.Cu') }],
    });

  it('drops an item whose layer the destination board does not have', () => {
    const p = mustParse(copySelectionToClipboardText(donor(), ['track:0', 'shape:0']));
    const r = pasteIntoBoard(board(), p); // dest has no In1.Cu
    expect(r.board.shapes).toHaveLength(0);
    expect(r.board.tracks).toHaveLength(1);
    expect(r.prunedCount).toBe(1);
  });

  it('keeps everything when the layers are all present', () => {
    const p = mustParse(copySelectionToClipboardText(donor(), ['track:0', 'shape:0']));
    const r = pasteIntoBoard(board({ layers: donor().layers }), p);
    expect(r.board.shapes).toHaveLength(1);
    expect(r.prunedCount).toBe(0);
  });

  it('skips a via unless BOTH of its layers are on the board', () => {
    // "Ensure, for vias, the top and bottom layers are compatible ...
    //  Otherwise they must be skipped, even is one layer is valid"
    const viaDonor = board({
      layers: [...LAYERS, { id: 4, name: 'In1.Cu', kind: 'signal' }],
      vias: [via({ x: 0, y: 0 }, ['F.Cu', 'In1.Cu']), via({ x: 1000000, y: 0 }, ['F.Cu', 'B.Cu'])],
    });
    const p = mustParse(copySelectionToClipboardText(viaDonor, ['via:0', 'via:1']));
    const r = pasteIntoBoard(board(), p);
    expect(r.board.vias).toHaveLength(1);
    expect(r.board.vias[0]!.layers).toEqual(['F.Cu', 'B.Cu']);
    expect(r.prunedCount).toBe(1);
  });

  it('never prunes a footprint, whatever layers its graphics live on', () => {
    // "Items living in a parent footprint are never removed" — a fp lives in a
    // library that knows nothing of this board's enabled layers.
    const fpDonor = board({
      layers: [...LAYERS, { id: 4, name: 'In1.Cu', kind: 'signal' }],
      footprints: [footprint({ shapes: [shape('In1.Cu')] })],
    });
    const p = mustParse(copySelectionToClipboardText(fpDonor, ['footprint:0']));
    const r = pasteIntoBoard(board(), p);
    expect(r.board.footprints).toHaveLength(1);
    expect(r.prunedCount).toBe(0);
  });

  it('drops a pruned item from the pasted group’s members', () => {
    const base = board({
      layers: [...LAYERS, { id: 4, name: 'In1.Cu', kind: 'signal' }],
      tracks: [
        {
          ...track({ x: 0, y: 0 }, { x: 1000000, y: 0 }),
          uuid: '99999999-0000-4000-8000-000000000001',
        },
      ],
      shapes: [{ ...shape('In1.Cu'), uuid: '99999999-0000-4000-8000-000000000002' }],
    });
    const donorGrouped = groupBoardItems(base, new Set(['track:0', 'shape:0']), 'G').board;
    const p = mustParse(copySelectionToClipboardText(donorGrouped, ['group:0']));
    const r = pasteIntoBoard(board(), p);
    expect(r.board.groups[0]!.members).toHaveLength(1);
    expect(r.board.groups[0]!.members[0]).toBe(r.board.tracks[0]!.uuid);
  });

  it('prunes nothing when the destination declares no layers at all', () => {
    const p = mustParse(copySelectionToClipboardText(donor(), ['shape:0']));
    const r = pasteIntoBoard(board({ layers: [] }), p);
    expect(r.board.shapes).toHaveLength(1);
    expect(r.prunedCount).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// the real board, end to end
// -----------------------------------------------------------------------------

describe('round trip through the demo board', () => {
  it('copy -> parse -> paste -> save -> load keeps the items and their geometry', () => {
    const b = demoBoard();
    const ids = ['footprint:0', 'track:0', 'track:1', 'zone:0'];
    const text = copySelectionToClipboardText(b, ids, b.tracks[0]!.start);
    const pasted = pasteIntoBoard(b, mustParse(text), { offset: b.tracks[0]!.start });

    const reread = readBoard(parse(serializeBoard(pasted.board)));
    expect(reread.footprints).toHaveLength(b.footprints.length + 1);
    expect(reread.tracks).toHaveLength(b.tracks.length + 2);
    expect(reread.zones).toHaveLength(b.zones.length + 1);

    // A copy anchored on track 0's start and dropped on the same point is the
    // original, geometry for geometry.
    expect(reread.tracks[b.tracks.length]!.start).toEqual(b.tracks[0]!.start);
    expect(reread.tracks[b.tracks.length]!.end).toEqual(b.tracks[0]!.end);
    expect(reread.zones[b.zones.length]!.outline).toEqual(b.zones[0]!.outline);
    expect(reread.footprints[b.footprints.length]!.at).toEqual(b.footprints[0]!.at);
  });

  it('keeps the pasted tracks on the nets they were copied from', () => {
    const b = demoBoard();
    const netted = b.tracks.findIndex((t) => t.net > 0);
    expect(netted).toBeGreaterThanOrEqual(0);
    const name = b.nets.get(b.tracks[netted]!.net);
    const text = copySelectionToClipboardText(b, [boardItemId('track', netted)]);
    const r = pasteIntoBoard(b, mustParse(text));
    expect(r.board.nets.get(r.board.tracks[b.tracks.length]!.net)).toBe(name);
    // Mapping into the same board must not invent a net.
    expect(r.board.nets.size).toBe(b.nets.size);
  });

  it('cut then paste is a move', () => {
    const b = demoBoard();
    const before = b.tracks[0]!;
    const cut = cutSelectionToClipboardText(b, ['track:0'], before.start);
    expect(cut.board.tracks).toHaveLength(b.tracks.length - 1);
    const back = pasteIntoBoard(cut.board, mustParse(cut.text), {
      offset: { x: before.start.x + 1000000, y: before.start.y },
    });
    expect(back.board.tracks).toHaveLength(b.tracks.length);
    const moved = back.board.tracks[back.board.tracks.length - 1]!;
    expect(moved.start).toEqual({ x: before.start.x + 1000000, y: before.start.y });
    expect(moved.end).toEqual({ x: before.end.x + 1000000, y: before.end.y });
  });

  it('leaves the source board untouched', () => {
    const b = demoBoard();
    const snapshot = serializeBoard(b);
    copySelectionToClipboardText(b, ['track:0', 'footprint:0'], { x: 1, y: 2 });
    cutSelectionToClipboardText(b, ['track:0']);
    pasteIntoBoard(b, mustParse(copySelectionToClipboardText(b, ['track:0'])));
    expect(serializeBoard(b)).toBe(snapshot);
  });

  it('deleteBoardItems on the cut set is what the cut board is', () => {
    const b = demoBoard();
    const cut = cutSelectionToClipboardText(b, ['track:3', 'track:4']);
    expect(serializeBoard(cut.board)).toBe(
      serializeBoard(deleteBoardItems(b, new Set(['track:3', 'track:4']))),
    );
  });
});
