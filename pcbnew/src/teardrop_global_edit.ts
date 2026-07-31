// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Edit Teardrops, the global edit behind `Edit → Edit Teardrops…`.
 * Counterpart: `pcbnew/dialogs/dialog_global_edit_teardrops.cpp`
 * (`visitItem`, `processItem`, `setSpecifiedParams`, `TransferDataFromWindow`).
 *
 * The dialog does not draw teardrops. It writes `(teardrops …)` onto the pads
 * and vias the filters select, and only then re-runs the generator — which is
 * why "remove" here means `m_Enabled = false` on the item rather than deleting
 * a zone: the zones are derived, the per-item parameters are the state.
 *
 * This module is the headless half, so the behaviour is testable without a UI.
 */

import {
  applyTeardrops,
  defaultTeardropParameters,
  isRound,
  type TeardropParametersList,
} from './teardrop.js';
import type { Board, PcbPad, PcbVia, TeardropParams } from './types.js';

/** What the Action radio group offers. */
export type TeardropEditAction =
  /** m_removeTeardrops: clear `enabled` on everything the filters select. */
  | 'remove'
  /** m_removeAllTeardrops: clear it everywhere, filters ignored. */
  | 'removeAll'
  /** m_addTeardrops: copy the Board Setup defaults for the item's shape. */
  | 'addDefaults'
  /** m_specifiedValues: overlay the values the dialog specifies. */
  | 'specified';

/**
 * The dialog's controls. A `null` filter is the unchecked checkbox; an absent
 * field in `specified` is a three-state control left indeterminate, which
 * upstream leaves untouched on the target rather than overwriting.
 */
export interface GlobalTeardropEditOptions {
  // ----- Scope -----
  /** m_pthPads. */
  pthPads: boolean;
  /** m_smdPads; covers SMD and edge-connector pads, as upstream does. */
  smdPads: boolean;
  /** m_vias. */
  vias: boolean;
  /** m_trackToTrack. */
  trackToTrack: boolean;

  // ----- Filter Items -----
  /** m_netFilter / m_netFilterOpt: the net code, or null when unchecked. */
  netFilter?: number | null;
  /** m_netclassFilter / m_netclassFilterOpt. Needs {@link netclassOf}. */
  netclassFilter?: string | null;
  /** m_layerFilter / m_layerFilterOpt. */
  layerFilter?: string | null;
  /** m_roundPadsFilter. */
  roundPadsOnly?: boolean;
  /** m_existingFilter: only items that already have teardrops enabled. */
  existingOnly?: boolean;
  /** m_selectedItemsFilter. Needs {@link isSelected}. */
  selectedOnly?: boolean;

  // ----- Action -----
  action: TeardropEditAction;
  /** The `m_specifiedValues` fields that are not indeterminate. */
  specified?: Partial<TeardropParams>;
}

/** Hooks for the board facts this module does not model itself. */
export interface GlobalTeardropEditContext {
  /** The board-level TEARDROP_PARAMETERS_LIST, for the "add defaults" action. */
  list: TeardropParametersList;
  /** Netclass names for a net code; without it the netclass filter matches nothing. */
  netclassOf?: (net: number) => readonly string[];
  /** Whether an item is in the current selection. */
  isSelected?: (item: PcbPad | PcbVia) => boolean;
  /** BOARD_DESIGN_SETTINGS::m_SolderMaskExpansion, for teardrop mask zones. */
  solderMaskExpansion?: number;
}

/** The item's stored parameters, or upstream's defaults when it has none. */
const paramsOf = (item: PcbPad | PcbVia): TeardropParams =>
  item.teardrops ?? defaultTeardropParameters();

/**
 * setSpecifiedParams: overlay only the fields the dialog actually specifies.
 *
 * The three-state controls are the point — a global edit that wants to turn on
 * curved edges without disturbing every item's max width has to leave the rest
 * indeterminate, and an overlay that filled in defaults would flatten them.
 */
function setSpecifiedParams(
  target: TeardropParams,
  specified: Partial<TeardropParams>,
): TeardropParams {
  const out = { ...target };

  for (const key of Object.keys(specified) as (keyof TeardropParams)[]) {
    const v = specified[key];
    if (v !== undefined) (out as Record<string, unknown>)[key] = v;
  }

  return out;
}

/** DIALOG_GLOBAL_EDIT_TEARDROPS::processItem. */
function processItem(
  item: PcbPad | PcbVia,
  opts: GlobalTeardropEditOptions,
  ctx: GlobalTeardropEditContext,
): TeardropParams {
  const target = paramsOf(item);

  if (opts.action === 'remove' || opts.action === 'removeAll') {
    return { ...target, enabled: false };
  }

  if (opts.action === 'addDefaults') {
    // NOTE: upstream ignores per-layer padstack shape variation here too.
    const source = isRound(item) ? ctx.list.round : ctx.list.rect;
    return { ...source, enabled: true };
  }

  const next = setSpecifiedParams(target, opts.specified ?? {});

  // The "existing teardrops only" filter means the edit is a tweak, not a
  // switch-on, so it must not enable anything that was off.
  return opts.existingOnly ? next : { ...next, enabled: true };
}

/**
 * DIALOG_GLOBAL_EDIT_TEARDROPS::visitItem: the filter gauntlet.
 * Returns the new parameters, or null when the item is filtered out.
 */
