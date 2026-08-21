// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { MenuBar, type Menu } from '../ui/MenuBar.js';
import {
  storageAvailable,
  listProjects,
  saveProject,
  loadProject,
  deleteProject,
  renameProject,
  touchOpened,
  type ProjectMeta,
} from './projectStore.js';
import { useAuth } from '../auth/AuthProvider.js';
import { authEnabled } from '../auth/supabaseClient.js';
import { SignInDialog } from '../auth/SignIn.js';
import {
  syncAllProjects,
  pushProject,
  deleteCloudProject,
  forgetDamagedProject,
} from '../cloud/sync.js';
import type { SyncResult } from '../cloud/sync.js';
import { syncTemplates as syncUserTemplates } from '../cloud/cloudStore.js';
import { LoadingOverlay, nextPaint } from '../ui/LoadingOverlay.js';
import type { ProgressSnapshot } from '../ui/progress_reporter.js';
import {
  loadTemplates,
  createFromTemplate,
  templateSourceFiles,
  renameRel as renameTemplateRel,
  type TemplateMeta,
} from './templates.js';
import {
  deleteUserTemplate,
  duplicateTemplate,
  listUserTemplates,
  userTemplateFiles,
} from './user_templates.js';
import { demoAt, fetchDemoExtras, loadDemos, openDemo, type DemoMeta } from './demos.js';
import '../ui/shell.css';
import type { PickedHomeFile } from './files.js';
import {
  EMPTY_PCB,
  copyProjectFiles,
  newProjectFiles,
  sanitizeProjectName,
} from './new_project.js';
import {
  buildDirTree,
  deleteTreeEntries,
  isViewableTextFile,
  renameTreeEntry,
  treeIconFor,
  isHiddenFile,
  inArchiveAllowList,
  basename,
  type DirNode,
} from './project_tree.js';

export type { PickedHomeFile } from './files.js';
import { archiveEntries, zipArchive, expandArchive } from './project_archiver.js';
import { AboutDialog } from './dialogs/dialog_about.js';
import { showHotkeyList } from '../ui/hotkey_list_action.js';
import { TextViewerDialog } from './dialogs/dialog_text_viewer.js';
import { buildManagerMenus } from './menubar.js';
import { useMenuHotkeys } from '../ui/useMenuHotkeys.js';
import { PreferencesDialog } from '../dialogs/PreferencesDialog.js';
import { settings } from '../prefs/settings.js';
import { useCommonSettings } from '../prefs/useSettings.js';
import { TemplateSelectorDialog } from './dialogs/dialog_template_selector.js';
import { type ChooserPlace, FileChooser } from '../fs/FileChooser.js';
import { listFileSystem } from '../fs/list_fs.js';
import { projectAt, projectStoreFileSystem } from '../fs/project_store_fs.js';
import { NEW_PROJECT_FOLDER_FILTERS, OPEN_PROJECT_FILTERS } from '../fs/wildcards.js';
import { projectNameFrom } from './dialogs/template_selector.js';
import { basename as pathBasename } from '../fs/path.js';
import { EllipsizedField } from '../ui/EllipsizedField.js';
import { KiStatusBar } from '../ui/KiStatusBar.js';
import { buttonTooltipFor, tooltipFor } from '../ui/Tooltip.js';
import { ProjectTreePane, mgrUrl } from './project_tree_pane.js';
import { LocalHistoryPane } from './LocalHistoryPane.js';
import {
  deleteProjectHistory,
  listSnapshots,
  onHistoryChanged,
  recordSnapshot,
  restoreSnapshot,
} from './local_history_store.js';
import { RestoreLocalHistoryDialog } from './dialog_restore_local_history.js';
import {
  RESTORE_CAPTION,
  RESTORE_EXTENDED,
  RESTORE_NO_LABEL,
  RESTORE_YES_LABEL,
  restoreConfirmMessage,
  type Snapshot,
} from './local_history.js';
import { MessageDialogYesNo } from '../ui/dialog_message.js';

import {
  filesFromFileList,
  walkDirectoryHandle,
  walkDroppedEntries,
  type DirHandle,
  type DropEntry,
  type IngestFile,
} from './project_picker.js';

const dec = new TextDecoder();
const enc = new TextEncoder();

/** One project that would not sync, as reported by `syncAllProjects`. */
type SyncFailure = SyncResult['failures'][number];

