# One file dialog, over the account's own storage

**Status: proposed.** Akshay's, 2026-08-20. Not started.

## The idea

KiCad never draws a file browser. It asks the OS, via `wxFileDialog`, from **93
call sites** across eeschema, pcbnew, gerbview and common — and every launcher
gets the identical widget for free. Naming, creating, renaming, overwrite
prompts, extension filtering: all of it is one thing the platform supplies.

We have no OS to ask. So the shared thing has to be ours: a real file manager,
built once, over the user's cloud space instead of their disk. Every launcher
opens it, every "pick a file" and "name a file" maps onto it, and users create
and name things exactly as they used to.

## Why this is not a nice-to-have

Measured on `787732ec`:

| | count | what it is |
|---|---|---|
| `window.prompt` | 15 | a browser dialog KiCad never shows — invented UI |
| `<input type="file">` | 24 | opens the user's **real filesystem** |

Both are wrong twice over. The prompts are not `wxFileDialog` and never were.
The file inputs point at local disk, which is the wrong storage now that
projects live in the account — a user "saves" somewhere their project cannot
follow them.

This is the central-value rule applied to a whole interaction rather than a
colour: upstream has one widget, we have 39 improvisations.

## What already exists

`designer/src/home/dialogs/dialog_open_project.tsx` (184 lines) is the seed, and
its header already reasons its way to this conclusion:

> KICAD_MANAGER_ACTIONS::openProject puts up a native wxFileDialog … A browser
> has no directory to point at and no file dialog we can filter, so the
> equivalent question — "which of my projects do you want?" — has to be asked
> about the place the user's projects actually live: their account.

It reads `listProjects()` (IndexedDB, reconciled against the account by
`syncAllProjects`), so it is already account-backed, already offline-capable,
and already instant. It just stops at projects, and only at opening one.

`local_history_store.ts` is the other half of the storage story — content
addressed, `'save' | 'autosave' | 'backup'` snapshots — and is the model for how
bytes should be held.

## What it has to do

Whatever `wxFileDialog` does at those 93 sites, since that is the contract each
call site was ported against:

- open and save modes, with the caller's title and default name;
- **extension filtering** (`*.kicad_pro`, `*.kicad_sch`, `*.gbr`, …) — a wildcard
  string per call site upstream;
- create a folder, rename, delete;
- the **overwrite confirmation**, mirroring wx's own wording rather than ours;
- last-used location per caller, which is what `defaultDir` is for;
- import from and export to the real machine, since a user must be able to get
  files in and out — that is where a native picker still belongs, and the only
  place it does.

## How to verify it

Not by counting call sites. The rule is per-occurrence: **no `window.prompt` and
no `<input type="file">` outside the import/export path**, asserted per file, in
`central_values.test.ts`'s style. An aggregate count cannot catch one launcher
regressing while another improves.

Each converted call site needs its `wxFileDialog` citation kept in the comment,
because the wildcard and the default name are per-site and are the thing most
easily lost in a sweep.

## Two decisions Akshay has taken (2026-08-20)

### 1. Files are first-class; a project is not required

Model it as a real file manager. A file can exist on its own, with no project
association — the same way a directory can hold a loose `.kicad_sch` today.

**This is the part the current store cannot do.** `projectStore.ts` is
project-keyed all the way down: `saveProject`, `loadProject`,
`updateProjectFiles( id, … )`, `deleteProject`, `renameProject`,
`exportProject`, `importProject`. Every file lives *inside* a project row, so
"a file" is not addressable at all. That is the real work in this proposal,
and it is a storage change rather than a dialog change.

Upstream has the same shape without trying: a `wxFileDialog` is over a
filesystem, and a filesystem does not require a project to hold a file.

### 1a. …but under a project folder, and the listing is an allowlist

Refined 2026-08-20. Arbitrary file *types* — not arbitrary *locations*. A file
lives under a project folder, exactly as a `.md` sits beside a `.kicad_pro` in a
real KiCad project directory. And a project can be created from the file
manager itself.

**One correction from the source, and it makes this easier.** KiCad does not
list everything and refuse to open the rest. `project_tree_pane.cpp:266` builds
`m_filters` from `s_allowedExtensionsToList` — **38 regex patterns, with no
catch-all**. A `.docx` in the project directory simply does not appear.

The list does include the ones that matter to this design:

    ^.*\.txt$        ^.*\.md$        ^.*\.pdf$

alongside `.kicad_pro`, `.kicad_sch`, `.kicad_pcb`, `.kicad_sym`, `.kicad_mod`,
`.kicad_wks`, `.kicad_dru`, `.net`, `.cir`, the Gerber families, and the legacy
`.pro` / `.sch` / `.brd` / `.lib`.

So the rule is not "list all, open some". It is **one shared allowlist**, ported
as data — which is the same shape as everything else here: mirror KiCad's table
rather than invent one. `^no KiCad files found` (`:268`) is a sentinel in the
same list, and is what an empty directory shows.

Two things follow:

- Anything not on the list is invisible, so there is no "cannot open this"
  state to design. That removes a whole class of UI.
- Some entries are deliberately narrower than they look: `^[^$].*\.brd$` and
  `^[^$].*\.kicad_pcb$` exclude names beginning `$`, and the comment on
  `.kicad_mod` says "currently not listed" — port the patterns verbatim rather
  than normalising them, and keep the comments.

### 2. The listing is an index; bytes travel on demand

Do not push or pull everything. Sync the **index** — names, sizes, timestamps,
content hashes — and fetch a file's bytes only when the user actually opens or
uses it.

Most of this exists already:

- `cloud/blobStore.ts` is content-addressed: `sha256Hex`, `blobExists`,
  `putBlob`, `getBlob`. Bytes are already stored once per hash.
- `cloud/templateSync.ts` already does index-then-fetch: `readIndex`,
  `mergeIndexes`.
- `projectStore.ts` already tracks what has been uploaded:
  `markSynced( id, pushedHashes )`, `knownPushedHashes( id )`.

What does not: `syncAllProjects` compares metadata (`listSyncMeta` against
`cloudListMeta`, id and `updatedAt`) and then transfers **whole projects** for
any that differ. The index comparison is there; the laziness stops at the
project boundary.

So the change is to move that boundary down to the file: an index row per file,
and `getBlob` on open. A board project is mostly footprints and 3D models that
are never touched in a schematic session — the same property that makes the
Local History store affordable.

**Worth stating plainly:** lazy fetch means opening a file can fail when
offline in a way opening a project does not today. That needs a real answer —
what is cached, what the dialog shows for a file whose bytes are not local, and
what happens on a failed fetch mid-edit — not an afterthought.

## Sequencing

This touches 39 sites across every launcher, so it is not one change:

0. **The storage shape** — files addressable without a project, and an index
   row per file. Decisions 1 and 2 both live here, and the widget cannot be
   honest without it.
1. **The widget**, over that store, with open/save/new-folder/rename/delete and
   filtering. Nothing else moves.
2. **The manager's own paths** — open, save-as, import, export — because those
   are the ones with existing behaviour to compare against.
3. **Per launcher, one at a time**, each verified against real KiCad's dialog for
   that call site, as every other parity pass here has been done. Never a sweep:
   39 sites converted in aggregate can only be verified in aggregate, which is
   not verification.

The 15 prompts are the cheapest first win and are independent of the browser
half — a name prompt is a text field and an OK button, and upstream's is a
`wxTextEntryDialog` with a known caption.
