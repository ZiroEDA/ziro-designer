// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Update Schematic from PCB — the back-annotation engine. Counterpart:
 * `eeschema/tools/backannotate.cpp` (BACK_ANNOTATE), the reverse of the
 * Update PCB from Schematic pipeline that landed in #177.
 *
 * The board tells the schematic what changed on it: a reference renamed during
 * board layout, a footprint reassigned, a value edited, an attribute flipped.
 * Each is optional, each is reported, and a dry run reports without changing
 * anything — upstream's `m_dryRun`, which is what the dialog's preview uses.
 *
 * **The board model is not imported here.** The input is a plain list of
 * `PcbFootprintData`, which the caller fills in from whatever it has. That
 * keeps this testable, and keeps the schematic engine from depending on a board
 * type that is being changed in parallel.
 *
 * **Net names are deliberately out of scope**, and it is a real boundary rather
 * than an omission: `m_processNetNames` drives `applyPinSwaps`, unit swaps
 * across multi-unit symbols and label placement — three subsystems that have
 * nothing to do with the field updates here. Upstream gates it behind its own
 * checkbox, which is where the split belongs.
 *
 * Two upstream rules that are easy to miss and are pinned by tests:
 *
 *  - **a field holding a text variable is never overwritten.** `HasTextVars()`
 *    guards the reference, footprint and value updates, because writing the
 *    resolved text would destroy the `${...}` that produced it;
 *  - **matching is by path, not by reference,** unless the user asks to re-link.
 *    A reference changed on the board is exactly the case back-annotation
 *    exists for, so matching by it would find nothing.
 */

import type { Schematic, SchSymbol } from '../types.js';
import type { EditCommand } from './command.js';
import { refId } from './hittest.js';

/** One footprint's state on the board, as back-annotation reads it. */
export interface PcbFootprintData {
  /** The symbol path the footprint records (`(path "/uuid")`), its identity. */
  path: string;
  reference: string;
  /** The footprint's library identifier, which is the symbol's Footprint field. */
  footprint: string;
  value: string;
  dnp: boolean;
  excludeFromBom: boolean;
  excludeFromPosFiles: boolean;
  /** Any other fields the footprint carries, by name. */
  fields?: Readonly<Record<string, string>>;
}

export interface BackAnnotateOptions {
  /** Match by reference designator instead of by path (`m_matchByReference`). */
  relinkFootprints: boolean;
  processReferences: boolean;
  processFootprints: boolean;
  processValues: boolean;
  processAttributes: boolean;
  processOtherFields: boolean;
  /** Report what would change without changing it. */
  dryRun: boolean;
}

export type ReportSeverity = 'action' | 'warning' | 'error';

export interface BackAnnotateMessage {
  text: string;
  severity: ReportSeverity;
}

export interface BackAnnotateResult {
  /** How many individual changes were made (or would be, on a dry run). */
  changes: number;
  messages: BackAnnotateMessage[];
  /** Null on a dry run, or when nothing changed. */
  command: EditCommand | null;
}

export function defaultBackAnnotateOptions(): BackAnnotateOptions {
  return {
    relinkFootprints: false,
    processReferences: true,
    processFootprints: true,
    processValues: true,
    processAttributes: true,
    processOtherFields: true,
    dryRun: true,
  };
}

const fieldValue = (sym: SchSymbol, key: string): string =>
  sym.fields.find((f) => f.key === key)?.value ?? '';

/** `HasTextVars()`: a field whose text is generated must not be overwritten. */
const hasTextVars = (v: string): boolean => /\$\{[^}]*\}/.test(v);

const boolText = (b: boolean): string => (b ? 'true' : 'false');

/** The symbol path a footprint would record for this placement. */
const symbolPath = (sym: SchSymbol, index: number): string =>
  `/${refId('symbol', sym.uuid, index)}`;

/** Set (or add) one field on a symbol, leaving its source node for the writer. */
function withField(sym: SchSymbol, key: string, value: string): SchSymbol {
  const at = sym.fields.findIndex((f) => f.key === key);
  if (at < 0) return sym;
  const fields = sym.fields.map((f, i) => (i === at ? { ...f, value } : f));
  return { ...sym, fields };
}

interface Change {
  index: number;
  next: SchSymbol;
}

/**
 * Compare the board against the schematic and, unless this is a dry run, build
 * the command that applies the differences.
 */
