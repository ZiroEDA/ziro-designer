"""Ask the Zint probe for the module grid of each case, and emit a TS fixture."""
import subprocess, json, sys

PROBE = 'qa/probes/zint_probe/zint_probe'

CASES = [
  # (kind, ecc, text)
  ('code39', 'L', 'ZIRO'),
  ('code39', 'L', '0'),
  ('code39', 'L', 'ABC-123'),
  ('code39', 'L', 'A B.C$D/E+F%G'),
  ('code39', 'L', 'abc'),
  ('code39', 'L', '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
  ('code128', 'L', 'ZIRO'),
  ('code128', 'L', '0'),
  ('code128', 'L', '1234567890'),
  ('code128', 'L', 'ABC-123'),
  ('code128', 'L', 'a'),
  ('code128', 'L', 'Hello, World!'),
  ('code128', 'L', '12345678901234567890'),
  ('code128', 'L', 'AB12CD34'),
  ('code128', 'L', '\x01\x02control'),
  ('code128', 'L', 'MiXeD123case456'),
  ('code128', 'L', 'ZIROé'),
  ('code128', 'L', 'éèê'),
  ('code128', 'L', '99'),
  ('code128', 'L', 'X999999999999Y'),
]

out = []
for kind, ecc, text in CASES:
    ecc_n = {'L':1,'M':2,'Q':3,'H':4}[ecc]
    r = subprocess.run([PROBE, kind, str(ecc_n), text], capture_output=True, text=True)
    lines = r.stdout.strip().split('\n')
    if lines[0].startswith('ERROR'):
        out.append({'kind':kind,'ecc':ecc,'text':text,'error':lines[0][6:]})
        continue
    rows, width = map(int, lines[0].split())
    grid = lines[1:1+rows]
    out.append({'kind':kind,'ecc':ecc,'text':text,'rows':rows,'width':width,'grid':grid})
print(json.dumps(out, indent=2, ensure_ascii=False))
