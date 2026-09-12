// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The PCB editor's clipboard: cut, copy, copy-with-reference, paste and paste
 * special, as pure functions over the typed `Board`.
 *
 * Counterparts:
 *   - `pcbnew/kicad_clipboard.cpp` — `CLIPBOARD_IO::SaveSelection` (:119) writes
 *     the payload, `CLIPBOARD_IO::Parse` (:460) reads it back.
 *   - `pcbnew/tools/edit_tool.cpp` — `EDIT_TOOL::copyToClipboard` (:3535) picks
 *     the reference point and filters the selection; `EDIT_TOOL::cutToClipboard`
 *     (:3692) is copy followed by Remove.
 *   - `pcbnew/tools/pcb_control.cpp` — `PCB_CONTROL::Paste` (:1077) chooses the
 *     paste mode and remaps nets; `PCB_CONTROL::pruneItemLayers` (:1007) drops
 *     items whose layers this board does not have; `PCB_CONTROL::placeBoardItems`
 *     (:1970) re-stamps identifiers and hands the result to the move tool.
 *   - `common/dialogs/dialog_paste_special.cpp` and
 *     `include/dialogs/dialog_paste_special.h` — the `PASTE_MODE` enum and the
 *     "Clear net assignments" checkbox that `ACTIONS::pasteSpecial` adds over
 *     `ACTIONS::paste`.
 *
 * The clipboard payload is *text* — a `.kicad_pcb` document, or a bare
 * `(footprint …)` when exactly one footprint is copied — because that is what
 * KiCad puts on the system clipboard and the two applications have to
 * interoperate through it. Serialization goes through `PCB_IO_KICAD_SEXPR`
 * with `CTL_FOR_CLIPBOARD` and back through the board parser — the same pair
 * `SaveSelection` and `CLIPBOARD_IO::Parse` use.
 *
 * Nothing here touches the DOM, `navigator.clipboard`, React or the tool
 * manager. The caller owns the actual clipboard I/O (which is asynchronous in a
 * browser and permission-gated, unlike wxTheClipboard) and owns the interactive
 * placement that upstream runs inside `placeBoardItems`; every function here is
 * synchronous and returns a new `Board` rather than mutating one.
 *
 * ## What is not ported, and why
 *
 *  - **The footprint editor's clipboard.** `pasteFootprintItemsToFootprintEditor`
 *    (pcb_control.cpp:926) reparents a pasted footprint's children onto the
 *    footprint being edited, un-rotating and re-rotating each one across the two
 *    orientations. That is FOOTPRINT_EDIT_FRAME's clipboard, not the board's,
 *    and it belongs beside `edit-footprint.ts`.
 *  - **Pasting into a table's cells.** `PCB_EDIT_TABLE_TOOL::pasteCellsIntoSelection`
 *    (reached from pcb_control.cpp:1121 when the selection holds PCB_TABLECELL_T)
 *    and `SaveSelection`'s matching `deleteUnselectedCells`, which crops a copied
 *    table down to the selected block. Our selection ids reach a table but not
 *    its cells (`BOARD_ITEM_KINDS` has no `tablecell`), so there is no selection
 *    to crop to or paste into.
 *  - **`ACTIONS::copyAsText`** (`EDIT_TOOL::copyToClipboardAsText`,
 *    edit_tool.cpp:3594). A separate context-menu row with a separate payload —
 *    plain text, tab/newline separated for a table — not part of this one.
 *  - **The non-payload paste fallbacks.** When the clipboard does not parse,
 *    upstream pastes a bitmap as a PCB_REFERENCE_IMAGE or the raw text as a
 *    PCB_TEXT (pcb_control.cpp:1165), and warns above
 *    `ADVANCED_CFG::m_MaxPastedTextLength`. Both need the system clipboard's
 *    other flavours, which only the caller can see; {@link parseClipboardText}
 *    returning `null` is the signal to do it.
 *  - **The entered group.** `placeBoardItems` adds pasted items to
 *    `PCB_SELECTION_TOOL::GetEnteredGroup()` when the user has stepped inside a
 *    group. That is live tool state, not board state.
 *  - **`PCB_DIMENSION_BASE::UpdateUnits()`** and
 *    **`FOOTPRINT::ResolveComponentClassNames`**, both in `placeBoardItems`'s
 *    per-item pass: the first re-resolves an *automatic* dimension unit against
 *    the frame's display units, which we have no frame to ask; the second needs
 *    component classes, which our board model does not carry.
 *  - **PCB_GENERATOR** items (tuning patterns and the like) have no counterpart
 *    in our model, so their `DeepClone` branch has nothing to port to.
 */

import { kboardFromBoard } from './pcb_io/kicad_sexpr/board_view.js';
import {
  FormatClipboardBoard,
  FormatClipboardFootprint,
} from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { newKiid } from '@ziroeda/common/src/kiid.js';
import {
  boardItemId,
  parseBoardItemId,
  boardUuidIndex,
  isBoardItemLocked,
  setBoardItemsLocked,
  moveBoardItems,
  deleteBoardItems,
  type BoardItemKind,
} from './edit-board.js';
import { readBoard, readFootprintFile } from './read-board.js';
import { uniqueZoneName } from './rule_area_properties.js';
import { expandLayerWildcards } from './swap_layers.js';
import { reannotateDuplicates } from './board_reannotate.js';
import type { Board, PcbFootprint, PcbGroup, PcbPad, PcbTextItem, PcbZone } from './types.js';
import type { KFootprint } from './pcb_io/kicad_sexpr/kicad_board_items.js';
import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';

// ----- paste-special options --------------------------------------------------

/**
 * `PASTE_MODE` (include/dialogs/dialog_paste_special.h:33), the three choices in
 * the "Reference Designators" radio box of DIALOG_PASTE_SPECIAL. The dialog's
 * own labels are quoted so a caller building the dialog does not re-invent them
 * (common/dialogs/dialog_paste_special_base.cpp:22):
 *
 *   - `unique_annotations`  "Assign unique reference designators to pasted symbols"
 *   - `keep_annotations`    "Keep existing reference designators, even if they are duplicated"
 *   - `remove_annotations`  "Clear reference designators on all pasted symbols"
 */
