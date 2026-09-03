// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Command bus with undo/redo.
 *
 * Every edit is an `EditCommand` that knows how to apply itself and to produce its
 * inverse against the pre-edit document (KiCad's commit/undo model, expressed
 * functionally). This single mechanism is the spine for undo/redo today and for
 * scripting / AI-driven edits later, they all just submit commands.
 */

import type { Schematic, Vec2 } from '../types.js';

export interface EditCommand {
  readonly label: string;
  /** Return a new document with this command applied. Must not mutate `doc`. */
  apply(doc: Schematic): Schematic;
  /** The inverse command, computed against the document as it was *before* apply. */
  invert(before: Schematic): EditCommand;
  /**
   * Points where post-edit cleanup must *not* put a junction dot back.
   *
   * `SCHEMATIC::CleanUp` only ever removes junctions; nothing in it adds one.
   * Dots are added by the operations that make connections —
   * `AddJunctionsIfNeeded` after drawing or moving a wire — so deleting a dot
   * upstream simply leaves it deleted. Ours adds them from cleanup instead,
   * which is convenient everywhere except here: it undid the delete on the very
   * next pass, and the dot looked impossible to remove.
   */
  readonly noAutoJunctionsAt?: readonly Vec2[];
}

/**
 * Run several commands as one undo step, KiCad's SCH_COMMIT, which collects
 * every change a dialog makes and pushes them under a single label.
 */
export function composeCommands(label: string, cmds: readonly EditCommand[]): EditCommand {
  return {
    label,
    apply: (doc) => cmds.reduce((d, c) => c.apply(d), doc),
    invert(before: Schematic): EditCommand {
      // Each inverse is computed against the document as that command saw it,
      // and they undo in reverse order.
      const inverses: EditCommand[] = [];
      let doc = before;
      for (const c of cmds) {
        inverses.unshift(c.invert(doc));
        doc = c.apply(doc);
      }
      return composeCommands(label, inverses);
    },
  };
}

/**
 * One edit that reaches more than one sheet.
 *
 * Upstream this is not a special case at all: a `SCH_COMMIT` stages items with
 * the SCH_SCREEN each belongs to and `Push` puts ONE entry on the undo list, so
 * undoing a Move To Sheet takes the items off the destination and puts them
 * back on the source in a single step. Ours had one `History` per document and
 * no way to say that, so a cross-sheet edit landed as two independent steps —
 * and undoing the source half left the copy on the destination, which is a
 * duplicate rather than a revert.
 */
export interface CrossSheetEdit {
  /** The command on the sheet whose undo stack the entry lives on. */
  readonly own: EditCommand;
  /** file -> the command on that OTHER sheet's document. */
  readonly others: ReadonlyMap<string, EditCommand>;
}

/** What one undo/redo/execute step produced. */
export interface HistoryStep {
  /** The sheet the history belongs to, after the step. */
  doc: Schematic;
  /** The other sheets the same step changed, by file. Empty for an ordinary
   *  single-sheet edit, which is every edit but this one. */
  others: Map<string, Schematic>;
}

/** One entry on either stack: the current sheet's command, plus the other
 *  sheets' commands that belong to the same step. */
interface Entry {
  cmd: EditCommand;
  others?: ReadonlyMap<string, EditCommand>;
}

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Apply a command, recording its inverse for undo. Clears the redo stack. */
  execute(doc: Schematic, cmd: EditCommand): Schematic {
    const next = cmd.apply(doc);
    this.undoStack.push({ cmd: cmd.invert(doc) });
    this.redoStack = [];
    return next;
  }

  /**
   * The same, for an edit that also changes other sheets — one entry on this
   * sheet's stack covering every document it touched.
   *
   * `others` is the project's documents by file, read only: a file the edit
   * names but the project does not have is skipped, the way a commit whose
   * screen has been closed stages nothing.
   */
  executeAcross(
    doc: Schematic,
    edit: CrossSheetEdit,
    others: ReadonlyMap<string, Schematic>,
  ): HistoryStep {
    const step = this.run({ cmd: edit.own, others: edit.others }, doc, others);
    this.undoStack.push(step.entry);
    this.redoStack = [];
    return step.result;
  }

  /**
   * Undo the last step on THIS sheet.
   *
   * The single-sheet form, which is every edit but a cross-sheet one. A
   * cross-sheet entry undoes only its own half here, because no other documents
   * were offered — see {@link undoAcross}, which is what the editor calls.
   */
  undo(doc: Schematic): Schematic | null {
    return this.undoAcross(doc, new Map())?.doc ?? null;
  }

  redo(doc: Schematic): Schematic | null {
    return this.redoAcross(doc, new Map())?.doc ?? null;
  }

  /** Undo the last step over the whole project, so a cross-sheet edit comes
   *  back on every sheet it touched. */
  undoAcross(doc: Schematic, others: ReadonlyMap<string, Schematic>): HistoryStep | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const step = this.run(entry, doc, others);
    this.redoStack.push(step.entry);
    return step.result;
  }

  redoAcross(doc: Schematic, others: ReadonlyMap<string, Schematic>): HistoryStep | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const step = this.run(entry, doc, others);
    this.undoStack.push(step.entry);
    return step.result;
  }

  /**
   * Apply one entry and build the entry that undoes it, over every document it
   * names.
   *
   * Each inverse is computed against the document as that command SAW it, which
   * for the other sheets means before this entry touched them — the same rule
   * `composeCommands` follows within one sheet.
   */
  private run(
    entry: Entry,
    doc: Schematic,
    others: ReadonlyMap<string, Schematic>,
  ): { result: HistoryStep; entry: Entry } {
    const result: HistoryStep = { doc: entry.cmd.apply(doc), others: new Map() };
    const inverses = new Map<string, EditCommand>();
    for (const [file, cmd] of entry.others ?? []) {
      const before = others.get(file);
      if (!before) continue;
      result.others.set(file, cmd.apply(before));
      inverses.set(file, cmd.invert(before));
    }
    return {
      result,
      entry: { cmd: entry.cmd.invert(doc), ...(inverses.size > 0 ? { others: inverses } : {}) },
    };
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
