// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * DIALOG_DRC::OnSaveReport asks with a save-mode wxFileDialog
 * (dialog_drc.cpp:1154-1156), never the browser's prompt().
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsonFileWildcard, reportFileWildcard } from '@ziroeda/common/wildcards_and_files_ext.js';

const src = readFileSync(
  resolve(process.cwd(), '../designer/src/editors/pcb/PcbEditor.tsx'),
  'utf8',
);

describe('Save Report File', () => {
  it('is the file chooser in save mode, on the report and JSON wildcards', () => {
    expect(src).toContain('title="Save Report File"');
    expect(src).toContain('filters={[reportFileWildcard(), jsonFileWildcard()]}');
    expect(src).not.toMatch(/prompt\('Save Report File'/);
  });

  it('offers FILEEXT’s extensions', () => {
    expect(reportFileWildcard().extensions).toEqual(['rpt']);
    expect(jsonFileWildcard().extensions).toEqual(['json']);
  });
});
