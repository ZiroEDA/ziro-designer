/**
 * zsch's hierarchy lines (ai/sch_hierarchy.ts, applyZschBatch) on a stand-in window: records per
 * sheet file, and a real SCH_EDIT_FRAME behind LIVE_SCHEMATIC_MIRROR doing what the window's
 * editLive does (sync, edit without dialogs, write the changed screens back as records).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyZschBatch, schBridge } from '@ziroeda/ai/sch_bridge.js';
import { PGM_BASE, SETTINGS_MANAGER, SetPgm } from '@ziroeda/common/pgm_base.js';
import { SCH_EDIT_FRAME, type SCH_EDIT_FRAME_HOOKS } from '@ziroeda/eeschema/sch_edit_frame.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import {
  LIVE_SCHEMATIC_MIRROR,
  liveScreensToRecords,
} from '@ziroeda/eeschema/sch_record_bridge.js';
import type { SchScriptApi } from '@ziroeda/eeschema/sch_script_api.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/types.js';
import { parse } from '@ziroeda/sexpr/index.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const lib = (file: string, qualified: string): LibSymbol => {
  const [sym] = readSymbolLib(
    parse(readFileSync(fileURLToPath(new URL(`../../data/${file}`, import.meta.url)), 'utf8')),
  );
  return { ...(sym as LibSymbol), libId: qualified };
};
const LIBS: Record<string, LibSymbol> = {
  'Device:R': lib('R.kicad_sym', 'Device:R'),
  'power:GND': lib('GND.kicad_sym', 'power:GND'),
};
// AB.kicad_sym: Device:R renamed, its pins named A and B, for a port named by pin name.
LIBS['Test:AB'] = lib('AB.kicad_sym', 'Test:AB');

beforeEach(() => SetPgm(new PGM_BASE(null, new SETTINGS_MANAGER())));
afterEach(() => SetPgm(null));

const EMPTY = (uuid: string) =>
  `(kicad_sch (version 20250114) (generator "eeschema") (uuid "${uuid}") (paper "A4") (lib_symbols) (sheet_instances (path "/" (page "1"))))`;

/** The window, reduced to its records and its live mirror. */
function fakeWindow() {
  const docs = new Map<string, Schematic>([
    [
      'proj.kicad_sch',
      {
        ...readSchematic(parse(EMPTY('0f0e0d0c-0000-4000-8000-000000000001'))),
        fileName: 'proj.kicad_sch',
      },
    ],
  ]);
  let current = 'proj.kicad_sch';
  const frame = new SCH_EDIT_FRAME({
    crossProbingSettings: () => ({}) as ReturnType<SCH_EDIT_FRAME_HOOKS['crossProbingSettings']>,
    saveProject: () => true,
  });
  const mirror = new LIVE_SCHEMATIC_MIRROR(frame, () => ({
    dir: '/proj',
    docs: new Map(docs),
    root: 'proj.kicad_sch',
    files: [],
  }));
  let undoSteps = 0;
  const api: SchScriptApi = {
    doc: () => docs.get(current) ?? null,
    runCommand: (cmd) => {
      docs.set(current, cmd.apply(docs.get(current)!));
      undoSteps++;
    },
    annotatePlacement: (sym) => sym,
    loadSymbol: async (l, n) => LIBS[`${l}:${n}`],
    erc: () => [],
    symbolIndex: async () => [],
    footprintIndex: async () => [],
    snapshot: () => '',
    undo: () => {},
    docs: () => new Map(docs),
    currentFile: () => current,
    runCommandOn: (file, cmd) => {
      docs.set(file, cmd.apply(docs.get(file)!));
      undoSteps++;
    },
    readLive: (read) => (mirror.get() ? read(frame) : null),
    editLive: async (edit) => {
      if (!mirror.get()) return null;
      let out: Awaited<ReturnType<SCH_EDIT_FRAME['WithoutDialogsAsync']>>;
      try {
        out = await frame.WithoutDialogsAsync(true, () => edit(frame));
      } catch (e) {
        mirror.Invalidate();
        throw e;
      }
      const screens = out.result as Iterable<
        import('@ziroeda/eeschema/sch_screen.js').SCH_SCREEN
      > | null;
      if (!screens) return out.messages;
      const written = liveScreensToRecords(frame, screens, '/proj');
      for (const [f, d] of written) docs.set(f, d);
      mirror.Adopt(written);
      undoSteps++;
      return out.messages;
    },
  };
  return { api, docs, steps: () => undoSteps, enter: (f: string) => (current = f) };
}

