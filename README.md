# ZiroEDA

**KiCad-compatible electronics design in a browser tab. Nothing to install.**

**[Open the editor →](https://designer.ziroeda.com)** ·
**[Try a demo project, no sign-up →](https://designer.ziroeda.com/demo/ecc83)** ·
**[What's new (changelog) →](./CHANGELOG.md)** ·
**[Join the Discord →](https://www.ziroeda.com/discord)**

<a href="https://www.ziroeda.com/designer#video"><img src="docs/public/screenshots/intro-video.jpg" alt="Watch the one-minute introduction to ZiroEDA Designer" width="100%"></a>

ZiroEDA is an open-source, browser-native port of KiCad 10: the schematic
editor, the PCB editor, and the tools around them, running in any modern
browser. It reads and writes KiCad's native files directly, so a `.kicad_pro`
made on the desktop opens here with no import step, and a project saved here
opens back in KiCad unchanged.

ZiroEDA **extends the KiCad ecosystem; it does not replace KiCad.** For very
large, heavy designs, desktop KiCad is the right tool. ZiroEDA is for
everything around it: small and medium projects, working from any machine,
reviewing a board without installing anything, and sharing a project by link.
Your projects live in the cloud **end-to-end encrypted**, so not even we can
read them, and they stay ordinary KiCad files you can take back to the desktop
at any time.

> ZiroEDA is an independent project. It is **not** affiliated with or endorsed
> by the KiCad project; "KiCad" is a trademark of its respective owners. See
> [PHILOSOPHY.md](./PHILOSOPHY.md) for how we relate to it.

## Who it is for

- **Students and labs.** College lab PCs and Chromebooks where you cannot
  install software. Open a tab and design.
- **Teams and reviewers.** Send a link instead of a zip; the other side opens
  the real project, not a screenshot.
- **KiCad users away from their desk.** Open, check and edit the same
  projects from any machine, then carry on in desktop KiCad.
- **Anyone browsing open hardware.** Open any public KiCad project on GitHub
  straight from its address.

## What works today

| | |
|---|---|
| **Schematic editor** | KiCad's eeschema: symbols, wires, buses, labels, hierarchical sheets, annotation, ERC, symbol fields table, plot and print |
| **PCB editor** | KiCad's pcbnew: footprints, interactive router, zones with KiCad's own fill algorithm, DRC, board setup, 3D viewer, plotting and fabrication outputs |
| **Library editors** | Symbol editor, footprint editor, Assign Footprints (CvPcb) |
| **Other KiCad tools** | Gerber viewer, PCB calculator, image converter, drawing sheet editor |
| **Libraries** | KiCad's official symbol, footprint and 3D model libraries, served from the cloud |
| **Cloud projects** | End-to-end encrypted; open them from any device; share with collaborators by invite or link; export as ordinary KiCad files at any time |
| **Open from GitHub** | Any public repository's KiCad project opens read-only at `designer.ziroeda.com/gh/<owner>/<repo>`, with "Save a copy" to make it yours |

The port is ongoing and some dialogs and rarely used tools are not there yet.
If something you rely on is missing, [open an issue](https://github.com/ZiroEDA/ziro-designer/issues).

### Add an "Open in ZiroEDA" badge to your KiCad repository

Let visitors open your public KiCad project in their browser with one click.
Paste this into your README, with your own owner and repository name:

```markdown
[![Open in ZiroEDA](https://img.shields.io/badge/Open%20in-ZiroEDA-2f6feb)](https://designer.ziroeda.com/gh/OWNER/REPO)
```

## Screenshots

| | |
|---|---|
| ![The PCB editor with a four-layer ESP32 board](docs/public/screenshots/pcb.jpg) | ![The schematic editor with the CM5 Minima carrier board](docs/public/screenshots/schematic.jpg) |
| The PCB editor ([open this board](https://designer.ziroeda.com/demo/openair-max)) | The schematic editor ([open it](https://designer.ziroeda.com/demo/cm5_minima)) |
| ![The 3D viewer](docs/public/screenshots/3d.jpg) | ![A GitHub project opened from its address](docs/public/screenshots/github.jpg) |
| The 3D viewer | [Cynthion](https://designer.ziroeda.com/gh/greatscottgadgets/cynthion-hardware), opened from its GitHub address |

## Your designs stay yours: end-to-end encryption

Cloud projects are encrypted **in your browser, before upload**, with a key the
server never sees. What we store is ciphertext; there is no master key on our
side that opens it.

- Every project has its own random key. Board files, schematics, file names and
  the project's metadata are all encrypted with it (AES-256-GCM).
- The project key is wrapped under your account key. Your account key is
  wrapped twice: once by a key derived from your password (Argon2id), once by a
  **recovery key** shown to you once at sign-up. Your password itself never
  reaches the server.
- Sharing a project seals only its key to the collaborator's public key
  (ECDH P-256), so sharing never re-encrypts or exposes the boards.
- Live collaboration traffic (edits, cursors, selections) travels under the
  same project key.
- All of it uses the browser's built-in Web Crypto, so the whole scheme is in
  this repository for anyone to audit.

The trade-off is real: lose both your password and your recovery key and your
encrypted projects cannot be recovered by anyone, including us.
Plain-language details: [docs/security.md](./docs/security.md). Design and
reasoning: [docs/encryption-design.md](./docs/encryption-design.md).

## How it is built

ZiroEDA is a **TypeScript port of KiCad's C++ source**, mirrored file for file
(`eeschema/`, `pcbnew/`, `common/`, `libs/` …) against the KiCad 10.0.6 tag, so
behaviour can be checked against the original line by line. KiCad's own
`kicad-cli` is used as a test oracle: our file writers, zone fills and plots are
compared against what KiCad itself produces.

**Why a translation, and not KiCad compiled to WebAssembly?** KiCad's own code
is TypeScript here, all of it, so the app loads in pieces and behaves like any
web page, and encryption, sharing and collaboration work on the design
directly. The heavy outside libraries KiCad links to (OpenCASCADE for STEP
models, zstd) are compiled to WebAssembly, as is Argon2 for encryption keys.
The port follows KiCad's stable releases and is checked against KiCad's own
`kicad-cli`. Compiling all of KiCad is possible too, and
[PCBJam](https://github.com/PCBJam/pcbjam) does that.
The full reasoning, with numbers, is in **[WHY-TYPESCRIPT.md](./WHY-TYPESCRIPT.md)**.

| Concern | Choice |
| --- | --- |
| Language | TypeScript |
| UI | React, with KiCad's wxWidgets dialogs rebuilt to the same layout |
| 2D rendering | WebGL, with KiCad's own stroke and outline fonts |
| 3D viewer | three.js |
| WebAssembly | OpenCASCADE for STEP/IGES, zstd, Argon2id |
| Auth, cloud, realtime | Supabase |
| Crash reporting | Sentry (opt-out, scrubbed) |
| Build / monorepo | Vite + pnpm workspaces |
| Tests | Vitest (1,500+ test files), mutation-tested |

```
ziro-designer/
  designer/          # the app: launcher, editor frames, cloud sync, encryption
  eeschema/          # schematic engine (port of KiCad's eeschema/)
  pcbnew/            # board engine (port of KiCad's pcbnew/)
  common/            # shared KiCad classes: shapes, text, units, plotters, widgets
  libs/              # kimath, core, sexpr (lossless S-expression parser)
  gerbview/ cvpcb/ pcb_calculator/ pagelayout_editor/ bitmap2component/
  qa/                # unit tests (qa/unittests/<module>) + fixtures
```

See **[STRUCTURE.md](./STRUCTURE.md)** for the full map and conventions.

## Run it locally

```bash
pnpm install
pnpm -C designer dev      # http://localhost:5173
pnpm -C designer build    # typecheck + production build
pnpm -r test              # all unit tests
pnpm -r typecheck
```

For development, a clone starts with no configuration. Accounts, cloud
projects and sharing need a Supabase project; every integration is env-gated
and simply switches off when its variables are absent.

| Variable | Effect when unset |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Accounts, cloud sync and sharing disabled |
| `VITE_SUPABASE_STORAGE_BUCKET` | Cloud file storage disabled |
| `VITE_SENTRY_DSN` | Crash reporting disabled |
| `VITE_RELEASE` | Falls back to the build's git SHA |
| `SENTRY_ORG`, `SENTRY_PROJECT` | Source maps not uploaded (set in `vercel.json`) |
| `SENTRY_AUTH_TOKEN` | Source maps not uploaded (secret, dashboard only) |
| `SENTRY_URL` | Defaults to `https://de.sentry.io/` |

To self-host the cloud side, apply the migrations in `supabase/migrations/` to
your own Supabase project.

### Cloud sync design

- **Content-addressed, encrypted blobs.** Each file is stored under the hash of
  its plaintext as `iv‖ciphertext`, so an upload only ever adds, a download is
  verified after decryption, and earlier versions stay restorable.
- **Commit last.** Every blob is stored and confirmed present before the
  project row that references it is written, so a failed push changes nothing.
- **Compare-and-swap on the version.** Two devices cannot silently overwrite
  each other's work.
- **One transport interface** (`designer/src/cloud/backend.ts`); only
  `supabaseBackend.ts` touches Supabase, so the sync logic is fully testable.

### Crash reporting

Opt-out (Preferences → Common → Privacy). Reports are scrubbed in
`designer/src/telemetry/scrub.ts`: file names and URL query strings are
removed, and no account or IP address is attached. Tracing, session replay and
profiling are off: this collects stack traces to fix bugs, not usage
analytics. Source maps are uploaded to Sentry and never deployed.

## License

GPL-3.0-or-later, the same as KiCad. See [LICENSE](./LICENSE).

Much of the engine is a TypeScript port of KiCad's C++, the icons are KiCad's,
and the symbol, footprint and 3D model libraries are KiCad's official
libraries. Code and icons are GPL; the libraries are CC-BY-SA 4.0 with the
KiCad library exception. Full attribution: [NOTICE.md](./NOTICE.md).

## Contact

Questions, bugs or collaboration: [open an issue](https://github.com/ZiroEDA/ziro-designer/issues),
chat with us on [Discord](https://www.ziroeda.com/discord), or write to **admin@ziroeda.com**.
