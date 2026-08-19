// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Reconciling a board against a netlist. Counterpart:
 * `pcbnew/netlist_reader/board_netlist_updater.cpp` (BOARD_NETLIST_UPDATER), the
 * engine behind "Update PCB from Schematic" and "Import Netlist".
 *
 * The process, as the upstream class documents it:
 *  - a component in the netlist with no footprint on the board gets one added;
 *  - a component already on the board has its footprint replaced when the assigned
 *    footprint changed, and its reference, value, fields, fabrication attributes,
 *    sheet name/file and symbol link brought up to date;
 *  - every pad's net is then set from the netlist, adding nets the board did not
 *    have and disconnecting pads the schematic no longer connects;
 *  - zones and stitching vias left on a net that no longer exists are moved to the
 *    net their connected pads went to, so a rename does not orphan copper;
 *  - finally, unmatched footprints are removed if asked, and nets that ended up
 *    with nothing on them are dropped.
 *
 * Every step reports what it did (or, in a dry run, what it *would* do) through a
 * {@link Reporter}, in the present tense for a dry run and the past tense for the
 * real thing, the two strings upstream keeps side by side, so the dialog's
 * "Changes to Be Applied" and "Changes Applied to PCB" read correctly.
 *
 * Differences from upstream, all because the board model has no counterpart yet:
 * component classes, design variants, design-block layouts and net chains are not
 * updated, and there is no undo commit, the caller gets a new Board value back and
 * pushes it onto its own undo stack.
 */

import {
  RPT_SEVERITY_ACTION,
  RPT_SEVERITY_ERROR,
  RPT_SEVERITY_INFO,
  RPT_SEVERITY_WARNING,
  type Reporter,
} from '@ziroeda/common/src/reporter.js';
import { pcbIuToMM as iuToMM, pcbMmToIU as mmToIU } from '@ziroeda/common/src/eda_units.js';
import { unescapeString } from '@ziroeda/common/src/string_utils.js';
import { atom, head, isList, str, type SList, type SNode } from '@ziroeda/sexpr/src/types.js';
import { arg } from '@ziroeda/sexpr/src/query.js';
import { exchangeFootprint, placeFootprint } from '../board_exchange_footprint.js';
import { newKiid } from '@ziroeda/common/src/kiid.js';
import { boardItemBBox } from '../edit-board.js';
import { appendNet, findNet, removeUnusedNets, UNCONNECTED_NET } from '../netinfo.js';
import {
  RESERVED_FOOTPRINT_PROPERTIES,
  type Board,
  type PcbFootprint,
  type PcbFootprintField,
  type PcbGroup,
  type PcbPad,
  type PcbZone,
} from '../types.js';
import { fpidIsLegacy, fpidItemName, type COMPONENT, type NETLIST } from './pcb_netlist.js';

// ----- options and result -----------------------------------------------------

export interface BoardNetlistUpdaterOptions {
  /** Report only; leave the board untouched (SetIsDryRun). */
  isDryRun?: boolean;
  /** Replace footprints with those the symbols specify (SetReplaceFootprints). */
  replaceFootprints?: boolean;
  /** Delete unlocked footprints with no symbol behind them (SetDeleteUnusedFootprints). */
  deleteUnusedFootprints?: boolean;
  /** Match footprints to symbols by UUID rather than reference (SetLookupByTimestamp). */
  lookupByTimestamp?: boolean;
  /** Act on locked footprints too (SetOverrideLocks). */
  overrideLocks?: boolean;
  /** Copy symbol fields onto the footprints (SetUpdateFields). */
  updateFields?: boolean;
  /** Drop footprint fields the symbol does not have (SetRemoveExtraFields). */
  removeExtraFields?: boolean;
  /** Mirror symbol groups onto PCB groups (SetTransferGroups). */
  transferGroups?: boolean;
}

export interface BoardNetlistUpdateResult {
  /** The updated board, the input board unchanged when this was a dry run. */
  board: Board;
  /** Indices into `board.footprints` of the footprints this run added. */
  addedFootprints: number[];
  /** UUIDs of the PCB groups this run created. */
  addedGroups: string[];
  errorCount: number;
  warningCount: number;
  /** New footprints, either really new or replaced by new (m_newFootprintsCount). */
  newFootprintCount: number;
}

/**
 * How the updater gets at the footprint libraries. `LoadFootprintFromProject`
 * reaches the project's footprint library table; in the browser the caller has
 * already fetched and parsed what the netlist asks for, so it passes a lookup.
 */
export type FootprintLoader = (fpid: string) => PcbFootprint | null | undefined;

// ----- small source helpers ---------------------------------------------------

const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** Replace (or append) the first `name` child of a source node. */
function patchChild(src: SList, name: string, node: SList): SList {
  let replaced = false;
  const items = src.items.map((it) => {
    if (!replaced && isList(it) && head(it) === name) {
      replaced = true;
      return node;
    }
    return it;
  });
  if (!replaced) items.push(node);
  return { kind: 'list', items };
}

/** Drop every `name` child from a source list. */
function removeChildNamed(src: SList, name: string): SList {
  return { kind: 'list', items: src.items.filter((it) => !(isList(it) && head(it) === name)) };
}

/** Set (or clear) a `(name "value")` string child. */
function setStringChild(src: SList, name: string, value: string): SList {
  return value === ''
    ? removeChildNamed(src, name)
    : patchChild(src, name, list(atom(name), str(value)));
}

/** Rewrite the scalar at position `index` after the head (0-based). */
function replaceArg(src: SList, index: number, value: string): SList {
  let seen = -1;
  const items = src.items.map((it) => {
    if (isList(it)) return it;
    seen++;
    return seen === index + 1 ? str(value) : it;
  });
  return { kind: 'list', items };
}

/** `(attr flag flag …)`, dropped entirely when there are no flags. */
function setAttributes(src: SList, attributes: readonly string[]): SList {
  return attributes.length === 0
    ? removeChildNamed(src, 'attr')
    : patchChild(src, 'attr', {
        kind: 'list',
        items: [atom('attr'), ...attributes.map((a) => atom(a))],
      });
}

/** `(net <code> "<name>")` on a pad, plus its pin function and type. */
function setPadNetSource(
  src: SList,
  net: number | undefined,
  netName: string,
  pinFunction: string,
  pinType: string,
): SList {
  let out =
    net === undefined || net === UNCONNECTED_NET
      ? removeChildNamed(src, 'net')
      : patchChild(src, 'net', list(atom('net'), atom(String(net)), str(netName)));
  out = setStringChild(out, 'pinfunction', pinFunction);
  out = setStringChild(out, 'pintype', pinType);
  return out;
}