export const PASTE_MODES = [
  'unique_annotations',
  'keep_annotations',
  'remove_annotations',
] as const;

export type PasteMode = (typeof PASTE_MODES)[number];

/**
 * `PCB_CONTROL::Paste`'s `defaultRef` (pcb_control.cpp:1210). A plain
 * `ACTIONS::paste` never uses it — `mode` starts at `KEEP_ANNOTATIONS` and only
 * DIALOG_PASTE_SPECIAL can move it — so this is the string
 * `remove_annotations` writes into every pasted footprint's Reference.
 */
export const PASTE_DEFAULT_REFERENCE = 'REF**';

export interface PasteOptions {
  /**
   * Which of DIALOG_PASTE_SPECIAL's three annotation choices to apply. Upstream
   * initialises `PASTE_MODE mode = PASTE_MODE::KEEP_ANNOTATIONS` before the
   * dialog is even shown, so a plain `ACTIONS::paste` — which never shows it —
   * is exactly this default (pcb_control.cpp:1208).
   */
  mode?: PasteMode;
  /**
   * The dialog's "Clear net assignments" checkbox. When set, every connected
   * item lands with no net at all rather than being matched into the
   * destination board's netlist:
   *
   *     for( BOARD_CONNECTED_ITEM* item : clipBoard->AllConnectedItems() )
   *         item->SetNet( NETINFO_LIST::OrphanedItem() );
   *
   * `OrphanedItem()` is a NETINFO_ITEM built with `NETINFO_LIST::UNCONNECTED`
   * (netinfo.h:255), i.e. net code 0 and an empty name — so "clear" really is
   * "unconnected", not a sentinel. The checkbox is hidden for a footprint
   * payload (`if( clipItem->Type() != PCB_T ) dlg.HideClearNets()`), which is
   * why {@link ParsedClipboard.form} is reported to the caller.
   */
  clearNets?: boolean;
  /**
   * Where the payload's origin lands, in board internal units.
   *
   * Upstream has no such parameter: `placeBoardItems` sets the selection's
   * reference point to (0,0) and then runs `PCB_ACTIONS::move` synchronously,
   * so the pasted items hang off the cursor until the user clicks. We cannot
   * block on a mouse click inside a pure function, so the caller drives that
   * interaction and tells us where the drop happened. Omitted means (0,0),
   * which is the payload exactly as copied.
   */
  offset?: Vec2;
}

// ----- the parsed payload -----------------------------------------------------

export interface ParsedClipboard {
  /**
   * `'board'` for a `(kicad_pcb …)` payload, `'footprint'` for a bare
   * `(footprint …)`. This is `clipItem->Type()`'s `PCB_T` vs
   * `PCB_FOOTPRINT_T` (pcb_control.cpp:1240), and the caller needs it for the
   * one place upstream branches on it in the UI: DIALOG_PASTE_SPECIAL hides
   * "Clear net assignments" unless the payload is a board.
   */
  form: 'board' | 'footprint';
  /**
   * The payload's contents as a board. A `'footprint'` payload becomes a
   * one-footprint board so that {@link pasteIntoBoard} has a single shape to
   * work on, the way `PCB_CONTROL::Paste` funnels both cases into
   * `placeBoardItems( …, std::vector<BOARD_ITEM*>&, … )`.
   */
  board: Board;
}

// ----- copy -------------------------------------------------------------------

/** Every board-item kind the clipboard carries, in the order the writer appends. */
const CLIPBOARD_KINDS: readonly BoardItemKind[] = [
  'footprint',
  'track',
  'arc',
  'via',
  'shape',
  'text',
  'zone',
  'textbox',
  'image',
  'table',
  'dimension',
  'point',
  'group',
];

interface KindIndices {
  footprint: Set<number>;
  track: Set<number>;
  arc: Set<number>;
  via: Set<number>;
  shape: Set<number>;
  text: Set<number>;
  zone: Set<number>;
  textbox: Set<number>;
  image: Set<number>;
  table: Set<number>;
  dimension: Set<number>;
  point: Set<number>;
  group: Set<number>;
  /** footprint index -> selected pad indices, for a bare `pad:i:j` selection. */
  pads: Map<number, Set<number>>;
  /** footprint index -> selected text indices, for a bare `fptext:i:j` selection. */
  fpTexts: Map<number, Set<number>>;
}

function indicesOf(ids: Iterable<string>): KindIndices {
  const idx: KindIndices = {
    footprint: new Set(),
    track: new Set(),
    arc: new Set(),
    via: new Set(),
    shape: new Set(),
    text: new Set(),
    zone: new Set(),
    textbox: new Set(),
    image: new Set(),
    table: new Set(),
    dimension: new Set(),
    point: new Set(),
    group: new Set(),
    pads: new Map(),
    fpTexts: new Map(),
  };
  const push = (m: Map<number, Set<number>>, k: number, v: number): void => {
    let s = m.get(k);
    if (!s) {
      s = new Set();
      m.set(k, s);
    }
    s.add(v);
  };
  for (const id of ids) {
    const r = parseBoardItemId(id);
    if (!r) continue;
    if (r.kind === 'pad') push(idx.pads, r.index, r.sub ?? 0);
    else if (r.kind === 'fptext') push(idx.fpTexts, r.index, r.sub ?? 0);
    else if (r.kind in idx) (idx[r.kind as keyof KindIndices] as Set<number>).add(r.index);
  }
  return idx;
}

/**
 * The selection plus everything under any group in it —
 * `PCB_GROUP::DeepClone` (pcbnew/pcb_group.cpp:198), which copies the group,
 * its members, and recursively any nested group *as a group*:
 *
 *     if( member->Type() == PCB_GROUP_T )
 *         newGroup->AddItem( static_cast<PCB_GROUP*>( member )->DeepClone() );
 *
 * `expandGroupIds` cannot be reused here even though it walks the same tree:
 * it is the *editing* expansion, defined to hand move/rotate/delete a set of
 * leaves, so it replaces every group — nested ones included — with its members
 * and returns no group ids at all. A clipboard that took its answer would drop
 * the nested groups and paste a flat pile of items.
 */
