#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 ZiroEDA and contributors.
"""
Oracle for BITMAPCONV_INFO::createOutputData's polygon half: the outlines a
footprint export writes, for bitmaps with curves and holes (the KiCad-written
files in this directory have only corners).

Inputs are independent of our TypeScript on both halves that matter:

- the potrace path lists are KiCad's own potracelib's
  (potrace_oracle.json, from potrace_trace_probe.cpp);
- the polygon operations are KiCad's own SHAPE_POLY_SET, through the
  installed KiCad's `pcbnew` Python module: Simplify, BooleanSubtract,
  NormalizeAreaOutlines, Fracture, exactly as createOutputData calls them.

BezierToPolyline and the grouping loop are transcribed from
bitmap2component.cpp below. Output: for each case and DPI, the fp_poly
outlines as integer IU relative to the footprint offset, i.e. what each
`(xy {} {})` prints times PCB_IU_PER_MM.

    python3 qa/probes/bitmap2component_poly_oracle.py
"""
import json
import math
from pathlib import Path

import pcbnew

DATA = Path(__file__).resolve().parents[1] / "data" / "bitmap2component"
PCB_IU_PER_MM = 1e6
CASES = ["disc24", "ring30", "ellipse50x20", "nested", "eight", "noise40", "wide150"]
DPIS = [300, 173]


def bezier_to_polyline(buf, p1, p2, p3, p4):
    delta = 0.25
    sq = lambda v: v * v
    cu = lambda v: v * v * v
    dd0 = sq(p1[0] - 2 * p2[0] + p3[0]) + sq(p1[1] - 2 * p2[1] + p3[1])
    dd1 = sq(p2[0] - 2 * p3[0] + p4[0]) + sq(p2[1] - 2 * p3[1] + p4[1])
    dd = 6 * math.sqrt(max(dd0, dd1))
    e2 = 8 * delta / dd if 8 * delta <= dd else 1
    epsilon = math.sqrt(e2)
    t = epsilon
    while t < 1:
        x = p1[0] * cu(1 - t) + 3 * p2[0] * sq(1 - t) * t + 3 * p3[0] * (1 - t) * sq(t) + p4[0] * cu(t)
        y = p1[1] * cu(1 - t) + 3 * p2[1] * sq(1 - t) * t + 3 * p3[1] * (1 - t) * sq(t) + p4[1] * cu(t)
        buf.append((x, y))
        t += epsilon
    buf.append(p4)


def kiround(v):
    return int(math.ceil(v - 0.5)) if v < 0 else int(math.floor(v + 0.5))


def polygons(case, dpi):
    w = len(case["rows"][0])
    h = len(case["rows"])
    sx = PCB_IU_PER_MM * 25.4 / dpi
    sy = PCB_IU_PER_MM * 25.4 / dpi
    offx = kiround(w / 2.0 * sx)
    offy = kiround(h / 2.0 * sy)
    paths = case["paths"]
    areas = pcbnew.SHAPE_POLY_SET()
    holes = pcbnew.SHAPE_POLY_SET()
    main_outline = True
    out = []
    for idx, p in enumerate(paths):
        c = [[(float(s[0]), float(s[1])), (float(s[2]), float(s[3])), (float(s[4]), float(s[5]))] for s in p["c"]]
        buf = []
        start = c[-1][2]
        for i, tag in enumerate(p["tag"]):
            if tag == 2:  # POTRACE_CORNER
                buf.append(c[i][1])
                buf.append(c[i][2])
            else:
                bezier_to_polyline(buf, start, c[i][0], c[i][1], c[i][2])
            start = c[i][2]
        target = areas if main_outline else holes
        main_outline = False
        target.NewOutline()
        for x, y in buf:
            target.Append(int(x * sx), int(y * sy))
        nxt = paths[idx + 1] if idx + 1 < len(paths) else None
        if nxt is None or nxt["sign"] == "+":
            areas.Simplify()
            holes.Simplify()
            areas.BooleanSubtract(holes)
            if areas.NormalizeAreaOutlines():
                areas.Fracture()
                for ii in range(areas.OutlineCount()):
                    ch = areas.Outline(ii)
                    out.append([[ch.CPoint(k).x - offx, ch.CPoint(k).y - offy] for k in range(ch.PointCount())])
                areas.RemoveAllContours()
                holes.RemoveAllContours()
                main_outline = True
    return out


def main():
    cases = {c["name"]: c for c in json.loads((DATA / "potrace_oracle.json").read_text())}
    result = [
        {"name": n, "dpi": dpi, "polygons": polygons(cases[n], dpi)} for n in CASES for dpi in DPIS
    ]
    target = DATA / "poly_oracle.json"
    target.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    print(target, pcbnew.Version(), sum(len(r["polygons"]) for r in result), "polygons")


if __name__ == "__main__":
    main()