function visitItem(
  item: PcbPad | PcbVia,
  layer: string | undefined,
  net: number,
  opts: GlobalTeardropEditOptions,
  ctx: GlobalTeardropEditContext,
  selectAlways: boolean,
): TeardropParams | null {
  if (opts.selectedOnly && !(ctx.isSelected?.(item) ?? false)) return null;

  // "Remove all" bypasses every remaining filter, but not the selection one.
  if (selectAlways) return processItem(item, opts, ctx);

  if (opts.netFilter != null && net !== opts.netFilter) return null;

  if (opts.netclassFilter) {
    const classes = ctx.netclassOf?.(net) ?? [];
    if (!classes.includes(opts.netclassFilter)) return null;
  }

  if (opts.layerFilter && layer !== opts.layerFilter) return null;

  if (opts.roundPadsOnly && !isRound(item)) return null;

  if (opts.existingOnly && !paramsOf(item).enabled) return null;

  return processItem(item, opts, ctx);
}

/**
 * DIALOG_GLOBAL_EDIT_TEARDROPS::TransferDataFromWindow: stamp the parameters
 * onto the selected pads and vias, then rebuild every teardrop zone.
 *
 * Returns the new board and the updated parameters list — the dialog's scope
 * checkboxes are themselves saved into the board's TEARDROP_PARAMETERS_LIST.
 */
export function applyGlobalTeardropEdit(
  board: Board,
  opts: GlobalTeardropEditOptions,
  ctx: GlobalTeardropEditContext,
): { board: Board; list: TeardropParametersList } {
  const removeAll = opts.action === 'removeAll';

  // The scope checkboxes are saved back onto the board's list.
  const list: TeardropParametersList = {
    ...ctx.list,
    targetVias: opts.vias,
    targetPTHPads: opts.pthPads,
    targetSMDPads: opts.smdPads,
    targetTrack2Track: opts.trackToTrack,
    useRoundShapesOnly: opts.roundPadsOnly ?? false,
  };

  const editCtx: GlobalTeardropEditContext = { ...ctx, list };

  const vias =
    opts.vias || removeAll
      ? board.vias.map((via) => {
          // A via spans layers, so the layer filter compares against its outer
          // layer, matching PCB_TRACK::GetLayer for a via.
          const next = visitItem(via, via.layers[0], via.net, opts, editCtx, removeAll);
          return next ? { ...via, teardrops: next } : via;
        })
      : board.vias;

  const footprints = board.footprints.map((fp) => {
    let changed = false;

    const pads = fp.pads.map((pad) => {
      const isPTH = pad.type === 'thru_hole';
      const isSMD = pad.type === 'smd' || pad.type === 'connect';

      const inScope = removeAll || (opts.pthPads && isPTH) || (opts.smdPads && isSMD);

      if (!inScope) return pad;

      const next = visitItem(
        pad,
        pad.layers.find((l) => /\.Cu$/.test(l) || l === '*.Cu'),
        pad.net ?? 0,
        opts,
        editCtx,
        removeAll,
      );

      if (!next) return pad;

      changed = true;
      return { ...pad, teardrops: next };
    });

    return changed ? { ...fp, pads } : fp;
  });

  // The track-to-track parameters follow the action too.
  const finalList: TeardropParametersList = opts.trackToTrack
    ? {
        ...list,
        track:
          opts.action === 'remove' || removeAll
            ? { ...list.track, enabled: false }
            : opts.action === 'addDefaults'
              ? { ...list.track, enabled: true }
              : list.track,
      }
    : list;

  const staged: Board = { ...board, vias, footprints };

  return {
    board: applyTeardrops(staged, {
      list: finalList,
      solderMaskExpansion: ctx.solderMaskExpansion,
    }),
    list: finalList,
  };
}

/**
 * The pads and vias the current options would touch, without changing anything.
 * The dialog does not preview, but the editor uses this to report what happened.
 */
export function countGlobalTeardropTargets(
  board: Board,
  opts: GlobalTeardropEditOptions,
  ctx: GlobalTeardropEditContext,
): number {
  const removeAll = opts.action === 'removeAll';
  let n = 0;

  if (opts.vias || removeAll) {
    for (const via of board.vias) {
      if (visitItem(via, via.layers[0], via.net, opts, ctx, removeAll)) n++;
    }
  }

  for (const fp of board.footprints) {
    for (const pad of fp.pads) {
      const isPTH = pad.type === 'thru_hole';
      const isSMD = pad.type === 'smd' || pad.type === 'connect';

      if (!(removeAll || (opts.pthPads && isPTH) || (opts.smdPads && isSMD))) continue;

      const layer = pad.layers.find((l) => /\.Cu$/.test(l) || l === '*.Cu');
      if (visitItem(pad, layer, pad.net ?? 0, opts, ctx, removeAll)) n++;
    }
  }

  return n;
}

/** dialog_global_edit_teardrops_base.cpp's initial control states. */
export const DEFAULT_GLOBAL_TEARDROP_EDIT: GlobalTeardropEditOptions = {
  pthPads: true,
  smdPads: true,
  vias: true,
  trackToTrack: false,
  netFilter: null,
  netclassFilter: null,
  layerFilter: null,
  roundPadsOnly: false,
  existingOnly: false,
  selectedOnly: false,
  action: 'addDefaults',
  specified: {},
};
