// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * Where a file an editor autosaves goes in the open project.
 *
 * The editors name their files as KiCad does - relative to the project folder, the way a sheet
 * symbol names its file - and the project stores them under its own folder ("proj/proj.kicad_sch").
 * A file is matched to the project's copy by its basename. One the project did not have yet was
 * dropped, which was right for nothing and wrong for a new sub-sheet: drawing a hierarchical sheet
 * creates its file, the root sheet points at it, and the file was never written anywhere - a
 * reload showed "Sheet file not in project" and every symbol placed on it was gone (uartbridge,
 * U-6). KiCad writes it with the rest of the hierarchy, so a sheet file joins the project here.
 */

export interface NamedText {
  name: string;
  text: string;
}

const basename = (aPath: string): string => aPath.split('/').pop()!.split('\\').pop()!;

/**
 * The folder the project's files are stored under, with its trailing slash ("proj/"), or "" for
 * a project stored flat: the folder of its `.kicad_pro`, else of its first sheet.
 */
export function projectFolderOf(aFiles: readonly { name: string }[]): string {
  const anchor =
    aFiles.find((f) => /\.kicad_pro$/i.test(f.name)) ??
    aFiles.find((f) => /\.kicad_sch$/i.test(f.name));
  const name = anchor?.name ?? '';
  return name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '';
}

/**
 * Whether a file the project does not have yet is a sheet to take in: a `.kicad_sch` named
 * relative to the project folder. Never an absolute path, nor one that climbs out of the folder:
 * a sheet symbol may name either, but this project cannot hold it.
 */
export function isNewSheetFile(aName: string): boolean {
  return (
    /\.kicad_sch$/i.test(aName) &&
    !aName.startsWith('/') &&
    !/^[A-Za-z]:/.test(aName) &&
    !aName.split(/[\\/]/).includes('..')
  );
}

/**
 * Each of \a aChanged under the name \a aProject stores it as, `added` when the project does not
 * have it yet. A file that is neither the project's nor a new sheet is left out.
 */
export function placeEditorFiles(
  aProject: readonly { name: string }[],
  aChanged: readonly NamedText[],
): (NamedText & { added: boolean })[] {
  const byBase = new Map(aProject.map((f) => [basename(f.name), f.name]));
  const folder = projectFolderOf(aProject);
  const out: (NamedText & { added: boolean })[] = [];

  for (const f of aChanged) {
    const full = byBase.get(basename(f.name));

    if (full) out.push({ name: full, text: f.text, added: false });
    else if (isNewSheetFile(f.name))
      out.push({ name: `${folder}${f.name}`, text: f.text, added: true });
  }

  return out;
}
