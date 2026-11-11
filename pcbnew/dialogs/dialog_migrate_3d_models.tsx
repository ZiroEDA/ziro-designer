// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `DIALOG_MIGRATE_3D_MODELS` (pcbnew/dialogs/dialog_migrate_3d_models.cpp): replacing the
 * `.wrl` references KiCad 10's STEP-only library cannot resolve, by hand in the dialog or, on
 * load, silently where the file name alone identifies the STEP model (AutoMigrateByFilename).
 *
 * Web deltas: the stock 3D directory is the hosted library, listed by its catalogue
 * (tools/models3d/catalog.mjs); "Add Search Directory..." and "Open External File..." choose
 * among the project's own folders and STEP files, since a page has no picker over a disk, and
 * a directory added is searched for this dialog only (`system.extra_3d_search_dirs` names
 * folders on one machine).
 */
import { type JSX, type ReactNode, useMemo, useReducer, useState } from 'react';
import {
  ParentDirName,
  FullName,
  HasStepExtension,
  IsWrlExtension,
  NormalizeStem,
  STEP_CATALOG,
} from '@ziroeda/3d-viewer/3d_cache/model_substitution_helpers.js';
import {
  LoadHosted3DCatalog,
  mountHostedLibrary,
  PROJECT_FILES_MOUNT,
} from '@ziroeda/3d-viewer/3d_cache/3d_cache.js';
import { CollectFilesLoopSafe } from '@ziroeda/common/gestfich.js';
import { ContextMenu } from '@ziroeda/wx/menu_ui.js';
import { wxMountFileSystem } from '@ziroeda/wx/filefn.js';
import { BOARD_COMMIT } from '../board_commit.js';
import { type FOOTPRINT, FP_3DMODEL } from '../footprint.js';
import type { PCB_EDIT_FRAME } from '../pcb_edit_frame.js';
import { PROJECT_PCB } from '../project_pcb.js';
import { DIALOG_MIGRATE_3D_MODELS_BASE } from './dialog_migrate_3d_models_base.js';
import { wxGetTranslation } from '@ziroeda/wx/translation.js';

/** Where the app serves the hosted library's catalogue. */
export const HOSTED_3D_CATALOG_URL = '/models3d_catalog.json';

/** A ranked candidate shown in column 2. A score of 0 means "keep existing". */
interface MATCH_CANDIDATE {
  m_absPath: string;
  m_display: string;
  m_score: number;
}

/** An entry in the STEP catalog. m_absPath is the deduplication key. */
interface CATALOG_ENTRY {
  m_absPath: string;
  m_stem: string;
  m_parent: string;
}

/** The transform of the first FP_3DMODEL that referenced a missing file. */
interface MISSING_XFORM {
  m_scale: FP_3DMODEL['m_Scale'];
  m_rotation: FP_3DMODEL['m_Rotation'];
  m_offset: FP_3DMODEL['m_Offset'];
  m_opacity: number;
}

/** `levenshtein`: the classic iterative edit distance. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; ++i) {
    curr[0] = i;
    for (let j = 1; j <= n; ++j) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/** wxString::CmpNoCase < 0. */
const cmpNoCase = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * The model files where KiCad would look for them, while `aFn` runs: the hosted library at the
 * stock 3D directory and the project's files at its directory, as the 3D scene mounts them.
 */
function withModelMounts<T>(aFrame: PCB_EDIT_FRAME, aFn: () => T): T {
  mountHostedLibrary();
  const projectDir = aFrame.Prj().GetProjectPath().replace(/\/+$/, '');
  const unmount = projectDir.startsWith('/')
    ? wxMountFileSystem(projectDir, new PROJECT_FILES_MOUNT(new Set(aFrame.GetProjectFileNames())))
    : null;
  try {
    return aFn();
  } finally {
    unmount?.();
  }
}

