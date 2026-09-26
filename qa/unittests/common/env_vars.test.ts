// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `ENV_VAR` (common/env_vars.cpp). Expectations are read off the C++, not the
 * port: the predefined list at :38-47, the versioned-name format at :82, and
 * the help strings at :121-164.
 */
import { ENV_VAR } from '@ziroeda/common/env_vars.js';
import { SetEnvVarLookup } from '@ziroeda/common/wx/utils.js';
import { afterEach, describe, expect, it } from 'vitest';

const item = (v: string) => ({ GetValue: () => v });

describe('ENV_VAR', () => {
  afterEach(() => SetEnvVarLookup(() => undefined));

  it('predefines the eight variables in KiCad order', () => {
    expect(ENV_VAR.GetPredefinedEnvVars()).toEqual([
      'KIPRJMOD',
      'KICAD10_SYMBOL_DIR',
      'KICAD10_3DMODEL_DIR',
      'KICAD10_FOOTPRINT_DIR',
      'KICAD10_TEMPLATE_DIR',
      'KICAD_USER_TEMPLATE_DIR',
      'KICAD_PTEMPLATES',
      'KICAD10_3RD_PARTY',
    ]);
  });

  it('a predefined variable is immutable; any other is not', () => {
    expect(ENV_VAR.IsEnvVarImmutable('KIPRJMOD')).toBe(true);
    expect(ENV_VAR.IsEnvVarImmutable('KICAD10_3RD_PARTY')).toBe(true);
    expect(ENV_VAR.IsEnvVarImmutable('KICAD9_3RD_PARTY')).toBe(false);
    expect(ENV_VAR.IsEnvVarImmutable('MY_LIBS')).toBe(false);
  });

  it('autocomplete adds only the variables the list lacks', () => {
    const vars = ['KIPRJMOD', 'MINE'];
    ENV_VAR.GetEnvVarAutocompleteTokens(vars);
    expect(vars.filter((v) => v === 'KIPRJMOD')).toHaveLength(1);
    expect(vars).toHaveLength(2 + 7);
    expect(vars[1]).toBe('MINE');
  });

  it('a versioned name is KICAD<digits>_<base>', () => {
    expect(ENV_VAR.IsVersionedEnvVar('KICAD9_SYMBOL_DIR', 'SYMBOL_DIR')).toBe(true);
    expect(ENV_VAR.IsVersionedEnvVar('KICAD_SYMBOL_DIR', 'SYMBOL_DIR')).toBe(false);
    expect(ENV_VAR.IsVersionedEnvVar('KICADx_SYMBOL_DIR', 'SYMBOL_DIR')).toBe(false);
  });

  it('the versioned value prefers this version, then any version in map order', () => {
    const map = new Map([
      ['KICAD8_3RD_PARTY', item('/eight')],
      ['KICAD9_3RD_PARTY', item('/nine')],
    ]);
    expect(ENV_VAR.GetVersionedEnvVarValue(map, '3RD_PARTY')).toBe('/eight');
    map.set('KICAD10_3RD_PARTY', item('/ten'));
    expect(ENV_VAR.GetVersionedEnvVarValue(map, '3RD_PARTY')).toBe('/ten');
    expect(ENV_VAR.GetVersionedEnvVarValue(map, 'SYMBOL_DIR')).toBeUndefined();
  });

  it('help text is KiCad’s, deprecated names point at their successor', () => {
    expect(ENV_VAR.LookUpEnvVarHelp('KICAD10_SYMBOL_DIR')).toBe(
      'The base path of the locally installed symbol libraries.',
    );
    expect(ENV_VAR.LookUpEnvVarHelp('KISYSMOD')).toBe(
      'Deprecated version of KICAD10_FOOTPRINT_DIR.',
    );
    expect(ENV_VAR.LookUpEnvVarHelp('NOT_A_KICAD_VAR')).toBe('');
  });

  it('GetEnvVar reads wxGetEnv; the double form rejects a non-number', () => {
    expect(ENV_VAR.GetEnvVar('X')).toBeUndefined();
    SetEnvVarLookup((n) => ({ X: '2.5', Y: 'abc' })[n]);
    expect(ENV_VAR.GetEnvVar('X')).toBe('2.5');
    expect(ENV_VAR.GetEnvVarDouble('X')).toBe(2.5);
    expect(ENV_VAR.GetEnvVarDouble('Y')).toBeUndefined();
  });
});
