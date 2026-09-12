# pcbnew live `BOARD` - stage 0: the class tree audited, the consumers counted, the storage decided

Issue #636, stage 0. Reference: `/home/akshay/kicad-reference` (10.0.5).
Everything below is what stage 1 (`BOARD_ITEM` hierarchy) builds on.

## 1. What the half-built tree is

Ten files, 1179 lines, in `pcbnew/src/`: `board_item.ts` (52),
`board_connected_item.ts` (28), `board.ts` (106), `footprint.ts` (194),
`pad.ts` (174), `pcb_shape.ts` (77), `pcb_text.ts` (83), `pcb_field.ts` (45),
`zone.ts` (133), `pcb_track.ts` (287). Written 2026-07-13 (`c44a90fc`), two
months before the K model (#635); touched since only by repo-wide sweeps.

**Nothing in production imports it.** The only consumers are its own seven
tests (`qa/unittests/pcbnew/{board,footprint,pad,pcb_shape,pcb_text,pcb_track,zone}.test.ts`,
526 lines) and one free function, `validateViaParameters` in `pcb_track.ts`,
used by `dialog_board_setup.tsx` and `dialog_track_via_size.tsx`. Retiring or
rewriting any class breaks no caller.

## 2. Line-by-line against the C++

Legend: ✓ transcribed and equal · ≈ equal only in the case the caller exercises
· ✗ diverges · ∅ invented (no such method in KiCad) · - missing.

### `BOARD_ITEM` (`include/board_item.h`)
| | |
|---|---|
| `m_layer`, `GetLayer/SetLayer/IsOnLayer` | ✓ |
| base class `EDA_ITEM` (`m_Uuid`, `Type()`, `m_parent`, `m_flags`, `IsSelected`…) | - |
| `m_isKnockout`, `m_isLocked` | - |
| `GetLayerSet()` default `LSET({m_layer})`, `SetLayerSet`, `GetBoard`, `GetParentFootprint`, `GetFPRelativePosition/Orientation`, `IsSideSpecific`, `GetEffectiveShape`, `GetBoundingBox`, `Duplicate`, `RunOnChildren`, `Similarity`, `operator==` | - |
| `Move/Rotate/Flip/Mirror` abstract | ✓ (the C++ defaults are message boxes; abstract is the honest port) |
| **`PCB_LAYER_ID` is a `string`** (`'F.Cu'`) | ✗ structural, see §3 |

### `BOARD_CONNECTED_ITEM` (`pcbnew/board_connected_item.h`)
`m_netCode: number` stands in for `NETINFO_ITEM* m_netinfo`; no netclass,
local clearance, teardrop parameters, `GetNetname`, `SetNet`. - for all of it.

### `FOOTPRINT` (`pcbnew/footprint.cpp`)
| | |
|---|---|
| `SetPosition` (:3004) - delta to anchor and every child | ✓ (fields via `Move` = `EDA_TEXT::Offset`, same thing) |
| `SetOrientation` (:3101) - `Normalize180`, rotate children about the anchor | ✓ (the extra `.Normalized()` is a no-op) |
| `Move` (:2890) | ✓ |
| `Rotate` (:2900) | ✗ omits `field->KeepUpright()` and `PCB_TEXT::KeepUpright()` on text drawings |
| `Flip` (:2932) - mirror Y, flip layer, `m_orient = 0`, flip children, restore, `LEFT_RIGHT` → `Rotate(180)` | ≈ child order differs: C++ flips fields+pads with `m_orient = 0`, restores it, THEN zones, drawings, points. Equal today only because no child `Flip` reads the parent's orientation except `PAD::Flip` (via `GetFPRelativeOrientation`), which is in the zeroed group in both |
| `Flip` - `m_points`, courtyard cache swap, `BOARD::FlipLayer` (copper-count aware) | - |
| `Mirror` | ∅ - `FOOTPRINT` has no `Mirror`; the C++ falls to `BOARD_ITEM::Mirror` (a "should not occur" box). Ours calls `Flip` |
| `GetBoundingBox` (:1770) - `BOX2I(m_pos)` inflated 0.25 mm, per-item `GetBoundingBox()`, text/field visibility rules, private layers | ✗ a from-scratch min/max over pad radii, shape endpoints and text ANCHORS |
| `HitTest` (:2349) = `GetBoundingBox(false)` (text excluded) inflated | ✗ ours includes field and text anchors |
| `m_points`, `m_groups`, `m_3D_Drawings`, `m_attributes`, `m_fpStatus`, library/path/sheet strings, `m_privateLayers`, `m_netTiePadGroups`, jumper groups, variants, embedded files | - (all present in `KFootprint`) |

### `PAD` (`pcbnew/pad.cpp`)
| | |
|---|---|
| `m_pos`, `Move`, `Rotate` (:2155, rotates `m_pos` and adds to the padstack orientation) | ✓ |
| `Flip` (:1476) - `SetFPRelativeOrientation(-GetFPRelativeOrientation())` | ≈ ours negates the ABSOLUTE orientation; equal only inside `FOOTPRINT::Flip` where the parent's `m_orient` is 0 |
| `Flip` - per-layer mirror of `Offset` and `TrapezoidDeltaSize`, chamfer-corner bit swap, `PADSTACK::FlipLayers`, `FlipPrimitives` | - |
| `Mirror` | ∅ - `PAD` has no `Mirror` |
| `HitTest` (:2037) - bounding-radius reject then `GetEffectivePolygon(ERROR_INSIDE)->Contains` per unique layer, OR the hole shape | ✗ analytic circle/oval/roundrect, bounding box for everything else, no hole |
| `GetBoundingRadius` = `m_effectiveBoundingRadius` from `BuildEffectivePolygon` | ✗ half-diagonal of size |
| `PADSTACK` (`padstack.h`: per-layer shape/size/offset/delta/radius/chamfer/primitives, drill, modes, thermal, clearance overrides) | - (all present in `KPadstack`; `padstack.ts` is 71 lines of parser defaults, not the class) |

### `PCB_SHAPE` (`pcbnew/pcb_shape.cpp`)
| | |
|---|---|
| `Move/Rotate/Mirror` → `EDA_SHAPE::move/rotate/flip`; `Flip` adds `FlipLayer` | ✓ |
| `GetPosition` = `EDA_SHAPE::getPosition()`: ARC → centre, POLY → vertex 0, else `m_start` | ✗ ours returns `GetStart()` for every shape |
| `HitTest` → `EDA_SHAPE::hitTest` | ✓ in structure; `common/src/eda_shape.ts` is a 279-line partial of a ~2500-line class (no `SHAPE_POLY_SET` poly, no hatch fill, rounded-rect edge collide simplified) |
| `m_stroke` (`STROKE_PARAMS`), fill mode, `m_netCode`/connected shapes (in KiCad `PCB_SHAPE` is a `BOARD_CONNECTED_ITEM`), `m_hasSolderMask`, `m_solderMaskMargin`, `m_hatchingDirty` | - |

### `PCB_TEXT` (`pcbnew/pcb_text.cpp`)
| | |
|---|---|
| `Move` (h:101), `Rotate` (:445), `Mirror` (:457) | ✓ |
| `Flip` (:478) | ✗ toggles `SetMirrored` unconditionally; the C++ does it only `if( IsSideSpecific() )` |
| `KeepUpright`, `m_keepUpright` | - |
| `HitTest` → `TextHitTest` | ✓ in structure; `common/src/eda_text.ts` (114 lines) approximates the glyph box as `len × size × 0.6` - not `GetEffectiveTextShape()`/`GetTextBox()` |

### `PCB_FIELD` (`pcbnew/pcb_field.h`)
`m_id`, `m_name`, `IsReference/IsValue` ✓; `FIELD_T` enum renumbered
(`REFERENCE=0, VALUE=1, DATASHEET=2, FOOTPRINT_FIELD=3, DESCRIPTION=4` - in
10.0.5 `FIELD_T` is `USER, REFERENCE, VALUE, FOOTPRINT, DATASHEET, DESCRIPTION,
…`; the numbers are not the file's, so nothing depends on them yet).
`IsDatasheet`, `IsMandatory`, `GetCanonicalName` -.

### `ZONE` (`pcbnew/zone.cpp`)
| | |
|---|---|
| `Move` (:1058), `Rotate` (:1120), `Mirror` (:1163) on outline + fills | ✓ in effect (C++ works on `SHAPE_POLY_SET`s and re-hatches the border) |
| `Flip` (:1131) - `Mirror`, then flipped `LSET`, `m_layerProperties` and fills re-keyed | ≈ layer properties not carried |
| `SetPosition` | ∅ - the C++ is `{}` (a no-op); ours moves the zone |
| `HitTest` (:765) - 0.1 mm floor, corner ×2, edge | ✓ |
| `HitTestForCorner/Edge` → `SHAPE_POLY_SET::CollideVertex/CollideEdge` | ≈ single ring, no holes, no other outlines |
| `HitTestFilledArea` (:882) - `aAccuracy`; rule areas test the OUTLINE | ✗ no accuracy, no rule-area case |
| `m_Poly` as `SHAPE_POLY_SET`, `m_FilledPolysList`, `m_isRuleArea` + keepouts, priority, fill settings, `m_borderHatchLines`, `m_layerProperties`, teardrop type, placement source | - (all present in `KZone`) |

### `PCB_TRACK` / `PCB_ARC` / `PCB_VIA` (`pcbnew/pcb_track.cpp`)
| | |
|---|---|
| `PCB_TRACK::Move/Rotate/Mirror/Flip`, `HitTest` (:2496, `aAccuracy + width/2`) | ✓ |
| `PCB_ARC::Rotate/Mirror`, `HitTest` (:2502), `GetArcAngleStart` | ✓ |
| `PCB_ARC::GetAngle` - `Normalize180()` per half-sweep | ✗ **was `Normalize()`; a CW arc reported 540° and hit its whole circle. Fixed and pinned in `1d03e46e`** |
| `PCB_ARC::GetPosition` = `CalcArcCenter(VECTOR2I…)` (double centre, clamped, `KiROUND`) | ≈ own circumcentre with `Math.round`; the int overload of `CalcArcCenter` is not in `kimath/trigo.ts` (the double one is) |
| `PCB_ARC::GetRadius` = `min(dist, INT_MAX/2)` | ≈ no clamp |
| `PCB_VIA::HitTest` - per unique padstack layer, `GetWidth(aLayer)` | ≈ single width |
| `PCB_VIA::Flip` - `LayerPair`/`SetLayerPair` through `BOARD::FlipLayer` | ✓ in effect |
| `PCB_VIA` `m_padStack` (per-layer size, drill, `m_isFree`, tenting/covering/plugging/capping/filling), `m_viaType` enum values | - (`VIATYPE` numbers match `pcb_track.h`) |
| `validateViaParameters` (:1769) | ✓, and it stays - it is the one thing the dialogs import |

### `BOARD` (`pcbnew/board.h`)
Four `deque`s with `Add/Remove/AllItems`, a `Map<number,string>` for nets, a
row array for layers. Against the C++: no `m_markers`, `m_groups`,
`m_generators`, `m_points`, `NETINFO_LIST` (`netinfo.ts` is helpers over the
plain `Board`), `BOARD_DESIGN_SETTINGS`, `m_layers[]` as `LAYER` structs with
`GetLayerName/GetLayerType/GetLayerID/SetLayerName`, enabled/visible sets,
`FlipLayer` that knows the copper count, `m_paper`/`m_titles`, properties,
embedded files, `m_timeStamp`, listeners, `m_ZoneBBoxCache`, connectivity.
`Add` does not `SetParent`, and does not `NETINFO_LIST::Add` an unknown net.

### Verdict

The transform bodies of `PCB_TRACK`, `PCB_ARC`, `PCB_TEXT`, `PCB_SHAPE`,
`FOOTPRINT::SetPosition/SetOrientation/Move`, and `ZONE::HitTest` are
transcriptions and can be kept verbatim. Everything else is either a
placeholder standing where a `PADSTACK`, `SHAPE_POLY_SET`, `EDA_ITEM` or
`BOX2I` should be, or an invention (`FOOTPRINT::Mirror`, `PAD::Mirror`,
`ZONE::SetPosition`). Two of the seven tests could not have failed on a
wrong sign (`pcb_track.test.ts` pinned one CCW quarter arc only; the CW
case is what exposed `GetAngle`).

## 3. Two structural mismatches the tree sits on

1. **Layer ids.** `layer_ids.ts` exports KiCad's `enum PCB_LAYER_ID` verbatim
   as numbers (`F_Cu = 0`, `B_Cu = 2`, `In1_Cu = 4`…) AND `type PCB_LAYER_ID =
   string`. The K model, `LSET`, the parser and the formatter are on the
   numbers; the class tree and the plain-object `Board` are on the names.
   `BOARD::GetLayerID/GetLayerName` is the only place KiCad converts. The
   classes go on the numbers; the string type is renamed out of the way in
   stage 1 (`PCB_LAYER_NAME` for the few places a canonical name is data).
2. **Frame.** `KFootprint` children carry the FILE frame: `at` is
   footprint-relative through `fpRoundTrip` (the parse-then-format
   `RotatePoint` rounding), angles are board-absolute as written. The class
   tree, like KiCad, keeps children board-absolute. See §5.

## 4. Consumers of the plain-object `Board` (what stages 2 to 6 retire)

| where | files | how counted |
|---|---|---|
| `pcbnew/src` modules importing `Board` from `types.ts` | 58 | `import … Board … from './types.js'` (the issue's "32" was a smaller grep) |
| `pcbnew/src` modules importing any `Pcb*` item type from `types.ts` | 90 | |
| `designer/src` importing `Board` from `@ziroeda/pcbnew` | 13 | `Appearance3DPanel`, `board_3d_layers`, `boardOutline`, `component3d`, `dialog_print_pcb`, `pcb3d`, `PcbPropertiesPanel`, `pick3d`, `PcbColorPreview`, `preload`, `Viewer3DFrame`, `footprint_preview_3d`, `back_annotate_source` |
| `designer/src` importing any `Pcb*` item type | 23 | |
| `designer/src` importing anything from `@ziroeda/pcbnew` | 67 | |
| `qa` files importing `Board` from `@ziroeda/pcbnew` | 125 | fixtures and tests |
| `qa` files naming `Board` or a `Pcb*` type | 239 | |
| importers of `board_view.ts` | 6 | `read-board`, `write-board`, `write-footprint`, `pcb_clipboard`, `board_exchange_footprint`, `kicad_footprint_ops` |

`pcbnew/src/index.ts` re-exports `types.ts`, so the designer-side numbers
undercount by whatever reaches `Board` through the barrel; the retire step
in stage 6 is `tsc` after deleting `types.ts`'s `Board`, not a grep.

## 5. Storage decision

**The classes own the K records' fields as their members - one copy, no
wrapper, no `k` pointer.** `KPad` becomes `PAD`'s members, `KPadstack` becomes
`PADSTACK`, `KZone` becomes `ZONE`, and so on: the interfaces in
`kicad_board_items.ts` were written "one field per member the parser sets and
the formatter reads, with the constructors' defaults" - they are already the
class member lists, missing only the methods and the base classes. The parser
returns `PAD`s; the formatter takes `PAD`s; `kicad_board_items.ts` dissolves.

**The in-memory frame is KiCad's: board-absolute children.** The C++ parser
converts as it reads - `pad->SetFPRelativePosition(pt)` (parser:5899, via
`BOARD_ITEM::SetFPRelativePosition` = `RotatePoint` by the parent orientation
then `+= parent pos`), and for `fp_text` `SetTextAngle(angle − parent)`,
`Rotate({0,0}, parent)`, `Move(parent pos)` (parser:3960-3975) - and the
formatter converts back at write time (`GetFPRelativePosition()` at
pcb_io_kicad_sexpr.cpp:1696 = `pos −= parent; RotatePoint(pos, −orient)`).
Our `fpRoundTrip` is exactly that pair applied at parse time so the K record
could hold the file frame; with the classes holding the board frame and the
formatter calling `GetFPRelativePosition()`, the same two `RotatePoint`s run
in the same order on the same ints and `fpRoundTrip` is deleted. Byte
identity is then by construction, and the oracle
(`qa/perf/kicad_sexpr_board_diff.ts` vs `~/kicad-oracle/resave2/`) is the
check.

Consequences stage 1 must honour:
- The parser sets the footprint's position and orientation BEFORE parsing
  its children (parser:5113/5118 precede every `footprint->Add`), because
  `SetFPRelativePosition` reads the parent. Ours already does (the `parentFP`
  closure in `parseFOOTPRINT`, `pcb_io_kicad_sexpr_items.ts:2714`); what
  changes is that the child is constructed with the parent set and converts
  itself, instead of `fpRoundTrip` on a record.
- `FOOTPRINT::Add` sets the parent (footprint.cpp:1516); `GetParentFootprint`
  is how `PAD::Flip`'s relative orientation and `PCB_TEXT`'s relative angle
  work. Every child carries `m_parent`.
- A zone inside a footprint is board-absolute too (`zone->Move(delta)` in
  `SetPosition`), and so are dimensions - but a dimension's TEXT is NOT
  converted on read (parser:3960 excludes `PCB_DIMENSION_BASE`).
- Angles: pad and footprint-text angles are stored absolute in both frames
  (`PADSTACK::m_orientation`, `EDA_TEXT::m_attributes.m_Angle`); only
  positions change frame.

**Layer ids are `PCB_LAYER_ID` numbers everywhere in the classes, `LSET` for
sets.** `BOARD::GetLayerName/GetLayerID` is the one bridge, as in KiCad.

**Geometry members are the kimath classes, not point arrays.** `ZONE::m_Poly`
and fills are `SHAPE_POLY_SET`; `PAD` builds `m_effectivePolygon`/`m_effectiveShape`
lazily with `m_shapesDirty`; `PCB_SHAPE` IS an `EDA_SHAPE` (TypeScript has no
mixins, so `EDA_SHAPE`/`EDA_TEXT` are composed - the accessor forwarding is
the cost, and it is already the pattern in `pcb_shape.ts`/`pcb_text.ts`).
`kimath` today has `Polygon = Vec2[][]` functions, `BOX2D`, `SEG`,
`SHAPE_LINE_CHAIN` pieces; `SHAPE_POLY_SET` and `BOX2I` as classes are
stage-1 prerequisites.

**`EDA_ITEM` goes in `common/src`,** shared with the schematic later; it
carries `m_Uuid` (`kiid.ts` exists), `Type()` (`KICAD_T`), `m_parent`,
`m_flags`, `m_forceVisible`, the `IsSelected/SetSelected` family.

## 6. What stage 1 starts from

- Keep verbatim: `PCB_TRACK/ARC/VIA` transforms and hit tests, `PCB_TEXT`
  `Rotate/Mirror/Flip` (with the `IsSideSpecific` guard added), `PCB_SHAPE`
  forwarding, `FOOTPRINT::SetPosition/SetOrientation/Move/Rotate/Flip`
  skeletons (with `KeepUpright`, points, and the C++ child order),
  `ZONE::HitTest`, `validateViaParameters`.
- Member lists: `kicad_board_items.ts` and `pcb_io_kicad_sexpr_items.ts`
  (`KPcbShape`, `StrokeParams`, `OutlineEntry`, `NetRef`).
- Replace: string layer ids, `m_netCode`, the point-ring zone, the analytic
  pad, every `GetBoundingBox`, `PCB_FIELD`'s `FIELD_T` numbering.
- Delete when the parser returns items: `fpRoundTrip`, the `K*` interfaces,
  and in stage 6 `board_view.ts` and `types.ts`'s `Board`.
