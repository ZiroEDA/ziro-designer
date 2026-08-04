// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * "Edit Track & Via Properties" — set width and size across many items at once.
 * Counterparts: `DIALOG_GLOBAL_EDIT_TRACKS_AND_VIAS::visitItem` /
 * `TransferDataFromWindow` (pcbnew/dialogs/dialog_global_edit_tracks_and_vias.cpp)
 * and `PCB_EDIT_FRAME::SetTrackSegmentWidth` (pcbnew/edit_track_width.cpp).
 *
 * Structured like {@link applyGlobalTeardropEdit}: the same scope / filter /
 * action shape, and the same trick of taking the facts the typed Board model
 * does not carry as hooks on a context object rather than reaching for a board
 * settings object that lives in `designer`.
 *
 * ## What is deliberately not here
 *
 * The dialog has two further sub-actions — annular rings and IPC-4761 via
 * protection — and a second action mode, "set to net class / custom rule
 * values". None are ported, and none are approximated:
 *
 * - `PcbVia` has no padstack. There is no unconnected-layer mode and no
 *   tenting / covering / plugging / filling / capping anywhere in the model, so
 *   annular rings and protection have nothing to write to.
 * - The implicit netclass DRC rules emit the netclass track width as `min`,
 *   where upstream emits `{min: boardMinWidth, opt: netclassWidth}`, and emit no
 *   `via_diameter` or `hole_size` rule at all. Since `SetTrackSegmentWidth`
 *   tests `HasOpt()` first, "set to net class values" would today resolve to the
 *   board *minimum* — a plausible-looking number that is simply the wrong one.
 *   Shipping that would be worse than not shipping it.
 *
 * Buried vias are a related gap: `read-board` maps the file's `buried` token to
 * `'through'`, so they are edited by the "Through vias" box and a "Buried vias"
 * box would select nothing. The scope options below therefore expose no buried
 * flag rather than one that silently does nothing.
 */
import { patchChild } from './edit-board.js';
import type { SList, SNode } from '@ziroeda/sexpr/src/types.js';
import type { Board, PcbArcTrack, PcbTrack, PcbVia } from './types.js';

const atom = (value: string): SNode => ({ kind: 'atom', value });
const str = (value: string): SNode => ({ kind: 'string', value });
const list = (...items: SNode[]): SList => ({ kind: 'list', items });

/** Which items the dialog's Scope box lets through. */
export interface GlobalTrackViaEditOptions {
  /** `m_tracks`. Covers `PCB_TRACE_T` **and** `PCB_ARC_T` — arcs have no box of their own. */
  tracks: boolean;
  throughVias: boolean;
  microVias: boolean;
  blindVias: boolean;

  /**
   * `m_netFilter`. Upstream gates on `>= 0`, so an unset filter is inert —
   * but net 0 (unconnected) is a real, active value. A truthiness test here
   * would silently stop anyone filtering for unconnected copper.
   */
  netFilter?: number | null;
  /** `m_netclassFilter`. A **glob**, matched against every constituent class. */
  netclassFilter?: string | null;
  /** `m_layerFilter`. Applies to vias too, against the via's start layer. */
  layerFilter?: string | null;
  /** `m_trackWidthFilter`. Tracks and arcs only. */
  trackWidthFilter?: number | null;
  /** `m_viaSizeFilter`. Vias only. */
  viaSizeFilter?: number | null;
  /** `m_selectedItemsFilter`. Needs {@link GlobalTrackViaEditContext.isSelected}. */
  selectedOnly?: boolean;

  /** Absent means INDETERMINATE_ACTION: leave that property alone. */
  trackWidth?: number;
  viaSize?: { diameter: number; drill: number };
  /** Tracks and arcs only — a via's layers can never be changed by this dialog. */
  layer?: string;
}

