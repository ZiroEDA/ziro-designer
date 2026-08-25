// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcb_calculator.json` — the Calculator Tools frame's own settings file.
 *
 * `PCB_CALCULATOR_SETTINGS` registers **83** parameters
 * (pcb_calculator_settings.cpp:35-296). Four of them are a template instanced
 * once per attenuator and two are a template instanced once per transmission
 * line, so the file holds **106** keys. Every one of them is listed below with
 * the line of the C++ that declares it, and the list was extracted from that
 * file mechanically rather than written out from the implementation — a table
 * checked against itself is the first shape of test that cannot fail.
 *
 * What each test here is guarding:
 *
 *  - one wrong default is one failing entry, not a failing file. `EXPECTED`
 *    is walked key by key, and the *set* of keys is compared too, so an
 *    invented key and a missing key both fail.
 *  - a value typed into a panel comes back after a reload, and a slice absent
 *    from storage falls back to KiCad's default rather than to zero or empty.
 *  - the free-form transmission-line maps survive the round trip. `deepMerge`
 *    keeps only keys the *defaults* have, and their defaults are `{}` — the
 *    exact trap that silently discarded the User colour theme once already.
 *  - the regulator library a user had before this slice existed is still
 *    theirs afterwards.
 *  - the slice reaches the account through the machinery PR #609 built,
 *    under the rule that machinery already had.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CALC_ATTENUATOR_NAMES,
  CALC_TRANSLINE_NAMES,
  LEGACY_REGULATOR_KEY,
  migrateRegulatorLibrary,
  normalizePcbCalculator,
  PCB_CALCULATOR_DEFAULTS,
  SETTINGS_SLICES,
  SETTINGS_VERSION,
  SettingsManager,
  sliceStorageKey,
  type PcbCalculatorSettings,
} from '@ziroeda/designer/src/prefs/settings.js';
import {
  CALC_PAGE_INDEX,
  calcPageFromIndex,
  flushCalcSettings,
  registerCalcSaver,
} from '@ziroeda/designer/src/editors/calculator/calc_settings.js';

/** An in-memory Storage, so no test touches a real localStorage. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Every key of `pcb_calculator.json` and the default `PCB_CALCULATOR_SETTINGS`
 * registers for it, extracted from pcb_calculator_settings.cpp.
 *
 * `PARAM_MAP`'s default is an empty map, which is why the sixteen transmission
 * line entries are `{}`: a fresh config stores nothing per line type and
 * `TRANSLINE_IDENT::ReadConfig` swallows the missing-key exception, so every
 * parameter keeps its own `m_DefaultValue`.
 */
