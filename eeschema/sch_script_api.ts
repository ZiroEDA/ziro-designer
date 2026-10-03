// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
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
}