/** Replace one footprint of a board by index. */
const replaceFp = (board: Board, index: number, fp: PcbFootprint): Board => ({
  ...board,
  footprints: board.footprints.map((f, i) => (i === index ? fp : f)),
});

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ----- attributes -------------------------------------------------------------

/** FOOTPRINT_ATTR_T flags, as they are spelled in the file's `(attr …)`. */
const FP_EXCLUDE_FROM_BOM = 'exclude_from_bom';
const FP_EXCLUDE_FROM_POS_FILES = 'exclude_from_pos_files';
const FP_DNP = 'dnp';
const FP_BOARD_ONLY = 'board_only';

const hasAttribute = (fp: PcbFootprint, flag: string): boolean =>
  (fp.attributes ?? []).includes(flag);

function withAttribute(fp: PcbFootprint, flag: string, on: boolean): PcbFootprint {
  const current = fp.attributes ?? [];
  if (on === current.includes(flag)) return fp;
  const attributes = on ? [...current, flag] : current.filter((a) => a !== flag);
  return { ...fp, attributes, source: setAttributes(fp.source, attributes) };
}

// ----- pad helpers ------------------------------------------------------------

/** PAD::IsOnCopperLayer. */
const padIsOnCopperLayer = (pad: PcbPad): boolean =>
  pad.layers.some((l) => l === '*.Cu' || l.endsWith('.Cu'));

/** PAD::IsNoConnectPad, an unnumbered pad cannot be matched to a pin. */
const padIsNoConnect = (pad: PcbPad): boolean => pad.number === '';

// ----- the updater ------------------------------------------------------------

/**
 * BOARD_NETLIST_UPDATER, one instance per run, exactly as upstream: construct,
 * set the options, call {@link UpdateNetlist}, read the counts back.
 */
export class BOARD_NETLIST_UPDATER {
  private m_board: Board;
  private readonly m_reporter: Reporter;
  private readonly m_loadFootprint: FootprintLoader;
  private readonly m_options: Required<BoardNetlistUpdaterOptions>;

  /** Pad net names as this run has set them, for dry-run inspection (m_padNets). */
  private m_padNets = new Map<string, string>();
  /** Old net name -> new net name, for the zone/via rescue (m_oldToNewNets). */
  private m_oldToNewNets = new Map<string, string>();
  /** Nets this run added, by name (m_addedNets). */
  private m_addedNets = new Set<string>();
  /** Every net name the schematic knows, for NC-pad de-duplication. */
  private m_schematicNetNames = new Set<string>();
  /** Zone index -> the net names of the pads connected to it (m_zoneConnectionsCache). */
  private m_zoneConnectionsCache = new Map<number, string[]>();

  private m_addedFootprints: number[] = [];
  private m_addedGroups: string[] = [];
  private m_errorCount = 0;
  private m_warningCount = 0;
  private m_newFootprintsCount = 0;

  constructor(
    board: Board,
    reporter: Reporter,
    loadFootprint: FootprintLoader,
    options: BoardNetlistUpdaterOptions = {},
  ) {
    this.m_board = board;
    this.m_reporter = reporter;
    this.m_loadFootprint = loadFootprint;
    this.m_options = {
      isDryRun: false,
      replaceFootprints: true,
      deleteUnusedFootprints: false,
      lookupByTimestamp: false,
      overrideLocks: false,
      updateFields: false,
      removeExtraFields: false,
      transferGroups: false,
      ...options,
    };
  }

  private report(message: string, severity: number): void {
    this.m_reporter.report(message, severity);
  }

  private get dryRun(): boolean {
    return this.m_options.isDryRun;
  }

  /** getNetname, during a dry run, the net this run has already assigned. */
  private getNetname(padKey: string, pad: PcbPad): string {
    if (this.dryRun && this.m_padNets.has(padKey)) return this.m_padNets.get(padKey)!;
    return pad.net === undefined ? '' : (this.m_board.nets.get(pad.net) ?? '');
  }

  /**
   * estimateFootprintInsertionPosition, below any existing board features, or the
   * centre of the page when the board is empty.
   */
  private estimateFootprintInsertionPosition(): { x: number; y: number } {
    const bbox = this.boardEdgesBoundingBox();
    if (bbox) {
      return {
        x: Math.round((bbox.minX + bbox.maxX) / 2),
        y: bbox.maxY + mmToIU(10),
      };
    }
    // BOARD::GetPageSettings().GetSizeIU, A4 landscape is KiCad's default page.
    const page = pageSizeIU(this.m_board.paper);
    return { x: Math.round(page.x / 2), y: Math.round(page.y / 2) };
  }

