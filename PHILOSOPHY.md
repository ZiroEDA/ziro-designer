# ZiroEDA: Philosophy & Compatibility Promise

ZiroEDA exists for one reason: the world's largest open-source EDA community
should be able to open a browser tab and be instantly at home. Same UI, same
hotkeys, same files. **Open a tab, not learn a tool.**

This document is our public commitment about how ZiroEDA relates to the
[KiCad](https://www.kicad.org/) project and its community. It is written to be
held against us.

## What ZiroEDA is

- A **browser-native reimplementation of the KiCad workflow** (TypeScript and
  Canvas/WebGL instead of C++ and wxWidgets) that reads and writes KiCad's
  native file formats directly.
- **A complement to KiCad desktop, not a replacement for it.** KiCad remains
  the deep, mature desktop suite. ZiroEDA is the way you open, share, review,
  and edit those same projects from any machine with a browser.
- **GPL-3.0-or-later, like KiCad itself.** The core of ZiroEDA is and will
  remain free software. There is no proprietary fork of the editor waiting in
  the wings.

## What ZiroEDA is not

- **Not a fork of KiCad.** We share no code with KiCad; this is a ground-up
  reimplementation that stays format-compatible (see
  [README: Why a reimplementation](./README.md)).
- **Not affiliated with or endorsed by the KiCad project.** "KiCad" is a
  trademark of its respective owners. We describe ourselves as
  *KiCad-compatible*; we do not use the KiCad name or logo as our brand.
- **Not a walled garden.** Your designs live in `.kicad_sch` / `.kicad_pcb` /
  `.kicad_sym` / `.kicad_mod` files that you own and that open in desktop KiCad
  at any time. Leaving ZiroEDA must never cost you anything.

## The compatibility promise

1. **KiCad desktop is the upstream source of truth for the file formats.**
   We follow the formats KiCad defines. We do not extend them, we do not add
   Ziro-only tokens to them, and we never will.
2. **Anything ZiroEDA needs beyond the format lives in sidecar files**
   (for example a `.ziro/` folder next to the project), never inside
   KiCad-format files. A project touched by ZiroEDA must remain a 100% valid
   KiCad project.
3. **Round-trip fidelity is a release blocker.** A file opened and saved by
   ZiroEDA must load in desktop KiCad with no loss and no surprises. Format
   regressions are treated as our highest-severity bugs.
4. **When we find format ambiguities or undocumented behaviour** while
   reimplementing, we report them upstream (issues, documentation, test
   cases) so both projects benefit.

## Giving back

Being commercially built around KiCad's ecosystem creates an obligation:

- We contribute upstream what a reimplementation uniquely produces: format
  edge cases, documentation of undocumented behaviour, and round-trip test
  corpora.
- As ZiroEDA earns revenue, a share of it goes to KiCad development (via the
  project's official donation channels). Growing the open ecosystem grows us.
- We engage in the open, in KiCad community spaces, as ourselves, before
  anyone has to ask who we are.

## The open-core boundary

The editor, everything needed to open, edit, and save a KiCad project in the
browser, is free and GPL, forever. What we charge for is what a hosted
service uniquely adds on top: cloud compute (simulation, autorouting, batch
DRC), real-time team collaboration, and AI assistance. If a feature's absence
would lock your data or break the local workflow, it belongs in the free core.
