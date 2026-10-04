// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * IPC-D-356 bare-board test netlist.
 * Counterpart: `IPC356D_WRITER` (pcbnew/exporters/export_d356.cpp).
 *
 * A fixed-column ASCII format that a bare-board test house feeds straight into
 * a flying-probe or bed-of-nails machine. Every field is at a fixed offset, so
 * "close enough" is worthless here: a column out by one is a file the test
 * house rejects, and the failure surfaces at the fab, not at export time. The
 * tests therefore assert whole records byte for byte rather than field values.
 *
 * ## Two things that read as bugs and are reproduced anyway
 *
 * The access code for the same physical situation is computed by two different
 * formulas — pads use `layerId + 1`, vias use `(topLayerId / 2) + 1` — and they
 * disagree for inner layers. Upstream is inconsistent here and a test house
 * consumes what KiCad emits, so unifying them would make us the odd one out.
 *
 * Soldermask polarity is inverted between the two paths: a pad starts at 3 and
 * *clears* bits when a mask layer is present, a via starts at 0 and *sets* them
 * when the side is tented. Both end up meaning "this side is not accessible",
 * but the code reads backwards depending on which loop you are in.
 *
 * ## Record order is load-bearing
 *
 * Vias are built before pads, and net names are interned in record order, so
 * vias get first claim on the unsuffixed canonical names. Emitting pads first
 * silently changes the net names on any board with long or colliding names.
 */

