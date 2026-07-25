/**
 * Simulation model resolution (counterpart SIM_MODEL::ReadTypeFromFields /
 * InferSimModel and SIM_LIB_MGR::CreateModel): the diagnostics ERC's
 * TestSimModelIssues turns into markers.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '@ziroeda/sexpr/src/index.js';
import { readSchematic } from '@ziroeda/eeschema';
import {
  checkSimModel,
  findSpiceModel,
  readTypeFromFields,
} from '@ziroeda/eeschema/src/sim/sim_model.js';

/** A two-pin symbol with the given fields. */
const symbolWith = (fields: string, ref = 'R1') => {
  const doc = readSchematic(
    parse(`(kicad_sch (version 20230121) (generator eeschema)
      (lib_symbols
        (symbol "T:TWO" (property "Reference" "R" (at 0 0 0)) (property "Value" "TWO" (at 0 0 0))
          (symbol "TWO_1_1"
            (pin passive line (at 0 0 0) (length 2.54)
              (name "A" (effects (font (size 1.27 1.27))))
              (number "1" (effects (font (size 1.27 1.27)))))
            (pin passive line (at 0 -2.54 0) (length 2.54)
              (name "B" (effects (font (size 1.27 1.27))))
              (number "2" (effects (font (size 1.27 1.27))))))))
      (symbol (lib_id "T:TWO") (at 10 10 0) (unit 1)
        (property "Reference" "${ref}" (at 10 10 0))
        ${fields}
        (uuid "s1")))`),
  );
  return { sym: doc.symbols[0]!, lib: doc.libSymbols[0]! };
};

describe('readTypeFromFields', () => {
  it('resolves a device/type pair that names a TYPE', () => {
    expect(readTypeFromFields('R', '').found).toBe(true);
    expect(readTypeFromFields('NPN', 'GUMMELPOON').found).toBe(true);
    expect(readTypeFromFields('V', 'SIN').found).toBe(true);
  });

  it('is silent when Sim.Type is empty (TYPE::NONE)', () => {
    expect(readTypeFromFields('', '').found).toBe(true);
    expect(readTypeFromFields('NOSUCH', '').found).toBe(true);
  });

  it('fails on a type no device provides', () => {
    expect(readTypeFromFields('R', 'SIN').found).toBe(false);
    expect(readTypeFromFields('', 'GUMMELPOON').found).toBe(false);
  });
});

describe('checkSimModel', () => {
  const noLibraries = () => undefined;

  it('says nothing about a plain RLC symbol (InferSimModel covers it)', () => {
    const { sym, lib } = symbolWith('(property "Value" "10k" (at 10 10 0))');
    expect(checkSimModel(sym, lib, noLibraries)).toEqual([]);
  });

  it('says nothing about a behavioural RLC value either', () => {
    const { sym, lib } = symbolWith('(property "Value" "V(1)*2" (at 10 10 0))');
    expect(checkSimModel(sym, lib, noLibraries)).toEqual([]);
  });

  it('reports a Sim.Type that no device provides', () => {
    const { sym, lib } = symbolWith(
      `(property "Value" "10k" (at 10 10 0))
       (property "Sim.Device" "R" (at 10 10 0))
       (property "Sim.Type" "SIN" (at 10 10 0))`,
      'U1',
    );
    expect(checkSimModel(sym, lib, noLibraries)).toEqual([
      { message: "No simulation model definition found for symbol 'U1'." },
    ]);
  });

  it('reports a missing library, a missing Sim.Name and an unknown base model', () => {
    const withLib = (extra: string) =>
      symbolWith(
        `(property "Value" "X" (at 10 10 0))
         (property "Sim.Library" "models.lib" (at 10 10 0))
         ${extra}`,
        'U1',
      );

    // The library cannot be resolved at all.
    const missing = withLib('(property "Sim.Name" "OPA" (at 10 10 0))');
    expect(checkSimModel(missing.sym, missing.lib, noLibraries)).toEqual([
      { message: "Simulation model library not found at 'models.lib'" },
    ]);

    const library = '.subckt OPA1 1 2 3\n.ends\n.MODEL DIODE1 D\n';
    const resolve = (path: string) => (path === 'models.lib' ? library : undefined);

    // Present, but the symbol names no model.
    const noName = withLib('');
    expect(checkSimModel(noName.sym, noName.lib, resolve)).toEqual([
      { message: "Error loading simulation model: no 'Sim.Name' field" },
    ]);

    // Present, but the model isn't in it.
    const unknown = withLib('(property "Sim.Name" "OPA" (at 10 10 0))');
    expect(checkSimModel(unknown.sym, unknown.lib, resolve)).toEqual([
      {
        message:
          "Error loading simulation model: could not find base model 'OPA' in library 'models.lib'",
      },
    ]);

    // …and nothing at all when the model is there (case-insensitively).
    const ok = withLib('(property "Sim.Name" "diode1" (at 10 10 0))');
    expect(checkSimModel(ok.sym, ok.lib, resolve)).toEqual([]);
  });
});

describe('findSpiceModel', () => {
  it('finds .model and .subckt definitions, ignoring continuations', () => {
    const text = [
      '* a comment',
      '.SUBCKT LM358 1 2 3',
      '+ params: x=1',
      '.ends',
      '.model Q2N2222 NPN',
    ].join('\n');
    expect(findSpiceModel(text, 'LM358')).toBe(true);
    expect(findSpiceModel(text, 'q2n2222')).toBe(true);
    expect(findSpiceModel(text, 'params:')).toBe(false);
  });
});
