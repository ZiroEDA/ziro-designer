"""Build the conditional-flashing fixture with KiCad's own pcbnew module.

Four copper layers, and one area per branch of ZONE_FILLER::Fill's flashing
determination that the big oracle boards do not reach:

  A  a via well inside a same-net zone            -- the ordinary flashed case
  A' a via whose CENTRE is outside that zone but whose HOLE overlaps it
     (`Outline()->Contains( center, -1, holeRadius )`)
  B  a via under two SAME-priority zones of different nets, on its own net
     ("Prefer highest priority AND matching netcode": the OR arm)
  C  a PTH pad under a HIGHER-priority zone of a DIFFERENT net
     (`zone->GetNetCode() == pad->GetNetCode()` must refuse it)
  D  a via inside a same-net zone with UnconnectedLayerMode START_END_ONLY
     (the drill-span arm)

Written, then refilled by `kicad-cli pcb drc --refill-zones --save-board`, so
the `(zone_layer_connections ...)` in the result are KiCad's own answers.
"""
import pcbnew, os

OUT = os.path.expanduser('~/kicad-oracle/flashing/flashing.kicad_pcb')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
MM = pcbnew.FromMM

b = pcbnew.BOARD()
b.SetCopperLayerCount(4)
F, I1, I2, B = pcbnew.F_Cu, pcbnew.In1_Cu, pcbnew.In2_Cu, pcbnew.B_Cu

nets = {}
for name in ('GND', 'VCC', 'SIG'):
    n = pcbnew.NETINFO_ITEM(b, name)
    b.Add(n)
    n.thisown = 0
    nets[name] = n

def add(item):
    # BOARD::Add takes ownership; SWIG does not know that, so an item created
    # inside a helper is freed when the helper returns and the board is left
    # holding a dangling pointer (SaveBoard then segfaults).
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

for (x1, y1, x2, y2) in [(0,0,70,0), (70,0,70,40), (70,40,0,40), (0,40,0,0)]:
    edge(x1, y1, x2, y2)

def zone(net, layers, x1, y1, x2, y2, priority):
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
    for (x, y) in [(x1,y1), (x2,y1), (x2,y2), (x1,y2)]:
        o.Append(MM(x), MM(y))
    # `ZONE::SetOutline( SHAPE_POLY_SET* )` is `m_Poly = aOutline` - it TAKES
    # the pointer - so the zone, not Python, owns it from here.
    z.SetOutline(o)
    o.thisown = 0
    z.SetLocalClearance(MM(0.2))
    z.SetMinThickness(MM(0.2))
    add(z)
    return z

# A + A' + D: one GND pour on every layer.
zone('GND', [F, I1, I2, B], 5, 5, 25, 35, 0)
# B: two same-priority zones of different nets, overlapping on In1.
zone('VCC', [I1], 30, 5, 45, 35, 0)
zone('SIG', [I1], 33, 5, 45, 35, 0)
# C: a higher-priority VCC pour, alone.
zone('VCC', [I1], 50, 5, 65, 35, 2)


def keepout(layers, x1, y1, x2, y2):
    z = pcbnew.ZONE(b)
    ls = pcbnew.LSET()
    for l in layers:
        ls.addLayer(l)
    z.SetLayerSet(ls)
    z.SetIsRuleArea(True)
    z.SetDoNotAllowZoneFills(True)
    o = pcbnew.SHAPE_POLY_SET()
    o.NewOutline()
    for (x, y) in [(x1,y1), (x2,y1), (x2,y2), (x1,y2)]:
        o.Append(MM(x), MM(y))
    z.SetOutline(o)
    o.thisown = 0
    add(z)


# F: a "no zone fills" rule area inside the GND pour. A via under it is forced
# to no-connection whatever zone it sits in (`isInPourKeepoutArea`), and the
# rule area must not itself be picked as the highest-priority zone.
# On F.Cu and In1.Cu only, so the via under it is forced to no-connection on
# In1.Cu and left alone on In2.Cu - which is what pins the keepout's own layer
# test.
keepout([F, I1], 7, 25, 13, 33)


# G: a rule area over the GND pour that keeps TRACKS out but allows zone
# fills, at a priority above the pour's. Two things must ignore it: a rule
# area is never the "highest priority zone" whatever its priority, and a
# keepout only forces no-connection when it forbids zone fills specifically.
def rule_area_no_tracks(layers, x1, y1, x2, y2, priority):
    z = pcbnew.ZONE(b)
    ls = pcbnew.LSET()
    for l in layers:
        ls.addLayer(l)
    z.SetLayerSet(ls)
    z.SetIsRuleArea(True)
    z.SetDoNotAllowTracks(True)
    z.SetDoNotAllowZoneFills(False)
    z.SetAssignedPriority(priority)
    o = pcbnew.SHAPE_POLY_SET()
    o.NewOutline()
    for (x, y) in [(x1,y1), (x2,y1), (x2,y2), (x1,y2)]:
        o.Append(MM(x), MM(y))
    z.SetOutline(o)
    o.thisown = 0
    add(z)


rule_area_no_tracks([F, I1, I2, B], 17, 25, 23, 33, 3)

