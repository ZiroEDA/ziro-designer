// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Types for `split.mjs`, so the qa suite can check the splitter against real
 * libraries. The pipeline scripts are plain ESM (they run under bare node, with
 * no build step); this is the only part of them a typed caller reaches into.
 */

/** One top-level `(symbol "Name" …)` block, byte-exact from its source file. */
export interface SymbolBlock {
  name: string;
  block: string;
}

/** A symbol's own library file: the symbol plus the chain it extends. */
export interface SymbolFile {
  name: string;
  text: string;
}

export function topLevelSymbols(text: string): SymbolBlock[];
export function perSymbolFiles(parts: readonly SymbolBlock[]): SymbolFile[];
export function wrapLib(generator: string, blocks: string): string;
export function extendsOf(block: string): string | undefined;
export function stagedFileName(name: string): string;
