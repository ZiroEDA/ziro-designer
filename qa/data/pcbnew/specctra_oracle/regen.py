#!/usr/bin/env python3
"""Regenerate the DSN oracle: KiCad's own pcbnew.ExportSpecctraDSN over each board.
Run from this directory: python3 regen.py  (uses the installed KiCad's python module)."""
import os, sys, pcbnew
BOARDS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'resave')
OUT = os.path.dirname(os.path.abspath(__file__))
for name in [a for a in sys.argv[1:] if a != 'session'] or ([] if 'session' in sys.argv[1:] else ['ecc83-pp', 'interf_u']):
    b = pcbnew.LoadBoard(os.path.join(BOARDS, name + '.kicad_pcb'))
    pcbnew.ExportSpecctraDSN(b, os.path.join(OUT, name + '.dsn'))
    print(name, 'ok')

# ---- the session oracle: KiCad's own ImportSpecctraSES over a hand-written .ses ----
import json
def dump(b):
    out = {'tracks': [], 'footprints': []}
    for t in b.GetTracks():
        d = {'type': t.GetClass(), 'layer': b.GetLayerName(t.GetLayer()), 'width': t.GetWidth(),
             'net': t.GetNetname(), 'locked': t.IsLocked()}
        if t.GetClass() == 'PCB_VIA':
            d.update(pos=[t.GetPosition().x, t.GetPosition().y], drill=t.GetDrillValue(),
                     viatype=int(t.GetViaType()), top=b.GetLayerName(t.TopLayer()), bottom=b.GetLayerName(t.BottomLayer()))
        else:
            d.update(start=[t.GetStart().x, t.GetStart().y], end=[t.GetEnd().x, t.GetEnd().y])
            if t.GetClass() == 'PCB_ARC':
                d.update(mid=[t.GetMid().x, t.GetMid().y])
        out['tracks'].append(d)
    for f in b.GetFootprints():
        out['footprints'].append({'ref': f.GetReference(), 'pos': [f.GetPosition().x, f.GetPosition().y],
                                  'deg': f.GetOrientationDegrees(), 'layer': b.GetLayerName(f.GetLayer())})
    return out

def session(name, ses):
    b = pcbnew.LoadBoard(os.path.join(BOARDS, name + '.kicad_pcb'))
    ok = pcbnew.ImportSpecctraSES(b, os.path.join(OUT, ses))
    d = dump(b); d['ok'] = bool(ok)
    with open(os.path.join(OUT, ses + '.expected.json'), 'w') as f:
        json.dump(d, f, indent=1, sort_keys=True)
    print(ses, 'ok', ok)

if 'session' in sys.argv[1:]:
    session('ecc83-pp', 'ecc83-pp.ses')
