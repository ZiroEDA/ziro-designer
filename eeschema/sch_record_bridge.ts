// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * TRANSITIONAL (stage S1a of docs/eeschema-live-stage0.md; deleted at S7). No KiCad
 * counterpart: the bridge from the record model the window still edits to the live
 * `SCHEMATIC` the KiCad classes run on, the way pcbnew's `commitViewToBoard` bridged its
 * view while #636 moved callers over.
 *
 * The window's records are written out in KiCad's own format and opened through
 * `SCH_EDIT_FRAME::OpenProjectFiles`, so the live model is exactly what KiCad would have
 * after opening those files. It is rebuilt only when asked for and only if a sheet's
 * record changed since the last build: re-opening a large hierarchy on every edit would
 * cost the edit.
 */
import type { SCH_EDIT_FRAME } from './sch_edit_frame.js';
import type { Schematic } from './types.js';
import { serialize } from '@ziroeda/sexpr/serializer.js';
import { writeSchematic } from './sch_io/sexpr/write-schematic.js';
import type { SCHEMATIC } from './schematic.js';

export interface RecordProject {
  /**
   * The project folder's absolute path, `/<projectName>`: the same one pcbnew loads the
   * project under (pcbnew/files.ts), so the settings manager both editors share holds one
   * project, not two that unload each other.
   */
  dir: string;
  /** Each sheet's record by its file name (relative to the project folder). */
  docs: ReadonlyMap<string, Schematic>;
  /** The root sheet's file name. */
  root: string;
  /** The project's other files the load reads (the `.kicad_pro`, `.kicad_prl`), by name. */
  files: readonly { name: string; text: string }[];
}

const base = (aName: string) => aName.replace(/\\/g, '/').replace(/^.*\//, '');

/**
 * Open \a aProject's records on \a aFrame through `OpenProjectFiles`; returns the live
 * schematic, or null when it could not be opened.
 */
export function openRecordsLive(aFrame: SCH_EDIT_FRAME, aProject: RecordProject): SCHEMATIC | null {
  const texts = new Map<string, string>();

  for (const f of aProject.files) texts.set(`${aProject.dir}/${base(f.name)}`, f.text);

  for (const [file, sheet] of aProject.docs)
    texts.set(`${aProject.dir}/${file}`, serialize(writeSchematic(sheet)));

  const ok = aFrame.OpenProjectFiles(
    [`${aProject.dir}/${aProject.root}`],
    0,
    (p) => texts.get(p) ?? null,
  );

  return ok ? aFrame.Schematic() : null;
}

/**
 * The live mirror of a window's records: `get()` answers the live schematic, rebuilding it
 * first when any sheet's record is not the one it was built from.
 */
export class LIVE_SCHEMATIC_MIRROR {
  private m_builtFrom: Map<string, Schematic> | null = null;
  private m_live: SCHEMATIC | null = null;

  constructor(
    private readonly m_frame: SCH_EDIT_FRAME,
    private readonly m_project: () => RecordProject | null,
  ) {}

  /** Forget the build (a different project opened). */
  Invalidate(): void {
    this.m_builtFrom = null;
    this.m_live = null;
  }

  get(): SCHEMATIC | null {
    const project = this.m_project();

    if (!project) return null;

    const built = this.m_builtFrom;
    const fresh =
      built !== null &&
      built.size === project.docs.size &&
      [...project.docs].every(([file, doc]) => built.get(file) === doc);

    if (!fresh) {
      this.m_live = openRecordsLive(this.m_frame, project);
      this.m_builtFrom = new Map(project.docs);
    }

    return this.m_live;
  }
}
