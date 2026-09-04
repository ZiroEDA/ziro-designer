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
  /**
   * KiCad's `UNDO_REDO::PAGESETTINGS` picker status.
   *
   * It is the one status whose undo NAVIGATES. Every other kind of change is
   * applied to the screen its picker names without disturbing the view — you
   * can undo an edit made on another sheet and never see it happen — but page
   * settings are restored only after bringing their own sheet on screen:
   *
   *     else if( status == UNDO_REDO::PAGESETTINGS )
   *     {
   *         if( GetCurrentSheet() != undoSheet )
   *         {
   *             SetCurrentSheet( undoSheet );
   *             DisplayCurrentSheet();
   *         }
   *     (`schematic_undo_redo.cpp:350-358`)
   *
   * which makes sense: the whole visible result of the undo is the sheet
   * border, and undoing it invisibly would look like nothing happened.
   */
  readonly pageSettings?: boolean;
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
 * One undo entry: the command to run on each document it touches, by file.
 *
 * This is a `PICKED_ITEMS_LIST`. Every picker in one carries the `SCH_SCREEN`
 * its item belongs to — `ITEM_PICKER itemWrapper( aScreen, aItem, aCommandType )`
 * (`schematic_undo_redo.cpp:105`) — and `PutDataInPreviousState` adds or removes
 * each item on THAT screen, `AddToScreen( eda_item, screen )`, rather than on
 * whichever sheet happens to be open. So one entry spanning several sheets is
 * not a special case upstream; it is the ordinary shape of the thing.
 */
export type ProjectEdit = ReadonlyMap<string, EditCommand>;

/** What one step of the project's history produced. */
export interface ProjectStep {
  /** The documents the step changed, by file. Sheets it did not touch are absent. */
  docs: Map<string, Schematic>;
  /**
   * The sheet to bring on screen before showing the result, if the step
   * restored one's page settings. See {@link EditCommand.pageSettings} — it is
   * the only status whose undo navigates.
   */
  showSheet?: string;
}

/**
 * The project's undo and redo stacks: `EDA_BASE_FRAME::m_undoList` and
 * `m_redoList` (`eda_base_frame.h:860-861`).
 *
 * They live on the FRAME, not on the SCH_SCREEN. KiCad has exactly one undo
 * stack for a whole schematic however many sheets it has, and Ctrl+Z takes back
 * the last thing you did *anywhere in the project*. Ours kept a stack per
 * sheet, so moving a part on sheet 2, stepping into sheet 3 and pressing Ctrl+Z
 * undid either nothing or some much older edit of sheet 3's — and the entry
 * that should have come back stayed buried until you found your way back to the
 * sheet you made it on.
 *
 * There is no depth limit here because there is none there: `DEFAULT_MAX_UNDO_ITEMS`
 * is 0 (`eda_base_frame.h:103`), the sentinel `PushCommandToUndoList` reads as
 * "never trim", and eeschema never sets another.
 */
export class ProjectHistory {
  private undoStack: ProjectEdit[] = [];
  private redoStack: ProjectEdit[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Apply an edit and push ONE entry, whatever it turns out to touch —
   * `SCH_COMMIT::Push` staging every modified item and calling
   * `SaveCopyInUndoList` once.
   *
   * `docs` is the project's live documents; a file the edit names but the
   * project does not hold is skipped, the way a commit whose screen has been
   * closed stages nothing for it.
   */
  execute(docs: ReadonlyMap<string, Schematic>, edit: ProjectEdit): ProjectStep {
    const step = this.run(edit, docs, false);
    this.undoStack.push(step.entry);
    // "Clear redo list, because after new save there is no redo to do"
    // (`schematic_undo_redo.cpp:132-133`).
    this.redoStack = [];
    return step.result;
  }

  /** Take back the last edit made anywhere in the project. */
  undo(docs: ReadonlyMap<string, Schematic>): ProjectStep | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    const step = this.run(entry, docs, true);
    this.redoStack.push(step.entry);
    return step.result;
  }

  redo(docs: ReadonlyMap<string, Schematic>): ProjectStep | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    const step = this.run(entry, docs, true);
    this.undoStack.push(step.entry);
    return step.result;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Apply one entry over every document it names, and build the entry that
   * takes it back — `PutDataInPreviousState`, which both undo and redo call and
   * which leaves the list ready to go the other way.
   *
   * Each inverse is computed against the document as that command SAW it: the
   * same rule `composeCommands` follows within one sheet, and the same thing
   * `ITEM_PICKER`'s link holds — the copy taken before the change.
   */
  private run(
    entry: ProjectEdit,
    docs: ReadonlyMap<string, Schematic>,
    restoring: boolean,
  ): { result: ProjectStep; entry: ProjectEdit } {
    const result: ProjectStep = { docs: new Map() };
    const inverses = new Map<string, EditCommand>();
    for (const [file, cmd] of entry) {
      const before = docs.get(file);
      if (!before) continue;
      result.docs.set(file, cmd.apply(before));
      inverses.set(file, cmd.invert(before));
      // Only while restoring: `PutDataInPreviousState` is what navigates, and
      // making the edit in the first place never goes through it.
      if (restoring && cmd.pageSettings) result.showSheet = file;
    }
    return { result, entry: inverses };
  }
}

/**
 * The single-document form of the same stacks.
 *
 * A schematic with one sheet is a project with one file, so this is the project
 * history with the filename left out rather than a second mechanism. Everything
 * that edits a document without knowing which sheet it is — the command tests,
 * and the tools that build a document to serialize — uses this.
 */
export class History {
  private static readonly SOLE = '';
  private readonly project = new ProjectHistory();

  get canUndo(): boolean {
    return this.project.canUndo;
  }
  get canRedo(): boolean {
    return this.project.canRedo;
  }

  /** Apply a command, recording its inverse for undo. Clears the redo stack. */
  execute(doc: Schematic, cmd: EditCommand): Schematic {
    const step = this.project.execute(one(doc), new Map([[History.SOLE, cmd]]));
    return step.docs.get(History.SOLE) ?? doc;
  }

  undo(doc: Schematic): Schematic | null {
    const step = this.project.undo(one(doc));
    return step ? (step.docs.get(History.SOLE) ?? doc) : null;
  }

  redo(doc: Schematic): Schematic | null {
    const step = this.project.redo(one(doc));
    return step ? (step.docs.get(History.SOLE) ?? doc) : null;
  }

  clear(): void {
    this.project.clear();
  }
}

const one = (doc: Schematic): ReadonlyMap<string, Schematic> => new Map([['', doc]]);
