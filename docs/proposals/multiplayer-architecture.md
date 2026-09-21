# The multiplayer architecture we are building toward

**Status: proposed.** 2026-09-02. This describes the target design: what
multiplayer editing has to do, and how it has to be built, in plain terms.
It is not a status report. For what is actually built so far, and the
day to day log of PCB-specific progress, see `pcb-multiplayer-sync.md`.

## What we are building

Several people open the same project at the same time, from different
computers, and each one sees what the others are doing within a second or
two. Nobody's work disappears, and nobody can silently overwrite someone
else's edit without at least a fair chance to avoid it.

That is the whole feature. Everything below is either a requirement that
follows from it, or a decision about how to satisfy that requirement
without pretending the hard parts are easy.

## Why this is genuinely hard

- A schematic or a board file can be large. Sending the whole file every
  time someone moves one part would make the app unusable the moment two
  people are in it together.
- Two people can reach for the same part at the same moment. Something has
  to decide what happens next, and it has to decide it without either
  person quietly losing their work.
- People join late, leave without warning, lose their connection, or put
  their laptop to sleep mid-edit. The system has to keep working, and keep
  making sense, through all of that.
- Editing a circuit board is not like editing a document. Some operations
  (routing a trace around obstacles, filling a copper zone) involve
  geometry calculations that can come out slightly different each time,
  even from the same instructions. That rules out some of the easier
  answers other collaboration tools use, and is explained on its own
  further down.

## The pieces, in plain terms

A working multiplayer session is built from a few distinct jobs. They are
listed separately here because each one can be reasoned about, and tested,
on its own.

- **Presence.** Knowing who else is in the project right now, and being
  told promptly when someone joins or leaves (including leaving by
  accident, such as a crashed tab or a dead connection).
- **The document itself.** Getting the current, correct state of the
  project when you join or reconnect, and then hearing about changes as
  they happen, without re-sending the whole document each time.
- **Awareness.** The lighter signals that make a shared session feel
  alive: where each person's cursor is, what they have selected, what they
  are actively dragging. None of this is part of the saved document, and
  none of it needs to be remembered once someone leaves.
- **Locking.** A soft reservation system: while someone is working on a
  part, everyone else is told not to touch it. This does not replace a
  real conflict rule (below), it just makes the worst kind of conflict
  rare in practice.
- **The transport.** The actual pipe messages travel over between
  computers. This has to be swappable on purpose: a same-computer,
  two-browser-tab connection is enough to build and test almost all of the
  above without needing a server at all, and the real, cross-device
  version is a different transport underneath the exact same design.

## Requirements

These are the properties the finished system has to have. None of them are
negotiable trade-offs to revisit later; each one exists because leaving it
out produces a specific, real failure.

1. **It has to work across different computers, not just different tabs of
   one browser.** A same-browser connection is a convenient way to build
   and test the rest of this list, not the actual product.

2. **Joining or reconnecting has to bring you up to date automatically.**
   Whether you just opened the project or your connection dropped for a
   minute, what you see has to become the real, current document on its
   own. Nobody should have to ask "did I miss anything" or reload to find
   out.

3. **A small edit has to cost about as much network traffic as a small
   edit.** Moving one part should not cost anything close to what saving
   the whole project would cost. This is true for the PCB editor already
   and has to stay true everywhere else.

4. **Losing your connection cannot lose or duplicate work.** You can keep
   editing while offline, and your changes have to be somewhere durable
   even before they reach anyone else, so reconnecting merges you back in
   rather than starting over.

5. **Everyone connected needs a real identity**, not an anonymous label. A
   name and a way to visually tell people apart is the minimum; anything
   less makes "who is doing what" impossible to answer. Half built
   (2026-09-03, PCB and schematic both): a signed-in email announces
   itself in presence when auth is configured, falling back to the old
   short peerId label otherwise. Still missing: a real display name field
   (an email is not always one), an avatar or a per-peer colour: every
   remote cursor is still the same single colour, so "a way to visually
   tell people apart" is only half answered.

6. **Working on something should visibly and effectively stop others from
   grabbing the exact same thing**, while leaving everything unrelated
   untouched. This is what turns "two people can edit at once" into
   something people can actually trust.