import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { LSET } from '@ziroeda/common/lset.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { DisplayErrorMessage, DisplayInfoMessage } from '@ziroeda/common/confirm.js';
import { ipcD356FileWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';
import type { ChooserFilter } from '@ziroeda/common/wx/filedlg.js';
import type { BOARD } from '../board.js';
import { NETINFO_LIST } from '../netinfo_list.js';
import { PAD_ATTRIB, PAD_SHAPE, PADSTACK } from '../padstack.js';
import type { PCB_VIA } from '../pcb_track.js';
import type { Board, PcbVia } from '../types.js';

/** One row of the netlist, `D356_RECORD`. */
export interface D356Record {
  smd: boolean;
  hole: boolean;
  mechanical: boolean;
  midpoint: boolean;
  netname: string;
  refdes: string;
  pin: string;
  drill: number;
  access: number;
  xLocation: number;
  yLocation: number;
  xSize: number;
  ySize: number;
  rotation: number;
  soldermask: number;
}

/**
 * `iu_to_d356`: internal units to decimils, clamped **symmetrically**.
 *
 * `KiROUND` is round-half-away-from-zero. `Math.round` rounds half toward
 * positive infinity, so every coordinate sitting exactly on a half-decimil
 * *below* the origin would come out one unit off — a whole-board offset that
 * only shows on one side of the aux origin.
 */
export function iuToD356(iu: number, clamp: number): number {
  const val = KiROUND(iu / 2540);
  if (val > clamp) return clamp;
  if (val < -clamp) return -clamp;
  return val;
}

/*
 * TRANSITIONAL (E17): the view board's via tenting, for the 3D viewer until
 * it reads the BOARD.
 */
/**
 * `BOARD_DESIGN_SETTINGS::m_TentViasFront/Back`, which both default to **true**.
 * Tented means covered by mask, i.e. *not* probeable.
 */
export function boardTentVias(board: Board): { front: boolean; back: boolean } {
  const bds = board.k?.GetDesignSettings();
  return { front: bds?.m_TentViasFront ?? true, back: bds?.m_TentViasBack ?? true };
}

/** `PCB_VIA::IsTented`: the via's own setting wins, else the board default. */
export function viaIsTented(board: Board, via: PcbVia, side: 'front' | 'back'): boolean {
  return via.tenting?.[side] ?? boardTentVias(board)[side];
}

/**
 * `compute_pad_access_code`: the access code for a pad, -1 when it has no
 * copper (a mask-only aperture is not a test point).
 */
function compute_pad_access_code(aPcb: BOARD, aLayerMask: LSET): number {
  // Non-copper is not interesting here
  const mask = aLayerMask.and(LSET.AllCuMask());

  if (!mask.any()) return -1;

  // Traditional TH pad
  if (mask.test(PCB_LAYER_ID.F_Cu) && mask.test(PCB_LAYER_ID.B_Cu)) return 0;

  // Front SMD pad
  if (mask.test(PCB_LAYER_ID.F_Cu)) return 1;

  // Back SMD pad
  if (mask.test(PCB_LAYER_ID.B_Cu)) return aPcb.GetCopperLayerCount();

  // OK, we have an inner-layer only pad (and I have no idea about
  // what could be used for); anyway, find the first copper layer
  // it's on: LAYER_RANGE( In1_Cu, B_Cu, copper count ) walks the inners.
  for (let k = 1; k <= aPcb.GetCopperLayerCount() - 2; k++) {
    const layer = PCB_LAYER_ID.In1_Cu + 2 * (k - 1);

    if (mask.test(layer)) return layer + 1;
  }

  // This shouldn't happen
  return -1;
}

/**
 * `via_access_code`. In D-356 layers are numbered from 1 up, where '1' is the
 * 'primary side' (usually the component side); '0' means 'both sides', and
 * other layers follows in an unspecified order. Deliberately not unified with
 * the pad version: for an inner layer the two disagree, as upstream's do.
 */
function via_access_code(aPcb: BOARD, top_layer: number, bottom_layer: number): number {
  // Easy case for through vias: top_layer is component, bottom_layer is
  // solder, access code is 0
  if (top_layer === PCB_LAYER_ID.F_Cu && bottom_layer === PCB_LAYER_ID.B_Cu) return 0;

  // Blind via, reachable from front
  if (top_layer === PCB_LAYER_ID.F_Cu) return 1;

  // Blind via, reachable from bottom
  if (bottom_layer === PCB_LAYER_ID.B_Cu) return aPcb.GetCopperLayerCount();

  // It's a buried via, accessible from some inner layer
  // (maybe could be used for testing before laminating? no idea)
  return Math.trunc(top_layer / 2) + 1;
}

/** `build_via_testpoints`: the D356 records of the vias. */
function build_via_testpoints(aPcb: BOARD, aRecords: D356Record[]): void {
  const origin = aPcb.GetDesignSettings().GetAuxOrigin();

  // Enumerate all the track segments and keep the vias
  for (const track of aPcb.Tracks()) {
    if (track.Type() !== KICAD_T.PCB_VIA_T) continue;

    const via = track as PCB_VIA;
    const net = track.GetNet();
    const [top_layer, bottom_layer] = via.LayerPair();

    aRecords.push({
      smd: false,
      hole: true,
      netname: net ? net.GetNetname() : '',
      refdes: 'VIA',
      pin: '',
      midpoint: true, // Vias are always midpoints
      drill: via.GetDrillValue(),
      mechanical: false,
      access: via_access_code(aPcb, top_layer, bottom_layer),
      xLocation: via.GetPosition().x - origin.x,
      yLocation: origin.y - via.GetPosition().y,
      // The record has a single size for vias, so take the smaller of the front and back
      xSize:
        via.Padstack().Mode() !== PADSTACK.MODE.NORMAL
          ? Math.min(via.GetWidth(PCB_LAYER_ID.F_Cu), via.GetWidth(PCB_LAYER_ID.B_Cu))
          : via.GetWidth(PADSTACK.ALL_LAYERS),
      ySize: 0, // Round so height = 0
      rotation: 0,
      // the value indicates which sides are *not* accessible
      soldermask:
        (via.IsTented(PCB_LAYER_ID.F_Mask) ? 1 : 0) | (via.IsTented(PCB_LAYER_ID.B_Mask) ? 2 : 0),
    });
  }
}

/**
 * `IPC356D_WRITER` (export_d356.h): the IPC-D-356 netlist of a board. `Write`
 * answers the file's text; the caller writes it where the file dialog said.
 */
export class IPC356D_WRITER {
  private readonly m_pcb: BOARD;
  private m_doNotExportUnconnectedPads = false;

  constructor(aPcb: BOARD) {
    this.m_pcb = aPcb;
  }

  SetDoNotExportUnconnectedPads(aDoNotExportUnconnectedPads: boolean): void {
    this.m_doNotExportUnconnectedPads = aDoNotExportUnconnectedPads;
  }

  /** `Write( aFilename )`, minus the file I/O: the text it writes. */
  Write(): string {
    // This will contain everything needed for the 356 file
    const d356_records: D356Record[] = [];

    build_via_testpoints(this.m_pcb, d356_records);

    this.build_pad_testpoints(this.m_pcb, d356_records);

    // Code 00 AFAIK is ASCII, CUST 0 is decimils/degrees
    // CUST 1 would be metric but gerbtool simply ignores it!
    return `P  CODE 00\nP  UNITS CUST 0\nP  arrayDim   N\n${writeD356Records(d356_records)}999\n`;
  }

  /** `build_pad_testpoints`: the D356 records of the footprints' pads. */
  private build_pad_testpoints(aPcb: BOARD, aRecords: D356Record[]): void {
    const origin = aPcb.GetDesignSettings().GetAuxOrigin();

    for (const footprint of aPcb.Footprints()) {
      for (const pad of footprint.Pads()) {
        const access = compute_pad_access_code(aPcb, pad.GetLayerSet());

        // It could be a mask only pad, we only handle pads with copper here
        if (access === -1) continue;

        if (this.m_doNotExportUnconnectedPads && pad.GetNetCode() === NETINFO_LIST.UNCONNECTED)
          continue;

        const drill = pad.GetDrillSize();
        const drillMin = Math.min(drill.x, drill.y);
        const accessLayer = footprint.IsFlipped() ? PCB_LAYER_ID.B_Cu : PCB_LAYER_ID.F_Cu;

        // An int takes the double: truncation toward zero, then once += 360.
        let rotation = Math.trunc(-pad.GetOrientation().AsDegrees());

        if (rotation < 0) rotation += 360;

        // the value indicates which sides are *not* accessible
        let soldermask = 3;

        if (pad.GetLayerSet().test(PCB_LAYER_ID.F_Mask)) soldermask &= ~1;

        if (pad.GetLayerSet().test(PCB_LAYER_ID.B_Mask)) soldermask &= ~2;

        aRecords.push({
          netname: pad.GetNetname(),
          pin: pad.GetNumber(),
          refdes: footprint.GetReference(),
          midpoint: false, // XXX MAYBE need to be computed (how?)
          drill: drillMin,
          hole: drillMin !== 0,
          smd: pad.GetAttribute() === PAD_ATTRIB.SMD || pad.GetAttribute() === PAD_ATTRIB.CONN,
          mechanical: pad.GetAttribute() === PAD_ATTRIB.NPTH,
          access,
          xLocation: pad.GetPosition().x - origin.x,
          yLocation: origin.y - pad.GetPosition().y,
          xSize: pad.GetSize(accessLayer).x,
          // Rule: round pads have y = 0
          ySize: pad.GetShape(accessLayer) === PAD_SHAPE.CIRCLE ? 0 : pad.GetSize(accessLayer).y,
          rotation,
          soldermask,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting

/**
 * `%-N.Ns`: truncate and pad to N **bytes**, as `TO_UTF8` does.
 *
 * Refdes and pin are not sanitised the way net names are, so a non-ASCII
 * reference can be cut mid-sequence. Counting UTF-16 units instead would shift
 * every following column on exactly the boards where that happens.
 */
function fixedBytes(value: string, width: number): string {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= width) return value + ' '.repeat(width - bytes.length);
  return new TextDecoder().decode(bytes.slice(0, width)).replace(/�+$/, '').padEnd(width, ' ');
}

/** `%0Nd` on a possibly negative value. */
const pad0 = (v: number, width: number): string =>
  (v < 0 ? '-' : '') + String(Math.abs(v)).padStart(v < 0 ? width - 1 : width, '0');

/** `%+07d`: the sign counts toward the width. */
const signed7 = (v: number): string => (v < 0 ? '-' : '+') + String(Math.abs(v)).padStart(6, '0');

/**
 * `intern_new_d356_netname`.
 *
 * Truncation keeps the **tail**, not the head, so two long names sharing a
 * suffix collide and go through the `#N` path. That path can itself push a name
 * past 14 characters, which `%-14.14s` then truncates back — so two distinct
 * interned names can print identically. Upstream does not guard it and neither
 * does this.
 */
export function internNewD356Netname(
  rawName: string,
  map: Map<string, string>,
  used: Set<string>,
): string {
  let canon = '';
  for (const ch of rawName) {
    const code = ch.codePointAt(0) ?? 0;
    // `ch > 126 || !isgraph(ch)` under the C locale: space and controls too.
    canon += code > 126 || code <= 32 ? '?' : ch;
  }
  canon = canon.toUpperCase();
  if (canon.length > 14) canon = canon.slice(-14);

  if (used.has(canon)) {
    const base = canon.length > 10 ? canon.slice(-10) : canon;
    let ctr = 0;
    do {
      ctr++;
      canon = `${base}#${ctr}`;
    } while (used.has(canon));
  }

  map.set(rawName, canon);
  used.add(canon);
  return canon;
}

/** `write_D356_records`. */
export function writeD356Records(records: readonly D356Record[]): string {
  const map = new Map<string, string>();
  const used = new Set<string>();
  let out = '';

  for (const rk of records) {
    // An empty net is the literal N/C and is never interned — so a real net
    // that canonicalises to N/C collides with it. Reproduced, not fixed.
    const net =
      rk.netname === ''
        ? 'N/C'
        : (map.get(rk.netname) ?? internNewD356Netname(rk.netname, map, used));

    const rktype = rk.smd ? 327 : rk.mechanical ? 367 : rk.access === 0 ? 317 : 307;

    out += `${pad0(rktype, 3)}${fixedBytes(net, 14)}   ${fixedBytes(rk.refdes, 6)}`;
    out += `${rk.pin === '' ? ' ' : '-'}${fixedBytes(rk.pin, 4)}${rk.midpoint ? 'M' : ' '}`;

    out += rk.hole ? `D${pad0(iuToD356(rk.drill, 9999), 4)}${rk.mechanical ? 'U' : 'P'}` : '      ';

    out += `A${pad0(rk.access, 2)}X${signed7(iuToD356(rk.xLocation, 999999))}`;
    out += `Y${signed7(iuToD356(rk.yLocation, 999999))}`;
    out += `X${pad0(iuToD356(rk.xSize, 9999), 4)}Y${pad0(iuToD356(rk.ySize, 9999), 4)}`;
    out += `R${pad0(rk.rotation, 3)}`;

    out += `S${rk.soldermask}\n`;
  }

  return out;
}

/** The frame `GenD356File` runs on: its board, settings and the save dialog. */
export interface GEN_D356_FRAME {
  GetBoard(): BOARD | null;
  GetPcbNewSettings(): { m_ExportD356: { doNotExportUnconnectedPads: boolean } };
  ShowSaveFileDialog(
    aTitle: string,
    aDefaultName: string,
    aWildcard: ChooserFilter,
    aCheckbox: { label: string; value: boolean } | null,
  ): Promise<{ path: string; checked: boolean } | null>;
  WriteTextFile(aPath: string, aText: string): boolean;
}

/**
 * `BOARD_EDITOR_CONTROL::GenD356File` (export_d356.cpp:437-475): the save
 * dialog with D365_CUSTOMIZE_HOOK's "Do not export unconnected pads", then the
 * writer, then the message either way.
 */
export async function BOARD_EDITOR_CONTROL_GenD356File(aFrame: GEN_D356_FRAME): Promise<number> {
  const board = aFrame.GetBoard()!;
  const base = board.GetFileName().split(/[\\/]/).pop() ?? '';
  const name = `${base.replace(/\.[^.]*$/, '') || base}.d356`;

  const settings = aFrame.GetPcbNewSettings().m_ExportD356;
  const dlg = await aFrame.ShowSaveFileDialog(
    'Generate IPC-D-356 netlist file',
    name,
    ipcD356FileWildcard(),
    { label: 'Do not export unconnected pads', value: settings.doNotExportUnconnectedPads },
  );

  if (!dlg) return 0;

  const writer = new IPC356D_WRITER(board);
  const doNotExportUnconnectedPads = dlg.checked;
  writer.SetDoNotExportUnconnectedPads(doNotExportUnconnectedPads);
  settings.doNotExportUnconnectedPads = doNotExportUnconnectedPads;

  if (aFrame.WriteTextFile(dlg.path, writer.Write()))
    void DisplayInfoMessage(`IPC-D-356 netlist file created:\n'${dlg.path}'.`);
  else DisplayErrorMessage(`Failed to create file '${dlg.path}'.`);

  return 0;
}
