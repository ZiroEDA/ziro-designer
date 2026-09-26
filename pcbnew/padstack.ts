// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PADSTACK defaults that more than one caller needs. Counterpart:
 * `pcbnew/padstack.cpp`.
 */

import type { Vec2 } from '@ziroeda/kimath/src/math/vector2.js';
import type { PadShape } from './types.js';

/**
 * `PADSTACK::DefaultThermalSpokeAngleForShape`, as the s-expression parser
 * resolves it (`pcb_io_kicad_sexpr_parser.cpp:6442-6469`), in DEGREES.
 *
 * "45° will produce an X (the default for circular pads and circular-anchored
 * custom shaped pads), while 90° will produce a + (the default for all other
 * shapes)."
 *
 * The parser's rule is the one a loaded board uses, and it is not quite
 * `DefaultThermalSpokeAngleForShape`: that function returns 45° for a trapezoid
 * while the parser writes 90°, because it asks whether the shape is a circle
 * rather than whether it is a rectangle. A file always goes through the parser,
 * so the parser wins.
 *
 * `aFileVersion` matters for one case only: a custom pad on a circular anchor
 * took a `+` in 6.0 and an `X` after it.
 */
export function defaultThermalSpokeAngle(
  shape: PadShape,
  anchorShape: PadShape | undefined,
  fileVersion = Number.POSITIVE_INFINITY,
): number {
  if (shape === 'circle') return 45;
  if (shape === 'custom' && (anchorShape ?? 'circle') === 'circle')
    return fileVersion <= 20211014 ? 90 : 45;
  return 90;
}

/**
 * `PAD::ShapePos( aLayer )` (pad.cpp) — where the pad's COPPER sits.
 *
 *     if( GetOffset( aLayer ) == VECTOR2I( 0, 0 ) ) return m_pos;
 *     VECTOR2I loc_offset = GetOffset( aLayer );
 *     RotatePoint( loc_offset, GetOrientation() );
 *     return m_pos + loc_offset;
 *
 * A pad's `(at …)` is the position of its **hole**; `(drill … (offset x y))`
 * moves the copper away from it, not the hole away from the copper. This tree
 * had it the other way round — the hole was drawn and knocked out at
 * `at + offset` while the copper stayed on `at` — which is the same *relative*
 * geometry but the wrong absolute one, so every offset pad's copper, its
 * thermal relief and its spokes sat one offset away from where KiCad puts them.
 * On the `complex_hierarchy` demo that is every TO-92: 0.4 mm of drift on 20
 * transistor pads, and 12 mm² of the pour in the wrong place.
 *
 * The hole itself stays on `pad.at`: `GetEffectiveHoleShape` builds its
 * `SHAPE_SEGMENT` from `m_pos`, never from `ShapePos`.
 */
export function padShapePos(pad: { at: Vec2; angle: number; drill?: { offset?: Vec2 } }): Vec2 {
  const o = pad.drill?.offset;
  if (!o || (o.x === 0 && o.y === 0)) return pad.at;

  // `RotatePoint( VECTOR2I&, const EDA_ANGLE& )` in board coordinates, whose y
  // grows downwards: (0, 0.4) at 90° comes back as (0.4, 0), which is what
  // KiCad's own `ShapePos` answers for U101 on complex_hierarchy.
  const rad = (pad.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: pad.at.x + o.x * cos + o.y * sin, y: pad.at.y - o.x * sin + o.y * cos };
}

// ---------------------------------------------------------------------------
// PADSTACK (pcbnew/padstack.h / pcbnew/padstack.cpp)
//
// The class. The helpers above are the older surface the plain-object `Board`
// model reads and go with stage 2. `Serialize`/`Deserialize` (protobuf) are
// not here. `std::unordered_map` has no defined order; `m_copperProps` is a
// `Map` in insertion order, which is what `ForEachUniqueLayer` walks in
// CUSTOM mode.

import {
  IsBackLayer,
  IsFrontLayer,
  IsNonCopperLayer,
  PCB_LAYER_ID,
} from '@ziroeda/common/layer_ids.js';
import { LSET } from '@ziroeda/common/lset.js';
import {
  ANGLE_0,
  ANGLE_45,
  ANGLE_90,
  type EDA_ANGLE,
} from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { BOARD } from './board.js';
import type { BOARD_ITEM } from './board_item.js';
import type { EDA_SHAPE } from '@ziroeda/common/eda_shape.js';
import type { PCB_SHAPE } from './pcb_shape.js';
import { ZONE_CONNECTION } from './zones.js';
import { ENUM_MAP } from '@ziroeda/common/properties/property.js';

/**
 * `IMPLEMENT_ENUM_TO_WXANY( PAD_DRILL_POST_MACHINING_MODE )` and
 * `( BACKDRILL_MODE )` (padstack.cpp:39): the two enum maps, filled the way
 * `PAD_DESC` fills them ("Ensure ... enum choices are defined before
 * properties use them"). The C++ relies on pad.cpp's static initialiser
 * running before pcb_track.cpp's; a module here has no such order, so both
 * `_DESC`s call this before registering a property on either enum.
 */
export function EnsurePadstackEnumChoices(): void {
  const pmMap = ENUM_MAP.Instance<PAD_DRILL_POST_MACHINING_MODE>('PAD_DRILL_POST_MACHINING_MODE');

  if (pmMap.Choices().GetCount() === 0) {
    pmMap
      .Undefined(PAD_DRILL_POST_MACHINING_MODE.UNKNOWN)
      .Map(PAD_DRILL_POST_MACHINING_MODE.NOT_POST_MACHINED, 'Not post-machined')
      .Map(PAD_DRILL_POST_MACHINING_MODE.COUNTERBORE, 'Counterbore')
      .Map(PAD_DRILL_POST_MACHINING_MODE.COUNTERSINK, 'Countersink');
  }

  const bdMap = ENUM_MAP.Instance<BACKDRILL_MODE>('BACKDRILL_MODE');

  if (bdMap.Choices().GetCount() === 0) {
    bdMap
      .Undefined(BACKDRILL_MODE.NO_BACKDRILL)
      .Map(BACKDRILL_MODE.NO_BACKDRILL, 'No backdrill')
      .Map(BACKDRILL_MODE.BACKDRILL_BOTTOM, 'Backdrill bottom')
      .Map(BACKDRILL_MODE.BACKDRILL_TOP, 'Backdrill top')
      .Map(BACKDRILL_MODE.BACKDRILL_BOTH, 'Backdrill both');
  }
}

export enum PAD_SHAPE {
  CIRCLE = 0,
  RECTANGLE = 1, // do not use just RECT: it collides in a header on MSYS2
  OVAL = 2,
  TRAPEZOID = 3,
  ROUNDRECT = 4,

  // Rectangle with a chamfered corner ( and with rounded other corners).
  CHAMFERED_RECT = 5,
  CUSTOM = 6, // A shape defined by user, using a set of basic shapes
  // (thick segments, circles, arcs, polygons).
}

export enum PAD_DRILL_SHAPE {
  UNDEFINED = 0,
  CIRCLE = 1,
  OBLONG = 2,
}

export enum PAD_DRILL_POST_MACHINING_MODE {
  UNKNOWN = 0,
  NOT_POST_MACHINED = 1,
  COUNTERBORE = 2,
  COUNTERSINK = 3,
}

export enum BACKDRILL_MODE {
  NO_BACKDRILL = 0,
  BACKDRILL_BOTTOM = 1,
  BACKDRILL_TOP = 2,
  BACKDRILL_BOTH = 3,
}

/**
 * The set of pad shapes, used with PAD::{Set,Get}Attribute()
 *
 * The double name is for convenience of Python devs
 */
export enum PAD_ATTRIB {
  PTH = 0, ///< Plated through hole pad
  SMD = 1, ///< Smd pad, appears on the solder paste layer (default)
  CONN = 2, ///< Like smd, does not appear on the solder paste layer (default)
  ///<   Note: also has a special attribute in Gerber X files
  ///<   Used for edgecard connectors for instance
  NPTH = 3, ///< like PAD_PTH, but not plated
  ///<   mechanical use only, no connection allowed
}

/**
 * The set of pad properties used in Gerber files (Draw files, and P&P files)
 * to define some properties in fabrication or test files.
 */
