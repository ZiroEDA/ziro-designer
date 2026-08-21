// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A `wxFileDialog` over local files, with the type combo KiCad puts in one.
 *
 * Every KiCad open dialog is built the same way — a title, a `|`-joined list of
 * named wildcards, and `wxFD_OPEN`:
 *
 *     wxFileDialog dlg( this, _( "Open Gerber Job File" ), currentPath,
 *                       filename.GetFullName(), FILEEXT::GerberJobFileWildcard(),
 *                       wxFD_OPEN | wxFD_FILE_MUST_EXIST | wxFD_CHANGE_DIR );
 *                                        gerbview/job_file_reader.cpp:190-195
 *
 * and the list is what fills the combo at the bottom of the dialog: "Gerber
 * files (*.g*; *.pho)", "Top layer (*.gtl)", … , "All files (*)".
 *
 * A hidden `<input type="file" accept="...">` cannot express that. `accept` is
 * one flat list with no names and no groups, so Chrome labels the whole thing
 * **"Custom Files"** — one entry, whatever KiCad would have offered. That is
 * what our GerbView opens showed, and it is why this module exists rather than
 * a longer `accept` string.
 *
 * `window.showOpenFilePicker` is the browser primitive that does have named
 * groups: each `types[]` entry carries a `description`, which is exactly a
 * wildcard's label, and an `accept` map of extensions. So the filter list is
 * the same data either way and only the transport differs.
 *
 * Where the picker is missing the `<input>` remains, built from the SAME filter
 * list rather than a second hand-written `accept` — a fallback that drifts from
 * what it falls back to is worse than none.
 */

import type { ChooserFilter } from './chooser_types.js';

/** The subset of the File System Access API this uses. */
interface FilePickerType {
  description: string;
  accept: Record<string, string[]>;
}
type ShowOpenFilePicker = (opts: {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerType[];
}) => Promise<{ getFile(): Promise<File> }[]>;

/**
 * The filters as `showOpenFilePicker` types.
 *
 * A filter with no extensions is upstream's All files entry. The picker spells
 * that as `excludeAcceptAllOption: false` rather than as a type of its own, so
 * it is dropped here and reported by {@link wantsAllFiles} instead — leaving it
 * in as a type with an empty accept map makes the call throw.
 */
export function pickerTypes(filters: readonly ChooserFilter[]): FilePickerType[] {
  return filters
    .filter((f) => f.extensions.length > 0)
    .map((f) => ({
      description: f.label,
      // The MIME key is required and unused for matching; these are text
      // formats with no registered type, which is what wx passes too.
      accept: { 'application/octet-stream': f.extensions.map((e: string) => `.${e}`) },
    }));
}

/** Whether the list carries upstream's All files entry. */
export function wantsAllFiles(filters: readonly ChooserFilter[]): boolean {
  return filters.some((f) => f.extensions.length === 0);
}

/**
 * The `accept` attribute for the `<input>` fallback: every extension the
 * filters name, de-duplicated in first-seen order.
 *
 * Empty when the list offers All files, because an `accept` that lists
 * extensions would then be *narrower* than the dialog it stands in for.
 */
export function acceptAttribute(filters: readonly ChooserFilter[]): string {
  if (wantsAllFiles(filters)) return '';
  const seen = new Set<string>();
  for (const f of filters) for (const e of f.extensions) seen.add(`.${e}`);
  return [...seen].join(',');
}

/**
 * Show the dialog and return the chosen files, or an empty list if cancelled.
 *
 * `fallback` is the hidden `<input>` to click when the picker is unavailable;
 * it resolves empty because an `<input>` reports its result through its own
 * change handler rather than to the caller.
 */
export async function openFileDialog(
  filters: readonly ChooserFilter[],
  opts: { multiple?: boolean; fallback?: () => void } = {},
): Promise<File[]> {
  const picker = (globalThis as { showOpenFilePicker?: ShowOpenFilePicker }).showOpenFilePicker;

  if (typeof picker !== 'function') {
    opts.fallback?.();
    return [];
  }

  try {
    const handles = await picker({
      multiple: opts.multiple ?? false,
      excludeAcceptAllOption: !wantsAllFiles(filters),
      types: pickerTypes(filters),
    });
    return await Promise.all(handles.map((h) => h.getFile()));
  } catch (err) {
    // AbortError is the user pressing Cancel, which is wxID_CANCEL and not a
    // failure. Anything else means the picker could not run at all (an
    // insecure context, a sandboxed frame), so fall back rather than swallow.
    if ((err as DOMException).name === 'AbortError') return [];
    opts.fallback?.();
    return [];
  }
}
