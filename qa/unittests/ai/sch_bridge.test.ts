import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applyZsch,
  symbolPins,
  ercText,
  pinHints,
  readZsch,
  schBridge,
  searchIndex,
} from '@ziroeda/ai/sch_bridge.js';
import { runErc } from '@ziroeda/eeschema/erc/erc.js';
import { enumeratePins, symbolBodyBBox } from '@ziroeda/eeschema';
import { serializeSchematic } from '@ziroeda/eeschema/index.js';
import type { SchScriptApi } from '@ziroeda/eeschema/sch_script_api.js';
import { readSchematic, readSymbolLib } from '@ziroeda/eeschema/sch_io/sexpr/read-schematic.js';
import type { EditCommand } from '@ziroeda/eeschema/tools/command.js';
import type { LibSymbol, Schematic } from '@ziroeda/eeschema/types.js';
import { parse } from '@ziroeda/sexpr/index.js';
import { describe, expect, it } from 'vitest';

const lib = (file: string, qualified: string): LibSymbol => {
  const [sym] = readSymbolLib(
    parse(readFileSync(fileURLToPath(new URL(`../../data/${file}`, import.meta.url)), 'utf8')),
  );
  return { ...(sym as LibSymbol), libId: qualified };
};
/**
 * Device:R reshaped for one case: its pins given other names, places and
 * directions (connection point, angle 0 = pointing right into the body).
 */
const reshaped = (
  qualified: string,
  pins: { name: string; at: { x: number; y: number }; angle: number }[],
): LibSymbol => {
  const r = lib('R.kicad_sym', qualified);
  return {
    ...r,
    units: r.units.map((u) => ({
      ...u,
      pins: u.pins.map((p, i) => ({ ...p, ...(pins[i] ?? {}) })),
    })),
  };
};
const LIBS: Record<string, LibSymbol> = {
  // A reset pin with an overbar, as Timer:NE555P's ~{RST}.
  'Test:Overbar': reshaped('Test:Overbar', [
    { name: '~{RST}', at: { x: 0, y: -38100 }, angle: 270 },
    { name: 'GND', at: { x: 0, y: 38100 }, angle: 90 },
  ]),
  // A tall part's left-side pin near its top corner: it faces left although
  // it sits further from the centre vertically than horizontally.
  'Test:Corner': reshaped('Test:Corner', [
    { name: 'A', at: { x: -25400, y: -63500 }, angle: 0 },
    { name: 'B', at: { x: 0, y: 76200 }, angle: 90 },
  ]),
  'Device:R': lib('R.kicad_sym', 'Device:R'),
  'Device:C': lib('C.kicad_sym', 'Device:C'),
  'power:GND': lib('GND.kicad_sym', 'power:GND'),
};

const FP_INDEX = [
  { name: 'Resistor_SMD', footprints: ['R_0402_1005Metric', 'R_0603_1608Metric'] },
  { name: 'Capacitor_SMD', footprints: ['C_0603_1608Metric'] },
  { name: 'Package_TO_SOT_SMD', footprints: ['SOT-23', 'SOT-23-5'] },
];

function fakeEditor(): SchScriptApi & { undo(): void; commits: number } {
  let doc: Schematic = readSchematic(
    parse(
      '(kicad_sch (version 20250114) (generator "eeschema") (uuid "0f0e0d0c-0000-4000-8000-000000000001") (paper "A4") (lib_symbols))',
    ),
  );
  const history: Schematic[] = [];
  return {
    commits: 0,
    doc: () => doc,
    runCommand(cmd: EditCommand) {
      history.push(doc);
      doc = cmd.apply(doc);
      this.commits++;
    },
    undo() {
      doc = history.pop() ?? doc;
    },
    annotatePlacement: (s) => s,
    loadSymbol: async (l, n) => LIBS[`${l}:${n}`],
    erc: () => runErc(doc, new Map(doc.libSymbols.map((l) => [l.libId, l]))),
    symbolIndex: async () => [{ name: 'Device', symbols: ['R', 'C', 'R_Small'] }],
    footprintIndex: async () => FP_INDEX,
    snapshot: () => '',
  };
}