export enum PAD_PROP {
  NONE = 0, ///< no special fabrication property
  BGA = 1, ///< Smd pad, used in BGA footprints
  FIDUCIAL_GLBL = 2, ///< a fiducial (usually a smd) for the full board
  FIDUCIAL_LOCAL = 3, ///< a fiducial (usually a smd) local to the parent footprint
  TESTPOINT = 4, ///< a test point pad
  HEATSINK = 5, ///< a pad used as heat sink, usually in SMD footprints
  CASTELLATED = 6, ///< a pad with a castellated through hole
  MECHANICAL = 7, ///< a pad used for mechanical support
  PRESSFIT = 8, ///< a PTH with a hole diameter with tight tolerances for press fit pin
}

export enum UNCONNECTED_LAYER_MODE {
  KEEP_ALL = 0,
  START_END_ONLY = 1,
  REMOVE_ALL = 2,
  REMOVE_EXCEPT_START_AND_END = 3,
}

export enum CUSTOM_SHAPE_ZONE_MODE {
  OUTLINE = 0,
  CONVEXHULL = 1,
}

///! Padstack type, mostly for IPC-7351 naming and attributes
///! Note that TYPE::MOUNTING is probably not currently supported by KiCad
export enum PADSTACK_TYPE {
  NORMAL = 0, ///< Padstack for a footprint pad
  VIA = 1, ///< Padstack for a via
  MOUNTING = 2, ///< A mounting hole (plated or unplated, not associated with a footprint)
}

///! Copper geometry mode: controls how many unique copper layer shapes this padstack has
export enum PADSTACK_MODE {
  NORMAL = 0, ///< Shape is the same on all layers
  FRONT_INNER_BACK = 1, ///< Up to three shapes can be defined (F_Cu, inner copper layers, B_Cu)
  CUSTOM = 2, ///< Shapes can be defined on arbitrary layers
}

const vecEq = (a: VECTOR2I, b: VECTOR2I): boolean => a.x === b.x && a.y === b.y;

/** `#define TEST( a, b ) { if( a != b ) return a - b; }` as an expression: 0 when equal. */
const test = (a: number, b: number): number => a - b;

/** `TEST_OPT( a, b, v )`: presence first, then the values with `v` for a missing one. */
function testOpt(
  a: number | boolean | undefined,
  b: number | boolean | undefined,
  v: number | boolean,
): number {
  if ((a !== undefined) !== (b !== undefined))
    return Number(a !== undefined) - Number(b !== undefined);

  return Number(a ?? v) - Number(b ?? v);
}

///! The set of properties that define a pad's shape on a given layer
export class PADSTACK_SHAPE_PROPS {
  shape: PAD_SHAPE; ///< Shape of the pad
  anchor_shape: PAD_SHAPE; ///< Shape of the anchor when shape == PAD_SHAPE::CUSTOM
  size: VECTOR2I; ///< Size of the shape, or of the anchor pad for custom shape pads

  /*
   * Most of the time the hole is the center of the shape (m_Offset = 0). But some designers
   * use oblong/rect pads with a hole moved to one of the oblong/rect pad shape ends.
   * In all cases the hole is at the pad position.  This offset is from the hole to the center
   * of the pad shape (ie: the copper area around the hole).
   * ShapePos() returns the board shape position according to the offset and the pad rotation.
   */
  offset: VECTOR2I; ///< Offset of the shape center from the pad center

  round_rect_radius_ratio: number;
  chamfered_rect_ratio: number; ///< Size of chamfer: ratio of smallest of X,Y size
  chamfered_rect_positions: number; ///< @see RECT_CHAMFER_POSITIONS
  trapezoid_delta_size: VECTOR2I;

  constructor() {
    this.shape = PAD_SHAPE.CIRCLE;
    this.anchor_shape = PAD_SHAPE.RECTANGLE;
    this.size = { x: 0, y: 0 };
    this.offset = { x: 0, y: 0 };
    this.round_rect_radius_ratio = 0.0;
    this.chamfered_rect_ratio = 0.0;
    this.chamfered_rect_positions = 0;
    this.trapezoid_delta_size = { x: 0, y: 0 };
  }

  clone(): PADSTACK_SHAPE_PROPS {
    const c = new PADSTACK_SHAPE_PROPS();
    c.shape = this.shape;
    c.anchor_shape = this.anchor_shape;
    c.size = { x: this.size.x, y: this.size.y };
    c.offset = { x: this.offset.x, y: this.offset.y };
    c.round_rect_radius_ratio = this.round_rect_radius_ratio;
    c.chamfered_rect_ratio = this.chamfered_rect_ratio;
    c.chamfered_rect_positions = this.chamfered_rect_positions;
    c.trapezoid_delta_size = { x: this.trapezoid_delta_size.x, y: this.trapezoid_delta_size.y };
    return c;
  }

  equals(aOther: PADSTACK_SHAPE_PROPS): boolean {
    return (
      this.shape === aOther.shape &&
      this.anchor_shape === aOther.anchor_shape &&
      vecEq(this.size, aOther.size) &&
      vecEq(this.offset, aOther.offset) &&
      this.round_rect_radius_ratio === aOther.round_rect_radius_ratio &&
      this.chamfered_rect_ratio === aOther.chamfered_rect_ratio &&
      this.chamfered_rect_positions === aOther.chamfered_rect_positions &&
      vecEq(this.trapezoid_delta_size, aOther.trapezoid_delta_size)
    );
  }

  Compare(aOther: PADSTACK_SHAPE_PROPS): number {
    let d: number;

    d = test(this.shape, aOther.shape);
    if (d !== 0) return d;
    d = test(this.anchor_shape, aOther.anchor_shape);
    if (d !== 0) return d;
    d = test(this.size.x, aOther.size.x);
    if (d !== 0) return d;

    if (
      this.shape !== PAD_SHAPE.CIRCLE &&
      (this.shape !== PAD_SHAPE.CUSTOM || this.anchor_shape !== PAD_SHAPE.CIRCLE)
    ) {
      d = test(this.size.y, aOther.size.y);
      if (d !== 0) return d;
    }

    d = test(this.offset.x, aOther.offset.x);
    if (d !== 0) return d;
    d = test(this.offset.y, aOther.offset.y);
    if (d !== 0) return d;

    if (Math.abs(this.round_rect_radius_ratio - aOther.round_rect_radius_ratio) > 0.0001)
      return this.round_rect_radius_ratio > aOther.round_rect_radius_ratio ? 1 : -1;

    if (Math.abs(this.chamfered_rect_ratio - aOther.chamfered_rect_ratio) > 0.0001)
      return this.chamfered_rect_ratio > aOther.chamfered_rect_ratio ? 1 : -1;

    d = test(this.chamfered_rect_positions, aOther.chamfered_rect_positions);
    if (d !== 0) return d;

    return 0;
  }
}

export class PADSTACK_COPPER_LAYER_PROPS {
  shape = new PADSTACK_SHAPE_PROPS();
  zone_connection: ZONE_CONNECTION | undefined;
  thermal_spoke_width: number | undefined;
  thermal_spoke_angle: EDA_ANGLE | undefined;
  thermal_gap: number | undefined;
  clearance: number | undefined;

  /*
   * How to build the custom shape in zone, to create the clearance area:
   * CUSTOM_SHAPE_ZONE_MODE::OUTLINE = use pad shape
   * CUSTOM_SHAPE_ZONE_MODE::CONVEXHULL = use the convex hull of the pad shape
   */
  custom_shapes: PCB_SHAPE[] = [];

  /** The value copy `std::unordered_map<PCB_LAYER_ID, COPPER_LAYER_PROPS>` makes. */
  clone(): PADSTACK_COPPER_LAYER_PROPS {
    const c = new PADSTACK_COPPER_LAYER_PROPS();
    c.shape = this.shape.clone();
    c.zone_connection = this.zone_connection;
    c.thermal_spoke_width = this.thermal_spoke_width;
    c.thermal_spoke_angle = this.thermal_spoke_angle;
    c.thermal_gap = this.thermal_gap;
    c.clearance = this.clearance;
    c.custom_shapes = [...this.custom_shapes]; // shared_ptr copies share the shapes
    return c;
  }

