// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Sync Sheet Pins. Counterpart: `eeschema/sync_sheet_pin/` —
 * `PANEL_SYNC_SHEET_PINS::UpdateForms` for the three lists and
 * `GenericSync` for the two "use this as the template" directions.
 *
 * A sheet symbol's pins and the hierarchical labels inside the sheet are two
 * halves of the same connection, kept in step by hand. This sorts them into
 * three lists — labels with no pin, pins with no label, and the pairs that
 * already agree — so the mismatches are the only thing on screen.
 *
 * **A pair matches on text *and* shape.** That is the rule the whole panel
 * turns on: a label named `CLK` shaped `input` and a pin named `CLK` shaped
 * `output` are *not* associated, they are two unmatched items, and the two
 * template buttons exist precisely to settle which one is right. Matching on
 * the name alone would hide the disagreement that matters.
 *
 * Two more rules from `UpdateForms`, both easy to miss:
 *
 *  - **labels are de-duplicated by text, first one wins.** A net can be labelled
 *    in several places inside a sheet; that is one connection, and listing it
 *    three times would invite three pins;
 *  - **a pin is consumed by the first label that matches it**, so two identical
 *    labels cannot both claim the same pin.
 *
 * The panel has six buttons, not two. Besides the rename pair there are two
 * that create the missing item and two that delete it, and leaving those out
 * made the dialog useless in the ordinary case: a sheet whose labels have no
 * pins yet has nothing in the pins list, so nothing can be selected there, so
 * both rename buttons stay disabled and no button on the panel does anything.
 * They are all here now — see "the four buttons that change what exists" below.
 */

import type { LabelShape, SchLabel, Schematic, SchSheet, SheetPin } from '../types.js';
import { strNumCmp } from '@ziroeda/common/src/string_utils.js';
import { refId, sheetPinId } from './hittest.js';
import type { EditCommand } from './command.js';
import { replaceSheetPin, type SheetPinRef } from './sch_sheet_pin_tool.js';

/** The default shape when a label or pin declares none, as the readers use. */
const DEFAULT_SHAPE: LabelShape = 'input';

export interface SyncLabel {
  /** The label's id **within the sub-sheet document**. */
  id: string;
  text: string;
  shape: LabelShape;
}

export interface SyncPin {
  /** The pin's id within the *parent* document (`<sheetRefId>:sheetpin<k>`). */
  id: string;
  index: number;
  text: string;
  shape: LabelShape;
}

export interface SyncBuckets {
  /** Hierarchical labels in the sheet with no matching pin on it. */
  labels: SyncLabel[];
  /** Pins on the sheet with no matching label inside it. */
  pins: SyncPin[];
  /** Pairs that already agree on both name and shape. */
  associated: { label: SyncLabel; pin: SyncPin }[];
}

/**
 * Sort the sheet's pins and the sub-sheet's hierarchical labels into the three
 * lists the panel shows.
 *
 * `sheetIndex` is the sheet's position in the parent document, which is what
 * its pin ids are built from.
 */
export function syncSheetPinBuckets(
  sheet: SchSheet,
  sheetIndex: number,
  sub: Schematic,
): SyncBuckets {
  const sheetRef = refId('sheet', sheet.uuid, sheetIndex);

  // De-duplicate by text, first occurrence wins: one net labelled three times
  // inside a sheet is still one connection.
  const seen = new Set<string>();
  const labels: SyncLabel[] = [];
  sub.labels.forEach((l: SchLabel, i) => {
    if (l.kind !== 'hierarchical_label' || seen.has(l.text)) return;
    seen.add(l.text);
    labels.push({ id: refId('label', l.uuid, i), text: l.text, shape: l.shape ?? DEFAULT_SHAPE });
  });
  labels.sort((a, b) => strNumCmp(a.text, b.text, true));

  const pins: SyncPin[] = sheet.pins.map((p: SheetPin, k) => ({
    id: sheetPinId(sheetRef, k),
    index: k,
    text: p.name,
    shape: p.shape ?? DEFAULT_SHAPE,
  }));

  const unmatchedPins = [...pins];
  const out: SyncBuckets = { labels: [], pins: [], associated: [] };

  for (const label of labels) {
    // Name *and* shape. A name-only match would quietly pair a label and a pin
    // that disagree about direction, which is the disagreement the panel is for.
    const at = unmatchedPins.findIndex((p) => p.text === label.text && p.shape === label.shape);
    if (at >= 0) {
      out.associated.push({ label, pin: unmatchedPins[at]! });
      unmatchedPins.splice(at, 1); // one pin cannot serve two labels
    } else {
      out.labels.push(label);
    }
  }
  out.pins = unmatchedPins;
  return out;
}

