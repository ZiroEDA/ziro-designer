// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Global Deletions.
 * Counterpart: `DIALOG_GLOBAL_DELETION::DoGlobalDeletions`.
 *
 * Almost every test below pins something a reasonable engineer would "fix" if
 * they ported from the dialog's labels rather than from its code: "Graphics"
 * that silently cancels "Text", "Graphics" that deletes a copper trace-shaped
 * `gr_line` after all, a footprint that survives because the active layer is
 * silkscreen, and markers that outlive an undo.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GLOBAL_DELETION_OPTIONS as DEFAULTS,
  applyGlobalDeletion,
  countGlobalDeletionTargets,
  globalDeletionFilterEnabled,
  globalDeletionIds,
  globalDeletionLayerChoices,
  globalDeletionRebuildsRatsnest,
  layerMatchesDrawingFilter,
  layerMatchesFilter,
  type GlobalDeletionOptions,
} from '@ziroeda/pcbnew/src/global_deletion.js';
import type {
  Board,
  PcbArcTrack,
  PcbDimension,
  PcbFootprint,
  PcbGroup,
  PcbImage,
  PcbShape,
  PcbTable,
  PcbTextBox,
  PcbTextItem,
  PcbTrack,
  PcbVia,
  PcbZone,
} from '@ziroeda/pcbnew/src/types.js';
import type { SList, SNode } from '@ziroeda/sexpr/src/types.js';

const EMPTY: SList = { kind: 'list', items: [] };
const P = (x: number, y: number) => ({ x, y });
const atom = (value: string): SNode => ({ kind: 'atom', value });

/** A source node carrying `(tenting …)`, the only way the model states it. */
const tenting = (...words: string[]): SList => ({
  kind: 'list',
  items: [atom('via'), { kind: 'list', items: [atom('tenting'), ...words.map(atom)] }],
});

const opts = (over: Partial<GlobalDeletionOptions> = {}): GlobalDeletionOptions => ({
  ...DEFAULTS,
  ...over,
});

const board = (over: Partial<Board> = {}): Board => ({
  version: 20240108,
  layers: [
    { id: 0, name: 'F.Cu', kind: 'signal' },
    { id: 1, name: 'In1.Cu', kind: 'signal' },
    { id: 2, name: 'In2.Cu', kind: 'signal' },
    { id: 31, name: 'B.Cu', kind: 'signal' },
    { id: 36, name: 'B.SilkS', kind: 'user' },
    { id: 37, name: 'F.SilkS', kind: 'user' },
    { id: 44, name: 'Edge.Cuts', kind: 'user' },
  ],
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
  groups: [],
  source: EMPTY,
  ...over,
});

const shape = (layer: string, over: Partial<PcbShape> = {}): PcbShape => ({
  kind: 'line',
  start: P(0, 0),
  end: P(1000, 0),
  width: 100,
  fill: false,
  layer,
  source: EMPTY,
  ...over,
});

const track = (layer: string, over: Partial<PcbTrack> = {}): PcbTrack => ({
  start: P(0, 0),
  end: P(1000, 0),
  width: 250,
  layer,
  net: 1,
  source: EMPTY,
  ...over,
});

const arc = (layer: string, over: Partial<PcbArcTrack> = {}): PcbArcTrack => ({
  start: P(0, 0),
  mid: P(500, 100),
  end: P(1000, 0),
  width: 250,
  layer,
  net: 1,
  source: EMPTY,
  ...over,
});

const via = (
  kind: PcbVia['kind'],
  layers: [string, string],
  over: Partial<PcbVia> = {},
): PcbVia => ({
  at: P(0, 0),
  size: 800,
  drill: 400,
  layers,
  kind,
  net: 1,
  source: EMPTY,
  ...over,
});

const zone = (layers: string[], over: Partial<PcbZone> = {}): PcbZone => ({
  net: 1,
  layers,
  fills: [],
  source: EMPTY,
  ...over,
});

const footprint = (layer: string, over: Partial<PcbFootprint> = {}): PcbFootprint => ({
  lib: 'L:R',
  at: P(0, 0),
  angle: 0,
  layer,
  pads: [],
  texts: [],
  shapes: [],
  models: [],
  source: EMPTY,
  ...over,
});