export class DIALOG_MIGRATE_3D_MODELS {
  readonly m_frame: PCB_EDIT_FRAME;
  /** Unique `.wrl` names (as stored, `${VAR}` intact) the resolver could not locate. */
  readonly m_missing: string[] = [];
  readonly m_missingXform: MISSING_XFORM[] = [];
  /** Representative footprint per missing name; the preview's template. */
  readonly m_missingRepFp: FOOTPRINT[] = [];
  m_candidatesPerMissing: MATCH_CANDIDATE[][] = [];
  /** The chosen candidate per missing entry; -1 is "keep existing". */
  m_selectedPerMissing: number[] = [];
  readonly m_catalog: CATALOG_ENTRY[] = [];
  readonly m_scannedDirs = new Set<string>();
  /** The directories "Add Search Directory..." added. */
  readonly m_extraDirs: string[] = [];

  constructor(aFrame: PCB_EDIT_FRAME) {
    this.m_frame = aFrame;

    withModelMounts(aFrame, () => {
      this.collectMissingModels();
      this.buildCatalog();
    });
    this.rankAllCandidates();

    // Auto-select the top real (non-"keep existing") candidate for every
    // missing row so the user sees a sensible default without having to
    // click through each one.
    for (let i = 0; i < this.m_missing.length; ++i) {
      const cands = this.m_candidatesPerMissing[i]!;

      if (cands.length > 0 && cands[0]!.m_absPath !== '') this.m_selectedPerMissing[i] = 0;
    }
  }

  /** `BoardHasUnresolvedWrlReferences`. */
  static BoardHasUnresolvedWrlReferences(aFrame: PCB_EDIT_FRAME): boolean {
    return DIALOG_MIGRATE_3D_MODELS.CountUnresolvedWrlReferences(aFrame) > 0;
  }

  /** `CountUnresolvedWrlReferences`: unique unresolvable `.wrl`/`.wrz` names on the board. */
  static CountUnresolvedWrlReferences(aFrame: PCB_EDIT_FRAME): number {
    const board = aFrame.GetBoard();

    if (!board) return 0;

    const resolver = PROJECT_PCB.Get3DFilenameResolver();
    const projectPath = aFrame.Prj().GetProjectPath();
    const unique = new Set<string>();

    withModelMounts(aFrame, () => {
      for (const fp of board.Footprints()) {
        for (const model of fp.Models()) {
          const fn = model.m_Filename;

          if (fn === '' || !IsWrlExtension(fn)) continue;

          if (unique.has(fn)) continue;

          if (resolver.ResolvePath(fn, projectPath, []) === '') unique.add(fn);
        }
      }
    });

    return unique.size;
  }

  /**
   * `AutoMigrateByFilename`: rewrite the unresolvable `.wrl` references whose file name
   * identifies a STEP model, in one undoable commit. Returns how many were rewritten.
   */
  static AutoMigrateByFilename(aFrame: PCB_EDIT_FRAME): number {
    const board = aFrame.GetBoard();

    if (!board) return 0;

    const resolver = PROJECT_PCB.Get3DFilenameResolver();
    const projectPath = aFrame.Prj().GetProjectPath();
    const catalog = new STEP_CATALOG();
    let catalogBuilt = false;
    const replacements = new Map<string, string>();
    const seen = new Set<string>();

    withModelMounts(aFrame, () => {
      for (const fp of board.Footprints()) {
        for (const model of fp.Models()) {
          const fn = model.m_Filename;

          if (fn === '' || !IsWrlExtension(fn)) continue;

          if (seen.has(fn)) continue;

          seen.add(fn);

          if (resolver.ResolvePath(fn, projectPath, []) !== '') continue;

          if (!catalogBuilt) {
            catalog.Build(projectPath, resolver);
            catalogBuilt = true;
          }

          const match = catalog.FindMatchFor(fn);

          if (match === '') continue;

          const shortened = resolver.ShortenPath(match);
          replacements.set(fn, shortened === '' ? match : shortened);
        }
      }
    });

    if (replacements.size === 0) return 0;

    const commit = new BOARD_COMMIT(aFrame);
    let rewritten = 0;

    for (const fp of board.Footprints()) {
      let changedThisFp = false;

      for (const model of fp.Models()) {
        const to = replacements.get(model.m_Filename);

        if (to === undefined) continue;

        if (!changedThisFp) {
          commit.Modify(fp);
          changedThisFp = true;
        }

        model.m_Filename = to;
        ++rewritten;
      }
    }

    if (rewritten > 0) commit.Push(wxGetTranslation('Auto-migrate 3D model references'));

    return rewritten;
  }

