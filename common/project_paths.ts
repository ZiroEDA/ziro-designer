// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `${KIPRJMOD}` — what it stands for, and the one file a path built on it
 * names. Counterparts: `PROJECT_VAR_NAME` (`include/project.h:41`),
 * `PROJECT::GetProjectPath` and `ExpandEnvVarSubstitutions`
 * (`common/common.cpp`), which is the single expansion every table row, every
 * 3D-model reference and every footprint association file goes through
 * upstream.
 *
 * It is one module because upstream has one function. The symbol library
 * table's resolver and the equivalence-file resolver were the same twenty
 * lines twice over, which is the per-editor copy the shared-module rule exists
 * to stop; both call in here now.
 *
 * `${KIPRJMOD}` is a real directory, so a path built on it names exactly one
 * file: `${KIPRJMOD}/foo.equ` is the `foo.equ` beside the project file, never
 * a same-named file in a subfolder. Matching loosely would let a reference
 * silently resolve to something the engineer never registered.
 */

/** A project file as an editor holds it: the path inside the project, and its
 *  text. */
export interface ProjectFile {
  name: string;
  text: string;
}

const norm = (n: string): string => n.replace(/\\/g, '/');

/**
 * What `${KIPRJMOD}` stands for: the folder the project's own files sit in,
 * with its trailing slash, or '' for a project opened as a flat file list.
 *
 * The `.kicad_pro` anchors it, because upstream's `${KIPRJMOD}` is
 * `Prj().GetProjectPath()` — the directory of the project file itself.
 * `alsoAnchoredBy` names files that sit beside it and may stand in when the
 * project has no `.kicad_pro` at all (the `sym-lib-table` does, for a project
 * that is only a library folder).
 */
export function projectRoot(files: readonly ProjectFile[], alsoAnchoredBy?: RegExp): string {
  const anchor =
    (alsoAnchoredBy ? files.find((f) => alsoAnchoredBy.test(norm(f.name)))?.name : undefined) ??
    files.find((f) => /\.kicad_pro$/i.test(norm(f.name)))?.name;
  const path = anchor ? norm(anchor) : '';
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
}

/**
 * A `${KIPRJMOD}`-relative reference as a path inside the project, or '' when
 * the reference is nothing but the variable.
 *
 * Both spellings are accepted, `${KIPRJMOD}` and the legacy `$(KIPRJMOD)`,
 * because `ExpandEnvVarSubstitutions` accepts both and KiCad-written files in
 * the wild carry each.
 */
export function projectRelativePath(uri: string, root: string): string {
  const rel = norm(uri)
    .replace(/^\$\{KIPRJMOD\}\/?/i, '')
    .replace(/^\$\(KIPRJMOD\)\/?/i, '')
    .replace(/^\.\//, '');
  return rel ? `${root}${rel}` : '';
}

/** The project file a `${KIPRJMOD}`-relative reference points at, resolved
 *  exactly. Undefined when the project holds no such file. */
export function findProjectFile<T extends ProjectFile>(
  files: readonly T[],
  uri: string,
  alsoAnchoredBy?: RegExp,
): T | undefined {
  const wanted = projectRelativePath(uri, projectRoot(files, alsoAnchoredBy)).toLowerCase();
  if (!wanted) return undefined;
  return files.find((f) => norm(f.name).toLowerCase() === wanted);
}