const EXPECTED: [string, unknown][] = [
  ['board_class_units', 0], // pcb_calculator_settings.cpp:42
  ['color_code_tolerance', 0], // pcb_calculator_settings.cpp:44
  ['last_page', 1], // pcb_calculator_settings.cpp:46
  ['translines.type', 0], // pcb_calculator_settings.cpp:48
  ['attenuators.type', 0], // pcb_calculator_settings.cpp:50
  ['attenuators.att_pi.attenuation', 6.0], // pcb_calculator_settings.cpp:61
  ['attenuators.att_tee.attenuation', 6.0], // pcb_calculator_settings.cpp:61
  ['attenuators.att_bridge.attenuation', 6.0], // pcb_calculator_settings.cpp:61
  ['attenuators.att_splitter.attenuation', 6.0], // pcb_calculator_settings.cpp:61
  ['attenuators.att_pi.zin', 50.0], // pcb_calculator_settings.cpp:62
  ['attenuators.att_tee.zin', 50.0], // pcb_calculator_settings.cpp:62
  ['attenuators.att_bridge.zin', 50.0], // pcb_calculator_settings.cpp:62
  ['attenuators.att_splitter.zin', 50.0], // pcb_calculator_settings.cpp:62
  ['attenuators.att_pi.zout', 50.0], // pcb_calculator_settings.cpp:63
  ['attenuators.att_tee.zout', 50.0], // pcb_calculator_settings.cpp:63
  ['attenuators.att_bridge.zout', 50.0], // pcb_calculator_settings.cpp:63
  ['attenuators.att_splitter.zout', 50.0], // pcb_calculator_settings.cpp:63
  ['electrical.spacing_units', 0], // pcb_calculator_settings.cpp:67
  ['electrical.spacing_voltage', '500'], // pcb_calculator_settings.cpp:70
  ['electrical.iec60664_ratedVoltage', 230], // pcb_calculator_settings.cpp:73
  ['electrical.iec60664_OVC', 0], // pcb_calculator_settings.cpp:76
  ['electrical.iec60664_RMSvoltage', 230], // pcb_calculator_settings.cpp:79
  ['electrical.iec60664_transientOV', 1], // pcb_calculator_settings.cpp:82
  ['electrical.iec60664_peakOV', 0.5], // pcb_calculator_settings.cpp:85
  ['electrical.iec60664_insulationType', 0], // pcb_calculator_settings.cpp:88
  ['electrical.iec60664_pollutionDegree', 0], // pcb_calculator_settings.cpp:91
  ['electrical.iec60664_materialGroup', 0], // pcb_calculator_settings.cpp:94
  ['electrical.iec60664_pcbMaterial', 1], // pcb_calculator_settings.cpp:97
  ['electrical.iec60664_altitude', 2000], // pcb_calculator_settings.cpp:100
  ['regulators.resTol', '1'], // pcb_calculator_settings.cpp:104
  ['regulators.r1', '0.240'], // pcb_calculator_settings.cpp:108
  ['regulators.r2', '0.720'], // pcb_calculator_settings.cpp:111
  ['regulators.vrefMin', '1.20'], // pcb_calculator_settings.cpp:113
  ['regulators.vrefTyp', '1.25'], // pcb_calculator_settings.cpp:115
  ['regulators.vrefMax', '1.30'], // pcb_calculator_settings.cpp:117
  ['regulators.voutTyp', '5'], // pcb_calculator_settings.cpp:120
  ['regulators.iadjTyp', '50'], // pcb_calculator_settings.cpp:123
  ['regulators.iadjMax', '100'], // pcb_calculator_settings.cpp:125
  ['regulators.data_file', ''], // pcb_calculator_settings.cpp:128
  ['regulators.selected_regulator', ''], // pcb_calculator_settings.cpp:131
  ['regulators.type', 1], // pcb_calculator_settings.cpp:134
  ['regulators.last_param', 0], // pcb_calculator_settings.cpp:136
  ['cable_size.conductorMaterialResitivity', ''], // pcb_calculator_settings.cpp:139
  ['cable_size.conductorTemperature', ''], // pcb_calculator_settings.cpp:142
  ['cable_size.conductorThermalCoef', ''], // pcb_calculator_settings.cpp:145
  ['cable_size.currentDensityChoice', 0], // pcb_calculator_settings.cpp:148
  ['cable_size.diameterUnit', 0], // pcb_calculator_settings.cpp:152
  ['cable_size.linResUnit', 0], // pcb_calculator_settings.cpp:154
  ['cable_size.frequencyUnit', 0], // pcb_calculator_settings.cpp:157
  ['cable_size.lengthUnit', 0], // pcb_calculator_settings.cpp:159
  ['wavelength.frequency', 1e9], // pcb_calculator_settings.cpp:163
  ['wavelength.permeability', 1], // pcb_calculator_settings.cpp:166
  ['wavelength.permittivity', 4.5], // pcb_calculator_settings.cpp:169
  ['wavelength.frequencyUnit', 0], // pcb_calculator_settings.cpp:172
  ['wavelength.periodUnit', 0], // pcb_calculator_settings.cpp:174
  ['wavelength.wavelengthVacuumUnit', 0], // pcb_calculator_settings.cpp:176
  ['wavelength.wavelengthMediumUnit', 0], // pcb_calculator_settings.cpp:179
  ['wavelength.speedUnit', 0], // pcb_calculator_settings.cpp:182
  ['track_width.current', '1.0'], // pcb_calculator_settings.cpp:184
  ['track_width.delta_tc', '10.0'], // pcb_calculator_settings.cpp:187
  ['track_width.track_len', '20'], // pcb_calculator_settings.cpp:190
  ['track_width.track_len_units', 0], // pcb_calculator_settings.cpp:193
  ['track_width.resistivity', '1.72e-8'], // pcb_calculator_settings.cpp:196
  ['track_width.ext_track_width', '0.2'], // pcb_calculator_settings.cpp:199
  ['track_width.ext_track_width_units', 0], // pcb_calculator_settings.cpp:202
  ['track_width.ext_track_thickness', '35'], // pcb_calculator_settings.cpp:205
  ['track_width.ext_track_thickness_units', 1], // pcb_calculator_settings.cpp:208
  ['track_width.int_track_width', '0.2'], // pcb_calculator_settings.cpp:211
  ['track_width.int_track_width_units', 0], // pcb_calculator_settings.cpp:214
  ['track_width.int_track_thickness', '35'], // pcb_calculator_settings.cpp:217
  ['track_width.int_track_thickness_units', 1], // pcb_calculator_settings.cpp:220
  ['trans_line.MicroStrip.values', {}], // pcb_calculator_settings.cpp:234
  ['trans_line.CoPlanar.values', {}], // pcb_calculator_settings.cpp:234
  ['trans_line.GrCoPlanar.values', {}], // pcb_calculator_settings.cpp:234
  ['trans_line.RectWaveGuide.values', {}], // pcb_calculator_settings.cpp:234
  ['trans_line.Coax.values', {}], // pcb_calculator_settings.cpp:234
  ['trans_line.Coupled_MicroStrip.values', {}], // pcb_calculator_settings.cpp:234
  ['trans_line.StripLine.values', {}], // pcb_calculator_settings.cpp:234
  ['trans_line.TwistedPair.values', {}], // pcb_calculator_settings.cpp:234
  ['trans_line.MicroStrip.units', {}], // pcb_calculator_settings.cpp:237
  ['trans_line.CoPlanar.units', {}], // pcb_calculator_settings.cpp:237
  ['trans_line.GrCoPlanar.units', {}], // pcb_calculator_settings.cpp:237
  ['trans_line.RectWaveGuide.units', {}], // pcb_calculator_settings.cpp:237
  ['trans_line.Coax.units', {}], // pcb_calculator_settings.cpp:237
  ['trans_line.Coupled_MicroStrip.units', {}], // pcb_calculator_settings.cpp:237
  ['trans_line.StripLine.units', {}], // pcb_calculator_settings.cpp:237
  ['trans_line.TwistedPair.units', {}], // pcb_calculator_settings.cpp:237
  ['via_size.hole_diameter', '0.4'], // pcb_calculator_settings.cpp:242
  ['via_size.hole_diameter_units', 0], // pcb_calculator_settings.cpp:245
  ['via_size.thickness', '0.035'], // pcb_calculator_settings.cpp:248
  ['via_size.thickness_units', 0], // pcb_calculator_settings.cpp:251
  ['via_size.length', '1.6'], // pcb_calculator_settings.cpp:254
  ['via_size.length_units', 0], // pcb_calculator_settings.cpp:257
  ['via_size.pad_diameter', '0.6'], // pcb_calculator_settings.cpp:259
  ['via_size.pad_diameter_units', 0], // pcb_calculator_settings.cpp:262
  ['via_size.clearance_diameter', '1.0'], // pcb_calculator_settings.cpp:265
  ['via_size.clearance_diameter_units', 0], // pcb_calculator_settings.cpp:268
  ['via_size.characteristic_impedance', '50'], // pcb_calculator_settings.cpp:271
  ['via_size.characteristic_impedance_units', 0], // pcb_calculator_settings.cpp:274
  ['via_size.applied_current', '1'], // pcb_calculator_settings.cpp:277
  ['via_size.plating_resistivity', '1.72e-8'], // pcb_calculator_settings.cpp:280
  ['via_size.permittivity', '4.5'], // pcb_calculator_settings.cpp:283
  ['via_size.temp_rise', '10'], // pcb_calculator_settings.cpp:286
  ['via_size.pulse_rise_time', '1'], // pcb_calculator_settings.cpp:289
  ['corrosion_table.threshold_voltage', '0'], // pcb_calculator_settings.cpp:292
  ['corrosion_table.show_symbols', true], // pcb_calculator_settings.cpp:295
];

