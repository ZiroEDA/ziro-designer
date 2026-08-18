// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * What `SchematicEditor` hands the clipboard, and what it refuses to cut.
 *
 * `parsePastedText`'s options carry the three things `SCH_EDITOR_CONTROL::Paste`
 * reads off the frame — the paste mode the annotation toggle implies
 * (sch_editor_control.cpp:2203), the whole hierarchy that reference uniqueness
 * is measured against (:2222/:2249), and the project's annotation settings
 * (:2604-2606). All three default to something sane inside eeschema, which is
 * exactly what makes a missed call site invisible: plain Ctrl+V used to pass no
 * options at all, so it silently re-annotated with the wrong settings against
 * the wrong sheet set, and no type error or test said so.
 *
 * The file is read as text because `qa`'s tsconfig cannot compile a `.tsx`;
 * `canvas_props_wired.test.ts` covers the same blind spot the same way.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const EDITOR = readFileSync(
  fileURLToPath(
    new URL('../../../designer/src/editors/schematic/SchematicEditor.tsx', import.meta.url),
  ),
  'utf8',
);

describe('every paste path goes through pasteOptions()', () => {
  it('has at least the four call sites paste is reachable from', () => {
    // Ctrl+V, the Edit menu's Paste, Paste Special, Import Sheet, Duplicate.
    expect([...EDITOR.matchAll(/parsePastedText\(/g)].length).toBeGreaterThanOrEqual(4);
  });

  it('and not one of them calls parsePastedText without them', () => {
    // Each call is either `parsePastedText(text, doc, pasteOptions(...))` on one
    // line, or broken across lines with `pasteOptions(` as the third argument.
    const calls = [...EDITOR.matchAll(/parsePastedText\((?:[^()]|\([^()]*\))*\)/g)].map(
      (m) => m[0],
    );
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const call of calls) expect(call, call).toContain('pasteOptions(');
  });
});

describe('pasteOptions derives the mode from the annotation toggle', () => {
  it("is 'unique' with automatic annotation on and 'remove' with it off", () => {
    // `pasteMode = annotateAutomatic ? UNIQUE_ANNOTATIONS : REMOVE_ANNOTATIONS`
    // (:2203). With the toggle off KiCad clears the pasted designators rather
    // than renumbering them.
    expect(EDITOR).toMatch(
      /defaultMode: PasteMode = es\.annotation\.automatic \? 'unique' : 'remove'/,
    );
  });

  it('passes the hierarchy, not just the open sheet', () => {
    expect(EDITOR).toMatch(/hierarchy: annotateSheets\('all', true\)/);
  });

  it('and the project annotation settings and designator tracker', () => {
    const body = EDITOR.slice(EDITOR.indexOf('const pasteOptions = useCallback'));
    expect(body).toContain('setup.annotation.sortOrder');
    expect(body).toContain('setup.annotation.firstFreeAfter');
    expect(body).toContain('tracker');
  });
});

describe('Cut refuses what the clipboard cannot carry', () => {
  // A deliberate, temporary divergence from KiCad, whose Cut always succeeds
  // because doCopy carries sheets in m_supplementaryClipboard (:1667) and Paste
  // rebuilds them (:2377-2472). Until that lands, `copySelectionText` writes
  // `sheets: []`, so a Ctrl+X on a sheet wrote an empty clipboard string, called
  // preventDefault(), and then deleted the sheet: gone, with no paste path back.
  const onCut = (): string => {
    const i = EDITOR.indexOf('const onCut = (e: ClipboardEvent)');
    expect(i, 'SchematicEditor must still install an onCut handler').toBeGreaterThan(-1);
    return EDITOR.slice(i, EDITOR.indexOf('\n    };', i));
  };

  it('bails out before deleting when the selection holds a sheet', () => {
    const body = onCut();
    const guard = body.indexOf("refId('sheet'");
    const del = body.indexOf('runCommand(deleteItems');
    expect(guard, 'onCut must test the selection for sheets').toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(-1);
    expect(guard, 'the sheet guard must come before the delete').toBeLessThan(del);
    expect(body.slice(guard, del)).toContain('return;');
  });

  it('and says so instead of failing silently', () => {
    expect(onCut()).toContain('setInfoBar(');
  });

  it('names the follow-up so nobody reads it as the target behaviour', () => {
    expect(onCut()).toContain('TEMPORARY DIVERGENCE');
    expect(onCut()).toContain('m_supplementaryClipboard');
  });
});

describe('Copy leaves the system clipboard alone when it has nothing to say', () => {
  it('does not overwrite it with an empty string', () => {
    const i = EDITOR.indexOf('const onCopy = (e: ClipboardEvent)');
    const body = EDITOR.slice(i, EDITOR.indexOf('\n    };', i));
    expect(body).toContain("if (text === '') return;");
  });
});
