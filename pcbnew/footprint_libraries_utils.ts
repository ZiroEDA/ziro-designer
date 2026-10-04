// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Buffered footprint-library manager, the web port of KiCad's
 * FP_LIB_TABLE-backed editing model used by `FOOTPRINT_EDIT_FRAME`
 * (pcbnew/footprint_libraries_utils.cpp). A footprint library is a `.pretty`
 * directory whose members are one-footprint `.kicad_mod` files, so, unlike a
 * `.kicad_sym` symbol library, each footprint is its own file.
 *
 * Libraries come from two places, mirroring KiCad's global/project split:
 *   - bundled global libraries under `public/footprints` (footprint names known
 *     up front from index.json; each `.kicad_mod` fetched lazily on open),
 *   - the open project's `.pretty` folders (already in memory from the picker).
 *
 * Each library buffers working copies of its footprints; an edit marks the
 * footprint and library modified until saved. "Saving" serializes the footprint
 * with the lossless writer (serializeFootprint) and hands the bytes back, a
 * browser download per `.kicad_mod` file replaces writing to the `.pretty` dir.
 *
 * Moved from `designer/src/editors/footprint/libraryManager.ts` under the name
 * of the `.cpp` whose operations it stores for (`ImportFootprint`,
 * `DeleteFootprintFromLibrary`, `SaveFootprint`, `RevertFootprint`, …). Its
 * four `designer/` reads — the resident catalogue, the library host, the
 * load-progress tracker and `settings.pcbnew` — arrive through
 * {@link FOOTPRINT_LIBRARY_IO} instead.
 */