const hierLabels = (d: Schematic) =>
  d.labels.filter((l) => l.kind === 'hierarchical_label').map((l) => `${l.text}:${l.shape}`);

describe('zsch hierarchy', () => {
  it('builds a sheet, fills it, gives it ports and pins, and wires the parent to them', async () => {
    const { api, docs } = fakeWindow();
    const r = await applyZschBatch(
      api,
      [
        'sheet "Power" power.kicad_sch @50,50 40,30',
        'in "Power"',
        'sym R1 Device:R @100,60',
        'sym R2 Device:R @120,60',
        'net MID R1.1 R2.1',
        'port VIN in R1.2',
        'port VOUT out R2.2',
        'in root',
        'pins "Power"',
        'sym R3 Device:R @20,60',
        'net VIN R3.1 Power.VIN',
      ].join('\n'),
    );
    expect(r.errors).toEqual([]);

    const child = docs.get('power.kicad_sch')!;
    expect(
      child.symbols.map((s) => s.fields.find((f) => f.key === 'Reference')?.value).sort(),
    ).toEqual(['R1', 'R2']);
    expect(hierLabels(child).sort()).toEqual(['VIN:input', 'VOUT:output']);

    const root = docs.get('proj.kicad_sch')!;
    const power = root.sheets.find((s) => s.fields.some((f) => f.value === 'Power'))!;
    // pins: the output on the right edge, the input on the left
    const vin = power.pins.find((p) => p.name === 'VIN')!;
    const vout = power.pins.find((p) => p.name === 'VOUT')!;
    expect(vin.at.x).toBe(power.at.x);
    expect(vout.at.x).toBe(power.at.x + power.size.w);
    // The parent's net put a VIN label on the sheet pin, and one on R3.1.
    const vinLabels = root.labels.filter((l) => l.kind === 'label' && l.text === 'VIN');
    expect(vinLabels.some((l) => l.at.x === vin.at.x && l.at.y === vin.at.y)).toBe(true);
    expect(vinLabels.length).toBe(2);
  });

  it('puts a port on the pin it names, turned away from the part (AutoRotateItem)', async () => {
    const { api, docs } = fakeWindow();
    await applyZschBatch(
      api,
      'sheet "S" s.kicad_sch @50,50 40,30\nin "S"\nsym R1 Device:R @100,60',
    );
    // Device:R is vertical: pin 1 at the top points down into the body, so the label faces up.
    const r = await applyZschBatch(api, 'in "S"\nport TOP bidi R1.1');
    expect(r.errors).toEqual([]);
    const child = docs.get('s.kicad_sch')!;
    const label = child.labels.find((l) => l.text === 'TOP')!;
    expect(label.angle).toBe(90);
  });

  it('numbers R? past the references used on other sheets', async () => {
    const { api, docs } = fakeWindow();
    await applyZschBatch(api, 'sym R1 Device:R @20,20\nsym R2 Device:R @40,20');
    const r = await applyZschBatch(
      api,
      'sheet "S" s.kicad_sch @50,50 40,30\nin "S"\nsym R? Device:R @100,60',
    );
    expect(r.errors).toEqual([]);
    expect(
      docs.get('s.kicad_sch')!.symbols[0]!.fields.find((f) => f.key === 'Reference')!.value,
    ).toBe('R3');
  });

  it('stops at a failing segment and says what was already applied', async () => {
    const { api, docs } = fakeWindow();
    const r = await applyZschBatch(
      api,
      'sheet "S" s.kicad_sch @50,50 40,30\nin "S"\nport X in U9.1',
    );
    expect(r.errors.some((e) => e.includes('no part U9'))).toBe(true);
    expect(r.errors.at(-1)).toMatch(/^Applied before this failed: the lines for root/);
    expect(docs.has('s.kicad_sch')).toBe(true);
  });

  it('refuses a malformed line before applying anything', async () => {
    const { api, docs } = fakeWindow();
    const r = await applyZschBatch(api, 'sheet "S" s.kicad_sch @50,50 40,30\nport X sideways R1.1');
    expect(r.applied).toBe(0);
    expect(r.errors.at(-1)).toMatch(/^Nothing was applied/);
    expect(docs.has('s.kicad_sch')).toBe(false);
  });

  it('fails `pins` on a sheet with no ports', async () => {
    const { api } = fakeWindow();
    const r = await applyZschBatch(api, 'sheet "S" s.kicad_sch @50,50 40,30\npins "S"');
    expect(r.errors.some((e) => e.includes('no new hierarchical labels'))).toBe(true);
  });

  it('reads the hierarchy and a sheet by name from the live model', async () => {
    const { api } = fakeWindow();
    await applyZschBatch(
      api,
      'sheet "Power" power.kicad_sch @50.8,50.8 38.1,30.48\nin "Power"\nsym R1 Device:R @100,60\nport VIN in R1.1\nin root\npins "Power"',
    );
    const bridge = schBridge(api);
    const root = (await bridge.run('read_schematic', {}))!.text;
    expect(root).toContain('; sheet: root');
    // on the 50 mil grid, so these read back as written
    expect(root).toContain('sheet "Power" power.kicad_sch @50.8,50.8 38.1,30.48');
    expect(root).toContain(';   pins: VIN(in)');
    const power = (await bridge.run('read_schematic', { sheet: 'Power' }))!.text;
    expect(power).toContain('; sheet: Power');
    expect(power).toMatch(/sym R1 Device:R/);
    expect(power).toMatch(/port VIN in @/);
    expect((await bridge.run('read_schematic', { sheet: 'Nope' }))!.text).toBe('(no sheet Nope)');
  });
  it('runs every pins line before the nets on sheet pins, wherever they were written', async () => {
    const { api, docs } = fakeWindow();
    const r = await applyZschBatch(
      api,
      [
        'sheet "Power" power.kicad_sch @50.8,50.8 38.1,30.48',
        'net VIN Power.VIN',
        'in "Power"',
        'sym R1 Device:R @100,60',
        'port VIN in R1.1',
        'in root',
        'pins "Power"',
      ].join('\n'),
    );
    expect(r.errors).toEqual([]);
    const root = docs.get('proj.kicad_sch')!;
    expect(root.labels.some((l) => l.kind === 'label' && l.text === 'VIN')).toBe(true);
  });

  it('faces a sheet-pin label away from the sheet: left on the left edge, right on the right', async () => {
    const { api, docs } = fakeWindow();
    const r = await applyZschBatch(
      api,
      [
        'sheet "Power" power.kicad_sch @50.8,50.8 38.1,30.48',
        'in "Power"',
        'sym R1 Device:R @100,60',
        'port VIN in R1.1',
        'port VOUT out R1.2',
        'in root',
        'pins "Power"',
        'net VIN Power.VIN',
        'net VOUT Power.VOUT',
      ].join('\n'),
    );
    expect(r.errors).toEqual([]);
    const root = docs.get('proj.kicad_sch')!;
    const angle = (t: string) => root.labels.find((l) => l.kind === 'label' && l.text === t)!.angle;
    expect(angle('VIN')).toBe(180);
    expect(angle('VOUT')).toBe(0);
  });

  it('refuses a second sheet of the same name on one sheet', async () => {
    const { api } = fakeWindow();
    await applyZschBatch(api, 'sheet "S" s.kicad_sch @50,50 40,30');
    const r = await applyZschBatch(api, 'sheet "S" t.kicad_sch @150,50 40,30');
    expect(r.errors.some((e) => e.includes('a sheet S is already here'))).toBe(true);
  });

  it('leaves the frame on the sheet it was on', async () => {
    const { api } = fakeWindow();
    await applyZschBatch(
      api,
      'sheet "S" s.kicad_sch @50,50 40,30\nin "S"\nsym R1 Device:R @100,60\nport X in R1.1',
    );
    expect(api.readLive!((f) => f.GetCurrentSheet().size())).toBe(1);
  });

  it('finds a port pin by its name as well as its number', async () => {
    const { api, docs } = fakeWindow();
    const r = await applyZschBatch(
      api,
      'sheet "S" s.kicad_sch @50,50 40,30\nin "S"\nsym U1 Test:AB @100,60\nport X in U1.B',
    );
    expect(r.errors).toEqual([]);
    const child = docs.get('s.kicad_sch')!;
    const label = child.labels.find((l) => l.text === 'X')!;
    const byNumber = await applyZschBatch(api, 'in "S"\nport Y in U1.2');
    expect(byNumber.errors).toEqual([]);
    const y = docs.get('s.kicad_sch')!.labels.find((l) => l.text === 'Y')!;
    expect(label.at).toEqual(y.at);
  });
});
