#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 ZiroEDA and contributors.
"""
Write qa/data/bitmap2component/potrace_oracle.json: a set of bitmaps and the
path list KiCad 10.0.5's own vendored potracelib traces from each, as printed
by potrace_trace_probe.cpp (build instructions in its header).

    python3 qa/probes/potrace_oracle_gen.py <path-to-built-probe>

The bitmaps are chosen to reach every branch the port could get wrong:
curves and opticurve joins (circles, ellipses), holes and the tree order
(rings, nested squares), ambiguous turns and the MINORITY policy (noise,
checkerboard), and shapes that straddle the 64-bit word boundary the C scans
and XORs in words (the wide bitmap).
"""
import json
import math
import random
import subprocess
import sys
from pathlib import Path


def grid(w, h, f):
    return ["".join("1" if f(x, y) else "0" for x in range(w)) for y in range(h)]


def disc(cx, cy, r):
    return lambda x, y: (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r


def noise(w, h, seed, density):
    rnd = random.Random(seed)
    cells = [[rnd.random() < density for _ in range(w)] for _ in range(h)]
    return ["".join("1" if c else "0" for c in row) for row in cells]


def cases():
    yield "hollow5", ["00000", "01110", "01010", "01110", "00000"]
    yield "disc24", grid(24, 24, disc(12, 12, 9.5))
    yield "ring30", grid(30, 30, lambda x, y: disc(15, 15, 12)(x, y) and not disc(15, 15, 6)(x, y))
    yield "ellipse50x20", grid(50, 20, lambda x, y: ((x + 0.5 - 25) / 22) ** 2 + ((y + 0.5 - 10) / 8) ** 2 <= 1)
    yield "triangle", grid(30, 26, lambda x, y: y >= 2 and y <= 24 and abs(x - 15) <= (y - 2) * 0.6)
    yield "checker8", grid(8, 8, lambda x, y: (x + y) % 2 == 0)
    yield "noise40", noise(40, 40, 1, 0.5)
    yield "noise64x30_sparse", noise(64, 30, 7, 0.25)
    # Straddles the word boundaries at x = 64 and x = 128.
    yield "wide150", grid(
        150,
        24,
        lambda x, y: (58 <= x < 72 and 2 <= y < 22 and not (62 <= x < 67 and 8 <= y < 15))
        or disc(130, 12, 9)(x, y)
        or (100 <= x < 150 and 20 <= y < 24),
    )
    # Three levels: square, hole, island, hole.
    yield "nested", grid(
        32,
        32,
        lambda x, y: (2 <= x < 30 and 2 <= y < 30)
        and not ((6 <= x < 26 and 6 <= y < 26) and not ((10 <= x < 22 and 10 <= y < 22) and not (14 <= x < 18 and 14 <= y < 18))),
    )
    yield "dot3", ["000", "010", "000"]
    yield "blank4", ["0000"] * 4
    yield "full6", ["111111"] * 6
    yield "eight", grid(
        20,
        30,
        lambda x, y: (disc(10, 8, 7)(x, y) and not disc(10, 8, 3)(x, y))
        or (disc(10, 21, 8)(x, y) and not disc(10, 21, 4)(x, y)),
    )


def run(probe, rows):
    h = len(rows)
    w = len(rows[0])
    text = f"{w} {h}\n" + "\n".join(rows) + "\n"
    out = subprocess.run([probe], input=text, capture_output=True, text=True, check=True).stdout
    paths = []
    for line in out.splitlines():
        f = line.split()
        if f[0] == "path":
            paths.append({"sign": f[1], "area": int(f[2]), "n": int(f[3]), "tag": [], "c": []})
        else:
            paths[-1]["tag"].append(int(f[0]))
            # repr() is the shortest text that reads back to the same double
            paths[-1]["c"].append([repr(float(v)) for v in f[1:]])
    return paths


def main():
    probe = sys.argv[1]
    data = [{"name": n, "rows": rows, "paths": run(probe, rows)} for n, rows in cases()]
    out = Path(__file__).resolve().parents[1] / "data" / "bitmap2component" / "potrace_oracle.json"
    out.write_text(json.dumps(data, indent=0) + "\n")
    print(out, sum(len(d["paths"]) for d in data), "paths")


if __name__ == "__main__":
    main()