import { parse } from '@ziroeda/sexpr';
import {
  FLIP_DIRECTION,
  readFootprintFile,
  serializeFootprint,
} from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';
import { type PcbFootprint } from './types.js';
import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { DisplayErrorMessage } from '@ziroeda/common/confirm.js';
import { RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import { LIB_ID } from '@ziroeda/common/lib_id.js';
import type { FOOTPRINT } from './footprint.js';
import type { FOOTPRINT_EDIT_FRAME } from './footprint_edit_frame.js';
import { PCB_ACTIONS } from './tools/pcb_actions.js';
import { PAD_TOOL } from './tools/pad_tool.js';
import { niluuid } from '@ziroeda/common/kiid.js';
import { confirmRevertMessage, DisplayInfoMessage, IsOK } from '@ziroeda/common/confirm.js';
import {
  KiCadFootprintFileExtension,
  kicadFootprintLibWildcard,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { ensureFileExtension as EnsureFileExtension } from '@ziroeda/common/common.js';
import { PCB_FILE_T, PCB_IO_MGR, PLUGIN_REGISTRY } from './pcb_io/pcb_io_mgr.js';
import {
  FormatFootprintForLibrary,
  ParseFootprintFile,
} from './pcb_io/kicad_sexpr/pcb_io_kicad_sexpr.js';

/**
 * What the manager asks of the program it runs in: where a global library's
 * `.kicad_mod` text comes from (the resident catalogue, else the hosted
 * library set — `designer/`'s storage, which `pcbnew` never imports), and
 * `PCBNEW_SETTINGS::m_FlipDirection`, which `FootprintSave` reads off
 * `Kiface().KifaceSettings()` rather than the footprint editor's own file.
 */
export interface FOOTPRINT_LIBRARY_IO {
  /** One global footprint's file text; rejects when it cannot be had. */
  footprintText(libName: string, fpName: string): Promise<string>;
  /** `pcbnew.json`'s `editing.flip_left_right`. */
  flipLeftRight(): boolean;
}

export interface ManagedFpLibrary {
  /** Library nickname (the `.pretty` directory basename). */
  name: string;
  /** Display path (project-relative dir for project libs). */
  fileName: string;
  scope: 'global' | 'project';
  loaded: boolean;
  /** Footprint names known before their files are fetched (from index.json). */
  pendingNames: string[];
  /** Working (buffered) footprints by name. */
  footprints: Map<string, PcbFootprint>;
  /** As-loaded copies for revert / modified checks. */
  original: Map<string, PcbFootprint>;
  /** Footprint names with unsaved edits. */
  modified: Set<string>;
  /** Library-level structural change (added/deleted/renamed footprints). */
  libModified: boolean;
}

/** A footprint's name is the `.kicad_mod` basename (its FPID item name). */
export const fpNameOf = (path: string): string =>
  path
    .split('/')
    .pop()!
    .split('\\')
    .pop()!
    .replace(/\.kicad_mod$/i, '');

export class FootprintLibraryManager {
  constructor(private readonly io: FOOTPRINT_LIBRARY_IO) {}

  private libs = new Map<string, ManagedFpLibrary>();
  /**
   * `Prj().PinLibrary( nickname, PROJECT::LIB_TYPE_T::FOOTPRINT_LIB )` —
   * `LIBRARY_EDITOR_CONTROL::changeSelectedPinStatus`
   * (`common/tool/library_editor_control.cpp:99-130`), which is what the tree's
   * Pin Library / Unpin Library rows run.
   */
  private pinned = new Set<string>();
  /** Bumped on every mutation so React can subscribe cheaply. */
  revision = 0;

  private touch(): void {
    this.revision++;
  }

  /**
   * `LIB_TREE_NODE::Compare` (`common/lib_tree_model.cpp`, and the port in
   * `widgets/lib_tree_model.ts:169-190`): pinned libraries sort ahead of the
   * rest, and within each group it is the ordinary name order.
   */
  libraryNames(): string[] {
    const byName = (a: string, b: string): number => a.toLowerCase().localeCompare(b.toLowerCase());
    const all = [...this.libs.keys()];
    return [
      ...all.filter((n) => this.pinned.has(n)).sort(byName),
      ...all.filter((n) => !this.pinned.has(n)).sort(byName),
    ];
  }

  isPinned(name: string): boolean {
    return this.pinned.has(name);
  }

  /** `PinLibrary` / `UnpinLibrary` for one nickname. */
  setPinned(name: string, pin: boolean): void {
    if (pin) this.pinned.add(name);
    else this.pinned.delete(name);
    this.touch();
  }

  library(name: string): ManagedFpLibrary | undefined {
    return this.libs.get(name);
  }
  libraryExists(name: string): boolean {
    return this.libs.has(name);
  }

  /** Register a bundled global library by name (its `.kicad_mod`s fetched on demand). */
  addGlobalLibrary(name: string, footprintNames: string[]): void {
    if (this.libs.has(name)) return;
    this.libs.set(name, {
      name,
      fileName: `${name}.pretty`,
      scope: 'global',
      loaded: false,
      pendingNames: footprintNames,
      footprints: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: false,
    });
    this.touch();
  }

  /**
   * Forget every project library: `FOOTPRINT_EDIT_FRAME::ProjectChanged` ->
   * `SyncLibraryTree`, the half that lets the previous project's rows go. The
   * frame outlives a project switch now, so the rows of the one that closed
   * must not stay in its tree.
   */
  dropProjectLibraries(): void {
    for (const [name, lib] of this.libs) if (lib.scope === 'project') this.libs.delete(name);
    this.touch();
  }

  /**
   * Add a project library from its already-loaded `.kicad_mod` files (the
   * members of one `.pretty` directory of the open project).
   */
  addProjectLibrary(
    name: string,
    dirPath: string,
    entries: { fileName: string; text: string }[],
  ): void {
    const lib: ManagedFpLibrary = {
      name,
      fileName: dirPath,
      scope: 'project',
      loaded: true,
      pendingNames: [],
      footprints: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: false,
    };
    for (const e of entries) {
      const fp = readFootprintFile(parse(e.text));
      if (!fp) continue;
      const fpName = fp.lib || fpNameOf(e.fileName);
      lib.footprints.set(fpName, fp);
      lib.original.set(fpName, fp);
    }
    this.libs.set(name, lib);
    this.touch();
  }

  /** Create a new, empty library (ACTIONS::newLibrary). */
  createLibrary(name: string): ManagedFpLibrary {
    const lib: ManagedFpLibrary = {
      name,
      fileName: `${name}.pretty`,
      scope: 'project',
      loaded: true,
      pendingNames: [],
      footprints: new Map(),
      original: new Map(),
      modified: new Set(),
      libModified: true,
    };
    this.libs.set(name, lib);
    this.touch();
    return lib;
  }

  /**
   * Mark a global library "loaded" (its member list is already known). Individual
   * footprints are fetched by `loadFootprint`; this lets the tree expand it.
   */
  async ensureLoaded(name: string): Promise<ManagedFpLibrary | undefined> {
    const lib = this.libs.get(name);
    if (!lib) return undefined;
    lib.loaded = true;
    return lib;
  }

  /**
   * Load one footprint's working copy, fetching its `.kicad_mod` for a global
   * library (project footprints are already buffered). Mirrors FP_CACHE's
   * per-file load.
   */
  async loadFootprint(libName: string, fpName: string): Promise<PcbFootprint | undefined> {
    const lib = this.libs.get(libName);
    if (!lib) return undefined;
    const existing = lib.footprints.get(fpName);
    if (existing) return existing;
    if (lib.scope === 'global') {
      try {
        const text = await this.io.footprintText(lib.name, fpName);
        const fp = readFootprintFile(parse(text));
        if (!fp) return undefined;
        lib.footprints.set(fpName, fp);
        lib.original.set(fpName, fp);
        this.touch();
        return fp;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  footprintNames(libName: string): string[] {
    const lib = this.libs.get(libName);
    if (!lib) return [];
    if (lib.pendingNames.length > 0 && lib.footprints.size === 0) return [...lib.pendingNames];
    // Merge buffered names with any still-pending (unfetched) ones.
    const set = new Set<string>([...lib.footprints.keys(), ...lib.pendingNames]);
    return [...set].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  getFootprint(libName: string, fpName: string): PcbFootprint | undefined {
    return this.libs.get(libName)?.footprints.get(fpName);
  }

  footprintExists(libName: string, fpName: string): boolean {
    const lib = this.libs.get(libName);
    if (!lib) return false;
    return lib.footprints.has(fpName) || lib.pendingNames.includes(fpName);
  }

  /** Buffer an updated working copy (marks it modified). */
  updateFootprint(libName: string, fpName: string, fp: PcbFootprint): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    if (!lib.footprints.has(fpName)) lib.libModified = true;
    lib.footprints.set(fpName, fp);
    lib.modified.add(fpName);
    this.touch();
  }

  /** Rename a footprint: re-key the buffer, keep the modified mark. */
  renameFootprint(libName: string, oldName: string, newName: string, fp: PcbFootprint): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    const entries = [...lib.footprints.entries()].map(
      ([k, v]) => (k === oldName ? [newName, fp] : [k, v]) as [string, PcbFootprint],
    );
    lib.footprints = new Map(entries);
    lib.modified.delete(oldName);
    lib.modified.add(newName);
    lib.libModified = true;
    this.touch();
  }

  /** Remove a footprint from the buffer. */
  removeFootprint(libName: string, fpName: string): void {
    const lib = this.libs.get(libName);
    if (!lib) return;
    lib.footprints.delete(fpName);
    lib.modified.delete(fpName);
    lib.libModified = true;
    this.touch();
  }

  /** Revert to the as-loaded copy (or drop a never-saved one). */
  revertFootprint(libName: string, fpName: string): PcbFootprint | undefined {
    const lib = this.libs.get(libName);
    if (!lib) return undefined;
    const orig = lib.original.get(fpName);
    if (orig) lib.footprints.set(fpName, orig);
    else lib.footprints.delete(fpName);
    lib.modified.delete(fpName);
    this.touch();
    return orig;
  }

  isFootprintModified(libName: string, fpName: string): boolean {
    return this.libs.get(libName)?.modified.has(fpName) ?? false;
  }

  isLibraryModified(libName: string): boolean {
    const lib = this.libs.get(libName);
    return !!lib && (lib.libModified || lib.modified.size > 0);
  }

  hasModifications(): boolean {
    for (const name of this.libs.keys()) {
      if (this.isLibraryModified(name)) return true;
    }
    return false;
  }

  /**
   * Serialize one footprint to its `.kicad_mod` text (clears its modified mark).
   * `FootprintSave` brings a back-side footprint to the front with
   * `PCBNEW_SETTINGS::m_FlipDirection` — `editing.flip_left_right` — which the
   * Footprint Editor reads from pcbnew's settings, as `Kiface().KifaceSettings()` does.
   */
  saveFootprintText(libName: string, fpName: string): string | undefined {
    const lib = this.libs.get(libName);
    const fp = lib?.footprints.get(fpName);
    if (!lib || !fp) return undefined;
    const text = serializeFootprint(fp, {
      flipDirection: this.io.flipLeftRight()
        ? FLIP_DIRECTION.LEFT_RIGHT
        : FLIP_DIRECTION.TOP_BOTTOM,
    });
    lib.original.set(fpName, fp);
    lib.modified.delete(fpName);
    if (lib.modified.size === 0) lib.libModified = false;
    this.touch();
    return text;
  }

  /** All modified footprints of a library as `{ fileName, text }` (one per `.kicad_mod`). */
  modifiedFiles(libName: string): { fileName: string; text: string }[] {
    const lib = this.libs.get(libName);
    if (!lib) return [];
    const out: { fileName: string; text: string }[] = [];
    for (const fpName of lib.modified) {
      const text = this.saveFootprintText(libName, fpName);
      if (text !== undefined) out.push({ fileName: `${fpName}.kicad_mod`, text });
    }
    return out;
  }
}

/**
 * `FOOTPRINT_EDIT_FRAME::ImportFootprint` (`footprint_libraries_utils.cpp:83-233`),
 * the half after the file dialog: read the `.kicad_mod` text, name the
 * footprint (its own `(footprint "…")` name, else the file's), step past a
 * name the library already holds, and buffer it into `libName`. Returns the
 * name it was stored under, or null when the text held no footprint.
 *
 * Moved here from `footprint_edit_frame_ui.tsx`'s Import handler, which keeps
 * the dialog, the status line and the load onto the canvas.
 */
export function ImportFootprint(
  manager: FootprintLibraryManager,
  libName: string,
  fileName: string,
  text: string,
): string | null {
  const fp = readFootprintFile(parse(text));
  if (!fp) return null;
  let name = fp.lib || fpNameOf(fileName);
  while (manager.footprintExists(libName, name)) name = `${name}_1`;
  manager.updateFootprint(libName, name, { ...fp, lib: name });
  return name;
}

/** `FOOTPRINT_EDIT_FRAME`'s `footprint_libraries_utils.cpp` half, mixed into that class by `footprint_edit_frame.ts`. */
export class FOOTPRINT_LIBRARIES_UTILS_MIXIN {
  /**
   * `FOOTPRINT_EDIT_FRAME::SaveFootprint` (footprint_libraries_utils.cpp:706-770):
   * into its library, deleting the old name's file first when it was renamed.
   *
   * Not ported: the board-footprint branch (`SaveFootprintToBoard`, a footprint
   * with a link) and Save As for an unnamed one, which are the window's still;
   * and the legacy-library guard — every library here is a .pretty.
   */
  async SaveFootprint(this: FOOTPRINT_EDIT_FRAME, aFootprint: FOOTPRINT | null): Promise<boolean> {
    if (!aFootprint)
      // Happen if no footprint loaded
      return false;

    const padTool = this.m_toolManager?.GetTool(PAD_TOOL);

    if (padTool?.InPadEditMode()) this.m_toolManager!.RunAction(PCB_ACTIONS.recombinePad);

    const libraryName = aFootprint.GetFPID().GetLibNickname();
    const footprintName = aFootprint.GetFPID().GetLibItemName();
    const nameChanged = this.m_footprintNameWhenLoaded !== footprintName;

    if (aFootprint.GetLink() !== niluuid) {
      // Not ported: SaveFootprintToBoard. Nothing here loads a footprint off a
      // board yet (`loadFpFromBoard` is a greyed row), so no footprint has a link.
      return false;
    } else if (libraryName === '' || footprintName === '') {
      if (await this.SaveFootprintAs(aFootprint)) {
        this.m_footprintNameWhenLoaded = footprintName;
        this.SyncLibraryTree(true);
        return true;
      }

      return false;
    }

    // `manager.GetFullURI( FOOTPRINT, libraryName )`: an unknown library is no save.
    // Every library here is a .pretty, so the legacy guard has nothing to refuse.
    if (!this.FootprintLibAdapter()?.GetRow(libraryName)) return false;

    if (nameChanged) {
      const oldFPID = new LIB_ID(libraryName, this.m_footprintNameWhenLoaded);
      await this.DeleteFootprintFromLibrary(oldFPID, false);
    }

    if (!(await this.SaveFootprintInLibrary(aFootprint, libraryName))) return false;

    if (nameChanged) {
      this.m_footprintNameWhenLoaded = footprintName;
      this.SyncLibraryTree(true);
    }

    return true;
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::SaveFootprintInLibrary` (:818-850): the footprint
   * written under its item name alone, every child's flags cleared.
   */
  async SaveFootprintInLibrary(
    this: FOOTPRINT_EDIT_FRAME,
    aFootprint: FOOTPRINT,
    aLibraryName: string,
  ): Promise<boolean> {
    try {
      aFootprint.SetFPID(new LIB_ID('', aFootprint.GetFPID().GetLibItemName()));

      // Clear selected, brightened, temp flags, edit flags, the whole shebang.
      aFootprint.RunOnChildren((child) => {
        child.ClearFlags();
      }, RECURSE_MODE.RECURSE);

      this.FootprintLibAdapter()?.SaveFootprint?.(aLibraryName, aFootprint);

      aFootprint.SetFPID(new LIB_ID(aLibraryName, aFootprint.GetFPID().GetLibItemName()));

      // Not ported: setFPWatcher, the file-system watcher.
      return true;
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      DisplayErrorMessage(ioe.What());

      aFootprint.SetFPID(new LIB_ID(aLibraryName, aFootprint.GetFPID().GetLibItemName()));
      return false;
    }
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::DeleteFootprintFromLibrary` (:900-945): the file
   * out of a writable library, after asking when `aConfirm`.
   */
  async DeleteFootprintFromLibrary(
    this: FOOTPRINT_EDIT_FRAME,
    aFPID: LIB_ID,
    aConfirm: boolean,
  ): Promise<boolean> {
    if (!aFPID.IsValid()) return false;

    const adapter = this.FootprintLibAdapter();
    const nickname = aFPID.GetLibNickname();
    const fpname = aFPID.GetLibItemName();

    // `manager.GetFullURI( FOOTPRINT, nickname )`, else no delete. Every library
    // here is a .pretty, so INFO_LEGACY_LIB_WARN_DELETE has nothing to refuse.
    if (!adapter?.GetRow(nickname)) return false;

    if (!(adapter.IsFootprintLibWritable?.(nickname) ?? false)) {
      const msg = `Library '${nickname}' is read only.`;
      this.ShowInfoBarError(msg);
      return false;
    }

    // Confirmation
    const msg = `Delete footprint '${fpname}' from library '${nickname}'?`;

    if (aConfirm && !(await IsOK(msg))) return false;

    try {
      adapter.DeleteFootprint?.(nickname, fpname);
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      DisplayErrorMessage(ioe.What());
      return false;
    }

    this.SetStatusText(`Footprint '${fpname}' deleted from library '${nickname}'`);

    return true;
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::DuplicateFootprint` (:776-815): the footprint saved
   * again under the first free `<name>_<n>`, its value following its name.
   */
  async DuplicateFootprint(this: FOOTPRINT_EDIT_FRAME, aFootprint: FOOTPRINT): Promise<boolean> {
    const adapter = this.FootprintLibAdapter();

    const fpID = aFootprint.GetFPID();
    const libraryName = fpID.GetLibNickname();
    const footprintName = fpID.GetLibItemName();

    // `manager.GetFullURI( FOOTPRINT, libraryName )`, else nothing. No library
    // here is legacy, so INFO_LEGACY_LIB_WARN_EDIT is never shown.
    if (!adapter?.GetRow(libraryName)) return false;

    let i = 1;
    let newName = footprintName;

    // Append a number to the name until the name is unique in the library.
    while (adapter.FootprintExists(libraryName, newName)) newName = `${footprintName}_${i++}`;

    aFootprint.SetFPID(new LIB_ID(libraryName, newName));

    if (aFootprint.GetValue() === footprintName) aFootprint.SetValue(newName);

    return this.SaveFootprintInLibrary(aFootprint, libraryName);
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::SaveFootprintAs` (:948-1068): SAVE_AS_DIALOG until it
   * answers, then the footprint under its new name in the library chosen.
   *
   * Not ported: the dialog's New Library... button (`ID_MAKE_NEW_LIBRARY`),
   * which is `CreateNewLibrary` — File > New Library is the way in here.
   */
  async SaveFootprintAs(
    this: FOOTPRINT_EDIT_FRAME,
    aFootprint: FOOTPRINT | null,
  ): Promise<boolean> {
    if (aFootprint === null) return false;

    const adapter = this.FootprintLibAdapter();

    this.SetMsgPanel(aFootprint);

    let libraryName = aFootprint.GetFPID().GetLibNickname();
    let footprintName = aFootprint.GetFPID().GetLibItemName();
    const updateValue = aFootprint.GetValue() === footprintName;
    let footprintExists = false;

    const chosen = await this.ShowSaveAsDialog(
      footprintName,
      libraryName,
      async (newLib: string, newName: string): Promise<boolean> => {
        if (newLib === '') {
          await DisplayInfoMessage('A library must be specified.');
          return false;
        }

        if (newName === '') {
          await DisplayInfoMessage('Footprint must have a name.');
          return false;
        }

        // `manager.GetFullURI( FOOTPRINT, newLib )`, else refuse.
        if (!adapter?.GetRow(newLib)) return false;

        footprintExists = adapter.FootprintExists(newLib, newName);

        if (footprintExists) {
          const msg = `Footprint ${newName} already exists in ${newLib}.`;

          // KIDIALOG errorDlg( this, msg, _( "Confirmation" ), wxOK | wxCANCEL | wxICON_WARNING );
          // errorDlg.SetOKLabel( _( "Overwrite" ) );
          const answer = await this.AskKiDialog({
            caption: 'Confirmation',
            message: msg,
            icon: 'warning',
            labels: { ok: 'Overwrite' },
          });

          return answer === 'ok';
        }

        return true;
      },
    );

    if (!chosen) return false;

    footprintName = chosen.name;
    libraryName = chosen.library;

    aFootprint.SetFPID(new LIB_ID(libraryName, footprintName));

    if (updateValue) aFootprint.SetValue(footprintName);

    if (!(await this.SaveFootprintInLibrary(aFootprint, libraryName))) return false;

    // Once saved-as a board footprint is no longer a board footprint
    aFootprint.SetLink(niluuid);

    const msg = footprintExists
      ? `Footprint '${footprintName}' replaced in '${libraryName}'`
      : `Footprint '${footprintName}' added to '${libraryName}'`;

    this.SetStatusText(msg);
    this.UpdateTitle();
    // ReCreateHToolbar(): the window's top toolbar re-reads the frame on render.

    return true;
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::RevertFootprint` (:1191-1218): the as-loaded copy back
   * on an emptied board, after `ConfirmRevertDialog`.
   */
  async RevertFootprint(this: FOOTPRINT_EDIT_FRAME): Promise<boolean> {
    const original = this.GetOriginalFootprintCopy();

    if (this.GetScreen()?.IsContentModified() && original) {
      const msg = confirmRevertMessage(this.GetLoadedFPID().GetLibItemName());

      if (await this.ConfirmRevertDialog(msg)) {
        await this.Clear_Pcb(false);
        this.AddFootprintToBoard(original.Clone() as FOOTPRINT);

        this.Zoom_Automatique(false);

        this.Update3DView(true, true);

        this.ClearUndoRedoList();
        this.GetScreen()?.SetContentModified(false);

        this.UpdateView();
        this.GetCanvas()?.Refresh();

        return true;
      }
    }

    return false;
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::ImportFootprint( aName )` (:83-233): a footprint file
   * of any format a plugin can read, onto the board — not into a library. It
   * is unnamed until it is saved.
   */
  async ImportFootprint(this: FOOTPRINT_EDIT_FRAME): Promise<FOOTPRINT | null> {
    // Prompt the user for a footprint file to open.
    const file = await this.ShowImportFootprintDialog();

    if (!file) return null;

    const footprintName = { value: '' };
    let footprint: FOOTPRINT | null = null;

    // PCB_IO_KICAD_SEXPR registers first upstream; ours is not a PCB_IO yet
    // (pcb_io_mgr.ts), so its one footprint file is read here directly.
    if (file.path.toLowerCase().endsWith(`.${KiCadFootprintFileExtension}`)) {
      try {
        footprint = ParseFootprintFile(file.text, file.path);
        footprintName.value = footprint.GetFPID().GetLibItemName() || fpNameOf(file.path);
      } catch (ioe) {
        DisplayErrorMessage((ioe as Error).message);
        return null;
      }
    } else {
      const bytes = new TextEncoder().encode(file.text);
      const readFile = (aPath: string): Uint8Array | null => (aPath === file.path ? bytes : null);
      let fileType = PCB_FILE_T.FILE_TYPE_NONE;

      for (const plugin of PLUGIN_REGISTRY.Instance().AllPlugins()) {
        const pi = await plugin.m_createFunc();

        if (pi.GetLibraryFileDesc().m_FileExtensions.length === 0) continue;

        pi.SetFileReader(readFile);

        if (pi.CanReadFootprint(file.path)) {
          fileType = plugin.m_type;
          break;
        }
      }

      if (fileType === PCB_FILE_T.FILE_TYPE_NONE) {
        DisplayErrorMessage('Not a footprint file.');
        return null;
      }

      try {
        const pi = await PCB_IO_MGR.FindPlugin(fileType)!;
        pi.SetFileReader(readFile);

        footprint = pi.ImportFootprint(file.path, footprintName);

        if (!footprint) {
          DisplayErrorMessage(
            `Unable to load footprint '${footprintName.value}' from '${file.path}'`,
          );
          return null;
        }
      } catch (ioe) {
        if (!(ioe instanceof IO_ERROR)) throw ioe;

        DisplayErrorMessage(ioe.What());

        // if the footprint is not loaded, exit.
        if (!footprint) return null;
      }
    }

    this.m_mruPath = file.path.split('/').slice(0, -1).join('/');

    footprint.SetFPID(new LIB_ID('', footprintName.value));

    // Insert footprint in list
    this.AddFootprintToBoard(footprint);

    // Display info :
    this.SetMsgPanel(footprint);
    this.PlaceFootprint(footprint);

    footprint.SetPosition({ x: 0, y: 0 });

    this.GetBoard()!.BuildListOfNets();
    this.UpdateView();

    return footprint;
  }

  /**
   * `FOOTPRINT_EDIT_FRAME::ExportFootprint` (:236-305): the footprint as a
   * `.kicad_mod` where the save dialog says, then "Footprint exported to file".
   */
  async ExportFootprint(this: FOOTPRINT_EDIT_FRAME, aFootprint: FOOTPRINT | null): Promise<void> {
    if (!aFootprint) return;

    const fileName = `${aFootprint.GetFPID().GetLibItemName()}.${KiCadFootprintFileExtension}`;

    const dlg = await this.ShowSaveFileDialog(
      'Export Footprint',
      fileName,
      kicadFootprintLibWildcard(),
    );

    if (!dlg) return;

    const path = EnsureFileExtension(dlg.path, KiCadFootprintFileExtension);

    // Not ported: `cfg->m_LastExportPath`, which fpedit.json does not carry here.

    // Export as *.kicad_pcb format, using a strategy which is specifically chosen
    // as an example on how it could also be used to send it to the system clipboard.
    let prettyData: string;

    try {
      prettyData = FormatFootprintForLibrary(aFootprint);
    } catch (ioe) {
      if (!(ioe instanceof IO_ERROR)) throw ioe;

      DisplayErrorMessage(ioe.What());
      return;
    }

    if (!this.WriteTextFile(path, prettyData)) {
      DisplayErrorMessage(`Insufficient permissions to write file '${path}'.`);
      return;
    }

    await DisplayInfoMessage(`Footprint exported to file '${path}'.`);
  }
}