const text = (layer: string, over: Partial<PcbTextItem> = {}): PcbTextItem => ({
  kind: 'user',
  text: 'hi',
  at: P(0, 0),
  angle: 0,
  layer,
  size: P(1000, 1000),
  source: EMPTY,
  ...over,
});

const textBox = (layer: string, over: Partial<PcbTextBox> = {}): PcbTextBox => ({
  text: 'hi',
  start: P(0, 0),
  end: P(1000, 1000),
  margins: { left: 0, top: 0, right: 0, bottom: 0 },
  layer,
  size: P(1000, 1000),
  border: true,
  source: EMPTY,
  ...over,
});

const table = (layer: string): PcbTable => ({
  columnCount: 1,
  layer,
  borderExternal: true,
  borderHeader: true,
  separatorRows: true,
  separatorCols: true,
  columnWidths: [1000],
  rowHeights: [1000],
  cells: [],
  source: EMPTY,
});

const image = (layer: string): PcbImage => ({ at: P(0, 0), layer, data: '', source: EMPTY });

const dimension = (layer: string): PcbDimension => ({
  kind: 'aligned',
  layer,
  start: P(0, 0),
  end: P(1000, 0),
  style: {} as PcbDimension['style'],
  source: EMPTY,
});

const group = (members: string[], over: Partial<PcbGroup> = {}): PcbGroup => ({
  name: 'g',
  members,
  source: EMPTY,
  ...over,
});

// ---------------------------------------------------------------------------

describe('dialog defaults', () => {
  it('starts with every item box off and only the *unlocked* filters on', () => {
    // The dialog calls OptOut() so it always opens benign. If any item box ever
    // defaults to true, pressing OK on an untouched dialog erases board content.
    for (const k of [
      'zones',
      'texts',
      'boardEdges',
      'drawings',
      'footprints',
      'tracks',
      'teardrops',
      'markers',
      'all',
    ] as const)
      expect(DEFAULTS[k]).toBe(false);

    expect(DEFAULTS.drawingFilterLocked).toBe(false);
    expect(DEFAULTS.footprintFilterLocked).toBe(false);
    expect(DEFAULTS.trackFilterLocked).toBe(false);
    expect(DEFAULTS.viaFilterLocked).toBe(false);

    // Locked items are spared by default; unlocked ones are not.
    expect(DEFAULTS.drawingFilterUnlocked).toBe(true);
    expect(DEFAULTS.footprintFilterUnlocked).toBe(true);
    expect(DEFAULTS.trackFilterUnlocked).toBe(true);
    expect(DEFAULTS.viaFilterUnlocked).toBe(true);
  });

  it('defaults to "All layers" even though the generated base selects row 1', () => {
    // SetCurrentLayer() runs unconditionally before the dialog is shown and
    // forces selection 0. Defaulting to "current layer only" would make a
    // "Clear board"-less run quietly spare most of the board.
    expect(DEFAULTS.currentLayerOnly).toBe(false);
  });

  it('deletes nothing at all when nothing is ticked', () => {
    const b = board({
      shapes: [shape('F.SilkS')],
      tracks: [track('F.Cu')],
      zones: [zone(['F.Cu'])],
    });
    expect(globalDeletionIds(b, opts()).size).toBe(0);
  });

  it('re-formats the layer row from a template instead of consuming the %s', () => {
    // SetCurrentLayer() rewrites the stored string in place, so calling it twice
    // upstream would lose the placeholder. Two calls here must differ.
    expect(globalDeletionLayerChoices('F.Cu')[1]).toBe('Current layer (F.Cu) only');
    expect(globalDeletionLayerChoices('B.Cu')[1]).toBe('Current layer (B.Cu) only');
  });
});

