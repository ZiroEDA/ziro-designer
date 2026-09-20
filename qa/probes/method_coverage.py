#!/usr/bin/env python3
"""Which methods a KiCad header declares that our port does not have.

Size is not a parity signal: C++ splits a class across include/<x>.h and
<x>.cpp, one .ts carries both. Method coverage is the signal, so this asks the
header what the class promises and greps our file for each name.

  qa/probes/method_coverage.py pcbnew/board.ts pcbnew/board.h

Names only - it cannot see a body that is wrong. A file it reports as complete
is a file worth reading, not a file proved correct.
"""
import re, sys, pathlib, subprocess

K = pathlib.Path('/home/akshay/kicad-reference')
NOISE = {'std', 'wxASSERT', 'wxCHECK', 'if', 'for', 'while', 'return', 'sizeof'}

def main(ours: str, header: str) -> int:
    hp = K / header
    if not hp.exists():
        found = subprocess.run(['find', str(K), '-name', pathlib.Path(header).name],
                               capture_output=True, text=True).stdout.split()
        if not found:
            print(f"no such header: {header}", file=sys.stderr); return 2
        hp = pathlib.Path(found[0])
    h = re.sub(r'//[^\n]*', '', re.sub(r'/\*[\s\S]*?\*/', '', hp.read_text()))
    # A declared method: an identifier followed by '('. Types are CamelCase too,
    # so drop any name that is ALL_CAPS (a class or macro) or too short.
    decl = {d for d in re.findall(r'\b([A-Z][A-Za-z0-9_]*)\s*\(', h)
            if d not in NOISE and len(d) > 2 and d != d.upper()}
    ts = pathlib.Path(ours).read_text()
    miss = sorted(d for d in decl if not re.search(r'\b' + re.escape(d) + r'\s*[(<:]', ts))
    print(f"{hp.name}: {len(decl)} declared, {len(decl)-len(miss)} present in {ours}")
    if miss:
        print(f"absent ({len(miss)}):")
        for i in range(0, len(miss), 4):
            print("  " + ", ".join(miss[i:i+4]))
    return 0

if __name__ == '__main__':
    sys.exit(main(*sys.argv[1:3]) if len(sys.argv) == 3 else (print(__doc__) or 2))
