// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `Save Current Sheet Copy As...` — SCH_ACTIONS::saveCurrSheetCopyAs, handled
 * by SCH_EDITOR_CONTROL::SaveCurrSheetCopyAs (sch_editor_control.cpp:426-442)
 * through SCH_EDIT_FRAME::saveSchematicFile (files-io.cpp:989-1081).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureFileExtension, KICAD_SCHEMATIC_FILE_EXTENSION } from '@ziroeda/common';
import { savedFileMessage } from '@ziroeda/designer/src/editors/schematic/files_io.js';

const EDITOR = join(__dirname, '../../../designer/src/editors/schematic/SchematicEditor.tsx');
const MENUBAR = join(__dirname, '../../../designer/src/editors/schematic/menubar.ts');

describe('EnsureFileExtension (common/common.cpp:662-678)', () => {
  const ext = KICAD_SCHEMATIC_FILE_EXTENSION;

  it('appends the extension to a bare name', () => {
    expect(ensureFileExtension('power', ext)).toBe('power.kicad_sch');
  });

  it('leaves a name that already has it alone', () => {
    expect(ensureFileExtension('power.kicad_sch', ext)).toBe('power.kicad_sch');
  });

  it("keeps after-dot text that is not an extension - upstream's own example", () => {
    // "be careful not to destroy existing after-dot-text that isn't actually a
    // bad extension, such as 'Schematic_1.1'" (common.cpp:667-668)
    expect(ensureFileExtension('Schematic_1.1', ext)).toBe('Schematic_1.1.kicad_sch');
  });

  it('does not add a second dot to a name already ending in one', () => {
    expect(ensureFileExtension('power.', ext)).toBe('power.kicad_sch');
  });

  it("compares case-insensitively but preserves the caller's casing", () => {
    // The C++ tests `newFilename.Lower().AfterLast('.')` and returns
    // `newFilename`, which was never lower-cased.
    expect(ensureFileExtension('POWER.KICAD_SCH', ext)).toBe('POWER.KICAD_SCH');
  });

  it('replaces a different extension rather than keeping it', () => {
    expect(ensureFileExtension('power.sch', ext)).toBe('power.sch.kicad_sch');
  });

  it('the extension constant carries no leading dot, as FILEEXT does', () => {
    expect(KICAD_SCHEMATIC_FILE_EXTENSION).toBe('kicad_sch');
  });
});

describe('the status message (files-io.cpp:1073)', () => {
  it("is _( \"File '%s' saved.\" ) with upstream's straight quotes", () => {
    expect(savedFileMessage('power.kicad_sch')).toBe("File 'power.kicad_sch' saved.");
  });
});

/*
 * The two behaviours that make this command different from Save As, both of
 * which are only visible in the handler. Checked in the source per OCCURRENCE
 * rather than by asserting the file "mentions" something: the whole risk here
 * is a later edit adding a `setCurrentFile` three lines below the comment that
 * says it must not.
 */
describe('the command does not retarget the editor at the copy', () => {
  const body = (): string => {
    const src = readFileSync(EDITOR, 'utf8');
    const start = src.indexOf('const saveCurrSheetCopyAs = useCallback(');
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n  }, [', start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
  };

  it('never sets the current file, so the title and the open document stand', () => {
    // saveSchematicFile never calls screen->SetFileName(), so the editor goes
    // on editing the original.
    expect(body()).not.toMatch(/setCurrentFile\s*\(/);
  });

  it('never renames the loaded document', () => {
    expect(body()).not.toMatch(/setFileName\s*\(/);
  });

  it('clears the modified flag, as screen->SetContentModified( false ) does', () => {
    // Mirrored deliberately even though the original was not written - see the
    // comment on the handler.
    expect(body()).toMatch(/setDirty\(false\)/);
    expect(body()).toMatch(/setUnsaved\(false\)/);
  });

  it('status-bars the ORIGINAL name, not the copy', () => {
    // msg.Printf( "File '%s' saved.", screen->GetFileName() ) - the screen was
    // never renamed, so this is the seed, never `newFilename`.
    expect(body()).toMatch(/setStatusText\(savedFileMessage\(seed\)\)/);
    expect(body()).not.toMatch(/savedFileMessage\(newFilename\)/);
  });

  it('writes the copy under the new name, though', () => {
    expect(body()).toMatch(/name:\s*newFilename/);
    expect(body()).toMatch(/a\.download = newFilename/);
  });
});

describe('the menu entry', () => {
  it('is live, not a stub, and reads what SCH_ACTIONS calls it', () => {
    const src = readFileSync(MENUBAR, 'utf8');
    expect(src).toMatch(
      /act\('Save Current Sheet Copy As\.\.\.', 'saveAs', 'saveCurrSheetCopyAs'\)/,
    );
    expect(src).not.toMatch(/stub\('Save Current Sheet Copy As/);
  });

  it('carries no hotkey, because the action declares no DefaultHotkey', () => {
    const src = readFileSync(MENUBAR, 'utf8');
    const line = src.split('\n').find((l) => l.includes("'saveCurrSheetCopyAs'")) ?? '';
    // act( label, icon, id ) with no fourth argument.
    expect(line).toMatch(/act\('[^']+', '[^']+', '[^']+'\),/);
  });
});