describe('filter enablement (the onCheck* handlers)', () => {
  it('ties the drawing filters to Graphics OR Board outlines', () => {
    // The constructor seeds them from m_delDrawings alone; the handlers use the
    // OR. Ticking only "Board outlines" must still enable the graphics filters.
    expect(globalDeletionFilterEnabled(opts({ boardEdges: true })).drawingFilters).toBe(true);
    expect(globalDeletionFilterEnabled(opts({ drawings: true })).drawingFilters).toBe(true);
    expect(globalDeletionFilterEnabled(opts()).drawingFilters).toBe(false);
  });

  it('ties both the track AND via filters to the single "Tracks && vias" box', () => {
    const e = globalDeletionFilterEnabled(opts({ tracks: true }));
    expect(e.trackFilters).toBe(true);
    expect(e.viaFilters).toBe(true);
    expect(e.footprintFilters).toBe(false);
  });

  it('is advisory only — a greyed-out filter still holds its value', () => {
    // Upstream only ever calls Enable(), never SetValue(). A "Clear board" run
    // must not consult enablement, or nothing would be deleted.
    const b = board({ tracks: [track('F.Cu')] });
    expect(globalDeletionFilterEnabled(opts({ all: true })).trackFilters).toBe(false);
    expect(globalDeletionIds(b, opts({ all: true }))).toEqual(new Set(['track:0']));
  });
});

describe('the layer masks', () => {
  it('treats "All layers" as "the item has any layer at all"', () => {
    // all_layers is LSET().set(), so the intersection is non-empty exactly when
    // the layer set is. An unconditional true would delete layer-less items.
    expect(layerMatchesFilter(['F.SilkS'], opts())).toBe(true);
    expect(layerMatchesFilter([], opts())).toBe(false);
  });

  it('matches on intersection, not containment, for "current layer only"', () => {
    // A through via spans the stack; requiring the whole set to be in the mask
    // would spare every multi-layer item.
    expect(
      layerMatchesFilter(
        ['F.Cu', 'In1.Cu', 'B.Cu'],
        opts({ currentLayerOnly: true, currentLayer: 'In1.Cu' }),
      ),
    ).toBe(true);
    expect(
      layerMatchesFilter(
        ['F.Cu', 'B.Cu'],
        opts({ currentLayerOnly: true, currentLayer: 'In1.Cu' }),
      ),
    ).toBe(false);
  });

  it('carves Edge.Cuts out of "Graphics" and puts it back for "Board outlines"', () => {
    // The reset lives inside the Graphics branch and the set runs after it, so
    // ticking both gives non-copper INCLUDING Edge.Cuts.
    const g = opts({ drawings: true });
    const e = opts({ boardEdges: true });
    const both = opts({ drawings: true, boardEdges: true });

    expect(layerMatchesDrawingFilter(['Edge.Cuts'], g)).toBe(false);
    expect(layerMatchesDrawingFilter(['F.SilkS'], g)).toBe(true);
    expect(layerMatchesDrawingFilter(['Edge.Cuts'], e)).toBe(true);
    expect(layerMatchesDrawingFilter(['F.SilkS'], e)).toBe(false);
    expect(layerMatchesDrawingFilter(['Edge.Cuts'], both)).toBe(true);
    expect(layerMatchesDrawingFilter(['F.SilkS'], both)).toBe(true);
  });

  it('never puts a copper layer in the drawing mask', () => {
    // AllNonCuMask(). A gr_line on F.Cu or In1.Cu is spared by "Graphics".
    expect(layerMatchesDrawingFilter(['F.Cu'], opts({ drawings: true }))).toBe(false);
    expect(layerMatchesDrawingFilter(['In1.Cu'], opts({ drawings: true }))).toBe(false);
    expect(layerMatchesDrawingFilter(['B.Cu'], opts({ drawings: true }))).toBe(false);
  });

  it('intersects the drawing mask with the layer filter', () => {
    // drawing_layers_filter &= layers_filter. "Board outlines" plus a silkscreen
    // active layer is an empty mask, i.e. a no-op.
    const o = opts({ boardEdges: true, currentLayerOnly: true, currentLayer: 'F.SilkS' });
    expect(layerMatchesDrawingFilter(['Edge.Cuts'], o)).toBe(false);
  });
});

