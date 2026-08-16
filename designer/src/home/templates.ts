// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Project templates, KiCad's "New Project from Template" (project_template.cpp,
 * kicad_manager_control.cpp). A template is a folder with a .kicad_pro/sch/pcb,
 * footprint libs, and meta/info.html (title + description) + meta/icon.png. We
 * bundle KiCad's standard templates under /templates and describe them in
 * /templates/index.json (built by scripts). Creating a project copies the files
 * and renames those named after the template to the new project name, exactly
 * like PROJECT_TEMPLATE::CreateProject, except drawing sheets and libraries,
 * which stay put so their references don't break.
 */
import type { PickedHomeFile } from './files.js';

export interface TemplateMeta {
  id: string;
  base: string; // the template's .kicad_pro basename (what gets renamed)
  title: string;
  description: string;
  icon: string | null;
  /** PROJECT_TEMPLATE::GetHtmlFile(): meta/info.html, which the preview loads. */
  html?: string;
  /**
   * TEMPLATE_WIDGET::m_isUserTemplate, which m_filterChoice filters on.
   *
   * BuildTemplateList marks whatever it finds under the user root true and the
   * system root false. `default` is a *user* template on a stock install: it
   * is seeded into KICAD_USER_TEMPLATE_DIR, which always has a value, so the
   * separate "treated as a built-in" scan is skipped. See tools/templates/
   * import.mjs, which works the category out the same way.
   */
  category?: 'user' | 'system';
  /**
   * Where the template's files come from: the bundled manifest under
   * /templates, or the user template store (user_templates.ts). Distinct from
   * `category`, which is only what the filter dropdown asks about.
   */
  source?: 'bundled' | 'user';
  files: string[]; // project files, relative to the template folder
}

const dec = new TextDecoder();

/** Load the bundled template manifest (empty on failure, feature just hides). */
export async function loadTemplates(): Promise<TemplateMeta[]> {
  try {
    const res = await fetch('/templates/index.json');
    if (!res.ok) return [];
    const j = (await res.json()) as { templates: TemplateMeta[] };
    return j.templates ?? [];
  } catch {
    return [];
  }
}

// KiCad's CreateProject rename: swap the template basename for the project name
// in file/dir names, but leave drawing sheets, legacy sym libs and .pretty
// footprint-lib directories untouched (renaming them breaks the lib tables).
export function renameRel(rel: string, base: string, projectName: string): string {
  const parts = rel.replace(/\\/g, '/').split('/');
  const fileName = parts[parts.length - 1]!;
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  const inPretty = parts.some((p) => /\.pretty$/i.test(p));
  const keep =
    inPretty ||
    ext === 'kicad_wks' ||
    ext === 'lib' ||
    ext === 'dcm' ||
    fileName === 'fp-lib-table' ||
    fileName === 'sym-lib-table';
  const newName = keep ? fileName : fileName.split(base).join(projectName);
  const dirs = parts
    .slice(0, -1)
    .map((seg) =>
      seg === base
        ? projectName
        : seg.startsWith(`${base}-`)
          ? projectName + seg.slice(base.length)
          : seg,
    );
  return [...dirs, newName].join('/');
}

const encodeRel = (rel: string): string => rel.split('/').map(encodeURIComponent).join('/');

/**
 * Build a new project's files from a template: fetch each file, rename it, and
 * nest everything under a folder named for the project (mirrors KiCad's copy).
 * Contents are copied verbatim, like KiCad, only names change.
 */
/**
 * A bundled template's files under their own names, with nothing renamed.
 *
 * onDuplicateTemplate copies the tree verbatim - `wxCopyFile( srcFile, destFile )`
 * over GetFileList() - because the copy is still a template. The renaming in
 * CreateProject only happens when a *project* is made from one, which is why
 * this is separate from createFromTemplate below.
 */
export async function templateSourceFiles(t: TemplateMeta): Promise<PickedHomeFile[]> {
  const out: PickedHomeFile[] = [];
  for (const rel of t.files) {
    const res = await fetch(`/templates/${encodeURIComponent(t.id)}/${encodeRel(rel)}`);
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    out.push({ name: rel, text: dec.decode(bytes), bytes });
  }
  return out;
}

export async function createFromTemplate(
  t: TemplateMeta,
  projectName: string,
): Promise<PickedHomeFile[]> {
  const out: PickedHomeFile[] = [];
  for (const rel of t.files) {
    const res = await fetch(`/templates/${encodeURIComponent(t.id)}/${encodeRel(rel)}`);
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const renamed = renameRel(rel, t.base, projectName);
    out.push({ name: `${projectName}/${renamed}`, text: dec.decode(bytes), bytes });
  }
  return out;
}
