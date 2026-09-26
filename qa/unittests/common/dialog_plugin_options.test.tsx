// @vitest-environment happy-dom
// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/** DIALOG_PLUGIN_OPTIONS (common/dialogs/dialog_plugin_options.cpp). */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIALOG_PLUGIN_OPTIONS,
  INITIAL_HELP,
  pluginOptionsResult,
  pluginOptionsRows,
} from '@ziroeda/common/dialogs/dialog_plugin_options.js';

afterEach(cleanup);

describe('TransferDataToWindow / FromWindow', () => {
  it('one option lands in the first row', () => {
    expect(pluginOptionsRows('a=1')).toEqual([{ name: 'a', value: '1' }]);
  });

  it('keeps upstream’s never-advancing row: every option is written to row 0', () => {
    // dialog_plugin_options.cpp:101-107 - `row` is never incremented, so the
    // last option (in std::map order) is the one left in row 0.
    expect(pluginOptionsRows('b=2|a=1')).toEqual([
      { name: 'b', value: '2' },
      { name: '', value: '' },
    ]);
  });

  it('formats every named row, trimmed and sorted, with the separator escaped', () => {
    expect(
      pluginOptionsResult([
        { name: ' z ', value: ' 3 ' },
        { name: '', value: 'ignored' },
        { name: 'a', value: 'x|y' },
      ]),
    ).toBe('a=x\\|y|z=3');
  });
});

describe('DIALOG_PLUGIN_OPTIONS', () => {
  it('is titled for the library and starts with the initial help', () => {
    render(
      <DIALOG_PLUGIN_OPTIONS
        nickname="MyLib"
        pluginOptions={new Map()}
        formattedOptions=""
        onResult={() => {}}
      />,
    );
    expect(screen.getByText("Options for Library 'MyLib'")).toBeTruthy();
    expect(document.body.innerHTML).toContain('Append Selected Option</b> button.');
    expect(INITIAL_HELP).toContain('<b>Option Choice</b>');
  });

  it('appends a chosen option into the first empty row and returns it on OK', () => {
    const onResult = vi.fn();
    render(
      <DIALOG_PLUGIN_OPTIONS
        nickname="L"
        pluginOptions={new Map([['flag', '<p>help for flag</p>']])}
        formattedOptions=""
        onResult={onResult}
      />,
    );
    fireEvent.click(screen.getByRole('option', { name: 'flag' }));
    expect(document.body.innerHTML).toContain('help for flag');
    fireEvent.click(screen.getByRole('button', { name: /Append Selected Option/ }));
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onResult).toHaveBeenCalledWith('flag');
  });
});

describe('the symbol library table opens it on a double-click in Options', () => {
  it('is wired as LIB_TABLE_GRID_TRICKS::handleDoubleClick does', () => {
    const src = readFileSync(
      resolve(process.cwd(), '../designer/src/widgets/dialog_sym_lib_table.tsx'),
      'utf8',
    );
    expect(src).toContain('onDoubleClick={() => setOptionsRow(i)}');
    expect(src).toContain('<DIALOG_PLUGIN_OPTIONS');
  });
});
