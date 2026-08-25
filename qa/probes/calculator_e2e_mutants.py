#!/usr/bin/env python3
"""Mutation sweep for the calculator end-to-end parity tests.

Each mutant is a single edit to the IMPLEMENTATION that should make one of
`qa/unittests/designer/calc_e2e_*.test.tsx` (or the engine test that a fix
moved) fail. Three things this scores separately, because they read alike:

  KILLED        - the edit applied, the package typechecked, tests failed
  SURVIVED      - the edit applied and typechecked, and tests still passed
  BUILD FAILURE - the edit applied but does not compile: a false negative
  HARNESS ERROR - the edit did not apply, or the run produced no test summary

The last is the one that has bitten before: an anchor that misses leaves the
file untouched, and an untouched file passes, which is indistinguishable from a
kill. Every mutant asserts the file's bytes changed before it is scored, and
the process exit code is what decides pass/fail - not a regex over the summary,
because vitest prints `Tests  1 failed (1)` with no `passed` count when every
test in a file fails.

Run from the repo root. Commit the baseline first: a restore is `git checkout --`.
"""
import subprocess, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VITEST = os.path.join(ROOT, 'node_modules/.bin/vitest')

# (name, file, old, new, package-to-typecheck, test files)
MUTANTS = [
    ('ipc2221 B4 value', 'pcb_calculator/src/electrical_spacing_values.ts',
     '[0.05, 0.1, 0.1, 0.05, 0.13, 0.13, 0.13],', '[0.05, 0.1, 0.1, 0.06, 0.13, 0.13, 0.13],',
     'pcb_calculator', ['unittests/designer/calc_e2e_power.test.tsx']),
    ('ipc2221 class id A5', 'pcb_calculator/src/electrical_spacing_values.ts',
     "    id: 'A5',", "    id: 'B5',",
     'pcb_calculator', ['unittests/designer/calc_e2e_power.test.tsx']),
    ('ipc2221 per-volt row', 'pcb_calculator/src/electrical_spacing_values.ts',
     '[0.0025, 0.005, 0.025, 0.00305, 0.00305, 0.00305, 0.00305],',
     '[0.0025, 0.005, 0.025, 0.00405, 0.00305, 0.00305, 0.00305],',
     'pcb_calculator', ['unittests/designer/calc_e2e_power.test.tsx']),
    ('AWG12 radius', 'pcb_calculator/src/cable_size.ts',
     '0.00145288, 0.00129413, 0.00115189, 0.00102616,',
     '0.00145288, 0.00129413, 0.00115189, 0.00102716,',
     'pcb_calculator', ['unittests/designer/calc_e2e_power.test.tsx']),
    ('AWG back to the formula', 'pcb_calculator/src/cable_size.ts',
     '  const r = AWG_RADIUS_M[n + 3];\n  return r === undefined ? NaN : r * 2;',
     '  return 0.000127 * 92 ** ((36 - n) / 39);',
     'pcb_calculator', ['unittests/designer/calc_e2e_power.test.tsx']),
    # KiCad's UNIT_SELECTOR recalculates and does not rewrite the entry. Make it
    # convert the text instead - the behaviour we used to have.
    ('unit switch converts the number', 'designer/src/editors/calculator/fields.tsx',
     '''  const switchUnit = (nextIdx: number): void => {
    if (onUnitIdx) onUnitIdx(nextIdx);
    else setOwnIdx(nextIdx);
  };''',
     '''  const switchUnit = (nextIdx: number): void => {
    const nextMult = units[nextIdx]?.mult ?? 1;
    emit(printfG((parseNum(text) * mult) / nextMult, digits));
    if (onUnitIdx) onUnitIdx(nextIdx);
    else setOwnIdx(nextIdx);
  };''',
     'designer', ['unittests/designer/calc_e2e_power.test.tsx']),
    ('transline result space', 'designer/src/editors/calculator/panels/panel_transline.tsx',
     "v == null ? '' : `${printfG(v)} ${unit}`;",
     "v == null ? '' : unit ? `${printfG(v)} ${unit}` : printfG(v);",
     'designer', ['unittests/designer/calc_e2e_highspeed.test.tsx']),
    ('synthesize shows no results', 'designer/src/editors/calculator/panels/panel_transline.tsx',
     '    analyze(solved, false);\n  };', '    setMsgs([]);\n  };',
     'designer', ['unittests/designer/calc_e2e_highspeed.test.tsx']),
    ('rectwaveguide result uses z0', 'designer/src/editors/calculator/panels/panel_transline.tsx',
     "            g(r.z0EH, 'Ohm'),", "            g(r.z0, 'Ohm'),",
     'designer', ['unittests/designer/calc_e2e_highspeed.test.tsx']),
    ('bridged tee drops R3', 'designer/src/editors/calculator/panels/panel_rf_attenuators.tsx',
     "            {['R1', 'R2', 'R3'].map((label, i) => {",
     "            {info.resistorLabels.map((label, i) => {",
     'designer', ['unittests/designer/calc_e2e_highspeed.test.tsx']),
    ('Zdiff doubles the dispersed Zodd', 'pcb_calculator/src/transline/c_microstrip.ts',
     '  const zDiff = 2.0 * st.z0O0;', '  const zDiff = 2.0 * fr.z0O;',
     'pcb_calculator', ['unittests/designer/calc_e2e_highspeed.test.tsx',
                        'unittests/pcb_calculator/transline_kicad_qa.test.ts']),
    ('coupled stripline a = (h-t)/2', 'pcb_calculator/src/transline/c_stripline.ts',
     'lengthM: 1, offsetM: h / 2.0 },', 'lengthM: 1, offsetM: (h - t) / 2.0 },',
     'pcb_calculator', ['unittests/designer/calc_e2e_highspeed.test.tsx']),
    ('evanescent guide back to NaN', 'pcb_calculator/src/transline/rectwaveguide.ts',
     '    z0: 0,\n    z0EH:', '    z0: NaN,\n    z0EH:',
     'pcb_calculator', ['unittests/pcb_calculator/high_speed.test.ts']),
    ('rectwaveguide mode list trimmed', 'pcb_calculator/src/transline/rectwaveguide.ts',
     "  return { te: te || 'none', tm: tm || 'none' };",
     "  return { te: te.trim() || 'none', tm: tm.trim() || 'none' };",
     'pcb_calculator', ['unittests/designer/calc_e2e_highspeed.test.tsx']),
    ('coax modes use Din', 'pcb_calculator/src/transline/coax.ts',
     '  if (C0 / ((Math.PI * (dout + mur)) / 1.0) > freq) {',
     '  if (C0 / ((Math.PI * (dout + din)) / 1.0) > freq) {',
     'pcb_calculator', ['unittests/designer/calc_e2e_highspeed.test.tsx']),
    ('printfG loses the -nan sign', 'pcb_calculator/src/format.ts',
     "  if (Number.isNaN(value)) return nanIsNegative(value) ? '-nan' : 'nan';\n  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';\n\n  const p = precision === 0 ? 1 : precision;",
     "  if (Number.isNaN(value)) return 'nan';\n  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';\n\n  const p = precision === 0 ? 1 : precision;",
     'pcb_calculator', ['unittests/pcb_calculator/high_speed.test.ts']),
    ('printfG precision', 'pcb_calculator/src/format.ts',
     'export function printfG(value: number, precision = 6): string {',
     'export function printfG(value: number, precision = 5): string {',
     'pcb_calculator', ['unittests/designer/calc_e2e_power.test.tsx']),
    ('2R buffer tie-break dropped', 'pcb_calculator/src/resistor_substitution_utils.ts',
     '    const ka = tieKey.get(a) ?? \'\';\n    const kb = tieKey.get(b) ?? \'\';\n    return ka < kb ? -1 : ka > kb ? 1 : 0;',
     '    return 0;',
     'pcb_calculator', ['unittests/designer/calc_e2e_general.test.tsx']),
    ('regulator rounds to 0.01', 'designer/src/editors/calculator/panels/panel_regulator.tsx',
     'const roundTo = (v: number, precision = 0.001)', 'const roundTo = (v: number, precision = 0.01)',
     'designer', ['unittests/designer/calc_e2e_general.test.tsx']),
    ('board class Class 1 line width', 'pcb_calculator/src/board_classes_values.ts',
     '0.8,', '0.85,',
     'pcb_calculator', ['unittests/designer/calc_e2e_memo.test.tsx']),
    ('galvanic first potential', 'pcb_calculator/src/galvanic_corrosion.ts',
     "'Rh'", "'Rx'",
     'pcb_calculator', ['unittests/designer/calc_e2e_memo.test.tsx']),
    ('eseries display scale', 'pcb_calculator/src/eseries.ts',
     'export const ESERIES_DISPLAY_SCALE = 100;', 'export const ESERIES_DISPLAY_SCALE = 10;',
     'pcb_calculator', ['unittests/designer/calc_e2e_memo.test.tsx']),
    ('colour code 4th band shown', 'designer/src/editors/calculator/panels/panel_color_code.tsx',
     '{tol2 && <Band title="4th Band"', '{!tol2 && <Band title="4th Band"',
     'designer', ['unittests/designer/calc_e2e_memo.test.tsx']),
]