/** Whether anything is still unmatched (`HasUndefinedSheetPing`). */
export const hasUnmatched = (b: SyncBuckets): boolean => b.labels.length > 0 || b.pins.length > 0;

/**
 * "Use label as template": the **pin** takes the label's name and shape, in the
 * *parent* document. Returns null when the pin is not where it was said to be.
 */
export function syncPinFromLabel(
  parent: Schematic,
  ref: SheetPinRef,
  label: SyncLabel,
): EditCommand | null {
  const sheet = parent.sheets[ref.sheet];
  const pin = sheet?.pins[ref.pin];
  if (!pin) return null;
  return replaceSheetPin(ref, { ...pin, name: label.text, shape: label.shape });
}

/**
 * "Use pin as template": the **label** takes the pin's name and shape, in the
 * *sub-sheet* document.
 *
 * Every label with that text is updated, not just the first. The panel lists
 * one row per distinct text, so the row stands for all of them — renaming one
 * and leaving its twins behind would split a net that used to be whole.
 */
function setLabels(labels: readonly SchLabel[]): EditCommand {
  return {
    label: 'Sync Sheet Pins',
    apply: (doc) => ({ ...doc, labels }),
    invert: (before) => setLabels(before.labels),
  };
}

export function syncLabelsFromPin(label: SyncLabel, pin: SyncPin): EditCommand {
  const from = label.text;
  return {
    label: 'Sync Sheet Pins',
    apply(doc: Schematic): Schematic {
      return {
        ...doc,
        labels: doc.labels.map((l) =>
          l.kind === 'hierarchical_label' && l.text === from
            ? { ...l, text: pin.text, shape: pin.shape }
            : l,
        ),
      };
    },
    // The whole array, snapshotted: the inverse of "rename every label with
    // this text" is "put them all back", and that is one line rather than an
    // attempt to reverse the mapping.
    invert: (before: Schematic) => setLabels(before.labels),
  };
}

// ----- the four buttons that change what exists -------------------------------
//
// The panel's other buttons do not rename anything: two of them create the
// missing item, two delete it. Ours had only the rename pair, which meant that
// on the ordinary case — a sheet whose labels have no pins yet — every button
// was disabled and the dialog could do nothing at all.

/**
 * One item queued for interactive placement: upstream's *placement template*
 * (`DIALOG_SYNC_SHEET_PINS::PreparePlacementTemplate`).
 *
 * "Add" does not drop the new item somewhere chosen for you. The panel hides,
 * the matching placement tool runs, and each click places one of these:
 *
 *     m_dialogSyncSheetPin->Hide();
 *     m_dialogSyncSheetPin->PreparePlacementTemplate( sheet, kind, aTemplates );
 *     m_toolMgr->RunAction( SCH_ACTIONS::placeSheetPin );
 *
 * and the panel comes back when the queue runs out (`CanPlaceMore`).
 */
export interface SyncTemplate {
  text: string;
  shape: LabelShape;
}

/**
 * A placement in progress.
 *
 * `file` is the document the new items land in, and the two directions differ:
 * a sheet pin belongs to the sheet symbol in the **parent**, a hierarchical
 * label to the sheet's **own** document. Upstream makes the same distinction by
 * popping the sheet path for one and not the other:
 *
 *     void …::PlaceSheetPin( … ) { SCH_SHEET_PATH cp = aPath; cp.pop_back(); … }
 *     void …::PlaceHieraLable( … ) { m_doPlaceItem( aSheet, aPath, … ); }
 */
export interface SyncPlacement {
  kind: 'sheetPin' | 'hierLabel';
  /** The sheet symbol's index in the parent document. */
  sheetIndex: number;
  /** The file being written, per the rule above. */
  file: string;
  /** Still to place, in list order. The head is the one on the cursor. */
  queue: readonly SyncTemplate[];
}

/**
 * The placement for a set of selected rows, or null if nothing was selected —
 * `if( selected_items_set.empty() ) return;`, the guard both add buttons open
 * with.
 */
export function syncPlacementFor(
  kind: SyncPlacement['kind'],
  sheetIndex: number,
  file: string,
  items: readonly SyncTemplate[],
): SyncPlacement | null {
  if (items.length === 0) return null;
  return { kind, sheetIndex, file, queue: items.map((t) => ({ ...t })) };
}

/**
 * One item placed. Null means the queue is empty, i.e. `!CanPlaceMore()`, which
 * is what ends the tool and brings the dialog back:
 *
 *     m_placementTemplateSet.erase( m_currentTemplate );
 *     if( m_placementTemplateSet.empty() ) EndPlacement();
 *     else m_currentTemplate = *m_placementTemplateSet.begin();
 *
 * (Upstream additionally copies back any name or shape the user changed in the
 * placement dialog, so the template and the placed item agree. Ours places the
 * template as-is, with no dialog in between, so there is nothing to copy.)
 */