function withGroupContents(board: Board, requested: ReadonlySet<string>): Set<string> {
  const byUuid = boardUuidIndex(board);
  const out = new Set<string>(requested);
  const visit = (id: string, depth: number): void => {
    const r = parseBoardItemId(id);
    if (r?.kind !== 'group' || depth >= 16) return;
    const g = board.groups[r.index];
    if (!g) return;
    for (const uuid of g.members) {
      const memberId = byUuid.get(uuid);
      // An unresolvable member uuid is skipped, as the writer skips a member
      // pointer that does not resolve to a board item.
      if (!memberId || out.has(memberId)) continue;
      out.add(memberId);
      visit(memberId, depth + 1);
    }
  };
  for (const id of requested) visit(id, 0);
  return out;
}

/**
 * `SaveSelection`'s promotion of a lone pad
 * (kicad_clipboard.cpp:397): a copied PAD has no parent to live in, so upstream
 * wraps it in a brand new empty FOOTPRINT positioned at the pad:
 *
 *     FOOTPRINT* footprint = new FOOTPRINT( m_board );
 *     footprint->SetPosition( copy->GetPosition() );
 *     footprint->Add( copy );
 *
 * The wrapper is deliberately blank — it carries none of the donor footprint's
 * reference, value, courtyard or fields — so pasting a pad gives you a pad, not
 * a second copy of the part it came from.
 *
 * We anchor the wrapper at the origin instead of at the pad, because our
 * `PcbPad.at` is already board-absolute and `buildPadNode` writes it out as-is;
 * an anchor of (0,0) makes local and absolute coordinates the same number, so
 * the pad lands exactly where upstream's does.
 */
function padWrapperFootprint(pads: PcbPad[]): PcbFootprint {
  return {
    lib: '',
    at: { x: 0, y: 0 },
    angle: 0,
    layer: 'F.Cu',
    pads,
    shapes: [],
    texts: [],
    points: [],
    barcodes: [],
    models: [],
  };
}

/**
 * `SaveSelection`'s promotion of a footprint field to board text
 * (kicad_clipboard.cpp:333). A PCB_FIELD cannot exist outside a footprint, so
 * upstream copies its geometry into a PCB_TEXT and resolves the two variables a
 * field is normally displaying:
 *
 *     if ( textItem->GetText() == wxT( "${VALUE}" ) )
 *         textItem->SetText( boardItem->GetParentFootprint()->GetValue() );
 *     else if ( textItem->GetText() == wxT( "${REFERENCE}" ) )
 *         textItem->SetText( boardItem->GetParentFootprint()->GetReference() );
 *
 * Our footprint texts are already `PcbTextItem`s — the same type board text
 * uses — so the promotion is a change of `kind` plus the substitution. The
 * PCB_FIELD model behind it is dropped so the writer builds a PCB_TEXT from the
 * view; a field cannot exist at board level.
 */
function fieldToBoardText(t: PcbTextItem, fp: PcbFootprint): PcbTextItem {
  let text = t.text;
  if (text === '${VALUE}') text = fp.value ?? '';
  else if (text === '${REFERENCE}') text = fp.reference ?? '';
  return {
    ...t,
    kind: 'user',
    text,
    // Board text has no keep-upright rule; PCB_TEXT::GetDrawRotation only
    // consults it for text inside a footprint.
    keepUpright: undefined,
    k: undefined,
  };
}

/** Unlock an item that {@link setBoardItemsLocked} skips. */
function unlockOther<T extends { locked?: boolean }>(item: T): T {
  return { ...item, locked: false };
}

/**
 * `CLIPBOARD_IO::SaveSelection` (pcbnew/kicad_clipboard.cpp:119) — the text
 * KiCad would put on the system clipboard for this selection.
 *
 * Two payload shapes, exactly as upstream:
 *
 *   - **one footprint selected** → a bare `(footprint …)` document. Upstream
 *     "make[s] the footprint safe to transfer to other pcbs": every pad's net
 *     code is zeroed, the footprint is unlocked ("locked means 'locked in
 *     place'; copied items therefore can't be locked"), and it is moved so the
 *     reference point sits at the origin.
 *   - **anything else** → a `(kicad_pcb …)` document. Upstream fakes a board
 *     "to get the full parser kicking. This means we also need layers and
 *     nets", writes the layer block, then formats each cloned item after
 *     `SetLocked( false )` and `Move( -refPoint )`.
 *
 * `referencePoint` is `PCB_SELECTION::GetReferencePoint()`. `EDIT_TOOL::
 * copyToClipboard` always sets one: `PCB_ACTIONS::copyWithReference` asks the
 * user to pick it ("Select reference point for the copy…"), and a plain
 * `ACTIONS::copy` takes `grid.BestDragOrigin( cursor, items )`. Both are
 * interactive, so the caller supplies the answer; omitting it is upstream's
 * `VECTOR2I refPoint( 0, 0 )` fallback for a selection with no reference point.
 *
 * A selection containing groups carries the groups *and* their members, which
 * is what `PCB_GROUP::DeepClone` produces; the group's member list is filtered
 * down to the uuids that actually made it into the payload, standing in for
 * upstream's `copy->SetParentGroup( nullptr )` on items whose group is not
 * being copied.
 *
 * Returns `''` for an empty or wholly unresolvable selection — upstream's
 * "dont even start if the selection is empty" early return leaves the system
 * clipboard untouched, and an empty string is how the caller learns to do the
 * same.
 */
