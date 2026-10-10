#!/usr/bin/env python3
"""eeschema vs KiCad file parity, by the decisions eeschema/STRUCTURE.md records.

Prints the "Parity" section of eeschema/STRUCTURE.md: KiCad .cpp/.h pairs counted once, our
_ui.tsx the same file as its .ts, a KiCad *_base covered when its dialog exists; the n/a,
deferred and sim columns are the decisions listed in that section.

    python3 qa/probes/eeschema_parity.py [kicad-reference-root] > section.md
"""
import collections
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
K = os.path.join(sys.argv[1] if len(sys.argv) > 1 else '/home/akshay/kicad-reference', 'eeschema')
O = os.path.normpath(os.path.join(HERE, '..', '..', 'eeschema'))


def stems(root, exts, ours=False):
    out = set()
    for d, _, fs in os.walk(root):
        if 'node_modules' in d:
            continue
        for f in fs:
            if f.endswith(exts) and not f.endswith('.d.ts'):
                s = os.path.splitext(os.path.relpath(os.path.join(d, f), root))[0]
                if ours and s.endswith('_ui'):
                    s = s[:-3]
                out.add(s)
    return out


# Decisions (eeschema/STRUCTURE.md, "Parity").
def is_na(s):
    return s.startswith(('api/', 'navlib/')) or s in {
        'widgets/filedlg_hook_save_project',
        'widgets/symbol_library_save_as_filedlg_hook',
        'symbol_chooser_timing',
    }


IMPORTERS = tuple(f'sch_io/{d}/' for d in (
    'altium', 'cadstar', 'database', 'eagle', 'easyeda', 'easyedapro', 'geda', 'http_lib',
    'ltspice', 'pads'))


def is_deferred(s):
    return s.startswith(IMPORTERS) or s in {'eeschema_jobs_handler', 'dialogs/dialog_erc_job_config'}


def is_sim(s):
    return s.startswith('sim/') or re.search(
        r'(dialog_sim_|simulator|user_defined_signals|ibis_parser|tuner_slider)', s) is not None


# Our own files STRUCTURE.md keeps under our name, with a reason there.
KEPT = {
    'connectivity/bus', 'connectivity/dangling', 'connectivity/hierarchy', 'connectivity/index',
    'connectivity/nets', 'connectivity/segment_index', 'exporters/bom',
    'browser/project_sync_transport', 'browser/repair_source', 'browser/sch_diff',
    'browser/global_sym_lib_table', 'browser/sch_canvas',
    'sch_io/sexpr/read-schematic', 'sch_io/sexpr/write-schematic', 'sch_io/sexpr/write-symbol-lib',
}


# Old-model files that do not import types.ts: plain-data copies of a live class.
#   project_settings - the Schematic Setup's .kicad_pro reader/writer; SCHEMATIC_SETTINGS,
#                      ERC_SETTINGS and NET_SETTINGS (all ported) are KiCad's.
#   toggles          - the window's left-toolbar state; KiCad reads frame settings through
#                      EDITOR_CONDITIONS.
OLD_MODEL = {'project_settings', 'toggles'}


def is_record(stem):
    """An extra file of the old record model: it imports the record types (types.ts)."""
    if stem in OLD_MODEL:
        return True
    for e in ('.ts', '.tsx', '_ui.tsx'):
        p = os.path.join(O, stem + e)
        if os.path.exists(p):
            t = open(p, errors='ignore').read()
            if re.search(r"from '(\.\.?/)+types\.js'|@ziroeda/eeschema/types", t) or \
                    os.path.basename(stem) == 'types':
                return True
    return False


# A header is counted on its own only when there is no .cpp beside it and it holds code
# (a class, an enum, constants, a generated literal). Pure declarations of functions defined in
# some other .cpp, and empty headers, are not files to port. wxFormBuilder `_base` files (an
# .fbp beside them) fold into the dialog's own file, so they are not counted either.
DECLARATION_ONLY = {'invoke_sch_dialog', 'save_project_utils'}


