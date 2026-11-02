// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * TRANSITIONAL (stage S1a of docs/eeschema-live-stage0.md; deleted at S7). No KiCad
 * counterpart: the bridge from the record model the window still edits to the live
 * `SCHEMATIC` the KiCad classes run on (and back, for edits made on the live model), the way pcbnew's `commitViewToBoard` bridged its
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
import { parse } from '@ziroeda/sexpr/parser.js';
import { readSchematic } from './sch_io/sexpr/read-schematic.js';
import { SCH_IO_KICAD_SEXPR } from './sch_io/kicad_sexpr/sch_io_kicad_sexpr.js';
import { SCH_SCREENS, type SCH_SCREEN } from './sch_screen.js';
import type { SCHEMATIC, SCHEMATIC_LISTENER } from './schematic.js';
import type { SCH_ITEM } from './sch_item.js';
import { Pgm } from '@ziroeda/common/pgm_base.js';
import type { PROJECT } from '@ziroeda/common/project.js';
import { LoadSchematic } from './eeschema_helpers.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import type { SCH_MARKER } from './sch_marker.js';
import { SCH_NAVIGATE_TOOL } from './tools/sch_navigate_tool.js';

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
 * \a aProject's records loaded as a schematic of their own (`EESCHEMA_HELPERS::LoadSchematic`,
 * what kicad-cli runs), under \a aPrj: for a check that must not touch the editor's screens.
 */
export function loadRecordsDetached(aProject: RecordProject, aPrj: PROJECT): SCHEMATIC | null {
  const texts = new Map<string, string>();

  for (const f of aProject.files) texts.set(`${aProject.dir}/${base(f.name)}`, f.text);

  for (const [file, sheet] of aProject.docs)
    texts.set(`${aProject.dir}/${file}`, serialize(writeSchematic(sheet)));

  return LoadSchematic(`${aProject.dir}/${aProject.root}`, aPrj, (p) => texts.get(p) ?? null);
}

/**
 * The live mirror of a window's records: `get()` answers the live schematic, rebuilding it
 * first when any sheet's record is not the one it was built from.
 */
export class LIVE_SCHEMATIC_MIRROR {
  private m_builtFrom: Map<string, Schematic> | null = null;
  private m_live: SCHEMATIC | null = null;
  /** The `.kicad_pro` text the live project last read or wrote. */
  private m_proText: string | null = null;
  /** The screens a commit has touched since TakeCommittedScreens last read them. */
  private m_committed = new Set<SCH_SCREEN>();
  /** Hears every SCH_COMMIT on the live schematic (SCHEMATIC::OnItemsChanged and the rest). */
  private readonly m_listener: SCHEMATIC_LISTENER = {
    OnSchItemsAdded: (_aSch, aItems) => this.noteCommitted(aItems),
    OnSchItemsRemoved: (_aSch, aItems) => this.noteCommitted(aItems),
    OnSchItemsChanged: (_aSch, aItems) => this.noteCommitted(aItems),
  };

  constructor(
    private readonly m_frame: SCH_EDIT_FRAME,
    private readonly m_project: () => RecordProject | null,
    /** Told of each rebuild, with the schematic that replaced the last one. */
    private readonly m_onRebuilt: (aSchematic: SCHEMATIC) => void = () => {},
  ) {}

  private noteCommitted(aItems: readonly SCH_ITEM[]): void {
    for (const item of aItems) {
      let parent = item.GetParent();

      while (parent && parent.Type() !== KICAD_T.SCH_SCREEN_T) parent = parent.GetParent();

      if (parent) this.m_committed.add(parent as unknown as SCH_SCREEN);
    }
  }

  /**
   * The screens the live commits since the last call changed - every sheet a multi-sheet commit
   * (the Symbol Fields Table's, say) reached, which OnModify's current screen alone misses.
   */
  TakeCommittedScreens(): Set<SCH_SCREEN> {
    const out = this.m_committed;
    this.m_committed = new Set();
    return out;
  }

  /** Forget the build (a different project opened). */
  Invalidate(): void {
    this.m_builtFrom = null;
    this.m_live = null;
    this.m_proText = null;
  }