describe('zones', () => {
  it('routes teardrop areas to "Teardrops" and everything else to "Zones"', () => {
    // The branches are `else if`, so a teardrop area never reaches the Zones
    // test: ticking Zones alone must leave it standing.
    const b = board({ zones: [zone(['F.Cu']), zone(['F.Cu'], { teardropType: 'viapad' })] });

    expect(globalDeletionIds(b, opts({ zones: true }))).toEqual(new Set(['zone:0']));
    expect(globalDeletionIds(b, opts({ teardrops: true }))).toEqual(new Set(['zone:1']));
  });

  it('treats a rule area as an ordinary zone — there is no keepout box', () => {
    const b = board({
      zones: [zone(['F.Cu'], { ruleArea: { tracks: false } as PcbZone['ruleArea'] })],
    });
    expect(globalDeletionIds(b, opts({ zones: true }))).toEqual(new Set(['zone:0']));
  });

  it('expands the layer wildcards the reader stores verbatim', () => {
    // read-board.ts keeps `*.Cu` as written where KiCad's parser would already
    // have expanded it. Without expansion, "current layer only" on In1.Cu would
    // skip exactly the zones most likely to be there.
    const b = board({ zones: [zone(['*.Cu']), zone(['F&B.Cu'])] });
    const inner = opts({ zones: true, currentLayerOnly: true, currentLayer: 'In1.Cu' });

    expect(globalDeletionIds(b, inner)).toEqual(new Set(['zone:0']));
    expect(
      globalDeletionIds(b, opts({ zones: true, currentLayerOnly: true, currentLayer: 'B.Cu' })),
    ).toEqual(new Set(['zone:0', 'zone:1']));
  });
});

describe('drawings', () => {
  it('lets "Graphics" suppress "Text" entirely', () => {
    // The `else if` chain. This looks like an upstream bug and is mirrored on
    // purpose: a board processed by KiCad and by us has to agree.
    const b = board({ shapes: [shape('F.SilkS')], texts: [text('F.SilkS')] });

    expect(globalDeletionIds(b, opts({ drawings: true, texts: true }))).toEqual(
      new Set(['shape:0']),
    );
    expect(globalDeletionIds(b, opts({ boardEdges: true, texts: true }))).toEqual(new Set());
    expect(globalDeletionIds(b, opts({ texts: true }))).toEqual(new Set(['text:0']));
  });

  it('spares an unlocked graphic when the unlocked filter is off', () => {
    // The lock filter has two independent halves, and only the locked one is
    // interesting by default — `drawingFilterUnlocked` starts true, so a test
    // that never turns it off cannot tell the unlocked branch from a constant.
    const b = board({ shapes: [shape('F.SilkS')] });

    expect(globalDeletionIds(b, opts({ drawings: true }))).toEqual(new Set(['shape:0']));
    expect(globalDeletionIds(b, opts({ drawings: true, drawingFilterUnlocked: false }))).toEqual(
      new Set(),
    );
  });

  it('deletes a copper shape that also opens the solder mask', () => {
    // PCB_SHAPE::GetLayerSet adds F.Mask, and F.Mask IS in AllNonCuMask(), so
    // the mask-carrying copper shape goes while the bare one stays. Testing only
    // the primary layer is the single most likely way to get this wrong.
    const b = board({ shapes: [shape('F.Cu'), shape('F.Cu', { maskLayer: 'F.Mask' })] });
    expect(globalDeletionIds(b, opts({ drawings: true }))).toEqual(new Set(['shape:1']));
  });

  it('only ever removes PCB_SHAPEs under "Graphics"', () => {
    // Text boxes, tables, images and dimensions are drawings on those very
    // layers, and "Graphics" leaves every one of them alone.
    const b = board({
      shapes: [shape('F.SilkS')],
      textBoxes: [textBox('F.SilkS')],
      tables: [table('F.SilkS')],
      images: [image('F.SilkS')],
      dimensions: [dimension('F.SilkS')],
    });
    expect(globalDeletionIds(b, opts({ drawings: true }))).toEqual(new Set(['shape:0']));
  });

  it('deletes text on copper, ignoring the drawing mask', () => {
    // "Text" uses the plain layers_filter, so the AllNonCuMask carve-out does
    // not apply to it at all.
    const b = board({ texts: [text('F.Cu')], textBoxes: [textBox('B.Cu')] });
    expect(globalDeletionIds(b, opts({ texts: true }))).toEqual(new Set(['text:0', 'textbox:0']));
  });

  it('deletes locked text — the text branch has no lock filter', () => {
    // Only the PCB_SHAPE branch consults the drawing lock filters.
    const b = board({
      texts: [text('F.SilkS', { locked: true })],
      shapes: [shape('F.SilkS', { locked: true })],
    });

    expect(globalDeletionIds(b, opts({ texts: true }))).toEqual(new Set(['text:0']));
    expect(globalDeletionIds(b, opts({ drawings: true }))).toEqual(new Set());
    expect(
      globalDeletionIds(
        b,
        opts({ drawings: true, drawingFilterLocked: true, drawingFilterUnlocked: false }),
      ),
    ).toEqual(new Set(['shape:0']));
  });
});

