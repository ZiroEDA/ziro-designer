// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * A reload must never cost work — whatever caused the reload.
 *
 * Reported against real editing: "when i doing some editing in the circuit and
 * the page hot reloads in between my whole editing gets lost … I have never
 * seen my any changes getting automatically reverted in canvas no matter how
 * much I reload."
 *
 * The debounce window was never the whole story. The open project lived in
 * `App`'s `projectFiles` state, autosave wrote only IndexedDB and never touched
 * it, and both editors keyed "load the project" on the IDENTITY of that array.
 * So every unrelated `setProjectFiles` — a plot output file, a Ctrl+S in the
 * board editor, a reopen from the home tree, an editor remounting after a hot
 * patch — re-ran `loadProject`, which throws away the document, the undo
 * histories and the view and rebuilds them from the file as it was OPENED. The
 * editor's own autosave then serialised that revert over the good copy in
 * storage, so the loss was permanent and silent.
 *
 * The fix has two halves, and both are pinned here:
 *
 *  - the in-memory project carries the edits, so anything that re-reads it
 *    (the tree, a reopen, a remount) sees the work and not the file;
 *  - opening a project is an ACTION, signalled by `openNonce`, exactly as
 *    upstream's `OpenProjectFiles` is called by one — never a binding to a data
 *    structure that anything else may write.
 *
 * Plus the two smaller holes the same report exposed: pcbnew had no registered
 * flush at all, so leaving the frame, hiding the tab, unloading the page and
 * the crash-recovery zip could each force eeschema out and had nothing for the
 * board; and the local write sat on the cloud push's debounce.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '../../../designer/src');
const APP = readFileSync(join(SRC, 'App.tsx'), 'utf8');
const SCH = readFileSync(join(SRC, 'editors/schematic/SchematicEditor.tsx'), 'utf8');
const PCB = readFileSync(join(SRC, 'editors/pcb/PcbEditor.tsx'), 'utf8');
const SYM = readFileSync(join(SRC, 'editors/symbol/SymbolEditor.tsx'), 'utf8');
const FP = readFileSync(join(SRC, 'editors/footprint/FootprintEditor.tsx'), 'utf8');