export function backAnnotate(
  sch: Schematic,
  footprints: readonly PcbFootprintData[],
  opts: BackAnnotateOptions,
): BackAnnotateResult {
  const messages: BackAnnotateMessage[] = [];
  let changes = 0;

  if (
    !opts.relinkFootprints &&
    !opts.processReferences &&
    !opts.processFootprints &&
    !opts.processValues &&
    !opts.processAttributes &&
    !opts.processOtherFields
  ) {
    // "Select at least one property to back annotate." Nothing to do, and an
    // empty run that reported success would read as "the board matched".
    messages.push({ text: 'Select at least one property to back annotate.', severity: 'error' });
    return { changes: 0, messages, command: null };
  }

  const byIndex = new Map<number, PcbFootprintData>();
  const matched = new Set<number>();

  for (const fp of footprints) {
    const index = opts.relinkFootprints
      ? sch.symbols.findIndex((s) => fieldValue(s, 'Reference') === fp.reference)
      : sch.symbols.findIndex((s, i) => symbolPath(s, i) === fp.path);
    if (index < 0) {
      messages.push({
        text: `Cannot find symbol for footprint '${fp.reference}'.`,
        severity: 'error',
      });
      continue;
    }
    byIndex.set(index, fp);
    matched.add(index);
  }

  // Symbols the board has no footprint for. Upstream reports this only when the
  // symbol *is* excluded from the board, which is backwards — an excluded
  // symbol is expected to be absent, and a symbol that belongs on the board and
  // is missing from it is the case worth telling the user about. We report the
  // latter, deliberately, and say so rather than shipping a warning that fires
  // on the wrong set.
  sch.symbols.forEach((sym, i) => {
    if (matched.has(i) || !sym.onBoard) return;
    const ref = fieldValue(sym, 'Reference');
    if (!ref || ref.startsWith('#')) return;
    messages.push({
      text:
        `Footprint '${ref}' is not present on PCB. Corresponding symbols in ` +
        'schematic must be manually deleted (if desired).',
      severity: 'warning',
    });
  });

  const edits: Change[] = [];

  for (const [index, fp] of [...byIndex.entries()].sort((a, b) => a[0] - b[0])) {
    const sym = sch.symbols[index]!;
    let next = sym;
    const ref = fieldValue(sym, 'Reference');

    if (opts.processReferences && ref !== fp.reference && !hasTextVars(ref)) {
      changes++;
      messages.push({
        text: `Change ${ref} reference designator to '${fp.reference}'.`,
        severity: 'action',
      });
      next = withField(next, 'Reference', fp.reference);
    }

    const oldFootprint = fieldValue(sym, 'Footprint');
    if (opts.processFootprints && oldFootprint !== fp.footprint && !hasTextVars(oldFootprint)) {
      changes++;
      messages.push({
        text: `Change ${ref} footprint assignment from '${oldFootprint}' to '${fp.footprint}'.`,
        severity: 'action',
      });
      next = withField(next, 'Footprint', fp.footprint);
    }

    const oldValue = fieldValue(sym, 'Value');
    if (opts.processValues && oldValue !== fp.value && !hasTextVars(oldValue)) {
      changes++;
      messages.push({
        text: `Change ${ref} value from '${oldValue}' to '${fp.value}'.`,
        severity: 'action',
      });
      next = withField(next, 'Value', fp.value);
    }

    if (opts.processAttributes) {
      if (sym.dnp !== fp.dnp) {
        changes++;
        messages.push({
          text: `Change ${ref} 'Do not populate' from '${boolText(sym.dnp)}' to '${boolText(fp.dnp)}'.`,
          severity: 'action',
        });
        next = { ...next, dnp: fp.dnp };
      }
      // The model stores `inBom` / `onBoard` the way the file does, so the
      // board's "exclude from" flags invert on the way in.
      if (!sym.inBom !== fp.excludeFromBom) {
        changes++;
        messages.push({
          text:
            `Change ${ref} 'Exclude from bill of materials' from ` +
            `'${boolText(!sym.inBom)}' to '${boolText(fp.excludeFromBom)}'.`,
          severity: 'action',
        });
        next = { ...next, inBom: !fp.excludeFromBom };
      }
      if (!!sym.excludedFromPosFiles !== fp.excludeFromPosFiles) {
        changes++;
        messages.push({
          text:
            `Change ${ref} 'Exclude from position files' from ` +
            `'${boolText(!!sym.excludedFromPosFiles)}' to '${boolText(fp.excludeFromPosFiles)}'.`,
          severity: 'action',
        });
        next = { ...next, excludedFromPosFiles: fp.excludeFromPosFiles };
      }
    }

    if (opts.processOtherFields) {
      for (const [key, value] of Object.entries(fp.fields ?? {})) {
        // Only fields the symbol already has: back-annotation updates what is
        // there rather than importing the board's own bookkeeping fields.
        const existing = sym.fields.find((f) => f.key === key);
        if (!existing || existing.value === value || hasTextVars(existing.value)) continue;
        changes++;
        messages.push({
          text: `Change ${ref} field '${key}' from '${existing.value}' to '${value}'.`,
          severity: 'action',
        });
        next = withField(next, key, value);
      }
    }

    if (next !== sym) edits.push({ index, next });
  }

  if (changes === 0) {
    messages.push({ text: 'No changes to apply.', severity: 'action' });
    return { changes: 0, messages, command: null };
  }

  if (opts.dryRun) return { changes, messages, command: null };

  return { changes, messages, command: applyBackAnnotation(edits) };
}

/** The undoable half: replace the changed symbols, restoring them on undo. */
function applyBackAnnotation(edits: readonly Change[]): EditCommand {
  return {
    label: 'Update Schematic from PCB',
    apply(doc: Schematic): Schematic {
      const byIndex = new Map(edits.map((e) => [e.index, e.next]));
      return { ...doc, symbols: doc.symbols.map((s, i) => byIndex.get(i) ?? s) };
    },
    invert(before: Schematic): EditCommand {
      const saved = edits.map((e) => ({ index: e.index, next: before.symbols[e.index]! }));
      return applyBackAnnotation(saved);
    },
  };
}