describe('footprints', () => {
  it('uses the footprint layer alone, never its children', () => {
    // FOOTPRINT does not override GetLayerSet, so it is {F.Cu} or {B.Cu}. With
    // silkscreen active no footprint is deleted, however much silk it carries.
    const b = board({ footprints: [footprint('F.Cu'), footprint('B.Cu')] });

    expect(
      globalDeletionIds(
        b,
        opts({ footprints: true, currentLayerOnly: true, currentLayer: 'F.SilkS' }),
      ),
    ).toEqual(new Set());
    expect(
      globalDeletionIds(
        b,
        opts({ footprints: true, currentLayerOnly: true, currentLayer: 'B.Cu' }),
      ),
    ).toEqual(new Set(['footprint:1']));
  });

  it('splits on the footprint lock filters', () => {
    const b = board({ footprints: [footprint('F.Cu'), footprint('F.Cu', { locked: true })] });

    expect(globalDeletionIds(b, opts({ footprints: true }))).toEqual(new Set(['footprint:0']));
    expect(
      globalDeletionIds(
        b,
        opts({ footprints: true, footprintFilterLocked: true, footprintFilterUnlocked: false }),
      ),
    ).toEqual(new Set(['footprint:1']));
  });
});

describe('tracks, arcs and vias', () => {
  it('drives arcs with the TRACK filters, not the via ones', () => {
    // board->Tracks() is one deque and the else-branch catches PCB_ARC_T.
    const b = board({ arcs: [arc('F.Cu', { locked: true })] });

    expect(globalDeletionIds(b, opts({ tracks: true, viaFilterLocked: true }))).toEqual(new Set());
    expect(globalDeletionIds(b, opts({ tracks: true, trackFilterLocked: true }))).toEqual(
      new Set(['arc:0']),
    );
  });

  it('drives vias with the via filters', () => {
    const b = board({ vias: [via('through', ['F.Cu', 'B.Cu'], { locked: true })] });

    expect(globalDeletionIds(b, opts({ tracks: true, trackFilterLocked: true }))).toEqual(
      new Set(),
    );
    expect(globalDeletionIds(b, opts({ tracks: true, viaFilterLocked: true }))).toEqual(
      new Set(['via:0']),
    );
  });

  it('spans the whole stack for a through via and only the pair for a blind one', () => {
    // PCB_VIA::GetLayerSet walks the PHYSICAL stack (F, In1, In2, B), not the
    // layer-id order in which B.Cu sits above the inners.
    const b = board({
      vias: [via('through', ['F.Cu', 'B.Cu']), via('blind', ['F.Cu', 'In1.Cu'])],
    });
    const on = (layer: string) =>
      opts({ tracks: true, currentLayerOnly: true, currentLayer: layer });

    expect(globalDeletionIds(b, on('In1.Cu'))).toEqual(new Set(['via:0', 'via:1']));
    expect(globalDeletionIds(b, on('In2.Cu'))).toEqual(new Set(['via:0']));
    expect(globalDeletionIds(b, on('B.Cu'))).toEqual(new Set(['via:0']));
  });

  it('gives an untented via its mask layer, and a tented one none', () => {
    // `(tenting none)` on the via itself; both board defaults are "tented", so
    // an ordinary via has no mask layer and a mask-layer run misses it.
    const b = board({
      vias: [
        via('through', ['F.Cu', 'B.Cu']),
        via('through', ['F.Cu', 'B.Cu'], { source: tenting('none') }),
      ],
    });
    const onMask = opts({ tracks: true, currentLayerOnly: true, currentLayer: 'F.Mask' });

    expect(globalDeletionIds(b, onMask)).toEqual(new Set(['via:1']));
  });

  it('adds a track mask layer only on the outer copper layers', () => {
    // PCB_TRACK uses `if(F_Cu) … else if(B_Cu)`, so an inner track with the flag
    // gains nothing — unlike PCB_SHAPE's two independent ifs.
    const b = board({
      tracks: [track('F.Cu', { maskLayer: 'F.Mask' }), track('In1.Cu', { maskLayer: 'F.Mask' })],
    });
    const onMask = opts({ tracks: true, currentLayerOnly: true, currentLayer: 'F.Mask' });

    expect(globalDeletionIds(b, onMask)).toEqual(new Set(['track:0']));
  });
});

