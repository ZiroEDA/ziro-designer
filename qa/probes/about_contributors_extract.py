#!/usr/bin/env python3
"""Transcribe the contributor block of KiCad's AboutDialog_main.cpp into TS.

The credits are DATA KiCad hardcodes (CLAUDE.md: mirror that table, never
invent it). This turns lines 197..1131 of the 10.0.5 file - the #define
categories, the ADD_* macros and the aInfo.AddX( new CONTRIBUTOR(...) ) calls -
into the same statements in TypeScript, comments kept, so the result can be
diffed against the C++ line by line. Usage:

  python3 qa/probes/about_contributors_extract.py \
      /home/akshay/kicad-reference/common/dialog_about/AboutDialog_main.cpp
"""
import json, re, sys

src = open(sys.argv[1], encoding='utf-8').read().split('\n')
start = next(i for i, l in enumerate(src) if 'The core developers' in l)
show = next(i for i, l in enumerate(src) if l.startswith('void ShowAboutDialog'))
end = max(i for i in range(show) if src[i] == '}')
body = src[start:end + 1]
assert body[-1].strip() == '}', body[-1]
body = body[:-1]

# Join a statement that the C++ wraps over several lines.
lines, buf = [], ''
for l in body:
    s = l.strip()
    if buf:
        buf += ' ' + s
        if buf.endswith(';'):
            lines.append(buf); buf = ''
        continue
    if s.startswith('aInfo.') and not s.endswith(';'):
        buf = s; continue
    lines.append(s)
assert not buf

def lit(m):  # wxT( "x" ) / wxS( "x" ) / _( "x" ) -> 'x'
    return json.dumps(m.group(1), ensure_ascii=False).replace("'", "\\'").replace('"', "'", 1)[:-1] + "'"

STR = re.compile(r'(?:wxT|wxS|_)\(\s*"((?:[^"\\]|\\.)*)"\s*\)')
out, n = [], 0
in_block = False
for s in lines:
    if in_block:
        out.append(' ' + s if s.startswith('*') else s)
        if s.endswith('*/'): in_block = False
        continue
    if s.startswith('/*'):
        out.append(s)
        in_block = not s.endswith('*/')
        continue
    if s == '' or s.startswith('//'):
        out.append(s); continue
    m = re.match(r'#define (\w+) _\( "([^"]*)" ?\)$', s)
    if m:
        out.append(f"const {m.group(1)} = {json.dumps(m.group(2))};"); continue
    m = re.match(r'#define (ADD_\w+)\( name(, category)? \) aInfo\.(Add\w+)\( new CONTRIBUTOR\( name, (\w+) \) \)$', s)
    if m:
        name, cat, meth, catarg = m.groups()
        params = 'name: string, category: string' if cat else 'name: string'
        out.append(f"const {name} = ({params}): void => aInfo.{meth}(new CONTRIBUTOR(name, {catarg}));")
        continue
    t = STR.sub(lit, s)
    t = re.sub(r'aInfo\.(Add\w+)\( new CONTRIBUTOR\( (.*) \) \);$', r'aInfo.\1(new CONTRIBUTOR(\2));', t)
    t = re.sub(r'(ADD_\w+)\( (.*) \);$', r'\1(\2);', t)
    t = re.sub(r"\s+", ' ', t)
    if not re.match(r"^(ADD_\w+|aInfo\.Add\w+)\(.*\);$", t) or '"' in t or 'wx' in t:
        sys.exit(f'unhandled: {s!r} -> {t!r}')
    n += 1
    out.append(t)

print('\n'.join(out))
print(f'// {n} contributors', file=sys.stderr)