  equals(aOther: PADSTACK_COPPER_LAYER_PROPS): boolean {
    if (!this.shape.equals(aOther.shape)) return false;
    if (this.zone_connection !== aOther.zone_connection) return false;
    if (this.thermal_spoke_width !== aOther.thermal_spoke_width) return false;
    if (!optAngleEq(this.thermal_spoke_angle, aOther.thermal_spoke_angle)) return false;
    if (this.thermal_gap !== aOther.thermal_gap) return false;
    if (this.clearance !== aOther.clearance) return false;
    if (this.custom_shapes.length !== aOther.custom_shapes.length) return false;
    // Deep compare of shapes?
    // For now, just check pointers or size
    return true;
  }

  Compare(aOther: PADSTACK_COPPER_LAYER_PROPS): number {
    let diff: number;

    diff = this.shape.Compare(aOther.shape);
    if (diff !== 0) return diff;

    diff = testOpt(this.zone_connection, aOther.zone_connection, ZONE_CONNECTION.NONE);
    if (diff !== 0) return diff;
    diff = testOpt(this.thermal_spoke_width, aOther.thermal_spoke_width, 0);
    if (diff !== 0) return diff;

    // TEST_OPT_ANGLE( thermal_spoke_angle, aOther.thermal_spoke_angle, ANGLE_0 )
    if ((this.thermal_spoke_angle !== undefined) !== (aOther.thermal_spoke_angle !== undefined))
      return (
        Number(this.thermal_spoke_angle !== undefined) -
        Number(aOther.thermal_spoke_angle !== undefined)
      );

    {
      const a = (this.thermal_spoke_angle ?? ANGLE_0).AsDegrees();
      const b = (aOther.thermal_spoke_angle ?? ANGLE_0).AsDegrees();

      if (Math.abs(a - b) > 0.001) return a > b ? 1 : -1;
    }

    diff = testOpt(this.thermal_gap, aOther.thermal_gap, 0);
    if (diff !== 0) return diff;
    diff = testOpt(this.clearance, aOther.clearance, 0);
    if (diff !== 0) return diff;

    diff = this.custom_shapes.length - aOther.custom_shapes.length;
    if (diff !== 0) return diff;

    for (let ii = 0; ii < this.custom_shapes.length; ++ii) {
      diff = this.custom_shapes[ii]!.Compare(aOther.custom_shapes[ii]! as unknown as EDA_SHAPE);
      if (diff !== 0) return diff;
    }

    return 0;
  }

  Similarity(aOther: PADSTACK_COPPER_LAYER_PROPS): number {
    let similarity = 1.0;

    if (!this.shape.equals(aOther.shape)) similarity *= 0.5;

    if (this.zone_connection !== aOther.zone_connection) similarity *= 0.9;

    if (this.thermal_spoke_width !== aOther.thermal_spoke_width) similarity *= 0.9;

    if (!optAngleEq(this.thermal_spoke_angle, aOther.thermal_spoke_angle)) similarity *= 0.9;

    if (this.thermal_gap !== aOther.thermal_gap) similarity *= 0.9;

    if (this.clearance !== aOther.clearance) similarity *= 0.9;

    // `custom_shapes != aOther.custom_shapes`: the vectors of shared_ptr, so the same shapes.
    if (
      this.custom_shapes.length !== aOther.custom_shapes.length ||
      this.custom_shapes.some((s, i) => s !== aOther.custom_shapes[i])
    )
      similarity *= 0.5;

    return similarity;
  }
}

function optAngleEq(a: EDA_ANGLE | undefined, b: EDA_ANGLE | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;

  return a.equals(b);
}

///! The features of a padstack that can vary on outer layers.
///! All parameters are optional; leaving them un-set means "use parent/rule defaults"
export class PADSTACK_MASK_LAYER_PROPS {
  solder_mask_margin: number | undefined;
  solder_paste_margin: number | undefined;
  solder_paste_margin_ratio: number | undefined;
  has_solder_mask: boolean | undefined; ///< True if this outer layer has mask (is not tented)
  has_solder_paste: boolean | undefined; ///< True if this outer layer has solder paste
  has_covering: boolean | undefined; ///< True if the pad on this side should have covering
  has_plugging: boolean | undefined; ///< True if the drill hole should be plugged on this side

  clone(): PADSTACK_MASK_LAYER_PROPS {
    const c = new PADSTACK_MASK_LAYER_PROPS();
    c.solder_mask_margin = this.solder_mask_margin;
    c.solder_paste_margin = this.solder_paste_margin;
    c.solder_paste_margin_ratio = this.solder_paste_margin_ratio;
    c.has_solder_mask = this.has_solder_mask;
    c.has_solder_paste = this.has_solder_paste;
    c.has_covering = this.has_covering;
    c.has_plugging = this.has_plugging;
    return c;
  }

  equals(aOther: PADSTACK_MASK_LAYER_PROPS): boolean {
    return (
      this.solder_mask_margin === aOther.solder_mask_margin &&
      this.solder_paste_margin === aOther.solder_paste_margin &&
      this.solder_paste_margin_ratio === aOther.solder_paste_margin_ratio &&
      this.has_solder_mask === aOther.has_solder_mask &&
      this.has_solder_paste === aOther.has_solder_paste &&
      this.has_covering === aOther.has_covering &&
      this.has_plugging === aOther.has_plugging
    );
  }

  Compare(aOther: PADSTACK_MASK_LAYER_PROPS): number {
    let d: number;

    d = testOpt(this.solder_mask_margin, aOther.solder_mask_margin, 0);
    if (d !== 0) return d;
    d = testOpt(this.solder_paste_margin, aOther.solder_paste_margin, 0);
    if (d !== 0) return d;

    if (
      (this.solder_paste_margin_ratio !== undefined) !==
      (aOther.solder_paste_margin_ratio !== undefined)
    )
      return (
        Number(this.solder_paste_margin_ratio !== undefined) -
        Number(aOther.solder_paste_margin_ratio !== undefined)
      );

    if (
      Math.abs(
        (this.solder_paste_margin_ratio ?? 0.0) - (aOther.solder_paste_margin_ratio ?? 0.0),
      ) > 0.0001
    )
      return (this.solder_paste_margin_ratio ?? 0.0) > (aOther.solder_paste_margin_ratio ?? 0.0)
        ? 1
        : -1;

    d = testOpt(this.has_solder_mask, aOther.has_solder_mask, false);
    if (d !== 0) return d;
    d = testOpt(this.has_solder_paste, aOther.has_solder_paste, false);
    if (d !== 0) return d;
    d = testOpt(this.has_covering, aOther.has_covering, false);
    if (d !== 0) return d;
    d = testOpt(this.has_plugging, aOther.has_plugging, false);
    if (d !== 0) return d;

    return 0;
  }
}

///! The properties of a padstack drill.  Drill position is always the pad position (origin).
export class PADSTACK_DRILL_PROPS {
  size: VECTOR2I = { x: 0, y: 0 }; ///< Drill diameter (x == y) or slot dimensions (x != y)
  shape: PAD_DRILL_SHAPE = PAD_DRILL_SHAPE.UNDEFINED;
  start: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;
  end: PCB_LAYER_ID = PCB_LAYER_ID.UNDEFINED_LAYER;
  is_filled: boolean | undefined; ///< True if the drill hole should be filled completely
  is_capped: boolean | undefined; ///< True if the drill hole should be capped

  clone(): PADSTACK_DRILL_PROPS {
    const c = new PADSTACK_DRILL_PROPS();
    c.assign(this);
    return c;
  }

  assign(aOther: PADSTACK_DRILL_PROPS): this {
    this.size = { x: aOther.size.x, y: aOther.size.y };
    this.shape = aOther.shape;
    this.start = aOther.start;
    this.end = aOther.end;
    this.is_filled = aOther.is_filled;
    this.is_capped = aOther.is_capped;
    return this;
  }

  equals(aOther: PADSTACK_DRILL_PROPS): boolean {
    return (
      vecEq(this.size, aOther.size) &&
      this.shape === aOther.shape &&
      this.start === aOther.start &&
      this.end === aOther.end &&
      this.is_filled === aOther.is_filled &&
      this.is_capped === aOther.is_capped
    );
  }

  Compare(aOther: PADSTACK_DRILL_PROPS): number {
    let d: number;

    d = test(this.shape, aOther.shape);
    if (d !== 0) return d;
    d = test(this.size.x, aOther.size.x);
    if (d !== 0) return d;

    if (this.shape !== PAD_DRILL_SHAPE.CIRCLE) {
      d = test(this.size.y, aOther.size.y);
      if (d !== 0) return d;
    }

    d = test(this.start, aOther.start);
    if (d !== 0) return d;
    d = test(this.end, aOther.end);
    if (d !== 0) return d;
    d = testOpt(this.is_filled, aOther.is_filled, false);
    if (d !== 0) return d;
    d = testOpt(this.is_capped, aOther.is_capped, false);
    if (d !== 0) return d;

    return 0;
  }
}