# I: two pours over one another on In2.Cu, the HIGHER priority one on a
# different net from the via under them and declared FIRST. Both arms of
# "Prefer highest priority and matching netcode" turn on this pair:
#
#  - without the `priority < highest` early-out, the priority-2 GND pour
#    replaces the priority-5 VCC one on the netcode arm, and the via flashes;
#  - without the `zone->GetNetCode() == via->GetNetCode()` test, the VCC pour
#    that IS chosen flashes a GND via.
#
# KiCad flashes neither: the priority-5 VCC pour wins and its net does not
# match.
zone('VCC', [I2], 30, 20, 45, 33, 5)
zone('GND', [I2], 30, 20, 45, 33, 2)

def track(net, layer, x1, y1, x2, y2):
    t = pcbnew.PCB_TRACK(b)
    t.SetLayer(layer)
    t.SetStart(pcbnew.VECTOR2I(MM(x1), MM(y1)))
    t.SetEnd(pcbnew.VECTOR2I(MM(x2), MM(y2)))
    t.SetWidth(MM(0.25))
    t.SetNet(nets[net])
    add(t)

def via(net, x, y, drill, mode, top=F, bot=B):
    v = pcbnew.PCB_VIA(b)
    v.SetPosition(pcbnew.VECTOR2I(MM(x), MM(y)))
    v.SetWidth(MM(0.8))
    v.SetDrill(MM(drill))
    v.SetLayerPair(top, bot)
    v.SetNet(nets[net])
    v.SetRemoveUnconnected(True)
    if mode == 'keep_end':
        v.SetKeepStartEnd(True)
    elif mode == 'start_end_only':
        v.Padstack().SetUnconnectedLayerMode(
            pcbnew.UNCONNECTED_LAYER_MODE_START_END_ONLY)
    add(v)
    # A via with nothing on it gets re-netted by DRC; give it a stub.
    track(net, F, x, y, x + 1.0, y)
    return v

via('GND', 15, 15, 0.4, 'keep_end')              # A
via('GND', 25.3, 15, 0.8, 'keep_end')            # A' centre 0.3 outside, hole 0.4
via('SIG', 38, 15, 0.4, 'keep_end')              # B
via('GND', 15, 28, 0.4, 'start_end_only')        # D
via('GND', 10, 29, 0.4, 'keep_end')              # F: under the keepout
via('GND', 20, 29, 0.4, 'keep_end')              # G: under the tracks-only rule area
via('GND', 37, 26, 0.4, 'keep_end')              # I: under the priority pair

def pth_pad(ref, net, x, y, keep_end=False):
    f = pcbnew.FOOTPRINT(b)
    f.SetPosition(pcbnew.VECTOR2I(MM(x), MM(y)))
    f.SetReference(ref)
    p = pcbnew.PAD(f)
    p.SetAttribute(pcbnew.PAD_ATTRIB_PTH)
    p.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
    p.SetSize(pcbnew.VECTOR2I(MM(1.6), MM(1.6)))
    p.SetDrillSize(pcbnew.VECTOR2I(MM(0.8), MM(0.8)))
    p.SetLayerSet(p.PTHMask())
    p.SetPosition(pcbnew.VECTOR2I(MM(x), MM(y)))
    p.SetNumber('1')
    p.SetNet(nets[net])
    p.SetRemoveUnconnected(True)
    if keep_end:
        p.SetKeepTopBottom(True)
    p.thisown = 0
    f.Add(p)
    add(f)
    track(net, F, x, y, x + 1.0, y)


# E: a pad 0.3 mm OUTSIDE the priority-2 VCC pour, on that pour's own net -
# closer to it than its own 0.4 mm hole radius.
# The via test takes the hole radius; the pad test does not
# (zone_filler.cpp:648-652 against :598-602), so this one is not flashed even
# though its 0.8 mm hole would reach the pour if it were.
pth_pad('J2', 'VCC', 49.7, 25)

# H: a pad whose top and bottom layers are kept - the method never writes an
# override for those, so only its own ClearZoneLayerOverrides can drop a stale
# one, which is what a refill after an edit depends on.
pth_pad('J3', 'GND', 15, 8, keep_end=True)

# C: a through-hole pad on SIG under the priority-2 VCC pour.
fp = pcbnew.FOOTPRINT(b)
fp.SetPosition(pcbnew.VECTOR2I(MM(56), MM(15)))
fp.SetReference('J1')
pad = pcbnew.PAD(fp)
pad.SetAttribute(pcbnew.PAD_ATTRIB_PTH)
pad.SetShape(pcbnew.PAD_SHAPE_CIRCLE)
pad.SetSize(pcbnew.VECTOR2I(MM(1.6), MM(1.6)))
pad.SetDrillSize(pcbnew.VECTOR2I(MM(0.8), MM(0.8)))
pad.SetLayerSet(pad.PTHMask())
pad.SetPosition(pcbnew.VECTOR2I(MM(56), MM(15)))
pad.SetNumber('1')
pad.SetNet(nets['SIG'])
pad.SetRemoveUnconnected(True)
pad.thisown = 0
fp.Add(pad)
add(fp)
track('SIG', F, 56, 15, 57, 15)

b.BuildListOfNets()
pcbnew.SaveBoard(OUT, b)
print('wrote', OUT)
