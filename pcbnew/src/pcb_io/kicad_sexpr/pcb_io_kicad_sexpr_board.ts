// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PCB_IO_KICAD_SEXPR_PARSER::Parse()` for a board: the header (part 1),
 * the items (part 2) into `BOARD`'s lists, and the post-parse passes of
 * `parseBOARD_unchecked` — undefined-layer rescue, the zone layer-set trim,
 * and `resolveGroups`.
 *
 * `KBoard` is `BOARD` as the file I/O sees it: `m_footprints`, `m_drawings`,
 * `m_tracks`, `m_points`, `m_zones`, `m_groups`, `m_generators`, each in
 * file order (the formatter sorts).
 */
import type {
  KFootprint,
  KFpGraphicalItem,
  KPcbGenerator,
  KPcbGroup,
  KPcbPoint,
  KPcbTarget,
  KPcbTrack,
  KPcbVia,
  KZone,
} from './kicad_board_items.js';
import {
  parseDIMENSION,
  parseFOOTPRINT,
  parseGENERATOR,
  parseGROUP,
  parsePCB_BARCODE,
  parsePCB_POINT,
  parsePCB_REFERENCE_IMAGE,
  parsePCB_SHAPE,
  parsePCB_TABLE,
  parsePCB_TARGET,
  parsePCB_TEXT,
  parsePCB_TEXTBOX,
  parsePCB_TRACK,
  parsePCB_VIA,
  parseZONE,
} from './pcb_io_kicad_sexpr_items.js';
import { PCB_IO_KICAD_SEXPR_PARSER, type ParsedBoardHeader } from './pcb_io_kicad_sexpr_parser.js';

/** `BOARD::m_drawings`: everything `BOARD::Add` routes there, targets included. */
export type KBoardDrawing = KFpGraphicalItem | { kind: 'target'; item: KPcbTarget };

/** `BOARD::m_tracks`: segments, arcs and vias in one list. */
export type KBoardTrack = { kind: 'track'; item: KPcbTrack } | { kind: 'via'; item: KPcbVia };

export interface KBoard extends ParsedBoardHeader {
  footprints: KFootprint[];
  drawings: KBoardDrawing[];
  tracks: KBoardTrack[];
  points: KPcbPoint[];
  zones: KZone[];
  groups: KPcbGroup[];
  generators: KPcbGenerator[];
  /**
   * `resolveGroups`: each group's / generator's members, resolved to the
   * uuids that exist on the board with the same parent, in file order.
   * Keyed by the group uuid.
   */
  groupMembers: Map<string, string[]>;
}

/** An I/O failure that is not a parse error: `THROW_IO_ERROR`. */
export class IO_ERROR extends Error {}

/**
 * `Parse()` (:1016) → `parseBOARD()` → `parseBOARD_unchecked()` (:1116) for a
 * `kicad_pcb` file, then `resolveGroups( board )`.
 */
export function ParseBoard(text: string, source = 'string'): KBoard {
  const p = new PCB_IO_KICAD_SEXPR_PARSER(text, source);

  const footprints: KFootprint[] = [];
  const drawings: KBoardDrawing[] = [];
  const tracks: KBoardTrack[] = [];
  const points: KPcbPoint[] = [];
  const zones: KZone[] = [];
  const groups: KPcbGroup[] = [];
  const generators: KPcbGenerator[] = [];
  let hdr: ParsedBoardHeader | null = null;
  const boardCtx = { copperLayerCount: 2 };

  hdr = p.ParseBoardHeader((token) => {
    // The header is complete by the time the first item arrives, and the
    // footprint parser needs the copper count for `FixUpPadsForBoard`.
    boardCtx.copperLayerCount = p.hdrCopperLayerCount();
    switch (token) {
      case 'gr_arc':
      case 'gr_curve':
      case 'gr_line':
      case 'gr_poly':
      case 'gr_circle':
      case 'gr_rect':
        drawings.push({ kind: 'shape', item: parsePCB_SHAPE(p, null) });
        break;
      case 'image':
        drawings.push({ kind: 'image', item: parsePCB_REFERENCE_IMAGE(p) });
        break;
      case 'barcode':
        // The C++ case has no `break` and falls into `parseDIMENSION`, which
        // then fails on the next token; a board with a barcode cannot load
        // there. Not mirrored: the barcode is kept.
        drawings.push({ kind: 'barcode', item: parsePCB_BARCODE(p) });
        break;
      case 'gr_text':
        drawings.push({ kind: 'text', item: parsePCB_TEXT(p, null).text });
        break;
      case 'gr_text_box':
        drawings.push({ kind: 'textbox', item: parsePCB_TEXTBOX(p, null) });
        break;
      case 'table':
        drawings.push({ kind: 'table', item: parsePCB_TABLE(p, null) });
        break;
      case 'dimension':
        drawings.push({ kind: 'dimension', item: parseDIMENSION(p, null) });
        break;
      case 'module': // legacy token
      case 'footprint':
        footprints.push(parseFOOTPRINT(p, boardCtx));
        break;
      case 'segment': {
        const track = parsePCB_TRACK(p, false);
        if (track) tracks.push({ kind: 'track', item: track });
        break;
      }
      case 'arc': {
        const arc = parsePCB_TRACK(p, true);
        if (arc) tracks.push({ kind: 'track', item: arc });
        break;
      }
      case 'group':
        groups.push(parseGROUP(p));
        break;
      case 'generated': {
        const gen = parseGENERATOR(p);
        if (gen) generators.push(gen);
        break;
      }
      case 'via':
        tracks.push({ kind: 'via', item: parsePCB_VIA(p) });
        break;
      case 'zone': {
        const zone = parseZONE(p, null);
        // Zones with no outline vertices are degenerate and can cause crashes
        // elsewhere. Silently discard them.
        if (zoneNumCorners(zone) === 0) break;
        zones.push(zone);
        break;
      }
      case 'target':
        drawings.push({ kind: 'target', item: parsePCB_TARGET(p) });
        break;
      case 'point':
        points.push(parsePCB_POINT(p));
        break;
      default:
        p.throwParse(`Unknown token '${p.CurText()}'`);
    }
  });

  const board: KBoard = {
    ...hdr,
    footprints,
    drawings,
    tracks,
    points,
    zones,
    groups,
    generators,
    groupMembers: new Map(),
  };

  // Items found on undefined layers: without a GUI to ask, the C++ refuses
  // the board.
  if (p.undefinedLayerNames().length > 0) {
    throw new IO_ERROR(
      `One or more items were found on undefined layers (${p.undefinedLayerNames().join(', ')}). ` +
        'Open the board in the PCB Editor to resolve.',
    );
  }

  // Clear unused zone data: `SetLayerSetAndRemoveUnusedFills( layers & enabled )`.
  // (Its fill pruning is a no-op — it walks the new set — so only the set changes.)
  for (const z of zones) {
    const set = z.layerSet.and(board.enabledLayers);
    if (set.count() === 0) continue;
    z.layerSet = set;
  }

  // Ensure all footprints have their embedded data from the board
  fixupEmbeddedData(board);

  resolveGroups(board);
  return board;
}