export class PADSTACK_POST_MACHINING_PROPS {
  mode: PAD_DRILL_POST_MACHINING_MODE | undefined;
  size = 0;
  depth = 0;
  angle = 0;

  clone(): PADSTACK_POST_MACHINING_PROPS {
    const c = new PADSTACK_POST_MACHINING_PROPS();
    c.mode = this.mode;
    c.size = this.size;
    c.depth = this.depth;
    c.angle = this.angle;
    return c;
  }

  equals(aOther: PADSTACK_POST_MACHINING_PROPS): boolean {
    return (
      this.mode === aOther.mode &&
      this.size === aOther.size &&
      this.depth === aOther.depth &&
      this.angle === aOther.angle
    );
  }

  Compare(aOther: PADSTACK_POST_MACHINING_PROPS): number {
    let d: number;

    d = testOpt(this.mode, aOther.mode, PAD_DRILL_POST_MACHINING_MODE.UNKNOWN);
    if (d !== 0) return d;
    d = test(this.size, aOther.size);
    if (d !== 0) return d;
    d = test(this.depth, aOther.depth);
    if (d !== 0) return d;
    d = test(this.angle, aOther.angle);
    if (d !== 0) return d;

    return 0;
  }
}

/**
 * A padstack defines the characteristics of a single or multi-layer pad, in the IPC sense of the
 * word.  Pads are made up of a number of layers (a copper layer, a mask layer, etc) and each layer
 * may have a different shape, size, and properties.
 */
export class PADSTACK {
  static readonly TYPE = PADSTACK_TYPE;
  static readonly MODE = PADSTACK_MODE;

  ///! Temporary layer identifier to identify code that is not padstack-aware
  static readonly ALL_LAYERS: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu;

  ///! The layer identifier to use for "inner layers" on top/inner/bottom padstacks
  static readonly INNER_LAYERS: PCB_LAYER_ID = PCB_LAYER_ID.In1_Cu;

  ///! The BOARD_ITEM this PADSTACK belongs to; will be used as the parent for owned shapes
  private m_parent: BOARD_ITEM | null;

  ///! The copper layer variation mode this padstack is in
  private m_mode: PADSTACK_MODE;

  ///! The board layers that this padstack is active on
  private m_layerSet = new LSET();

  ///! An override for the IPC-7351 padstack name
  private m_customName: string | null = null;

  ///! The rotation of the pad relative to an outer reference frame
  private m_orientation: EDA_ANGLE;

  ///! The properties applied to copper layers if they aren't overridden
  //COPPER_LAYER_PROPS m_defaultCopperProps;
  private m_copperProps = new Map<PCB_LAYER_ID, PADSTACK_COPPER_LAYER_PROPS>();

  ///! The overrides applied to front outer technical layers
  private m_frontMaskProps = new PADSTACK_MASK_LAYER_PROPS();

  ///! The overrides applied to back outer technical layers
  private m_backMaskProps = new PADSTACK_MASK_LAYER_PROPS();

  private m_unconnectedLayerMode: UNCONNECTED_LAYER_MODE;

  private m_customShapeInZoneMode: CUSTOM_SHAPE_ZONE_MODE;

  ///! The primary drill parameters, which also define the start and end layers for through-hole
  ///! vias and pads (F_Cu to B_Cu for normal holes; a subset of layers for blind/buried vias)
  private m_drill = new PADSTACK_DRILL_PROPS();

  ///! Secondary drill, used to define back-drilling starting from the bottom side
  private m_secondaryDrill = new PADSTACK_DRILL_PROPS();

  ///! Tertiary drill, used to define back-drilling starting from the top side
  private m_tertiaryDrill = new PADSTACK_DRILL_PROPS();

  private m_frontPostMachining = new PADSTACK_POST_MACHINING_PROPS();
  private m_backPostMachining = new PADSTACK_POST_MACHINING_PROPS();

