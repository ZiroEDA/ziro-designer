// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Every modal cancels on Esc, and none of them says so twice.
 *
 * Upstream this needs no per-dialog code at all: a KiCad modal is a
 * `DIALOG_SHIM`, a `DIALOG_SHIM` is a `wxDialog`, and `wxDialogBase::OnCharHook`
 * turns `WXK_ESCAPE` into `wxID_CANCEL`. `common/dialog_shim.cpp:1803` is the
 * only place KiCad touches the key and it does not opt out - a text control
 * with an unsaved edit keeps the first Esc to revert itself, then the event is
 * skipped and the dialog cancels. Nothing in the tree calls `SetEscapeId`, so
 * no dialog upstream refuses it.
 *
 * Ours are React components that each render their own backdrop, so each one
 * has to ask - and that is exactly the kind of thing that drifts. `cab13390`
 * added `ui/modal_escape.ts` and wired seven dialogs to it; sixty-seven stayed
 * silently wrong, and no test noticed for a day. This one walks the tree, so a
 * new dialog that forgets the hook fails here rather than in a bug report.
 *
 * The files are read as text because `qa`'s tsconfig cannot compile `.tsx`,
 * the same reason `canvas_props_wired.test.ts` reads its two.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const SRC = fileURLToPath(new URL('../../../designer/src', import.meta.url));

/** The class names that make an element a modal backdrop, per `shell.css`. */
const BACKDROPS = ['ze-modal-backdrop', 'calc-modal-backdrop', 'imgc-modal-backdrop'];

/**
 * Frames that render a dialog inline and also own a canvas, where Esc is
 * `ACTIONS::cancelInteractive` - abandon the tool - and has nothing to do with
 * any dialog. `WidgetHotkeyList` is here for the mirror image: HK_PROMPT_DIALOG
 * eats every keystroke to assign it, and has to let this one through to the
 * stack rather than assign Esc as a hotkey.
 */
