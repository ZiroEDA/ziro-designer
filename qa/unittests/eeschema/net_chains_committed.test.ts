/**
 * Committed net chains, `(net_chain …)` persistence (parseSchNetChain +
 * SCH_IO_KICAD_SEXPR::Format), the passthrough bridge gates
 * (buildBridgeAdjacency BLOCK/FORCE), terminal-pin selection (RebuildNetChains
 * pass 4: farthest-apart pin pair), the committed-restore passes (2a terminal
 * match, 2b member-net fallback), and chain netclass application
 * (ApplyNetChainNetclasses → pattern assignments).
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic, serializeSchematic } from '@ziroeda/eeschema';
import { computeNetlist } from '@ziroeda/eeschema/src/connectivity/nets.js';
import {
  chainPatternAssignments,
  detectNetChains,
  isValidNetChainName,
  readNetChains,
  removeFromNetChainCommand,
  restoreCommittedNetChains,
  writeNetChains,
  type CommittedNetChain,
} from '@ziroeda/eeschema/src/connectivity/net_chains.js';
import {
  defaultSchematicSetup,
  resolveEffectiveNetClass,
} from '@ziroeda/designer/src/editors/schematic/schematic_settings.js';

const res = (ref: string, x: number, y: number, uuid: string, extra = ''): string => `
  (symbol (lib_id "Device:R") (at ${x} ${y} 90) (unit 1) (uuid "${uuid}") ${extra}
    (property "Reference" "${ref}" (at ${x} ${y} 0))
    (property "Value" "10k" (at ${x} ${y} 0)))`;

const LIB = `(lib_symbols
  (symbol "Device:R" (property "Reference" "R" (at 0 0 0))
    (symbol "R_1_1"
      (pin passive line (at 0 2.54 270) (length 0)
        (name "~" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))
      (pin passive line (at 0 -2.54 90) (length 0)
        (name "~" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27))))))))`;

const doc = (body: string) =>
  readSchematic(parse(`(kicad_sch (version 20230121) (generator eeschema) ${LIB} ${body})`));

const libOf = (d: ReturnType<typeof doc>) => new Map(d.libSymbols.map((l) => [l.libId, l]));
const netlistOf = (d: ReturnType<typeof doc>) => computeNetlist(d, libOf(d));

// R1 bridging IN-MID, R2 bridging MID-OUT: a 3-net chain.
const CHAIN3 = `
  ${res('R1', 10, 10, 'r1')}
  ${res('R2', 30, 10, 'r2')}
  (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
  (wire (pts (xy 12.54 10) (xy 20 10)) (uuid "wb1"))
  (wire (pts (xy 20 10) (xy 27.46 10)) (uuid "wb2"))
  (wire (pts (xy 32.54 10) (xy 40 10)) (uuid "wc"))
  (label "IN" (at 0 10 0) (uuid "la"))
  (label "MID" (at 20 10 0) (uuid "lb"))
  (label "OUT" (at 40 10 0) (uuid "lc"))`;

describe('net_chain node persistence', () => {
  const NODE = `(net_chain "SIG_PATH" (from "R1" "1") (to "R2" "2")
    (net_class "Fast") (color 255 0 0 0.6)
    (nets "IN" "MID" "OUT"))`;

  it('parses name, terminals, netclass, colour and member nets', () => {
    const d = doc(`${CHAIN3} ${NODE}`);
    const chains = readNetChains(d);
    expect(chains).toHaveLength(1);
    const c = chains[0]!;
    expect(c.name).toBe('SIG_PATH');
    expect(c.from).toEqual({ ref: 'R1', pin: '1' });
    expect(c.to).toEqual({ ref: 'R2', pin: '2' });
    expect(c.netClass).toBe('Fast');
    expect(c.color).toBe('rgba(255, 0, 0, 0.6)');
    expect(c.nets).toEqual(['IN', 'MID', 'OUT']);
  });

  it('skips unknown subsections like the parser depth loop', () => {
    const d = doc(`(net_chain "X" (from "R1" "1") (to "R2" "2")
      (future_thing (nested "deep")) (nets "A"))`);
    const c = readNetChains(d)[0]!;
    expect(c.nets).toEqual(['A']);
  });

  it('round-trips through the schematic writer untouched', () => {
    const d = doc(`${CHAIN3} ${NODE}`);
    const re = readSchematic(parse(serializeSchematic(d)));
    expect(readNetChains(re)).toEqual(readNetChains(d));
  });

  it('writeNetChains replaces nodes, skipping chains without terminals and synthetic nets', () => {
    const d = doc(CHAIN3);
    const chains: CommittedNetChain[] = [
      {
        name: 'KEEP',
        from: { ref: 'R1', pin: '1' },
        to: { ref: 'R2', pin: '2' },
        netClass: '',
        color: '',
        nets: ['IN', '__SG_7', 'MID'],
      },
      {
        name: 'NO_TERMINALS',
        from: { ref: '', pin: '' },
        to: { ref: '', pin: '' },
        netClass: '',
        color: '',
        nets: ['X'],
      },
    ];
    const out = serializeSchematic(writeNetChains(d, chains));
    expect(out).toContain('(net_chain "KEEP"');
    expect(out).not.toContain('NO_TERMINALS');
    expect(out).not.toContain('__SG_7');
    const back = readNetChains(readSchematic(parse(out)));
    expect(back).toHaveLength(1);
    expect(back[0]!.nets).toEqual(['IN', 'MID']);
  });

  it('validates chain names like SCH_NETCHAIN::IsValidName', () => {
    expect(isValidNetChainName('SIG_1')).toBe(true);
    expect(isValidNetChainName('')).toBe(false);
    expect(isValidNetChainName('has space')).toBe(false);
    expect(isValidNetChainName('pa(ren')).toBe(false);
    expect(isValidNetChainName('quo"te')).toBe(false);
  });
});

describe('passthrough bridge gates', () => {
  it('(passthrough block) removes a symbol from bridging', () => {
    const d = doc(`
      ${res('R1', 10, 10, 'r1', '(passthrough block)')}
      (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
      (wire (pts (xy 12.54 10) (xy 20 10)) (uuid "wb"))
      (label "IN" (at 0 10 0) (uuid "la"))
      (label "MID" (at 20 10 0) (uuid "lb"))`);
    expect(detectNetChains(d, libOf(d), netlistOf(d))).toHaveLength(0);
  });

  it('(passthrough force) bridges even non-collinear wires', () => {
    // Wire B is vertical while wire A is horizontal, default mode rejects.
    const d = doc(`
      ${res('R1', 10, 10, 'r1', '(passthrough force)')}
      (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
      (wire (pts (xy 12.54 10) (xy 12.54 20)) (uuid "wb"))
      (label "IN" (at 0 10 0) (uuid "la"))
      (label "MID" (at 12.54 20 0) (uuid "lb"))`);
    const chains = detectNetChains(d, libOf(d), netlistOf(d));
    expect(chains).toHaveLength(1);
    expect(chains[0]!.nets).toEqual(['/IN', '/MID']);

    // Without force the same layout produces nothing.
    const plain = doc(`
      ${res('R1', 10, 10, 'r1')}
      (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
      (wire (pts (xy 12.54 10) (xy 12.54 20)) (uuid "wb"))
      (label "IN" (at 0 10 0) (uuid "la"))
      (label "MID" (at 12.54 20 0) (uuid "lb"))`);
    expect(detectNetChains(plain, libOf(plain), netlistOf(plain))).toHaveLength(0);
  });

  it('passthrough round-trips through the symbol writer, omitted at DEFAULT', () => {
    const d = doc(res('R1', 10, 10, 'r1', '(passthrough force)'));
    expect(d.symbols[0]!.passthrough).toBe('force');
    expect(serializeSchematic(d)).toContain('(passthrough force)');
    const plain = doc(res('R2', 10, 10, 'r2'));
    expect(plain.symbols[0]!.passthrough).toBeUndefined();
    expect(serializeSchematic(plain)).not.toContain('passthrough');
  });
});

describe('terminal pins (pass 4)', () => {
  it('picks the farthest-apart pin pair on member nets', () => {
    const d = doc(CHAIN3);
    const chains = detectNetChains(d, libOf(d), netlistOf(d));
    expect(chains).toHaveLength(1);
    const t = chains[0]!.terminals!;
    // Chain spans R1 (x≈7.46/12.54) to R2 (x≈27.46/32.54): the extremes are
    // R1 pin at x=7.46 and R2 pin at x=32.54.
    const refs = [t[0].ref, t[1].ref].sort();
    expect(refs).toEqual(['R1', 'R2']);
  });
});

describe('committed restore', () => {
  it('pass 2a: terminals resolve into a potential chain, refreshing nets', () => {
    const d = doc(`${CHAIN3}
      (net_chain "SIG_PATH" (from "R1" "1") (to "R2" "2") (nets "STALE"))`);
    const nl = netlistOf(d);
    const potentials = detectNetChains(d, libOf(d), nl);
    const restored = restoreCommittedNetChains(d, libOf(d), nl, potentials, readNetChains(d));
    expect(restored).toHaveLength(1);
    expect(restored[0]!.name).toBe('SIG_PATH');
    expect(restored[0]!.nets).toEqual(['/IN', '/MID', '/OUT']); // refreshed from live topology
  });

  it('pass 2b: falls back to the member-net list when no potential matches', () => {
    // No wires between the resistors: no potential chain exists, but the
    // persisted member nets still resolve pins.
    const d = doc(`
      ${res('R1', 10, 10, 'r1')}
      (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
      (label "IN" (at 0 10 0) (uuid "la"))
      (net_chain "MANUAL" (from "R1" "1") (to "R1" "2") (nets "/IN"))`);
    const nl = netlistOf(d);
    const restored = restoreCommittedNetChains(d, libOf(d), nl, [], readNetChains(d));
    expect(restored).toHaveLength(1);
    expect(restored[0]!.name).toBe('MANUAL');
    expect(restored[0]!.nets).toEqual(['/IN']);
  });

  it('drops chains whose terminals cannot be resolved at all', () => {
    const d = doc(`${CHAIN3}
      (net_chain "GHOST" (from "R9" "1") (to "R9" "2") (nets "NOWHERE"))`);
    const nl = netlistOf(d);
    const restored = restoreCommittedNetChains(
      d,
      libOf(d),
      nl,
      detectNetChains(d, libOf(d), nl),
      readNetChains(d),
    );
    expect(restored).toHaveLength(0);
  });
});

describe('chain netclass application (ApplyNetChainNetclasses)', () => {
  it('member nets resolve to the chain netclass, after user patterns', () => {
    const chain: CommittedNetChain = {
      name: 'SIG',
      from: { ref: 'R1', pin: '1' },
      to: { ref: 'R2', pin: '2' },
      netClass: 'Fast',
      color: '',
      nets: ['IN', 'MID', '__SG_3'],
    };
    const assigns = chainPatternAssignments([chain]);
    expect(assigns).toEqual([
      { pattern: 'IN', netClass: 'Fast' },
      { pattern: 'MID', netClass: 'Fast' },
    ]);

    const setup = defaultSchematicSetup();
    setup.netClasses.classes.push({
      ...setup.netClasses.classes[0]!,
      name: 'Fast',
      wireThickness: '20',
      color: '#00ff00',
    });
    const eff = resolveEffectiveNetClass('MID', setup.netClasses, assigns);
    expect(eff.name).toBe('Fast');
    expect(eff.wireWidthMils).toBe(20);
    // Nets outside the chain stay on Default.
    expect(resolveEffectiveNetClass('OTHER', setup.netClasses, assigns).name).toBe('Default');
    // A chain netclass that doesn't exist is ignored (HasNetclass gate).
    const missing = resolveEffectiveNetClass('IN', setup.netClasses, [
      { pattern: 'IN', netClass: 'Nope' },
    ]);
    expect(missing.name).toBe('Default');
  });
});

describe('removeFromNetChainCommand (SCH_EDITOR_CONTROL::RemoveFromNetChain)', () => {
  const TWO_NET = `
    ${res('R1', 10, 10, 'r1')}
    (wire (pts (xy 0 10) (xy 7.46 10)) (uuid "wa"))
    (wire (pts (xy 12.54 10) (xy 20 10)) (uuid "wb"))
    (label "IN" (at 0 10 0) (uuid "la"))
    (label "MID" (at 20 10 0) (uuid "lb"))`;

  it('blocks every 2-pin symbol bridging the net, undoably', () => {
    const d = doc(TWO_NET);
    const lib = libOf(d);
    const nl = netlistOf(d);
    expect(detectNetChains(d, lib, nl)).toHaveLength(1);

    // The net name as the UI hands it over: qualified with its sheet path.
    const cmd = removeFromNetChainCommand(d, lib, nl, '/IN');
    expect(cmd).not.toBeNull();
    const after = cmd!.apply(d);
    expect(after.symbols[0]!.passthrough).toBe('block');
    expect(detectNetChains(after, lib, netlistOf(after))).toHaveLength(0);
    expect(serializeSchematic(after)).toContain('(passthrough block)');

    // invert restores the prior (unset) mode exactly.
    const undo = cmd!.invert(d);
    const restored = undo.apply(after);
    expect(restored.symbols[0]!.passthrough).toBeUndefined();
    expect(detectNetChains(restored, lib, netlistOf(restored))).toHaveLength(1);
  });

  it('returns null when nothing bridges the net', () => {
    const d = doc(TWO_NET);
    expect(removeFromNetChainCommand(d, libOf(d), netlistOf(d), 'NOWHERE')).toBeNull();
  });
});