/** Read a dotted path out of a settings object. */
function at(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Every leaf path of a settings object, dotted. `regulators.library` is an
 *  array and counts as one leaf, as the two free-form maps do. */
function leaves(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [prefix];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    // The two free-form maps and the library are leaves: their contents are
    // the user's, not the schema's.
    if (/\.(values|units)$/.test(path) || path === 'regulators.library') out.push(path);
    else out.push(...leaves(v, path));
  }
  return out;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

describe('PCB_CALCULATOR_SETTINGS, key by key', () => {
  it('registers 83 parameters, which expand to 106 keys', () => {
    // The checksum from the C++: 83 `m_params.emplace_back` calls, of which one
    // is instanced 4 times (the attenuators) and two 8 times (the lines).
    expect(EXPECTED.length).toBe(83 - 3 - 2 + 4 * 3 + 8 * 2);
    expect(EXPECTED.length).toBe(106);
  });

  for (const [path, expected] of EXPECTED) {
    it(`${path} defaults to ${JSON.stringify(expected)}`, () => {
      expect(at(PCB_CALCULATOR_DEFAULTS, path)).toStrictEqual(expected);
    });
  }

  it('has no key upstream does not, and misses none it does', () => {
    const ours = leaves(PCB_CALCULATOR_DEFAULTS).sort();
    const theirs = EXPECTED.map(([p]) => p).sort();
    // `regulators.library` is the one key with no upstream counterpart: it
    // stands in for the `.pcbcalc` file on disk, which a browser has not got.
    expect(ours.filter((p) => p !== 'regulators.library')).toStrictEqual(theirs);
    expect(ours).toContain('regulators.library');
  });

  it('names the eight transmission lines upstream stores, in upstream’s order', () => {
    // Eight, not nine: C_STRIPLINE sets the same m_Name as C_MICROSTRIP
    // (transline/c_stripline.cpp:30), so the two share one entry.
    expect([...CALC_TRANSLINE_NAMES]).toStrictEqual([
      'MicroStrip',
      'CoPlanar',
      'GrCoPlanar',
      'RectWaveGuide',
      'Coax',
      'Coupled_MicroStrip',
      'StripLine',
      'TwistedPair',
    ]);
  });

  it('names the four attenuators in m_AttenuatorList order', () => {
    // The radio's selection indexes this list, so the order is load-bearing:
    // `attenuators.type` = 2 must mean the bridged tee
    // (attenuators/attenuator_classes.cpp:89,110,131,156).
    expect([...CALC_ATTENUATOR_NAMES]).toStrictEqual([
      'att_pi',
      'att_tee',
      'att_bridge',
      'att_splitter',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The round trip
// ---------------------------------------------------------------------------

describe('a value typed into a panel is there next time', () => {
  it('comes back from storage on a new manager', () => {
    const a = new SettingsManager();
    a.updatePcbCalculator((s) => {
      s.track_width.current = '3.5';
      s.via_size.hole_diameter_units = 3;
    });
    const b = new SettingsManager();
    expect(b.pcbCalculator.track_width.current).toBe('3.5');
    expect(b.pcbCalculator.via_size.hole_diameter_units).toBe(3);
  });

  it('falls back to KiCad’s default, not to zero or empty, when nothing is stored', () => {
    const m = new SettingsManager();
    expect(m.pcbCalculator.track_width.current).toBe('1.0');
    expect(m.pcbCalculator.track_width.ext_track_thickness_units).toBe(1);
    expect(m.pcbCalculator.regulators.type).toBe(1);
    expect(m.pcbCalculator.last_page).toBe(1);
    expect(m.pcbCalculator.wavelength.frequency).toBe(1e9);
    expect(m.pcbCalculator.corrosion_table.show_symbols).toBe(true);
  });

  it('keeps the keys a stored file does not have at their defaults', () => {
    localStorage.setItem(
      sliceStorageKey('pcb_calculator'),
      JSON.stringify({ via_size: { hole_diameter: '9' } }),
    );
    const m = new SettingsManager();
    expect(m.pcbCalculator.via_size.hole_diameter).toBe('9');
    expect(m.pcbCalculator.via_size.length).toBe('1.6');
    expect(m.pcbCalculator.track_width.delta_tc).toBe('10.0');
  });

  it('ignores a stored value of the wrong type', () => {
    // localStorage is editable by hand and survives across versions; a number
    // where a string belongs reaches the panel and is rendered.
    localStorage.setItem(
      sliceStorageKey('pcb_calculator'),
      JSON.stringify({ via_size: { hole_diameter: 42 }, last_page: 'six' }),
    );
    const m = new SettingsManager();
    expect(m.pcbCalculator.via_size.hole_diameter).toBe('0.4');
    expect(m.pcbCalculator.last_page).toBe(1);
  });
});

describe('the transmission-line keyword maps are free-form', () => {
  it('survives the round trip, which `deepMerge` alone would not', () => {
    const a = new SettingsManager();
    a.updatePcbCalculator((s) => {
      s.trans_line.StripLine.values = { W: 0.35, H: 1.6 };
      s.trans_line.StripLine.units = { W: 3 };
    });
    const b = new SettingsManager();
    expect(b.pcbCalculator.trans_line.StripLine.values).toStrictEqual({ W: 0.35, H: 1.6 });
    expect(b.pcbCalculator.trans_line.StripLine.units).toStrictEqual({ W: 3 });
  });

  it('keeps one line’s map out of another’s', () => {
    const a = new SettingsManager();
    a.updatePcbCalculator((s) => {
      s.trans_line.Coax.values = { Din: 1 };
    });
    const b = new SettingsManager();
    expect(b.pcbCalculator.trans_line.Coax.values).toStrictEqual({ Din: 1 });
    expect(b.pcbCalculator.trans_line.MicroStrip.values).toStrictEqual({});
  });

  it('drops a map entry that is not a finite number', () => {
    const cfg = normalizePcbCalculator({
      trans_line: { Coax: { values: { Din: 'wide', Dout: 2, L: null }, units: { Din: 1 } } },
    });
    expect(cfg.trans_line.Coax.values).toStrictEqual({ Dout: 2 });
    expect(cfg.trans_line.Coax.units).toStrictEqual({ Din: 1 });
  });

  it('accepts a file with no trans_line at all', () => {
    const cfg = normalizePcbCalculator({ last_page: 5 });
    expect(cfg.last_page).toBe(5);
    for (const name of CALC_TRANSLINE_NAMES) {
      expect(cfg.trans_line[name]).toStrictEqual({ values: {}, units: {} });
    }
  });
});

// ---------------------------------------------------------------------------
// The regulator library
// ---------------------------------------------------------------------------

const REG = {
  name: 'LT3080',
  type: 1,
  vrefMin: 1.2,
  vrefTyp: 1.25,
  vrefMax: 1.3,
  iadjTyp: 5e-5,
  iadjMax: 1e-4,
};

describe('the regulator library a user already had', () => {
  it('moves into the slice, with the selection', () => {
    const cfg = normalizePcbCalculator(undefined);
    expect(migrateRegulatorLibrary({ regulators: [REG], selected: 'LT3080' }, cfg)).toBe(true);
    expect(cfg.regulators.library).toStrictEqual([REG]);
    expect(cfg.regulators.selected_regulator).toBe('LT3080');
  });

  it('does not overwrite a library that is already there', () => {
    const cfg = normalizePcbCalculator(undefined);
    cfg.regulators.library = [{ ...REG, name: 'MINE' }];
    expect(migrateRegulatorLibrary({ regulators: [REG], selected: 'LT3080' }, cfg)).toBe(false);
    expect(cfg.regulators.library[0]?.name).toBe('MINE');
  });

  it('drops an entry that is not a regulator', () => {
    const cfg = normalizePcbCalculator(undefined);
    migrateRegulatorLibrary({ regulators: [REG, { name: '' }, 7, null], selected: '' }, cfg);
    expect(cfg.regulators.library).toStrictEqual([REG]);
  });

  it('does nothing with an empty or unparsable legacy value', () => {
    const cfg = normalizePcbCalculator(undefined);
    expect(migrateRegulatorLibrary(undefined, cfg)).toBe(false);
    expect(migrateRegulatorLibrary({ regulators: [] }, cfg)).toBe(false);
    expect(migrateRegulatorLibrary('nonsense', cfg)).toBe(false);
    expect(migrateRegulatorLibrary([REG], cfg)).toBe(false);
    expect(cfg.regulators.library).toStrictEqual([]);
  });

  it('reaches a device already stamped at v3', () => {
    // The migration that shipped alongside this one -- the Image Converter's
    // key rename -- is v3, so anyone who ran a build carrying that but not
    // this one already has `3` in ziroeda.settings_version. A `from < 3` gate
    // would never fire for them and their regulators would be stranded, which
    // is the one thing this migration exists to prevent.
    localStorage.setItem('ziroeda.settings_version', '3');
    localStorage.setItem(
      LEGACY_REGULATOR_KEY,
      JSON.stringify({ regulators: [REG], selected: 'LT3080' }),
    );
    vi.resetModules();
    return import('@ziroeda/designer/src/prefs/settings.js').then((mod) => {
      expect(mod.SETTINGS_VERSION).toBeGreaterThan(3);
      const m = new mod.SettingsManager();
      expect(m.pcbCalculator.regulators.library).toStrictEqual([REG]);
    });
  });

  it('is applied on load by the stored-settings migration', () => {
    // The whole point: a user who added regulators before this shipped opens
    // the app and still has them, without doing anything.
    localStorage.setItem(
      LEGACY_REGULATOR_KEY,
      JSON.stringify({ regulators: [REG], selected: 'LT3080' }),
    );
    vi.resetModules();
    return import('@ziroeda/designer/src/prefs/settings.js').then((mod) => {
      const m = new mod.SettingsManager();
      expect(m.pcbCalculator.regulators.library).toStrictEqual([REG]);
      expect(m.pcbCalculator.regulators.selected_regulator).toBe('LT3080');
    });
  });
});

// ---------------------------------------------------------------------------
// The frame's own bookkeeping
// ---------------------------------------------------------------------------

describe('last_page is a wxTreebook index', () => {
  it('counts the four group headings as pages', () => {
    // AddPage( nullptr, "General system design" ) is page 0, so Regulators is
    // 1 and not 0 (pcb_calculator_frame.cpp:159-189).
    expect(CALC_PAGE_INDEX.regulators).toBe(1);
    expect(CALC_PAGE_INDEX.r_calculator).toBe(2);
    expect(CALC_PAGE_INDEX.electrical_spacing).toBe(4);
    expect(CALC_PAGE_INDEX.via_size).toBe(5);
    expect(CALC_PAGE_INDEX.track_width).toBe(6);
    expect(CALC_PAGE_INDEX.fusing_current).toBe(7);
    expect(CALC_PAGE_INDEX.cable_size).toBe(8);
    expect(CALC_PAGE_INDEX.wavelength).toBe(10);
    expect(CALC_PAGE_INDEX.rf_attenuators).toBe(11);
    expect(CALC_PAGE_INDEX.transmission_lines).toBe(12);
    expect(CALC_PAGE_INDEX.eseries).toBe(14);
    expect(CALC_PAGE_INDEX.color_code).toBe(15);
    expect(CALC_PAGE_INDEX.board_classes).toBe(16);
    expect(CALC_PAGE_INDEX.galvanic_corrosion).toBe(17);
  });

  it('round-trips every calculator through the stored index', () => {
    for (const [id, index] of Object.entries(CALC_PAGE_INDEX)) {
      expect(calcPageFromIndex(index)).toBe(id);
    }
  });

  it('falls back to Regulators for a group heading or an unknown page', () => {
    expect(calcPageFromIndex(0)).toBe('regulators');
    expect(calcPageFromIndex(9)).toBe('regulators');
    expect(calcPageFromIndex(99)).toBe('regulators');
  });
});

// ---------------------------------------------------------------------------
// SaveSettings
// ---------------------------------------------------------------------------

describe('flushCalcSettings is PCB_CALCULATOR_FRAME::SaveSettings', () => {
  it('runs every registered panel into one settings write', () => {
    const m = new SettingsManager();
    const before = m.version;
    const off1 = registerCalcSaver({
      fn: (s: PcbCalculatorSettings) => {
        s.via_size.temp_rise = '25';
      },
    });
    const off2 = registerCalcSaver({
      fn: (s: PcbCalculatorSettings) => {
        s.board_class_units = 4;
      },
    });
    flushCalcSettings();
    off1();
    off2();
    // One write, not two: the file is stamped and pushed once.
    const stored = JSON.parse(
      localStorage.getItem(sliceStorageKey('pcb_calculator')) ?? '{}',
    ) as PcbCalculatorSettings;
    expect(stored.via_size.temp_rise).toBe('25');
    expect(stored.board_class_units).toBe(4);
    expect(m.version).toBe(before);
  });

  it('writes nothing when no panel is mounted', () => {
    // A visibilitychange from elsewhere in the app must not rewrite the file
    // with defaults.
    flushCalcSettings();
    expect(localStorage.getItem(sliceStorageKey('pcb_calculator'))).toBeNull();
  });

  it('stops saving a panel that has gone away', () => {
    const off = registerCalcSaver({
      fn: (s: PcbCalculatorSettings) => {
        s.color_code_tolerance = 1;
      },
    });
    off();
    flushCalcSettings();
    expect(localStorage.getItem(sliceStorageKey('pcb_calculator'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The account
// ---------------------------------------------------------------------------

describe('the slice goes through the settings machinery, not beside it', () => {
  it('is one of SETTINGS_SLICES', () => {
    expect([...SETTINGS_SLICES]).toContain('pcb_calculator');
  });

  it('is stored under the shared prefix', () => {
    expect(sliceStorageKey('pcb_calculator')).toBe('ziroeda.pcb_calculator');
  });

  it('is stamped as locally edited, so the sync will push it', () => {
    const m = new SettingsManager();
    m.updatePcbCalculator((s) => {
      s.last_page = 5;
    });
    const stamp = m.stamps.pcb_calculator;
    expect(stamp).toBeDefined();
    // `updatedAt > syncedAt` is the whole of "this device edited it"
    // (settingsSync.ts, decideSlice).
    expect(stamp?.syncedAt).toBeUndefined();
    expect(stamp?.updatedAt).toBeGreaterThan(0);
  });

  it('adopts the account’s copy without losing the free-form maps', () => {
    const m = new SettingsManager();
    m.adoptSlice(
      'pcb_calculator',
      { trans_line: { Coax: { values: { Din: 2.5 }, units: {} } }, last_page: 12 },
      9_000,
    );
    expect(m.pcbCalculator.trans_line.Coax.values).toStrictEqual({ Din: 2.5 });
    expect(m.pcbCalculator.last_page).toBe(12);
    // Adopting is not an edit: the two sides now agree.
    expect(m.stamps.pcb_calculator?.syncedAt).toBe(m.stamps.pcb_calculator?.updatedAt);
  });

  it('carries its own schema version, not one another migration already used', () => {
    // v3 belongs to the Image Converter's key rename (bitmap2cmp_settings.ts).
    // Sharing it would silently skip this migration on every device that has
    // already seen v3.
    expect(SETTINGS_VERSION).toBeGreaterThanOrEqual(4);
  });
});