/** Board facts the typed model does not carry. */
export interface GlobalTrackViaEditContext {
  /**
   * Every constituent netclass of a net, not the aggregate name.
   * `ContainsNetclassWithName` searches all of them, so a net in
   * `Default,HighSpeed` must report both or the filter misses it.
   */
  netclassOf?: (net: number) => readonly string[];
  /**
   * Whether a board item id (`track:0`, `via:3`) **or a group uuid** is
   * selected. Groups are asked by uuid so the ancestry walk can use one hook.
   */
  isSelected?: (id: string) => boolean;
  /** The netclass microvia size, which a microvia takes instead of the chosen one. */
  netclassUViaOf?: (net: number) => { diameter?: number; drill?: number };
}

/**
 * `wxString::Matches`: `*` is any run of characters, `?` is exactly one.
 *
 * The netclass filter is a pattern, not a name. Comparing for equality — which
 * is what the teardrop port next door does — makes `Default*` match nothing and
 * looks like the filter is simply broken.
 */
export function wildCompareString(pattern: string, value: string): boolean {
  const rx = pattern
    .split('')
    .map((c) => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${rx}$`).test(value);
}

/** An item passes if it, or **any ancestor group**, is selected. */
function selectionPasses(
  board: Board,
  id: string,
  uuid: string | undefined,
  ctx: GlobalTrackViaEditContext,
): boolean {
  if (ctx.isSelected?.(id) ?? false) return true;
  if (!uuid) return false;

  // Walk upward through nested groups. `groupContaining` answers a different
  // question — it returns the *top-level* group — so a selected inner group
  // would not be found by it.
  // `seen` is a termination guard, not an optimisation: a malformed file whose
  // groups reference each other in a cycle would otherwise walk for ever.
  // Mutation testing confirms it — removing it hangs the suite rather than
  // failing it, which is why the cycle test below can only be a smoke test.
  const seen = new Set<string>();
  let current = uuid;

  for (;;) {
    const parent = board.groups.find((g) => g.members.includes(current));
    if (!parent?.uuid || seen.has(parent.uuid)) return false;
    if (ctx.isSelected?.(parent.uuid) ?? false) return true;
    seen.add(parent.uuid);
    current = parent.uuid;
  }
}

/** `visitItem`'s filter gauntlet, in upstream's order. */
export function passesGlobalTrackViaFilters(
  board: Board,
  kind: 'track' | 'arc' | 'via',
  index: number,
  opts: GlobalTrackViaEditOptions,
  ctx: GlobalTrackViaEditContext,
): boolean {
  const item =
    kind === 'via' ? board.vias[index] : kind === 'arc' ? board.arcs[index] : board.tracks[index];
  if (!item) return false;

  if (opts.selectedOnly && !selectionPasses(board, `${kind}:${index}`, item.uuid, ctx))
    return false;

  if (opts.netFilter != null && opts.netFilter >= 0 && item.net !== opts.netFilter) return false;

  if (opts.netclassFilter) {
    const classes = ctx.netclassOf?.(item.net) ?? [];
    if (!classes.some((c) => wildCompareString(opts.netclassFilter!, c))) return false;
  }

  if (opts.layerFilter) {
    // A via has no single layer; upstream compares against its start layer.
    const layer = kind === 'via' ? (item as PcbVia).layers[0] : (item as PcbTrack).layer;
    if (layer !== opts.layerFilter) return false;
  }

  if (kind === 'via') {
    if (opts.viaSizeFilter != null && (item as PcbVia).size !== opts.viaSizeFilter) return false;
  } else if (opts.trackWidthFilter != null) {
    if ((item as PcbTrack | PcbArcTrack).width !== opts.trackWidthFilter) return false;
  }

  return true;
}

/** Whether this via's kind is ticked. A via whose box is off is never even filtered. */
function viaInScope(via: PcbVia, opts: GlobalTrackViaEditOptions): boolean {
  if (via.kind === 'micro') return opts.microVias;
  if (via.kind === 'blind') return opts.blindVias;
  return opts.throughVias;
}

/** Millimetres, as the writer spells them. */
const mm = (iu: number): string => {
  const v = iu / 1e6;
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6)));
};

const changedTrack = <T extends PcbTrack | PcbArcTrack>(
  t: T,
  opts: GlobalTrackViaEditOptions,
): T => {
  const width = opts.trackWidth ?? t.width;
  const layer = opts.layer ?? t.layer;
  if (width === t.width && layer === t.layer) return t;

  let source = t.source;
  if (source.items.length > 0) {
    if (width !== t.width)
      source = patchChild(source, 'width', list(atom('width'), atom(mm(width))));
    if (layer !== t.layer) source = patchChild(source, 'layer', list(atom('layer'), str(layer)));
  }
  return { ...t, width, layer, source };
};

function changedVia(
  v: PcbVia,
  opts: GlobalTrackViaEditOptions,
  ctx: GlobalTrackViaEditContext,
): PcbVia {
  // A microvia ignores the chosen size entirely and takes its netclass's
  // microvia values. Upstream tests `GetViaType() == MICROVIA` *before* the
  // generic via branch, so this is not a fallback — it wins outright.
  const chosen =
    v.kind === 'micro'
      ? {
          diameter: ctx.netclassUViaOf?.(v.net)?.diameter,
          drill: ctx.netclassUViaOf?.(v.net)?.drill,
        }
      : { diameter: opts.viaSize?.diameter, drill: opts.viaSize?.drill };

  const size = chosen.diameter ?? v.size;
  // `GetCurrentViaDrill()` returns -1 for a zero drill and the `<= 0` guard
  // then keeps the existing hole, so a preset with drill 0 resizes the pad and
  // leaves the hole alone.
  const drill = chosen.drill !== undefined && chosen.drill > 0 ? chosen.drill : v.drill;

  if (size === v.size && drill === v.drill) return v;

  let source = v.source;
  if (source.items.length > 0) {
    if (size !== v.size) source = patchChild(source, 'size', list(atom('size'), atom(mm(size))));
    if (drill !== v.drill)
      source = patchChild(source, 'drill', list(atom('drill'), atom(mm(drill))));
  }
  return { ...v, size, drill, source };
}

/**
 * `TransferDataFromWindow` + `processItem`.
 *
 * Returns the same board reference when nothing changed, so a run that matches
 * no item pushes no undo entry — the contract the other global edits keep.
 */
export function applyGlobalTrackViaEdit(
  board: Board,
  opts: GlobalTrackViaEditOptions,
  ctx: GlobalTrackViaEditContext = {},
): { board: Board; changed: number } {
  let changed = 0;

  const tracks = board.tracks.map((t, i) => {
    if (!opts.tracks || !passesGlobalTrackViaFilters(board, 'track', i, opts, ctx)) return t;
    const next = changedTrack(t, opts);
    if (next !== t) changed++;
    return next;
  });

  // Arcs ride the tracks checkbox and the track-width filter; there is no
  // separate arc scope anywhere in the dialog.
  const arcs = board.arcs.map((a, i) => {
    if (!opts.tracks || !passesGlobalTrackViaFilters(board, 'arc', i, opts, ctx)) return a;
    const next = changedTrack(a, opts);
    if (next !== a) changed++;
    return next;
  });

  const vias = board.vias.map((v, i) => {
    if (!viaInScope(v, opts)) return v;
    if (!passesGlobalTrackViaFilters(board, 'via', i, opts, ctx)) return v;
    const next = changedVia(v, opts, ctx);
    if (next !== v) changed++;
    return next;
  });

  if (changed === 0) return { board, changed: 0 };

  return { board: { ...board, tracks, arcs, vias }, changed };
}

/**
 * How many items the current scope and filters select, for the dialog to
 * report before it commits. Shares the gauntlet with the apply path so the
 * count and the effect can never disagree.
 */
export function countGlobalTrackViaTargets(
  board: Board,
  opts: GlobalTrackViaEditOptions,
  ctx: GlobalTrackViaEditContext = {},
): number {
  let n = 0;

  if (opts.tracks) {
    board.tracks.forEach((_, i) => {
      if (passesGlobalTrackViaFilters(board, 'track', i, opts, ctx)) n++;
    });
    board.arcs.forEach((_, i) => {
      if (passesGlobalTrackViaFilters(board, 'arc', i, opts, ctx)) n++;
    });
  }

  board.vias.forEach((v, i) => {
    if (viaInScope(v, opts) && passesGlobalTrackViaFilters(board, 'via', i, opts, ctx)) n++;
  });

  return n;
}
