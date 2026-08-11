// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
import { useEffect, useMemo, useRef, useState, useCallback, lazy, Suspense } from 'react';
import type { LibSymbol } from '@ziroeda/eeschema';
import { HomePage } from './home/HomePage.js';
import type { PickedFile } from './editors/schematic/SchematicEditor.js';
import { LoadingOverlay } from './ui/LoadingOverlay.js';
import {
  storageAvailable,
  listProjects,
  loadProject,
  updateProjectFiles,
} from './home/projectStore.js';
import { saveSession, loadSession } from './home/session.js';
import { installFlushOnHide } from './home/flush_on_hide.js';
import { setRecoveryProvider } from './home/recovery.js';
import { recoverySnapshotFrom } from './home/recovery_source.js';
import { formatTitle, useDocumentTitle } from './ui/useDocumentTitle.js';
import './ui/shell.css';

/**
 * The editor frames load on demand, one chunk each.
 *
 * They used to be static imports, which put all eight of them into the entry
 * bundle: a visitor downloaded the schematic editor, the board editor, the
 * symbol and footprint editors, the gerber viewer, the calculator, the drawing
 * sheet editor and the image converter before the sign-in screen could paint,
 * whichever one they were coming to use. The 3D viewer (`pcb3d.js`) was already
 * split this way and is the pattern being followed here.
 *
 * The `*Mounted` flags below already gate each frame on first use and keep it
 * mounted afterwards, so the download happens exactly once, at the moment the
 * user first asks for that frame. Each frame gets its own `Suspense` boundary at
 * its render site rather than one boundary around all of them: a shared boundary
 * would unmount every already-open editor while a newly requested one loaded,
 * throwing away the parsed document each was holding.
 *
 * `PickedFile` is imported as a type above, which erases at build time and so
 * does not pull the schematic editor back into the entry chunk.
 */
const SchematicEditor = lazy(() =>
  import('./editors/schematic/SchematicEditor.js').then((m) => ({ default: m.SchematicEditor })),
);
const PcbEditor = lazy(() =>
  import('./editors/pcb/PcbEditor.js').then((m) => ({ default: m.PcbEditor })),
);
const SymbolEditor = lazy(() =>
  import('./editors/symbol/SymbolEditor.js').then((m) => ({ default: m.SymbolEditor })),
);
const FootprintEditor = lazy(() =>
  import('./editors/footprint/FootprintEditor.js').then((m) => ({ default: m.FootprintEditor })),
);
const CalculatorTools = lazy(() =>
  import('./editors/calculator/CalculatorTools.js').then((m) => ({ default: m.CalculatorTools })),
);
const DrawingSheetEditor = lazy(() =>
  import('./editors/drawingsheet/DrawingSheetEditor.js').then((m) => ({
    default: m.DrawingSheetEditor,
  })),
);
const ImageConverter = lazy(() =>
  import('./editors/image/ImageConverter.js').then((m) => ({ default: m.ImageConverter })),
);
const GerberViewer = lazy(() =>
  import('./editors/gerbview/GerberViewer.js').then((m) => ({ default: m.GerberViewer })),
);

/** Fallback while a frame's chunk is in flight, in the app's own overlay style. */
const frameLoading = (what: string): JSX.Element => <LoadingOverlay label={`Loading ${what}…`} />;

const dec = new TextDecoder();
const enc = new TextEncoder();

// Non-text project files (plot / export outputs) that must stay raw bytes,
// decoding them as UTF-8 would corrupt them.
const BINARY_RE = /\.(png|jpe?g|gif|bmp|pdf|zip|step|stp|stl|wrl|glb)$/i;
const pickedFromStored = (f: { name: string; bytes: Uint8Array }): PickedFile =>
  BINARY_RE.test(f.name)
    ? { name: f.name, text: '', bytes: f.bytes }
    : { name: f.name, text: dec.decode(f.bytes) };

