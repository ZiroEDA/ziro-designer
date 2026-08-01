// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Repeat Last Item (F1). Counterpart: `SCH_EDIT_TOOL::RepeatDrawItem`
 * (eeschema/tools/sch_edit_tool.cpp) over the frame's repeat list, and
 * `IncrementString` (common/increment.cpp) for the label numbering.
 *
 * After placing something, F1 places another like it, offset by the repeat
 * step. Its point is filling a bus out: place NET0, then hold F1 and get NET1,
 * NET2, NET3 each a step down the page, without going back to the label dialog
 * every time.
 *
 * A label's *text* is incremented, not just copied, which is the whole reason
 * the action exists rather than being Ctrl+D. The increment lands on the last
 * run of digits in the name, keeping any suffix after it and any leading zeros
 * it had, so D07 becomes D08 rather than D8, and CLK0_P becomes CLK1_P.
 */

import type { Schematic, SchLabel, Vec2 } from '../types.js';
import { refId } from './hittest.js';
import { addItems } from './mutate.js';
import { newUuid } from './build.js';
import type { EditCommand } from './command.js';

/**
 * `IncrementString`. The last run of digits in the string is stepped, keeping
 * its width and whatever followed it.
 *
 * Returns null when the result would go below zero, which upstream reports as
 * "Label value cannot go below zero" rather than wrapping or clamping. A string
 * with no digits at all is *not* a failure: it repeats unchanged.
 */
export function incrementString(name: string, increment: number): string | null {
  if (name === '') return name;

  let i = name.length - 1;
  let suffix = '';
  while (i >= 0 && !/[0-9]/.test(name[i]!)) {
    suffix = name[i]! + suffix;
    i--;
  }
  let digits = '';
  while (i >= 0 && /[0-9]/.test(name[i]!)) {
    digits = name[i]! + digits;
    i--;
  }
  // No digits to step: the name repeats as it is.
  if (digits === '') return name;

  const next = Number.parseInt(digits, 10) + increment;
  if (next < 0) return null;
  // Keep the field width the original had, so D07 goes to D08, not D8.
  return name.slice(0, i + 1) + String(next).padStart(digits.length, '0') + suffix;
}

/** What F1 repeats: the items placed by the last placement, by selection id. */
export type RepeatItems = readonly string[];

export interface RepeatOptions {
  /** `m_Drawing.default_repeat_offset_x/y`, in IU. */
  offset: Vec2;
  /** `m_Drawing.repeat_label_increment`. */
  labelIncrement: number;
  /** A symbol goes to the cursor instead of the offset, and is then moved. */
  cursor?: Vec2;
}

/** What a repeat produced, so the caller can select it and report a refusal. */
export interface RepeatResult {
  command: EditCommand;
  /** Ids of the new items, which upstream selects. */
  ids: string[];
  /** True when a label's number would have gone below zero and was left as is. */
  clampedAtZero: boolean;
}

/**
 * Repeat the items in `ids`, offset and with labels incremented.
 *
 * Only labels are repeated here. Upstream repeats whatever was last placed, but
 * a label is the case the action is for and the only one whose text changes;
 * repeating other kinds is plain duplication, which Ctrl+D already does.
 */
export function repeatItems(
  doc: Schematic,
  ids: RepeatItems,
  opts: RepeatOptions,
): RepeatResult | null {
  const labels: SchLabel[] = [];
  const newIds: string[] = [];
  let clampedAtZero = false;

  for (const id of ids) {
    const idx = doc.labels.findIndex((l, i) => refId('label', l.uuid, i) === id);
    if (idx === -1) continue;
    const src = doc.labels[idx]!;
    const stepped = incrementString(src.text, opts.labelIncrement);
    if (stepped === null) clampedAtZero = true;
    const uuid = newUuid();
    labels.push({
      ...src,
      uuid,
      text: stepped ?? src.text,
      at: { x: src.at.x + opts.offset.x, y: src.at.y + opts.offset.y },
    });
    newIds.push(uuid);
  }

  if (labels.length === 0) return null;
  return { command: addItems({ labels }), ids: newIds, clampedAtZero };
}
