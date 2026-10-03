"""Build the `fillpaths` fixture with KiCad's own pcbnew module: one area per
path of ZONE_FILLER::Fill that the other boards here, and the demo boards,
never take. Refilled by `kicad-cli pcb drc --refill-zones --save-board` with
MaximumThreads=1, so every fill and `(zone_layer_connections ...)` in the
result is KiCad 10.0.6's own.

  R  a GND via inside a GND pour's OUTLINE on In1.Cu, boxed in by a ring of
     SIG track so tight that the fill inside is pruned away: the outline test
     before the pour flashes it; the re-check against the actual fill after
     the pour (zone_filler.cpp:1483-1591, issue 22010) takes it back.
  S  two GND pours on B.Cu, the higher-priority one with a 1 mm clearance
     round a SIG via in the overlap. The lower pour first loses the higher
     one's whole OUTLINE (subtractHigherPriorityZones), then the iterative
     refill, seeded by the same-net overlap (issue 23790), gives it back the
     ring between its own 0.2 mm clearance and the higher pour's 1 mm.
  U  an SIG2 pour whose net's only pad is outside it: every outline is an
     island, and a pour whose outlines are ALL islands is kept, not removed
     (a net with no pad at all has no islands to begin with).
  D  a SIG pour at priority 0 under a VCC pour at priority 2 on F.Cu. KiCad
     writes zones in ascending priority, so the lower one comes first in the
     list; it must still wait for the VCC fill it knocks out (the DAG).
"""
import pcbnew, os

OUT = os.path.expanduser('~/kicad-oracle/fillpaths/fillpaths.kicad_pcb')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
MM = pcbnew.FromMM

b = pcbnew.BOARD()
b.SetCopperLayerCount(4)
F, I1, I2, B = pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.B_Cu

nets = {}
for name in ('GND', 'VCC', 'SIG', 'SIG2'):
    n = pcbnew.NETINFO_ITEM(b, name)
    b.Add(n)
    n.thisown = 0
    nets[name] = n


def add(item):
    # BOARD::Add takes ownership; SWIG does not know that.
    b.Add(item)
    item.thisown = 0
    return item


def edge(x1, y1, x2, y2):
    s = pcbnew.PCB_SHAPE(b, pcbnew.SHAPE_T_SEGMENT)
    s.SetLayer(pcbnew.Edge_Cuts)
    s.SetStart(pcbnew.VECTOR2I(MM(x1), MM(y1)))
    s.SetEnd(pcbnew.VECTOR2I(MM(x2), MM(y2)))
    s.SetWidth(MM(0.1))
    add(s)


for (x1, y1, x2, y2) in [(0, 0, 80, 0), (80, 0, 80, 40), (80, 40, 0, 40), (0, 40, 0, 0)]:
    edge(x1, y1, x2, y2)


def zone(net, layers, x1, y1, x2, y2, priority, clearance=0.2, min_thickness=0.2):
    z = pcbnew.ZONE(b)
    ls = pcbnew.LSET()
    for l in layers:
        ls.addLayer(l)
    z.SetLayerSet(ls)
    z.SetNet(nets[net])
    z.SetAssignedPriority(priority)
    z.SetIsFilled(False)
    o = pcbnew.SHAPE_POLY_SET()
    o.NewOutline()
    for (x, y) in [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]:
        o.Append(MM(x), MM(y))
    z.SetOutline(o)  # takes the pointer
    o.thisown = 0
    z.SetLocalClearance(MM(clearance))
    z.SetMinThickness(MM(min_thickness))
    add(z)
    return z


def track(net, layer, x1, y1, x2, y2, width=0.25):
    t = pcbnew.PCB_TRACK(b)
    t.SetLayer(layer)
    t.SetStart(pcbnew.VECTOR2I(MM(x1), MM(y1)))
    t.SetEnd(pcbnew.VECTOR2I(MM(x2), MM(y2)))
    t.SetWidth(MM(width))
    t.SetNet(nets[net])
    add(t)


def via(net, x, y, remove_unconnected):
    v = pcbnew.PCB_VIA(b)
    v.SetPosition(pcbnew.VECTOR2I(MM(x), MM(y)))
    v.SetWidth(MM(0.8))
    v.SetDrill(MM(0.4))
    v.SetLayerPair(F, B)
    v.SetNet(nets[net])
    if remove_unconnected:
        v.SetRemoveUnconnected(True)
        v.SetKeepStartEnd(True)
    add(v)
    # A via with nothing on it gets re-netted by DRC; give it a stub.
    track(net, F, x, y, x + 1.0, y)


# R
zone('GND', [I1], 5, 5, 25, 35, 0, min_thickness=0.5)
via('GND', 15, 15, True)
h = 0.55
for (x1, y1, x2, y2) in [(-h, -h, h, -h), (h, -h, h, h), (h, h, -h, h), (-h, h, -h, -h)]:
    track('SIG', I1, 15 + x1, 15 + y1, 15 + x2, 15 + y2)
track('SIG', I1, 15 + h, 15, 24, 15)

# S
zone('GND', [B], 30, 5, 50, 20, 0)
zone('GND', [B], 40, 5, 60, 20, 3, clearance=1.0)
via('SIG', 45, 12, False)

# U
zone('SIG2', [F], 65, 25, 78, 38, 0)
fp = pcbnew.FOOTPRINT(b)
fp.SetPosition(pcbnew.VECTOR2I(MM(72), MM(8)))
fp.SetReference('J1')
pad = pcbnew.PAD(fp)
pad.SetAttribute(pcbnew.PAD_ATTRIB_PTH)
pad.SetShape(pcbnew.F_Cu, pcbnew.PAD_SHAPE_CIRCLE)
pad.SetSize(pcbnew.F_Cu, pcbnew.VECTOR2I(MM(1.6), MM(1.6)))
pad.SetDrillSize(pcbnew.VECTOR2I(MM(0.8), MM(0.8)))
pad.SetLayerSet(pad.PTHMask())
pad.SetPosition(pcbnew.VECTOR2I(MM(72), MM(8)))
pad.SetNumber('1')
pad.SetNet(nets['SIG2'])
pad.thisown = 0
fp.Add(pad)
add(fp)

# D
zone('SIG', [F], 30, 25, 45, 38, 0)
zone('VCC', [F], 38, 25, 55, 38, 2)

b.BuildListOfNets()
pcbnew.SaveBoard(OUT, b)
print('wrote', OUT)