export function copySelectionToClipboardText(
  board: Board,
  selection: Iterable<string>,
  referencePoint?: Vec2,
): string {
  const requested = new Set(selection);
  if (requested.size === 0) return '';

  const ids = withGroupContents(board, requested);

  const idx = indicesOf(ids);
  const ref = referencePoint ?? { x: 0, y: 0 };
  const back: Vec2 = { x: -ref.x, y: -ref.y };

  // --- the single-footprint payload -----------------------------------------
  const onlyFootprint =
    requested.size === 1 &&
    idx.footprint.size === 1 &&
    idx.pads.size === 0 &&
    idx.fpTexts.size === 0;

  if (onlyFootprint) {
    const i = [...idx.footprint][0]!;
    const fp = board.footprints[i];
    if (!fp) return '';
    const safe: PcbFootprint = {
      ...fp,
      locked: false,
      // `pad->SetNetCode( 0 )`: `format( const PAD* )` then writes no
      // `(net …)` at all (pcb_io_kicad_sexpr.cpp:1856).
      pads: fp.pads.map((p) => ({ ...p, net: 0 })),
    };
    const oneFp: Board = {
      ...emptyClipboardBoard(board),
      footprints: [safe],
    };
    const moved = moveBoardItems(oneFp, new Set([boardItemId('footprint', 0)]), back);
    // `Format( &newFootprint )` with CTL_FOR_CLIPBOARD (kicad_clipboard.cpp:207).
    const kb = kboardFromBoard(moved);
    return FormatClipboardFootprint(kb.footprints[0]!, kb);
  }

  // --- the board payload -----------------------------------------------------
  const clip = collectSelection(board, idx);
  if (isEmptyPayload(clip)) return '';

  // "locked means 'locked in place'; copied items therefore can't be locked".
  // `setBoardItemsLocked` is the shared unlocker, but it only reaches the eight
  // kinds it was written for; text boxes, tables, images and dimensions are
  // lockable too and are cleared the same way here.
  const allIds = clipboardItemIds(clip);
  let unlocked = setBoardItemsLocked(clip, new Set(allIds), false);
  unlocked = {
    ...unlocked,
    textBoxes: unlocked.textBoxes.map(unlockOther),
    tables: unlocked.tables.map(unlockOther),
    images: unlocked.images.map(unlockOther),
    dimensions: unlocked.dimensions.map(unlockOther),
  };

  const moved = moveBoardItems(unlocked, new Set(allIds), back);
  // "we will fake being a .kicad_pcb to get the full parser kicking"
  // (kicad_clipboard.cpp:322): the header, the layers, the items.
  return FormatClipboardBoard(kboardFromBoard(moved));
}

/** A payload board with nothing in it, carrying the donor board's metadata. */
function emptyClipboardBoard(board: Board): Board {
  return {
    version: board.version,
    layers: board.layers,
    nets: new Map(board.nets),
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
    barcodes: [],
    groups: [],
  };
}

function isEmptyPayload(clip: Board): boolean {
  return (
    clip.footprints.length === 0 &&
    clip.tracks.length === 0 &&
    clip.arcs.length === 0 &&
    clip.vias.length === 0 &&
    clip.zones.length === 0 &&
    clip.shapes.length === 0 &&
    clip.texts.length === 0 &&
    clip.textBoxes.length === 0 &&
    clip.tables.length === 0 &&
    clip.images.length === 0 &&
    clip.dimensions.length === 0 &&
    clip.points.length === 0 &&
    clip.groups.length === 0
  );
}

/** Every item id of a payload board, in writer order. */
function clipboardItemIds(clip: Board): string[] {
  const counts: Record<string, number> = {
    footprint: clip.footprints.length,
    track: clip.tracks.length,
    arc: clip.arcs.length,
    via: clip.vias.length,
    shape: clip.shapes.length,
    text: clip.texts.length,
    zone: clip.zones.length,
    textbox: clip.textBoxes.length,
    image: clip.images.length,
    table: clip.tables.length,
    dimension: clip.dimensions.length,
    point: clip.points.length,
    group: clip.groups.length,
  };
  const out: string[] = [];
  for (const kind of CLIPBOARD_KINDS) {
    for (let i = 0; i < (counts[kind] ?? 0); i++) out.push(boardItemId(kind, i));
  }
  return out;
}

/**
 * Gather the selected items into a payload board.
 *
 * This is deliberately not `subsetBoardItems`: that one is the *move overlay*
 * subset (edit-board.ts:1781) and carries only the kinds the overlay draws —
 * text boxes, tables, images, dimensions and groups are dropped. A clipboard
 * that lost those would silently swallow half of what the user selected.
 */
function collectSelection(board: Board, idx: KindIndices): Board {
  const keep = <T>(arr: readonly T[], sel: Set<number>): T[] => arr.filter((_, i) => sel.has(i));

  const footprints: PcbFootprint[] = keep(board.footprints, idx.footprint);
  const texts: PcbTextItem[] = keep(board.texts, idx.text);

  // Pads and footprint texts selected on their own are promoted, exactly as
  // `SaveSelection` promotes PCB_PAD_T and PCB_FIELD_T, but only when their
  // parent footprint is not itself in the selection (in which case they are
  // already travelling with it).
  const wrappedPads: PcbPad[] = [];
  for (const [fpIndex, padIndices] of idx.pads) {
    if (idx.footprint.has(fpIndex)) continue;
    const fp = board.footprints[fpIndex];
    if (!fp) continue;
    for (const j of [...padIndices].sort((a, b) => a - b)) {
      const p = fp.pads[j];
      if (p) wrappedPads.push(p);
    }
  }
  if (wrappedPads.length > 0) footprints.push(padWrapperFootprint(wrappedPads));

  for (const [fpIndex, textIndices] of idx.fpTexts) {
    if (idx.footprint.has(fpIndex)) continue;
    const fp = board.footprints[fpIndex];
    if (!fp) continue;
    for (const j of [...textIndices].sort((a, b) => a - b)) {
      const t = fp.texts[j];
      if (t) texts.push(fieldToBoardText(t, fp));
    }
  }

  const clip: Board = {
    ...emptyClipboardBoard(board),
    footprints,
    tracks: keep(board.tracks, idx.track),
    arcs: keep(board.arcs, idx.arc),
    vias: keep(board.vias, idx.via),
    zones: keep(board.zones, idx.zone),
    shapes: keep(board.shapes, idx.shape),
    texts,
    textBoxes: keep(board.textBoxes, idx.textbox),
    tables: keep(board.tables, idx.table),
    images: keep(board.images, idx.image),
    dimensions: keep(board.dimensions, idx.dimension),
    points: keep(board.points, idx.point),
    groups: keep(board.groups, idx.group),
  };

  // A group may only claim members that came with it.
  const present = new Set<string>();
  const note = (u: string | undefined): void => {
    if (u) present.add(u);
  };
  for (const f of clip.footprints) note(f.uuid);
  for (const t of clip.tracks) note(t.uuid);
  for (const a of clip.arcs) note(a.uuid);
  for (const v of clip.vias) note(v.uuid);
  for (const z of clip.zones) note(z.uuid);
  for (const s of clip.shapes) note(s.uuid);
  for (const t of clip.texts) note(t.uuid);
  for (const t of clip.textBoxes) note(t.uuid);
  for (const t of clip.tables) note(t.uuid);
  for (const i of clip.images) note(i.uuid);
  for (const d of clip.dimensions) note(d.uuid);
  for (const p of clip.points) note(p.uuid);
  for (const g of clip.groups) note(g.uuid);

  clip.groups = clip.groups.map((g) =>
    withMembers(
      g,
      g.members.filter((m) => present.has(m)),
    ),
  );
  return clip;
}