const projectNameOf = (files: PickedFile[]): string => {
  const pro = files.find((f) => /\.kicad_pro$/i.test(f.name));
  const src =
    pro?.name ??
    files.find((f) => /\.kicad_sch$/i.test(f.name))?.name ??
    files[0]?.name ??
    'Project';
  return pcbBasename(src).replace(/\.(kicad_pro|kicad_sch|kicad_pcb)$/i, '');
};

const pcbBasename = (p: string): string => p.split('/').pop()!.split('\\').pop()!;

// A project's basename (no extension), e.g. "proj/proj.kicad_pro" → "proj".
const projBaseOf = (proName: string): string => pcbBasename(proName).replace(/\.kicad_pro$/i, '');

// Does `fileName` belong to the project whose basename is `base`? KiCad's per-
// project files share the exact basename (proj.kicad_sch / proj.kicad_pcb), so
// the file basename starts with "base.", this keeps "proj" and "proj_v2" apart.
const inProject = (fileName: string, base: string): boolean =>
  pcbBasename(fileName).toLowerCase().startsWith(`${base.toLowerCase()}.`);

// The project's folder prefix (e.g. "proj/"), taken from the .kicad_pro's own
// directory, or '' when it sits at the root. New files added to the project
// carry this prefix so they land in the project folder like the other files.
const projectDirPrefix = (files: PickedFile[]): string => {
  const pro = files.find((f) => /\.kicad_pro$/i.test(f.name))?.name.replace(/\\/g, '/');
  return pro?.includes('/') ? pro.slice(0, pro.lastIndexOf('/') + 1) : '';
};

/**
 * Top-level app: KiCad's project manager, then the schematic, symbol and PCB
 * editors. Like KiCad, the editors share one open project and stay resident,
 * you cross-navigate between them (eeschema's "Open PCB" / "Symbol Editor",
 * pcbnew's "Open Schematic", the symbol editor's "Add symbol to schematic")
 * without reloading or losing state. Each is kept mounted once used and toggled
 * with CSS so heavy documents are parsed only once.
 */