describe('locking through groups', () => {
  it('counts a shape in a locked group as locked, but not a footprint', () => {
    // BOARD_ITEM::IsLocked consults the parent group; FOOTPRINT::IsLocked
    // overrides it and reads only FP_is_LOCKED. So one delete pass removes the
    // footprint and leaves the shape.
    const b = board({
      shapes: [shape('F.SilkS', { uuid: 's' })],
      footprints: [footprint('F.Cu', { uuid: 'f' })],
      groups: [group(['s', 'f'], { uuid: 'g', locked: true })],
    });

    expect(globalDeletionIds(b, opts({ drawings: true, footprints: true }))).toEqual(
      new Set(['footprint:0']),
    );
    expect(
      globalDeletionIds(
        b,
        opts({ drawings: true, drawingFilterLocked: true, drawingFilterUnlocked: false }),
      ),
    ).toEqual(new Set(['shape:0']));
  });

  it('inherits the lock through a nested group', () => {
    // PCB_GROUP does not override IsLocked, so the parent-group test recurses:
    // an ancestor's lock reaches the leaf.
    const b = board({
      tracks: [track('F.Cu', { uuid: 't' })],
      groups: [group(['t'], { uuid: 'inner' }), group(['inner'], { uuid: 'outer', locked: true })],
    });

    expect(globalDeletionIds(b, opts({ tracks: true }))).toEqual(new Set());
    expect(
      globalDeletionIds(
        b,
        opts({ tracks: true, trackFilterLocked: true, trackFilterUnlocked: false }),
      ),
    ).toEqual(new Set(['track:0']));
  });
});

describe('"Clear board"', () => {
  it('ignores the Layer Filter completely', () => {
    // Every delete_all branch passes all_layers, so the radio box is inert.
    const b = board({
      tracks: [track('B.Cu')],
      shapes: [shape('Edge.Cuts')],
      footprints: [footprint('B.Cu')],
      zones: [zone(['In2.Cu'])],
    });

    expect(
      globalDeletionIds(b, opts({ all: true, currentLayerOnly: true, currentLayer: 'F.Cu' })),
    ).toEqual(new Set(['zone:0', 'shape:0', 'footprint:0', 'track:0']));
  });

  it('reaches the drawings that "Graphics" cannot', () => {
    const b = board({
      textBoxes: [textBox('F.SilkS')],
      tables: [table('F.SilkS')],
      images: [image('F.SilkS')],
      dimensions: [dimension('F.SilkS')],
    });

    expect(globalDeletionIds(b, opts({ all: true }))).toEqual(
      new Set(['textbox:0', 'table:0', 'image:0', 'dimension:0']),
    );
  });

  it('leaves an item whose layer set is empty standing', () => {
    // LSET() intersected with anything is empty, so `.any()` is false. This is
    // the UNDEFINED_LAYER case, and forcing such an item out would diverge.
    const b = board({ shapes: [shape('')], zones: [zone([])], tracks: [track('F.Cu')] });
    expect(globalDeletionIds(b, opts({ all: true }))).toEqual(new Set(['track:0']));
  });

  it('does not delete markers', () => {
    // DeleteMARKERs() is guarded by m_delMarkers alone; "Clear board" neither
    // ticks nor implies it.
    const b = board({ tracks: [track('F.Cu')] });
    expect(applyGlobalDeletion(b, opts({ all: true })).clearMarkers).toBe(false);
    expect(applyGlobalDeletion(b, opts({ markers: true })).clearMarkers).toBe(true);
  });

  it('ignores the lock filters', () => {
    const b = board({
      tracks: [track('F.Cu', { locked: true })],
      shapes: [shape('F.SilkS', { locked: true })],
      footprints: [footprint('F.Cu', { locked: true })],
    });

    expect(globalDeletionIds(b, opts({ all: true }))).toEqual(
      new Set(['shape:0', 'footprint:0', 'track:0']),
    );
  });
});

