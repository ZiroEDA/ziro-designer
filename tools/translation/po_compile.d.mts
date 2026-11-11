// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Types for `po_compile.mjs`, so the qa suite can check the compiler. The
 * pipeline scripts are plain ESM (they run under bare node, with no build
 * step); this is the only part of them a typed caller reaches into.
 */

export const CONTEXT_GLUE: string;

export interface PoEntry {
  msgctxt: string | null;
  msgid: string;
  msgidPlural: string | null;
  msgstr: string[];
  fuzzy: boolean;
}

/** The compiled catalog: what `translation/<lang>.json` holds. */
export interface CompiledCatalog {
  /** The header's `Language:` field. */
  language: string;
  nplurals: number;
  /** The header's C plural expression, e.g. `n != 1`. */
  plural: string;
  /** msgid (or `msgctxt\u0004msgid`) to its translation; an array for a plural entry. */
  messages: Record<string, string | string[]>;
}

export interface CompileStats {
  total: number;
  translated: number;
  fuzzy: number;
  untranslated: number;
  /** Translated entries dropped because msgstr === msgid. */
  identical: number;
}

export function unescapePoString(body: string): string;
export function parsePo(text: string): PoEntry[];
export function pluralFormsOf(header: string): { nplurals: number; plural: string };
export function compilePo(text: string): { catalog: CompiledCatalog; stats: CompileStats };
export function serializeCatalog(catalog: CompiledCatalog): string;
