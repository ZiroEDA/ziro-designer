# Third-party notices

Ziro Designer is a browser-native reimplementation of the KiCad workflow, and it
reuses a substantial amount of KiCad's own work. This file records what came
from where, and under which terms.

Ziro Designer is distributed under the GNU General Public License, version 3 or
later (see [LICENSE](./LICENSE)). Every licence below is compatible with that,
so the combined work is governed by the GPL. Attribution, however, is required
independently of compatibility, which is what this file provides.

ZiroEDA is not affiliated with or endorsed by the KiCad project. "KiCad" is a
trademark of its respective owners.

## KiCad source code

Copyright The KiCad Developers. See `AUTHORS.txt` in the KiCad source
distribution for the list of contributors.

Licensed under the GNU General Public License, version 3 or later.

- Source: https://gitlab.com/kicad/code/kicad
- Licence: https://www.kicad.org/about/licenses/

Large parts of `common/`, `eeschema/`, `pcbnew/`, `gerbview/`,
`pcb_calculator/` and `libs/` are ports of KiCad's C++ implementation into
TypeScript. They follow KiCad's source layout, algorithms and file formats
closely, and individual files name the upstream file they were ported from.
These are derived works of KiCad and are licensed under the GPL accordingly.

## KiCad icons

Copyright The KiCad Developers. Licensed under the GNU General Public License,
version 3 or later.

The toolbar and menu icons in `designer/src/assets/` are taken from KiCad's
`resources/bitmaps_png/sources/`. Most are reproduced unmodified.

## KiCad symbol, footprint and 3D model libraries

Copyright the KiCad Libraries Team and contributors.

Licensed under the Creative Commons Attribution-ShareAlike 4.0 International
licence, **with the KiCad library exception**. The exception is important for
users of this application: it means that using these symbols and footprints in
a design does not place the resulting design under the share-alike terms.

- Source: https://gitlab.com/kicad/libraries
- Licence and exception: https://www.kicad.org/libraries/license/

This applies to:

- the symbol libraries bundled in `designer/src/pcm/defaultRepo.ts`, which are
  reproduced verbatim from KiCad's official libraries;
- the symbol, footprint and 3D model libraries the application downloads at
  runtime from ZiroEDA's library host.

ZiroEDA packages and hosts this content. It did not author it.

## rectpack2d

Copyright (c) 2017 Patryk Czachurski and contributors. Licensed under the MIT
licence.

`libs/rectpack2d/` is a TypeScript port of the header-only C++ library that
KiCad vendors in `thirdparty/rectpack2d/`.

- Source: https://github.com/TeamHypersomnia/rectpack2D

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Runtime dependencies

The npm packages listed in each `package.json` carry their own licences. Run
`pnpm licenses list` to enumerate them for a given install.
