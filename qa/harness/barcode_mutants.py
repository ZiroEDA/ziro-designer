#!/usr/bin/env python3
"""Mutate the barcode implementation and check a test notices.

Rules from CLAUDE.md: typecheck every mutant BEFORE running its tests (one that
does not compile is a false negative), assert the file actually changed, and
score build failures separately from survivors.
"""
import re, subprocess, sys, os

ROOT = '/home/akshay/ziro-designer-1'
os.chdir(ROOT)

MUTANTS = [
    # (name, file, find, replace, test files)
    ('symbolRects: do not recentre the modules',
     'pcbnew/src/barcode_geometry.ts',
     "    return movePoly(out, { x: -kiRound(c.x), y: -kiRound(c.y) });",
     "    return movePoly(out, { x: 0, y: 0 });",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('setRect: scale both axes by scaleX',
     'pcbnew/src/barcode_geometry.ts',
     "        y: kiRound((p.y - oldCentre.y) * scaleY + oldCentre.y),",
     "        y: kiRound((p.y - oldCentre.y) * scaleX + oldCentre.y),",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('knockout: margin is the value, not a floor',
     'pcbnew/src/barcode_geometry.ts',
     "    const ix = Math.max(b.margin.x, tenPercentRounded);\n    const iy = Math.max(b.margin.y, tenPercentRounded);",
     "    const ix = Math.min(b.margin.x, tenPercentRounded);\n    const iy = Math.min(b.margin.y, tenPercentRounded);",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('back layer: no mirror',
     'pcbnew/src/barcode_geometry.ts',
     "  if (isBackLayer(b.layer))",
     "  if (false && isBackLayer(b.layer))",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('text: no 1 mm gap under the symbol',
     'pcbnew/src/barcode_geometry.ts',
     "  const textOffset = mmToIU(1);",
     "  const textOffset = 0;",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('code128: try A before B',
     'pcbnew/src/barcode/code128.ts',
     "  if (haveC) priority.push(C0);\n  if (haveB || !haveA) priority.push(B0);\n  if (haveA) priority.push(A0);",
     "  if (haveC) priority.push(C0);\n  if (haveA) priority.push(A0);\n  if (haveB || !haveA) priority.push(B0);",
     ['unittests/pcbnew/zint_encode.test.ts']),

    ('code39: no stop character',
     'pcbnew/src/barcode/code.ts',
     "  dest += C39_TABLE[43]!.slice(0, 9);",
     "  dest += '';",
     ['unittests/pcbnew/zint_encode.test.ts']),

    ('qr mask: ties go to the higher pattern',
     'pcbnew/src/barcode/qr.ts',
     "    if (penalty[pattern]! < penalty[bestPattern]!) bestPattern = pattern;",
     "    if (penalty[pattern]! <= penalty[bestPattern]!) bestPattern = pattern;",
     ['unittests/pcbnew/zint_encode.test.ts']),

    ('qr ecc: Reed-Solomon index 1 rather than 0',
     'pcbnew/src/barcode/qr.ts',
     "  const rs = new ReedSolomon(GF_QR, eccBlockLength, 0);",
     "  const rs = new ReedSolomon(GF_QR, eccBlockLength, 1);",
     ['unittests/pcbnew/zint_encode.test.ts', 'unittests/pcbnew/reedsol.test.ts']),

    ('qr: skip the shrink pass',
     'pcbnew/src/barcode/qr.ts',
     "  let canShrink = true;",
     "  let canShrink = false;",
     ['unittests/pcbnew/zint_encode.test.ts']),

    ('microqr: score the LOWEST mask',
     'pcbnew/src/barcode/microqr.ts',
     "    if (value[pattern]! > value[bestPattern]!) bestPattern = pattern;",
     "    if (value[pattern]! < value[bestPattern]!) bestPattern = pattern;",
     ['unittests/pcbnew/zint_encode.test.ts']),

    ('microqr: every version ends on a byte',
     'pcbnew/src/barcode/microqr.ts',
     "  const bitsEnd = version === 0 || version === 2 ? 4 : 8;",
     "  const bitsEnd = 8;",
     ['unittests/pcbnew/zint_encode.test.ts']),

    ('datamatrix: EDIFACT tail always unlatches',
     'pcbnew/src/barcode/dmatrix.ts',
     "    if (symbolsLeft <= 2 && buffer.length <= symbolsLeft) {",
     "    if (false) {",
     ['unittests/pcbnew/zint_encode.test.ts']),

    ('datamatrix: no 255-state randomiser on Base 256',
     'pcbnew/src/barcode/dmatrix.ts',
     "    target[i] = (target[i]! + prn) & 0xff;",
     "    target[i] = target[i]!;",
     ['unittests/pcbnew/zint_encode.test.ts']),

    ('datamatrix: square sizes only',
     'pcbnew/src/barcode/dmatrix.ts',
     "  while (DM_IS_DMRE[i]) i++; // \"Skip DMRE symbols in no dmre mode\"",
     "  while (DM_IS_DMRE[i] || DM_MATRIX_H[i] !== DM_MATRIX_W[i]) i++;",
     ['unittests/pcbnew/zint_encode.test.ts']),

    ('reader: (hide yes) means show',
     'pcbnew/src/read-board.ts',
     "    showText: hide ? arg(hide, 0) === 'no' : true,",
     "    showText: hide ? arg(hide, 0) === 'yes' : true,",
     ['unittests/pcbnew/pcb_barcode_io.test.ts']),

    ('writer: omit a zero angle',
     'pcbnew/src/write-footprint.ts',
     "    list(atom('at'), atom(mm(b.at.x)), atom(mm(b.at.y)), atom(formatG(b.angle, 10))),",
     "    list(atom('at'), atom(mm(b.at.x)), atom(mm(b.at.y))),",
     ['unittests/pcbnew/pcb_barcode_io.test.ts']),

    ('writer: ecc_level for every kind',
     'pcbnew/src/write-footprint.ts',
     "  if (b.kind === 'qr' || b.kind === 'microqr')\n    items.push(list(atom('ecc_level'), atom(b.ecc)));",
     "  items.push(list(atom('ecc_level'), atom(b.ecc)));",
     ['unittests/pcbnew/pcb_barcode_io.test.ts']),

    ('dialog: H stays available for Micro QR',
     'pcbnew/src/barcode_properties.ts',
     "  eccHEnabled: v.kind !== 'microqr',",
     "  eccHEnabled: true,",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('dialog: do not move the choice off H',
     'pcbnew/src/barcode_properties.ts',
     "  if (v.kind === 'microqr' && v.ecc === 'H') return { ...v, ecc: 'Q' };",
     "  if (false) return { ...v, ecc: 'Q' };",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('dialog: commit an unencodable barcode',
     'pcbnew/src/barcode_properties.ts',
     "  return g.symbolPoly.length === 0 ? g.error || 'Barcode Error' : '';",
     "  return '';",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('hit test: the modules, not the hull',
     'pcbnew/src/edit-board.ts',
     "    const g = barcodeGeometry(bc);\n    for (const hull of barcodeHullBoxes(g, bc)) {",
     "    const g = barcodeGeometry(bc);\n    for (const hull of []) {",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('rotate: the position turns but the item does not',
     'pcbnew/src/edit-board.ts',
     "  const angle = norm360(b.angle + deg);\n  return { ...b, at, angle, source: patchBarcodeAt(b, at, angle) };",
     "  const angle = b.angle;\n  return { ...b, at, angle, source: patchBarcodeAt(b, at, angle) };",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('lock: never written to the file',
     'pcbnew/src/edit-board.ts',
     "  source: locked\n    ? patchChild(b.source, 'locked', list(atom('locked'), atom('yes')))\n    : dropChild(b.source, 'locked'),",
     "  source: b.source,",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('IsEmpty: a board of barcodes is empty',
     'pcbnew/src/pcb_selection_conditions.ts',
     "    board.points.length === 0 &&\n    board.barcodes.length === 0",
     "    board.points.length === 0",
     ['unittests/pcbnew/pcb_selection_conditions.test.ts']),

    ('painter: barcodes go through the graphic fill',
     'designer/src/editors/pcb/renderBoard.ts',
     "    if (!b || !b.hasBarcodes) return;",
     "    if (!b || !b.hasBarcodes || !opts.graphicFill) return;",
     ['unittests/designer/pcb_barcode_render.test.ts']),

    ('painter: even-odd fill',
     'designer/src/editors/pcb/renderBoard.ts',
     "    ctx.fill(b.barcodes, 'nonzero');",
     "    ctx.fill(b.barcodes, 'evenodd');",
     ['unittests/designer/pcb_barcode_render.test.ts']),

    ('painter: a footprint’s barcodes are not drawn',
     'designer/src/editors/pcb/renderBoard.ts',
     "    for (const bc of fp.barcodes) {\n      addBarcode(scene, bc);",
     "    for (const bc of []) {\n      addBarcode(scene, bc);",
     ['unittests/designer/pcb_barcode_render.test.ts']),

    ('properties: margins always shown',
     'pcbnew/src/properties_panel.ts',
     "  if (b.knockout) {\n    // `SetMarginX` clamps",
     "  if (true) {\n    // `SetMarginX` clamps",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('properties: H offered to Micro QR',
     'pcbnew/src/properties_panel.ts',
     "        b.kind === 'qr' ? BARCODE_ECC_CHOICES_ALL : BARCODE_ECC_CHOICES_ALL.slice(0, 3),",
     "        BARCODE_ECC_CHOICES_ALL,",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('msg panel: GetShownText, not GetText',
     'pcbnew/src/msg_panel.ts',
     "  rows.push({ upper: 'Text', lower: b.text });",
     "  rows.push({ upper: 'Text', lower: b.text.replace(/\\$\\{[^}]*\\}/g, '') });",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('cursors: the barcode tool takes the plain arrow',
     'designer/src/ui/tool_cursors.ts',
     "  placeBarcode: 'PENCIL',",
     "",
     ['unittests/designer/tool_cursors.test.ts']),

    ('plot: a barcode never reaches the film',
     'pcbnew/src/plot_gerber.ts',
     "  for (const bc of board.barcodes) barcodePlot(bc);",
     "",
     ['unittests/pcbnew/plot_gerber.test.ts']),

    ('plot: a footprint’s barcode is skipped',
     'pcbnew/src/plot_gerber.ts',
     "  for (const fp of board.footprints) for (const bc of fp.barcodes) barcodePlot(bc);",
     "",
     ['unittests/pcbnew/plot_gerber.test.ts']),

    ('plot: ignore the layer mask',
     'pcbnew/src/plot_gerber.ts',
     "    if (bc.layer !== layer) return;",
     "",
     ['unittests/pcbnew/plot_gerber.test.ts']),

    ('drc: a barcode on Edge.Cuts is fine',
     'pcbnew/src/drc/drc_engine.ts',
     "  for (const bc of [...board.barcodes, ...board.footprints.flatMap((fp) => fp.barcodes)]) {\n    if (bc.layer === 'Edge.Cuts') {",
     "  for (const bc of []) {\n    if (bc.layer === 'Edge.Cuts') {",
     ['unittests/pcbnew/drc_misc.test.ts']),

    ('snap: a barcode offers no anchors',
     'pcbnew/src/pcb_cursor_snap.ts',
     "  if (aOpts.otherItems !== false) {",
     "  if (false) {",
     ['unittests/pcbnew/pcb_barcode.test.ts']),

    ('cursors: GerbView measure is not the shared one',
     'designer/src/ui/tool_cursors.ts',
     "  measure: 'MEASURE',",
     "",
     ['unittests/designer/draw_ruler_item.test.ts']),
]

def run(cmd, cwd=ROOT):
    return subprocess.run(cmd, shell=True, cwd=cwd, capture_output=True, text=True)


ANSI = re.compile(r'\x1b\[[0-9;]*m')


def vitest(tests):
    """Run the given test files and return (failed, passed) or None.

    None means the run produced no summary at all — vitest crashed, the flags
    were wrong, the box was out of memory. That is NOT zero failures, and
    scoring it as a survivor is the false negative this harness exists to
    avoid: `mutation-harness-false-negatives` in my notes is exactly this bug,
    hit once already on the ANSI codes.
    """
    r = run('npx vitest run ' + ' '.join(tests), cwd=ROOT + '/qa')
    out = ANSI.sub('', r.stdout + r.stderr)
    m = re.search(r'Tests\s+(\d+) failed \| (\d+) passed', out)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r'Tests\s+(\d+) passed', out)
    if m:
        return 0, int(m.group(1))
    return None


def restore(path, src):
    """Put the file back. Called on every exit path, including a crash: a
    sweep killed mid-mutant leaves one live in the tree, and a live mutant
    passes its own tests, which is indistinguishable from a kill."""
    open(path, 'w').write(src)

killed, survived, broken, unapplied, inconclusive = [], [], [], [], []

only = sys.argv[1:] if len(sys.argv) > 1 else None

for i, (name, path, find, repl, tests) in enumerate(MUTANTS):
    if only and str(i) not in only:
        continue
    src = open(path).read()
    if find not in src:
        unapplied.append((name, 'anchor not found'))
        print(f'[{i:2d}] UNAPPLIED (anchor) {name}', flush=True)
        continue
    open(path, 'w').write(src.replace(find, repl, 1))
    # assert it actually changed
    if open(path).read() == src:
        unapplied.append((name, 'no change'))
        print(f'[{i:2d}] UNAPPLIED (no change) {name}', flush=True)
        restore(path, src)
        continue

    tc = run('pnpm -C pcbnew typecheck 2>&1 | grep -c "error TS"')
    tc2 = run('pnpm -C designer typecheck 2>&1 | grep -c "error TS"')
    if tc.stdout.strip() != '0' or tc2.stdout.strip() != '0':
        broken.append(name)
        print(f'[{i:2d}] BUILD-FAIL {name}', flush=True)
        restore(path, src)
        continue

    result = vitest(tests)

    # A survivor is re-run before it is believed. The first sweep reported
    # three, and two of them killed cleanly on a second run — so a single
    # quiet result is evidence of nothing.
    if result is not None and result[0] == 0:
        result = vitest(tests)

    restore(path, src)

    if result is None:
        inconclusive.append(name)
        print(f'[{i:2d}] INCONCLUSIVE (no summary) {name}', flush=True)
    elif result[0]:
        killed.append(name)
        print(f'[{i:2d}] killed ({result[0]}) {name}', flush=True)
    else:
        survived.append(name)
        print(f'[{i:2d}] SURVIVED  {name} [{result[1]} passed]', flush=True)

print()
print(f'killed {len(killed)}  survived {len(survived)}  build-fail {len(broken)} '
      f' unapplied {len(unapplied)}  inconclusive {len(inconclusive)}')
for n in survived: print('  SURVIVED:', n)
for n in broken: print('  BUILD-FAIL:', n)
for n, why in unapplied: print('  UNAPPLIED:', n, '-', why)
for n in inconclusive: print('  INCONCLUSIVE:', n)