7. **Undo has to behave sensibly with other people in the project.**
   Pressing undo should not have a real chance of quietly erasing
   somebody else's edit instead of your own last action. Exactly how this
   should work is still an open question, listed below, but "it can
   currently do the wrong thing" is not an acceptable place to leave it.

8. **It has to fail honestly.** When the system cannot safely describe a
   change as "just this one thing changed," it should fall back to a
   slower method that is still correct, and that fallback should be rare
   enough to notice, not a routine, invisible crutch.

9. **Multiplayer is additive.** The app has to open and edit a project
   perfectly well with nobody else around, and just as well if the
   real-time connection is unavailable or misconfigured. Nothing about
   solo editing should ever depend on the collaboration layer being up.

## Fallbacks

A real system spends most of its life in conditions that are not the
happy path. These are the situations that have to be designed for on
purpose, not discovered by accident later.

- **No network connection at all.** Keep editing locally. Nothing is
  lost. When the connection comes back, catch up and send what changed
  while it was gone, automatically.

- **A change cannot be safely described as a small, targeted update.**
  Fall back to sending the whole document. This should only happen for
  the rare edit that cannot be identified item by item, it should be
  possible to explain to an engineer why it happened, and it should never
  be the normal path.

- **Two people genuinely edit the same thing at the same moment**, despite
  locking. Something has to give, and the rule is: the most recently
  completed edit wins, and the loser's change is not silently thrown away
  forever, it is still sitting in that person's own undo history. This is
  a deliberate choice, not a gap, and the reasoning is below.

- **Someone disappears without saying goodbye:** a crashed tab, a closed
  laptop lid, a dead wifi connection. After a short timeout, stop counting
  them as present, and release anything they had locked. Nobody should
  ever be stuck waiting on a person who is not coming back.

- **The real-time backend itself is down or not configured.** The project
  still opens, still edits, still saves. Collaboration quietly turns
  itself off rather than turning the whole app off with it.

## Why we are not attempting real conflict merging

Some collaboration tools (a shared text document, for instance) can merge
two people's overlapping edits automatically, word by word or even
character by character. We are deliberately not building that here, and
it is worth saying plainly why, since it is the one place this design
looks less ambitious than it could.

A circuit board is not text. Several of the operations that shape one
involve floating-point geometry with no guarantee that doing "the same
operation" again, on a slightly different starting point, produces an
identical result. If we tried to merge by replaying each person's actions
on top of each other's changes, two people's boards could silently drift
apart into two different, both-plausible-looking boards, with neither
person aware anything had gone wrong. That failure is worse than the one
we chose instead.

So the merge happens at the level of whole items instead: a track, a
footprint, a zone, a piece of text. If two people's edits touch different
items, both survive, cleanly, with no special handling needed. If two
edits genuinely touch the same item, the most recent one wins outright.
Locking exists specifically to make that second case rare, by stopping
people from reaching for the same item in the first place, but it is a
guard rail, not the actual conflict rule. The actual rule is simple on
purpose, because a simple rule you can explain in one sentence is safer
than a clever one that can go silently, invisibly wrong.

## Open questions

These do not have answers yet, and are listed here so they are decided on
purpose rather than by accident.

- **What undo should mean with other people around.** Whether pressing
  undo should only ever undo your own most recent action, regardless of
  what anyone else has done since, or whether a single shared history
  (today's approach) is acceptable once there is a locking system to
  reduce how often it matters.
- ~~Who is allowed to do what.~~ Decided and built for PCB (2026-09-03,
  see `pcb-multiplayer-sync.md`): three roles, Owner, Editor, Viewer.
  The first person in a session is Owner by simple self-election, nobody
  assigns it; the Owner can move anyone else between Editor and Viewer. A
  Viewer gets full awareness, exactly the same presence, cursors and
  selections as an Editor, and is refused the instant it tries to commit
  an edit of its own. What is still open: this lives entirely on the
  client, an honor system the same way locking is, because there is no
  server yet to actually refuse a write from a client that ignores its
  own assigned role (see "Cross-device transport" below, and this
  document's requirements 1 and 9). Real enforcement needs both that
  transport and a way to represent "this project, shared with these
  people" at all, which today's local-only project storage does not
  have. Schematic does not have roles wired in yet, only the identity
  half (below).
- **What the real, cross-device transport is built on.** The design above
  does not depend on the answer, by design, but the answer still has to
  be picked before the cross-device version can exist at all.