  /** `collectMissingModels`. */
  private collectMissingModels(): void {
    const board = this.m_frame.GetBoard();

    if (!board) return;

    const resolver = PROJECT_PCB.Get3DFilenameResolver();
    const projectPath = this.m_frame.Prj().GetProjectPath();
    // std::map: the names in sorted order.
    const byName = new Map<string, { fp: FOOTPRINT; xform: MISSING_XFORM }>();

    for (const fp of board.Footprints()) {
      for (const model of fp.Models()) {
        const fn = model.m_Filename;

        if (fn === '' || !IsWrlExtension(fn)) continue;

        if (byName.has(fn)) continue;

        if (resolver.ResolvePath(fn, projectPath, []) !== '') continue;

        byName.set(fn, {
          fp,
          xform: {
            m_scale: { ...model.m_Scale },
            m_rotation: { ...model.m_Rotation },
            m_offset: { ...model.m_Offset },
            m_opacity: model.m_Opacity,
          },
        });
      }
    }

    for (const fn of [...byName.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const e = byName.get(fn)!;
      this.m_missing.push(fn);
      this.m_missingRepFp.push(e.fp);
      this.m_missingXform.push(e.xform);
    }

    this.m_selectedPerMissing = this.m_missing.map(() => -1);
    this.m_candidatesPerMissing = this.m_missing.map(() => []);
  }

  /** `buildCatalog`: the resolver's search paths, the project's `3dshapes/`, the extra dirs. */
  private buildCatalog(): void {
    if (this.m_missing.length === 0) return;

    for (const sp of PROJECT_PCB.Get3DFilenameResolver().GetPaths()) {
      if (sp.m_Pathexp !== '') this.scanDirectory(sp.m_Pathexp);
    }

    this.scanDirectory(`${this.m_frame.Prj().GetProjectPath().replace(/\/+$/, '')}/3dshapes`);

    for (const dir of this.m_extraDirs) this.scanDirectory(dir);
  }

  /** `scanDirectory`: every STEP-family file under `aDir`, once per directory and per file. */
  scanDirectory(aDir: string): void {
    if (aDir === '') return;

    const dir = aDir.replace(/\/+$/, '');
    const key = dir.toLowerCase();

    if (this.m_scannedDirs.has(key)) return; // already scanned

    this.m_scannedDirs.add(key);

    const files: string[] = [];
    CollectFilesLoopSafe(dir, files);

    const existing = new Set(this.m_catalog.map((e) => e.m_absPath.toLowerCase()));

    for (const f of files) {
      const lower = f.toLowerCase();

      if (!HasStepExtension(f)) continue;

      if (existing.has(lower)) continue;

      existing.add(lower);

      this.m_catalog.push({
        m_absPath: f,
        m_stem: NormalizeStem(FullName(f)),
        m_parent: ParentDirName(f),
      });
    }
  }

  /** `rankCandidatesFor`. */
  rankCandidatesFor(aWrlFilename: string): MATCH_CANDIDATE[] {
    const wrlStem = NormalizeStem(FullName(aWrlFilename));
    const wrlParent = ParentDirName(aWrlFilename);
    const ranked: MATCH_CANDIDATE[] = [];

    for (const entry of this.m_catalog) {
      let score = 0;

      if (entry.m_stem === wrlStem) {
        score =
          wrlParent !== '' && entry.m_parent.toLowerCase() === wrlParent.toLowerCase() ? 1000 : 800;
      } else {
        const dist = levenshtein(entry.m_stem, wrlStem);
        const maxDist = Math.max(2, Math.floor(wrlStem.length / 4));

        if (dist <= maxDist) score = 500 - dist * 10;
      }

      if (score > 0) {
        ranked.push({
          m_absPath: entry.m_absPath,
          m_display: `${FullName(entry.m_absPath)}   —   ${entry.m_parent}`,
          m_score: score,
        });
      }
    }

    ranked.sort((a, b) =>
      a.m_score !== b.m_score ? b.m_score - a.m_score : cmpNoCase(a.m_display, b.m_display),
    );

    const kMaxCandidates = 15;

    if (ranked.length > kMaxCandidates) ranked.length = kMaxCandidates;

    ranked.push({
      m_absPath: '',
      m_display: wxGetTranslation('(keep existing reference)'),
      m_score: 0,
    });

    return ranked;
  }

  rankAllCandidates(): void {
    this.m_candidatesPerMissing = this.m_missing.map((fn) => this.rankCandidatesFor(fn));
  }

  /** `OnCandidateSelected`. */
  OnCandidateSelected(aMissingIdx: number, aCandIdx: number): void {
    const cands = this.m_candidatesPerMissing[aMissingIdx];

    if (!cands || aCandIdx < 0 || aCandIdx >= cands.length) return;

    this.m_selectedPerMissing[aMissingIdx] = cands[aCandIdx]!.m_absPath === '' ? -1 : aCandIdx;
  }

  /** `OnAddSearchDirectoryClick` after the picker: scan it and re-rank, keeping choices. */
  AddSearchDirectory(aChosen: string): void {
    if (aChosen === '') return;

    if (!this.m_extraDirs.includes(aChosen)) this.m_extraDirs.push(aChosen);

    withModelMounts(this.m_frame, () => this.scanDirectory(aChosen));

    // Remember the path each row had chosen so it survives the re-rank.
    const priorSelectionPaths = this.m_missing.map((_, i) => {
      const sel = this.m_selectedPerMissing[i]!;
      const cands = this.m_candidatesPerMissing[i]!;
      return sel >= 0 && sel < cands.length ? cands[sel]!.m_absPath : '';
    });

    this.rankAllCandidates();

    for (let i = 0; i < this.m_missing.length; ++i) {
      this.m_selectedPerMissing[i] = -1;
      const cands = this.m_candidatesPerMissing[i]!;

      if (priorSelectionPaths[i] !== '') {
        const j = cands.findIndex((c) => c.m_absPath === priorSelectionPaths[i]);
        if (j >= 0) this.m_selectedPerMissing[i] = j;
      }

      if (this.m_selectedPerMissing[i]! < 0 && cands.length > 0 && cands[0]!.m_absPath !== '')
        this.m_selectedPerMissing[i] = 0;
    }
  }

  /** `OnOpenExternalFileClick` after the picker: the file goes first, as "user-selected". */
  OpenExternalFile(aMissingIdx: number, aChosenPath: string): void {
    if (aMissingIdx < 0 || aMissingIdx >= this.m_missing.length || aChosenPath === '') return;

    const cands = this.m_candidatesPerMissing[aMissingIdx]!;
    const existing = cands.findIndex((c) => c.m_absPath === aChosenPath);

    if (existing < 0) {
      cands.unshift({
        m_absPath: aChosenPath,
        m_display: `${FullName(aChosenPath)}   —   user-selected`,
        m_score: 2000,
      });
      this.m_selectedPerMissing[aMissingIdx] = 0;
    } else {
      this.m_selectedPerMissing[aMissingIdx] = existing;
    }
  }

  /** `OnReplaceClick`: one commit rewriting every chosen reference. False is wxID_CANCEL. */
  OnReplaceClick(): boolean {
    const resolver = PROJECT_PCB.Get3DFilenameResolver();
    const replacements = new Map<string, string>();

    for (let i = 0; i < this.m_missing.length; ++i) {
      const sel = this.m_selectedPerMissing[i]!;
      const cands = this.m_candidatesPerMissing[i]!;

      if (sel < 0 || sel >= cands.length) continue;

      const c = cands[sel]!;

      if (c.m_absPath === '') continue; // "(keep existing)"

      replacements.set(
        this.m_missing[i]!,
        withModelMounts(this.m_frame, () => resolver.ShortenPath(c.m_absPath)),
      );
    }

    if (replacements.size === 0) return false;

    const board = this.m_frame.GetBoard()!;
    const commit = new BOARD_COMMIT(this.m_frame);

    for (const fp of board.Footprints()) {
      let changedThisFp = false;

      for (const model of fp.Models()) {
        const to = replacements.get(model.m_Filename);

        if (to === undefined) continue;

        if (!changedThisFp) {
          commit.Modify(fp);
          changedThisFp = true;
        }

        model.m_Filename = to;
      }
    }

    commit.Push(wxGetTranslation('Migrate 3D model references'));
    return true;
  }

  /** The project's folders and STEP files: what the two pickers offer here. */
  ProjectChoices(): { dirs: string[]; files: string[] } {
    const projectDir = this.m_frame.Prj().GetProjectPath().replace(/\/+$/, '');
    const names = this.m_frame.GetProjectFileNames();
    const dirs = new Set<string>();
    const files: string[] = [];

    for (const n of names) {
      if (!HasStepExtension(n)) continue;
      files.push(`${projectDir}/${n}`);
      const slash = n.lastIndexOf('/');
      if (slash > 0) dirs.add(`${projectDir}/${n.slice(0, slash)}`);
    }

    return { dirs: [...dirs].sort(), files: files.sort() };
  }
}

/**
 * The load-time half (PCB_EDIT_FRAME::OnBoardLoaded): fetch the catalogue only when the board
 * has `.wrl` references, rewrite what the file name settles, and offer the dialog for the rest.
 */
export async function MigrateWrlModelsOnLoad(
  aFrame: PCB_EDIT_FRAME,
  aCatalogUrl = HOSTED_3D_CATALOG_URL,
): Promise<void> {
  const board = aFrame.GetBoard();

  if (!board?.Footprints().some((fp) => fp.Models().some((m) => IsWrlExtension(m.m_Filename))))
    return;

  await LoadHosted3DCatalog(aCatalogUrl);

  if (aFrame.GetBoard() !== board) return;

  // Silently replace references whose filename uniquely identifies a
  // STEP sibling.  Leaves ambiguous cases for the infobar below.
  DIALOG_MIGRATE_3D_MODELS.AutoMigrateByFilename(aFrame);

  const unresolved = DIALOG_MIGRATE_3D_MODELS.CountUnresolvedWrlReferences(aFrame);

  if (unresolved > 0) {
    const infoBar = aFrame.GetInfoBar();

    if (!infoBar) return;

    const msg =
      unresolved === 1
        ? `${unresolved} WRL 3D model could not be matched to an equivalent STEP model.`
        : `${unresolved} WRL 3D models could not be matched to equivalent STEP models.`;

    infoBar.RemoveAllButtons();
    infoBar.AddButton({
      label: wxGetTranslation('Show options'),
      onClick: () => {
        void aFrame.ShowMigrate3DModelsDialog().then(() => {
          // Dismiss the infobar if nothing remains to resolve;
          // otherwise leave it so the user can try again.
          if (DIALOG_MIGRATE_3D_MODELS.CountUnresolvedWrlReferences(aFrame) === 0)
            infoBar.Dismiss();
        });
      },
    });
    infoBar.AddCloseButton?.();
    infoBar.ShowMessageFor(msg, 10000);
  }
}

export interface DialogMigrate3DModelsProps {
  frame: PCB_EDIT_FRAME;
  /** The EDA_3D_CANVAS over the throwaway board: a copy of `footprint` given `models`. */
  Preview: (p: {
    footprint: FOOTPRINT;
    models: readonly FP_3DMODEL[];
    version: number;
  }) => ReactNode;
  /** EndModal: true for wxID_OK. */
  onClose: (aOk: boolean) => void;
}

export function DialogMigrate3DModels({
  frame,
  Preview,
  onClose,
}: DialogMigrate3DModelsProps): JSX.Element {
  const [dlg] = useState(() => new DIALOG_MIGRATE_3D_MODELS(frame));
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [missingRow, setMissingRow] = useState(dlg.m_missing.length > 0 ? 0 : -1);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: 'dir' | 'file' } | null>(null);
  // m_mainSplitter / m_innerSplitter: three columns of about a third each.
  const [mainSash, setMainSash] = useState(300);
  const [innerSash, setInnerSash] = useState(280);
  const [version, setVersion] = useState(0);