  constructor(aParent: BOARD_ITEM | null);
  constructor(aOther: PADSTACK);
  constructor(a: BOARD_ITEM | PADSTACK | null) {
    if (a instanceof PADSTACK) {
      // PADSTACK( const PADSTACK& aOther )
      this.m_parent = a.m_parent;
      this.m_mode = PADSTACK_MODE.NORMAL;
      this.m_orientation = ANGLE_0;
      this.m_unconnectedLayerMode = UNCONNECTED_LAYER_MODE.KEEP_ALL;
      this.m_customShapeInZoneMode = CUSTOM_SHAPE_ZONE_MODE.OUTLINE;

      this.assign(a);

      this.ForEachUniqueLayer((aLayer) => {
        for (const shape of this.CopperLayer(aLayer).custom_shapes) shape.SetParent(this.m_parent);
      });

      return;
    }

    this.m_parent = a;
    this.m_mode = PADSTACK_MODE.NORMAL;
    this.m_orientation = ANGLE_0;
    this.m_unconnectedLayerMode = UNCONNECTED_LAYER_MODE.KEEP_ALL;
    this.m_customShapeInZoneMode = CUSTOM_SHAPE_ZONE_MODE.OUTLINE;

    const all = this.copperEntry(PADSTACK.ALL_LAYERS);
    all.shape = new PADSTACK_SHAPE_PROPS();
    all.zone_connection = ZONE_CONNECTION.INHERITED;
    all.thermal_spoke_width = undefined;
    all.thermal_spoke_angle = ANGLE_45;
    all.thermal_gap = undefined;

    this.m_drill.shape = PAD_DRILL_SHAPE.CIRCLE;
    this.m_drill.start = PCB_LAYER_ID.F_Cu;
    this.m_drill.end = PCB_LAYER_ID.B_Cu;

    this.m_secondaryDrill.shape = PAD_DRILL_SHAPE.UNDEFINED;
    this.m_secondaryDrill.start = PCB_LAYER_ID.UNDEFINED_LAYER;
    this.m_secondaryDrill.end = PCB_LAYER_ID.UNDEFINED_LAYER;

    this.m_tertiaryDrill.shape = PAD_DRILL_SHAPE.UNDEFINED;
    this.m_tertiaryDrill.start = PCB_LAYER_ID.UNDEFINED_LAYER;
    this.m_tertiaryDrill.end = PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  /** `m_copperProps[aLayer]`: a `std::unordered_map` creates the entry on first access. */
  private copperEntry(aLayer: PCB_LAYER_ID): PADSTACK_COPPER_LAYER_PROPS {
    let entry = this.m_copperProps.get(aLayer);

    if (!entry) {
      entry = new PADSTACK_COPPER_LAYER_PROPS();
      this.m_copperProps.set(aLayer, entry);
    }

    return entry;
  }

  /** `operator=( const PADSTACK& aOther )`. */
  assign(aOther: PADSTACK): this {
    // NOTE: m_parent is not copied from operator=, because this operator is commonly used to
    // update the padstack properties, and such an update must not change the parent PAD to point to
    // the parent of some different padstack.
    this.m_mode = aOther.m_mode;
    this.m_layerSet = new LSET(aOther.m_layerSet);
    this.SetCustomName(aOther.CustomName());
    this.m_orientation = aOther.m_orientation;
    this.m_copperProps = new Map();

    for (const [layer, props] of aOther.m_copperProps) this.m_copperProps.set(layer, props.clone());

    this.m_frontMaskProps = aOther.m_frontMaskProps.clone();
    this.m_backMaskProps = aOther.m_backMaskProps.clone();
    this.m_unconnectedLayerMode = aOther.m_unconnectedLayerMode;
    this.m_customShapeInZoneMode = aOther.m_customShapeInZoneMode;
    this.m_drill = aOther.m_drill.clone();
    this.m_secondaryDrill = aOther.m_secondaryDrill.clone();
    this.m_tertiaryDrill = aOther.m_tertiaryDrill.clone();
    this.m_frontPostMachining = aOther.m_frontPostMachining.clone();
    this.m_backPostMachining = aOther.m_backPostMachining.clone();

    // Data consistency enforcement logic that used to live in the pad properties dialog.
    // While it might be tempting to put these in the individual property setters, there's no
    // well-defined order in which they're called, and many of the consistency checks are
    // between multiple properties.

    this.ForEachUniqueLayer((aLayer) => {
      const shape = this.Shape(aLayer);

      // Make sure leftover primitives don't stick around
      this.ClearPrimitives(aLayer);

      // For custom pad shape, duplicate primitives of the pad to copy
      if (shape === PAD_SHAPE.CUSTOM) this.ReplacePrimitives(aOther.Primitives(aLayer), aLayer);

      // rounded rect pads with radius ratio = 0 are in fact rect pads.
      // So set the right shape (and perhaps issues with a radius = 0)
      if (shape === PAD_SHAPE.ROUNDRECT && this.RoundRectRadiusRatio(aLayer) === 0.0)
        this.SetShape(PAD_SHAPE.RECTANGLE, aLayer);
    });

    return this;
  }

  equals(aOther: PADSTACK): boolean {
    if (this.m_mode !== aOther.m_mode) return false;

    if (!this.m_layerSet.equals(aOther.m_layerSet)) return false;

    if (this.CustomName() !== aOther.CustomName()) return false;

    if (!this.m_orientation.equals(aOther.m_orientation)) return false;

    if (!this.m_frontMaskProps.equals(aOther.m_frontMaskProps)) return false;

    if (!this.m_backMaskProps.equals(aOther.m_backMaskProps)) return false;

    if (this.m_unconnectedLayerMode !== aOther.m_unconnectedLayerMode) return false;

    if (this.m_customShapeInZoneMode !== aOther.m_customShapeInZoneMode) return false;

    if (!this.m_drill.equals(aOther.m_drill)) return false;

    if (!this.m_secondaryDrill.equals(aOther.m_secondaryDrill)) return false;

    if (!this.m_tertiaryDrill.equals(aOther.m_tertiaryDrill)) return false;

    if (!this.m_frontPostMachining.equals(aOther.m_frontPostMachining)) return false;

    if (!this.m_backPostMachining.equals(aOther.m_backPostMachining)) return false;

    let copperMatches = true;

    this.ForEachUniqueLayer((aLayer) => {
      if (!this.CopperLayer(aLayer).equals(aOther.CopperLayer(aLayer))) copperMatches = false;
    });

    return copperMatches;
  }

  // A backdrill's side is identified by its start layer (F_Cu = top, B_Cu = bottom), not by which
  // drill slot it occupies. Reads scan both slots so a board written by KiCad 10.0 - which stored the
  // top backdrill in the tertiary slot - is understood, and writes always stamp the start layer so a
  // backdrill saved here is read back correctly by older KiCad. Presence is keyed on the drill size.
  private findBackdrillDrill(aTop: boolean): PADSTACK_DRILL_PROPS | null {
    const side = aTop ? PCB_LAYER_ID.F_Cu : PCB_LAYER_ID.B_Cu;

    if (this.m_secondaryDrill.size.x > 0 && this.m_secondaryDrill.start === side)
      return this.m_secondaryDrill;

    if (this.m_tertiaryDrill.size.x > 0 && this.m_tertiaryDrill.start === side)
      return this.m_tertiaryDrill;

    return null;
  }

  /// Return the slot to write a backdrill side into, reusing the slot already holding that side
  /// or otherwise the canonical slot (top -> secondary, bottom -> tertiary).
  private backdrillWriteSlot(aTop: boolean): PADSTACK_DRILL_PROPS {
    const existing = this.findBackdrillDrill(aTop);

    if (existing) return existing;

    const home = aTop ? this.m_secondaryDrill : this.m_tertiaryDrill;
    const other = aTop ? this.m_tertiaryDrill : this.m_secondaryDrill;
    const otherSide = aTop ? PCB_LAYER_ID.B_Cu : PCB_LAYER_ID.F_Cu;

    // Displace to the other slot only when the canonical home is already taken by the opposite
    // side, which happens when extending a backdrill on a board written by KiCad 10.0.
    if (home.size.x > 0 && home.start === otherSide) return other;

    return home;
  }

  /// Clear every slot whose start layer marks it as the given backdrill side, so a malformed
  /// padstack with the side duplicated across both slots is fully cleared.
  private clearBackdrillSide(aTop: boolean): void {
    const side = aTop ? PCB_LAYER_ID.F_Cu : PCB_LAYER_ID.B_Cu;

    if (this.m_secondaryDrill.start === side) this.m_secondaryDrill.size = { x: 0, y: 0 };

    if (this.m_tertiaryDrill.start === side) this.m_tertiaryDrill.size = { x: 0, y: 0 };
  }

  GetBackdrillMode(): BACKDRILL_MODE {
    const hasTop = this.findBackdrillDrill(true) !== null;
    const hasBottom = this.findBackdrillDrill(false) !== null;

    if (hasTop && hasBottom) return BACKDRILL_MODE.BACKDRILL_BOTH;

    if (hasTop) return BACKDRILL_MODE.BACKDRILL_TOP;

    if (hasBottom) return BACKDRILL_MODE.BACKDRILL_BOTTOM;

    return BACKDRILL_MODE.NO_BACKDRILL;
  }

  SetBackdrillMode(aMode: BACKDRILL_MODE): void {
    const apply = (aTop: boolean, aWant: boolean): void => {
      if (aWant) {
        const drill = this.backdrillWriteSlot(aTop);
        drill.start = aTop ? PCB_LAYER_ID.F_Cu : PCB_LAYER_ID.B_Cu;
        drill.shape = PAD_DRILL_SHAPE.CIRCLE;

        if (drill.size.x <= 0)
          // Backdrill slightly larger than main drill
          drill.size = {
            x: Math.trunc(this.m_drill.size.x * 1.1),
            y: Math.trunc(this.m_drill.size.y * 1.1),
          };
      } else {
        this.clearBackdrillSide(aTop);
      }
    };

    apply(true, aMode === BACKDRILL_MODE.BACKDRILL_TOP || aMode === BACKDRILL_MODE.BACKDRILL_BOTH);
    apply(
      false,
      aMode === BACKDRILL_MODE.BACKDRILL_BOTTOM || aMode === BACKDRILL_MODE.BACKDRILL_BOTH,
    );
  }

  GetBackdrillSize(aTop: boolean): number | undefined {
    const drill = this.findBackdrillDrill(aTop);

    if (drill) return drill.size.x;

    return undefined;
  }

  SetBackdrillSize(aTop: boolean, aSize: number | undefined): void {
    if (aSize !== undefined) {
      const target = this.backdrillWriteSlot(aTop);
      target.size = { x: aSize, y: aSize };
      target.shape = PAD_DRILL_SHAPE.CIRCLE;
      target.start = aTop ? PCB_LAYER_ID.F_Cu : PCB_LAYER_ID.B_Cu;
    } else {
      this.clearBackdrillSide(aTop);
    }
  }

  GetBackdrillEndLayer(aTop: boolean): PCB_LAYER_ID {
    const drill = this.findBackdrillDrill(aTop);

    if (drill) return drill.end;

    return PCB_LAYER_ID.UNDEFINED_LAYER;
  }

  SetBackdrillEndLayer(aTop: boolean, aLayer: PCB_LAYER_ID): void {
    // A backdrill with no must-cut layer does not exist (matching the via layer sanitizer), so
    // clearing the must-cut clears the side rather than leaving a sizeful drill with no end.
    if (aLayer === PCB_LAYER_ID.UNDEFINED_LAYER) {
      this.clearBackdrillSide(aTop);
      return;
    }

    const target = this.backdrillWriteSlot(aTop);
    target.end = aLayer;
    target.start = aTop ? PCB_LAYER_ID.F_Cu : PCB_LAYER_ID.B_Cu;
  }

  static Compare(aLeft: PADSTACK, aRight: PADSTACK): number {
    let diff: number;

    diff = test(aLeft.m_mode, aRight.m_mode);
    if (diff !== 0) return diff;

    if (!aLeft.m_layerSet.equals(aRight.m_layerSet))
      return Number(lseqLess(aLeft.m_layerSet.Seq(), aRight.m_layerSet.Seq()));

    diff = wxCmp(aLeft.CustomName(), aRight.CustomName());
    if (diff !== 0) return diff;

    diff = test(aLeft.m_orientation.AsTenthsOfADegree(), aRight.m_orientation.AsTenthsOfADegree());
    if (diff !== 0) return diff;

    diff = aLeft.m_frontMaskProps.Compare(aRight.m_frontMaskProps);
    if (diff !== 0) return diff;

    diff = aLeft.m_backMaskProps.Compare(aRight.m_backMaskProps);
    if (diff !== 0) return diff;

    diff = test(aLeft.m_unconnectedLayerMode, aRight.m_unconnectedLayerMode);
    if (diff !== 0) return diff;
    diff = test(aLeft.m_customShapeInZoneMode, aRight.m_customShapeInZoneMode);
    if (diff !== 0) return diff;

    diff = aLeft.m_drill.Compare(aRight.m_drill);
    if (diff !== 0) return diff;

    diff = aLeft.m_secondaryDrill.Compare(aRight.m_secondaryDrill);
    if (diff !== 0) return diff;

    diff = aLeft.m_tertiaryDrill.Compare(aRight.m_tertiaryDrill);
    if (diff !== 0) return diff;

    diff = aLeft.m_frontPostMachining.Compare(aRight.m_frontPostMachining);
    if (diff !== 0) return diff;

    diff = aLeft.m_backPostMachining.Compare(aRight.m_backPostMachining);
    if (diff !== 0) return diff;

    aLeft.ForEachUniqueLayer((aLayer) => {
      if (diff !== 0)
        // we want to return the first non-matching layer
        return;

      diff = aLeft.CopperLayer(aLayer).Compare(aRight.CopperLayer(aLayer));
    });

    if (diff !== 0) return diff;

    return 0;
  }

  HasExplicitDefinitionForLayer(aLayer: PCB_LAYER_ID): boolean {
    return this.m_copperProps.has(aLayer);
  }

  Similarity(aOther: PADSTACK): number {
    let similarity = 1.0;

    if (this.m_mode !== aOther.m_mode) similarity *= 0.9;

    if (!this.m_layerSet.equals(aOther.m_layerSet)) similarity *= 0.9;

    if (this.CustomName() !== aOther.CustomName()) similarity *= 0.9;

    if (!this.m_orientation.equals(aOther.m_orientation)) similarity *= 0.9;

    if (!this.m_frontMaskProps.equals(aOther.m_frontMaskProps)) similarity *= 0.9;

    if (!this.m_backMaskProps.equals(aOther.m_backMaskProps)) similarity *= 0.9;

    if (this.m_unconnectedLayerMode !== aOther.m_unconnectedLayerMode) similarity *= 0.9;

    if (this.m_customShapeInZoneMode !== aOther.m_customShapeInZoneMode) similarity *= 0.9;

    if (!this.m_drill.equals(aOther.m_drill)) similarity *= 0.9;

    if (!this.m_secondaryDrill.equals(aOther.m_secondaryDrill)) similarity *= 0.9;

    if (!this.m_tertiaryDrill.equals(aOther.m_tertiaryDrill)) similarity *= 0.9;

    if (!this.m_frontPostMachining.equals(aOther.m_frontPostMachining)) similarity *= 0.9;

    if (!this.m_backPostMachining.equals(aOther.m_backPostMachining)) similarity *= 0.9;

    this.ForEachUniqueLayer((aLayer) => {
      similarity *= this.CopperLayer(aLayer).Similarity(aOther.CopperLayer(aLayer));
    });

    return similarity;
  }

  LayerSet(): LSET {
    return this.m_layerSet;
  }
  SetLayerSet(aSet: LSET): void {
    this.m_layerSet = new LSET(aSet);
  }

  FlipLayers(aBoard: BOARD): void {
    if (this.m_mode === PADSTACK_MODE.FRONT_INNER_BACK) {
      const oldCopperProps = this.m_copperProps;
      this.m_copperProps = new Map();
      this.m_copperProps.set(
        aBoard.FlipLayer(PCB_LAYER_ID.F_Cu),
        oldCopperProps.get(PCB_LAYER_ID.F_Cu) ?? new PADSTACK_COPPER_LAYER_PROPS(),
      );
      this.m_copperProps.set(
        PADSTACK.INNER_LAYERS,
        oldCopperProps.get(PADSTACK.INNER_LAYERS) ?? new PADSTACK_COPPER_LAYER_PROPS(),
      );
      this.m_copperProps.set(
        aBoard.FlipLayer(PCB_LAYER_ID.B_Cu),
        oldCopperProps.get(PCB_LAYER_ID.B_Cu) ?? new PADSTACK_COPPER_LAYER_PROPS(),
      );
    } else if (this.m_mode === PADSTACK_MODE.CUSTOM) {
      const oldCopperProps = this.m_copperProps;
      this.m_copperProps = new Map();

      for (const [layer, props] of oldCopperProps)
        this.m_copperProps.set(aBoard.FlipLayer(layer), props);
    }

    [this.m_frontMaskProps, this.m_backMaskProps] = [this.m_backMaskProps, this.m_frontMaskProps];

    this.m_drill.start = aBoard.FlipLayer(this.m_drill.start);
    this.m_drill.end = aBoard.FlipLayer(this.m_drill.end);

    this.m_secondaryDrill.start = aBoard.FlipLayer(this.m_secondaryDrill.start);
    this.m_secondaryDrill.end = aBoard.FlipLayer(this.m_secondaryDrill.end);

    this.m_tertiaryDrill.start = aBoard.FlipLayer(this.m_tertiaryDrill.start);
    this.m_tertiaryDrill.end = aBoard.FlipLayer(this.m_tertiaryDrill.end);

    [this.m_frontPostMachining, this.m_backPostMachining] = [
      this.m_backPostMachining,
      this.m_frontPostMachining,
    ];
  }

  StartLayer(): PCB_LAYER_ID {
    return this.m_drill.start;
  }

  EndLayer(): PCB_LAYER_ID {
    return this.m_drill.end;
  }

  Mode(): PADSTACK_MODE {
    return this.m_mode;
  }
  SetMode(aMode: PADSTACK_MODE): void {
    this.m_mode = aMode;
  }

  ///! Returns the name of this padstack in IPC-7351 format
  Name(): string {
    return this.CustomName();
  }

  CustomName(): string {
    if (this.m_customName !== null) return this.m_customName;

    return '';
  }

  SetCustomName(aCustomName: string): void {
    if (aCustomName === '') {
      this.m_customName = null;
    } else {
      this.m_customName = aCustomName;
    }
  }

  GetOrientation(): EDA_ANGLE {
    return this.m_orientation;
  }
  SetOrientation(aAngle: EDA_ANGLE): void {
    this.m_orientation = aAngle.Clone();
    this.m_orientation.Normalize();
  }

  Drill(): PADSTACK_DRILL_PROPS {
    return this.m_drill;
  }

  SecondaryDrill(): PADSTACK_DRILL_PROPS {
    return this.m_secondaryDrill;
  }

  TertiaryDrill(): PADSTACK_DRILL_PROPS {
    return this.m_tertiaryDrill;
  }

  FrontPostMachining(): PADSTACK_POST_MACHINING_PROPS {
    return this.m_frontPostMachining;
  }

  BackPostMachining(): PADSTACK_POST_MACHINING_PROPS {
    return this.m_backPostMachining;
  }

  UnconnectedLayerMode(): UNCONNECTED_LAYER_MODE {
    return this.m_unconnectedLayerMode;
  }
  SetUnconnectedLayerMode(aMode: UNCONNECTED_LAYER_MODE): void {
    this.m_unconnectedLayerMode = aMode;
  }

  /** The const `CopperLayer( aLayer )`: reads without creating, with the fallbacks. */
  CopperLayer(aLayer: PCB_LAYER_ID): PADSTACK_COPPER_LAYER_PROPS {
    return this.copperLayerFor(aLayer);
  }

  /** The non-const `CopperLayer( aLayer )`: `operator[]`, which creates the entry. */
  CopperLayerMut(aLayer: PCB_LAYER_ID): PADSTACK_COPPER_LAYER_PROPS {
    if (this.m_mode === PADSTACK_MODE.NORMAL) return this.copperEntry(PADSTACK.ALL_LAYERS);

    if (this.m_mode === PADSTACK_MODE.FRONT_INNER_BACK) {
      if (IsFrontLayer(aLayer)) return this.copperEntry(PCB_LAYER_ID.F_Cu);
      else if (IsBackLayer(aLayer)) return this.copperEntry(PCB_LAYER_ID.B_Cu);
      else return this.copperEntry(PADSTACK.INNER_LAYERS);
    }

    return this.copperEntry(aLayer);
  }

  private copperLayerFor(aLayer: PCB_LAYER_ID): PADSTACK_COPPER_LAYER_PROPS {
    if (this.m_mode === PADSTACK_MODE.FRONT_INNER_BACK) {
      if (IsFrontLayer(aLayer) && this.m_copperProps.has(PCB_LAYER_ID.F_Cu))
        return this.m_copperProps.get(PCB_LAYER_ID.F_Cu)!;
      else if (IsBackLayer(aLayer) && this.m_copperProps.has(PCB_LAYER_ID.B_Cu))
        return this.m_copperProps.get(PCB_LAYER_ID.B_Cu)!;
      else if (this.m_copperProps.has(PADSTACK.INNER_LAYERS))
        return this.m_copperProps.get(PADSTACK.INNER_LAYERS)!;
    } else if (this.m_mode === PADSTACK_MODE.CUSTOM) {
      if (IsFrontLayer(aLayer) && this.m_copperProps.has(PCB_LAYER_ID.F_Cu))
        return this.m_copperProps.get(PCB_LAYER_ID.F_Cu)!;
      else if (IsBackLayer(aLayer) && this.m_copperProps.has(PCB_LAYER_ID.B_Cu))
        return this.m_copperProps.get(PCB_LAYER_ID.B_Cu)!;

      if (this.m_copperProps.has(aLayer)) return this.m_copperProps.get(aLayer)!;

      // For CUSTOM mode, fall back to ALL_LAYERS if available (e.g. for layers not yet
      // explicitly defined).  If ALL_LAYERS is also absent (e.g. after a FlipLayers()
      // that renamed the only entry from F_Cu to B_Cu), return whatever entry is first.
      if (this.m_copperProps.has(PADSTACK.ALL_LAYERS))
        return this.m_copperProps.get(PADSTACK.ALL_LAYERS)!;

      console.assert(this.m_copperProps.size > 0);
      return this.m_copperProps.values().next().value!;
    }

    const all = this.m_copperProps.get(PADSTACK.ALL_LAYERS);

    if (!all) throw new RangeError('out_of_range'); // std::unordered_map::at

    return all;
  }

  FrontOuterLayers(): PADSTACK_MASK_LAYER_PROPS {
    return this.m_frontMaskProps;
  }

  BackOuterLayers(): PADSTACK_MASK_LAYER_PROPS {
    return this.m_backMaskProps;
  }

  IsTented(aSide: PCB_LAYER_ID): boolean | undefined {
    if (IsFrontLayer(aSide)) return this.FrontOuterLayers().has_solder_mask;
    else if (IsBackLayer(aSide)) return this.BackOuterLayers().has_solder_mask;
    else return undefined;
  }

  IsCovered(aSide: PCB_LAYER_ID): boolean | undefined {
    if (IsFrontLayer(aSide)) return this.FrontOuterLayers().has_covering;
    else if (IsBackLayer(aSide)) return this.BackOuterLayers().has_covering;
    else return undefined;
  }

  IsPlugged(aSide: PCB_LAYER_ID): boolean | undefined {
    if (IsFrontLayer(aSide)) return this.FrontOuterLayers().has_plugging;
    else if (IsBackLayer(aSide)) return this.BackOuterLayers().has_plugging;
    else return undefined;
  }

  IsCapped(): boolean | undefined {
    return this.m_drill.is_capped;
  }

  IsFilled(): boolean | undefined {
    return this.m_drill.is_filled;
  }

  CustomShapeInZoneMode(): CUSTOM_SHAPE_ZONE_MODE {
    return this.m_customShapeInZoneMode;
  }
  SetCustomShapeInZoneMode(aM: CUSTOM_SHAPE_ZONE_MODE): void {
    this.m_customShapeInZoneMode = aM;
  }

  /**
   * Run the given callable for each active unique copper layer in this padstack, meaning F_Cu for
   * MODE::NORMAL, and F_Cu, In1_Cu, and B_Cu for MODE::FRONT_INNER_BACK.
   */
  ForEachUniqueLayer(aMethod: (aLayer: PCB_LAYER_ID) => void): void {
    if (this.m_mode === PADSTACK_MODE.NORMAL) {
      aMethod(PADSTACK.ALL_LAYERS);
    } else if (this.m_mode === PADSTACK_MODE.FRONT_INNER_BACK) {
      aMethod(PCB_LAYER_ID.F_Cu);
      aMethod(PADSTACK.INNER_LAYERS);
      aMethod(PCB_LAYER_ID.B_Cu);
    } else {
      for (const [layer] of this.m_copperProps) aMethod(layer);
    }
  }

  UniqueLayers(): PCB_LAYER_ID[] {
    const layers: PCB_LAYER_ID[] = [];

    this.ForEachUniqueLayer((layer) => {
      layers.push(layer);
    });

    return layers;
  }

  /**
   * Determines which geometry layer should be used for the given input layer.
   */
  EffectiveLayerFor(aLayer: PCB_LAYER_ID): PCB_LAYER_ID {
    if (this.m_mode === PADSTACK_MODE.NORMAL) return PADSTACK.ALL_LAYERS;

    if (this.m_mode === PADSTACK_MODE.FRONT_INNER_BACK || IsNonCopperLayer(aLayer)) {
      let candidate: PCB_LAYER_ID;

      if (IsFrontLayer(aLayer)) candidate = PCB_LAYER_ID.F_Cu;
      else if (IsBackLayer(aLayer)) candidate = PCB_LAYER_ID.B_Cu;
      else candidate = PADSTACK.INNER_LAYERS;

      // FRONT_INNER_BACK always has all three sides.
      // In CUSTOM mode only return the side if the pad actually defines it.
      if (this.m_mode === PADSTACK_MODE.FRONT_INNER_BACK || this.m_copperProps.has(candidate))
        return candidate;
    }

    if (this.m_copperProps.has(aLayer)) return aLayer;

    // For CUSTOM mode, if ALL_LAYERS is present use it as the default; otherwise return the
    // first available layer (e.g. after FlipLayers renamed ALL_LAYERS from F_Cu to B_Cu).
    if (this.m_copperProps.has(PADSTACK.ALL_LAYERS)) return PADSTACK.ALL_LAYERS;

    console.assert(this.m_copperProps.size > 0);
    return this.m_copperProps.keys().next().value!;
  }

  /**
   * Return the set of layers that must be considered if checking one padstack against another.
   */
  RelevantShapeLayers(aOther: PADSTACK): LSET {
    const layers = new LSET();

    if (this.m_mode === PADSTACK_MODE.NORMAL && aOther.m_mode === PADSTACK_MODE.NORMAL) {
      layers.set(PADSTACK.ALL_LAYERS);
    } else {
      this.ForEachUniqueLayer((layer) => {
        layers.set(layer);
      });

      aOther.ForEachUniqueLayer((layer) => {
        layers.set(layer);
      });
    }

    return layers;
  }

  // The following section has convenience getters for the padstack properties on a given layer.

  Shape(aLayer: PCB_LAYER_ID): PAD_SHAPE {
    return this.CopperLayer(aLayer).shape.shape;
  }
  SetShape(aShape: PAD_SHAPE, aLayer: PCB_LAYER_ID): void {
    this.CopperLayerMut(aLayer).shape.shape = aShape;
  }

  // Setter rather than direct access to enforce only positive sizes
  SetSize(aSize: VECTOR2I, aLayer: PCB_LAYER_ID): void {
    const size = { x: aSize.x, y: aSize.y };

    if (size.x < 0) size.x = 0;

    if (size.y < 0) size.y = 0;

    this.CopperLayerMut(aLayer).shape.size = size;
  }

  Size(aLayer: PCB_LAYER_ID): VECTOR2I {
    return this.CopperLayer(aLayer).shape.size;
  }

  DrillShape(): PAD_DRILL_SHAPE {
    return this.m_drill.shape;
  }
  SetDrillShape(aShape: PAD_DRILL_SHAPE): void {
    this.m_drill.shape = aShape;
  }

  /** `Offset( aLayer )`: the offset by reference — the object, which the caller may write to. */
  Offset(aLayer: PCB_LAYER_ID): VECTOR2I {
    return this.CopperLayerMut(aLayer).shape.offset;
  }

  SetOffset(aOffset: VECTOR2I, aLayer: PCB_LAYER_ID): void {
    this.CopperLayerMut(aLayer).shape.offset = { x: aOffset.x, y: aOffset.y };
  }

  AnchorShape(aLayer: PCB_LAYER_ID): PAD_SHAPE {
    return this.CopperLayer(aLayer).shape.anchor_shape;
  }
  SetAnchorShape(aShape: PAD_SHAPE, aLayer: PCB_LAYER_ID): void {
    this.CopperLayerMut(aLayer).shape.anchor_shape = aShape;
  }

  TrapezoidDeltaSize(aLayer: PCB_LAYER_ID): VECTOR2I {
    return this.CopperLayerMut(aLayer).shape.trapezoid_delta_size;
  }

  SetTrapezoidDeltaSize(aDelta: VECTOR2I, aLayer: PCB_LAYER_ID): void {
    this.CopperLayerMut(aLayer).shape.trapezoid_delta_size = { x: aDelta.x, y: aDelta.y };
  }

  RoundRectRadiusRatio(aLayer: PCB_LAYER_ID): number {
    return this.CopperLayer(aLayer).shape.round_rect_radius_ratio;
  }
  SetRoundRectRadiusRatio(aRatio: number, aLayer: PCB_LAYER_ID): void {
    this.CopperLayerMut(aLayer).shape.round_rect_radius_ratio = aRatio;
  }

  RoundRectRadius(aLayer: PCB_LAYER_ID): number {
    const size = this.Size(aLayer);
    return KiROUND(Math.min(size.x, size.y) * this.RoundRectRadiusRatio(aLayer));
  }

  SetRoundRectRadius(aRadius: number, aLayer: PCB_LAYER_ID): void {
    const size = this.Size(aLayer);
    const min_r = Math.min(size.x, size.y);

    if (min_r > 0) this.SetRoundRectRadiusRatio(aRadius / min_r, aLayer);
  }

  ChamferRatio(aLayer: PCB_LAYER_ID): number {
    return this.CopperLayer(aLayer).shape.chamfered_rect_ratio;
  }
  SetChamferRatio(aRatio: number, aLayer: PCB_LAYER_ID): void {
    this.CopperLayerMut(aLayer).shape.chamfered_rect_ratio = aRatio;
  }

  ChamferPositions(aLayer: PCB_LAYER_ID): number {
    return this.CopperLayer(aLayer).shape.chamfered_rect_positions;
  }
  SetChamferPositions(aPositions: number, aLayer: PCB_LAYER_ID): void {
    this.CopperLayerMut(aLayer).shape.chamfered_rect_positions = aPositions;
  }

  Clearance(aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): number | undefined {
    return this.CopperLayer(aLayer).clearance;
  }
  SetClearance(aClearance: number | undefined, aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): void {
    this.CopperLayerMut(aLayer).clearance = aClearance;
  }

  SolderMaskMargin(aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): number | undefined {
    if (IsFrontLayer(aLayer)) return this.FrontOuterLayers().solder_mask_margin;
    else if (IsBackLayer(aLayer)) return this.BackOuterLayers().solder_mask_margin;
    else return this.FrontOuterLayers().solder_mask_margin; // Should not happen
  }
  SetSolderMaskMargin(aMargin: number | undefined, aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): void {
    if (IsFrontLayer(aLayer)) this.FrontOuterLayers().solder_mask_margin = aMargin;
    else if (IsBackLayer(aLayer)) this.BackOuterLayers().solder_mask_margin = aMargin;
    else this.FrontOuterLayers().solder_mask_margin = aMargin; // Should not happen
  }

  SolderPasteMargin(aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): number | undefined {
    if (IsFrontLayer(aLayer)) return this.FrontOuterLayers().solder_paste_margin;
    else if (IsBackLayer(aLayer)) return this.BackOuterLayers().solder_paste_margin;
    else return this.FrontOuterLayers().solder_paste_margin; // Should not happen
  }
  SetSolderPasteMargin(
    aMargin: number | undefined,
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu,
  ): void {
    if (IsFrontLayer(aLayer)) this.FrontOuterLayers().solder_paste_margin = aMargin;
    else if (IsBackLayer(aLayer)) this.BackOuterLayers().solder_paste_margin = aMargin;
    else this.FrontOuterLayers().solder_paste_margin = aMargin; // Should not happen
  }

  SolderPasteMarginRatio(aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): number | undefined {
    if (IsFrontLayer(aLayer)) return this.FrontOuterLayers().solder_paste_margin_ratio;
    else if (IsBackLayer(aLayer)) return this.BackOuterLayers().solder_paste_margin_ratio;
    else return this.FrontOuterLayers().solder_paste_margin_ratio; // Should not happen
  }
  SetSolderPasteMarginRatio(
    aRatio: number | undefined,
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu,
  ): void {
    if (IsFrontLayer(aLayer)) this.FrontOuterLayers().solder_paste_margin_ratio = aRatio;
    else if (IsBackLayer(aLayer)) this.BackOuterLayers().solder_paste_margin_ratio = aRatio;
    else this.FrontOuterLayers().solder_paste_margin_ratio = aRatio; // Should not happen
  }

  ZoneConnection(aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): ZONE_CONNECTION | undefined {
    return this.CopperLayer(aLayer).zone_connection;
  }
  SetZoneConnection(
    aConnection: ZONE_CONNECTION | undefined,
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu,
  ): void {
    this.CopperLayerMut(aLayer).zone_connection = aConnection;
  }

  ThermalSpokeWidth(aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): number | undefined {
    return this.CopperLayer(aLayer).thermal_spoke_width;
  }
  SetThermalSpokeWidth(aWidth: number | undefined, aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): void {
    this.CopperLayerMut(aLayer).thermal_spoke_width = aWidth;
  }

  ThermalGap(aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): number | undefined {
    return this.CopperLayer(aLayer).thermal_gap;
  }
  SetThermalGap(aGap: number | undefined, aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): void {
    this.CopperLayerMut(aLayer).thermal_gap = aGap;
  }

  DefaultThermalSpokeAngleForShape(aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): EDA_ANGLE {
    if (
      this.Shape(aLayer) === PAD_SHAPE.OVAL ||
      this.Shape(aLayer) === PAD_SHAPE.RECTANGLE ||
      this.Shape(aLayer) === PAD_SHAPE.ROUNDRECT ||
      this.Shape(aLayer) === PAD_SHAPE.CHAMFERED_RECT
    ) {
      return ANGLE_90;
    }

    return ANGLE_45;
  }

  ThermalSpokeAngle(aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu): EDA_ANGLE {
    const angle = this.CopperLayer(aLayer).thermal_spoke_angle;

    if (angle !== undefined) return angle;

    return this.DefaultThermalSpokeAngleForShape(aLayer);
  }

  SetThermalSpokeAngle(
    aAngle: EDA_ANGLE | undefined,
    aLayer: PCB_LAYER_ID = PCB_LAYER_ID.F_Cu,
  ): void {
    this.CopperLayerMut(aLayer).thermal_spoke_angle = aAngle;
  }

  Primitives(aLayer: PCB_LAYER_ID): PCB_SHAPE[] {
    return this.CopperLayer(aLayer).custom_shapes;
  }

  AddPrimitive(aShape: PCB_SHAPE, aLayer: PCB_LAYER_ID): void {
    this.CopperLayerMut(aLayer).custom_shapes.push(aShape);
  }

  AppendPrimitives(aList: readonly PCB_SHAPE[], aLayer: PCB_LAYER_ID): void {
    const list = this.CopperLayerMut(aLayer).custom_shapes;

    for (const item of aList) {
      const new_shape = item.Clone();
      new_shape.SetParent(this.m_parent);
      list.push(new_shape);
    }
  }

  ReplacePrimitives(aList: readonly PCB_SHAPE[], aLayer: PCB_LAYER_ID): void {
    this.ClearPrimitives(aLayer);
    this.AppendPrimitives(aList, aLayer);
  }

  ClearPrimitives(aLayer: PCB_LAYER_ID): void {
    this.CopperLayerMut(aLayer).custom_shapes.length = 0;
  }
}

/** `wxString::Cmp`. */
function wxCmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `std::vector<PCB_LAYER_ID>::operator<`. */
function lseqLess(a: readonly PCB_LAYER_ID[], b: readonly PCB_LAYER_ID[]): boolean {
  const n = Math.min(a.length, b.length);

  for (let i = 0; i < n; ++i) if (a[i]! !== b[i]!) return a[i]! < b[i]!;

  return a.length < b.length;
}
