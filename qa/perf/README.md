# Perf harness

Measurements behind the three chooser/preload stalls. Not part of the CI gate:
the qa root config collects `*.test.*`, and everything here is `*.bench.*`.

The fixture is the real hosted symbol set (223 libraries, 22 784 symbols,
230 MB of s-expressions), downloaded once to `~/ziro-perf-fixtures/symbols`:

```sh
mkdir -p ~/ziro-perf-fixtures/symbols && cd ~/ziro-perf-fixtures/symbols
B=https://pub-ac941e05e1284f409be2ed74ddb151b3.r2.dev/symbols
curl -s --compressed -o index.json $B/index.json
node -e "console.log(require('./index.json').map(e=>e.name).join('\n'))" > libs.txt
while read L; do curl -s --compressed -o "$L.kicad_sym" "$B/$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))' "$L").kicad_sym"; done < libs.txt
```

Run:

```sh
cd qa
V=../node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs
KEEP=0 BUDGET_MB=99999 node --max-old-space-size=2400 $V perf/parse_all.bench.ts   # A: preload parse cost
KEEP=1 BUDGET_MB=1200  node --max-old-space-size=2400 --expose-gc $V perf/parse_all.bench.ts  # A2: retained heap
node --max-old-space-size=2400 $V perf/chooser.bench.ts                             # B/C/D
pnpm exec vitest run --config perf/vitest.bench.config.ts                           # D2: row render
```

`--max-old-space-size` is not optional. Keeping every parsed library resident
needs more heap than this machine has, which is itself finding A2.

## DRC

`drc_timing.mts` runs a whole DRC over a board and prints where the time went,
phase by phase - the phases being the very strings `DIALOG_DRC` shows - plus
the longest gap between two `updateUI()` calls, which is how long the tab would
be frozen at that point.

```sh
cd qa
V=../node_modules/.pnpm/vite-node@*/node_modules/vite-node/vite-node.mjs
node --max-old-space-size=4000 $V perf/drc_timing.mts \
    ~/kicad-reference/demos/cm5_minima/CM5_MINIMA_3.kicad_pcb
```

Add `--cpu-prof --cpu-prof-dir=<dir>` for a `.cpuprofile`; that is what found
`BigInt()` taking a third of the run (see the exact-double fast path in
`libs/kimath/src/geometry/seg.ts`).

The board is the oracle too: `kicad-cli pcb drc --severity-all --format json`
beside it gives KiCad's own count for the same file.
