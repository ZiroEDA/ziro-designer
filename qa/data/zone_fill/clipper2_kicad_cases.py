"""Random SHAPE_POLY_SET cases through KiCad 10.0.5's own Clipper2, dumped as JSON."""
import pcbnew, json, random, sys, math
random.seed(int(sys.argv[1]) if len(sys.argv) > 1 else 1)
N = int(sys.argv[2]) if len(sys.argv) > 2 else 200
OUT = sys.argv[3] if len(sys.argv) > 3 else '/home/akshay/kicad-oracle/clipper2/cases.json'

def chain(pts):
    c = pcbnew.SHAPE_LINE_CHAIN()
    for x, y in pts: c.Append(pcbnew.VECTOR2I(int(x), int(y)))
    c.SetClosed(True)
    return c

def polyset(polys):
    ps = pcbnew.SHAPE_POLY_SET()
    for poly in polys:
        ps.AddOutline(chain(poly[0]))
        for h in poly[1:]:
            ps.AddHole(chain(h))
    return ps

def dump(ps):
    out = []
    for i in range(ps.OutlineCount()):
        o = ps.Outline(i)
        rings = [[[o.CPoint(k).x, o.CPoint(k).y] for k in range(o.PointCount())]]
        for j in range(ps.HoleCount(i)):
            h = ps.Hole(i, j)
            rings.append([[h.CPoint(k).x, h.CPoint(k).y] for k in range(h.PointCount())])
        out.append(rings)
    return out

def rand_ring(cx, cy, r, n, jitter=0.6, ccw=True):
    pts = []
    for k in range(n):
        a = 2 * math.pi * k / n + random.uniform(-jitter, jitter) * math.pi / n
        rr = r * random.uniform(0.4, 1.0)
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    if not ccw: pts.reverse()
    return pts

def rand_rect(cx, cy, w, h, ang=0.0):
    c, s = math.cos(ang), math.sin(ang)
    pts = [(-w/2, -h/2), (w/2, -h/2), (w/2, h/2), (-w/2, h/2)]
    return [(cx + x*c - y*s, cy + x*s + y*c) for x, y in pts]

def rand_shape():
    kind = random.random()
    cx, cy = random.randint(-2_000_000, 2_000_000), random.randint(-2_000_000, 2_000_000)
    if kind < 0.35:
        return rand_ring(cx, cy, random.randint(200_000, 2_500_000), random.randint(3, 14), ccw=random.random() < 0.7)
    if kind < 0.7:
        return rand_rect(cx, cy, random.randint(100_000, 3_000_000), random.randint(100_000, 3_000_000), random.choice([0, 0, math.pi/2, random.uniform(0, math.pi)]))
    # circle-ish
    n = random.randint(8, 32); r = random.randint(100_000, 1_500_000)
    return [(cx + r*math.cos(2*math.pi*k/n), cy + r*math.sin(2*math.pi*k/n)) for k in range(n)]

def rand_polys(maxn):
    polys = []
    for _ in range(random.randint(1, maxn)):
        outline = rand_shape()
        holes = []
        if random.random() < 0.3:
            xs = [p[0] for p in outline]; ys = [p[1] for p in outline]
            cx, cy = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2
            holes.append(rand_ring(cx, cy, (max(xs)-min(xs))/5, random.randint(3, 8), ccw=random.random() < 0.5))
        polys.append([[(int(x), int(y)) for x, y in r] for r in [outline] + holes])
    return polys

def knock_polys():
    polys = []
    grid = random.choice([1, 1000, 12700, 100000])
    for _ in range(random.randint(20, 120)):
        cx = random.randint(-30, 30) * grid + random.randint(-2_000_000, 2_000_000) // grid * grid
        cy = random.randint(-30, 30) * grid + random.randint(-2_000_000, 2_000_000) // grid * grid
        k = random.random()
        if k < 0.4:
            n = random.choice([8, 12, 16, 24, 32]); r = random.randint(50_000, 600_000)
            ring = [(round(cx + r*math.cos(2*math.pi*j/n)), round(cy + r*math.sin(2*math.pi*j/n))) for j in range(n)]
        elif k < 0.7:
            w = random.randint(50_000, 900_000) // grid * grid or grid; h = random.randint(50_000, 900_000) // grid * grid or grid
            ring = [(cx, cy), (cx + w, cy), (cx + w, cy + h), (cx, cy + h)]
            if random.random() < 0.5: ring.reverse()
        else:
            # stadium along a random direction
            L = random.randint(100_000, 2_000_000); r = random.randint(50_000, 300_000)
            ang = random.choice([0, math.pi/2, math.pi/4, random.uniform(0, math.pi)])
            ex, ey = cx + L*math.cos(ang), cy + L*math.sin(ang)
            n = 8
            ring = []
            for j in range(n+1):
                a = ang + math.pi/2 + math.pi*j/n
                ring.append((round(cx + r*math.cos(a)), round(cy + r*math.sin(a))))
            for j in range(n+1):
                a = ang - math.pi/2 + math.pi*j/n
                ring.append((round(ex + r*math.cos(a)), round(ey + r*math.sin(a))))
        polys.append([[(int(x), int(y)) for x, y in ring]])
    return polys

cases = []
for i in range(N):
    if random.random() < 0.4:
        a = [[[(-4_000_000, -4_000_000), (4_000_000, -4_000_000), (4_000_000, 4_000_000), (-4_000_000, 4_000_000)]]]
        b = knock_polys()
        op = random.choice(['sub', 'sub', 'add', 'inflate'])
        case = {'a': a, 'b': b, 'op': op}
        pa = polyset(a); pb = polyset(b)
        if op == 'sub': pa.BooleanSubtract(pb)
        elif op == 'add': pa.BooleanAdd(pb)
        else:
            pa = polyset(b); pa.BooleanAdd(pcbnew.SHAPE_POLY_SET()); case['a'] = dump(pa)
            amount = random.choice([1000, 12345, 50000, 200000, -1000, -50000, -200000])
            strat = random.choice([0, 1, 2, 3, 4]); maxerr = random.choice([5000, 10000, 1000])
            simplify = random.random() < 0.3
            case.update({'amount': amount, 'strategy': strat, 'maxError': maxerr, 'simplify': simplify})
            pa.Inflate(amount, strat, maxerr, simplify)
        case['result'] = dump(pa)
        cases.append(case)
        continue
    a = rand_polys(4); b = rand_polys(4)
    op = random.choice(['add', 'sub', 'int', 'inflate', 'inflate', 'inflate'])
    case = {'a': a, 'b': b, 'op': op}
    pa = polyset(a); pb = polyset(b)
    if op == 'add': pa.BooleanAdd(pb)
    elif op == 'sub': pa.BooleanSubtract(pb)
    elif op == 'int': pa.BooleanIntersection(pb)
    else:
        # union first so the input is a proper (non-self-intersecting) set, as a real caller's is
        pa.BooleanAdd(pcbnew.SHAPE_POLY_SET())
        case['a'] = dump(pa)
        amount = random.choice([1, 1000, 12345, 50000, 200000, -1000, -50000, -200000, 397_000, -397_000])
        strat = random.choice([0, 1, 2, 3, 4])
        maxerr = random.choice([5000, 10000, 2500, 1000, 50000])
        simplify = random.random() < 0.3
        case.update({'amount': amount, 'strategy': strat, 'maxError': maxerr, 'simplify': simplify})
        pa.Inflate(amount, strat, maxerr, simplify)
    case['result'] = dump(pa)
    cases.append(case)
json.dump(cases, open(OUT, 'w'))
print('wrote', len(cases), 'to', OUT)
