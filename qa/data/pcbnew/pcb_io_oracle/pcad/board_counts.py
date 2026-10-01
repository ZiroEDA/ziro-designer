"""What KiCad's P-CAD plugin leaves on the BOARD that a saved file cannot show:
the saved file drops drawings BOARD::cmp_drawings calls equal, so the drawing
count per layer is read here from the board in memory."""
import json, sys, pcbnew
out = {}
for path in sys.argv[2:]:
    b = pcbnew.PCB_IO_MGR.Load(pcbnew.PCB_IO_MGR.PCAD, path)
    layers = {}
    for d in b.GetDrawings():
        n = b.GetLayerName(d.GetLayer())
        layers[n] = layers.get(n, 0) + 1
    out[path.split('/')[-1]] = {'drawings': dict(sorted(layers.items())), 'footprints': len(b.GetFootprints()), 'tracks': len(b.GetTracks()), 'zones': len(b.Zones())}
json.dump(out, open(sys.argv[1], 'w'), indent=1, sort_keys=True)
