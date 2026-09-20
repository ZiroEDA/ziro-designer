# pcbnew — how this package maps onto KiCad's

Reference: `/home/akshay/kicad-reference/pcbnew` (KiCad 10.0.5, the installed
build). This file records **what we decided and why**, so the next session
reads it instead of re-deriving it. Everything here was measured on 2026-09-20,
not estimated.

Regenerate the raw table with `qa/probes/struct_diff.sh`, which writes
`docs/pcbnew-structure-diff.md`.

## The rule

**Every module lives at the path KiCad keeps its counterpart at.** There is no
`src/`: KiCad's `pcbnew/` holds its subdirectories and its loose `.cpp` files
together, and so does ours, with `package.json` where KiCad has
`CMakeLists.txt`. Dropping `src/` was done 2026-09-20; the July commit
`deb0e09f` that claimed to "mirror KiCad's source tree" had left it in place
from the pnpm default.

**Each file names its counterpart in its header comment**, e.g.

    /**
     * The footprint autoplacer's occupancy and cost grid. Counterpart:
     * `pcbnew/autorouter/ar_matrix.cpp` (AR_MATRIX).
     */

This is load-bearing, not decoration. A filename diff alone called 118 of our
modules "no KiCad counterpart"; reading the headers cut that to 47, because 71
of them are ports under a different name. **Keep writing the citation.**

## Directory status

| KiCad | ours | why |
|---|---|---|
| `autorouter/` | partial | all three concepts are ported, two under our own names — see below |
| `board_stackup_manager/` | yes | |
| `component_classes/` | yes | |
| `connectivity/` | yes | root `connectivity.ts` is the old view-side copy, pending #636 |
| `drc/` | yes | |
| `exporters/` | yes | |
| `generators/` | yes | |
| `import_gfx/` | yes | |
| `length_delay_calculation/` | yes | |
| `netlist_reader/` | yes | |
| `pcb_io/` | yes | |
| `ratsnest/` | yes | root `ratsnest.ts` is the old view-side copy, pending #636 |
| `router/` | yes | |
| `teardrop/` | yes | root `teardrop.ts` is the old view-side copy, pending #636 |
| `tools/` | yes | only 4 files; the bulk of KiCad's tools land in stage 3 of #636 |
| `api/` | **n/a** | IPC/protobuf handler (2 077 lines) plus 870 lines of enum↔wire mapping. It exists because KiCad is a desktop binary and a plugin lives in another process. We have no process boundary — a caller invokes the function. See "the agent boundary" below. |
| `python/` | **n/a** | SWIG bindings generating a `pcbnew` Python module. No interpreter here. |
| `git/` | **n/a** | `kigit_pcb_merge.cpp`, libgit2 merge driver for local project files. |
| `navlib/` | **n/a** | 3Dconnexion SpaceMouse driver glue. |
| `dialogs/` | **missing** | 20 of our root modules are its files with the `dialog_` prefix dropped. Moving them costs 98 import sites and they get rewritten by stage 6 of #636 anyway, so this waits for that. |
| `widgets/` | **missing** | 13 files, 9 453 lines — `appearance_controls`, `net_inspector_panel`, `pcb_properties_panel`. Surface code, frozen until the core is KiCad's. |
| `zone_manager/` | **missing** | 6 files, 1 595 lines — the Zone Manager dialog. Surface, frozen. |
| `board_tables/` | **missing** | 2 files, 293 lines — the stackup and board-characteristics tables you can drop on a sheet. Small; unbuilt. |
| `microwave/` | **missing** | 4 files, 1 341 lines — gap/stub/inductor generators. Unbuilt feature. |
| `specctra_import_export/` | **missing** | 4 files, 6 532 lines — DSN/SES for external autorouters. Unbuilt feature. |
| — | `barcode/` | ours. KiCad links Zint as an external library; we vendored a port, so the directory has no KiCad twin by design. |

### `autorouter/` is not as empty as it looks

KiCad has 2 767 lines there. We have `spread_footprints.ts` at the matching
path, and the other two concepts are ported but sitting in the root under our
own names:

