#!/usr/bin/env python3
"""Move source files between packages and rewrite every reference to them.

    python3 qa/probes/move_to_common.py OLD=NEW [OLD=NEW ...]

Paths are repo-relative. Written for the file-structure stages
(common/STRUCTURE.md), with a check for each trap in the memory note
"mass-move import rewrite traps":

 1. a relative import INSIDE a moved file is resolved against its OLD
    directory, then re-expressed from the new one;
 2. an import that lands in the file's own package is relative, never
    `@ziroeda/<own>/...`; one that crosses packages is `@ziroeda/<pkg>/...`;
 3. a `.css` import keeps `.css`; a TS import is spelled `.js`;
 4. a file PATH in a string (qa tests reading source from disk) is rewritten
    as a path with the real extension, never as a specifier;
 5. (source-text assertions are ordinary strings and caught by 4 / the
    specifier pass; review the diff for regexes spelling the path escaped);
 6. nothing here blanks comments, so no glob can hide a line.

It refuses to write a `common/` file that would import from `designer/`
(a package cycle), and prints every file it touched.
"""
import os
import re
import subprocess
import sys

ROOT = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
os.chdir(ROOT)

# package directory -> package name, from each package.json
PKGS = {}
for pj in subprocess.check_output(['git', 'ls-files', '*package.json'], text=True).split():
    d = os.path.dirname(pj)
    if not d or 'node_modules' in d:
        continue
    m = re.search(r'"name"\s*:\s*"([^"]+)"', open(pj).read())
    if m:
        PKGS[d] = m.group(1)


def pkg_of(path):
    best = ''
    for d in PKGS:
        if (path == d or path.startswith(d + '/')) and len(d) > len(best):
            best = d
    return best


TS_EXT = ('.ts', '.tsx')


def strip_ext(p):
    for e in ('.tsx', '.ts', '.js', '.jsx'):
        if p.endswith(e):
            return p[: -len(e)]
    return p


def resolve_spec(importer, spec):
    """Repo-relative source path an import specifier points at, or None."""
    if spec.startswith('.'):
        base = os.path.normpath(os.path.join(os.path.dirname(importer), spec))
    elif spec.startswith('@ziroeda/'):
        name, _, rest = spec[len('@ziroeda/'):].partition('/')
        d = next((k for k, v in PKGS.items() if v == '@ziroeda/' + name), None)
        if d is None:
            return None
        # The bare package (`@ziroeda/common`) is its index; a file that
        # lands inside that package must not import itself by name (trap 2).
        base = os.path.join(d, rest or 'index.ts')
    else:
        return None
    if base.endswith('.css') or base.endswith('.svg') or base.endswith('.png'):
        return base if os.path.exists(base) else None
    stem = strip_ext(base)
    for e in TS_EXT:
        if os.path.exists(stem + e):
            return stem + e
    return None


def spec_for(importer, target):
    """How `importer` should spell an import of repo-relative `target`."""
    tgt = target if target.endswith('.css') else strip_ext(target) + '.js'
    if pkg_of(importer) == pkg_of(target):
        rel = os.path.relpath(tgt, os.path.dirname(importer))
        return rel if rel.startswith('.') else './' + rel
    d = pkg_of(target)
    return PKGS[d] + '/' + os.path.relpath(tgt, d)


SPEC_RE = re.compile(
    r"""((?:from|import)\s*\(?\s*|vi\.mock\(\s*|import\(\s*)(['"])([^'"\n]+)\2"""
)


def main(pairs):
    moves = {}
    for p in pairs:
        old, new = p.split('=')
        assert os.path.exists(old), old
        assert not os.path.exists(new), new
        moves[old] = new

    files = [f for f in subprocess.check_output(['git', 'ls-files'], text=True).split()
             if f.endswith(('.ts', '.tsx', '.mts', '.mjs', '.js', '.css', '.md', '.py', '.json'))
             and os.path.exists(f)]

    # Pass 1: plan every rewrite against the tree as it is NOW (trap 1).
    plans = {}
    for f in files:
        if not f.endswith(('.ts', '.tsx', '.mts', '.mjs', '.js')):
            continue
        new_self = moves.get(f, f)
        src = open(f, encoding='utf-8').read()

        def fix(m, f=f, new_self=new_self):
            spec = m.group(3)
            tgt = resolve_spec(f, spec)
            if tgt is None:
                return m.group(0)
            tgt_new = moves.get(tgt, tgt)
            if tgt_new == tgt and new_self == f:
                return m.group(0)
            want = spec_for(new_self, tgt_new)
            if want == spec:
                return m.group(0)
            return m.group(1) + m.group(2) + want + m.group(2)

        out = SPEC_RE.sub(fix, src)
        if out != src:
            plans[f] = out

    # Pass 2: disk paths in strings (trap 4), e.g. '../../../designer/src/x.tsx'
    # or 'designer/src/x.tsx'. Rewritten as paths with the real extension.
    for f in files:
        src = plans.get(f, open(f, encoding='utf-8').read())
        out = src
        for old, new in moves.items():
            for o_ext in {old, strip_ext(old) + '.js'} if old.endswith(TS_EXT) else {old}:
                # repo-relative spelling, possibly behind ../ segments
                out = re.sub(r'((?:\.\./)*)' + re.escape(o_ext) + r'(?=[\'"`\s)]|$)',
                             lambda m, new=new: m.group(1) + new, out)
            # SRC-rooted spellings in qa: a test that reads `src('dialogs/x.tsx')`
            # relative to designer/src. The new home is spelled from there too.
            if f.startswith('qa/') and old.startswith('designer/src/'):
                tail = old[len('designer/src/'):]
                new_rel = os.path.relpath(new, 'designer/src')
                out = re.sub(r"(['\"`])" + re.escape(tail) + r"\1",
                             lambda m, n=new_rel: m.group(1) + n + m.group(1), out)
        if out != src:
            plans[f] = out

    # Refuse a common -> designer import (the package cycle).
    for f, out in plans.items():
        dest = moves.get(f, f)
        if pkg_of(dest) == 'common' and '@ziroeda/designer' in out:
            sys.exit(f'CYCLE: {dest} would import @ziroeda/designer')

    for f, out in plans.items():
        open(f, 'w', encoding='utf-8').write(out)
    for old, new in moves.items():
        os.makedirs(os.path.dirname(new), exist_ok=True)
        subprocess.check_call(['git', 'mv', old, new])
    for f in sorted(plans):
        print('rewrote', moves.get(f, f))
    for old, new in moves.items():
        print('moved  ', old, '->', new)


if __name__ == '__main__':
    main(sys.argv[1:])
