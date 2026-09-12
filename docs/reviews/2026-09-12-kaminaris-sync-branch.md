# Review: kaminaris/ziro-designer `sync` @ 8dbd0736

Reviewed against `origin/main` @ `2a53e6ca` (2026-09-12). Fork point `47d4c0c6`;
main has moved 26 commits (81k lines) since. The branch is 27 commits and is
really two pull requests sharing a name.

## Short version

- **Commits `95de3ec9..8dbd0736` (12 commits, 706 lines: the ten cloud-sync
  bugs from Discord) - please open this as its own PR first.** It cherry-picks
  onto today's main with zero conflicts, `biome ci` is clean, `tsc -p designer`
  is clean, and the five test files it touches pass 78/78 against current main.
  The commit messages are exactly what we want: symptom, cause, why no test
  caught it. Nothing to change; I would merge it as-is.
- **Commits `ff101194..a49bf00e` (15 commits, ~7k lines: the multiplayer arc)
  - a second PR, after the items below.** The architecture is right and the
  transport seam is clean. There are two concrete bugs, one security gap, and
  one design disagreement to settle before it lands.

## The multiplayer arc - what is good

- `ProjectSyncTransport` is the right seam. `createProjectSyncTransport` picks
  BroadcastChannel vs Supabase Realtime by the three facts that actually decide
  it (configured, signed in, has a `uid`) and nothing above it knows which.
- Diffing the *result* (`pcb_diff.ts`, `sch_diff.ts`) instead of replaying
  operations is the correct call for this codebase and the header comment says
  why. `UNSAFE` → whole-text fallback is honest.
- Everything that crosses the server is sealed under the project key
  (`sync_crypto.ts`), presence included; a keyless connection sends nothing
  rather than falling back to cleartext. That is the property the E2E work
  exists for and you kept it.
- The Supabase transport orders inbound/outbound on promise chains so async
  seal/open cannot reorder patches. Good catch; that one is easy to miss.

## Must fix before the multiplayer PR

### 1. `Board.nets` is a `Map` and does not survive the Supabase transport

`pcb_diff.ts` puts `nets` in `patch.meta`. `Board.nets` is `Map<number,
string>` (`pcbnew/src/types.ts`). BroadcastChannel structured-clones it, so
cross-tab works; `sync_crypto.ts:93` does `JSON.stringify` → `{}`. The receiver
runs `{ ...board, ...patch.meta }` and now has `nets = {}`; its next
`board.nets.get(...)` throws. Any edit that touches nets (Update PCB from
Schematic, a new net from routing) breaks every cross-device peer.

Fix: serialise `meta` explicitly (`[...nets]` on the wire, `new Map()` on
receive), and add a test that round-trips a patch through `sealPayload` /
`openPayload` - the existing tests only exercise the structured-clone path,
which is why this passed.

### 2. A peer's edit lands in my undo stack

`commitBoard` (PcbEditor.tsx) still does `undoRef.current.push(prev);
redoRef.current = []` when `applyingRemoteRef` is set; the schematic side does
the same by design ("a bad remote update is a Ctrl+Z away"). Consequences:

- My Ctrl+Z after your move undoes *your* move on my copy - and because that
  is a local commit, `diffBoard` broadcasts it back and reverts your work.
- Every remote patch wipes my redo stack.