/** A group with its member list replaced. */
function withMembers(g: PcbGroup, members: string[]): PcbGroup {
  return { ...g, members };
}

// ----- cut --------------------------------------------------------------------

export interface CutResult {
  /** The clipboard payload, or `''` when nothing was cuttable. */
  text: string;
  /** The board with the cut items removed (unchanged when `text` is `''`). */
  board: Board;
  /** The ids actually cut — the selection minus anything locked. */
  cut: Set<string>;
  /**
   * True when the selection held locked items that were left alone.
   * `PCB_SELECTION_TOOL::ReportFilteredLockedItems` puts an infobar up for
   * this; the caller owns that message.
   */
  lockedItemsFiltered: boolean;
}

/**
 * `EDIT_TOOL::cutToClipboard` (pcbnew/tools/edit_tool.cpp:3692). Cut is copy
 * followed by delete — but not of the same set, which is the detail worth
 * getting right:
 *
 *     // N.B. Setting the CUT flag prevents lock filtering as we only want to
 *     // delete the items that were copied to the clipboard, no more, no fewer.
 *     // Filtering for locked item, if any will be done in the copyToClipboard()
 *     // routine
 *
 * `copyToClipboard` applies `FilterCollectorForLockedItems` **only** when the
 * event is `ACTIONS::cut` (edit_tool.cpp:3549), so a locked item is neither
 * copied nor deleted by a cut, while a plain copy takes it happily. The removal
 * then runs over exactly what was copied.
 *
 * `overrideLocks` is `PCB_BASE_FRAME::GetOverrideLocks()`, the "Locked items"
 * override the selection tool consults before filtering; with it set the filter
 * does not run and locked items are cut like any other.
 */
export function cutSelectionToClipboardText(
  board: Board,
  selection: Iterable<string>,
  referencePoint?: Vec2,
  opts: { overrideLocks?: boolean } = {},
): CutResult {
  const requested = new Set(selection);
  const cut = new Set<string>();
  let lockedItemsFiltered = false;

  for (const id of requested) {
    if (!opts.overrideLocks && isCutBlockedByLock(board, id)) {
      lockedItemsFiltered = true;
      continue;
    }
    cut.add(id);
  }

  const text = copySelectionToClipboardText(board, cut, referencePoint);
  if (text === '') return { text: '', board, cut: new Set(), lockedItemsFiltered };

  return {
    text,
    board: deleteBoardItems(board, cut),
    cut,
    lockedItemsFiltered,
  };
}

/**
 * `item->IsLocked() || HasLockedDescendant( item )`
 * (pcb_selection_tool.cpp, FilterCollectorForLockedItems). Only a group has
 * descendants that can be locked independently of it here, so that is the one
 * case the recursion covers.
 */
function isCutBlockedByLock(board: Board, id: string): boolean {
  if (isBoardItemLocked(board, id)) return true;
  const r = parseBoardItemId(id);
  if (r?.kind !== 'group') return false;
  for (const member of withGroupContents(board, new Set([id]))) {
    if (member !== id && isBoardItemLocked(board, member)) return true;
  }
  return false;
}

// ----- parse ------------------------------------------------------------------

/**
 * `CLIPBOARD_IO::Parse` (pcbnew/kicad_clipboard.cpp:460), which is
 * `PCB_IO_KICAD_SEXPR::Parse` wrapped in a `catch (...)` that turns any failure
 * into a null item:
 *
 *     try { item = PCB_IO_KICAD_SEXPR::Parse( result ); }
 *     catch (...) { item = nullptr; }
 *
 * so this returns `null` for anything that is not a board or a footprint
 * document, and never throws. Upstream's caller treats null as "the clipboard
 * holds something else" and falls back to pasting an image or a text object
 * (pcb_control.cpp:1165) — a fallback that belongs to the caller here, since it
 * needs the system clipboard's non-text flavours.
 *
 * Both payload shapes KiCad writes are accepted.
 */
