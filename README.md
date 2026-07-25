# Ziro Designer

**Professional electronics design in a browser tab — zero learning curve, zero
installs.**

Ziro Designer is the flagship design suite from **ZiroEDA**: a browser-native,
open-source electronics design tool. It speaks the industry's open file formats
natively — projects made in KiCad open directly with no import step, no
migration, no retraining — while everything about the product (cloud projects,
sharing, and the AI-assisted design tools on our roadmap) is built web-first.

The core is free software (GPL-3.0-or-later). The plan is to charge only for
what a hosted service uniquely adds on top — cloud compute (simulation,
autorouting, batch DRC), real-time team collaboration, and AI assistance —
never for the editor itself. See **[PHILOSOPHY.md](./PHILOSOPHY.md)** for our
format-compatibility promise and how we relate to the upstream ecosystem.

> Ziro Designer is an independent project by ZiroEDA. It is **not** affiliated
> with or endorsed by the KiCad project; "KiCad" is a trademark of its
> respective owners.

## Goals

- **Familiar.** Behave like the tools electronics engineers already know —
  same conventions, same hotkeys, same visual language — so switching costs
  nothing.
- **Interoperable.** Open formats are the source of truth. Your designs are
  plain files you own, readable by other tools, forever.
- **Web-native.** TypeScript + Canvas/WebGL in the browser. Heavy batch compute
  (simulation, 3D kernel ops, autorouting) offloads to a server when needed.
- **Expandable.** A shared engine underpins every editor (schematic, symbol,
  board, footprint today), so capabilities compound rather than being rebuilt
  per tool — and the coming AI copilot plugs into all of them at once.

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).

## Tech stack

| Concern                | Choice                                             |
| ---------------------- | -------------------------------------------------- |
| Core language          | TypeScript (Rust/WASM reserved for measured hot paths) |
| UI                     | React                                              |
| 2D rendering           | Canvas2D → WebGL behind an interface               |
| 3D viewer              | three.js                                           |
| State / undo / actions | command bus with lossless document sources         |
| Auth / cloud sync      | Supabase                                           |
| Crash reporting        | Sentry (opt-out, scrubbed)                         |
| Build / monorepo       | Vite + pnpm workspaces                             |
| Tests                  | Vitest                                             |

## Configuration

Every integration is env-gated and degrades to a fully offline app when its
variables are absent, so a clone runs with no configuration at all.

| Variable                       | Effect when unset                        |
| ------------------------------ | ---------------------------------------- |
| `VITE_SUPABASE_URL`            | Auth and cloud sync disabled             |
| `VITE_SUPABASE_ANON_KEY`       | Auth and cloud sync disabled             |
| `VITE_SUPABASE_STORAGE_BUCKET` | Cloud file storage disabled              |
| `VITE_SENTRY_DSN`              | Crash reporting disabled                 |
| `VITE_RELEASE`                 | Crashes are tagged `dev`                 |

### Crash reporting

Reports are **opt-out** — on by default, switched off under
Preferences → Common → Privacy. Payloads are scrubbed before sending
(`designer/src/telemetry/scrub.ts`): file names are redacted, URLs lose their
query strings, console breadcrumbs are dropped, and neither the signed-in
account nor an IP address is attached. Reports are grouped by a random
per-browser id that is not linked to the user's account.

Tracing, session replay and profiling are all disabled: this collects stack
traces to fix bugs, not usage analytics.

## Repository layout

See **[STRUCTURE.md](./STRUCTURE.md)** for the full map and the conventions
behind it.

```
ziro-designer/
  designer/      # the app: launcher, editor frames, cloud sync, served libraries
  eeschema/      # schematic engine: document model, file io, connectivity/ERC, tools
  pcbnew/        # board engine: object model, file io, board editing
  common/        # shared EDA classes: shapes, text, units, transforms, stroke font
  libs/
    kimath/      # math: vectors, angles, trigonometry
    core/        # small shared utilities
    sexpr/       # lossless S-expression parser/serializer
  qa/            # unit tests (qa/unittests/<module>) + fixtures (qa/data)
```

### `@ziroeda/designer` — the app

A React + Canvas2D suite with four editors — schematic, symbol, board, and
footprint (plus a 3D board viewer) — each wrapped in familiar window chrome:
menu bar, toolbars, panels, and a live status bar. Run it with:

```bash
pnpm -C designer dev      # http://localhost:5173
pnpm -C designer build    # typecheck + production build
```

### The engine packages

Two layers, both built for round-trip fidelity:

- **Lossless S-expression layer** — the parser/serializer for the open design
  formats. "Lossless" is a hard requirement: it preserves every node (including
  fields Ziro Designer does not yet model) and the exact source text of numeric
  atoms, so saving a file never silently corrupts data the user cares about.
  Correctness is enforced by round-trip tests against real design files
  (`parse ∘ serialize ∘ parse` is identity over the AST).

- **Typed document models** — typed views over that AST (symbols, pins, wires,
  labels, boards, footprints, pads, zones). Coordinates are integer internal
  units (100 nm), not float millimetres, so geometry and equality stay exact.
  Every modelled item keeps its source AST node, so unmodified items round-trip
  byte-for-byte.

```bash
pnpm install
pnpm -C qa test      # run all unit tests (parser round-trips, model, editing, ERC)
pnpm -r typecheck    # typecheck every package
```

## Roadmap

1. **Schematic capture** — lossless file io, typed model, faithful rendering,
   editing with undo/redo, symbol placement, save. ✅
2. **Connectivity + ERC** — net building, dangling detection, rule checks. ✅
3. **Board + footprint editing** — object model, file io, move/rotate/delete/
   duplicate, 3D viewer. ✅ (in progress: routing tools)
4. **Cloud projects** — auth, project storage, templates. ✅ (hardening)
5. **Quality pass** — CI, lint, bug inventory, launcher/editor cleanup. ⟵ *now*
6. **Collaboration** — sharing, review, multiplayer.
7. **AI copilot** — assisted placement/routing/review, growing into agentic
   design tools.
