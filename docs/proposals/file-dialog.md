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

## Sequencing

This touches 39 sites across every launcher, so it is not one change:

1. **The widget**, over the existing project store, with open/save/new-folder/
   rename/delete and filtering. Nothing else moves.
2. **The manager's own paths** — open, save-as, import, export — because those
   are the ones with existing behaviour to compare against.
3. **Per launcher, one at a time**, each verified against real KiCad's dialog for
   that call site, as every other parity pass here has been done. Never a sweep:
   39 sites converted in aggregate can only be verified in aggregate, which is
   not verification.

The 15 prompts are the cheapest first win and are independent of the browser
half — a name prompt is a text field and an OK button, and upstream's is a
`wxTextEntryDialog` with a known caption.