def has_code(path):
    text = open(path, errors='ignore').read()
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    lines = [l for l in text.split('\n')
             if l.strip() and not l.strip().startswith(('//', '#include', '#pragma', '#ifndef', '#endif'))
             and not re.match(r'\s*#define\s+\w+_H_?\s*$', l)]
    return bool(lines)


def is_form(s):
    """wxFormBuilder output: `x_base` generated from `x.fbp` (or `x_base.fbp`)."""
    return s.endswith('_base') and (os.path.exists(os.path.join(K, s[:-5] + '.fbp'))
                                    or os.path.exists(os.path.join(K, s + '.fbp')))


def kicad_stems():
    all_cpp = stems(K, ('.cpp',))
    cpp = {s for s in all_cpp if not is_form(s)}
    # A form used directly, with no derived dialog (DIALOG_INCREMENT_ANNOTATIONS_BASE): the
    # form is the dialog, so it counts under the dialog's name.
    cpp |= {s[:-5] for s in all_cpp if is_form(s) and s[:-5] not in all_cpp}
    hdr = set()
    for s in stems(K, ('.h',)):
        if s in cpp or is_form(s) or s in DECLARATION_ONLY:
            continue
        if has_code(os.path.join(K, s + '.h')):
            hdr.add(s)
    return cpp | hdr


def main():
    k = kicad_stems()
    o = stems(O, ('.ts', '.tsx'), True)
    covered = set()
    na = {s for s in k if is_na(s)}
    de = {s for s in k if is_deferred(s)} - na
    si = {s for s in k if is_sim(s)} - na - de
    target = k - na - de - si
    left = sorted(s for s in target if s not in o and s not in covered)
    ex = sorted(o - k)
    kept = [s for s in ex if s in KEPT]
    rec = [s for s in ex if s not in KEPT and is_record(s)]
    oth = [s for s in ex if s not in KEPT and s not in rec]

    def folder(s):
        return os.path.dirname(s) or '(root)'

    folders = sorted(set(map(folder, k)) | set(map(folder, o)), key=lambda f: (f != '(root)', f))
    print('| folder | KiCad | n/a | deferred | sim | to match | done | left | done % | extra kept | extra record model | extra unexplained |')
    print('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    for f in folders:
        kf = {s for s in k if folder(s) == f}
        if not (kf & target) and not [s for s in ex if folder(s) == f]:
            continue  # n/a, deferred or sim only: not shown
        tf = kf & target
        lf = [s for s in left if folder(s) == f]
        exf = [s for s in ex if folder(s) == f]
        pct = f'{100 * (len(tf) - len(lf)) // len(tf)}%' if tf else '-'
        print(f'| {f} | {len(kf)} | {len(kf & na)} | {len(kf & de)} | {len(kf & si)} | {len(tf)} | '
              f'{len(tf) - len(lf)} | **{len(lf)}** | {pct} | {len([s for s in exf if s in kept])} | '
              f'{len([s for s in exf if s in rec])} | {len([s for s in exf if s in oth])} |')
    done = len(target) - len(left)
    print(f'| **total** | **{len(k)}** | **{len(na)}** | **{len(de)}** | **{len(si)}** | **{len(target)}** | '
          f'**{done}** | **{len(left)}** | **{100 * done // len(target)}%** | **{len(kept)}** | '
          f'**{len(rec)}** | **{len(oth)}** |')
    print()
    print('### Left to port\n')
    by = collections.defaultdict(list)
    for s in left:
        by[folder(s)].append(os.path.basename(s))
    for f in sorted(by, key=lambda f: (f != '(root)', f)):
        print(f'- `{f}` ({len(by[f])}): ' + ', '.join(f'`{x}`' for x in by[f]))
    print('\n### Extra: old record model (deleted as each consumer moves to the live model)\n')
    print(', '.join(f'`{s}`' for s in rec) + '\n')
    print('### Extra: no recorded reason yet (fold, rename or justify)\n')
    print(', '.join(f'`{s}`' for s in oth))


if __name__ == '__main__':
    main()
