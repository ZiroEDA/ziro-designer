# ZiroEDA

**Professional electronics design in a browser tab: zero learning curve, zero
installs.**

**ZiroEDA** is a browser-native, open-source electronics design suite. It speaks the industry's open file formats
natively: projects made in KiCad open directly with no import step, no
migration, no retraining, while everything about the product (cloud projects,
sharing, and the AI-assisted design tools on our roadmap) is built web-first.

The core is free software (GPL-3.0-or-later). The plan is to charge only for
what a hosted service uniquely adds on top: cloud compute (simulation,
autorouting, batch DRC), real-time team collaboration, and AI assistance,
never for the editor itself. See **[PHILOSOPHY.md](./PHILOSOPHY.md)** for our
format-compatibility promise and how we relate to the upstream ecosystem.

> ZiroEDA is an independent project. It is **not** affiliated
> with or endorsed by the KiCad project; "KiCad" is a trademark of its
> respective owners.

## Goals

- **Familiar.** Behave like the tools electronics engineers already know:
  same conventions, same hotkeys, same visual language, so switching costs
  nothing.
- **Interoperable.** Open formats are the source of truth. Your designs are
  plain files you own, readable by other tools, forever.
- **Web-native.** TypeScript + Canvas/WebGL in the browser. Heavy batch compute
  (simulation, 3D kernel ops, autorouting) offloads to a server when needed.
- **Expandable.** A shared engine underpins every editor (schematic, symbol,
  board, footprint today), so capabilities compound rather than being rebuilt
  per tool, and the coming AI copilot plugs into all of them at once.

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).

This project reuses a substantial amount of KiCad's work: much of the engine is
a TypeScript port of KiCad's C++, the icons are KiCad's, and the symbol,
footprint and 3D model libraries are KiCad's official libraries. Those carry two
different licences, GPL for the code and icons and CC-BY-SA 4.0 with the KiCad
library exception for the libraries. See [NOTICE](./NOTICE.md) for the full
attribution.

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
| `VITE_RELEASE`                 | Falls back to the build's git SHA        |
| `SENTRY_ORG`                   | Source maps not uploaded (set in `vercel.json`) |
| `SENTRY_PROJECT`               | Source maps not uploaded (set in `vercel.json`) |
| `SENTRY_AUTH_TOKEN`            | Source maps not uploaded (secret, dashboard only) |
| `SENTRY_URL`                   | Defaults to `https://de.sentry.io/`      |

### Cloud sync

Run `supabase/projects.sql`, `supabase/storage.sql` and `supabase/manifest.sql`
once each in the Supabase SQL editor, and turn on **object versioning** for the
bucket. The app works without any of it — everything is local-first — but a
deployment that syncs should have all four.

Project files are stored **content-addressed**: a blob's key is the SHA-256 of
its bytes, at `<userId>/blobs/<hash>`. Three properties follow, and they are the
whole design:

- **A write cannot destroy.** Different contents cannot share a key, so an
  upload only ever adds. Keying blobs by `<project>/<filename>` instead — which
  is what the first version did — makes every save an overwrite of the only
  copy.
- **A read is verifiable.** The key states what the bytes must hash to, so a
  truncated or substituted download is caught rather than handed to the parser.
- **History is nearly free.** Superseded blobs are still there under their own
  keys, so `project_versions` recording each committed manifest is enough to
  restore any earlier state.

The commit protocol is: store every blob, **confirm every blob is present**,
then write the row — and only then. Until that row lands the previous version is
entirely intact, so a push that fails at any point changes nothing. A row can
therefore never reference an object that is not in the store.

Reconciliation is last-write-wins on `updatedAt`, with the losing side kept as a
`(local copy, <date>)` project rather than discarded. A per-project failure is
reported in the UI, not logged to the console.

The transport is an interface (`cloud/backend.ts`) whose every method throws or
fulfils; `cloud/supabaseBackend.ts` is the only file that touches Supabase's
`{ data, error }` convention. That is deliberate. The convention's failure mode
is silent — `await` succeeds whether or not `error` is set — and the first
version, which called the client directly from the store and so could not be
reached by any test, lost the contents of eleven projects to exactly that.