| ours | KiCad |
|---|---|
| `autoplace_matrix.ts` | `autorouter/ar_matrix.cpp` (`AR_MATRIX`) |
| `autoplace_footprints.ts` | `autorouter/ar_autoplacer.cpp` (`AR_AUTOPLACER`), driven as `autoplace_tool.cpp` drives it |

So the gap is naming, not capability. Renaming them to `autorouter/ar_matrix.ts`
and `autorouter/ar_autoplacer.ts` would close it.

## Counts, 2026-09-20

| status | n | meaning |
|---|---:|---|
| at KiCad's own path | 145 | |
| misfiled | 1 | `teardrop.ts`; its target is taken by the ported `TEARDROP_MANAGER`, so this is a #636 deletion, not a rename |
| KiCad keeps it in `dialogs/` | 20 | |
| KiCad keeps it outside `pcbnew/` | 7 | see below |
| KiCad declares it header-only | 14 | **not drift** — our path matches, `.ts` against `.h` |
| no KiCad file of that name | 118 | of which **71 cite a real KiCad file** in their header |

**24 files sit in a different directory than the counterpart they cite** — 10
belong in `tools/`, 4 in `dialogs/`, 2 each in `autorouter/`, `drc/` and
`router/`. Most are tool logic that stage 3 of #636 will move anyway; moving
them before it is churn.

### The 7 that belong outside pcbnew

These are KiCad's shared code, living in our pcbnew against the central-value
rule. `convert_basic_shapes_to_polygon.ts` and `drc/shape_collisions.ts`
already have a home in `libs/kimath/src/`; the rest belong in `common/`.

| ours | KiCad |
|---|---|
| `lset.ts` | `common/lset.cpp` |
| `layer_ids.ts` | `include/layer_ids.h` |
| `board_project_settings.ts` | `common/project/board_project_settings.cpp` |
| `properties_panel.ts` | `common/widgets/properties_panel.h` |
| `convert_basic_shapes_to_polygon.ts` | `libs/kimath/src/convert_basic_shapes_to_polygon.cpp` |
| `drc/shape_collisions.ts` | `libs/kimath/src/geometry/shape_collisions.cpp` |
| `barcode/common.ts` | `common/common.cpp` |

## Consequences of having no `src/`

`node_modules` now sits beside the sources, so **anything that walks the
package directory descends into dependencies**. This bit
`qa/unittests/designer/menu_ellipsis.test.ts`, which reported U+2026 findings
from third-party code.

Only walkers rooted at the *package* directory are affected —
`designer/src`, `common/src` and `eeschema/src` contain no nested
`node_modules`, so a walker rooted there needs nothing. Two tests needed the
guard, which follows the idiom already in `generator_identity.test.ts`:

    if (name === 'node_modules' || name === 'dist') continue;

Watch the `readdirSync` variant: with `{ withFileTypes: true }` the entry is a
`Dirent`, and `entry === 'node_modules'` is always false — a guard that never
fires while the test still passes. `tsc` catches it; a green test does not.

The other nine workspace packages still have `src/`. pcbnew is deliberately the
odd one out — the same change elsewhere multiplies the walker hazard in
directories that are scanned far more often.

## The agent boundary

`api/` is worth reading even though we will not port it. Its ~40 handlers —
`GetItemsByNet`, `GetItemsByNetClass`, `RefillZones`, `InteractiveMoveItems`,
`RunAction`, `SaveDocumentToString` — are KiCad's own answer to "what does an
external actor need to do to a board", refined over two releases with real
plugin authors. That **vocabulary** is the reusable part; the protobuf
marshalling is the cost of their process boundary and buys us nothing.

Our command-batch design is the same boundary drawn logically instead of across
a socket. Put it at the command level rather than the object level: one command
maps to one `BOARD_COMMIT`, so a batch is one undo step and one reviewable unit.
Name the commands in KiCad's terms, since a model that has read KiCad's docs
already speaks them.

Define the vocabulary before #636 finishes, implement it after — a command layer
written against the plain-object `Board` view would be rewritten by stage 6.

## Deliberate deviations

- **no `src/`** — matches KiCad; costs the `node_modules` walker guard above
- **`barcode/`** — ours; KiCad links Zint externally
- **this file** — KiCad has no `STRUCTURE.md` in `pcbnew/`. `struct_diff.sh`
  only classifies `.ts`, so it is not counted as drift.
