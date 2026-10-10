#!/usr/bin/env python3
"""Build the LTspice import oracle's inputs from an LTspice install.

Each example becomes <out>/<name>/: the .asc, any .asy/.asc beside it in its source folder, and a
lib/ holding only the symbols (lib/sym) and sub-schematics (lib/sub) it places, resolved the way
LTSPICE_SCHEMATIC::Load keys them - by lower-cased relative path, then bare name. eeschema finds
LTspice's library through that lib/ folder (sch_io_ltspice.cpp's last fallback), so both readers
see exactly these files and nothing else.

usage: make_ltspice_fixtures.py <LTspice dir> <out dir> <example.asc relative to examples/>...
"""
import os
import shutil
import sys


def read_text(path):
    data = open(path, 'rb').read()
    if len(data) >= 2 and data[1] == 0:
        return data.decode('utf-16le', 'replace')
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError:
        return data.decode('cp1252', 'replace')


def index(root):
    """Every .asy/.asc under root, keyed like GetAscAndAsyFilePaths: dir1/dir2/name, dir2/name, name."""
    asy, asc = {}, {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        rel = os.path.relpath(dirpath, root)
        parts = [] if rel == '.' else rel.split(os.sep)
        for f in sorted(filenames):
            name, ext = os.path.splitext(f)
            table = {'.asy': asy, '.asc': asc}.get(ext.lower())
            if table is None:
                continue
            for i in range(len(parts) + 1):
                key = '/'.join(p.lower() for p in parts[i:] + [name])
                table.setdefault(key, os.path.join(dirpath, f))
    return asy, asc


def resolve(table, name):
    key = name.lower().replace('\\', '/')
    if key in table:
        return table[key]
    base = key.rsplit('/', 1)[-1]
    return table.get(base)


def symbols_of(asc_text):
    out = []
    for line in asc_text.split('\n'):
        tok = line.split(' ')
        if len(tok) >= 4 and tok[0].upper() == 'SYMBOL':
            out.append(tok[1])
    return out


def main():
    lt, out, examples = sys.argv[1], sys.argv[2], sys.argv[3:]
    lib = os.path.join(lt, 'lib')
    sym_asy, _ = index(os.path.join(lib, 'sym'))
    sub_asy, sub_asc = index(os.path.join(lib, 'sub'))

    for ex in examples:
        src = os.path.join(lt, 'examples', ex)
        src_dir = os.path.dirname(src)
        name = os.path.splitext(os.path.basename(src))[0]
        dst = os.path.join(out, name)
        shutil.rmtree(dst, ignore_errors=True)
        os.makedirs(dst)

        # The schematic's own folder is searched first and non-recursively: copy its .asy/.asc.
        local_asy, local_asc = {}, {}
        for f in sorted(os.listdir(src_dir)):
            p = os.path.join(src_dir, f)
            n, e = os.path.splitext(f)
            if os.path.isfile(p) and e.lower() in ('.asy', '.asc'):
                if e.lower() == '.asc' and p != src:
                    # Another example in the same folder is not part of this one, unless placed.
                    local_asc[n.lower()] = p
                    continue
                shutil.copy2(p, dst)
                if e.lower() == '.asy':
                    local_asy[n.lower()] = p

        queue = [read_text(src)]
        seen = set()
        while queue:
            for s in symbols_of(queue.pop()):
                key = s.lower().replace('\\', '/')
                if key in seen:
                    continue
                seen.add(key)

                base = key.rsplit('/', 1)[-1]
                if key in local_asy or base in local_asy:
                    pass
                else:
                    for table, sub in ((sub_asy, 'sub'), (sym_asy, 'sym')):
                        hit = resolve(table, s)
                        if hit:
                            rel = os.path.relpath(hit, os.path.join(lib, sub))
                            os.makedirs(os.path.dirname(os.path.join(dst, 'lib', sub, rel)), exist_ok=True)
                            shutil.copy2(hit, os.path.join(dst, 'lib', sub, rel))
                            break

                # A placed sub-schematic: copy its .asc and read what it places.
                hit = local_asc.get(key) or local_asc.get(base)
                if hit:
                    shutil.copy2(hit, dst)
                    queue.append(read_text(hit))
                    continue
                hit = resolve(sub_asc, s)
                if hit:
                    rel = os.path.relpath(hit, os.path.join(lib, 'sub'))
                    os.makedirs(os.path.dirname(os.path.join(dst, 'lib', 'sub', rel)), exist_ok=True)
                    shutil.copy2(hit, os.path.join(dst, 'lib', 'sub', rel))
                    queue.append(read_text(hit))

        os.makedirs(os.path.join(dst, 'lib', 'sym'), exist_ok=True)
        print(name)


if __name__ == '__main__':
    main()