export function advanceSyncPlacement(p: SyncPlacement): SyncPlacement | null {
  const queue = p.queue.slice(1);
  return queue.length ? { ...p, queue } : null;
}

/**
 * `OnBtnUndoClicked`: put matched pairs back into the two unmatched lists.
 *
 * It edits nothing — the pin and the label still agree — it just stops the
 * panel treating them as settled, so they can be re-targeted at something else.
 * Upstream can move rows because its three lists are a mutable model; ours are
 * derived from the document on every render, so the pairs the user pulled apart
 * are carried alongside as a set of label ids and re-split here.
 */
export function splitAssociated(b: SyncBuckets, unassociated: ReadonlySet<string>): SyncBuckets {
  if (unassociated.size === 0) return b;
  const out: SyncBuckets = { labels: [...b.labels], pins: [...b.pins], associated: [] };
  for (const pair of b.associated) {
    if (unassociated.has(pair.label.id)) {
      out.labels.push(pair.label);
      out.pins.push(pair.pin);
    } else {
      out.associated.push(pair);
    }
  }
  out.labels.sort((a, c) => strNumCmp(a.text, c.text, true));
  out.pins.sort((a, c) => a.index - c.index);
  return out;
}

/**
 * `OnBtnRmPinsClicked` → `SHEET_SYNCHRONIZATION_AGENT::RemoveItem`: delete the
 * selected pins from the sheet symbol, in the **parent** document.
 *
 * Removed back to front, because a pin's identity here is its index and
 * deleting a low one would renumber every pin above it.
 */
export function deleteSyncPins(sheetIndex: number, pinIndices: readonly number[]): EditCommand {
  const doomed = new Set(pinIndices);
  const apply = (doc: Schematic): Schematic => {
    const sheet = doc.sheets[sheetIndex];
    if (!sheet) return doc;
    return {
      ...doc,
      sheets: doc.sheets.map((s, i) =>
        i === sheetIndex ? { ...s, pins: s.pins.filter((_, k) => !doomed.has(k)) } : s,
      ),
    };
  };
  return {
    label: 'Delete Sheet Pins',
    apply,
    // The sheet's whole pin list, snapshotted: the inverse of "drop these
    // indices" is "put the list back", which cannot get the order wrong.
    invert: (before: Schematic) =>
      restoreSheetPins(sheetIndex, before.sheets[sheetIndex]?.pins ?? []),
  };
}

function restoreSheetPins(sheetIndex: number, pins: readonly SheetPin[]): EditCommand {
  return {
    label: 'Delete Sheet Pins',
    apply: (doc: Schematic): Schematic => ({
      ...doc,
      sheets: doc.sheets.map((s, i) => (i === sheetIndex ? { ...s, pins: [...pins] } : s)),
    }),
    invert: (before: Schematic) =>
      restoreSheetPins(sheetIndex, before.sheets[sheetIndex]?.pins ?? []),
  };
}

/**
 * `OnBtnRmLabelsClicked`: delete the selected hierarchical labels from the
 * **sub-sheet** document.
 *
 * By text, and every label carrying it — the same rule the rename direction
 * follows, and for the same reason: the row stands for all of them, since the
 * list is de-duplicated by text. Deleting one and leaving its twins would leave
 * the row on screen looking as though nothing had happened.
 */
export function deleteSyncLabels(texts: readonly string[]): EditCommand {
  const doomed = new Set(texts);
  return {
    label: 'Delete Hierarchical Labels',
    apply: (doc: Schematic): Schematic => ({
      ...doc,
      labels: doc.labels.filter((l) => !(l.kind === 'hierarchical_label' && doomed.has(l.text))),
    }),
    invert: (before: Schematic) => setLabels(before.labels),
  };
}

/**
 * `GenericSync`'s last act: the pair it just made agree goes back into the
 * associated list.
 *
 *     m_models[…ASSOCIATED]->AppendItem(
 *             std::make_shared<ASSOCIATED_SCH_LABEL_PIN>( label_ptr, pin_ptr ) );
 *
 * That matters because of `splitAssociated`. Upstream's Break moves rows once,
 * out of a mutable model; ours is a set of label ids re-applied on every render,
 * so without this the pair would be pulled apart again the instant it matched —
 * you press "Use label", the pin really is renamed, and the two rows sit exactly
 * where they were. The button looks dead.
 */
export function reassociate(broken: ReadonlySet<string>, labelId: string): ReadonlySet<string> {
  if (!broken.has(labelId)) return broken;
  const next = new Set(broken);
  next.delete(labelId);
  return next;
}