  /**
   * The window has taken \a aDocs, records written from this live model (liveScreensToRecords):
   * the live model already is what they say, so they count as built from and the next get()
   * does not reopen the project for them.
   */
  Adopt(aDocs: ReadonlyMap<string, Schematic>): void {
    if (!this.m_builtFrom) return;

    for (const [file, doc] of aDocs) this.m_builtFrom.set(file, doc);
  }

  /** The live project wrote \a aText as its `.kicad_pro` (SETTINGS_MANAGER::SaveProject). */
  NoteProjectSaved(aText: string): void {
    this.m_proText = aText;
  }

  get(): SCHEMATIC | null {
    const project = this.m_project();

    if (!project) return null;

    const proText = project.files.find((f) => /\.kicad_pro$/i.test(f.name))?.text ?? null;
    const built = this.m_builtFrom;
    const proChanged = built !== null && proText !== this.m_proText;
    const fresh =
      built !== null &&
      !proChanged &&
      built.size === project.docs.size &&
      [...project.docs].every(([file, doc]) => built.get(file) === doc);

    if (!fresh) {
      const previous = this.m_live;
      const carried = new Map<string, SCH_MARKER[]>();

      if (previous) {
        // The excluded markers come back from the settings (OpenProjectFiles'
        // ResolveERCExclusionsPostUpdate); the others ride across on their sheet's file.
        previous.RecordERCExclusions();

        const screens = new SCH_SCREENS(previous.Root());

        for (let screen = screens.GetFirst(); screen; screen = screens.GetNext()) {
          const markers = [...screen.Items().OfType(KICAD_T.SCH_MARKER_T)]
            .map((m) => m as SCH_MARKER)
            .filter((m) => !m.IsExcluded());

          if (markers.length) carried.set(screen.GetFileName(), markers);
        }
      }

      // The window's project file changed under the live project: reload it from the text.
      if (proChanged) {
        const prj = this.m_frame.Prj();

        if (!prj.IsNullProject()) Pgm().GetSettingsManager().UnloadProject(prj);
      }

      // A rebuild is not an open: the Back/Forward history rides across it.
      const navigator = this.m_frame.GetToolManager()?.GetTool(SCH_NAVIGATE_TOOL);
      const history = previous && navigator ? navigator.TakeHistory() : null;

      previous?.RemoveListener(this.m_listener);
      this.m_committed.clear();
      this.m_live = openRecordsLive(this.m_frame, project);
      this.m_live?.AddListener(this.m_listener);
      this.m_builtFrom = new Map(project.docs);
      this.m_proText = proText;

      if (this.m_live) {
        const screens = new SCH_SCREENS(this.m_live.Root());

        for (let screen = screens.GetFirst(); screen; screen = screens.GetNext()) {
          for (const marker of carried.get(screen.GetFileName()) ?? []) screen.Append(marker);
        }

        if (history) navigator!.RestoreHistory(history);

        if (previous && previous !== this.m_live) this.m_onRebuilt(this.m_live);
      }
    }

    return this.m_live;
  }
}

/**
 * The other direction, for edits made on the live model (the AI's hierarchy edits) while the
 * window still edits records: each changed screen written in KiCad's own format
 * (`SCH_IO_KICAD_SEXPR::SaveSchematicFile`, the bytes a save writes) and read back as the
 * window's record, by its file name relative to the project folder. TRANSITIONAL like the rest
 * of this file: gone when the window edits the live model (S7).
 */
export function liveScreensToRecords(
  aFrame: SCH_EDIT_FRAME,
  aScreens: Iterable<SCH_SCREEN>,
  aProjectDir: string,
): Map<string, Schematic> {
  const out = new Map<string, Schematic>();
  const schematic = aFrame.Schematic();
  const hierarchy = schematic.Hierarchy();
  const io = new SCH_IO_KICAD_SEXPR();

  for (const screen of aScreens) {
    const path = hierarchy.FindSheetForScreen(screen);
    const sheet = path.Last();

    if (!sheet) continue;

    const absolute = screen.GetFileName().replace(/\\/g, '/');
    const file = absolute.startsWith(`${aProjectDir}/`)
      ? absolute.slice(aProjectDir.length + 1)
      : base(absolute);
    const text = io.SaveSchematicFile(sheet, schematic);

    out.set(file, { ...readSchematic(parse(text)), fileName: file });
  }

  return out;
}
