// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
import { describe, expect, it } from 'vitest';
import { unmarked } from './unmarked.js';

describe('unmarked', () => {
  it('gives an attribute back its string', () => {
    expect(unmarked(`<StaticText label={_('Line width:')} />`)).toBe(
      '<StaticText label="Line width:" />',
    );
    expect(unmarked(`title={wxGetTranslation('Close')}`)).toBe('title="Close"');
  });

  it('gives a JSX child back its text', () => {
    expect(unmarked(`<legend>{_('Output Size')}</legend>`)).toBe('<legend>Output Size</legend>');
    expect(unmarked(`<span>{ _HKI("Nets") }</span>`)).toBe('<span>Nets</span>');
  });

  it('gives any other call back its literal, in the quotes it had', () => {
    expect(unmarked(`FileDialog(_('Open Zip File'), X)`)).toBe(`FileDialog('Open Zip File', X)`);
    expect(unmarked(`{ label: _HKI("Place"), items }`)).toBe(`{ label: "Place", items }`);
    expect(unmarked(`act(_('Don\\'t'), 'id')`)).toBe(`act('Don\\'t', 'id')`);
  });

  it('leaves alone what is not a mark of a plain literal', () => {
    for (const s of [
      `obj._('X')`,
      `my_('X')`,
      `__('X')`,
      `_(name)`,
      'wxFormat(_(fmt), a)',
      `$_('X')`,
    ]) {
      expect(unmarked(s)).toBe(s);
    }
  });
});
