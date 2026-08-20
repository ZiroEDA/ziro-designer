// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The `.pcbcalc` regulator data file, against the grammar
 * `pcb_calculator/datafile_read_write.cpp` reads and writes.
 */
import { describe, expect, it } from 'vitest';
import {
  formatRegulatorDataFile,
  parseRegulatorDataFile,
  REGULATOR_DATA_FILE_EXT,
  RegulatorType,
} from '@ziroeda/pcb_calculator';

// Exactly what PANEL_REGULATOR::WriteDataFile emits for one 3-terminal part:
// the header, then the regulators list, with Iadj in MICROAMPS.
const KICAD_FILE = `(datafile
 (version 2)
 (date "2026-08-20T09:00:00Z")
 (tool "pcb_calculator 10.0.5")
 (regulators
  (regulator "LM317"
   (reg_vref_min 1.2)
   (reg_vref_typ 1.25)
   (reg_vref_max 1.3)
   (reg_iadj_typ 50)
   (reg_iadj_max 100)
   (reg_type 3terminal)
  )
  (regulator "LM2596"
   (reg_vref_min 1.193)
   (reg_vref_typ 1.23)
   (reg_vref_max 1.267)
   (reg_type normal)
  )
 )
)
`;

describe('.pcbcalc regulator data file', () => {
  it('is the extension panel_regulator.cpp:36 names', () => {
    expect(REGULATOR_DATA_FILE_EXT).toBe('pcbcalc');
  });

  it('reads a file the binary wrote, in KiCad order', () => {
    const regs = parseRegulatorDataFile(KICAD_FILE);
    expect(regs.map((r) => r.name)).toEqual(['LM317', 'LM2596']);
  });

  it('reads Iadj as microamps and holds amps', () => {
    const [lm317] = parseRegulatorDataFile(KICAD_FILE);
    expect(lm317?.iadjTyp).toBeCloseTo(50e-6, 12);
    expect(lm317?.iadjMax).toBeCloseTo(100e-6, 12);
  });

  it('reads every Vref and the type token', () => {
    const [lm317, lm2596] = parseRegulatorDataFile(KICAD_FILE);
    expect(lm317?.vrefMin).toBe(1.2);
    expect(lm317?.vrefTyp).toBe(1.25);
    expect(lm317?.vrefMax).toBe(1.3);
    expect(lm317?.type).toBe(RegulatorType.THREE_TERMINAL);
    expect(lm2596?.type).toBe(RegulatorType.STANDARD);
    expect(lm2596?.vrefMax).toBe(1.267);
  });

  it('accepts the legacy single-valued reg_vref and reg_iadj', () => {
    const legacy = `(datafile (regulators (regulator "OLD"
      (reg_vref 1.25) (reg_iadj 60) (reg_type 3terminal) ) ) )`;
    const [r] = parseRegulatorDataFile(legacy);
    expect([r?.vrefMin, r?.vrefTyp, r?.vrefMax]).toEqual([1.25, 1.25, 1.25]);
    expect(r?.iadjTyp).toBeCloseTo(60e-6, 12);
    expect(r?.iadjMax).toBeCloseTo(60e-6, 12);
  });

  it('drops an entry with no name, as "if( ! name.IsEmpty() )" does', () => {
    const anon = `(datafile (regulators (regulator "" (reg_vref_typ 1.2) )
      (regulator "KEEP" (reg_vref_typ 1.2) ) ) )`;
    expect(parseRegulatorDataFile(anon).map((r) => r.name)).toEqual(['KEEP']);
  });

  it('throws on a file with no regulators list, so the panel can report it', () => {
    expect(() => parseRegulatorDataFile('(datafile (version 2))')).toThrow();
  });

  it('writes the header and the list back, Iadj in microamps', () => {
    const regs = parseRegulatorDataFile(KICAD_FILE);
    const out = formatRegulatorDataFile(regs, 'pcb_calculator 10.0.5', new Date(0));
    expect(out).toContain('(version 2)');
    expect(out).toContain('(regulator "LM317"');
    expect(out).toContain('(reg_iadj_typ 50)');
    expect(out).toContain('(reg_iadj_max 100)');
    expect(out).toContain('(reg_type 3terminal)');
  });

  it('omits reg_iadj_* for a standard regulator, as Format does', () => {
    const regs = parseRegulatorDataFile(KICAD_FILE);
    const out = formatRegulatorDataFile(regs.slice(1), 'x', new Date(0));
    expect(out).not.toContain('reg_iadj');
    expect(out).toContain('(reg_type normal)');
  });

  it('round-trips', () => {
    const once = parseRegulatorDataFile(KICAD_FILE);
    const twice = parseRegulatorDataFile(formatRegulatorDataFile(once, 'x', new Date(0)));
    expect(twice).toEqual(once);
  });
});