describe('zsch over the live schematic', () => {
  it('builds an RC divider in ONE commit and reads it back as the same circuit', async () => {
    const ed = fakeEditor();
    const r = await applyZsch(
      ed,
      [
        'sym R1 Device:R @50.8,50.8 val=10k fp=Resistor_SMD:R_0402_1005Metric',
        'sym R2 Device:R @50.8,76.2 val=4k7',
        'sym C1 Device:C @76.2,76.2 val=100n',
        'net VIN R1.1',
        'net MID R1.2 R2.1 C1.1',
        'net GND R2.2 C1.2',
      ].join('\n'),
    );
    expect(r.errors).toEqual([]);
    expect(ed.commits).toBe(1);
    const z = readZsch(ed.doc() as Schematic);
    // size: Device:R's body 2.032 mm + its 0.254 mm stroke, pins ending at +-3.81 mm.
    expect(z).toContain(
      'sym R1 Device:R @50.8,50.8 size 2.29x7.62 val=10k fp=Resistor_SMD:R_0402_1005Metric',
    );
    // Device:C: plates -2.032..2.032 mm plus their 0.508 mm stroke.
    expect(z).toContain('sym C1 Device:C @76.2,76.2 size 4.57x7.62 val=100n');
    const nets = Object.fromEntries(
      z
        .split('\n')
        .filter((l) => l.startsWith('net '))
        .map((l) => {
          const [, name, ...pins] = l.split(' ');
          return [name, pins.sort()];
        }),
    );
    expect(nets.MID).toEqual(['C1.1', 'R1.2', 'R2.1']);
    expect(nets.GND).toEqual(['C1.2', 'R2.2']);
    expect(nets.VIN).toEqual(['R1.1']);
    // The edit serializes, and Ctrl+Z takes the whole AI turn back.
    expect(serializeSchematic(ed.doc() as Schematic)).toContain('"10k"');
    ed.undo();
    expect((ed.doc() as Schematic).symbols).toHaveLength(0);
  });

  it('updates an existing part in place and reports unknown symbols', async () => {
    const ed = fakeEditor();
    await applyZsch(ed, 'sym R1 Device:R @50.8,50.8 val=10k');
    const r = await applyZsch(ed, 'sym R1 Device:R val=22k\nsym U9 Nope:Thing @10,10');
    expect(r.errors).toEqual(['sym U9 Nope:Thing @10,10: unknown symbol Nope:Thing']);
    expect(readZsch(ed.doc() as Schematic)).toContain(
      'sym R1 Device:R @50.8,50.8 size 2.29x7.62 val=22k',
    );
  });

  it('renames R? placeholders everywhere in the reply and draws real wires', async () => {
    const ed = fakeEditor();
    const r = await applyZsch(
      ed,
      ['sym R? Device:R @50.8,50.8', 'sym R? Device:R @50.8,76.2', 'net ~ R?.2 R?.1'].join('\n'),
    );
    // A repeated placeholder resolves to the last part given it; what must hold
    // is that `R?.n` in a net line resolves at all (the screenshot's 6 failures).
    expect(r.errors).toEqual([]);
    const doc = ed.doc() as Schematic;
    expect(doc.symbols.map((s) => s.fields.find((f) => f.key === 'Reference')?.value)).toEqual([
      'R1',
      'R2',
    ]);
  });

  it('connects an unnamed net with one shared label name', async () => {
    const ed = fakeEditor();
    await applyZsch(ed, 'sym R1 Device:R @50.8,50.8\nsym R2 Device:R @50.8,76.2\nnet ~ R1.2 R2.1');
    const doc = ed.doc() as Schematic;
    expect(doc.labels.map((l) => l.text)).toEqual(['N_R1_2', 'N_R1_2']);
    expect(readZsch(doc)).toMatch(/^net N_R1_2 (R1\.2 R2\.1|R2\.1 R1\.2)$/m);
  });

  it('round-trips title and boxes', async () => {
    const ed = fakeEditor();
    await applyZsch(
      ed,
      'title "LED Indicator" rev="A"\nbox "POWER INPUT" @20.32,20.32 60.96,40.64',
    );
    const z = readZsch(ed.doc() as Schematic);
    expect(z).toContain('title "LED Indicator" rev="A"');
    expect(z).toContain('box "POWER INPUT" @20.32,20.32 60.96,40.64');
  });

  it('del then sym with the same REF in one reply rebuilds, leaving nothing behind', async () => {
    const ed = fakeEditor();
    const build = [
      'sym R1 Device:R @50.8,50.8',
      'sym C1 Device:C @76.2,50.8',
      'net MID R1.2 C1.1',
      'net GND R1.1 C1.2',
    ];
    await applyZsch(ed, build.join('\n'));
    const once = ed.doc() as Schematic;
    // The screenshot's reply: delete every part, then re-add them by the same names.
    const r = await applyZsch(ed, ['del R1', 'del C1', ...build].join('\n'));
    expect(r.errors).toEqual([]);
    const twice = ed.doc() as Schematic;
    expect(twice.symbols).toHaveLength(once.symbols.length);
    expect(twice.lines).toHaveLength(once.lines.length);
    expect(twice.labels).toHaveLength(once.labels.length);
    expect(readZsch(twice)).toBe(readZsch(once));
  });

  it('del removes the stubs, labels and power symbols hanging off the part', async () => {
    const ed = fakeEditor();
    await applyZsch(ed, 'sym R1 Device:R @50.8,50.8\nnet SIG R1.2\nnet GND R1.1');
    await applyZsch(ed, 'del R1');
    const doc = ed.doc() as Schematic;
    expect(doc.symbols).toHaveLength(0);
    expect(doc.lines).toHaveLength(0);
    expect(doc.labels).toHaveLength(0);
  });

  it('names the real pins of a part a failed line guessed at', async () => {
    const ed = fakeEditor();
    const r = await applyZsch(ed, 'sym R1 Device:R @50.8,50.8\nnet GND R1.1\nnet SIG R1.A');
    expect(r.errors).toEqual(['net SIG: no pin R1.A']);
    expect(pinHints(ed, r.errors)).toEqual(['pins R1: 1=~ 2=~']);
  });

  it('run_erc reports the floating pin as REF.PIN, and a clean sheet as clean', async () => {
    const ed = fakeEditor();
    expect(ercText(ed)).toBe('ERC clean');
    await applyZsch(ed, 'sym R1 Device:R @50.8,50.8\nnet GND R1.1');
    expect(ercText(ed)).toMatch(/pin_not_connected.*\[R1\.2\]/);
  });

  it('pkg= picks the stock chip footprint for a Device passive', async () => {
    const ed = fakeEditor();
    const r = await applyZsch(ed, 'sym R1 Device:R @50.8,50.8 val=10k pkg=0603');
    expect(r.errors).toEqual([]);
    expect(readZsch(ed.doc() as Schematic)).toContain('fp=Resistor_SMD:R_0603_1608Metric');
  });

  it('rejects a footprint the libraries do not have, naming close ones', async () => {
    const ed = fakeEditor();
    const r = await applyZsch(ed, 'sym R1 Device:R @50.8,50.8 fp=Resistor_SMD:R_0603');
    expect(r.errors).toEqual([
      'sym R1 Device:R @50.8,50.8 fp=Resistor_SMD:R_0603: unknown footprint Resistor_SMD:R_0603; similar: Resistor_SMD:R_0603_1608Metric',
    ]);
    expect((ed.doc() as Schematic).symbols).toHaveLength(0);
  });

  it('offers the footprints a symbol filters allow when none is given', async () => {
    const ed = fakeEditor();
    const r = await applyZsch(ed, 'sym C1 Device:C @50.8,50.8');
    expect(r.hints).toEqual([
      'C1 has no footprint; its filters allow: Capacitor_SMD:C_0603_1608Metric',
    ]);
  });

  it('search puts the exact name first and needs every term', () => {
    const index = [{ name: 'Package_TO_SOT_SMD', items: ['SOT-23-5', 'SOT-23', 'SOT-223'] }];
    expect(searchIndex(index, 'sot-23')).toEqual([
      // SOT-223 is not a hit: "sot-223" does not contain "sot-23".
      'Package_TO_SOT_SMD:SOT-23',
      'Package_TO_SOT_SMD:SOT-23-5',
    ]);
    expect(searchIndex(index, 'sot 223')).toEqual(['Package_TO_SOT_SMD:SOT-223']);
    // An exact name beats a shorter id that only contains the term.
    const leds = [
      { name: 'LED', items: ['X1'] },
      { name: 'Device', items: ['LED'] },
    ];
    expect(searchIndex(leds, 'led')).toEqual(['Device:LED', 'LED:X1']);
  });

  it('undo_schematic takes back the last AI edit', async () => {
    const ed = fakeEditor();
    const bridge = schBridge(ed);
    await bridge.run('apply_zsch', { zsch: 'sym R1 Device:R @50.8,50.8' });
    expect((ed.doc() as Schematic).symbols).toHaveLength(1);
    await bridge.run('undo_schematic', {});
    expect((ed.doc() as Schematic).symbols).toHaveLength(0);
  });

  describe('what the AI could not see or reach', () => {
    const labelsAt = (doc: Schematic, name: string) =>
      doc.labels
        .filter((l) => l.kind !== 'text' && l.text === name)
        .map((l) => `${l.at.x},${l.at.y}`);

    it('moving a part carries its labels and rails to the new pins, leaving nothing behind', async () => {
      const ed = fakeEditor();
      await applyZsch(
        ed,
        ['sym R1 Device:R @50.8,50.8', 'net SIG R1.1', 'net GND R1.2'].join('\n'),
      );
      const before = labelsAt(ed.doc() as Schematic, 'SIG');
      await applyZsch(ed, 'sym R1 Device:R @101.6,50.8');
      const doc = ed.doc() as Schematic;
      // One SIG label, moved 50.8 mm right with the pin it hangs on.
      expect(labelsAt(doc, 'SIG')).toHaveLength(1);
      expect(labelsAt(doc, 'SIG')[0]).toBe(
        before[0]?.replace(/^\d+/, (x) => String(Number(x) + 508000)),
      );
      expect(
        doc.symbols.filter((s) => s.fields.find((f) => f.key === 'Value')?.value === 'GND'),
      ).toHaveLength(1);
      expect(readZsch(doc)).not.toContain('stray');
      expect(readZsch(doc)).toMatch(/^net SIG R1\.1$/m);
      expect(ercText(ed)).not.toContain('label_dangling');
    });

    it('lists a stray label, names it in ERC, and deletes it by name or with del strays', async () => {
      const ed = fakeEditor();
      await applyZsch(ed, ['sym R1 Device:R @50.8,50.8', 'net SIG R1.1'].join('\n'));
      // A label left on nothing, as an early bad edit would leave one.
      const doc0 = ed.doc() as Schematic;
      const lone = {
        ...doc0.labels[0]!,
        uuid: 'aaaaaaaa-0000-4000-8000-000000000001',
        at: { x: 1270000, y: 1270000 },
      };
      ed.runCommand({
        label: 't',
        apply: (d) => ({ ...d, labels: [...d.labels, lone] }),
        invert: () => ({ label: 't', apply: (d) => d, invert: () => null as never }),
      });
      expect(readZsch(ed.doc() as Schematic)).toContain('stray label SIG @127,127');
      expect(ercText(ed)).toContain('label SIG @127,127');
      const r = await applyZsch(ed, 'del label SIG @127,127');
      expect(r.errors).toEqual([]);
      expect(readZsch(ed.doc() as Schematic)).not.toContain('stray');
      // And the sweep form.
      ed.runCommand({
        label: 't',
        apply: (d) => ({ ...d, labels: [...d.labels, lone] }),
        invert: () => ({ label: 't', apply: (d) => d, invert: () => null as never }),
      });
      await applyZsch(ed, 'del strays');
      expect(readZsch(ed.doc() as Schematic)).not.toContain('stray');
      expect(labelsAt(ed.doc() as Schematic, 'SIG')).toHaveLength(1);
    });

    it('reports overlapping parts after an edit', async () => {
      const ed = fakeEditor();
      const bridge = schBridge(ed);
      const out = await bridge.run('apply_zsch', {
        zsch: 'sym R1 Device:R @50.8,50.8\nsym R2 Device:R @50.8,52.07',
      });
      expect(out?.text).toMatch(/overlap: R1 \/ R2|overlap: R2 \/ R1/);
      const apart = await bridge.run('apply_zsch', { zsch: 'sym R2 Device:R @76.2,50.8' });
      expect(apart?.text).not.toContain('overlap: R1 / R2');
    });

    it("autoplaces a placed part's fields, as eeschema does", async () => {
      const ed = fakeEditor();
      await applyZsch(ed, 'sym R1 Device:R @50.8,50.8 val=10k');
      expect((ed.doc() as Schematic).symbols[0]?.fieldsAutoplaced).toBe('auto');
    });

    it('keeps design notes on the sheet and reads them back', async () => {
      const ed = fakeEditor();
      // Snapped to the 1.27 mm grid: 30 -> 24 steps = 30.48, 40 -> 31 steps = 39.37.
      await applyZsch(ed, 'note "LED current (3.3 - 2.0) / 1k = 1.3 mA" @30,40');
      expect(readZsch(ed.doc() as Schematic)).toContain(
        'note "LED current (3.3 - 2.0) / 1k = 1.3 mA" @30.48,39.37',
      );
    });

    it("lists a symbol's pins as number=name", () => {
      expect(symbolPins(LIBS['Device:R']!)).toBe('1=~ 2=~');
    });
  });
  it('a rail symbol on a side pin points straight out of it, not across the next pin', async () => {
    const ed = fakeEditor();
    // Device:R turned 90: pin 1 faces left, pin 2 right.
    await applyZsch(ed, ['sym R1 Device:R @50.8,50.8 r90', 'net GND R1.2'].join('\n'));
    const doc = ed.doc() as Schematic;
    const libs = new Map(doc.libSymbols.map((l) => [l.libId, l]));
    const gnd = doc.symbols.find((x) => x.fields.find((f) => f.key === 'Value')?.value === 'GND')!;
    const pin2 = enumeratePins(doc, libs).find((p) => p.ref === 'R1' && p.number === '2')!;
    const body = symbolBodyBBox(gnd, libs.get(gnd.libId ?? 'power:GND') ?? libs.get('power:GND'));
    // Wholly beyond the stub's end (2.54 mm out of the pin), on the pin's line:
    // pointing back along the stub would still sit right of the pin itself.
    expect(body.minX).toBeGreaterThanOrEqual(pin2.at.x + 25400);
    expect(body.maxX).toBeGreaterThan(pin2.at.x + 25400);
    expect(body.minY).toBeLessThanOrEqual(pin2.at.y);
    expect(body.maxY).toBeGreaterThanOrEqual(pin2.at.y);
    // R1 pin 1 is left open on purpose; the rail itself must be connected.
    // (power_pin_not_driven is KiCad's rule for a rail with no PWR_FLAG.)
    expect(ercText(ed)).not.toMatch(/pin_not_connected[^\n]*(#PWR|R1\.2)|label_dangling/);
  });
  it('stores a label the way SetSpinStyle does: angle 0 or 90, side by justification', async () => {
    const ed = fakeEditor();
    // R turned 90: pin 1 faces left, pin 2 right.
    await applyZsch(
      ed,
      ['sym R1 Device:R @50.8,50.8 r90', 'net LEFT R1.1', 'net RIGHT R1.2'].join('\n'),
    );
    const doc = ed.doc() as Schematic;
    const spin = (name: string) => {
      const l = doc.labels.find((x) => x.text === name)!;
      return `${l.angle ?? 0} ${(l.effects?.justify ?? []).join(' ')}`;
    };
    expect(spin('LEFT')).toBe('0 right bottom');
    expect(spin('RIGHT')).toBe('0 left bottom');
  });
  it('takes an overbar pin by its name as listed or bare', async () => {
    for (const spelling of ['~{RST}', 'RST']) {
      const ed = fakeEditor();
      const r = await applyZsch(
        ed,
        ['sym U1 Test:Overbar @50.8,50.8', `net nRESET U1.${spelling}`].join('\n'),
      );
      expect(r.errors).toEqual([]);
      expect(readZsch(ed.doc() as Schematic)).toMatch(/^net nRESET U1\.1$/m);
    }
  });

  it("hangs a corner pin's label the way the pin faces, not toward the part's centre", async () => {
    const ed = fakeEditor();
    await applyZsch(ed, ['sym U1 Test:Corner @50.8,50.8', 'net SIG U1.A'].join('\n'));
    const doc = ed.doc() as Schematic;
    const label = doc.labels.find((l) => l.text === 'SIG')!;
    // Pin A is at x 48.26 (50.8 - 2.54) facing left: the label 2.54 mm further left, same y.
    expect(label.at).toEqual({ x: 482600 - 25400, y: 508000 - 63500 });
    expect((label.effects?.justify ?? [])[0]).toBe('right');
  });
});