/** The body of a `const <name> = useCallback(…)`, up to its dependency array. */
function body(src: string, name: string): string {
  const start = src.indexOf(`const ${name} =`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const end = src.indexOf('\n  }, [', start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

/** The `useEffect` containing `needle`, from its `useEffect(` to its deps. */
function effectAround(src: string, needle: string): { code: string; deps: string } {
  const i = src.indexOf(needle);
  expect(i, `${needle} not found`).toBeGreaterThan(-1);
  const start = src.lastIndexOf('useEffect(', i);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('}, [', i);
  expect(end).toBeGreaterThan(i);
  const depsEnd = src.indexOf(']', end);
  return { code: src.slice(start, end), deps: src.slice(end + 3, depsEnd + 1) };
}

/** The JSX attributes of `<Name … />`. */
function element(src: string, name: string): string {
  const start = src.indexOf(`<${name}\n`);
  expect(start, `<${name}> not found`).toBeGreaterThan(-1);
  // The closing `/>` on its own line, at whatever depth the element sits.
  const close = /\n\s*\/>/g;
  close.lastIndex = start;
  const m = close.exec(src);
  expect(m, `<${name}> never closes`).not.toBeNull();
  return src.slice(start, m!.index);
}

describe('the in-memory project is the freshest copy, not the file as opened', () => {
  const queue = (): string => body(APP, 'onProjectChange');

  it('records an edit as it is QUEUED, not only when a flush happens to run', () => {
    // It used to be filled by `flushSaves` alone, from whatever was sitting in
    // `pendingWrite` at that instant. Everything the debounce timer had already
    // written was cleared from that queue and never landed here, so the home
    // tree and a reopen from it served the file as it was opened.
    expect(queue()).toContain('liveEdits.current.set(');
    expect(queue()).toContain('pendingWrite.current.set(');
  });

  it('mirrors the edit into the project the editors are handed', () => {
    // This is what makes a remount — a hot patch, a re-suspended chunk — come
    // back up on the user's work instead of on the opened file.
    expect(queue()).toContain('setProjectFiles(');
  });

  it('hands the same array back when nothing moved, so idle re-serialization is free', () => {
    // The editors re-serialize identical content on a sheet switch; a fresh
    // array for that would re-render every mounted frame for no change.
    expect(queue()).toMatch(/if \(!prev\.some\(.*\)\) return prev;/s);
  });

  it('drops those edits when a different project is opened, and at no other time', () => {
    // The clear lived in `useEffect(() => liveEdits.current.clear(), [projectFiles])`,
    // which fired on the very state change that now carries the edits.
    const clears = [...APP.matchAll(/liveEdits\.current\.clear\(\)/g)];
    expect(clears).toHaveLength(1);
    expect(body(APP, 'openProjectFiles')).toContain('liveEdits.current.clear()');
  });
});

describe('opening a project is an action, not a binding (OpenProjectFiles)', () => {
  it('every deliberate open goes through openProjectFiles, which bumps the nonce', () => {
    expect(body(APP, 'openProjectFiles')).toContain('setOpenNonce(');
    // The writers that must NOT reopen: a plot output file and the board
    // editor's Ctrl+S both write the project without opening anything.
    expect(body(APP, 'onOutputFile')).not.toContain('openProjectFiles(');
    expect(element(APP, 'PcbEditor')).toContain('onSaveBoard');
    expect(element(APP, 'PcbEditor')).not.toContain('openProjectFiles(');
  });

  it('both editors are told when an open happens', () => {
    expect(element(APP, 'SchematicEditor')).toContain('openNonce={openNonce}');
    expect(element(APP, 'PcbEditor')).toContain('openNonce={openNonce}');
  });

  it('eeschema re-reads the project only on an open, never on a new array', () => {
    const { code, deps } = effectAround(SCH, 'openedKey.current !== key');
    expect(deps).toContain('openNonce');
    // Not the array's identity, which autosave now moves on every settle.
    expect(deps).not.toContain('initialProject');
    // Guarded: the effect still reseeds the raw files and Schematic Setup from
    // the prop, but `loadProject` — which discards the document and the undo
    // histories — runs only when the host says it opened something, and only
    // while the frame is the one on screen (`shown`): a hidden frame takes the
    // open when it is next shown, rather than parsing behind the visible one.
    expect(code).toMatch(
      /if \(shown && openedKey\.current !== key\) \{[\s\S]*void loadProject\(files/,
    );
    expect(deps).toContain('shown');
  });

  it('a hidden frame does not read the open; it reads it when shown', () => {
    // pcbnew: the parse is skipped while hidden, and the open it has read is
    // remembered so being shown again does not read it twice.
    const { code, deps } = effectAround(PCB, 'readBoard(parse(textRef.current))');
    expect(deps).toContain('shown');
    expect(code).toMatch(/if \(!shown\) return;/);
    expect(code).toMatch(/if \(parsedOpen\.current === open\) return;/);
    // App says which frame is on screen, to both.
    expect(element(APP, 'SchematicEditor')).toContain("shown={view === 'schematic'}");
    expect(element(APP, 'PcbEditor')).toContain("shown={view === 'pcb'}");
  });

  it('pcbnew parses the board only on an open, and reads the live text by ref', () => {
    const { code, deps } = effectAround(PCB, 'readBoard(parse(textRef.current))');
    expect(deps).toContain('openNonce');
    expect(deps).not.toMatch(/\btext\b(?!Ref)/);
    expect(code).toContain('textRef.current');
  });
});

describe('every editor that autosaves can be forced to flush', () => {
  it('the host keeps one slot per editor, not a single schematic-shaped one', () => {
    expect(APP).toContain("registerFlushFor('schematic')");
    expect(APP).toContain("registerFlushFor('pcb')");
    expect(body(APP, 'flushEditors')).toContain('editorFlush.current.values()');
  });

  it('the board editor is given one — it had none, so its last second was unreachable', () => {
    expect(element(APP, 'PcbEditor')).toContain('registerAutosaveFlush={registerPcbFlush}');
    const { code } = effectAround(PCB, 'registerAutosaveFlush((');
    expect(code).toContain('serializeBoard(brd)');
    expect(code).toContain('onBoardChange(');
  });

  it('leaving the page and the crash zip both run every editor, not just eeschema', () => {
    expect(body(APP, 'flushSaves')).toContain('flushEditors()');
    const recovery = APP.slice(APP.indexOf('setRecoveryProvider(() =>'));
    expect(recovery.slice(0, recovery.indexOf('recoverySnapshotFrom'))).toContain('flushEditors()');
  });

  it('one editor throwing does not stop the others, on the last callback there is', () => {
    expect(body(APP, 'flushEditors')).toMatch(/try \{[\s\S]*\} catch/);
  });
});

describe('the local write is not on the cloud push’s schedule', () => {
  const ms = (name: string): number => {
    const m = APP.match(new RegExp(`const ${name} = (\\d+);`));
    expect(m, `${name} not found`).not.toBeNull();
    return Number(m![1]);
  };

  it('IndexedDB settles quickly; only the network request waits', () => {
    // The 1.2 s local debounce was the cloud argument applied to the wrong
    // store, and it sat on top of the editors' own 900 ms / 1 s, making the
    // unrecoverable window 2.2 s wide.
    expect(ms('LOCAL_WRITE_IDLE_MS')).toBeLessThan(ms('CLOUD_PUSH_IDLE_MS'));
    expect(ms('LOCAL_WRITE_IDLE_MS')).toBeLessThanOrEqual(500);
    expect(body(APP, 'onProjectChange')).toContain('setTimeout(writePending, LOCAL_WRITE_IDLE_MS)');
  });
});

/**
 * A launcher click on the open project RAISES the frame; the frames outlive
 * the manager; and the two big ones are built before they are asked for.
 *
 * Measured on this machine's GPU with qa/probes/reopen_timeline.mjs, ecc83:
 * a reopen went from ~250 ms with a full re-read (and the undo history gone)
 * to 30-50 ms; a first open from ~600 ms to ~100. Each of the four rules
 * below is one of the things that makes that true, and each was found by
 * measuring what happened without it.
 */
describe('the manager raises an open project; it does not re-open it', () => {
  it('a launcher hands the same files back, and that is a raise, not an open', () => {
    // KICAD_MANAGER_CONTROL::ShowPlayer with the frame already up: Raise().
    const raise = body(APP, 'raiseOrOpen');
    // Same set: names AND text, so a file the manager changed is a real open.
    expect(raise).toMatch(/f\.name === shown\[i\]!\.name && f\.text === shown\[i\]!\.text/);
    // A different startFile is a real open too.
    expect(raise).toMatch(/\(start \?\? null\) === startFileRef\.current/);
    expect(raise).toMatch(/if \(same\) return;\s*openProjectFiles\(files\);/);
    // The four project launchers go through it; only "no project" opens do not.
    expect(APP).toMatch(
      /onOpenProject=\{\(files, start, demo\) => \{\s*raiseOrOpen\(files, start\);/,
    );
    expect(APP.match(/raiseOrOpen\(files\);/g)?.length).toBe(3);
  });

  it('the manager is rendered beside the frames, never instead of them', () => {
    // `return <HomePage` in the home branch unmounted every editor on every
    // trip home; that was the whole cost of the second open.
    expect(APP).not.toMatch(/if \(view === 'home'\) \{[\s\S]*?return \(\s*<HomePage/);
    expect(APP).toMatch(/manager = \(\s*<HomePage/);
    expect(APP).toMatch(/<>\s*\{manager\}/);
  });

  it('a hidden frame keeps its layout: content-visibility, not display:none', () => {
    // display:none discards layout and the reveal re-lays the frame out —
    // 240 ms for the board frame on this GPU against 30-50 with this.
    expect(APP).toMatch(/const HIDDEN_FRAME: CSSProperties = \{\s*contentVisibility: 'hidden'/);
    expect(APP).not.toMatch(/display: view === '[a-z]+' \? 'contents' : 'none'/);
    expect(APP.match(/style=\{frameStyle\(view === '[a-z]+'\)\}/g)?.length).toBe(8);
  });

  it('every frame is built while the manager is up, most-used first', () => {
    expect(APP).toMatch(
      /useEffect\(\s*\(\) => \(view === 'home' \? warmFrames\(mountFor\) : undefined\),\s*\[view, mountFor\],?\s*\)/,
    );
    expect(APP).toMatch(
      /const WARM_ORDER: FrameView\[\] = \[\s*'schematic',\s*'pcb',\s*'symbols',\s*'footprints',\s*'gerber',\s*'drawingsheet',\s*'image',\s*'calculator',?\s*\]/,
    );
    // The board frame can exist before a project does: it is born on the
    // empty board, as PCB_EDIT_FRAME is.
    expect(APP).toMatch(/const boardFile: PickedFile = pcbFile \?\? WARM_BOARD;/);
    expect(APP).toMatch(/\{pcbMounted && \(/);
    expect(APP).not.toMatch(/\{pcbMounted && pcbFile && \(/);
  });

  it('a no-project open on a frame that held a project is "Create Schematic"', () => {
    // The frame outlives the manager, so the launcher pressed with nothing
    // open must not show the last project.
    const { code } = effectAround(SCH, 'openedKey.current !== key');
    expect(code).toMatch(/else if \(!first\) void loadText\(EMPTY_SCH\);/);
  });

  it('a hidden frame is not re-rendered by the host: Frozen hands back the last element', () => {
    // With eight frames warm, every App render reconciled all eight — ~500 ms
    // a click. React skips a child whose element is the same object as last
    // time; Frozen keeps the last shown one while hidden.
    expect(APP).toMatch(
      /function Frozen\(\{ shown, children \}[\s\S]*?if \(shown\) last\.current = children;\s*return last\.current;/,
    );
    expect(APP.match(/<Frozen shown=\{view === '[a-z]+'\}>/g)?.length).toBe(8);
  });

  it('the library editors re-sync the project on the frame that exists, keyed on identity', () => {
    // SYMBOL_EDIT_FRAME::ProjectChanged -> SyncLibraries; never a remount, so
    // a warm frame survives the session's first real open. The key is the
    // rows and file names, not the text an autosave rewrites.
    for (const [src, label] of [
      [SYM, 'symbol'],
      [FP, 'footprint'],
    ] as const) {
      const { code, deps } = effectAround(src, 'manager.current.dropProjectLibraries()');
      expect(deps, label).toBe('[projectLibsKey]');
      expect(code, label).toMatch(
        /setCurLib\(\(lib\) => \(lib && !manager\.current\.libraryExists\(lib\) \? null : lib\)\)/,
      );
    }
    expect(SYM).toMatch(
      /const projectLibsKey = useMemo\([\s\S]*?\$\{row\.name\}\\t\$\{file\.name\}/,
    );
    expect(SYM).not.toMatch(/projectLibsKey[\s\S]{0,400}file\.text/);
    expect(APP).not.toMatch(/<SymbolEditor\s+key=/);
    expect(APP).not.toMatch(/<FootprintEditor\s+key=/);
  });
});