const OWNS_A_CANVAS = [
  '../../pagelayout_editor/pl_editor_frame_ui.tsx',
  '../../pcbnew/footprint_edit_frame_ui.tsx',
  '../../pcbnew/pcb_edit_frame_ui.tsx',
  '../../eeschema/sch_edit_frame_ui.tsx',
  '../../eeschema/symbol_editor/symbol_edit_frame_ui.tsx',
  '../../common/widgets/widget_hotkey_list.tsx',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/**
 * KiCad's shared dialogs live in `common/` (its `common/dialogs` and
 * `common/dialog_about`), and ours have been moving there since 09-26. A walk
 * of `designer/src` alone lost every dialog the moment it moved - they were
 * no longer checked, and nothing failed. Both trees are walked; a `common/`
 * file's `rel` is spelled from `designer/src` (`../../common/...`).
 */
const COMMON = fileURLToPath(new URL('../../../common', import.meta.url));
// Assign Footprints and the two windows it opens moved out of `designer/src`
// into `cvpcb/` (cvpcb/STRUCTURE.md's stage two): same reason `common/` is
// walked alongside `designer/src` above.
const CVPCB = fileURLToPath(new URL('../../../cvpcb', import.meta.url));
// The schematic editor's dialogs started moving out of `designer/src` into
// `eeschema/` (eeschema/STRUCTURE.md's stage E2): same reason again.
const EESCHEMA = fileURLToPath(new URL('../../../eeschema', import.meta.url));
// The PCB and Footprint editors' windows started moving out of `designer/src`
// into `pcbnew/` (pcbnew/STRUCTURE.md's file-structure-parity stage): same
// reason again.
const PCBNEW = fileURLToPath(new URL('../../../pcbnew', import.meta.url));

function walkCommon(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walkCommon(path, out);
    else if (name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

const FILES = [
  ...walk(SRC),
  ...walkCommon(COMMON),
  ...walkCommon(CVPCB),
  ...walkCommon(EESCHEMA),
  ...walkCommon(PCBNEW),
].map((path) => ({
  rel: relative(SRC, path),
  src: readFileSync(path, 'utf8'),
}));

const modalFiles = FILES.filter((f) => BACKDROPS.some((c) => f.src.includes(c)));

describe('every modal gets wxDialog Esc', () => {
  it('finds the modals in the first place', () => {
    // A guard on the guard: a renamed backdrop class would otherwise make this
    // whole file pass by checking nothing.
    expect(modalFiles.length).toBeGreaterThan(70);
  });

  it('registers a cancel with the shared stack', () => {
    // No exemptions. `ui/ProgressDialog.tsx` — WX_PROGRESS_REPORTER, a
    // wxProgressDialog rather than a DIALOG_SHIM — used to be one: it had no
    // Cancel. It has PR_CAN_ABORT's now, and Esc is that button's wxID_CANCEL.
    const missing = modalFiles.filter((f) => !/\buseModalEscape\(/.test(f.src)).map((f) => f.rel);
    expect(missing, 'these render a modal backdrop and never ask for Esc').toEqual([]);
  });

  it('imports the hook it calls', () => {
    // dialog_shim.tsx is where the hook is defined (DIALOG_SHIM), not a caller.
    const unimported = FILES.filter((f) => /\buseModalEscape\(/.test(f.src))
      .filter((f) => !/export function useModalEscape\(/.test(f.src))
      .filter((f) => !/import \{[^}]*\buseModalEscape\b[^}]*\} from/.test(f.src))
      .map((f) => f.rel);
    expect(unimported).toEqual([]);
  });

  it('leaves Esc to the stack rather than handling it again', () => {
    // The ad-hoc handlers this replaced were `onKeyDown` on a modal div or an
    // input, which only fired when focus was already inside - press Esc after
    // clicking the dimmed backdrop and nothing happened. Worse, one that stays
    // behind runs *as well as* the stack, so Esc closes two dialogs at once.
    const stray = modalFiles
      .filter((f) => !OWNS_A_CANVAS.includes(f.rel))
      .filter((f) => /=== 'Escape'|!== 'Escape'/.test(f.src))
      .map((f) => f.rel);
    expect(stray, 'a modal file with its own Escape branch').toEqual([]);
  });
});

describe('what the registered cancel means', () => {
  /** The argument of the first `useModalEscape(...)` in a file. */
  const registered = (rel: string): string[] => {
    const f = FILES.find((x) => x.rel === rel);
    expect(f, `${rel} must exist`).toBeDefined();
    return [...f!.src.matchAll(/\buseModalEscape\(([^;]*)\);/g)].map((m) => m[1]!.trim());
  };

  it('is the Cancel button, not the close, where the two differ', () => {
    // CVPCB's Cancel is `canCloseWindow`: modified links prompt before they go.
    // Registering the bare `onClose` here would throw the user's assignments
    // away without asking, which is the one thing Esc must never do.
    expect(registered('../../cvpcb/cvpcb_mainframe_ui.tsx')).toEqual(['closeWindow']);
    // Same shape in the Symbol Fields Table: `onCancel` confirms, `onClose`
    // does not.
    expect(registered('../../eeschema/dialogs/dialog_symbol_fields_table.tsx')).toEqual([
      'onCancel',
    ]);
    // DIALOG_PRINT's Close stores the print options on the way out.
    expect(registered('../../eeschema/printing/dialog_print.tsx')).toEqual(['saveAndClose']);
    // The board's is DIALOG_PRINT_PCBNEW on the common DIALOG_PRINT_GENERIC:
    // the base registers its Close, and the board's Close runs saveSettings
    // before it closes, as onCancelButtonClick / onClose do.
    expect(registered('../../common/dialogs/dialog_print_generic_ui.tsx')).toEqual(['onClose']);
    expect(
      FILES.find((f) => f.rel === '../../pcbnew/dialogs/dialog_print_pcbnew_ui.tsx')?.src,
    ).toMatch(/onClose=\{\(\) => \{\s*\/\/ onCancelButtonClick \/ onClose: saveSettings first\.\s*const info = dlg\.saveSettings\(\);/);
  });

  it('is not registered at all where the dialog has no Cancel', () => {
    // AuthGate is a required wall: no close button, and a backdrop that does
    // not dismiss. `SetEscapeId( wxID_NONE )` is how wx says the same thing.
    expect(registered('auth/SignIn.tsx')).toEqual(['close, !gate']);
  });

  it('holds the first Esc for the filter box, as PANEL_SYMBOL_CHOOSER does', () => {
    // "First escape cancels search string value" - `panel_symbol_chooser.cpp`
    // :347 - and only then does Esc reach the dialog. The tree registers above
    // the dialog containing it and drops off when the box empties, so the
    // ordering is the stack's rather than a listener race.
    expect(registered('../../common/widgets/lib_tree.tsx')).toEqual([
      `() => onQueryText(''), search !== ''`,
    ]);
  });
});