Your own requirement 7 is "undo has to behave sensibly with other people in
the project." The sensible rule, and the one every shared editor uses, is:
undo is over *my* operations only. A remote apply must not push history, must
not clear redo, and the entries already on the stack need to be rebased over
the remote change (or, simpler and defensible for v1: an entry whose items
were since touched by a peer is dropped, with the same "someone else edited
this" toast the lock already shows).

Also `setDirty(true)` on a remote apply: every peer now autosaves the same
content and pushes it to the cloud, which is N peers racing the version CAS
for one change. Worth a deliberate decision - probably only the author of an
edit pushes it.

### 3. The Realtime channel is public

`supabase.channel('project:<uid>', { config: { presence, broadcast } })` -
no `private: true`, and no migration adds policies on `realtime.messages`.
So anyone holding the anon key who learns a project `uid` (it is in every
share URL, `/p/<uid>/…`) can subscribe, see the `userId` of everyone present
in the clear, and replay captured ciphertexts (`from` is outside the AEAD, so
a replayed message can claim any sender). They cannot read or forge content -
the key protects that - but the roster leak and the replay are real.

Fix: `config: { private: true }` plus RLS on `realtime.messages` that checks
`project_members` - Supabase calls this Realtime Authorization and it is the
server-side enforcement your `role-assign` comment says is out of scope; here
it is in scope, and it is one policy. Bind `from` into the AEAD's additional
data (or inside the sealed body) so a replay cannot be re-attributed.

### 4. Rebase artefacts (yours to clear, but they will fail CI)

On the branch tip against its own tree:

- `central_values`: `editors/schematic` 32 vs 31 - main since lowered this
  to 30 (the BULLSEYE SVG is gone: `8fa21c12`, `84db8d8b`). Rebase and the
  row resolves itself.
- `ui_font_tokens`: `ui` 66 vs 65 - `shell.css` gains a `font-size: 12px`
  for the presence badge. Consume `var(--ui-font-size)` or the small-font
  token; a chrome literal is the one thing that file's header forbids.
- `reload_keeps_edits`: `App.tsx` no longer renders `<>{manager}` - the
  manager must stay *beside* the frames, never replace them (the test says
  why: frames persist across a manager open).
- `drawing_sheet_palette` D7 - `.ze-wks .ze-toolbar.horizontal` gained a
  `font-size`; same rule as above.
- One `tsc -p designer` error at `dialog_import_gfx.tsx:127` - a main-side
  type moved under you (`GRAPHICS_IMPORTER_SCH`), rebase clears it.

The `plot_*`, `pad`, `field_face` failures I saw are my worktree's module
resolution, not your code - ignore if they do not reproduce after
`pnpm install`.

## Should fix, not blocking

- `PcbEditor.tsx` +1069 lines. It is already 11k lines on main; the sync
  state (~20 refs) and the three `useEffect`s would read better as one
  `PcbSyncController` module the editor instantiates - the shape KiCad's
  `TOOL_BASE` subclasses have, and the shape our other editor subsystems are
  moving toward. Same for the 325 lines in `SchematicEditor.tsx`.
- `diffBoard` covers 12 collections; `Board` has 14 (`points` and `barcodes`
  are missing, and both exist at your fork point). Make the list derive from one
  place so the next addition cannot be forgotten silently - a test that
  asserts `Object.keys(diffBoard(a,b))` covers every array-valued key of
  `Board` would do.
- A footprint upsert ships its whole `source` SList as JSON. That is
  correct but ~10× the s-expression text. Fine for v1; note it in the
  proposal's "open questions" so it is not rediscovered.
- `MAX_PENDING = 200` drops the *oldest* queued patch when the key is slow.
  A dropped `board-patch` is a peer permanently behind (your comment says
  so). Prefer: drop cursors/live-move deltas first, never drop a patch.

## Answers to the Discord thread

- **URL routing**: `/p/<uid>/<editor>` (with `?f=` per frame) has been on
  main since Sep 6 and is in your fork point (`47d4c0c6`, Sep 11). If the
  address still does not change for you after the rebase, that is a bug we
  want: say which page you were on and what the bar showed.
- **Theme**: chrome is dark-only by decision; that will not change. What
  exists is canvas colour themes - the seven stock KiCad schemes are on main
  (`2b9177e0`) under Preferences ▸ Colors. If light *chrome* is what you
  need to work, that is a personal branch, not something we would merge.
- **Aw, Snap on a ~200-file project from the project page**: your fix arc
  covers the cause (tooling dirs + unbounded fan-out). The separate
  in-editor memory issue (symbol preload, 1.5 GB → 0.65 GB) landed as
  `bbb0d4f6`, also after your fork.
- **Rule area's last segment not rendered**: not part of your branch; I have
  not reproduced it yet - a board that shows it would help.

## The two you left open

Both deserve their own issue on the main repo; neither should hold up PR 1.

1. Orphaned encrypted blobs are never collected. Needs a GC keyed off
   committed manifests (everything not referenced by any version of any
   project is collectable), run server-side.
2. Push vs `restoreFromHistory` can loop. Needs one owner for "who resolves
   a stale row": a refused CAS should never trigger a repair that bumps the
   version; repair only on a row that fails to *decrypt*, and then with the
   version it read, not a new one.
