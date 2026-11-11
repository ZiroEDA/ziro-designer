# Why TypeScript, and not KiCad compiled to WebAssembly

This question comes up a lot, and it is a fair one. The short answer: both
approaches work. ZiroEDA translates KiCad's own code to TypeScript and compiles
the outside libraries KiCad links to.

## Compiling the real code is possible

[PCBJam](https://github.com/PCBJam/pcbjam) does exactly that: KiCad's C++ built
with Emscripten. If you want KiCad's own code running in a tab, that is the
project to look at. What it takes, from their repository and site as of
12 November 2026:

- KiCad's interface is wxWidgets, and wxWidgets has no official browser port
  (the upstream request, [#18600](https://github.com/wxWidgets/wxWidgets/issues/18600),
  has been open since 2019). PCBJam maintains its own port, derived from
  `ahilss/wxWidgets-wasm`, plus a compatibility layer between KiCad and the browser.
- A full build takes one to two hours in Docker.
- Opening the PCB editor downloads an engine of about 17 MB (62 MB unpacked),
  by their own loading screen.
- The app is served cross-origin isolated, which browsers require before
  WebAssembly may use threads.

None of that is a criticism. It is the price of that route, and they paid it.

## What ZiroEDA does

KiCad's own code is TypeScript, all of it. The heavy outside libraries KiCad
links to are compiled, the same as on the desktop.

## What TypeScript gives you

- **The interface is ordinary web code.** A KiCad class and the dialog that
  calls it are the same language in the same debugger. Encryption, live
  cursors, opening a GitHub repository and sharing by link work on the design
  data directly, with no bridge into a compiled program.
- **It loads in pieces.** Measured on a cold cache on 12 November 2026, the
  Project Manager is 5.8 MB in total, and the PCB editor about 6 MB of
  application. Component libraries come on top in either approach.
- **Building it needs Node and pnpm, no C++ toolchain.** And each file can be
  read next to the C++ file it was ported from, because the tree mirrors KiCad's.

## How it stays faithful to KiCad

A translation has to earn trust, so this is where most of the effort goes.

- **It follows KiCad's releases.** The port tracks the current stable KiCad,
  10.0.6 today, and moves forward when a new release has settled.
- **It is checked against KiCad itself.** The file writers, zone fills and plots are
  compared with the output of KiCad's own `kicad-cli`, inside a suite of
  1,500+ test files.
- **Differences get fixed at the source.** Where C++ and JavaScript behave
  differently (integer coordinates are the usual one), the port is made to
  match KiCad, and a test keeps it matched.

A few dialogs and rarely used tools are still on the way; the
[changelog](./CHANGELOG.md) shows what has landed.

## Where WebAssembly is used

| What | Compiled library | Why |
| --- | --- | --- |
| STEP and IGES models in the 3D viewer | OpenCASCADE (`occt-import-js`) | A geometry kernel nobody should rewrite |
| Embedded files inside KiCad documents | zstd | KiCad links libzstd; so does ZiroEDA |
| Deriving your encryption key | Argon2id (`hash-wasm`) | Slow by design, so it must be fast code |

These are libraries that take bytes in and give bytes out, so nothing is gained
by rewriting them. Everything that touches your design, from drawing a wire to
the design rule check, is the TypeScript port.