export function App(): JSX.Element {
  const [view, setView] = useState<
    | 'home'
    | 'schematic'
    | 'pcb'
    | 'symbols'
    | 'footprints'
    | 'calculator'
    | 'drawingsheet'
    | 'image'
    | 'gerber'
  >('home');
  const [projectFiles, setProjectFiles] = useState<PickedFile[] | null>(null);
  // `.kicad_wks` saved into the open project this session (Drawing Sheet Editor
  // → Save to Project). Kept separate from projectFiles so adding one doesn't
  // reload/reset the mounted editors; offered as schematic Page Settings choices.
  const [sessionSheets, setSessionSheets] = useState<PickedFile[]>([]);
  const [startFile, setStartFile] = useState<string | null>(null);
  // The active project's .kicad_pro (full name) when a folder holds more than
  // one project (KiCad's active project). null → the first .kicad_pro. Double-
  // clicking another .kicad_pro switches it, re-scoping every editor's root.
  const [activePro, setActivePro] = useState<string | null>(null);
  // A board opened directly (no schematic project around it).
  const [standalonePcb, setStandalonePcb] = useState<PickedFile | null>(null);
  // The schematic's highlighted net, cross-probed to the PCB editor (KiCad
  // sends "$NET: <name>" between the frames; here both are mounted together).
  const [crossProbeNet, setCrossProbeNet] = useState<string | null>(null);
  // Tools > Update PCB from Schematic (F8) from the schematic editor: switch to
  // the PCB frame and bump this, which is what runs the dialog there. KiCad's
  // SCH_EDIT_FRAME::doUpdatePcb hands off to pcbnew the same way.
  const [updatePcbNonce, setUpdatePcbNonce] = useState<number | null>(null);
  const [schMounted, setSchMounted] = useState(false);
  const [pcbMounted, setPcbMounted] = useState(false);
  const [symMounted, setSymMounted] = useState(false);
  const [fpMounted, setFpMounted] = useState(false);
  const [calcMounted, setCalcMounted] = useState(false);
  const [dsMounted, setDsMounted] = useState(false);
  const [imgMounted, setImgMounted] = useState(false);
  const [gbMounted, setGbMounted] = useState(false);
  // "Add symbol to schematic": the symbol editor hands eeschema a symbol to place.
  const [placeRequest, setPlaceRequest] = useState<{ lib: LibSymbol; nonce: number } | null>(null);
  // The file the project manager double-clicked into the footprint / symbol
  // editor (KiCad's MAIL_FP_EDIT / MAIL_LIB_EDIT). Re-sent with a fresh nonce
  // each activation so a resident editor re-opens on the newly-picked file.
  const [fpRequest, setFpRequest] = useState<{ file: string | null; nonce: number } | null>(null);
  const [symRequest, setSymRequest] = useState<{ file: string | null; nonce: number } | null>(null);
  // A .kicad_wks the project manager double-clicked into the Drawing Sheet
  // Editor: its name + content, re-sent with a fresh nonce so a resident editor
  // re-opens on the newly-picked file.
  const [dsRequest, setDsRequest] = useState<{
    name: string;
    text: string;
    nonce: number;
  } | null>(null);
  // Editors stay mounted (display toggled by CSS) but their global hotkey
  // handlers must only act for the visible frame, a keystroke in eeschema
  // must not drive the hidden board editor. Handlers read this stamp.
  useEffect(() => {
    document.body.dataset.activeView = view;
  }, [view]);

  // Restore the last view on reload: reopen the most-recently-opened project
  // (top of Recent) into the saved view, so a refresh doesn't lose your work.
  // On reload, reopen the most-recently-opened project (top of Recent), into
  // the home file manager and, if that's where you were, the editor view too.
  const [restoring, setRestoring] = useState(() => !!loadSession());
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      try {
        const s = loadSession();
        if (!s || !storageAvailable()) return;
        const list = await listProjects();
        const loaded = list[0] ? await loadProject(list[0].id) : null;
        if (!loaded) return;
        setProjectFiles(loaded.files.map(pickedFromStored));
        setStartFile(s.startFile ?? null);
        if (s.view === 'schematic') setSchMounted(true);
        else if (s.view === 'pcb') setPcbMounted(true);
        else if (s.view === 'symbols') setSymMounted(true);
        else if (s.view === 'footprints') setFpMounted(true);
        else if (s.view === 'calculator') setCalcMounted(true);
        else if (s.view === 'drawingsheet') setDsMounted(true);
        else if (s.view === 'image') setImgMounted(true);
        else if (s.view === 'gerber') setGbMounted(true);
        setView(s.view);
      } catch {
        /* fall back to home */
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  // Remember the current view (+ open sheet) so a reload can restore it.
  useEffect(() => {
    if (restoring) return;
    saveSession({ view, startFile });
  }, [view, startFile, restoring]);

  // Autosave: the schematic editor hands us its updated sheets (by basename).
  // Debounce-write just those files back to IndexedDB (preserving the rest), so
  // a reload restores your edits, without touching projectFiles (that would
  // remount/reset the live editor). Names come from the open project.
  const projectFilesRef = useRef(projectFiles);
  projectFilesRef.current = projectFiles;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Pending autosave (file name → bytes), coalesced until the timer fires or a
  // flush forces it out.
  const pendingWrite = useRef<Map<string, Uint8Array>>(new Map());
  const writePending = useCallback(() => {
    const cur = projectFilesRef.current;
    if (!cur || pendingWrite.current.size === 0 || !storageAvailable()) return;
    const files = [...pendingWrite.current].map(([name, bytes]) => ({ name, bytes }));
    pendingWrite.current = new Map();
    void (async () => {
      try {
        const rec = (await listProjects()).find((p) => p.name === projectNameOf(cur));
        if (rec) await updateProjectFiles(rec.id, files);
      } catch {
        /* storage disabled */
      }
    })();
  }, []);
  const onProjectChange = useCallback(
    (changed: PickedFile[]) => {
      const cur = projectFilesRef.current;
      if (!cur || !storageAvailable()) return;
      const fullByBase = new Map(cur.map((f) => [pcbBasename(f.name), f.name]));
      let queued = false;
      for (const f of changed) {
        const full = fullByBase.get(pcbBasename(f.name));
        if (!full) continue;
        pendingWrite.current.set(full, enc.encode(f.text));
        queued = true;
      }
      if (!queued) return;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(writePending, 1200);
    },
    [writePending],
  );
  // Flush any pending autosave now, on leaving an editor and before reopening,
  // so a quick "edit → home → reopen" never reads a stale project.
  const schFlush = useRef<(() => void) | null>(null);
  const registerSchFlush = useCallback((fn: (() => void) | null) => {
    schFlush.current = fn;
  }, []);
  // Edits mirrored into the in-memory project so the home tree (and a reopen
  // from it) reflect them, autosave only writes IndexedDB, which a tree reopen
  // does not re-read. Cleared when a project is (re)opened.
  const liveEdits = useRef<Map<string, string>>(new Map());
  const flushSaves = useCallback(() => {
    schFlush.current?.(); // push the editor's latest serialized sheets into the queue
    clearTimeout(saveTimer.current);
    for (const [name, bytes] of pendingWrite.current)
      liveEdits.current.set(name, dec.decode(bytes));
    writePending();
  }, [writePending]);
  useEffect(() => {
    liveEdits.current.clear();
  }, [projectFiles]);

  // Autosave is debounced by 1.2 s. That is right while someone types and wrong
  // at the moment they leave: an edit followed within the window by a tab
  // close, a reload or a swipe to another app never reached storage. Leaving an
  // editor already flushed; leaving the page did not.
  useEffect(() => installFlushOnHide(flushSaves), [flushSaves]);

  // Persist project files to IndexedDB/cloud immediately (no autosave debounce),
  // used for discrete actions, drawing-sheet reference changes and Save to
  // Project, so a "go back and reopen" reads them straight back.
  const persistFilesNow = useCallback((files: PickedFile[]) => {
    const cur = projectFilesRef.current;
    if (!cur || files.length === 0 || !storageAvailable()) return;
    void (async () => {
      try {
        const rec = (await listProjects()).find((p) => p.name === projectNameOf(cur));
        if (rec)
          await updateProjectFiles(
            rec.id,
            files.map((f) => ({ name: f.name, bytes: enc.encode(f.text) })),
          );
      } catch {
        /* storage disabled */
      }
    })();
  }, []);

  // Drawing Sheet Editor → Save (Save As): write the .kicad_wks into the open
  // project and offer it as a schematic drawing-sheet choice + in the file tree.
  // Place it under the project's folder (the shared path prefix) so it sits
  // alongside the .kicad_sch/.kicad_pcb rather than spawning a stray root entry.
  const onSaveToProject = useCallback(
    (fileName: string, text: string) => {
      const cur = projectFilesRef.current;
      if (!cur) return;
      const name = fileName.includes('/') ? fileName : projectDirPrefix(cur) + fileName;
      setSessionSheets((prev) => [...prev.filter((f) => f.name !== name), { name, text }]);
      persistFilesNow([{ name, text }]);
    },
    [persistFilesNow],
  );

  // Serializes the IndexedDB writes a plot run kicks off (see onOutputFile).
  const outputWrites = useRef<Promise<void>>(Promise.resolve());
  // A generated output file (plot / export) from an editor: drop it into the
  // project, under the project's folder, so it appears in the home file
  // manager (from which the user downloads it to local storage), and persist
  // the raw bytes so it survives a reload. `relPath` is relative to the project
  // folder and may name a sub-folder ("gerbers/board-F_Cu.gbr").
  const onOutputFile = useCallback((relPath: string, bytes: Uint8Array, mime: string) => {
    const baseName = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const cur = projectFilesRef.current;
    if (!cur) {
      // No project to file it under, fall back to a plain browser download.
      const blob = new Blob([bytes.buffer as ArrayBuffer], {
        type: mime || 'application/octet-stream',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = baseName.split('/').pop() || 'plot';
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
    const prefix = projectDirPrefix(cur);
    const name = prefix && baseName.startsWith(prefix) ? baseName : prefix + baseName;
    const file: PickedFile = { name, text: '', bytes };
    setProjectFiles((prev) => [...(prev ?? []).filter((f) => f.name !== name), file]);
    if (!storageAvailable()) return;
    // A plot run writes a whole set of files back-to-back (one Gerber per
    // layer). updateProjectFiles is a read-modify-write of the one project
    // record, so overlapping calls would each start from a stale copy and the
    // last write would drop the others, chain them instead.
    outputWrites.current = outputWrites.current
      .then(async () => {
        const rec = (await listProjects()).find((p) => p.name === projectNameOf(cur));
        if (rec) await updateProjectFiles(rec.id, [{ name, bytes }]);
      })
      .catch(() => {
        /* storage disabled */
      });
  }, []);

  // The active project's .kicad_pro (full name), validated against the open
  // files; defaults to the first .kicad_pro. `activeBase` scopes every editor.
  const activeProName = useMemo(() => {
    if (!projectFiles) return null;
    const pros = projectFiles.filter((f) => /\.kicad_pro$/i.test(f.name)).map((f) => f.name);
    return (activePro && pros.includes(activePro) ? activePro : pros[0]) ?? null;
  }, [projectFiles, activePro]);
  const activeBase = activeProName ? projBaseOf(activeProName) : '';

  const pcbFile = useMemo<PickedFile | null>(() => {
    if (standalonePcb) return standalonePcb;
    if (!projectFiles) return null;
    const boards = projectFiles.filter((f) => /\.kicad_pcb$/i.test(f.name));
    // The active project's board, else any board (single-project projects).
    return boards.find((f) => activeBase && inProject(f.name, activeBase)) ?? boards[0] ?? null;
  }, [projectFiles, standalonePcb, activeBase]);
  const hasSchematic = useMemo(
    () => !!projectFiles?.some((f) => /\.kicad_sch$/i.test(f.name)),
    [projectFiles],
  );
  // The folder's identity (first .kicad_pro), stable across in-folder project
  // switches, so it keys the "new project opened" reset without self-firing.
  const folderName = useMemo(
    () =>
      projectFiles
        ? projectNameOf(projectFiles)
        : standalonePcb
          ? pcbBasename(standalonePcb.name).replace(/\.kicad_pcb$/i, '')
          : '',
    [projectFiles, standalonePcb],
  );
  // KiCad shows "<project>, <Editor>" in the window title; we put it in the
  // menu bar. With several projects in a folder, it names the active one.
  const projectName = activeBase || folderName;

  // The crash screen's "download your project before reloading" is the whole
  // point of `recovery.ts`, and nothing had ever registered a provider — so it
  // always found nothing and told the user *"No open project was in memory, so
  // nothing was lost"*, then offered to reload. That reassurance was false and
  // the reload discarded the work.
  useEffect(() => {
    setRecoveryProvider(() => {
      // Serialise whatever the open editor is holding first, so the zip is not
      // a debounce-window behind the crash. It writes to storage too, which on
      // this path is welcome; a throw here must not cost us the rest.
      try {
        schFlush.current?.();
      } catch {
        /* the app is already broken; take what is already queued */
      }
      return recoverySnapshotFrom(
        projectName,
        projectFilesRef.current,
        liveEdits.current,
        pendingWrite.current,
      );
    });
    return () => setRecoveryProvider(null);
  }, [projectName]);

  // The views without an editor frame of their own name the tab from here;
  // each editor claims it through the same hook while it is the one on screen.
  useDocumentTitle('home', formatTitle('Project Manager', projectName));
  useDocumentTitle('calculator', formatTitle('PCB Calculator'));
  useDocumentTitle('image', formatTitle('Image Converter'));

  // A different project folder drops any drawing sheets saved into the previous
  // one, and resets the active project to its default (first .kicad_pro).
  useEffect(() => {
    setSessionSheets([]);
    setActivePro(null);
  }, [folderName]);

  // Switch the active project (double-clicking another .kicad_pro in the tree).
  // Like KiCad's PROJECT_TREE_ITEM::Activate → LoadProject: it only makes that
  // project active and re-roots the manager tree; it does NOT launch an editor.
  // Setting activePro re-scopes every editor's root for the next time one opens.
  const switchProject = useCallback((proFullName: string) => {
    setActivePro(proFullName);
  }, []);

  const goHome = useCallback(() => {
    flushSaves(); // persist pending edits before the tree/reopen can read them
    setView('home');
  }, [flushSaves]);
  const showPcb = useCallback(() => {
    setPcbMounted(true);
    setView('pcb');
  }, []);
  const showSchematic = useCallback(() => {
    setSchMounted(true);
    setView('schematic');
  }, []);
  // Edit with Symbol Editor, both legs. The schematic hands a library-shaped
  // symbol over and remembers which placement it came from; the symbol editor
  // hands the edit back and eeschema applies it.
  const [symFromSchematic, setSymFromSchematic] = useState<{
    symbol: LibSymbol;
    unit: number;
    bodyStyle: number;
    nonce: number;
  } | null>(null);
  const [editedSymbol, setEditedSymbol] = useState<{
    symbol: LibSymbol;
    targetId: string;
    nonce: number;
  } | null>(null);
  const editTargetId = useRef<string | null>(null);

  const editSymbolInEditor = useCallback(
    (req: { symbol: LibSymbol; unit: number; bodyStyle: number; targetId: string }) => {
      editTargetId.current = req.targetId;
      setSymMounted(true);
      setView('symbols');
      setSymFromSchematic((prev) => ({
        symbol: req.symbol,
        unit: req.unit,
        bodyStyle: req.bodyStyle,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
    },
    [],
  );

  const saveSymbolToSchematic = useCallback((sym: LibSymbol) => {
    const targetId = editTargetId.current;
    if (!targetId) return;
    setEditedSymbol((prev) => ({ symbol: sym, targetId, nonce: (prev?.nonce ?? 0) + 1 }));
    // Upstream returns to the schematic on save, which is also the only way to
    // see whether the edit did what you wanted.
    setSchMounted(true);
    setView('schematic');
  }, []);

  const showSymbolEditor = useCallback(() => {
    setSymMounted(true);
    setView('symbols');
  }, []);
  const showFootprintEditor = useCallback(() => {
    setFpMounted(true);
    setView('footprints');
  }, []);
  const showCalculator = useCallback(() => {
    setCalcMounted(true);
    setView('calculator');
  }, []);

  // The symbol editor's SCH_ACTIONS::addSymbolToSchematic: switch to eeschema
  // with the symbol attached to the cursor for placement.
  const addSymbolToSchematic = useCallback((lib: LibSymbol) => {
    setSchMounted(true);
    setView('schematic');
    setPlaceRequest((prev) => ({ lib, nonce: (prev?.nonce ?? 0) + 1 }));
  }, []);

  if (restoring) {
    return (
      <div
        className="ze-app"
        style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div className="ze-loading-card">
          <span className="ze-spinner" />
          <span>Restoring your project…</span>
        </div>
      </div>
    );
  }

  if (view === 'home') {
    // Keep the open project visible in the manager tree on return from an editor,
    // including any .kicad_wks saved into it this session (not yet in projectFiles).
    // Overlay flushed edits (liveEdits) so a reopen from the tree sees them, and
    // append any .kicad_wks saved into the project this session.
    const edited = projectFiles
      ? projectFiles.map((f) =>
          liveEdits.current.has(f.name)
            ? { name: f.name, text: liveEdits.current.get(f.name)! }
            : f,
        )
      : null;
    const base = edited ?? (standalonePcb ? [standalonePcb] : null);
    const openFiles =
      base && sessionSheets.length
        ? [...base, ...sessionSheets.filter((s) => !base.some((f) => f.name === s.name))]
        : base;
    return (
      <HomePage
        initialFiles={openFiles}
        activePro={activeProName ?? undefined}
        onSwitchProject={switchProject}
        onOpenSchematic={() => {
          setProjectFiles(null);
          setStandalonePcb(null);
          setStartFile(null);
          setSchMounted(true);
          setView('schematic');
        }}
        onOpenProject={(files, start) => {
          setProjectFiles(files);
          setStandalonePcb(null);
          setStartFile(start ?? null);
          setSchMounted(true);
          setView('schematic');
        }}
        onOpenPcb={(file, files) => {
          if (files) {
            setProjectFiles(files);
            setStandalonePcb(null);
          } else {
            setStandalonePcb(file);
            setProjectFiles(null);
          }
          setPcbMounted(true);
          setView('pcb');
        }}
        onOpenSymbolEditor={(files, startFile) => {
          if (files) {
            setProjectFiles(files);
            setStandalonePcb(null);
          }
          setSymMounted(true);
          setView('symbols');
          setSymRequest((prev) => ({ file: startFile ?? null, nonce: (prev?.nonce ?? 0) + 1 }));
        }}
        onOpenFootprintEditor={(files, startFile) => {
          if (files) {
            setProjectFiles(files);
            setStandalonePcb(null);
          }
          setFpMounted(true);
          setView('footprints');
          setFpRequest((prev) => ({ file: startFile ?? null, nonce: (prev?.nonce ?? 0) + 1 }));
        }}
        onOpenCalculator={() => {
          setCalcMounted(true);
          setView('calculator');
        }}
        onOpenDrawingSheetEditor={(file) => {
          setDsMounted(true);
          setView('drawingsheet');
          if (file)
            setDsRequest((prev) => ({
              name: file.name,
              text: file.text,
              nonce: (prev?.nonce ?? 0) + 1,
            }));
        }}
        onOpenImageConverter={() => {
          setImgMounted(true);
          setView('image');
        }}
        onOpenGerberViewer={() => {
          setGbMounted(true);
          setView('gerber');
        }}
      />
    );
  }

  return (
    <>
      {schMounted && (
        <div style={{ display: view === 'schematic' ? 'contents' : 'none' }}>
          <Suspense fallback={frameLoading('the schematic editor')}>
            <SchematicEditor
              onExitToHome={goHome}
              onShowPcb={pcbFile ? showPcb : undefined}
              onEditSymbolInEditor={editSymbolInEditor}
              editedSymbol={editedSymbol}
              // Tools > Update Schematic from PCB: read the board here, so the
              // schematic editor never has to know the board model — the adapter
              // is the whole coupling between the two.
              readBoardFootprints={
                pcbFile
                  ? async () => {
                      try {
                        // Pulled in on use rather than imported at the top of
                        // this file: statically, it put the whole .kicad_pcb
                        // parser into the entry chunk for every visitor,
                        // including the ones who never open a board.
                        const [{ readBoard }, { parse }, { boardFootprintData }] =
                          await Promise.all([
                            import('@ziroeda/pcbnew'),
                            import('@ziroeda/sexpr'),
                            import('./editors/schematic/back_annotate_source.js'),
                          ]);
                        return boardFootprintData(readBoard(parse(pcbFile.text)));
                      } catch {
                        return null;
                      }
                    }
                  : undefined
              }
              onUpdatePcb={
                pcbFile
                  ? () => {
                      showPcb();
                      setUpdatePcbNonce((n) => (n ?? 0) + 1);
                    }
                  : undefined
              }
              onShowSymbolEditor={showSymbolEditor}
              onShowFootprintEditor={showFootprintEditor}
              onShowCalculator={showCalculator}
              initialProject={projectFiles}
              initialFile={startFile}
              rootPro={activeBase || undefined}
              placeRequest={placeRequest}
              onProjectChange={onProjectChange}
              // Whether edits actually reach storage. `onProjectChange` is always
              // passed but no-ops without an open project or without IndexedDB,
              // and the editor cannot see that from its side — so it is told,
              // rather than left to infer that its work is being saved.
              autosaveActive={!!projectFiles && storageAvailable()}
              onPersistFiles={persistFilesNow}
              onOutputFile={onOutputFile}
              registerAutosaveFlush={registerSchFlush}
              extraSheetFiles={sessionSheets}
              projectName={projectName}
              onCrossProbeNet={setCrossProbeNet}
            />
          </Suspense>
        </div>
      )}
      {pcbMounted && pcbFile && (
        <div style={{ display: view === 'pcb' ? 'contents' : 'none' }}>
          <Suspense fallback={frameLoading('the board editor')}>
            <PcbEditor
              fileName={pcbBasename(pcbFile.name)}
              text={pcbFile.text}
              onExit={goHome}
              onShowSchematic={hasSchematic ? showSchematic : undefined}
              onShowFootprintEditor={showFootprintEditor}
              onBoardChange={(text: string) => onProjectChange([{ name: pcbFile.name, text }])}
              onSaveBoard={(text: string) => {
                const name = pcbFile.name;
                setProjectFiles((prev) =>
                  prev ? prev.map((f) => (f.name === name ? { ...f, text } : f)) : prev,
                );
                persistFilesNow([{ name, text }]);
              }}
              projectName={projectName}
              projectFiles={projectFiles ?? undefined}
              rootPro={activeBase || undefined}
              onPersistFiles={persistFilesNow}
              onOutputFile={onOutputFile}
              crossProbeNet={crossProbeNet}
              updateFromSchematic={updatePcbNonce}
            />
          </Suspense>
        </div>
      )}
      {symMounted && (
        <div style={{ display: view === 'symbols' ? 'contents' : 'none' }}>
          <Suspense fallback={frameLoading('the symbol editor')}>
            <SymbolEditor
              onExitToHome={goHome}
              initialProject={projectFiles}
              onAddSymbolToSchematic={addSymbolToSchematic}
              projectName={projectName}
              openRequest={symRequest}
              schematicSymbol={symFromSchematic}
              onSaveToSchematic={saveSymbolToSchematic}
            />
          </Suspense>
        </div>
      )}
      {fpMounted && (
        <div style={{ display: view === 'footprints' ? 'contents' : 'none' }}>
          <Suspense fallback={frameLoading('the footprint editor')}>
            <FootprintEditor
              onExitToHome={goHome}
              initialProject={projectFiles}
              openRequest={fpRequest}
            />
          </Suspense>
        </div>
      )}
      {calcMounted && (
        <div style={{ display: view === 'calculator' ? 'contents' : 'none' }}>
          <Suspense fallback={frameLoading('the calculator')}>
            <CalculatorTools onExitToHome={goHome} />
          </Suspense>
        </div>
      )}
      {dsMounted && (
        <div style={{ display: view === 'drawingsheet' ? 'contents' : 'none' }}>
          <Suspense fallback={frameLoading('the drawing sheet editor')}>
            <DrawingSheetEditor
              onExitToHome={goHome}
              projectName={projectName}
              onSaveToProject={projectFiles ? onSaveToProject : undefined}
              openRequest={dsRequest}
            />
          </Suspense>
        </div>
      )}
      {imgMounted && (
        <div style={{ display: view === 'image' ? 'contents' : 'none' }}>
          <Suspense fallback={frameLoading('the image converter')}>
            <ImageConverter onExitToHome={goHome} />
          </Suspense>
        </div>
      )}
      {gbMounted && (
        <div style={{ display: view === 'gerber' ? 'contents' : 'none' }}>
          <Suspense fallback={frameLoading('the gerber viewer')}>
            <GerberViewer onExitToHome={goHome} projectName={projectName} />
          </Suspense>
        </div>
      )}
    </>
  );
}
