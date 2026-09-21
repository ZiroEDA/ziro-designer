// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** DumpJson against files KiCad itself wrote. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTINGS_MANAGER } from '@ziroeda/common/src/pgm_base.js';
import { DumpDouble, DumpJson } from '@ziroeda/common/src/settings/json_dump.js';
import type { JsonValue } from '@ziroeda/common/src/settings/json_settings.js';
import { BOARD } from '@ziroeda/pcbnew/board.js';

const DATA = '/home/akshay/kicad-reference/qa/data/pcbnew/';

describe('DumpJson', () => {
  it('prints a double the way nlohmann does', () => {
    expect(DumpDouble(1)).toBe('1.0');
    expect(DumpDouble(0)).toBe('0.0');
    expect(DumpDouble(0.508)).toBe('0.508');
    expect(DumpDouble(-0.01)).toBe('-0.01');
    expect(DumpDouble(1e-7)).toBe('1e-07');
    expect(DumpDouble(1.5e21)).toBe('1.5e+21');
  });

  it('sorts keys, one element per line, empty containers inline', () => {
    const v: JsonValue = { b: [], a: { z: 1, y: [1, 2] }, c: {}, d: 'x"y' };
    expect(DumpJson(v)).toBe(
      '{\n  "a": {\n    "y": [\n      1,\n      2\n    ],\n    "z": 1\n  },\n  "b": [],\n  "c": {},\n  "d": "x\\"y"\n}\n',
    );
  });

  it('a project file KiCad wrote comes back byte for byte', () => {
    const text = readFileSync(`${DATA}diff_pair_uncoupled_tuning_drc.kicad_pro`, 'utf8');
    const m = new SETTINGS_MANAGER();
    m.LoadProject(`${DATA}diff_pair_uncoupled_tuning_drc.kicad_pro`, JSON.parse(text));
    const b = new BOARD();
    b.SetProject(m.Prj());

    const out = DumpJson(m.SaveProject()!.pro);

    // The fixture's KiCad is newer than 10.0.5: four rule_severities keys
    // 10.0.5's allItemTypes does not carry, no `pcbnew.last_paths.step`
    // (10.0.5 registers it), and tuning_profiles at schema 1 (10.0.5: 0).
    const lines = text.split('\n');
    const expected: string[] = [];
    let inSeverities = false;
    let inTuning = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (/^\s*"rule_severities": \{/.test(l)) inSeverities = true;
      else if (inSeverities && /^\s*\}/.test(l)) inSeverities = false;
      if (/^\s*"tuning_profiles": \{/.test(l)) inTuning = true;
      if (
        inSeverities &&
        /^\s*"(assertion_failure|net_chain_return_path|net_chain_stub_length|via_diameter)": /.test(
          l,
        )
      )
        continue;
      if (inTuning && /^\s*"version": 1$/.test(l)) {
        expected.push(l.replace('1', '0'));
        inTuning = false;
        continue;
      }
      if (/^\s*"specctra_dsn": /.test(l)) {
        expected.push(l);
        expected.push(l.replace('specctra_dsn', 'step'));
        continue;
      }
      expected.push(l);
    }

    expect(out).toBe(expected.join('\n'));
  });
});
