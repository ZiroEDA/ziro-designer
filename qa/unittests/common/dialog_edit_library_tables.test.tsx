// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/** DIALOG_EDIT_LIBRARY_TABLES (common/dialogs/dialog_edit_library_tables.cpp). */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DIALOG_EDIT_LIBRARY_TABLES } from '@ziroeda/common/dialogs/dialog_edit_library_tables.js';

afterEach(cleanup);

describe('DIALOG_EDIT_LIBRARY_TABLES', () => {
  it('frames the installed panel under the caller’s title, with OK and Cancel', () => {
    const onOK = vi.fn();
    const onCancel = vi.fn();
    render(
      <DIALOG_EDIT_LIBRARY_TABLES title="Symbol Libraries" onOK={onOK} onCancel={onCancel}>
        <div>panel</div>
      </DIALOG_EDIT_LIBRARY_TABLES>,
    );
    expect(screen.getByText('Symbol Libraries')).toBeTruthy();
    expect(screen.getByText('panel').parentElement?.className).toContain('ze-libtables-content');
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOK).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('is what Manage Symbol Libraries installs its panel into', () => {
    const src = readFileSync(
      resolve(process.cwd(), '../designer/src/widgets/dialog_sym_lib_table.tsx'),
      'utf8',
    );
    expect(src).toContain('<DIALOG_EDIT_LIBRARY_TABLES');
    expect(src).toContain('title="Symbol Libraries"');
  });
});
