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
 * The two "add" buttons are **deliberately not modelled here**: upstream's
 * `PlaceSheetPin` / `PlaceHieraLable` hand off to the interactive placement
 * tool, so where the new item lands is a question the user answers with the
 * mouse. That needs a design decision rather than a port, and inventing a
 * position would be worse than leaving the button out.
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