### Crash reporting

Reports are **opt-out**: on by default, switched off under
Preferences → Common → Privacy. Payloads are scrubbed before sending
(`designer/src/telemetry/scrub.ts`): file names are redacted, URLs lose their
query strings, console breadcrumbs are dropped, and neither the signed-in
account nor an IP address is attached. Reports are grouped by a random
per-browser id that is not linked to the user's account.

Tracing, session replay and profiling are all disabled: this collects stack
traces to fix bugs, not usage analytics.

The deployed DSN lives in `vercel.json` rather than the Vercel dashboard. A
Sentry DSN is a public, write-only ingest key: it ships inside the client
bundle by design and can neither read issues nor reach the account, so keeping
it in the repo means every deploy and preview is configured identically, with
nothing to forget. Local development stays off unless you set `VITE_SENTRY_DSN`
yourself, so debugging never pollutes production issues.

The project is on Sentry's **EU (`de`) region**, which `vite.config.ts` already
defaults to. Note that an auth token must also be created on `de.sentry.io`:
tokens are region-scoped, and the CLI otherwise talks to the US instance and
uploads into a void.

#### Source maps

Without them every stack trace arrives minified (`index-a1b2c3.js:1:48291`),
which is close to useless. The org and project slugs are plain identifiers and
live in `vercel.json` with the DSN; `SENTRY_AUTH_TOKEN` is a real secret and
belongs in the Vercel dashboard only. Uploading starts as soon as all three are
present.

Because the slugs are committed, **renaming the Sentry project changes its slug
and silently stops symbolication**: the upload 401s, the build still succeeds,
and traces quietly go back to being minified. Rename in Sentry and here
together.

Maps are generated as `hidden` and **deleted after upload**: no
`sourceMappingURL` comment is emitted and no `.map` file is ever deployed, so
Sentry can symbolicate while the public site never serves our source. Deletion
happens even when the upload fails, so a bad token cannot leak source.

Upload failures are logged but **do not fail the build**, so an expired token
degrades symbolication instead of breaking a deploy. That means a silent
failure mode: if traces come back minified, check the build log rather than
assuming it is working.

Both the running app and the uploaded maps take their release from the same
value in `vite.config.ts` (Vercel's commit SHA, else the git SHA). They must
match exactly: Sentry binds events to maps by release name, and a mismatch
just silently leaves stacks minified.

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

### `@ziroeda/designer`: the app

A React + Canvas2D suite with four editors: schematic, symbol, board, and
footprint (plus a 3D board viewer), each wrapped in familiar window chrome:
menu bar, toolbars, panels, and a live status bar. Run it with:

```bash
pnpm -C designer dev      # http://localhost:5173
pnpm -C designer build    # typecheck + production build
```

### The engine packages

Two layers, both built for round-trip fidelity:

- **Lossless S-expression layer**: the parser/serializer for the open design
  formats. "Lossless" is a hard requirement: it preserves every node (including
  fields ZiroEDA does not yet model) and the exact source text of numeric
  atoms, so saving a file never silently corrupts data the user cares about.
  Correctness is enforced by round-trip tests against real design files
  (`parse ∘ serialize ∘ parse` is identity over the AST).

- **Typed document models**: typed views over that AST (symbols, pins, wires,
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

1. **Schematic capture**: lossless file io, typed model, faithful rendering,
   editing with undo/redo, symbol placement, save. ✅
2. **Connectivity + ERC**: net building, dangling detection, rule checks. ✅
3. **Board + footprint editing**: object model, file io, move/rotate/delete/
   duplicate, 3D viewer. ✅ (in progress: routing tools)
4. **Cloud projects**: auth, project storage, templates. ✅ (hardening)
5. **Quality pass**: CI, lint, bug inventory, launcher/editor cleanup. ⟵ *now*
6. **Collaboration**: sharing, review, multiplayer.
7. **AI copilot**: assisted placement/routing/review, growing into agentic
   design tools.