  const cands = missingRow >= 0 ? dlg.m_candidatesPerMissing[missingRow]! : [];
  const sel = missingRow >= 0 ? dlg.m_selectedPerMissing[missingRow]! : -1;
  const candRow = sel >= 0 && sel < cands.length ? sel : cands.length > 0 ? 0 : -1;
  const candPath = candRow >= 0 ? cands[candRow]!.m_absPath : '';

  /** showPreview: the representative footprint, unflipped at 0 degrees, with the candidate. */
  const preview = useMemo(() => {
    const repFp = missingRow >= 0 ? dlg.m_missingRepFp[missingRow] : undefined;

    if (!repFp) return null;

    const models: FP_3DMODEL[] = [];

    if (candPath !== '') {
      const xf = dlg.m_missingXform[missingRow]!;
      const replacement = new FP_3DMODEL();
      replacement.m_Filename = candPath;
      replacement.m_Scale = { ...xf.m_scale };
      replacement.m_Rotation = { ...xf.m_rotation };
      replacement.m_Offset = { ...xf.m_offset };
      replacement.m_Opacity = xf.m_opacity;
      replacement.m_Show = true;
      models.push(replacement);
    }

    return { footprint: repFp, models };
  }, [dlg, missingRow, candPath]);

  const choices = menu ? dlg.ProjectChoices() : null;
  const menuItems = choices
    ? (menu!.kind === 'dir' ? choices.dirs : choices.files).map((path) => ({
        label: path,
        action: () => {
          if (menu!.kind === 'dir') dlg.AddSearchDirectory(path);
          else dlg.OpenExternalFile(missingRow, path);
          setVersion((v) => v + 1);
          bump();
        },
      }))
    : [];