// KiCad's own dark-theme icons (GPL), vendored under assets/.
const TILE_ICONS = import.meta.glob('../assets/launcher/*.svg', {
  query: '?url',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const tileUrl = (id: string): string | undefined => TILE_ICONS[`../assets/launcher/${id}.svg`];

interface Tile {
  id: string;
  name: string;
  /** The help line printed under the title (CreateLaunchers' aHelpText). */
  desc: string;
  /** The action's own `.Tooltip(...)`, which is what the tooltip shows -
   *  a different string from the help line, and the one we were missing. */
  tip: string;
  /** `.DefaultHotkey(...)`; GetTooltip() appends it in parentheses. */
  hotkey?: string;
}

// PANEL_KICAD_LAUNCHER::CreateLaunchers(), in order, with each launcher's help
// string verbatim. Upstream passes these as TOOL_ACTION friendly names plus a
// _( "..." ) help line; the only one it ever disables is the plugin manager,
// and only when the PCM admin policy is off.
const TILES: Tile[] = [
  {
    id: 'schematic',
    name: 'Schematic Editor',
    desc: 'Edit the project schematic',
    tip: 'Edit schematic in schematic editor',
    hotkey: 'Ctrl+E',
  },
  {
    id: 'symbols',
    name: 'Symbol Editor',
    desc: 'Edit global and/or project schematic symbol libraries',
    tip: 'Create, delete and edit schematic symbols',
    hotkey: 'Ctrl+L',
  },
  {
    id: 'pcb',
    name: 'PCB Editor',
    desc: 'Edit the project PCB design',
    tip: 'Edit PCB in PCB editor',
    hotkey: 'Ctrl+P',
  },
  {
    id: 'footprints',
    name: 'Footprint Editor',
    desc: 'Edit global and/or project PCB footprint libraries',
    tip: 'Create, delete and edit PCB footprints',
    hotkey: 'Ctrl+F',
  },
  {
    id: 'gerber',
    name: 'Gerber Viewer',
    desc: 'Preview Gerber files',
    tip: 'Preview Gerber output files',
    hotkey: 'Ctrl+G',
  },
  {
    id: 'image',
    name: 'Image Converter',
    desc: 'Convert bitmap images to schematic symbols or PCB footprints',
    tip: 'Convert bitmap images to schematic or PCB components',
    hotkey: 'Ctrl+B',
  },
  {
    id: 'calculator',
    name: 'Calculator Tools',
    desc: 'Show tools for calculating resistance, current capacity, etc.',
    tip: 'Run component calculations, track width calculations, etc.',
  },
  {
    id: 'drawingsheet',
    name: 'Drawing Sheet Editor',
    desc: 'Edit drawing sheet borders and title blocks for use in schematics and PCB designs',
    tip: 'Edit drawing sheet borders and title block',
    hotkey: 'Ctrl+Y',
  },
  // Upstream's 9th launcher, showPluginManager, is deliberately absent: the
  // plugin/content manager still needs a lot of work and ships after the
  // web-app launch. It was here greyed out with a "coming soon" badge, which
  // is a tell no KiCad frame has - a disabled launcher upstream means the PCM
  // *policy* is off, and it never grows extra chrome. Better to show eight
  // launchers that all work than nine where one is visibly ours.
];

// KiCad project-manager left toolbar (toolbars_kicad_manager.cpp). "Browse
// Project Files" is dropped: a browser can't open the OS file manager, and the
// left panel already is the project tree.
type MgrAction = 'open' | 'new' | 'archive' | 'unarchive' | 'refresh';
interface MgrTool {
  icon: string;
  /** TOOL_ACTION::GetFriendlyName(). */
  name: string;
  action: MgrAction;
  hotkey?: string;
  /** TOOL_ACTION::Tooltip(); absent on openProject upstream. */
  tip?: string;
}
const MGR_TOOLS: (MgrTool | 'sep')[] = [
  // KICAD_MANAGER_ACTIONS::newProject is .Icon( BITMAPS::new_project_from_template )
  // - not new_project, which is the plain notepad-and-sparkle with no badge.
  {
    icon: 'new_project_from_template',
    name: 'New Project...',
    action: 'new',
    // Ctrl+N upstream; the browser keeps that one. See BROWSER_REBINDS.
    hotkey: 'Ctrl+Alt+N',
    tip: 'Create a new project based on an existing project',
  },
  { icon: 'open_project', name: 'Open Project...', action: 'open', hotkey: 'Ctrl+O' },
  'sep',
  {
    icon: 'zip',
    name: 'Archive Project...',
    action: 'archive',
    tip: 'Archive all project files',
  },
  {
    icon: 'unzip',
    name: 'Unarchive Project...',
    action: 'unarchive',
    tip: 'Unarchive project files from zip archive',
  },
  // The Refresh button is ACTIONS::zoomRedraw, not a manager action - the same
  // action View > Refresh runs, so it answers to the same key. It advertised
  // Ctrl+R while the menu advertised F5: one action, two promises, and Ctrl+R
  // is upstream's macOS binding rather than the general one.
  //     #if defined( __WXMAC__ ) .DefaultHotkey( MD_CTRL + 'R' )
  //     #else                    .DefaultHotkey( WXK_F5 )
  { icon: 'refresh', name: 'Refresh', action: 'refresh', hotkey: 'F5' },
];

// KiCad's own "default" template, seeded into the user template directory as
// `default/` with a lone default.kicad_pro and a meta/info.html. It is imported
// with the rest by tools/templates/import.mjs, so there is no synthetic entry
// here any more - it is a real template like every other one in the list.
const DEFAULT_TEMPLATE_ID = 'default';

const tileIcon = (id: string): JSX.Element => {
  const url = tileUrl(id);
  return url ? <img src={url} alt="" /> : <span style={{ width: 44, height: 44 }} />;
};

/**
 * KiCad-style project manager: open a project folder, see its files in the
 * tree, then launch an editor on it, the same workflow as the desktop app's
 * project window. Until a project is opened, the tree shows open/select/drop
 * hints; bundled demos are under File > Open Demo Project.
 */
export function HomePage({
  onOpenSchematic,
  onOpenProject,
  onOpenPcb,
  onOpenSymbolEditor,
  onOpenFootprintEditor,
  onOpenCalculator,
  onOpenDrawingSheetEditor,
  onOpenImageConverter,
  onOpenGerberViewer,
  initialFiles,
  activePro,
  onSwitchProject,
}: {
  onOpenSchematic: () => void;
  onOpenProject?: (
    files: PickedHomeFile[],
    startFile?: string,
    /** The demo this came from, when it is one: not saved until copied. */
    demo?: DemoMeta | null,
  ) => void;
  onOpenPcb?: (file: PickedHomeFile, files?: PickedHomeFile[]) => void;
  /** Launch the Symbol Editor (with the open project's libraries, if any).
   *  `startFile` is a `.kicad_sym` to open straight away (KiCad's MAIL_LIB_EDIT). */
  onOpenSymbolEditor?: (files?: PickedHomeFile[], startFile?: string) => void;
  /** Launch the Footprint Editor (with the open project's `.pretty` libraries, if any).
   *  `startFile` is a `.kicad_mod` to open straight away (KiCad's MAIL_FP_EDIT). */
  onOpenFootprintEditor?: (files?: PickedHomeFile[], startFile?: string) => void;
  /** Launch the Calculator Tools (standalone, no project needed). */
  onOpenCalculator?: () => void;
  /** Launch the Drawing Sheet Editor (pl_editor); a standalone tool. */
  onOpenDrawingSheetEditor?: (file?: PickedHomeFile) => void;
  /** Launch the Image Converter (bitmap2cmp); a standalone tool. */
  onOpenImageConverter?: () => void;
  /** Launch the Gerber Viewer (gerbview); a standalone tool. */
  onOpenGerberViewer?: () => void;
  /** A project already open in the app: keep it in the tree on return to home. */
  initialFiles?: PickedHomeFile[] | null;
  /** The active project's .kicad_pro (full name) when a folder holds several. */
  activePro?: string;
  /** Switch the active project (double-clicking another .kicad_pro in the tree). */
  onSwitchProject?: (proFullName: string) => void;
}): JSX.Element {
  const { session, signOut } = useAuth();
  // Guest-first: sign-in is offered, never forced. The dialog opens from the
  // header button or the local-only nudge; the nudge shows once the guest has
  // real work at stake (a saved project) and stays dismissed once closed.
  const [signInOpen, setSignInOpen] = useState(false);
  const [guestNudgeDismissed, setGuestNudgeDismissed] = useState(() => {
    try {
      return localStorage.getItem('ziro.guestNudgeDismissed') === '1';
    } catch {
      return false;
    }
  });
  const dismissGuestNudge = (): void => {
    setGuestNudgeDismissed(true);
    try {
      localStorage.setItem('ziro.guestNudgeDismissed', '1');
    } catch {
      /* storage blocked, dismiss for this session only */
    }
  };
  const dirInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  // The picked project's files (shown in the tree until the editor is launched).
  const [picked, setPicked] = useState<PickedHomeFile[] | null>(initialFiles ?? null);
  /**
   * Whether what is open came from the demo library.
   *
   * A demo is not the user's project: it is not written to the store, so
   * nothing it edits is kept until they save a copy of it, which is how KiCad
   * treats the demos in its read-only stock folder. Reset in `ingest`, the
   * funnel every open goes through, so it cannot survive into the next project
   * opened after a demo.
   */
  const [demoOpen, setDemoOpen] = useState(false);
  /** The open demo's manifest, so saving a copy can complete it. */
  const [demoSource, setDemoSource] = useState<DemoMeta | null>(null);
  // Saved projects (IndexedDB), the offline half of cloud persistence.
  const [saved, setSaved] = useState<ProjectMeta[]>([]);
  // Expanded directory-tree folder paths (collapsed by default, like KiCad).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Selected tree row (single click). Double click opens, like KiCad's tree.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectPath = (path: string, additive: boolean): void =>
    setSelected((prev) => {
      if (!additive) return new Set([path]);
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });
  // Whether the project root node is expanded (its twisty collapses the tree).
  const [rootOpen, setRootOpen] = useState(true);
  /**
   * Whether View > Panels > Local History is checked.
   *
   * Upstream persists it - the pane is an AUI pane and the perspective is
   * saved with the frame - so it is remembered rather than reset on every
   * load. Off by default, as an unopened AUI pane is.
   */
  const [historyShown, setHistoryShown] = useState<boolean>(
    () => localStorage.getItem('ziroeda.localHistoryShown') === '1',
  );
  useEffect(() => {
    localStorage.setItem('ziroeda.localHistoryShown', historyShown ? '1' : '0');
  }, [historyShown]);
  /** The snapshot "Restore Commit" was asked for, while its confirmation is up. */
  const [restoring, setRestoring] = useState<Snapshot | null>(null);
  /** DIALOG_RESTORE_LOCAL_HISTORY, the File-menu route to the same restore. */
  const [restoreListOpen, setRestoreListOpen] = useState(false);
  /** `LoadSnapshots`, kept so the File menu can honour `HistoryExists`. */
  const [history, setHistory] = useState<Snapshot[]>([]);

  // Chrome dialogs: About, read-only text viewer, Preferences.
  const [aboutOpen, setAboutOpen] = useState(false);
  const [textView, setTextView] = useState<PickedHomeFile | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  // Open Project puts up the file chooser — the same window every other
  // wxFileDialog call site will, over the account's tree rather than a disk.
  const [openPrjOpen, setOpenPrjOpen] = useState(false);
  // One instance for the life of the page: the chooser reloads on every
  // navigation, and a new object each render would restart that reload.
  const accountFs = useMemo(() => projectStoreFileSystem(), []);
  /**
   * The chooser's places sidebar.
   *
   * GTK's is Home / Desktop / Documents / Downloads / Other Locations, which
   * are places on a computer. Ours are the four the account actually has, and
   * three of them are listings rather than folders of the tree — the same split
   * GTK has between Documents and `recent:///`, so they arrive as read-only
   * `listFileSystem`s. Only "Projects" is the real tree, which is why it is the
   * one place a project can be created, renamed or deleted in.
   *
   * The icons are KiCad's own: BITMAPS::recent is what `Open Recent` carries
   * (kicad/menubar.cpp:73), open_project and open_project_demo are
   * KICAD_MANAGER_ACTIONS::openProject and ::openDemoProject
   * (kicad/tools/kicad_manager_actions.cpp:74 and :66), and
   * new_project_from_template is the template action's.
   */
  // The demo and template lists load asynchronously and are state further down.
  // A listing filesystem is built once — rebuilding it would restart the
  // chooser's reload on every render — so it reads the current lists through a
  // ref rather than closing over the value it was built with.
  const demosRef = useRef<readonly DemoMeta[]>([]);
  const templatesRef = useRef<readonly TemplateMeta[]>([]);
  // Recent owns only the order of its top level: its rows *are* the account's
  // projects, at the same paths, so everything below the root is the account's
  // tree and is delegated to it. That is what makes walking into a recent
  // project show its files instead of an empty folder.
  const recentFs = useMemo(
    () =>
      listFileSystem(
        async () => ({
          files: (await listProjects())
            .filter((p) => p.lastOpenedAt !== undefined)
            .map((p) => ({
              name: p.name,
              // A project is a folder and a folder shows no size; `bytes` is
              // the compressed size on disk, which is not what its row shows.
              size: 0,
              modified: p.lastOpenedAt ?? p.updatedAt,
            })),
        }),
        { below: accountFs },
      ),
    [accountFs],
  );
  // A demo's id is a path — `simulation/amplifier_ac` — and it carries the list
  // of files it is made of, so Demos is a real tree: the `simulation` folder
  // the demos directory has and the Open Demo Project menu groups by
  // (menubar.ts's buildDemoSubmenu splits on the very same prefix), the demo
  // project inside it, and that project's own files inside that. `projects`
  // says which of the derived folders are the demos themselves, since nothing
  // about `simulation/amplifier_ac` distinguishes it from `simulation`.
  const demosFs = useMemo(
    () =>
      listFileSystem(
        async () => ({
          // The manifest names the files a demo is made of, not their sizes or
          // when they were written - those bytes are on the CDN until the demo
          // is opened. So both columns say nothing rather than `0 bytes` and
          // `Jan 1, 1970`, which read as data the listing does not have.
          files: demosRef.current.flatMap((d) =>
            d.files.map((rel) => ({ name: `${d.id}/${rel}`, size: null, modified: null })),
          ),
          projects: new Set(demosRef.current.map((d) => `/${d.id}`)),
        }),
        { leafKind: 'file' },
      ),
    [],
  );
  // A template's manifest carries no file list, so a template is a leaf: there
  // is nothing to show inside one, and the place says so rather than offering
  // a folder that opens empty.
  const templatesFs = useMemo(
    () =>
      listFileSystem(async () => ({
        files: templatesRef.current.map((t) => ({ name: t.id, size: null, modified: null })),
      })),
    [],
  );
  // Accepting in a place that browses its own tree cannot go to the account's
  // handler: `/simulation/amplifier_ac/amplifier_ac.kicad_pro` names a demo, and
  // `projectAt` reads the first segment as a project of the store, finds no
  // project called `simulation`, and returns null — the window closed and
  // nothing opened. Upstream has no such split to fall down: OpenDemoProject is
  // `openProject( PATHS::GetStockDemosPath() )`, the same dialog and the same
  // LoadProject as Open Project (kicad_manager_control.cpp:519). So each place
  // carries what accepting inside it means, through a ref for the same reason
  // its filesystem does: the places are built once and must not be rebuilt.
  const openDemoRef = useRef<(id: string) => void>(() => {});
  const openTemplateRef = useRef<(t: TemplateMeta) => void>(() => {});
  const chooserPlaces = useMemo<readonly ChooserPlace[]>(
    () => [
      // Recent first, as GtkPlacesSidebar puts it: it is the row above Home in
      // the capture, and it is the one a person reaches for most.
      { id: 'recent', label: 'Recent', icon: 'recent', fs: recentFs },
      { id: 'projects', label: 'Projects', icon: 'open_project' },
      {
        id: 'demos',
        label: 'Demos',
        icon: 'open_project_demo',
        fs: demosFs,
        // Any path inside a demo opens that demo, the way any path inside a
        // project of the account opens that project — a demo's id is the folder
        // it lives in, so the demo is the one whose id the path starts with.
        onAccept: (path) => {
          const d = demoAt(path, demosRef.current);
          if (d) openDemoRef.current(d.id);
        },
      },
      {
        id: 'templates',
        label: 'Templates',
        icon: 'new_project_from_template',
        fs: templatesFs,
        // A template has no listable contents, so a double-click takes it
        // rather than walking into an empty folder.
        activateOpens: true,
        // And taking one means what the template selector's "open" means: a
        // copy under the template's own name, so the original stays read-only.
        onAccept: (path) => {
          const t = templatesRef.current.find((x) => path === `/${x.id}`);
          if (t) openTemplateRef.current(t);
        },
      },
    ],
    [recentFs, demosFs, templatesFs],
  );
  // New Project / New from Template (upstream v10: one template selector).
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  // NewProject is two windows upstream: the template selector, then the
  // "New Project Folder" file dialog. `tplStep` is which one is up, and
  // `tplChosen` is what the first one returned - upstream keeps it in
  // `selectedTemplatePath` across the same gap.
  const [tplStep, setTplStep] = useState<'none' | 'template' | 'name'>('none');
  const [tplChosen, setTplChosen] = useState<TemplateMeta | null>(null);
  /** settings->m_RecentTemplates: template ids, newest first. */
  const [recentTemplates, setRecentTemplates] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('ziro.recentTemplates');
      const ids: unknown = raw ? JSON.parse(raw) : null;
      if (Array.isArray(ids)) return ids.filter((x): x is string => typeof x === 'string');
    } catch {
      /* storage blocked or the value is not ours */
    }
    return [];
  });
  useEffect(() => {
    try {
      localStorage.setItem('ziro.recentTemplates', JSON.stringify(recentTemplates));
    } catch {
      /* storage blocked; recents just won't survive the reload */
    }
  }, [recentTemplates]);
  /**
   * The project names already in use, lowercased.
   *
   * `ingest` reuses an existing record of the same name so that reopening a
   * folder updates it instead of piling up duplicates - which is right for
   * reopening and wrong for creating, where it silently replaced the project
   * that was already there. The selector refuses a taken name rather than
   * letting it reach that path.
   */
  const takenProjectNames = useMemo(() => new Set(saved.map((p) => p.name.toLowerCase())), [saved]);
  /**
   * BuildTemplateList scans both roots every time, and RefreshTemplateList
   * re-runs it whenever the watcher sees the directories change. Duplicating or
   * deleting is that change here, so the list is rebuilt from both sources.
   */
  const refreshTemplates = useCallback(async (): Promise<void> => {
    const [bundled, mine] = await Promise.all([loadTemplates(), listUserTemplates()]);
    setTemplates([...bundled, ...mine]);
  }, []);
  useEffect(() => {
    void refreshTemplates();
  }, [refreshTemplates]);
  /** onDuplicateTemplate, once its wxTextEntryDialog has a name. */
  const duplicateTpl = async (source: TemplateMeta, newId: string): Promise<void> => {
    await duplicateTemplate(source, newId, async (t) => {
      const files =
        t.source === 'user' ? await userTemplateFiles(t.id) : await templateSourceFiles(t);
      return files.map((f) => ({ name: f.name, bytes: f.bytes! }));
    });
    await refreshTemplates();
  };
  // Bundled demo projects (File > Open Demo Project).
  const [demos, setDemos] = useState<DemoMeta[]>([]);
  useEffect(() => {
    void loadDemos().then(setDemos);
  }, []);
  // Keep the chooser's Demos and Templates places current. They are built once
  // and read these refs, so this is what makes a late-arriving list show up.
  useEffect(() => {
    demosRef.current = demos;
  }, [demos]);
  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);
  /**
   * Delete the cloud rows that cannot be recovered.
   *
   * Destructive, so it asks first and names what it is removing. What it deletes
   * is a row whose blobs are absent from storage and whose history holds no
   * intact version: it cannot be downloaded by this or any other client, and
   * keeping it costs the user the same error on every sign-in.
   */
  const removeUnrecoverable = async (failures: SyncFailure[]): Promise<void> => {
    const doomed = failures.filter((f) => f.unrecoverable);
    if (doomed.length === 0) return;
    const ok = window.confirm(
      `Remove ${doomed.length} damaged project${doomed.length === 1 ? '' : 's'} from the cloud?\n\n` +
        'Their files are missing from storage and no earlier version is intact, so ' +
        'they cannot be opened on any device. Anything still on this device is left alone.',
    );
    if (!ok) return;
    const failed: string[] = [];
    for (const f of doomed) {
      try {
        // The row only: see `forgetDamagedProject`.
        await forgetDamagedProject(f.id);
      } catch (e) {
        failed.push(f.message);
        console.warn(`Could not remove damaged project ${f.id}:`, e);
      }
    }
    refreshSaved();
    setSyncState(
      failed.length > 0 ? { failures: failures.filter((f) => failed.includes(f.message)) } : null,
    );
  };

  const openDemoProject = async (id: string): Promise<void> => {
    const d = demos.find((x) => x.id === id);
    if (!d) return;
    // Demos open as themselves and are not persisted — see the `ingest(…, false)`
    // below and the reason written there. So an opened demo shows up under
    // neither Projects nor Recent, both of which list the account's store;
    // keeping one is Save As. (This comment used to say the opposite — that a
    // demo persists "so it lands in Recent". It never did.) The files stream
    // from the hosted CDN, so show a per-file download gauge while they arrive.
    setLoading({ message: `Downloading demo: ${d.title}`, value: 0 });
    let files: PickedHomeFile[];
    try {
      files = await openDemo(d, (done, total, file) =>
        setLoading({
          message: `Downloading demo: ${d.title}`,
          detail: `${file}, ${done} of ${total} files`,
          value: done / total,
        }),
      );
    } catch (e) {
      // A demo is fetched over the network. Without this the throw escaped an
      // async handler and the card simply did nothing when clicked.
      window.alert(`Could not open that demo: ${e instanceof Error ? e.message : String(e)}`);
      return;
    } finally {
      setLoading(null);
    }
    if (files.length === 0) return;
    // Not persisted: a demo is something to look at and try, not a project in
    // the user's account, and copying every one they open into it (and then up
    // to their cloud storage, 46 MB for the CM5 carrier) is not what opening a
    // demo asks for. Editing still works; saving a copy is what keeps it.
    await ingest(
      files.map((f) => ({ name: f.name, bytesOf: async () => f.bytes! })),
      false,
    );
    setDemoOpen(true);
    // The 3D bodies and the datasheet are not fetched at all. They are 40.7 MB
    // of the CM5 carrier's 46 MB and nothing reads them to show a schematic or
    // a board, so downloading them in the background to look at a demo is the
    // same waste as downloading them up front, just less visible. They are
    // fetched when the user keeps the project, in `saveDemoCopy`.
    setDemoSource(d);
  };
  /**
   * Project-tree pane width (px), draggable like KiCad's wxAUI sash.
   *
   * The first-run width **on screen is 250**, even though the settings file
   * says 200. Measured 2026-08-19 against a fresh `KICAD_CONFIG_HOME`: the pane
   * renders x34..x283 inclusive of its borders — 250 px — while
   * `10.0/kicad.json` holds `"left_frame_width": 200` both on first write and
   * on exit. The settings number never described what is drawn, so matching it
   * (as we did) made our pane visibly narrower than KiCad's.
   *
   * Why they differ: the pane is added with `.MinSize( m_leftWinWidth, -1 )`
   * (the 200 just loaded) and laid out, and only *then*
   *
   *     m_auimgr.Update();
   *     // "Now the actual m_projectTreePane size is set, give it a reasonable min width"
   *     m_auimgr.GetPane( m_projectTreePane ).MinSize( defaultLeftWinWidth, FromDIP( 80 ) );
   *
   * raises the minimum to 250 (kicad_manager_frame.cpp:272-274). The next
   * layout enforces it, so the user sees 250 and every later drag is floored
   * there. KICAD_MANAGER_FRAME opens with
   *
   *     const int defaultLeftWinWidth = FromDIP( 250 );
   *     m_leftWinWidth = defaultLeftWinWidth;   // "Default value"
   *
   * but then calls `LoadSettings( config() )` (line 216) *before* it builds the
   * pane (line 239), and LoadSettings ends `m_leftWinWidth =
   * settings->m_LeftWinWidth` — whose PARAM default is 200
   * (kicad_settings.cpp: `"appearance.left_frame_width", &m_LeftWinWidth, 200`).
   * So the 250 is overwritten before anything reads it, and only survives as the
   * pane's post-layout MinSize. Confirmed against the app: a fresh
   * KICAD_CONFIG_HOME writes `"left_frame_width": 200` on startup and saves the
   * same 200 back on exit.
   *
   * Every later run reads it back:
   *
   *     m_leftWinWidth = settings->m_LeftWinWidth;            // LoadSettings
   *     settings->m_LeftWinWidth = m_projectTreePane->GetSize().x;  // SaveSettings
   *
   * localStorage is this app's KICAD_SETTINGS.
   */
  const [panelWidth, setPanelWidth] = useState(() => {
    try {
      // Clamped to the sash's own range, so a hand-edited or stale value can
      // never leave the pane wider than the window or too narrow to hit. 250 is
      // the floor because that is the pane's post-layout MinSize upstream, which
      // is also what a first run renders.
      const saved = Number(localStorage.getItem('ziro.leftWinWidth'));
      if (Number.isFinite(saved) && saved >= 250 && saved <= 600) return saved;
    } catch {
      /* storage blocked: fall through to the first-run default */
    }
    return 250;
  });
  /**
   * Height of the Local History pane, or null for the even split two panes get
   * when they share a dock row. AUI puts a draggable sash between them; this is
   * that sash's state.
   */
  const [historyHeight, setHistoryHeight] = useState<number | null>(null);
  const leftDockRef = useRef<HTMLDivElement>(null);
  const startHistoryResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startY = e.clientY;
    const dock = leftDockRef.current;
    const startH = historyHeight ?? (dock ? (dock.clientHeight - 5) / 2 : 300);
    const onMove = (ev: MouseEvent): void => {
      const dockH = dock?.clientHeight ?? 0;
      // Both panes keep a floor, the way a dock refuses to collapse a pane.
      setHistoryHeight(Math.max(60, Math.min(dockH - 80, startH - (ev.clientY - startY))));
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'row-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Non-null while opening/saving a project, drives KiCad's "Load Schematic"
  // style progress overlay (message + optional gauge) so the UI doesn't look
  // frozen mid-load.
  const [loading, setLoading] = useState<string | ProgressSnapshot | null>(null);
  // Cloud sync status pill (non-blocking, bottom-right): transfers done/total
  // while projects reconcile on sign-in, then a brief "synced" confirmation.
  const [syncState, setSyncState] = useState<
    { done: number; total: number } | { failures: SyncFailure[] } | { healed: number } | null
  >(null);
  const refreshSaved = (): void => {
    if (storageAvailable()) void listProjects().then(setSaved);
  };
  useEffect(refreshSaved, []);

  // Sign-in (or session restore): pull the user's cloud projects into the local
  // store and push any local-only ones up, then refresh the list.
  const userId = session?.user.id;
  useEffect(() => {
    if (!userId || !storageAvailable()) return;
    let cancelled = false;
    void syncAllProjects(userId, (done, total) => {
      // Refresh the list as projects land so pulled ones appear immediately,
      // not only after the whole reconcile finishes.
      if (!cancelled) {
        setSyncState({ done, total });
        if (done > 0) refreshSaved();
      }
    })
      .then(async (r) => {
        if (cancelled) return;
        refreshSaved();
        // Templates ride the same account, through the same blob store, but a
        // separate index object (templateSync.ts). Awaited after the projects
        // rather than beside them so a template failure cannot mask a project
        // one, and swallowed: a template that will not sync is worth a console
        // line, not a red banner over the user's projects.
        try {
          const t = await syncUserTemplates(userId);
          if (!cancelled && t.pulled > 0) await refreshTemplates();
        } catch (e) {
          console.warn('Template sync failed:', e);
        }
        // A failure has to stay on screen. The previous version logged to the
        // console and then showed the success tick regardless, so a sync in
        // which every project failed was indistinguishable from a clean one.
        if (r.failures.length > 0) {
          for (const f of r.failures) console.warn(`Cloud ${f.direction} failed:`, f.message);
          setSyncState({ failures: r.failures });
          return;
        }
        // `healed` is a repair, not a save: a cloud copy that could not be
        // downloaded by anything has been replaced with this machine's. Worth
        // saying, because the user has been watching those projects fail.
        setSyncState({ healed: r.healed });
        setTimeout(() => {
          if (!cancelled) setSyncState(null);
        }, 2500);
      })
      .catch((e: unknown) => {
        // The reconcile itself could not run (offline, or the project list was
        // unreadable). Individual transfer failures come back in `failures`.
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        console.warn('Cloud sync failed:', message);
        setSyncState({ failures: [{ id: '', direction: 'pull', message }] });
      });
    return () => {
      cancelled = true;
    };
    // refreshTemplates is a useCallback with no dependencies of its own, so
    // naming it here is free: the effect still runs once per sign-in.
  }, [userId, refreshTemplates]);

  // Derive a project name from the .kicad_pro (else the root .kicad_sch, else folder).
  const projectNameOf = (files: PickedHomeFile[]): string => {
    const pro = files.find((f) => /\.kicad_pro$/i.test(f.name));
    const src =
      pro?.name ??
      files.find((f) => /\.kicad_sch$/i.test(f.name))?.name ??
      files[0]?.name ??
      'Project';
    return basename(src).replace(/\.(kicad_pro|kicad_sch|kicad_pcb)$/i, '');
  };

  // Read the contents of *every* picked file, not just the KiCad documents,
  // so the whole project (footprint/symbol libs, net/report/text files, etc.)
  // survives a save, archive, and reopen instead of collapsing to sch+pcb. The
  // storage layer gzips text ~10x, so keeping the libs is cheap. The project is
  // persisted to IndexedDB so it survives a reload with no login.
  const ingest = async (
    files: IngestFile[],
    persist = true,
    templateId?: string,
  ): Promise<string | null> => {
    setLoading({ message: 'Reading files...', value: 0 });
    await nextPaint(); // show the overlay before the main thread gets busy
    try {
      let saved: string | null = null;
      setDemoOpen(false);
      setDemoSource(null);
      const out: PickedHomeFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        const base = f.name.split('/').pop()!;
        if (base.startsWith('.')) continue;
        const bytes = await f.bytesOf();
        out.push({ name: f.name, text: dec.decode(bytes), bytes });
        setLoading({
          message: 'Reading files...',
          detail: `${base}, ${i + 1} of ${files.length}`,
          value: (i + 1) / files.length,
        });
      }
      if (out.length === 0) return null;
      setPicked(out);
      if (persist && storageAvailable()) {
        try {
          // Persist every file's raw bytes (empty files carry nothing to reopen).
          const withBytes = out.filter((f) => f.bytes && f.bytes.length > 0);
          if (withBytes.length > 0) {
            setLoading('Saving project...');
            const name = projectNameOf(out);
            // Reuse an existing record of the same name so reopening a folder
            // updates it rather than piling up duplicates.
            const existing = (await listProjects()).find((p) => p.name === name);
            const pid = await saveProject(
              name,
              withBytes.map((f) => ({ name: f.name, bytes: f.bytes! })),
              existing?.id,
              templateId,
            );
            saved = pid;
            refreshSaved();
            // LOCAL_HISTORY::CommitSnapshot, which upstream runs from the same
            // place a save does. Declines by itself when nothing changed, so
            // reopening a folder does not add a row saying nothing happened.
            void recordSnapshot(
              pid,
              withBytes.map((f) => ({ name: f.name, bytes: f.bytes! })),
              'save',
              name,
            );
            // Mirror to the cloud when signed in (best-effort, non-blocking).
            if (userId)
              void pushProject(userId, pid).catch((e) => console.warn('Cloud push failed:', e));
          }
        } catch {
          /* storage disabled (private mode), the app still works */
        }
      }
      return saved;
    } finally {
      setLoading(null);
    }
  };

  // File > New Project: create a blank project from scratch (the three files
  // KiCad writes, .kicad_pro, root .kicad_sch, .kicad_pcb), show it in the
  // manager tree, and persist it like an opened project. KiCad leaves the new
  // project in the manager; the user then launches an editor from a tile.
  const openNewProjectDialog = (): void => {
    setTplStep('template');
  };

  // Upstream v10 NewProject flow: the template selector creates the project,
  // the built-in "Default" template scaffolds the three blank project files,
  // real templates copy their contents (renamed, like CreateProject).
  const createFromTpl = async (
    template: TemplateMeta,
    rawName: string,
    /**
     * onEditTemplate rather than OK: the project that comes out is bound to the
     * template, so every save is mirrored back into it (see setTemplateSink).
     * Only a user template can be edited - a bundled one is served read-only,
     * which is why upstream's label for those is "Open Template (Read-Only)".
     */
    editing = false,
  ): Promise<void> => {
    const name = sanitizeProjectName(rawName);
    if (!name) return;
    setTplStep('none');
    setExpanded(new Set());
    let files: PickedHomeFile[];
    if (template.id === DEFAULT_TEMPLATE_ID) {
      // The default template ships only a .kicad_pro; CreateNewProject is
      // what fills in the root sheet and the board beside it.
      files = newProjectFiles(name);
    } else if (template.source === 'user') {
      // A stored template's files are already the template's own; the same
      // CreateProject rename applies on the way into a project.
      const stored = await userTemplateFiles(template.id);
      files = stored.map((f) => ({
        ...f,
        name: `${name}/${renameTemplateRel(f.name, template.base, name)}`,
      }));
    } else {
      files = await createFromTemplate(template, name);
    }
    if (files.length === 0) return;
    await ingest(
      files.map((f) => ({ name: f.name, bytesOf: async () => f.bytes! })),
      true,
      editing && template.source === 'user' ? template.id : undefined,
    );
  };

  // The two handlers the chooser's Demos and Templates places call. They are
  // written here rather than into the places themselves because the places are
  // built once, above, and these close over state that changes every render;
  // no dependency list, so the ref always holds this render's closure. Opening
  // a demo is `openDemoProject`, the same thing File > Open Demo Project does,
  // because upstream that menu item and this dialog are one function.
  // Each closes the window first, the way the account tree's onAccept does:
  // accepting dismisses the dialog whichever place it happened in.
  useEffect(() => {
    openDemoRef.current = (id) => {
      setOpenPrjOpen(false);
      void openDemoProject(id);
    };
    openTemplateRef.current = (t) => {
      setOpenPrjOpen(false);
      void createFromTpl(t, t.base || t.id, true);
    };
  });

  // File > Save As: copy the whole project under a new name and persist it.
  const saveAsProject = async (): Promise<void> => {
    if (!picked) return;
    const name = sanitizeProjectName(window.prompt('Save project as:', `${projName}-copy`) ?? '');
    if (!name) return;
    const anyPath = (proFile?.name ?? picked[0]?.name ?? '').replace(/\\/g, '/');
    const firstSeg = anyPath.includes('/') ? `${anyPath.split('/')[0]}/` : '';
    const strip =
      firstSeg && picked.every((f) => f.name.replace(/\\/g, '/').startsWith(firstSeg))
        ? firstSeg
        : '';
    const files = copyProjectFiles(picked, strip, projName, name);
    await ingest(
      files.map((f) => ({ name: f.name, bytesOf: async () => f.bytes ?? enc.encode(f.text) })),
    );
  };

  // Reopen a project straight from IndexedDB, no folder picker needed.
  const openStored = async (id: string): Promise<void> => {
    setLoading('Opening project...');
    await nextPaint();
    try {
      const loaded = await loadProject(id);
      if (loaded)
        setPicked(
          loaded.files.map((f) => ({ name: f.name, text: dec.decode(f.bytes), bytes: f.bytes })),
        );
      await touchOpened(id); // resurface in Recent (ordered by last opened)
      refreshSaved();
    } catch (e) {
      // Without this the throw escaped an async click handler: the overlay
      // cleared, nothing opened, and nothing said why — the user clicks their
      // project, sees a flicker, and is stuck with no way to tell whether they
      // mis-clicked or their work is gone.
      //
      // A corrupt gzip blob, an IndexedDB read that fails, a decode error: all
      // reach here, and all leave the project in place, so retrying or
      // exporting it is still possible. Saying so is the whole fix.
      window.alert(
        `Could not open this project: ${e instanceof Error ? e.message : String(e)}\n\n` +
          'It is still saved in this browser — nothing has been deleted.',
      );
    } finally {
      setLoading(null);
    }
  };

  /**
   * Rename a stored project. The store half has been written and tested since
   * the project store landed; nothing ever called it, because there was no way
   * to ask (#421).
   *
   * A trimmed-empty name is a cancel, not a rename to "": a project with no
   * name is unfindable in the list it lives in.
   */
  const renameStored = async (id: string, current: string): Promise<void> => {
    const next = window.prompt('Rename project', current)?.trim();
    if (!next || next === current) return;
    await renameProject(id, next);
    refreshSaved();
    // The cloud copy carries the name too, so a rename that only landed
    // locally would come back on the next device that syncs.
    if (userId)
      void pushProject(userId, id).catch((err) => console.warn('Cloud rename failed:', err));
  };

  /**
   * Delete a stored project.
   *
   * This used to be a ✕ that appeared on hover over a recent-projects row and
   * deleted on the first click, with the cloud copy going too. In a dialog the
   * user is deliberately browsing, that is one stray click away from losing a
   * board, so it names what it is deleting and where from first.
   */
  const removeStored = async (id: string): Promise<void> => {
    const p = saved.find((x) => x.id === id);
    const where = userId ? 'this browser and your account' : 'this browser';
    if (!window.confirm(`Delete "${p?.name ?? 'this project'}" from ${where}?`)) return;
    await deleteProject(id);
    // Nothing else will ever reference these snapshots again.
    await deleteProjectHistory(id);
    refreshSaved();
    if (userId) void deleteCloudProject(id).catch((e) => console.warn('Cloud delete failed:', e));
  };

  const onPicked = async (list: FileList | null): Promise<void> => {
    if (!list || list.length === 0) return;
    await ingest(filesFromFileList(list));
  };

  // Open Project: KiCad opens the .kicad_pro and pulls in the whole project.
  // A browser cannot read a file's siblings, so the closest equivalent is the
  // directory picker (File System Access API), which grants the project folder
  // in one gesture. Chrome refuses that picker for "system" locations, the
  // Downloads folder, the profile root, Desktop, so anything but a plain user
  // cancel falls back to the classic webkitdirectory input, which has no such
  // blocklist. Multi-file selection and folder drag-and-drop cover the rest.
  const openProjectPicker = async (): Promise<void> => {
    const w = window as unknown as { showDirectoryPicker?: () => Promise<DirHandle> };
    if (w.showDirectoryPicker) {
      try {
        await ingest(await walkDirectoryHandle(await w.showDirectoryPicker()));
        return;
      } catch (e) {
        // AbortError = the user closed the dialog; anything else (blocked
        // folder, SecurityError, unsupported) gets the fallback input.
        if ((e as DOMException)?.name === 'AbortError') return;
      }
    }
    dirInputRef.current?.click();
  };

  // Folder drag-and-drop: walk the dropped directory entries (no blocklist,
  // works for Downloads/Desktop) and ingest every file found.
  const onDropProject = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault();
    // A single dropped .zip routes through Unarchive (upstream accepts zip drops).
    const plain = [...e.dataTransfer.files];
    if (plain.length === 1 && /\.zip$/i.test(plain[0]!.name)) {
      const expanded = expandArchive(new Uint8Array(await plain[0]!.arrayBuffer()));
      if (expanded) {
        await ingest(expanded.map(({ name, data }) => ({ name, bytesOf: async () => data })));
        return;
      }
    }
    const entries = [...e.dataTransfer.items]
      .map((i) => i.webkitGetAsEntry() as unknown as DropEntry | null)
      .filter((x): x is DropEntry => !!x);
    await ingest(await walkDroppedEntries(entries));
  };

  // Archive Project: KiCad zips the whole project folder byte-exact under a
  // folder named for the project (see archive.ts). Here: collect, zip, download.
  const archiveProject = async (): Promise<void> => {
    if (!picked) return;
    const name = projectNameOf(picked);
    const entries = archiveEntries(picked, name);
    if (!entries) return;
    setLoading('Archiving project...');
    await nextPaint(); // paint the overlay before zipSync blocks the main thread
    try {
      const blob = new Blob([zipArchive(entries)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setLoading(null);
    }
  };

  // Unarchive Project: expand a .zip in memory and feed its files through the
  // same ingest path as a folder open (so it lands in the tree and persists).
  const onUnarchive = async (list: FileList | null): Promise<void> => {
    const file = list?.[0];
    if (!file) return;
    const expanded = expandArchive(new Uint8Array(await file.arrayBuffer()));
    if (!expanded) return; /* not a valid zip */
    await ingest(expanded.map(({ name, data }) => ({ name, bytesOf: async () => data })));
  };

  const runMgrAction = (action: MgrAction): void => {
    switch (action) {
      case 'open':
        setOpenPrjOpen(true);
        break;
      case 'new':
        openNewProjectDialog();
        break;
      case 'archive':
        void archiveProject();
        break;
      case 'unarchive':
        zipInputRef.current?.click();
        break;
      case 'refresh':
        refreshSaved();
        break;
    }
  };

  // Drag the sash to resize the project-tree pane (clamped like KiCad's panes).
  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    // 250 is the pane's MinSize, applied straight after the first layout:
    //   m_auimgr.GetPane( m_projectTreePane ).MinSize( defaultLeftWinWidth, ... )
    // The same 250 is what a first run renders (measured 2026-08-19 against a
    // fresh KICAD_CONFIG_HOME: pane x34..x283), so the floor and the opening
    // width agree — there is no asymmetry here, contrary to what this comment
    // used to claim.
    const onMove = (ev: MouseEvent): void =>
      setPanelWidth(Math.min(600, Math.max(250, startW + ev.clientX - startX)));
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      // KICAD_MANAGER_FRAME::SaveSettings writes the pane's width back on the
      // way out; written on mouse-up rather than every mousemove so a drag is
      // one store write, not a hundred.
      setPanelWidth((w) => {
        try {
          localStorage.setItem('ziro.leftWinWidth', String(w));
        } catch {
          /* storage blocked (private mode): the drag still works this session */
        }
        return w;
      });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
  };

  // The active .kicad_pro anchors the tree (KiCad's active project); a folder
  // may hold several. Falls back to the first when none is marked active.
  const proFile = useMemo(
    () =>
      picked?.find((f) => f.name === activePro) ??
      picked?.find((f) => /\.kicad_pro$/i.test(f.name)) ??
      null,
    [picked, activePro],
  );

  // The project name drives KiCad's root-file detection (which schematic shows,
  // and the sort weight). Falls back to the root .kicad_sch / first file.
  const projName = useMemo(
    () => (proFile ? projectNameOf([proFile]) : picked ? projectNameOf(picked) : ''),
    [proFile, picked],
  );
  const projLower = projName.toLowerCase();
  /**
   * The stored record the open project is, which is what its history is keyed
   * on.
   *
   * Derived from the name rather than tracked, because that is already how the
   * store identifies a project: `ingest` reuses "an existing record of the same
   * name so reopening a folder updates it rather than piling up duplicates".
   * Anything else here would be a second answer to the same question.
   */
  const openProjectId = useMemo(
    () => (projName ? (saved.find((p) => p.name === projName)?.id ?? null) : null),
    [saved, projName],
  );
  // `HistoryExists( Prj().GetProjectPath() )`, which the File menu's enable
  // condition asks for on every UI update (kicad/menubar.cpp:108-113). Read the
  // same way the pane reads it, and re-read on the same event, so the menu item
  // and the pane can never disagree about whether there is a history.
  useEffect(() => {
    if (!openProjectId) {
      setHistory([]);
      return;
    }
    let live = true;
    const read = (): void => {
      void listSnapshots(openProjectId).then((rows) => {
        if (live) setHistory(rows);
      });
    };
    read();
    const off = onHistoryChanged((id) => {
      if (id === openProjectId) read();
    });
    return () => {
      live = false;
      off();
    };
  }, [openProjectId]);

  // KiCad's getProjects(dir): the basenames of every .kicad_pro in the folder.
  // A folder may hold several projects (e.g. the ecc83 demo's ecc83-pp and
  // ecc83-pp_v2); the tree shows the root sheet of each, so this set, not just
  // the active project, decides which .kicad_sch are visible (subsheets hide).
  const projectNames = useMemo<ReadonlySet<string>>(
    () =>
      new Set(
        (picked ?? [])
          .filter((f) => /\.kicad_pro$/i.test(f.name))
          .map((f) =>
            basename(f.name)
              .replace(/\.kicad_pro$/i, '')
              .toLowerCase(),
          ),
      ),
    [picked],
  );
  // KiCad's tree root shows the full .kicad_pro filename (m_root = fn.GetFullName()).
  const rootLabel = proFile
    ? basename(proFile.name)
    : projName
      ? `${projName}.kicad_pro`
      : 'Project';

  const launchSchematic = (startFile?: string): void => {
    if (picked && onOpenProject) onOpenProject(picked, startFile, demoOpen ? demoSource : null);
    else onOpenSchematic();
  };

  const pcbFile = useMemo(
    () => picked?.find((f) => /\.kicad_pcb$/i.test(basename(f.name))) ?? null,
    [picked],
  );
  // Like standalone pcbnew: with no project, the PCB Editor opens a new empty
  // board (KiCad's default 2-layer stack with the full tech layer table).
  const launchPcb = (): void => {
    if (!onOpenPcb) return;
    // Carry the whole project so the board editor can jump to the schematic.
    if (pcbFile && picked) onOpenPcb(pcbFile, picked);
    else onOpenPcb({ name: 'untitled.kicad_pcb', text: EMPTY_PCB });
  };

  // The on-disk directory tree, sorted exactly like KiCad's project window
  // (dirs first, root files next, then case-insensitive by name). Footprint/3D
  // libraries stay inside collapsible folders instead of flooding the list.
  const stripPrefix = useMemo<string>(() => {
    if (!picked) return '';
    // The project folder is the .kicad_pro's own directory. Strip it so the
    // tree is flat under the project, robustly, even if some file (e.g. a
    // drawing sheet) doesn't share the prefix (it just shows at the root).
    const pro = proFile?.name.replace(/\\/g, '/');
    if (pro?.includes('/')) return pro.slice(0, pro.lastIndexOf('/') + 1);
    const anyPath = (picked[0]?.name ?? '').replace(/\\/g, '/');
    const firstSeg = anyPath.includes('/') ? `${anyPath.split('/')[0]}/` : '';
    return firstSeg && picked.every((f) => f.name.replace(/\\/g, '/').startsWith(firstSeg))
      ? firstSeg
      : '';
  }, [picked, proFile]);

  const dirRoot = useMemo<DirNode | null>(
    () => (picked ? buildDirTree(picked, stripPrefix, projLower) : null),
    [picked, stripPrefix, projLower],
  );

  // The tree-selected file, when it is a single text document our viewer can show.
  const fileAtPath = (path: string): PickedHomeFile | null =>
    picked?.find((x) => x.name.replace(/\\/g, '/') === stripPrefix + path) ?? null;

  // Download a project file to the browser's local storage (the file manager's
  // "Download…" action). Binary files use their bytes; text files their text.
  const downloadFileAtPath = (path: string): void => {
    const f = fileAtPath(path);
    if (!f) return;
    const blob = f.bytes
      ? new Blob([f.bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' })
      : new Blob([f.text], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name.split('/').pop() || 'file';
    a.click();
    URL.revokeObjectURL(url);
  };
  const selectedTextFile = useMemo<PickedHomeFile | null>(() => {
    if (!picked || selected.size !== 1) return null;
    const [path] = selected;
    const f = picked.find((x) => x.name.replace(/\\/g, '/') === stripPrefix + path);
    return f && isViewableTextFile(f.name) ? f : null;
  }, [picked, selected, stripPrefix]);

  // Tree file operations (upstream onRenameFile/onDeleteFile): apply the pure
  // list transform, then persist the changed project like any other ingest.
  const applyTreeOp = async (next: PickedHomeFile[] | null): Promise<void> => {
    if (!next) return;
    setSelected(new Set());
    await ingest(
      next.map((f) => ({
        name: f.name,
        bytesOf: async () => f.bytes ?? enc.encode(f.text),
      })),
    );
  };
  const renamePath = (path: string): void => {
    const current = path.split('/').pop()!;
    const name = window.prompt(`Change filename: '${current}'`, current);
    if (!name || !picked) return;
    const next = renameTreeEntry(picked, stripPrefix, path, name);
    if (!next) window.alert('That name is empty or already taken.');
    else void applyTreeOp(next);
  };
  const deletePaths = (paths: Set<string>): void => {
    if (!picked || paths.size === 0) return;
    const what = paths.size === 1 ? `'${[...paths][0]}'` : `${paths.size} items`;
    if (!window.confirm(`Delete ${what} and their contents?`)) return;
    void applyTreeOp(deleteTreeEntries(picked, stripPrefix, paths));
  };

  const toggleDir = (path: string): void =>
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path);
      else n.add(path);
      return n;
    });

  // Menu bar transcribed from the upstream manager (see home/menubar.ts).
  const clearRecent = async (): Promise<void> => {
    if (
      !window.confirm(
        'Remove all projects saved in this browser? Cloud copies are kept for signed-in accounts.',
      )
    )
      return;
    for (const pr of saved) {
      await deleteProject(pr.id);
      await deleteProjectHistory(pr.id);
    }
    refreshSaved();
  };

  const common = useCommonSettings();
  const menus: Menu[] = buildManagerMenus({
    newProject: openNewProjectDialog,
    openProject: () => setOpenPrjOpen(true),
    selectProjectFiles: () => filesInputRef.current?.click(),
    openRecent: (id) => void openStored(id),
    clearRecent: () => void clearRecent(),
    closeProject: () => setPicked(null),
    restoreLocalHistory: () => setRestoreListOpen(true),
    hasLocalHistory: history.length > 0,
    saveAs: () => void saveAsProject(),
    archiveProject: () => void archiveProject(),
    unarchiveProject: () => zipInputRef.current?.click(),
    refresh: refreshSaved,
    toggleLocalHistory: () => setHistoryShown((v) => !v),
    localHistoryShown: historyShown,
    openTextViewer: () => setTextView(selectedTextFile),
    editSchematic: () => launchSchematic(),
    editSymbols: () => onOpenSymbolEditor?.(picked ?? undefined),
    editPcb: launchPcb,
    editFootprints: () => onOpenFootprintEditor?.(picked ?? undefined),
    openImageConverter: () => onOpenImageConverter?.(),
    openGerberViewer: () => onOpenGerberViewer?.(),
    openCalculator: () => onOpenCalculator?.(),
    openDrawingSheetEditor: () => onOpenDrawingSheetEditor?.(),
    openPreferences: () => setPrefsOpen(true),
    showAbout: () => setAboutOpen(true),
    showHotkeys: showHotkeyList,
    openDemo: (id) => void openDemoProject(id),
    hasProject: !!picked,
    hasTextFileSelected: !!selectedTextFile,
    recent: saved,
    // COMMON_SETTINGS: how many rows Open Recent shows, and the checked
    // language row (EDA_BASE_FRAME::AddMenuLanguageList).
    fileHistorySize: common.system.file_history_size,
    language: common.system.language,
    setLanguage: (label) =>
      settings.updateCommon((c) => {
        c.system.language = label;
      }),
    demos,
  });

  /**
   * The manager's accelerators, which are whatever its menu says they are —
   * now literally, rather than as an aspiration.
   *
   * What stood here was a 40-line `keydown` listener that re-stated every
   * combo `buildManagerMenus` had already written beside a row - and it had
   * already drifted once, which is on the record: Ctrl+G, Ctrl+Y and
   * Shift+Ctrl+S sat in the menu bound to nothing until someone noticed
   * Ctrl+G opening Chrome's find-next. The two rows the menu greys out with
   * no project picked were re-gated here by hand with `picked`, too. The
   * shared dispatcher reads the rows, so `disabled: !h.hasProject` is the
   * gate in one place and there is nothing left to keep in step.
   *
   * It also had no typing guard at all, so Ctrl+O fired while you were naming
   * a project. `menu_hotkeys.ts` has TOOL_DISPATCHER's rule.
   *
   * `preventDefault` here stops our own default; ui/browser_hotkeys.ts stops
   * the *browser's*, for these and for every other combo the app binds. Ctrl+N
   * is the exception that cannot be fixed from a page: it is
   * ACTIONS::newProject and it is also Chrome's new window, and the browser
   * does not yield it. See BROWSER_RESERVED.
   *
   * ACTIONS::listHotKeys is AS_GLOBAL and its Ctrl+F1 is answered once, by
   * HotkeyListHost above the app, as well as by the Help row here.
   */
  useMenuHotkeys(menus, 'home');

  return (
    <div className="ze-app">
      <input
        ref={dirInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        // Non-standard but universally supported attribute: pick a whole folder.
        {...{ webkitdirectory: '' }}
        onChange={(e) => {
          void onPicked(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept=".kicad_pro,.kicad_sch,.kicad_pcb,.kicad_dru,.kicad_prl,.kicad_wks,.kicad_sym,.md,.txt"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onPicked(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          void onUnarchive(e.target.files);
          e.target.value = '';
        }}
      />

      <MenuBar
        menus={menus}
        title={<>{picked && projName ? projName : 'No project'}&nbsp;&mdash;&nbsp;Ziro Designer</>}
        rightSlot={
          session ? (
            <div className="ze-account">
              <span className="ze-account-email">{session.user.email}</span>
              <button className="ze-account-signout" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          ) : authEnabled ? (
            <div className="ze-account">
              <button className="ze-account-signout" onClick={() => setSignInOpen(true)}>
                Sign in
              </button>
            </div>
          ) : undefined
        }
      />

      <div
        className="ze-home-body"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => void onDropProject(e)}
      >
        {/* far-left vertical toolbar */}
        <div className="ze-mgrbar">
          {MGR_TOOLS.map((t, i) =>
            t === 'sep' ? (
              <span key={`s${i}`} className="sep" />
            ) : (
              <button
                key={t.icon}
                data-tip={buttonTooltipFor(t.name, t.hotkey, t.tip)}
                aria-label={t.name}
                disabled={(t.action === 'archive' || t.action === 'refresh') && !picked}
                onClick={() => runMgrAction(t.action)}
              >
                <img src={mgrUrl(t.icon)} alt="" />
              </button>
            ),
          )}
        </div>

        {/* The left dock. Upstream puts BOTH panes in it, same direction, same
            layer, same row:

              AddPane( m_projectTreePane, EDA_PANE()...Left().Layer( 1 ) )
              AddPane( m_historyPane,     EDA_PANE()...Left().Layer( 1 ).Position( 1 ) )

            (kicad_manager_frame.cpp:236-245). Panes sharing a row in a left dock
            stack vertically in Position order, so Local History sits *below*
            Project Files and shares its width — it is not a second column. Ours
            used to be a horizontal sibling rendered before the tree, which put
            it on the wrong side and the wrong axis. */}
        <div className="ze-leftdock" ref={leftDockRef} style={{ width: panelWidth }}>
          <ProjectTreePane
            picked={picked}
            dirRoot={dirRoot}
            rootLabel={rootLabel}
            projectNames={projectNames}
            width={panelWidth}
            expanded={expanded}
            onToggleDir={toggleDir}
            selected={selected}
            onSelect={selectPath}
            onRenamePath={renamePath}
            onDeletePaths={deletePaths}
            onViewTextPath={(path) => setTextView(fileAtPath(path))}
            onDownloadPath={(path) => downloadFileAtPath(path)}
            rootOpen={rootOpen}
            onToggleRoot={() => setRootOpen((o) => !o)}
            onOpenPcbFile={onOpenPcb ? (f) => onOpenPcb(f, picked ?? undefined) : undefined}
            onOpenSchematic={launchSchematic}
            onOpenSymbolFile={
              onOpenSymbolEditor
                ? (f) => onOpenSymbolEditor(picked ?? undefined, f.name)
                : undefined
            }
            onOpenDrawingSheetFile={
              onOpenDrawingSheetEditor ? (f) => onOpenDrawingSheetEditor(f) : undefined
            }
            onSwitchProject={onSwitchProject}
            onOpenFootprintFile={
              onOpenFootprintEditor
                ? (f) => onOpenFootprintEditor(picked ?? undefined, f.name)
                : undefined
            }
          />
          {/* Position( 1 ): second in the same dock row, so it sits under the
              tree. `.Hide()` at construction and shown only when the setting
              says so, which is what `historyShown` carries here. */}
          {historyShown && (
            <>
              <div
                className="ze-hsplitter"
                onMouseDown={startHistoryResize}
                title="Drag to resize"
              />
              <LocalHistoryPane
                projectId={openProjectId}
                onRestore={setRestoring}
                onClose={() => setHistoryShown(false)}
                height={historyHeight}
              />
            </>
          )}
        </div>

        {/* draggable sash between the tree and the launchers (KiCad's wxAUI pane) */}
        <div className="ze-splitter" onMouseDown={startResize} title="Drag to resize" />

        {/* launcher tiles (fixed) with the Recent Projects list scrolling below */}
        <div className="ze-launchers">
          <div className="ze-tiles">
            {TILES.map((t) => {
              const hasSch = !!picked?.some((f) => /\.kicad_sch$/i.test(f.name));
              const hasPcb = !!picked?.some((f) => /\.kicad_pcb$/i.test(f.name));
              // Schematic/PCB edit a project, so they need one open (like KiCad's
              // project manager). Symbol Editor is a library editor, standalone.
              const needsProject = t.id === 'schematic' || t.id === 'pcb';
              const enabled = !needsProject || (t.id === 'schematic' ? hasSch : hasPcb);
              const tip = enabled ? tooltipFor(t.tip, t.hotkey) : 'Open or create a project first';
              const launch =
                t.id === 'pcb'
                  ? launchPcb
                  : t.id === 'symbols'
                    ? (): void => onOpenSymbolEditor?.(picked ?? undefined)
                    : t.id === 'footprints'
                      ? (): void => onOpenFootprintEditor?.(picked ?? undefined)
                      : t.id === 'calculator'
                        ? (): void => onOpenCalculator?.()
                        : t.id === 'drawingsheet'
                          ? (): void => onOpenDrawingSheetEditor?.()
                          : t.id === 'image'
                            ? (): void => onOpenImageConverter?.()
                            : t.id === 'gerber'
                              ? (): void => onOpenGerberViewer?.()
                              : (): void => launchSchematic();
              return (
                <button
                  key={t.id}
                  className="ze-launcher"
                  disabled={!enabled}
                  onClick={enabled ? launch : undefined}
                >
                  {/* CreateLaunchers gives the tooltip to the button and to the
                      title label, and to neither the help line nor the row:
                        btn->SetToolTip( aAction.GetTooltip() );
                        label->SetToolTip( aAction.GetTooltip() );
                      That matters for placement as much as for coverage - the
                      box is centred under whatever carries it, so hanging it
                      off the whole 760px row put it half a screen from the
                      icon the pointer was actually on. */}
                  <span className="ico" data-tip={tip}>
                    {tileIcon(t.id)}
                  </span>
                  <span className="txt">
                    <span className="name" data-tip={tip}>
                      {t.name}
                    </span>
                    <span className="desc">{t.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* KICAD_MANAGER_FRAME is an EDA_BASE_FRAME, not a draw frame: it calls
          CreateStatusBar( 2 ) (kicad/kicad_manager_frame.cpp:176) and gets its
          own two panes rather than EDA_DRAW_FRAME's eight, so it uses
          KiStatusBar's children form for the same bar chrome. */}
      <KiStatusBar>
        {/* KICAD_MANAGER_FRAME::PrintPrjInfo formats _( "Project: %s" ) with the
            project's full name and hands it to SetEllipsedTextField, which
            middle-ellipsizes it to the field. */}
        <EllipsizedField
          text={picked ? `Project: ${proFile?.name ?? projName ?? '-'}` : 'No project loaded'}
        />
        <span className="cell">
          {storageAvailable()
            ? session
              ? 'Saved in browser · cloud sync on'
              : 'Saved in browser'
            : 'In-memory only (storage unavailable)'}
        </span>
      </KiStatusBar>

      {openPrjOpen && (
        <FileChooser
          fs={accountFs}
          mode="open"
          title="Open Existing Project"
          accept="Open"
          places={chooserPlaces}
          // Recent is listed first but Open Project opens on the account's own
          // tree, the way upstream opens on defaultDir with Home lit.
          initialPlace="projects"
          filters={OPEN_PROJECT_FILTERS}
          extra={
            <>
              {/* Where wxFileDialogCustomizeHook's controls sit upstream. Ours
                  are the two ways into a project that is not in the account
                  yet, which is the reason Open Project is a window and not a
                  list. */}
              <button
                type="button"
                className="ze-btn"
                onClick={() => {
                  setOpenPrjOpen(false);
                  void openProjectPicker();
                }}
              >
                Open from Computer...
              </button>
              <button
                type="button"
                className="ze-btn"
                onClick={() => {
                  setOpenPrjOpen(false);
                  filesInputRef.current?.click();
                }}
                title="If the browser blocks the folder (Downloads, Desktop...), select all the project files instead"
              >
                Select Files...
              </button>
            </>
          }
          onDelete={(entry) => {
            // Deleting is the caller's because the sentence differs: signed in
            // it leaves the account, signed out only this browser. removeStored
            // is what already asks that question.
            void projectAt(entry.path).then((p) => {
              if (p) void removeStored(p.id);
            });
          }}
          onAccept={(path) => {
            setOpenPrjOpen(false);
            void projectAt(path).then((p) => {
              if (p) void openStored(p.id);
            });
          }}
          onCancel={() => setOpenPrjOpen(false)}
        />
      )}

      {tplStep === 'template' && (
        <TemplateSelectorDialog
          templates={templates}
          recentTemplates={recentTemplates}
          onCancel={() => setTplStep('none')}
          onOk={(t) => {
            if (!t) {
              // KICAD_MANAGER_CONTROL::NewProject's own answer when the dialog
              // returns wxID_OK with no template chosen.
              window.alert('No project template was selected.  Cannot generate new project.');
              return;
            }
            // settings->m_RecentTemplates: erase the duplicate, insert at the
            // front, then `if( recentTemplates.size() > 5 ) resize( 5 )`. We had
            // been keeping 8, so the recent list grew three rows past KiCad's.
            // Upstream writes the MRU only once the project has actually been
            // created, after the file dialog; ours does the same, below.
            setTplChosen(t);
            setTplStep('name');
          }}
          // onEditTemplate: find the template's .kicad_pro and LoadProject it.
          // The original is read-only here, so what opens is a copy under the
          // template's own name - you can look at exactly what it contains, and
          // the template itself cannot be damaged.
          // Opened under the template's own basename, so CreateProject's rename
          // is a no-op and the files line up 1:1 with the template's - which is
          // what lets a save be mirrored straight back.
          onOpenTemplate={(t) => void createFromTpl(t, t.base || t.id, true)}
          onDuplicate={duplicateTpl}
          onDelete={async (t) => {
            await deleteUserTemplate(t.id);
            await refreshTemplates();
          }}
        />
      )}

      {/* NewProject's second window:

            wxString     default_dir = wxFileName( Prj().GetProjectFullName() ).GetPathWithSep();
            wxString     title = _( "New Project Folder" );
            wxFileDialog dlg( m_frame, title, default_dir, wxEmptyString,
                              FILEEXT::ProjectFileWildcard(),
                              wxFD_SAVE | wxFD_OVERWRITE_PROMPT );

          (kicad/tools/kicad_manager_control.cpp:281-285.) It is the same
          wxFileDialog Open Existing Project puts up, in save mode - so it is
          the same widget here too, and the project name is the filename typed
          into it rather than a field bolted onto the selector.

          Two things upstream has that this tree cannot carry, said rather than
          substituted for:

          * FILEDLG_NEW_PROJECT's "Create a new folder for the project"
            checkbox (kicad/widgets/filedlg_new_project.h). It decides between
            `<dir>/Blinky.kicad_pro` and `<dir>/Blinky/Blinky.kicad_pro`. Every
            project of the account *is* a folder at the tree's root - the store
            has no other shape for one - so the box could only ever be ticked.
            Left out rather than drawn as a control that does nothing.
          * The default directory. There is one directory a project can be
            created in, so the dialog opens at the root and stays there; a
            `default_dir` would have nowhere else to point. */}
      {tplStep === 'name' && tplChosen && (
        <FileChooser
          fs={accountFs}
          mode="save"
          title="New Project Folder"
          // wxFD_SAVE, which is what GTK labels the accept button from.
          accept="Save"
          // `wxEmptyString` is the defaultFile upstream passes: the name is
          // asked for, not proposed from the template.
          initialName=""
          // Only the account's own tree, which is the one place a project can
          // be created; Recent, Demos and Templates are read-only listings.
          places={[{ id: 'projects', label: 'Projects', icon: 'open_project' }]}
          filters={NEW_PROJECT_FOLDER_FILTERS}
          onCancel={() => setTplStep('none')}
          onAccept={(path) => {
            // The name half of what NewProject does to the returned path:
            // a typed `.kicad_pro` is replaced by SetExt and disappears, any
            // other extension is folded back into the name.
            const name = sanitizeProjectName(projectNameFrom(pathBasename(path)));
            if (!name) return;
            // wxFD_OVERWRITE_PROMPT, then KIDIALOG's "Similar files already
            // exist in the destination folder." Both come down to the same
            // question here, because a project of this name already existing
            // is exactly what `ingest` would overwrite.
            if (
              takenProjectNames.has(name.toLowerCase()) &&
              !window.confirm(
                `A project named \u201c${name}\u201d already exists.  Do you want to replace it?`,
              )
            ) {
              return;
            }
            // settings->m_RecentTemplates, written once the project is made.
            const t = tplChosen;
            setRecentTemplates((prev) => [t.id, ...prev.filter((id) => id !== t.id)].slice(0, 5));
            void createFromTpl(t, name);
          }}
        />
      )}

      {/* KiCad's "Load Schematic" progress dialog, web-style. */}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {textView && (
        <TextViewerDialog
          name={textView.name}
          text={textView.text}
          onClose={() => setTextView(null)}
        />
      )}
      {prefsOpen && <PreferencesDialog onClose={() => setPrefsOpen(false)} />}

      {/* Guest nudge: once there's real work at stake (a saved project) and no
          account, offer, never force, signing in so it's backed up. */}
      {authEnabled && !session && !guestNudgeDismissed && saved.length > 0 && !signInOpen && (
        <div className="ze-guest-nudge">
          <span>Your projects are saved on this device only.</span>
          <button className="ze-btn primary" onClick={() => setSignInOpen(true)}>
            Sign in to back them up
          </button>
          <span className="x" title="Dismiss" onClick={dismissGuestNudge}>
            ✕
          </span>
        </div>
      )}

      {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}

      {/* Cloud-sync status (non-blocking): projects reconciling on sign-in.
          A failure stays until dismissed — it is the only signal the user gets
          that their work is not where they think it is. */}
      {syncState && (
        <div
          className={`ze-sync-pill${'healed' in syncState ? ' done' : ''}${
            'failures' in syncState ? ' failed' : ''
          }`}
        >
          {'healed' in syncState ? (
            <>
              ✓ Projects synced
              {syncState.healed > 0 &&
                ` (${syncState.healed} damaged cloud ${
                  syncState.healed === 1 ? 'copy' : 'copies'
                } restored from this device)`}
            </>
          ) : 'failures' in syncState ? (
            <>
              <span>
                ⚠ {syncState.failures.length}{' '}
                {syncState.failures.length === 1 ? 'project' : 'projects'} did not sync:{' '}
                {syncState.failures[0]!.message}
              </span>
              {/* A damaged copy that cannot be recovered reports the same thing
                  on every sign-in, forever. Dismiss only silences it until the
                  next one, so there is also a way to be rid of it: the rows are
                  provably unreadable and have no recoverable version, so
                  removing them loses nothing that still exists. */}
              {syncState.failures.some((f) => f.unrecoverable) && (
                <button
                  type="button"
                  className="ze-sync-dismiss"
                  onClick={() => void removeUnrecoverable(syncState.failures)}
                >
                  Remove damaged
                </button>
              )}
              <button type="button" className="ze-sync-dismiss" onClick={() => setSyncState(null)}>
                Dismiss
              </button>
            </>
          ) : (
            <>
              <span className="ze-spinner" />
              Syncing cloud projects... {syncState.done} of {syncState.total}
            </>
          )}
        </div>
      )}

      {/* DIALOG_RESTORE_LOCAL_HISTORY. `ShowRestoreDialog` returns without
          showing anything when the history is empty (common/local_history.cpp:
          2386-2392); the File item is disabled in that case, so this cannot be
          reached with nothing to list. Choosing a row hands it to the same
          confirmation the pane's context menu raises. */}
      {restoreListOpen && (
        <RestoreLocalHistoryDialog
          snapshots={history}
          onResult={(s) => {
            setRestoreListOpen(false);
            if (s) setRestoring(s);
          }}
        />
      )}

      {/* `RestoreCommit`'s own confirmation (common/local_history.cpp:2252-2270).
          Cancel is the default button - `wxNO_DEFAULT` - so Enter never runs the
          destructive answer, and nothing has been written when it is chosen. */}
      {restoring && openProjectId && (
        <MessageDialogYesNo
          caption={RESTORE_CAPTION}
          message={restoreConfirmMessage(restoring.at)}
          extendedMessage={RESTORE_EXTENDED}
          icon="question"
          defaultButton="no"
          labels={{ yes: RESTORE_YES_LABEL, no: RESTORE_NO_LABEL }}
          onResult={(r) => {
            const snapshot = restoring;
            setRestoring(null);
            if (r !== 'yes') return;
            void (async () => {
              setLoading('Restoring...');
              await nextPaint();
              try {
                const files = await restoreSnapshot(openProjectId, snapshot.id);
                if (!files) {
                  window.alert('That version is no longer available.');
                  return;
                }
                // Upstream reopens its editors on the restored files
                // (kicad_manager_frame.cpp:1530-1532); re-reading the project is
                // this app's version of that, and it also refreshes the tree.
                await openStored(openProjectId);
              } finally {
                setLoading(null);
              }
            })();
          }}
        />
      )}

      <LoadingOverlay label={loading} />
    </div>
  );
}