export function parseClipboardText(text: string): ParsedClipboard | null {
  if (text.trim() === '') return null;

  // `PCB_IO_KICAD_SEXPR_PARSER::Parse` dispatches on the first token.
  const kind = /^\s*\(\s*([A-Za-z_]+)/.exec(text)?.[1];
  try {
    if (kind === 'kicad_pcb') return { form: 'board', board: readBoard(text) };
    if (kind === 'footprint' || kind === 'module') {
      const fp = readFootprintFile(text);
      if (!fp) return null;
      const board: Board = {
        version: 0,
        layers: [],
        nets: new Map(),
        footprints: [fp],
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
        barcodes: [],
        groups: [],
      };
      return { form: 'footprint', board };
    }
  } catch {
    return null;
  }
  return null;
}

// ----- paste ------------------------------------------------------------------

export interface PasteResult {
  /** The destination board with the payload merged in. */
  board: Board;
  /** Ids of the pasted items in the returned board, ready to become the selection. */
  newIds: string[];
  /**
   * How many payload items `pruneItemLayers` dropped. Upstream raises
   * "Warning: some pasted items were on layers which are not present in the
   * current board." when this is non-zero (pcb_control.cpp:1060); the caller
   * owns the dialog.
   */
  prunedCount: number;
}

/**
 * `PCB_CONTROL::Paste` (pcbnew/tools/pcb_control.cpp:1077) for the board
 * editor, plus the parts of `PCB_CONTROL::placeBoardItems` (:1970) that are not
 * interactive.
 *
 * In upstream's order:
 *
 *  1. **Nets.** `clear_nets` (the paste-special checkbox) orphans every
 *     connected item; otherwise `clipBoard->MapNets( m_frame->GetBoard() )`
 *     (board.cpp:3293) looks each item's *net name* up in the destination and
 *     creates the net there when it is missing. A footprint payload skips this
 *     entirely — its pad nets were already zeroed at copy time.
 *  2. **Annotations.** `remove_annotations` sets every pasted footprint's
 *     reference to {@link PASTE_DEFAULT_REFERENCE}.
 *  3. **Layer pruning.** `pruneItemLayers` drops any item whose layers this
 *     board does not have; footprints and groups are exempt ("Items living in a
 *     parent footprint are never removed… a fp lives in a fp library, that does
 *     not know the enabled layers of a given board").
 *  4. **Fresh identity.** Every item and every child gets a new KIID; a pasted
 *     footprint's `(path …)` is cleared (`footprint->SetPath( KIID_PATH() )`)
 *     because the copy is not the schematic symbol's footprint; a pasted zone
 *     with a name takes a unique one (`GetUniqueZoneName`, "A pasted zone must
 *     not reuse a name already on the board (issue 23131)").
 *  5. **Unique annotations.** `unique_annotations` runs
 *     `ReannotateDuplicatesInSelection` over the pasted footprints.
 *  6. **Placement.** Upstream anchors the selection at (0,0) and hands it to
 *     the move tool; here `opts.offset` says where it landed.
 *
 * Not ported: `PCB_DIMENSION_BASE::UpdateUnits()` (step 4 in upstream) — it
 * re-resolves a dimension's *automatic* unit against the frame's current
 * display units, and our dimension model carries the file's unit token with no
 * frame to consult. `fp->ResolveComponentClassNames` is likewise skipped: we do
 * not model component classes. Both leave the pasted item exactly as copied.
 */
export function pasteIntoBoard(
  board: Board,
  parsed: ParsedClipboard,
  opts: PasteOptions = {},
): PasteResult {
  const mode: PasteMode = opts.mode ?? 'keep_annotations';
  const offset = opts.offset ?? { x: 0, y: 0 };

  // 1. nets ------------------------------------------------------------------
  let dest = board;
  let clip = parsed.board;

  if (parsed.form === 'board') {
    if (opts.clearNets) {
      clip = clearPayloadNets(clip);
    } else {
      const mapped = mapPayloadNets(dest, clip);
      dest = mapped.board;
      clip = mapped.clip;
    }
  }

  // 2. annotations -----------------------------------------------------------
  if (mode === 'remove_annotations') {
    clip = {
      ...clip,
      footprints: clip.footprints.map((f) => withReference(f, PASTE_DEFAULT_REFERENCE)),
    };
  }

  // 3. layer pruning ---------------------------------------------------------
  const pruned = pruneItemLayers(dest, clip);
  clip = pruned.clip;

  // 4. fresh identity --------------------------------------------------------
  clip = restamp(dest, clip);

  // 6. placement (before the merge, so only the payload moves) ---------------
  if (offset.x !== 0 || offset.y !== 0) {
    clip = moveBoardItems(clip, new Set(clipboardItemIds(clip)), offset);
  }

  const merged = appendPayload(dest, clip);

  // 5. unique annotations ----------------------------------------------------
  let out = merged.board;
  if (mode === 'unique_annotations') {
    const pastedUuids = new Set<string>();
    for (const f of clip.footprints) if (f.uuid) pastedUuids.add(f.uuid);
    out = reannotateDuplicates(out, pastedUuids);
  }

  return { board: out, newIds: merged.newIds, prunedCount: pruned.prunedCount };
}

/** `FOOTPRINT::SetReference`: the Reference field's text. */
function withReference(fp: PcbFootprint, reference: string): PcbFootprint {
  return {
    ...fp,
    reference,
    texts: fp.texts.map((t) => (t.kind === 'reference' ? { ...t, text: reference } : t)),
  };
}

/**
 * `item->SetNet( NETINFO_LIST::OrphanedItem() )` over every connected item.
 * The orphan net is code 0 with an empty name (netinfo.h:255).
 */
function clearPayloadNets(clip: Board): Board {
  const zero = <T extends { net: number }>(item: T): T => ({ ...item, net: 0 });
  return {
    ...clip,
    nets: new Map([[0, '']]),
    tracks: clip.tracks.map(zero),
    arcs: clip.arcs.map(zero),
    vias: clip.vias.map(zero),
    zones: clip.zones.map((z) => ({ ...zero(z), netName: '' })),
    footprints: clip.footprints.map((f) => ({
      ...f,
      pads: f.pads.map((p) => ({ ...p, net: 0 })),
    })),
  };
}

/**
 * `BOARD::MapNets( BOARD* aDestBoard )` (pcbnew/board.cpp:3293):
 *
 *     NETINFO_ITEM* netInfo = aDestBoard->FindNet( item->GetNetname() );
 *     if( netInfo ) item->SetNet( netInfo );
 *     else { newNet = new NETINFO_ITEM( aDestBoard, item->GetNetname() );
 *            aDestBoard->Add( newNet ); item->SetNet( newNet ); }
 *
 * The match is by **name**, never by code. A name the destination does not
 * have becomes a new net there — so this returns the destination board too.
 */
function mapPayloadNets(dest: Board, clip: Board): { board: Board; clip: Board } {
  const byName = new Map<string, number>();
  for (const [code, name] of dest.nets) if (!byName.has(name)) byName.set(name, code);

  let nextCode = 0;
  for (const code of dest.nets.keys()) nextCode = Math.max(nextCode, code);

  const added: { code: number; name: string }[] = [];
  const remap = new Map<number, number>([[0, 0]]);

  const codeFor = (clipCode: number): number => {
    const known = remap.get(clipCode);
    if (known !== undefined) return known;
    const name = clip.nets.get(clipCode) ?? '';
    if (name === '') {
      remap.set(clipCode, 0);
      return 0;
    }
    const existing = byName.get(name);
    if (existing !== undefined) {
      remap.set(clipCode, existing);
      return existing;
    }
    nextCode += 1;
    byName.set(name, nextCode);
    added.push({ code: nextCode, name });
    remap.set(clipCode, nextCode);
    return nextCode;
  };

  const map = <T extends { net: number }>(item: T): T => {
    const code = codeFor(item.net);
    return code === item.net ? item : { ...item, net: code };
  };

  const nextClip: Board = {
    ...clip,
    tracks: clip.tracks.map(map),
    arcs: clip.arcs.map(map),
    vias: clip.vias.map(map),
    zones: clip.zones.map(map),
    footprints: clip.footprints.map((f) => ({
      ...f,
      pads: f.pads.map((p) => {
        if (p.net === undefined) return p;
        const code = codeFor(p.net);
        return code === p.net ? p : { ...p, net: code };
      }),
    })),
  };

  if (added.length === 0) return { board: dest, clip: nextClip };

  const nets = new Map(dest.nets);
  for (const n of added) nets.set(n.code, n.name);
  return { board: { ...dest, nets }, clip: nextClip };
}

/**
 * `PCB_CONTROL::pruneItemLayers` (pcbnew/tools/pcb_control.cpp:1007). An item
 * whose layers the destination board does not have cannot be pasted:
 *
 *     LSET allowed = item->GetLayerSet() & enabledLayers;
 *     if( allowed.any() && item_valid ) { item->SetLayerSet( allowed ); … }
 *
 * Footprints, groups and generators are exempt by name upstream. Vias get the
 * extra `HasValidLayerPair` test — "Ensure, for vias, the top and bottom layers
 * are compatible with the current board copper layers. Otherwise they must be
 * skipped, even is one layer is valid" — which for a name-keyed layer model is
 * simply "both of its layers are enabled".
 *
 * A destination board with no layer block at all (a fixture, or a payload
 * pasted before any board was loaded) prunes nothing: an empty enabled set
 * would reject every item, which is never what an absent block means.
 *
 * `item->SetLayerSet( allowed )` *trims* a multi-layer item to the enabled
 * subset, so a zone on F.Cu and In1.Cu pasted into a two-layer board arrives
 * on F.Cu alone.
 */
function pruneItemLayers(dest: Board, clip: Board): { clip: Board; prunedCount: number } {
  if (dest.layers.length === 0) return { clip, prunedCount: 0 };
  const enabled = new Set(dest.layers.map((l) => l.name));

  let pruned = 0;
  const keepOne = <T extends { layer: string }>(item: T): boolean => {
    const ok = enabled.has(item.layer);
    if (!ok) pruned++;
    return ok;
  };
  // `LSET allowed = item->GetLayerSet() & enabledLayers; … item->SetLayerSet( allowed )`.
  const trimMulti = (zones: PcbZone[]): PcbZone[] => {
    const out: PcbZone[] = [];
    for (const z of zones) {
      const allowed = expandLayerWildcards(z.layers, dest).filter((l) => enabled.has(l));
      if (allowed.length === 0) {
        pruned++;
        continue;
      }
      out.push(allowed.length === z.layers.length ? z : { ...z, layers: allowed });
    }
    return out;
  };
  const keepVia = (v: { layers: readonly [string, string] }): boolean => {
    const ok = enabled.has(v.layers[0]) && enabled.has(v.layers[1]);
    if (!ok) pruned++;
    return ok;
  };

  const next: Board = {
    ...clip,
    tracks: clip.tracks.filter(keepOne),
    arcs: clip.arcs.filter(keepOne),
    vias: clip.vias.filter(keepVia),
    zones: trimMulti(clip.zones),
    shapes: clip.shapes.filter(keepOne),
    texts: clip.texts.filter(keepOne),
    textBoxes: clip.textBoxes.filter(keepOne),
    tables: clip.tables.filter(keepOne),
    images: clip.images.filter(keepOne),
    dimensions: clip.dimensions.filter(keepOne),
    points: clip.points.filter(keepOne),
  };

  // "make sure it's not still included in its parent group" — a pruned item
  // must not stay in a pasted group's member list.
  const survivors = new Set<string>();
  const note = (u: string | undefined): void => {
    if (u) survivors.add(u);
  };
  for (const f of next.footprints) note(f.uuid);
  for (const t of next.tracks) note(t.uuid);
  for (const a of next.arcs) note(a.uuid);
  for (const v of next.vias) note(v.uuid);
  for (const z of next.zones) note(z.uuid);
  for (const s of next.shapes) note(s.uuid);
  for (const t of next.texts) note(t.uuid);
  for (const t of next.textBoxes) note(t.uuid);
  for (const t of next.tables) note(t.uuid);
  for (const i of next.images) note(i.uuid);
  for (const d of next.dimensions) note(d.uuid);
  for (const p of next.points) note(p.uuid);
  for (const g of next.groups) note(g.uuid);
  next.groups = next.groups.map((g) =>
    withMembers(
      g,
      g.members.filter((m) => survivors.has(m)),
    ),
  );

  return { clip: next, prunedCount: pruned };
}

/**
 * `placeBoardItems`' new-item pass (pcb_control.cpp:1983-2013):
 *
 *     const_cast<KIID&>( item->m_Uuid ) = KIID();
 *     item->RunOnChildren( []( BOARD_ITEM* aChild )
 *                          { const_cast<KIID&>( aChild->m_Uuid ) = KIID(); },
 *                          RECURSE_MODE::RECURSE );
 *     …
 *     if( aIsNew ) footprint->SetPath( KIID_PATH() );
 *     …
 *     if( !zone->GetZoneName().IsEmpty() )
 *         zone->SetZoneName( board()->GetUniqueZoneName( zone->GetZoneName() ) );
 *
 * Group membership is by uuid in our model, so re-stamping has to carry the
 * member lists with it: an unremapped group would point at the *originals* and
 * silently swallow them into the pasted group.
 *
 * A footprint's children that the view does not list (its fields, its own
 * zones and groups, a table's cells) are re-stamped on the payload's model
 * directly; the payload is what `CLIPBOARD_IO::Parse` produced for this paste
 * and nothing else holds it.
 */
function restamp(dest: Board, clip: Board): Board {
  const remap = new Map<string, string>();
  const fresh = (old: string | undefined): string => {
    const uuid = newKiid();
    if (old) remap.set(old, uuid);
    return uuid;
  };
  const stamp = <T extends { uuid?: string }>(item: T): T => ({ ...item, uuid: fresh(item.uuid) });

  const footprints = clip.footprints.map((f) => {
    const next = stamp(f);
    if (next.k) restampFootprintChildren(next.k, remap);
    // The view's children take the uuids their models were just given.
    const child = <T extends { uuid?: string; k?: { uuid: string } }>(c: T): T => ({
      ...c,
      uuid: c.k?.uuid ?? fresh(c.uuid),
    });
    return {
      ...next,
      // A pasted footprint is not the schematic symbol's footprint any more.
      path: undefined,
      pads: next.pads.map(child),
      texts: next.texts.map(child),
      shapes: next.shapes.map(child),
      points: next.points.map(child),
      barcodes: next.barcodes.map(child),
    };
  });

  // Zone names must be unique against the destination *and* against the zones
  // already renamed in this same paste, so the board grows as we go.
  let zoneScope = dest;
  const zones: PcbZone[] = clip.zones.map((z) => {
    const next = stamp(z);
    if (!next.name) return next;
    const name = uniqueZoneName(zoneScope, next.name);
    const renamed: PcbZone = name === next.name ? next : { ...next, name };
    zoneScope = { ...zoneScope, zones: [...zoneScope.zones, renamed] };
    return renamed;
  });

  const tables = clip.tables.map((t) => {
    const next = stamp(t);
    for (const cell of next.k?.cells ?? []) cell.uuid = fresh(cell.uuid);
    return next;
  });

  const next: Board = {
    ...clip,
    footprints,
    zones,
    tables,
    tracks: clip.tracks.map(stamp),
    arcs: clip.arcs.map(stamp),
    vias: clip.vias.map(stamp),
    shapes: clip.shapes.map(stamp),
    texts: clip.texts.map(stamp),
    textBoxes: clip.textBoxes.map(stamp),
    images: clip.images.map(stamp),
    dimensions: clip.dimensions.map(stamp),
    points: clip.points.map(stamp),
    groups: clip.groups.map(stamp),
  };

  next.groups = next.groups.map((g) =>
    withMembers(
      g,
      g.members.map((m) => remap.get(m)).filter((m): m is string => m !== undefined),
    ),
  );
  return next;
}

/** `RunOnChildren( …, RECURSE_MODE::RECURSE )` over a FOOTPRINT's model. */
function restampFootprintChildren(k: KFootprint, remap: Map<string, string>): void {
  const fresh = (item: { uuid: string }): void => {
    const uuid = newKiid();
    remap.set(item.uuid, uuid);
    item.uuid = uuid;
  };
  for (const f of k.fields) fresh(f);
  for (const g of k.graphicalItems) {
    fresh(g.item);
    if (g.kind === 'table') for (const cell of g.item.cells) fresh(cell);
    if (g.kind === 'dimension') g.item.text.uuid = g.item.uuid;
  }
  for (const p of k.points) fresh(p);
  for (const p of k.pads) fresh(p);
  for (const z of k.zones) fresh(z);
  for (const g of k.groups) fresh(g);
  for (const g of k.groups)
    g.memberUuids = g.memberUuids.map((m) => remap.get(m)).filter((m): m is string => !!m);
  k.groupMembers = undefined;
}

/** Append every payload item to the destination board, reporting the new ids. */
function appendPayload(dest: Board, clip: Board): { board: Board; newIds: string[] } {
  const newIds: string[] = [];
  const at = (kind: BoardItemKind, base: number, n: number): void => {
    for (let i = 0; i < n; i++) newIds.push(boardItemId(kind, base + i));
  };
  at('footprint', dest.footprints.length, clip.footprints.length);
  at('track', dest.tracks.length, clip.tracks.length);
  at('arc', dest.arcs.length, clip.arcs.length);
  at('via', dest.vias.length, clip.vias.length);
  at('shape', dest.shapes.length, clip.shapes.length);
  at('text', dest.texts.length, clip.texts.length);
  at('zone', dest.zones.length, clip.zones.length);
  at('textbox', dest.textBoxes.length, clip.textBoxes.length);
  at('image', dest.images.length, clip.images.length);
  at('table', dest.tables.length, clip.tables.length);
  at('dimension', dest.dimensions.length, clip.dimensions.length);
  at('point', dest.points.length, clip.points.length);
  at('group', dest.groups.length, clip.groups.length);

  return {
    board: {
      ...dest,
      footprints: [...dest.footprints, ...clip.footprints],
      tracks: [...dest.tracks, ...clip.tracks],
      arcs: [...dest.arcs, ...clip.arcs],
      vias: [...dest.vias, ...clip.vias],
      zones: [...dest.zones, ...clip.zones],
      shapes: [...dest.shapes, ...clip.shapes],
      texts: [...dest.texts, ...clip.texts],
      textBoxes: [...dest.textBoxes, ...clip.textBoxes],
      tables: [...dest.tables, ...clip.tables],
      images: [...dest.images, ...clip.images],
      dimensions: [...dest.dimensions, ...clip.dimensions],
      points: [...dest.points, ...clip.points],
      groups: [...dest.groups, ...clip.groups],
    },
    newIds,
  };
}