describe('the ratsnest flag', () => {
  it('follows the removal, not the checkbox', () => {
    // gen_rastnest is set inside processConnectedItem, so ticking "Tracks &&
    // vias" on a board with no tracks must leave it false and skip the rebuild.
    const empty = board();
    expect(globalDeletionRebuildsRatsnest(empty, opts({ tracks: true, all: true }))).toBe(false);

    const withTrack = board({ tracks: [track('F.Cu')] });
    expect(globalDeletionRebuildsRatsnest(withTrack, opts({ tracks: true }))).toBe(true);
  });

  it('stays false for drawings, even under "Clear board"', () => {
    // Drawings go through processItem, which never touches the flag.
    const b = board({ shapes: [shape('F.SilkS')], texts: [text('F.SilkS')] });
    expect(globalDeletionRebuildsRatsnest(b, opts({ all: true }))).toBe(false);
    expect(globalDeletionRebuildsRatsnest(b, opts({ drawings: true }))).toBe(false);
  });

  it('is set by zones and footprints too', () => {
    expect(
      globalDeletionRebuildsRatsnest(board({ zones: [zone(['F.Cu'])] }), opts({ zones: true })),
    ).toBe(true);
    expect(
      globalDeletionRebuildsRatsnest(
        board({ footprints: [footprint('F.Cu')] }),
        opts({ footprints: true }),
      ),
    ).toBe(true);
  });
});

describe('applying it', () => {
  it('removes exactly the staged items and leaves the rest', () => {
    const b = board({ tracks: [track('F.Cu'), track('B.Cu')], shapes: [shape('F.SilkS')] });
    const r = applyGlobalDeletion(
      b,
      opts({ tracks: true, currentLayerOnly: true, currentLayer: 'F.Cu' }),
    );

    expect(r.deleted).toEqual(new Set(['track:0']));
    expect(r.board.tracks.map((t) => t.layer)).toEqual(['B.Cu']);
    expect(r.board.shapes).toHaveLength(1);
    expect(r.rebuildRatsnest).toBe(true);
  });

  it('empties a group of its deleted members without dissolving it', () => {
    // BOARD_COMMIT::Push calls parentGroup->RemoveItem per removed item and does
    // NOT enforce the ">= 2 members" rule that removeFromGroupItems does — using
    // that helper here would delete a group KiCad keeps.
    const b = board({
      tracks: [track('F.Cu', { uuid: 't1' }), track('F.Cu', { uuid: 't2' })],
      groups: [group(['t1', 't2'], { uuid: 'g' })],
    });
    const r = applyGlobalDeletion(b, opts({ all: true }));

    expect(r.board.groups).toHaveLength(1);
    expect(r.board.groups[0]!.members).toEqual([]);
  });

  it('leaves the nets and the layer table untouched', () => {
    // Nothing is renumbered, re-netted or repaired; the nets map keeps names for
    // nets that no longer have copper.
    const b = board({
      nets: new Map([
        [0, ''],
        [1, 'VCC'],
      ]),
      tracks: [track('F.Cu')],
    });
    const r = applyGlobalDeletion(b, opts({ all: true }));

    expect(r.board.nets.get(1)).toBe('VCC');
    expect(r.board.layers).toBe(b.layers);
  });

  it('counts what it would delete without touching the board', () => {
    const b = board({ tracks: [track('F.Cu'), track('B.Cu')], shapes: [shape('F.SilkS')] });
    expect(countGlobalDeletionTargets(b, opts({ all: true }))).toBe(3);
    expect(b.tracks).toHaveLength(2);
  });
});
