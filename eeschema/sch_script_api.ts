// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import type { SCH_SCREEN } from './sch_screen.js';
import type { ErcViolation } from './erc/erc.js';
import type { EditCommand } from './tools/command.js';
import type { LibSymbol, SchSymbol, Schematic } from './types.js';

/** What a host may do to the open sheet (SchematicEditor's `registerScriptApi`). */
export interface SchScriptApi {
  doc(): Schematic | null;
  runCommand(cmd: EditCommand): void;
  annotatePlacement(sym: SchSymbol, lib: LibSymbol): SchSymbol;
  loadSymbol(library: string, symbolName: string): Promise<LibSymbol | undefined>;
  /** ERC on the sheet as it is now, with the project's own ERC settings. */
  erc(): ErcViolation[];
  /** The hosted symbol libraries: library nickname to symbol names. */
  symbolIndex(): Promise<readonly { name: string; symbols: readonly string[] }[]>;
  /** The hosted footprint libraries: library nickname to footprint names. */
  footprintIndex(): Promise<readonly { name: string; footprints: readonly string[] }[]>;
  /** The whole sheet as a PNG (base64, no data: prefix), as the user sees it. */
  snapshot(): string;
  /** Edit > Undo: the last edit on the sheet, whoever made it. */
  undo(): void;
  /** Every sheet file's record (the one on screen as it is now), by its project file name. */
  docs?(): ReadonlyMap<string, Schematic>;
  /** The file name of the sheet on screen. */
  currentFile?(): string;
  /** An edit on another sheet's file, as one undo step. */
  runCommandOn?(file: string, cmd: EditCommand): void;
  /**
   * An edit on the live model (KiCad's own classes): the frame brought up to date with the
   * window, \a aEdit run on it with its questions answered yes and its messages collected, and
   * the screens it returns written back into the window as one undo step. Returns what the
   * frame said (empty when all went well), or null when there is no live model to edit. An edit
   * that throws changes nothing in the window, and the throw reaches the caller.
   */
  editLive?(aEdit: (aFrame: SCH_EDIT_FRAME) => Iterable<SCH_SCREEN> | null): string[] | null;
  /** Read the live model, brought up to date with the window; null when there is none. */
  readLive?<T>(aRead: (aFrame: SCH_EDIT_FRAME) => T): T | null;
}
