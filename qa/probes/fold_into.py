#!/usr/bin/env python3
"""Fold a split-out helper module back into the file KiCad keeps it in.

    python3 qa/probes/fold_into.py HELPER.ts TARGET.tsx

Several dialogs had their data split into a sibling `.ts` "because qa's
tsconfig cannot compile .tsx". qa has compiled JSX since August 2026, so the
reason is gone and the file layout goes back to KiCad's: one unit, one file.

What it does:
  - takes HELPER's import statements (resolved against HELPER's directory and
    re-expressed from TARGET's) and adds any TARGET lacks;
  - drops TARGET's imports OF helper (the names are now local) and any
    `export ... from './helper.js'` re-export in TARGET;
  - inserts HELPER's body (everything after its imports) after TARGET's last
    import, under a banner saying where it came from;
  - deletes HELPER and repoints every importer of it at TARGET.
"""
import os
import re
import subprocess
import sys

ROOT = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
os.chdir(ROOT)

IMPORT_RE = re.compile(r"^import\s[\s\S]*?from\s+'([^']+)';\n", re.M)
REEXPORT_RE = re.compile(r"^export\s+(?:type\s+)?\{[\s\S]*?\}\s+from\s+'([^']+)';\n", re.M)


def stem(p):
    return re.sub(r'\.(tsx?|js)$', '', p)


def resolves_to(importer, spec, target):
    if not spec.startswith('.'):
        return False
    base = os.path.normpath(os.path.join(os.path.dirname(importer), spec))
    return stem(base) == stem(target)


def respell(spec, from_file, to_file):
    if not spec.startswith('.'):
        return spec
    tgt = os.path.normpath(os.path.join(os.path.dirname(from_file), spec))
    rel = os.path.relpath(tgt, os.path.dirname(to_file))
    return rel if rel.startswith('.') else './' + rel


def main(helper, target):
    h = open(helper, encoding='utf-8').read()
    t = open(target, encoding='utf-8').read()

    # helper: header comment (license + doc) is dropped; imports collected.
    imports = [m.group(0).replace("'" + m.group(1) + "'", "'" + respell(m.group(1), helper, target) + "'")
               for m in IMPORT_RE.finditer(h)]
    # The body is the whole file minus its imports (wherever they sit - a
    # declaration can come before one) and minus the leading header comment.
    rest = IMPORT_RE.sub('', h)
    m = re.match(r'(\s*//[^\n]*\n)*\s*(/\*\*[\s\S]*?\*/\n)?', rest)
    body = rest[m.end() if m else 0:].strip('\n')
    # Re-exports of relative modules must be respelled from the target, too.
    body = REEXPORT_RE.sub(lambda r: r.group(0).replace("'" + r.group(1) + "'", "'" + respell(r.group(1), helper, target) + "'"), body + '\n').strip('\n')

    # target: drop imports of / re-exports from helper
    def drop(m):
        return '' if resolves_to(target, m.group(1), helper) else m.group(0)

    t = IMPORT_RE.sub(drop, t)
    t = REEXPORT_RE.sub(drop, t)

    existing = set(m.group(0) for m in IMPORT_RE.finditer(t))
    add = [i for i in imports if i not in existing and not resolves_to(target, re.search(r"'([^']+)';", i).group(1), target)]

    ms = list(IMPORT_RE.finditer(t))
    at = ms[-1].end() if ms else 0
    banner = (f"\n// ---------------------------------------------------------------------------\n"
              f"// Folded in from {os.path.basename(helper)} (09-26): upstream this is the same\n"
              f"// file, and the split existed only because qa could not compile .tsx.\n\n")
    t = t[:at] + ''.join(add) + banner + body + '\n\n' + t[at:].lstrip('\n')
    open(target, 'w', encoding='utf-8').write(t)

    subprocess.check_call(['git', 'rm', '-q', '-f', helper])

    # repoint importers
    h_js = stem(helper) + '.js'
    for f in subprocess.check_output(['git', 'ls-files', '*.ts', '*.tsx', '*.mts'], text=True).split():
        if not os.path.exists(f) or f == target:
            continue
        s = open(f, encoding='utf-8').read()

        def fix(m, f=f):
            spec = m.group(2)
            if spec.startswith('.') and resolves_to(f, spec, helper):
                new = os.path.relpath(stem(target) + '.js', os.path.dirname(f))
                return m.group(1) + (new if new.startswith('.') else './' + new) + m.group(3)
            if spec.startswith('@ziroeda/') and spec.endswith(h_js.split('/', 1)[-1]) and stem(spec).endswith(stem(helper).split('/', 1)[-1]):
                return m.group(1) + spec.replace(os.path.basename(h_js), os.path.basename(stem(target)) + '.js') + m.group(3)
            return m.group(0)

        out = re.sub(r"((?:from|import)\s*\(?\s*')([^']+)(')", fix, s)
        if out != s:
            open(f, 'w', encoding='utf-8').write(out)
            print('repointed', f)
    print('folded', helper, '->', target)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