  const openMenu = (aKind: 'dir' | 'file'): void => {
    const el = document.activeElement?.getBoundingClientRect();
    setMenu({ x: el?.left ?? 0, y: el?.bottom ?? 0, kind: aKind });
  };

  return (
    <>
      <DIALOG_MIGRATE_3D_MODELS_BASE
        m_missingList={{
          rows: dlg.m_missing,
          selection: missingRow,
          // updateMissingItemStyle: bold while no replacement is chosen.
          bold: dlg.m_missing.map((_, i) => i).filter((i) => dlg.m_selectedPerMissing[i]! < 0),
          onSelect: (row) => {
            setMissingRow(row);
            setVersion((v) => v + 1);
          },
        }}
        m_candidatesList={{
          rows: cands.map((c) => c.m_display),
          selection: candRow,
          onSelect: (row) => {
            dlg.OnCandidateSelected(missingRow, row);
            setVersion((v) => v + 1);
            bump();
          },
        }}
        OnAddSearchDirectoryClick={() => openMenu('dir')}
        OnOpenExternalFileClick={() => {
          if (missingRow >= 0) openMenu('file');
        }}
        m_previewPane={
          preview && Preview({ footprint: preview.footprint, models: preview.models, version })
        }
        m_mainSashPosition={mainSash}
        onMainSash={setMainSash}
        m_innerSashPosition={innerSash}
        onInnerSash={setInnerSash}
        OnReplaceClick={() => onClose(dlg.OnReplaceClick())}
        OnKeepClick={() => onClose(false)}
      />
      {menu && (
        <ContextMenu
          items={
            menuItems.length > 0
              ? menuItems
              : [{ label: '(no STEP files in the project)', disabled: true }]
          }
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
