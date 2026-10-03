# eeschema S4: one renderer (SCH_PAINTER on the GAL)

Stage S4 of `docs/eeschema-live-stage0.md`. S1 and S2 are done: the frame owns a live
`SCHEMATIC` (records mirrored into it), and connectivity, ERC and the netlist run on it.
This stage draws that live model the way KiCad does, and deletes the record painter.

## What KiCad has, and what we have

| KiCad 10.0.6 | lines | here |
|---|---|---|
| `sch_render_settings.cpp/.h` | 84 | none live (the record painter takes a theme object) |
| `sch_view.cpp/.h` | 257 | none |
| `sch_draw_panel.cpp/.h` | 224 | `sch_draw_panel.ts`: types only (the canvas is `SchematicCanvas.tsx`) |
| `sch_painter.cpp/.h` | 3769 | `sch_painter.ts`: 4952 lines, Canvas2D over **records**, plus the GL recorder |
| `sch_preview_panel.cpp/.h` | — | none (previews draw through the record painter) |
| `common/view`, `common/gal/opengl`, `PAINTER` | — | **ported**, and pcbnew's `PCB_PAINTER` runs on them |

`SCH_PAINTER::Draw` (sch_painter.cpp:112) dispatches to one `draw()` per type:
LIB_SYMBOL (716), SCH_PIN (909), SCH_JUNCTION (1738), SCH_LINE (1777), SCH_SHAPE (1968),
SCH_TEXT (2188), SCH_TEXTBOX (2440), SCH_TABLE (2603), SCH_SYMBOL (2672), SCH_FIELD (2881),
SCH_GLOBALLABEL (3093), SCH_LABEL (3163), SCH_HIERLABEL (3204), SCH_DIRECTIVE_LABEL (3265),
SCH_SHEET (3336), SCH_NO_CONNECT (3468), SCH_BUS_ENTRY_BASE (3491), SCH_BITMAP (3593),
SCH_MARKER (3649), SCH_GROUP (3677), and the helpers (anchors, dangling indicators,
the local power icon, bounding boxes).

## Steps

Each is one commit, with its tests, mutation-checked.

1. **S4-1** `SCH_RENDER_SETTINGS` (sch_render_settings.cpp) and `SCH_VIEW` (sch_view.cpp):
   layers, `DisplaySheet`/`DisplaySymbol`, `ClearHiddenFlags`, the drawing-sheet item.
2. **S4-2** `SCH_PAINTER` skeleton on `PAINTER` (as `PCB_PAINTER` is): `Draw`, the
   colour and pen-width queries (`getRenderColor`, `getLineWidth`, `getTextThickness`,
   `isUnitAndConversionShown`, `nonCached`), and the simple items first: junction, wire
   and bus line, no-connect, bus entry, marker.
3. **S4-3** text: `SCH_TEXT`, `SCH_FIELD`, the four labels (their shape outlines come
   from the items' own `CreateGraphicShape`), `SCH_TEXTBOX`, `SCH_TABLE`.
4. **S4-4** symbols: `LIB_SYMBOL`, `SCH_PIN` (pin shapes, names, numbers, electrical
   type, the dangling indicator, alternate pins), `SCH_SYMBOL` (units, body styles,
   DNP / exclusion strike-through), the local power icon.
5. **S4-5** `SCH_SHAPE`, `SCH_SHEET` (+ sheet pins), `SCH_BITMAP`, `SCH_GROUP`,
   selection shadows and the brightened/dimmed states.
6. **S4-6** the canvas: `SchematicCanvas.tsx` draws the frame's live `SCHEMATIC`
   through `SCH_VIEW` + `SCH_PAINTER` on the WebGL2 GAL; the grid and cursor are the
   GAL's (the shader settled in `schematic-all-gl-plan`). The symbol editor and the
   previews (`sch_preview_panel`) follow.
7. **S4-7** delete the record painter (`sch_painter.ts` as it is), the GL recorder and
   the three canvases.

## How each step is proven

kicad-cli has no painter output (`sch export svg` goes through `SCH_PLOTTER`, not the
painter), so the oracle is twofold:

- **Draw-call tests against the C++**: a recording GAL (one exists for pcbnew's painter
  tests) captures each `draw()`'s calls — stroke widths, colours from the render
  settings, fill modes, text attributes — and each expectation is read off
  sch_painter.cpp for one item of that kind.
- **Screenshots against real eeschema** for each item kind, at matched zoom, as the
  pcbnew renderer was compared (`kicad-side-by-side-screenshots`): the installed
  eeschema 10.0.6 on the same `.kicad_sch`.

The record painter keeps drawing until S4-6 switches the canvas, so nothing a user
sees changes before the new one matches.
