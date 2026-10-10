"""make_cases.py: polygons for glu_tess_probe - the shapes VRML_LAYER feeds GLU (rectangles,
circles, slots, overlapping copper, boards with holes) plus the cache's edges: under and over 100
vertices, concave single contours, collinear runs, CW and CCW, each winding rule, boundary-only
and not. Seeded, so the golden file is reproducible."""
import math, random
random.seed(1006)
out = []
def poly(rule, b, contours):
    out.append(f'P {rule} {b}')
    for c in contours:
        out.append('C')
        out.extend(f'V {x!r} {y!r}' for x, y in c)
    out.append('E')
def circle(cx, cy, r, n, cw=False):
    pts = [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return pts[::-1] if cw else pts
def rect(x, y, w, h, cw=False):
    p = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
    return p[::-1] if cw else p
for rule in ('POS', 'NEG', 'ODD'):
    for b in (0, 1):
        poly(rule, b, [rect(0, 0, 10, 5)])
        poly(rule, b, [rect(0, 0, 10, 5, True)])
        poly(rule, b, [[(0, 0), (4, 0), (4, 4)]])
        poly(rule, b, [circle(1.5, -2.25, 0.4, 24)])
        poly(rule, b, [circle(1.5, -2.25, 0.4, 99)])
        poly(rule, b, [circle(1.5, -2.25, 0.4, 100)])
        poly(rule, b, [circle(1.5, -2.25, 0.4, 101)])
        poly(rule, b, [circle(1.5, -2.25, 0.4, 150, True)])
        poly(rule, b, [[(0, 0), (10, 0), (10, 10), (5, 3), (0, 10)]])  # concave
        poly(rule, b, [[(0, 0), (5, 0), (10, 0), (10, 10), (0, 10)]])  # collinear
        poly(rule, b, [[(0, 0), (10, 10), (10, 0), (0, 10)]])          # bowtie
        poly(rule, b, [rect(0, 0, 10, 10), circle(5, 5, 2, 16, True)])
        poly(rule, b, [rect(0, 0, 10, 10), rect(5, -5, 10, 10)])
        poly(rule, b, [rect(0, 0, 10, 10), circle(10, 5, 3, 32)])
        poly(rule, b, [circle(0, 0, 1, 12), circle(1.2, 0, 1, 12), circle(0.6, 1, 1, 12)])
        poly(rule, b, [rect(0, 0, 0, 0)])  # degenerate
        poly(rule, b, [])
        # random copper-like soup
        for k in range(6):
            cs = []
            for _ in range(random.randint(1, 8)):
                if random.random() < 0.5:
                    cs.append(circle(random.uniform(0, 20), random.uniform(0, 20), random.uniform(0.2, 3), random.choice([8, 16, 24, 48]), random.random() < 0.3))
                else:
                    cs.append(rect(random.uniform(0, 20), random.uniform(0, 20), random.uniform(0.2, 6), random.uniform(0.2, 6), random.random() < 0.3))
            poly(rule, b, cs)
# coincident vertices: stroke-text-like rectangles sharing corners on a grid, many per polygon,
# so the initial sort (SGI's seeded quicksort) has long runs of equal keys
for rule in ('POS', 'NEG', 'ODD'):
    for b in (0, 1):
        for k in range(4):
            cs = []
            for _ in range(random.randint(20, 60)):
                x, y = random.randint(0, 12) * 0.5, random.randint(0, 12) * 0.5
                w, h = random.choice([(0.5, 2), (2, 0.5), (1, 1), (0.5, 0.5)])
                cs.append(rect(x, y, w, h, random.random() < 0.2))
            poly(rule, b, cs)
print('\n'.join(out))