  /** BOARD::GetBoardEdgesBoundingBox, the Edge.Cuts outline's extents. */
  private boardEdgesBoundingBox(): {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null {
    let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
    this.m_board.shapes.forEach((shape, i) => {
      if (shape.layer !== 'Edge.Cuts') return;
      const b = boardItemBBox(this.m_board, `shape:${i}`);
      if (!b) return;
      box = box
        ? {
            minX: Math.min(box.minX, b.minX),
            minY: Math.min(box.minY, b.minY),
            maxX: Math.max(box.maxX, b.maxX),
            maxY: Math.max(box.maxY, b.maxY),
          }
        : { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
    });
    return box;
  }

  /**
   * addNewFootprint, load the component's footprint from the libraries and place
   * it on the board. Returns the index of the new footprint, or -1.
   */
  private addNewFootprint(component: COMPONENT, footprintId: string): number {
    const reference = component.GetReference();

    if (footprintId === '') {
      this.report(`Cannot add ${reference} (no footprint assigned).`, RPT_SEVERITY_ERROR);
      this.m_errorCount++;
      return -1;
    }

    const libFootprint = this.m_loadFootprint(footprintId);

    if (!libFootprint) {
      this.report(
        `Cannot add ${reference} (footprint '${escapeHtml(footprintId)}' not found).`,
        RPT_SEVERITY_ERROR,
      );
      this.m_errorCount++;
      return -1;
    }

    if (this.dryRun) {
      this.report(
        `Add ${reference} (footprint '${escapeHtml(footprintId)}').`,
        RPT_SEVERITY_ACTION,
      );
      this.m_newFootprintsCount++;
      return -1;
    }

    const placed = placeFootprint(libFootprint, {
      fpid: footprintId,
      at: this.estimateFootprintInsertionPosition(),
      uuid: newKiid(),
      path: componentPath(component),
    });

    if (!placed) {
      this.report(
        `Cannot add ${reference} (footprint '${escapeHtml(footprintId)}' not found).`,
        RPT_SEVERITY_ERROR,
      );
      this.m_errorCount++;
      return -1;
    }

    const index = this.m_board.footprints.length;
    this.m_board = { ...this.m_board, footprints: [...this.m_board.footprints, placed] };
    this.m_addedFootprints.push(index);

    this.report(
      `Added ${reference} (footprint '${escapeHtml(footprintId)}').`,
      RPT_SEVERITY_ACTION,
    );
    this.m_newFootprintsCount++;
    return index;
  }

  /**
   * replaceFootprint, swap a board footprint for the one the symbol now names.
   * Returns the (unchanged) index on success, -1 when nothing was replaced.
   */
  private replaceFootprint(index: number, component: COMPONENT): number {
    const footprint = this.m_board.footprints[index]!;
    const reference = footprint.reference ?? '';
    const newFpid = component.GetFPID();
    const oldFpid = escapeHtml(footprint.lib);

    if (newFpid === '') {
      this.report(
        `Cannot update ${component.GetReference()} (no footprint assigned).`,
        RPT_SEVERITY_ERROR,
      );
      this.m_errorCount++;
      return -1;
    }

    const libFootprint = this.m_loadFootprint(newFpid);

    if (!libFootprint) {
      this.report(
        `Cannot update ${component.GetReference()} (footprint '${escapeHtml(newFpid)}' not found).`,
        RPT_SEVERITY_ERROR,
      );
      this.m_errorCount++;
      return -1;
    }

    if (footprint.locked && !this.m_options.overrideLocks) {
      this.report(
        this.dryRun
          ? `Cannot change ${reference} footprint from '${oldFpid}' to '${escapeHtml(newFpid)}' (footprint is locked).`
          : `Could not change ${reference} footprint from '${oldFpid}' to '${escapeHtml(newFpid)}' (footprint is locked).`,
        RPT_SEVERITY_WARNING,
      );
      this.m_warningCount++;
      return -1;
    }

    if (this.dryRun) {
      this.report(
        `Change ${reference} footprint from '${oldFpid}' to '${escapeHtml(newFpid)}'.`,
        RPT_SEVERITY_ACTION,
      );
      this.m_newFootprintsCount++;
      return -1;
    }

    const exchanged = exchangeFootprint(footprint, libFootprint, newFpid);
    if (!exchanged) return -1;

    this.m_board = replaceFp(this.m_board, index, exchanged);
    this.report(
      `Changed ${reference} footprint from '${oldFpid}' to '${escapeHtml(newFpid)}'.`,
      RPT_SEVERITY_ACTION,
    );
    this.m_newFootprintsCount++;
    return index;
  }

  /**
   * updateFootprintParameters, reference, value, symbol link, fields, sheet name
   * and file, and the fabrication attributes the netlist carries.
   */
  private updateFootprintParameters(index: number, component: COMPONENT): void {
    let footprint = this.m_board.footprints[index]!;
    const reference = footprint.reference ?? '';

    // Test for reference designator field change.
    if (reference !== component.GetReference()) {
      this.report(
        this.dryRun
          ? `Change ${reference} reference designator to ${component.GetReference()}.`
          : `Changed ${reference} reference designator to ${component.GetReference()}.`,
        RPT_SEVERITY_ACTION,
      );
      if (!this.dryRun)
        footprint = setFootprintText(footprint, 'reference', component.GetReference());
    }

    // Test for value field change.
    const netlistValue = component.GetValue();
    if ((footprint.value ?? '') !== netlistValue) {
      this.report(
        this.dryRun
          ? `Change ${reference} value from ${escapeHtml(footprint.value ?? '')} to ${escapeHtml(netlistValue)}.`
          : `Changed ${reference} value from ${escapeHtml(footprint.value ?? '')} to ${escapeHtml(netlistValue)}.`,
        RPT_SEVERITY_ACTION,
      );
      if (!this.dryRun) footprint = setFootprintText(footprint, 'value', netlistValue);
    }

    // Test for symbol link (time stamp) change.
    const newPath = componentPath(component);
    if ((footprint.path ?? '') !== newPath) {
      this.report(
        this.dryRun
          ? `Update ${reference} symbol association from ${escapeHtml(footprint.path ?? '')} to ${escapeHtml(newPath)}.`
          : `Updated ${reference} symbol association from ${escapeHtml(footprint.path ?? '')} to ${escapeHtml(newPath)}.`,
        RPT_SEVERITY_ACTION,
      );
      if (!this.dryRun) {
        footprint = {
          ...footprint,
          path: newPath,
          source: setStringChild(footprint.source, 'path', newPath),
        };
      }
    }

    footprint = this.updateFootprintFields(footprint, component, reference);

    // Sheet name / sheet file / footprint filters.
    const humanSheetPath = component.GetHumanReadablePath();
    const sheetname =
      humanSheetPath !== '' ? humanSheetPath : (component.GetProperties().get('Sheetname') ?? '');
    const sheetfile = component.GetProperties().get('Sheetfile') ?? '';
    const fpFilters = component.GetProperties().get('ki_fp_filters') ?? '';

    if (sheetname !== (footprint.sheetname ?? '')) {
      this.report(
        this.dryRun
          ? `Update ${reference} sheetname to '${escapeHtml(sheetname)}'.`
          : `Updated ${reference} sheetname to '${escapeHtml(sheetname)}'.`,
        RPT_SEVERITY_ACTION,
      );
      if (!this.dryRun) footprint = setSheetInfo(footprint, 'sheetname', sheetname);
    }

    if (sheetfile !== (footprint.sheetfile ?? '')) {
      this.report(
        this.dryRun
          ? `Update ${reference} sheetfile to '${escapeHtml(sheetfile)}'.`
          : `Updated ${reference} sheetfile to '${escapeHtml(sheetfile)}'.`,
        RPT_SEVERITY_ACTION,
      );
      if (!this.dryRun) footprint = setSheetInfo(footprint, 'sheetfile', sheetfile);
    }

    if (fpFilters !== (footprint.filters ?? '')) {
      this.report(
        this.dryRun
          ? `Update ${reference} footprint filters to '${escapeHtml(fpFilters)}'.`
          : `Updated ${reference} footprint filters to '${escapeHtml(fpFilters)}'.`,
        RPT_SEVERITY_ACTION,
      );
      if (!this.dryRun) footprint = setFootprintFilters(footprint, fpFilters);
    }

    footprint = this.updateFabricationAttributes(footprint, component, reference);

    this.m_board = replaceFp(this.m_board, index, footprint);
  }

  /** The `(property …)` fields part of updateFootprintParameters. */
  private updateFootprintFields(
    footprint: PcbFootprint,
    component: COMPONENT,
    reference: string,
  ): PcbFootprint {
    // Reference, Value and Footprint are handled individually above.
    const compFields = new Map(component.GetFields());
    compFields.delete('Reference');
    compFields.delete('Value');
    compFields.delete('Footprint');
    // Component class fields are not editable in the pcb editor.
    compFields.delete('Component Class');

    // The footprint's *user* fields: a reserved property is not one (see
    // RESERVED_FOOTPRINT_PROPERTIES), so a legacy board's Sheetname / Sheetfile /
    // ki_description properties must not read as fields the symbol is missing.
    const userFields = (footprint.fields ?? []).filter(
      (f) => !RESERVED_FOOTPRINT_PROPERTIES.has(f.name),
    );
    const fpFields = new Map(userFields.map((f) => [f.name, f.value]));

    let same = true;
    let removeOnly = true;

    for (const [name, value] of compFields) {
      if (!fpFields.has(name) || fpFields.get(name) !== value) {
        same = false;
        removeOnly = false;
        break;
      }
    }
    if (same) {
      for (const name of fpFields.keys()) {
        if (!compFields.has(name)) {
          same = false;
          break;
        }
      }
    }

    if (same) return footprint;

    const wantsUpdate =
      this.m_options.updateFields && (!removeOnly || this.m_options.removeExtraFields);
    const extraFields = [...fpFields.keys()].filter((name) => !compFields.has(name));

    if (this.dryRun) {
      if (wantsUpdate) this.report(`Update ${reference} fields.`, RPT_SEVERITY_ACTION);
      if (this.m_options.removeExtraFields && extraFields.length > 0)
        this.report(`Remove ${reference} footprint fields not in symbol.`, RPT_SEVERITY_ACTION);
      return footprint;
    }

    let fields: PcbFootprintField[] = [...(footprint.fields ?? [])];

    if (wantsUpdate) {
      this.report(`Updated ${reference} fields.`, RPT_SEVERITY_ACTION);
      for (const [name, value] of compFields) {
        const existing = fields.findIndex((f) => f.name === name);
        if (existing >= 0) {
          const field = fields[existing]!;
          fields[existing] = { ...field, value, source: replaceArg(field.source, 1, value) };
        } else {
          // A brand-new field is source-less; the writer builds it from the model
          // (invisible, on the fab layer, at the footprint anchor).
          fields.push({ name, value, source: { kind: 'list', items: [] } });
        }
      }
    }

    if (this.m_options.removeExtraFields && extraFields.length > 0) {
      this.report(`Removed ${reference} footprint fields not in symbol.`, RPT_SEVERITY_ACTION);
      // A reserved property is not a field, so it is never removed as "extra".
      fields = fields.filter(
        (f) => compFields.has(f.name) || RESERVED_FOOTPRINT_PROPERTIES.has(f.name),
      );
    }

    return { ...footprint, fields };
  }

  /** The fabrication-attribute part of updateFootprintParameters. */
  private updateFabricationAttributes(
    footprint: PcbFootprint,
    component: COMPONENT,
    reference: string,
  ): PcbFootprint {
    if (!this.m_options.updateFields) return footprint;

    const flags: { property: string; flag: string; label: string }[] = [
      { property: 'exclude_from_bom', flag: FP_EXCLUDE_FROM_BOM, label: "'exclude from BOM'" },
      { property: 'dnp', flag: FP_DNP, label: "'Do not place'" },
      {
        property: 'exclude_from_pos_files',
        flag: FP_EXCLUDE_FROM_POS_FILES,
        label: "'exclude from position files'",
      },
    ];

    let out = footprint;

    for (const { property, flag, label } of flags) {
      const wanted = component.GetProperties().has(property);
      if (wanted === hasAttribute(out, flag)) continue;

      if (this.dryRun) {
        this.report(
          wanted
            ? `Add ${reference} ${label} fabrication attribute.`
            : `Remove ${reference} ${label} fabrication attribute.`,
          RPT_SEVERITY_ACTION,
        );
      } else {
        out = withAttribute(out, flag, wanted);
        this.report(
          wanted
            ? `Added ${reference} ${label} fabrication attribute.`
            : `Removed ${reference} ${label} fabrication attribute.`,
          RPT_SEVERITY_ACTION,
        );
      }
    }

    return out;
  }

  /**
   * updateComponentPadConnections, the heart of the update: every pad's net, pin
   * function and pin type, taken from the component's netlist entry.
   */
  private updateComponentPadConnections(index: number, component: COMPONENT): void {
    let footprint = this.m_board.footprints[index]!;
    const reference = footprint.reference ?? '';
    const padNetnames = new Set<string>();

    // Pads are visited in UUID order, as upstream sorts them, so the "_N" suffixes
    // a no-connect pad group gets are stable across runs.
    const order = footprint.pads
      .map((pad, padIndex) => ({ pad, padIndex }))
      .sort((a, b) => (a.pad.uuid ?? '').localeCompare(b.pad.uuid ?? ''));

    const pads = [...footprint.pads];

    for (const { pad, padIndex } of order) {
      const padKey = `${index}:${padIndex}`;
      const net = component.GetNet(pad.number);
      const pinFunction = net.IsValid() ? net.pinFunction : '';
      const pinType = net.IsValid() ? net.pinType : '';
      const currentNetname = this.getNetname(padKey, pad);

      // Test if the pad has no net (pads not on copper layers have no net).
      if (!net.IsValid() || !padIsOnCopperLayer(pad)) {
        if (currentNetname !== '') {
          this.report(
            this.dryRun
              ? `Disconnect ${reference} pin ${escapeHtml(pad.number)}.`
              : `Disconnected ${reference} pin ${escapeHtml(pad.number)}.`,
            RPT_SEVERITY_ACTION,
          );
        } else if (padIsOnCopperLayer(pad) && pad.number !== '') {
          // The pad is connectable but has no net found in the netlist.
          this.report(
            `No net found for component ${reference} pad ${escapeHtml(pad.number)} (no pin ${escapeHtml(pad.number)} in symbol).`,
            RPT_SEVERITY_WARNING,
          );
          this.m_warningCount++;
        }

        if (this.dryRun) {
          this.m_padNets.set(padKey, '');
        } else {
          pads[padIndex] = {
            ...pad,
            net: UNCONNECTED_NET,
            // A pad with no net from the netlist cannot have a pin function.
            pinFunction: currentNetname === '' ? '' : pinFunction,
            pinType,
            source: setPadNetSource(
              pad.source,
              UNCONNECTED_NET,
              '',
              currentNetname === '' ? '' : pinFunction,
              pinType,
            ),
          };
        }
        continue;
      }

      // The pad has a net. A no-connect pad gets its own net per pad, suffixed so
      // two unconnected pads never end up shorted together.
      let netName = net.netName;

      if (padIsNoConnect(pad)) {
        let suffix = 1;
        while (
          !insertUnique(padNetnames, netName) ||
          (netName !== net.netName && this.m_schematicNetNames.has(netName))
        ) {
          netName = `${net.netName}_${suffix}`;
          suffix++;
        }
      }

      if (currentNetname === netName) continue;

      let code = findNet(this.m_board, netName);

      if (code === undefined) {
        if (this.dryRun) {
          this.m_addedNets.add(netName);
        } else {
          const appended = appendNet(this.m_board, netName);
          this.m_board = appended.board;
          code = appended.code;
          this.m_addedNets.add(netName);
        }
        this.report(`Add net ${escapeHtml(unescapeString(netName))}.`, RPT_SEVERITY_ACTION);
      }

      if (currentNetname !== '') {
        this.m_oldToNewNets.set(currentNetname, netName);
        this.report(
          this.dryRun
            ? `Reconnect ${reference} pin ${escapeHtml(pad.number)} from ${escapeHtml(unescapeString(currentNetname))} to ${escapeHtml(unescapeString(netName))}.`
            : `Reconnected ${reference} pin ${escapeHtml(pad.number)} from ${escapeHtml(unescapeString(currentNetname))} to ${escapeHtml(unescapeString(netName))}.`,
          RPT_SEVERITY_ACTION,
        );
      } else {
        this.report(
          this.dryRun
            ? `Connect ${reference} pin ${escapeHtml(pad.number)} to ${escapeHtml(unescapeString(netName))}.`
            : `Connected ${reference} pin ${escapeHtml(pad.number)} to ${escapeHtml(unescapeString(netName))}.`,
          RPT_SEVERITY_ACTION,
        );
      }

      if (this.dryRun) {
        this.m_padNets.set(padKey, netName);
      } else {
        pads[padIndex] = {
          ...pad,
          net: code,
          pinFunction,
          pinType,
          source: setPadNetSource(pad.source, code, netName, pinFunction, pinType),
        };
      }
    }

    if (!this.dryRun) {
      footprint = { ...footprint, pads };
      this.m_board = replaceFp(this.m_board, index, footprint);
    }
  }

  /**
   * updateFootprintGroup, move a footprint into the PCB group that mirrors its
   * symbol's group, creating that group when the board has none with its UUID.
   */
  private updateFootprintGroup(index: number, component: COMPONENT): void {
    if (!this.m_options.transferGroups) return;

    const footprint = this.m_board.footprints[index]!;
    const uuid = footprint.uuid;
    if (!uuid) return;

    const reference = footprint.reference ?? '';
    const netlistGroup = component.GetGroup();
    const newGroupUuid = netlistGroup ? netlistGroup.uuid : '';

    const existingIndex = this.m_board.groups.findIndex((g) => g.members.includes(uuid));
    const existingGroup = existingIndex >= 0 ? this.m_board.groups[existingIndex]! : null;
    const existingGroupUuid = existingGroup?.uuid ?? '';

    if (newGroupUuid === existingGroupUuid) return;

    if (existingGroup && existingGroupUuid !== '') {
      this.report(
        this.dryRun
          ? `Remove ${reference} from group '${escapeHtml(existingGroup.name)}'.`
          : `Removed ${reference} from group '${escapeHtml(existingGroup.name)}'.`,
        RPT_SEVERITY_ACTION,
      );
      if (!this.dryRun) {
        const members = existingGroup.members.filter((m) => m !== uuid);
        // A group with fewer than two items left is dissolved.
        this.m_board = {
          ...this.m_board,
          groups: this.m_board.groups.map((g, i) =>
            i === existingIndex ? withGroupMembers(g, members.length < 2 ? [] : members) : g,
          ),
        };
      }
    }

    if (netlistGroup && newGroupUuid !== '') {
      this.report(
        this.dryRun
          ? `Add ${reference} to group '${escapeHtml(netlistGroup.name)}'.`
          : `Added ${reference} to group '${escapeHtml(netlistGroup.name)}'.`,
        RPT_SEVERITY_ACTION,
      );
      if (!this.dryRun) {
        const targetIndex = this.m_board.groups.findIndex((g) => g.uuid === newGroupUuid);
        if (targetIndex >= 0) {
          const target = this.m_board.groups[targetIndex]!;
          this.m_board = {
            ...this.m_board,
            groups: this.m_board.groups.map((g, i) =>
              i === targetIndex ? withGroupMembers(target, [...target.members, uuid]) : g,
            ),
          };
        } else {
          const group: PcbGroup = {
            name: netlistGroup.name,
            uuid: newGroupUuid,
            members: [uuid],
            source: { kind: 'list', items: [] },
          };
          this.m_board = { ...this.m_board, groups: [...this.m_board.groups, group] };
          this.m_addedGroups.push(newGroupUuid);
        }
      }
    }
  }

  /** updateGroups, a PCB group's name follows its netlist group's name. */
  private updateGroups(netlist: NETLIST): void {
    if (!this.m_options.transferGroups) return;

    this.m_board.groups.forEach((pcbGroup, i) => {
      const netlistGroup = pcbGroup.uuid ? netlist.GetGroupByUuid(pcbGroup.uuid) : null;
      if (!netlistGroup) return;
      if (netlistGroup.name === pcbGroup.name) return;

      this.report(
        this.dryRun
          ? `Change group name from '${escapeHtml(pcbGroup.name)}' to '${escapeHtml(netlistGroup.name)}'.`
          : `Changed group name from '${escapeHtml(pcbGroup.name)}' to '${escapeHtml(netlistGroup.name)}'.`,
        RPT_SEVERITY_ACTION,
      );

      if (!this.dryRun) {
        this.m_board = {
          ...this.m_board,
          groups: this.m_board.groups.map((g, j) =>
            j === i
              ? { ...g, name: netlistGroup.name, source: renameGroup(g.source, netlistGroup.name) }
              : g,
          ),
        };
      }
    });
  }

  /** cacheCopperZoneConnections, the pads each copper zone touches, before any edit. */
  private cacheCopperZoneConnections(): void {
    this.m_board.zones.forEach((zone, zoneIndex) => {
      if (!zoneIsOnCopperLayer(zone)) return;
      const padKeys: string[] = [];
      this.m_board.footprints.forEach((fp, fpIndex) => {
        fp.pads.forEach((pad, padIndex) => {
          if (pad.net === undefined || pad.net === UNCONNECTED_NET) return;
          if (pad.net !== zone.net) return;
          padKeys.push(`${fpIndex}:${padIndex}`);
        });
      });
      this.m_zoneConnectionsCache.set(zoneIndex, padKeys);
    });
  }

  /**
   * updateCopperZoneNets, stitching vias and copper zones sitting on a net the
   * netlist no longer has are moved to the net their pads went to, so a rename does
   * not leave dead copper behind.
   */
  private updateCopperZoneNets(netlist: NETLIST): void {
    const netlistNetnames = new Set<string>();
    for (const component of netlist.Components()) {
      for (let i = 0; i < component.GetNetCount(); i++)
        netlistNetnames.add(component.GetNetAt(i).netName);
    }

    // Vias first.
    this.m_board.vias.forEach((via, i) => {
      const viaNetname = this.m_board.nets.get(via.net) ?? '';
      if (netlistNetnames.has(viaNetname)) return;

      // Take the via's name from the name-change map if it did not match a new pad
      // (useful for stitching vias that do not connect to tracks).
      const updatedNetname = this.m_oldToNewNets.get(viaNetname) ?? '';

      if (updatedNetname === '') {
        this.report(
          `Via connected to unknown net (${escapeHtml(unescapeString(viaNetname))}).`,
          RPT_SEVERITY_WARNING,
        );
        this.m_warningCount++;
        return;
      }

      this.report(
        this.dryRun
          ? `Reconnect via from ${escapeHtml(unescapeString(viaNetname))} to ${escapeHtml(unescapeString(updatedNetname))}.`
          : `Reconnected via from ${escapeHtml(unescapeString(viaNetname))} to ${escapeHtml(unescapeString(updatedNetname))}.`,
        RPT_SEVERITY_ACTION,
      );

      if (this.dryRun) return;
      const code = findNet(this.m_board, updatedNetname);
      if (code === undefined) return;
      this.m_board = {
        ...this.m_board,
        vias: this.m_board.vias.map((v, j) =>
          j === i ? { ...v, net: code, source: setItemNet(v.source, code) } : v,
        ),
      };
    });

    /**
     * Board connectivity net names are not the same as schematic net names:
     * footprints with several overlapping pads of the same number get a "_N" suffix
     * for internal use, and those pseudo names ended up in the zone net name list.
     */
    const isInNetlist = (netName: string): boolean =>
      netlistNetnames.has(netName) || [...netlistNetnames].some((n) => netName.startsWith(n));

    this.m_board.zones.forEach((zone, i) => {
      if (!zoneIsOnCopperLayer(zone)) return;
      const zoneNetname = this.m_board.nets.get(zone.net) ?? zone.netName ?? '';
      if (isInNetlist(zoneNetname)) return;

      // Look for a pad in the zone's connected-pad cache that has been updated to a
      // new net and use that. While this will not always be the right net, the dead
      // net is guaranteed to be wrong.
      let updatedNetname = '';
      for (const padKey of this.m_zoneConnectionsCache.get(i) ?? []) {
        const [fpIndex, padIndex] = padKey.split(':').map(Number);
        const pad = this.m_board.footprints[fpIndex!]?.pads[padIndex!];
        if (!pad) continue;
        const padNetname = this.getNetname(padKey, pad);
        if (padNetname !== zoneNetname) {
          updatedNetname = padNetname;
          break;
        }
      }

      // Take the zone's name from the name-change map if it did not match a new pad
      // (useful for zones on internal layers).
      if (updatedNetname === '') updatedNetname = this.m_oldToNewNets.get(zoneNetname) ?? '';

      if (updatedNetname === '') {
        const layerNames = zone.layers.join(', ');
        this.report(
          `Copper zone on ${escapeHtml(layerNames)} at (${iuToMM(zone.outline?.[0]?.x ?? 0).toFixed(4)}, ${iuToMM(zone.outline?.[0]?.y ?? 0).toFixed(4)}) has no pads connected to net "${escapeHtml(zoneNetname)}".`,
          RPT_SEVERITY_WARNING,
        );
        this.m_warningCount++;
        return;
      }

      this.report(
        this.dryRun
          ? `Reconnect copper zone from ${escapeHtml(unescapeString(zoneNetname))} to ${escapeHtml(unescapeString(updatedNetname))}.`
          : `Reconnected copper zone from ${escapeHtml(unescapeString(zoneNetname))} to ${escapeHtml(unescapeString(updatedNetname))}.`,
        RPT_SEVERITY_ACTION,
      );

      if (this.dryRun) return;
      const code = findNet(this.m_board, updatedNetname);
      if (code === undefined) return;
      this.m_board = {
        ...this.m_board,
        zones: this.m_board.zones.map((z, j) =>
          j === i
            ? {
                ...z,
                net: code,
                netName: updatedNetname,
                source: setZoneNet(z.source, code, updatedNetname),
              }
            : z,
        ),
      };
    });
  }

  /**
   * testConnectivity, verify the board carries every pad the netlist mentions: if
   * it does not, the footprints are wrong or the symbol's pins are unnumbered.
   */
  private testConnectivity(netlist: NETLIST, footprintMap: Map<COMPONENT, number>): void {
    for (const component of netlist.Components()) {
      const index = footprintMap.get(component);
      if (index === undefined) continue; // It can be missing in partial designs.
      const footprint = this.m_board.footprints[index];
      if (!footprint) continue;

      for (let i = 0; i < component.GetNetCount(); i++) {
        const padNumber = component.GetNetAt(i).pinName;

        if (padNumber === '') {
          this.report(
            `Symbol ${component.GetReference()} has pins with no number.  These pins can not be matched to pads in ${escapeHtml(footprint.lib)}.`,
            RPT_SEVERITY_ERROR,
          );
          this.m_errorCount++;
        } else if (!footprint.pads.some((pad) => pad.number === padNumber)) {
          this.report(
            `${component.GetReference()} pad ${escapeHtml(padNumber)} not found in ${escapeHtml(footprint.lib)}.`,
            RPT_SEVERITY_ERROR,
          );
          this.m_errorCount++;
        }
      }
    }
  }

  /**
   * BOARD_NETLIST_UPDATER::UpdateNetlist, the whole process, in upstream's order.
   */
  UpdateNetlist(netlist: NETLIST): BoardNetlistUpdateResult {
    this.m_errorCount = 0;
    this.m_warningCount = 0;
    this.m_newFootprintsCount = 0;
    this.m_addedFootprints = [];
    this.m_addedGroups = [];

    const footprintMap = new Map<COMPONENT, number>();
    const usedFootprints = new Set<number>();
    /** Footprints that existed before this run, so new ones are not re-matched. */
    const lastPreexistingFootprint = this.m_board.footprints.length - 1;

    this.cacheCopperZoneConnections();

    // Collect all schematic net names so NC pad de-duplication can avoid collisions.
    for (const component of netlist.Components()) {
      for (let i = 0; i < component.GetNetCount(); i++)
        this.m_schematicNetNames.add(component.GetNetAt(i).netName);
    }

    // Go through the netlist updating all board footprints which have matching
    // component entries and adding new footprints for those that don't.
    for (const component of netlist.Components()) {
      if (component.GetProperties().has('exclude_from_board')) continue;

      this.report(
        `Processing symbol '${component.GetReference()}:${escapeHtml(component.GetFPID())}'.`,
        RPT_SEVERITY_INFO,
      );

      const baseFpid = component.GetFPID();

      if (fpidIsLegacy(baseFpid)) {
        this.report(
          `Warning: ${component.GetReference()} footprint '${escapeHtml(baseFpid)}' is missing a library name. Use the full 'Library:Footprint' format to avoid repeated update notifications.`,
          RPT_SEVERITY_WARNING,
        );
        this.m_warningCount++;
      }

      // The board footprints that match this component, by UUID path or reference.
      const matching: number[] = [];
      for (let i = 0; i <= lastPreexistingFootprint; i++) {
        const footprint = this.m_board.footprints[i]!;
        let match = false;

        if (this.m_options.lookupByTimestamp) {
          match = (footprint.path ?? '') === componentPath(component);
          if (!match) {
            match = component.kiids.some(
              (uuid) => (footprint.path ?? '') === joinPath(component.path, uuid),
            );
          }
        } else {
          match =
            (footprint.reference ?? '').toLowerCase() === component.GetReference().toLowerCase();
        }

        if (match) matching.push(i);
      }

      let index = matching.find(
        (i) => !usedFootprints.has(i) && fpidsEquivalent(this.m_board.footprints[i]!.lib, baseFpid),
      );

      if (index === undefined && baseFpid === '' && matching.length > 0) {
        index = matching[0];
      }

      // A footprint that matches by reference but carries a different footprint id
      // is the one to replace (or to keep, when replacement is off).
      if (index === undefined && matching.length > 0) {
        const candidate = matching.find(
          (i) =>
            !usedFootprints.has(i) && !fpidsEquivalent(this.m_board.footprints[i]!.lib, baseFpid),
        );
        if (candidate !== undefined) {
          if (this.m_options.replaceFootprints) {
            const replaced = this.replaceFootprint(candidate, component);
            index = replaced >= 0 ? replaced : candidate;
          } else {
            index = candidate;
          }
        }
      }

      if (index === undefined) {
        const added = this.addNewFootprint(component, baseFpid);
        if (added >= 0) index = added;
      }

      if (index === undefined) continue;

      usedFootprints.add(index);
      footprintMap.set(component, index);

      this.updateFootprintParameters(index, component);
      this.updateFootprintGroup(index, component);
      this.updateComponentPadConnections(index, component);
    }

    this.updateCopperZoneNets(netlist);
    this.updateGroups(netlist);

    // Finally go through the board footprints and update all those that *don't*
    // have matching component entries.
    const toDelete: number[] = [];

    this.m_board.footprints.forEach((footprint, i) => {
      let matched = usedFootprints.has(i);
      let doDelete = this.m_options.deleteUnusedFootprints;

      if (hasAttribute(footprint, FP_BOARD_ONLY)) doDelete = false;

      if (!matched) {
        const component = this.m_options.lookupByTimestamp
          ? netlist.GetComponentByPath(footprint.path ?? '')
          : netlist.GetComponentByReference(footprint.reference ?? '');
        if (component && !component.GetProperties().has('exclude_from_board')) matched = true;
      }

      if (doDelete && !matched && footprint.locked && !this.m_options.overrideLocks) {
        this.report(
          this.dryRun
            ? `Cannot remove unused footprint ${footprint.reference ?? ''} (footprint is locked).`
            : `Could not remove unused footprint ${footprint.reference ?? ''} (footprint is locked).`,
          RPT_SEVERITY_WARNING,
        );
        this.m_warningCount++;
        doDelete = false;
      }

      if (doDelete && !matched) {
        this.report(
          this.dryRun
            ? `Remove unused footprint ${footprint.reference ?? ''}.`
            : `Removed unused footprint ${footprint.reference ?? ''}.`,
          RPT_SEVERITY_ACTION,
        );
        if (!this.dryRun) toDelete.push(i);
      } else if (!this.dryRun && !matched) {
        // An unmatched footprint that stays loses its symbol link.
        this.m_board = replaceFp(this.m_board, i, {
          ...footprint,
          path: undefined,
          source: removeChildNamed(footprint.source, 'path'),
        });
      }
    });

    if (!this.dryRun) {
      if (toDelete.length > 0) {
        const drop = new Set(toDelete);
        const droppedUuids = new Set(
          toDelete.map((i) => this.m_board.footprints[i]?.uuid).filter(Boolean) as string[],
        );
        this.m_board = {
          ...this.m_board,
          footprints: this.m_board.footprints.filter((_, i) => !drop.has(i)),
          // A deleted footprint must not stay a group member.
          groups: this.m_board.groups.map((g) =>
            g.members.some((m) => droppedUuids.has(m))
              ? withGroupMembers(
                  g,
                  g.members.filter((m) => !droppedUuids.has(m)),
                )
              : g,
          ),
        };
        // Indices of added footprints shift when earlier ones are removed.
        this.m_addedFootprints = this.m_addedFootprints
          .filter((i) => !drop.has(i))
          .map((i) => i - toDelete.filter((d) => d < i).length);
      }

      this.testConnectivity(netlist, footprintMap);

      // Nets with nothing on them are dropped (BOARD::RemoveUnusedNets, driven by
      // NETINFO_ITEM::IsCurrent).
      const usedNets = new Set<number>();
      for (const footprint of this.m_board.footprints)
        for (const pad of footprint.pads) if (pad.net !== undefined) usedNets.add(pad.net);
      for (const track of this.m_board.tracks) usedNets.add(track.net);
      for (const arc of this.m_board.arcs) usedNets.add(arc.net);
      for (const via of this.m_board.vias) usedNets.add(via.net);
      for (const zone of this.m_board.zones) usedNets.add(zone.net);

      for (const [code, name] of this.m_board.nets) {
        if (code !== UNCONNECTED_NET && !usedNets.has(code))
          this.report(`Removed unused net ${escapeHtml(name)}.`, RPT_SEVERITY_ACTION);
      }

      this.m_board = removeUnusedNets(this.m_board, usedNets);
    }

    this.m_reporter.reportTail('', RPT_SEVERITY_ACTION);
    this.m_reporter.reportTail('', RPT_SEVERITY_ACTION);
    this.m_reporter.reportTail(
      `Total warnings: ${this.m_warningCount}, errors: ${this.m_errorCount}.`,
      RPT_SEVERITY_INFO,
    );

    return {
      board: this.m_board,
      addedFootprints: this.m_addedFootprints,
      addedGroups: this.m_addedGroups,
      errorCount: this.m_errorCount,
      warningCount: this.m_warningCount,
      newFootprintCount: this.m_newFootprintsCount,
    };
  }
}

// ----- free functions ---------------------------------------------------------

/**
 * BOARD_NETLIST_UPDATER::fpidsEquivalent, compare a board footprint id against a
 * schematic-derived one, ignoring the library nickname when the schematic side uses
 * a legacy bare footprint name. A board footprint always carries a nickname, so a
 * strict equality test would never match a legacy schematic FPID.
 */
export function fpidsEquivalent(boardFpid: string, schematicFpid: string): boolean {
  if (fpidIsLegacy(schematicFpid)) return fpidItemName(boardFpid) === fpidItemName(schematicFpid);
  return boardFpid === schematicFpid;
}

/** The full KIID_PATH of a component: its sheet path plus its primary symbol UUID. */
function componentPath(component: COMPONENT): string {
  const primary = component.kiids[0];
  return primary ? joinPath(component.path, primary) : component.path;
}

/** KIID_PATH::push_back, append a UUID to a "/a/b/" style path. */
function joinPath(path: string, uuid: string): string {
  const base = path === '' || path === '/' ? '/' : path.endsWith('/') ? path : `${path}/`;
  return `${base}${uuid}`;
}

/** std::set::insert's "was it new?" result. */
function insertUnique(set: Set<string>, value: string): boolean {
  if (set.has(value)) return false;
  set.add(value);
  return true;
}

/** ZONE::IsOnCopperLayer, and not a rule area. */
const zoneIsOnCopperLayer = (zone: PcbZone): boolean =>
  zone.layers.some((l) => l === '*.Cu' || l.endsWith('.Cu'));

/** Set a footprint's Reference or Value text, patching the model and its source. */
function setFootprintText(
  fp: PcbFootprint,
  kind: 'reference' | 'value',
  value: string,
): PcbFootprint {
  return {
    ...fp,
    ...(kind === 'reference' ? { reference: value } : { value }),
    texts: fp.texts.map((t) =>
      t.kind === kind ? { ...t, text: value, source: replaceArg(t.source, 1, value) } : t,
    ),
  };
}

/**
 * Set a footprint's sheet name or file. A board written before PCB fields keeps these
 * in `(property "Sheetname" …)` rather than the `(sheetname …)` token, so the value is
 * rewritten wherever it actually lives, writing the modern token next to a stale
 * legacy property would leave the footprint carrying two different answers.
 */
function setSheetInfo(
  fp: PcbFootprint,
  which: 'sheetname' | 'sheetfile',
  value: string,
): PcbFootprint {
  const legacyNames =
    which === 'sheetname' ? ['Sheetname', 'Sheet name'] : ['Sheetfile', 'Sheet file'];
  const fields = fp.fields ?? [];
  const legacyIndex = fields.findIndex((f) => legacyNames.includes(f.name));

  if (legacyIndex >= 0) {
    const field = fields[legacyIndex]!;
    return {
      ...fp,
      [which]: value,
      fields: fields.map((f, i) =>
        i === legacyIndex ? { ...field, value, source: replaceArg(field.source, 1, value) } : f,
      ),
    };
  }

  return { ...fp, [which]: value, source: setStringChild(fp.source, which, value) };
}

/** Set (or drop) a footprint's `(property ki_fp_filters "…")`. */
function setFootprintFilters(fp: PcbFootprint, filters: string): PcbFootprint {
  const items = fp.source.items.filter(
    (it) => !(isList(it) && head(it) === 'property' && arg(it, 0) === 'ki_fp_filters'),
  );
  if (filters !== '') items.push(list(atom('property'), str('ki_fp_filters'), str(filters)));
  return { ...fp, filters: filters || undefined, source: { kind: 'list', items } };
}

/** `(members "uuid" …)` of a group, kept in step with the model. */
function withGroupMembers(group: PcbGroup, members: string[]): PcbGroup {
  return {
    ...group,
    members,
    source:
      group.source.items.length === 0
        ? group.source
        : patchChild(group.source, 'members', {
            kind: 'list',
            items: [atom('members'), ...[...members].sort().map((m) => str(m))],
          }),
  };
}

/** `(group "name" …)`, the name is the first scalar after the head. */
function renameGroup(src: SList, name: string): SList {
  return src.items.length === 0 ? src : replaceArg(src, 0, name);
}

/** `(net <code>)` on a track/arc/via. */
function setItemNet(src: SList, code: number): SList {
  return patchChild(src, 'net', list(atom('net'), atom(String(code))));
}

/** `(net <code>)` + `(net_name "…")` on a zone. */
function setZoneNet(src: SList, code: number, name: string): SList {
  let out = patchChild(src, 'net', list(atom('net'), atom(String(code))));
  out = patchChild(out, 'net_name', list(atom('net_name'), str(name)));
  return out;
}

/**
 * PAGE_INFO::GetSizeIU for the board's paper token. A4 is KiCad's default; the
 * exact figure only decides where new footprints land on an empty board.
 */
function pageSizeIU(paper: string | undefined): { x: number; y: number } {
  const sizes: Record<string, [number, number]> = {
    A5: [210, 148],
    A4: [297, 210],
    A3: [420, 297],
    A2: [594, 420],
    A1: [841, 594],
    A0: [1189, 841],
    A: [279.4, 215.9],
    B: [431.8, 279.4],
    C: [558.8, 431.8],
    D: [863.6, 558.8],
    E: [1117.6, 863.6],
    USLetter: [279.4, 215.9],
    USLegal: [355.6, 215.9],
    USLedger: [431.8, 279.4],
  };
  const token = (paper ?? 'A4').split(/\s+/)[0] ?? 'A4';
  const [w, h] = sizes[token] ?? sizes.A4!;
  return { x: mmToIU(w!), y: mmToIU(h!) };
}