def run(cmd, cwd=ROOT):
    return subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)


def restore():
    run('git checkout -- pcb_calculator/src designer/src')


def main():
    only = sys.argv[1:] or None
    tally = {}
    for name, path, old, new, pkg, tests in MUTANTS:
        if only and name not in only:
            continue
        restore()
        full = os.path.join(ROOT, path)
        before = open(full, 'rb').read()
        text = before.decode()
        if old not in text:
            print(f'{name:38s} HARNESS ERROR  (anchor not found in {path})')
            tally[name] = 'HARNESS'
            continue
        open(full, 'w').write(text.replace(old, new, 1))
        after = open(full, 'rb').read()
        if after == before:
            print(f'{name:38s} HARNESS ERROR  (file unchanged)')
            tally[name] = 'HARNESS'
            continue

        tc = run(f'./node_modules/.bin/tsc --noEmit -p {pkg}/tsconfig.json')
        if tc.returncode != 0:
            print(f'{name:38s} BUILD FAILURE  (does not compile - not a kill)')
            tally[name] = 'BUILD'
            restore()
            continue

        r = run(f'{VITEST} run {" ".join(tests)}', cwd=os.path.join(ROOT, 'qa'))
        out = r.stdout + r.stderr
        if 'Tests ' not in out and 'Test Files' not in out:
            print(f'{name:38s} HARNESS ERROR  (no test summary; exit {r.returncode})')
            tally[name] = 'HARNESS'
        elif r.returncode != 0:
            print(f'{name:38s} KILLED')
            tally[name] = 'KILLED'
        else:
            print(f'{name:38s} SURVIVED  <-- the behaviour is not pinned')
            tally[name] = 'SURVIVED'
        restore()

    print()
    for verdict in ('KILLED', 'SURVIVED', 'BUILD', 'HARNESS'):
        n = sum(1 for v in tally.values() if v == verdict)
        print(f'{verdict:8s} {n}')


if __name__ == '__main__':
    main()