/**
 * `BOARD::FixupEmbeddedData()` (board.cpp:1212): a footprint's embedded file
 * entry, written without its data in a board, takes the data of the board's
 * file of the same name.
 */
function fixupEmbeddedData(board: KBoard): void {
  for (const fp of board.footprints) {
    for (const [filename, embeddedFile] of fp.embeddedFiles.files) {
      const file = board.embeddedFiles.files.get(filename);
      if (file) {
        embeddedFile.compressedEncodedData = file.compressedEncodedData;
        embeddedFile.dataHash = file.dataHash;
      }
    }
  }
}

/** `ZONE::GetNumCorners()`: the outline's vertex count, all contours. */
function zoneNumCorners(z: KZone): number {
  let n = 0;
  for (const contour of z.outline) n += contour.length;
  return n;
}

/**
 * `resolveGroups( aParent )` (:1522) for the board and for each footprint:
 * a group member is kept when its uuid names an item with the same parent
 * as the group. Groups and generators are themselves items, so nested groups
 * resolve too. A generator takes the layer of its first track member.
 */
function resolveGroups(board: KBoard): void {
  // The board's item-by-id cache holds every top-level item; footprint
  // children are in it too but fail the same-parent test below.
  const topLevel = new Map<string, KBoardTrack | null>();
  const add = (uuid: string, track: KBoardTrack | null = null): void => {
    if (!topLevel.has(uuid)) topLevel.set(uuid, track);
  };
  for (const fp of board.footprints) add(fp.uuid);
  for (const d of board.drawings) add(d.item.uuid);
  for (const t of board.tracks) add(t.item.uuid, t);
  for (const pt of board.points) add(pt.uuid);
  for (const z of board.zones) add(z.uuid);
  // First add all group objects so subsequent getItem() calls for nested groups work.
  for (const g of board.groups) add(g.uuid);
  for (const g of board.generators) add(g.uuid);

  for (const g of [...board.groups, ...board.generators]) {
    const members: string[] = [];
    for (const uuid of g.memberUuids) if (topLevel.has(uuid)) members.push(uuid);
    board.groupMembers.set(g.uuid, members);
  }

  // For generators, set the layer to match the layer of the contained tracks
  for (const gen of board.generators) {
    for (const uuid of board.groupMembers.get(gen.uuid) ?? []) {
      const t = topLevel.get(uuid);
      if (t) {
        gen.layer = t.kind === 'via' ? t.item.layer1 : t.item.layer;
        break;
      }
    }
  }

  for (const fp of board.footprints) resolveFootprintGroups(fp, board);
}

/** `resolveGroups( footprint )`: members from the footprint's own children. */
function resolveFootprintGroups(fp: KFootprint, board: KBoard): void {
  const children = new Set<string>();
  for (const d of fp.graphicalItems) children.add(d.item.uuid);
  for (const f of fp.fields) children.add(f.uuid);
  for (const pad of fp.pads) children.add(pad.uuid);
  for (const z of fp.zones) children.add(z.uuid);
  for (const pt of fp.points) children.add(pt.uuid);
  for (const g of fp.groups) children.add(g.uuid);
  fp.groupMembers = new Map();
  for (const g of fp.groups) {
    const members: string[] = [];
    for (const uuid of g.memberUuids) if (children.has(uuid)) members.push(uuid);
    fp.groupMembers.set(g.uuid, members);
    board.groupMembers.set(g.uuid, members);
  }
}
