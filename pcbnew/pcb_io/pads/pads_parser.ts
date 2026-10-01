// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pads/pads_parser.cpp` / `.h`: `PADS_IO::PARSER`, the PADS
 * PowerPCB / Layout ASCII (`.asc`) reader, into plain records the plugin
 * builds the board from.
 *
 * The file is a byte string (one character per byte, see
 * `common/io/pads/pads_common.ts`); each line is parsed with the
 * `std::istringstream` emulation in `common/libc/sstream.ts`, because the
 * C++ branches on exactly when an extraction fails.
 *
 * `std::map` members are `Map`s here; `sortedMap` gives their key order
 * (the byte order of the keys) wherever the C++ iterates one.
 */

import { ParseDouble, ParseInt } from '@ziroeda/common/io/pads/pads_common.js';
import { ISTRINGSTREAM } from '@ziroeda/common/libc/sstream.js';
import { cos, sin, atan2 } from '@ziroeda/kimath/src/math/libm.js';

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;
const DBL_MAX = Number.MAX_VALUE;

export enum UNIT_TYPE {
  MILS,
  METRIC,
  INCHES,
}

export interface POINT {
  x: number;
  y: number;
}

export interface ARC {
  cx: number; ///< Center X coordinate
  cy: number; ///< Center Y coordinate
  radius: number; ///< Arc radius
  start_angle: number; ///< Start angle in degrees (0 = +X, CCW positive)
  delta_angle: number; ///< Arc sweep angle in degrees (positive = CCW)
}

export interface ARC_POINT {
  x: number; ///< Endpoint X coordinate
  y: number; ///< Endpoint Y coordinate
  is_arc: boolean; ///< True if this segment is an arc, false for line
  arc: ARC; ///< Arc parameters (only valid when is_arc is true)
}

const newArc = (): ARC => ({ cx: 0, cy: 0, radius: 0, start_angle: 0, delta_angle: 0 });

/** `ARC_POINT()`, `ARC_POINT( x, y )` and `ARC_POINT( x, y, arc )`. */
export function arcPoint(x = 0, y = 0, arc?: ARC): ARC_POINT {
  return arc ? { x, y, is_arc: true, arc: { ...arc } } : { x, y, is_arc: false, arc: newArc() };
}

const copyPt = (p: ARC_POINT): ARC_POINT => ({ ...p, arc: { ...p.arc } });

export enum PADS_FILE_TYPE {
  PCB, ///< PCB design file (POWERPCB, PADS-LAYOUT, etc.)
  LIB_LINE, ///< Library line items (drafting)
  LIB_SCH_DECAL, ///< Library schematic decals
  LIB_PCB_DECAL, ///< Library PCB decals (footprints)
  LIB_PART_TYPE, ///< Library part types
}

export interface FILE_HEADER {
  product: string;
  version: string;
  units: string;
  mode: string;
  encoding: string;
  file_type: PADS_FILE_TYPE;
}

export interface PARAMETERS {
  units: UNIT_TYPE;
  layer_count: number;
  origin: POINT;
  user_grid: number; ///< User-defined snap grid (USERGRID)
  thermal_line_width: number; ///< Thermal line width for THT (THERLINEWID)
  thermal_smd_width: number; ///< Thermal line width for SMD (THERSMDWID)
  thermal_flags: number; ///< Thermal relief flags (THERFLAGS)
  thermal_min_clearance: number; ///< Starved thermal minimum clearance (STMINCLEAR)
  thermal_min_spokes: number; ///< Starved thermal minimum spokes (STMINSPOKES)
  drill_oversize: number; ///< Drill oversize for plated holes (DRLOVERSIZE)
  default_signal_via: string; ///< Default signal routing via (VIAPSHVIA)
}

export interface DESIGN_RULES {
  min_clearance: number; ///< Minimum copper clearance (MINCLEAR)
  default_clearance: number; ///< Default copper clearance (DEFAULTCLEAR)
  min_track_width: number; ///< Minimum track width (MINTRACKWID)
  default_track_width: number; ///< Default track width (DEFAULTTRACKWID)
  min_via_size: number; ///< Minimum via outer diameter (MINVIASIZE)
  default_via_size: number; ///< Default via outer diameter (DEFAULTVIASIZE)
  min_via_drill: number; ///< Minimum via drill diameter (MINVIADRILL)
  default_via_drill: number; ///< Default via drill diameter (DEFAULTVIADRILL)
  hole_to_hole: number; ///< Minimum hole-to-hole spacing (HOLEHOLE)
  silk_clearance: number; ///< Minimum silkscreen clearance (SILKCLEAR)
  mask_clearance: number; ///< Solder mask clearance (MASKCLEAR)
  copper_edge_clearance: number; ///< Board outline clearance (OUTLINE_TO_*)
}

export const newDesignRules = (): DESIGN_RULES => ({
  min_clearance: 8.0,
  default_clearance: 10.0,
  min_track_width: 6.0,
  default_track_width: 10.0,
  min_via_size: 20.0,
  default_via_size: 40.0,
  min_via_drill: 10.0,
  default_via_drill: 20.0,
  hole_to_hole: 10.0,
  silk_clearance: 5.0,
  mask_clearance: 3.0,
  copper_edge_clearance: 10.0,
});

export interface ATTRIBUTE {
  visible: boolean;
  x: number;
  y: number;
  orientation: number;
  level: number;
  height: number;
  width: number;
  mirrored: boolean;
  hjust: string;
  vjust: string;
  right_reading: boolean;
  font_info: string;
  name: string; // "Ref.Des.", "Part Type", "VALUE", etc.
}

export const newAttribute = (): ATTRIBUTE => ({
  visible: true,
  x: 0,
  y: 0,
  orientation: 0,
  level: 0,
  height: 0,
  width: 0,
  mirrored: false,
  hjust: '',
  vjust: '',
  right_reading: false,
  font_info: '',
  name: '',
});

export interface PART {
  name: string;
  decal: string; ///< Primary decal (first in colon-separated list)
  part_type: string; ///< Part type name when using PARTTYPE@DECAL syntax
  alternate_decals: string[]; ///< Alternate decals (remaining after ':' splits)
  alt_decal_index: number; ///< ALT field from placement (-1 = use primary decal)
  value: string;
  units: string;
  location: POINT;
  rotation: number;
  bottom_layer: boolean;
  glued: boolean;
  explicit_decal: boolean; ///< True if decal was explicitly specified with @ syntax
  attributes: ATTRIBUTE[];
  reuse_instance: string; ///< Reuse block instance name (if member of reuse)
  reuse_part: string; ///< Original part ref des inside the reuse block
}

export interface NET_PIN {
  ref_des: string;
  pin_name: string;
  reuse_instance: string; ///< Reuse block instance name (if .REUSE. suffix)
  reuse_signal: string; ///< Reuse block signal name (if .REUSE. suffix)
}

const newNetPin = (): NET_PIN => ({
  ref_des: '',
  pin_name: '',
  reuse_instance: '',
  reuse_signal: '',
});

export interface NET {
  name: string;
  pins: NET_PIN[];
}

export interface NET_CLASS_DEF {
  name: string; ///< Net class name
  clearance: number; ///< Copper clearance (CLEARANCE)
  track_width: number; ///< Track width (TRACKWIDTH)
  via_size: number; ///< Via diameter (VIASIZE)
  via_drill: number; ///< Via drill diameter (VIADRILL)
  diff_pair_gap: number; ///< Differential pair gap (DIFFPAIRGAP)
  diff_pair_width: number; ///< Differential pair width (DIFFPAIRWIDTH)
  net_names: string[]; ///< Nets assigned to this class
}

const newNetClass = (): NET_CLASS_DEF => ({
  name: '',
  clearance: 0,
  track_width: 0,
  via_size: 0,
  via_drill: 0,
  diff_pair_gap: 0,
  diff_pair_width: 0,
  net_names: [],
});

const copyNetClass = (c: NET_CLASS_DEF): NET_CLASS_DEF => ({ ...c, net_names: [...c.net_names] });

export interface DIFF_PAIR_DEF {
  name: string; ///< Pair name
  positive_net: string; ///< Positive net name
  negative_net: string; ///< Negative net name
  gap: number; ///< Spacing between traces
  width: number; ///< Trace width
}

const newDiffPair = (): DIFF_PAIR_DEF => ({
  name: '',
  positive_net: '',
  negative_net: '',
  gap: 0,
  width: 0,
});

export interface TEARDROP {
  pad_width: number; ///< Teardrop width at pad side
  pad_length: number; ///< Teardrop length toward pad
  pad_flags: number; ///< Pad-side teardrop flags
  net_width: number; ///< Teardrop width at net side
  net_length: number; ///< Teardrop length toward net
  net_flags: number; ///< Net-side teardrop flags
  has_pad_teardrop: boolean;
  has_net_teardrop: boolean;
}

export interface JUMPER_MARKER {
  name: string; ///< Jumper part name
  is_start: boolean; ///< True if start (S), false if end (E)
  x: number;
  y: number;
}

export interface JUMPER_DEF {
  name: string; ///< Jumper name/reference designator
  via_enabled: boolean; ///< V flag: via enabled
  wirebond: boolean; ///< W flag: wirebond jumper
  display_silk: boolean; ///< D flag: display special silk
  glued: boolean; ///< G flag: glued
  min_length: number; ///< Minimum possible length
  max_length: number; ///< Maximum possible length
  length_increment: number; ///< Length increment
  padstack: string; ///< Pad stack for start pin (or both if end_padstack empty)
  end_padstack: string; ///< Pad stack for end pin (optional)
  labels: ATTRIBUTE[]; ///< Reference designator labels
}

export interface TRACK {
  layer: number;
  width: number;
  points: ARC_POINT[]; ///< Track points, may include arc segments
}

const copyTrack = (t: TRACK): TRACK => ({ ...t, points: t.points.map(copyPt) });

export interface PAD_STACK_LAYER {
  layer: number;
  shape: string; ///< Shape code: R, S, A, O, OF, RF, RT, ST, RA, SA, RC, OC
  sizeA: number; ///< Primary size (diameter or width)
  sizeB: number; ///< Secondary size (height for rectangles/ovals)
  offsetX: number; ///< Pad offset X from terminal position
  offsetY: number; ///< Pad offset Y from terminal position
  rotation: number; ///< Pad rotation angle in degrees
  drill: number; ///< Drill hole diameter (0 for SMD)
  plated: boolean; ///< True if drill is plated (PTH vs NPTH)
  inner_diameter: number; ///< Inner diameter for annular ring (0 = solid)
  corner_radius: number; ///< Corner radius magnitude (always positive)
  chamfered: boolean; ///< True if corners are chamfered (negative corner in PADS)
  finger_offset: number; ///< Finger pad offset along orientation axis
  slot_orientation: number; ///< Slot orientation in degrees (0-179.999)
  slot_length: number; ///< Slot length
  slot_offset: number; ///< Slot offset from electrical center
  thermal_spoke_orientation: number; ///< First spoke orientation in degrees
  thermal_outer_diameter: number; ///< Outer diameter of thermal or void in plane
  thermal_spoke_width: number; ///< Width of thermal spokes
  thermal_spoke_count: number; ///< Number of thermal spokes (typically 4)
}

export const newPadStackLayer = (): PAD_STACK_LAYER => ({
  layer: 0,
  shape: '',
  sizeA: 0,
  sizeB: 0,
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  drill: 0,
  plated: true,
  inner_diameter: 0,
  corner_radius: 0,
  chamfered: false,
  finger_offset: 0,
  slot_orientation: 0,
  slot_length: 0,
  slot_offset: 0,
  thermal_spoke_orientation: 0,
  thermal_outer_diameter: 0,
  thermal_spoke_width: 0,
  thermal_spoke_count: 0,
});

export enum VIA_TYPE {
  THROUGH, ///< Via spans all copper layers
  BLIND, ///< Via starts at top or bottom and ends at inner layer
  BURIED, ///< Via spans only inner layers
  MICROVIA, ///< Single-layer blind via (typically HDI)
}

export interface VIA_DEF {
  name: string;
  drill: number;
  size: number;
  stack: PAD_STACK_LAYER[];
  start_layer: number; ///< First PADS layer number in via span
  end_layer: number; ///< Last PADS layer number in via span
  via_type: VIA_TYPE; ///< Classified via type
  drill_start: number; ///< Drill start layer from file (for blind/buried vias)
  drill_end: number; ///< Drill end layer from file (for blind/buried vias)
  has_mask_front: boolean; ///< Stack includes top soldermask opening (layer 25)
  has_mask_back: boolean; ///< Stack includes bottom soldermask opening (layer 28)
}

export interface VIA {
  name: string; // Via type name
  location: POINT;
}

export enum POUR_STYLE {
  SOLID, ///< Solid filled pour (POUROUT, POLY)
  HATCHED, ///< Hatched pour (HATOUT)
  VOIDOUT, ///< Void/empty region (VOIDOUT)
}

export enum THERMAL_TYPE {
  NONE, ///< No thermal relief defined
  PAD, ///< Pad thermal relief (PADTHERM)
  VIA, ///< Via thermal relief (VIATHERM)
}

export interface POUR {
  name: string; ///< This pour record's name
  net_name: string;
  layer: number;
  priority: number;
  width: number;
  points: ARC_POINT[]; ///< Pour outline, may include arc segments
  is_cutout: boolean; ///< True if this is a cutout (POCUT) piece
  owner_pour: string; ///< Name of parent pour (7th field in header)
  style: POUR_STYLE; ///< Pour fill style
  hatch_grid: number; ///< Hatch grid spacing for hatched pours
  hatch_width: number; ///< Hatch line width
  thermal_type: THERMAL_TYPE;
  thermal_spoke_width: number; ///< Spoke width for thermal relief
  thermal_spoke_count: number; ///< Number of spokes (typically 4)
  thermal_gap: number; ///< Gap between pad and pour
}

export interface DECAL_ITEM {
  type: string; ///< CLOSED, OPEN, CIRCLE, COPCLS, TAG, etc.
  layer: number;
  width: number;
  points: ARC_POINT[]; ///< Shape points, may include arc segments
  pinnum: number; ///< Pin association for copper pieces (-1 = none, 0+ = pin index)
  restrictions: string; ///< Keepout restrictions (R,C,V,T,A) for KPTCLS/KPTCIR
  is_tag_open: boolean; ///< True if this is an opening TAG (level=1)
  is_tag_close: boolean; ///< True if this is a closing TAG (level=0)
}

export interface DECAL_PAD {
  pin_number: number; // 0 for default
  position: POINT;
  name: string; // e.g. "1", "A1"
  stack: PAD_STACK_LAYER[];
  custom_stack: boolean;
}

export interface TERMINAL {
  x: number;
  y: number;
  name: string; // Pin number
}

export interface PART_DECAL {
  name: string;
  units: string; // M, I, U, etc.
  items: DECAL_ITEM[];
  attributes: ATTRIBUTE[];
  terminals: TERMINAL[];
  pad_stacks: Map<number, PAD_STACK_LAYER[]>;
}

export interface SIGPIN {
  pin_number: string; ///< Pin number
  width: number; ///< Track width for connections
  signal_name: string; ///< Standard signal name (e.g., VCC, GND)
}

export enum PIN_ELEC_TYPE {
  UNDEFINED, ///< U - Undefined
  SOURCE, ///< S - Source pin
  BIDIRECTIONAL, ///< B - Bidirectional pin
  OPEN_COLLECTOR, ///< C - Open collector or or-tieable source
  TRISTATE, ///< T - Tri-state pin
  LOAD, ///< L - Load pin
  TERMINATOR, ///< Z - Terminator pin
  POWER, ///< P - Power pin
  GROUND, ///< G - Ground pin
}

export interface GATE_PIN {
  pin_number: string; ///< Electrical pin number
  swap_type: number; ///< Swap type (0 = not swappable)
  elec_type: PIN_ELEC_TYPE;
  func_name: string; ///< Optional functional name
}

export interface GATE_DEF {
  gate_swap_type: number; ///< Gate swap type (0 = not swappable)
  pins: GATE_PIN[]; ///< Pins in this gate
}

export interface PART_TYPE {
  name: string;
  decal_name: string;
  pin_pad_map: Map<string, number>; ///< Maps pin name to pad stack index
  attributes: Map<string, string>; ///< Attribute name-value pairs from {...} block
  signal_pins: SIGPIN[]; ///< Standard signal pin definitions
  gates: GATE_DEF[]; ///< Gate definitions for swap support
}

export interface ROUTE {
  net_name: string;
  tracks: TRACK[];
  vias: VIA[];
  pins: NET_PIN[]; ///< Pins connected to this net (from pin pair lines)
  teardrops: TEARDROP[]; ///< Teardrop locations in this route
  jumpers: JUMPER_MARKER[]; ///< Jumper start/end points in this route
}

export interface TEXT {
  content: string;
  location: POINT;
  height: number;
  width: number;
  layer: number;
  rotation: number;
  mirrored: boolean;
  hjust: string; ///< Horizontal justification: LEFT, CENTER, RIGHT
  vjust: string; ///< Vertical justification: UP, CENTER, DOWN
  ndim: number; ///< Dimension number for auto-dimensioning text (0 if not used)
  reuse_instance: string; ///< Reuse block instance name (if .REUSE. suffix)
  font_style: string; ///< Font style (Regular, Bold, Italic, Underline, or combinations)
  font_height: number; ///< Font height for text box calculation (optional)
  font_descent: number; ///< Font descent for text box calculation (optional)
  font_face: string; ///< Font face name
}

export const newText = (): TEXT => ({
  content: '',
  location: { x: 0, y: 0 },
  height: 0,
  width: 0,
  layer: 0,
  rotation: 0,
  mirrored: false,
  hjust: '',
  vjust: '',
  ndim: 0,
  reuse_instance: '',
  font_style: '',
  font_height: 0,
  font_descent: 0,
  font_face: '',
});

export interface LINE {
  layer: number;
  width: number;
  start: POINT;
  end: POINT;
}

export enum LINE_STYLE {
  SOLID = 0,
  DASHED = 1,
  DOTTED = 2,
  DASH_DOTTED = 3,
  DASH_DOUBLE_DOTTED = 4,
}

export interface GRAPHIC_LINE {
  name: string; ///< Item name
  layer: number; ///< Layer number
  width: number; ///< Line width
  style: LINE_STYLE; ///< Line style (solid, dashed, etc.)
  closed: boolean; ///< True if shape is closed (polygon/circle)
  filled: boolean; ///< True if shape should be filled
  points: ARC_POINT[]; ///< Shape vertices, may include arcs
  reuse_instance: string; ///< Reuse block instance name (if member of reuse)
}

export interface POLYLINE {
  layer: number;
  width: number;
  closed: boolean; ///< True if polyline forms a closed shape
  points: ARC_POINT[]; ///< Polyline vertices, may include arcs
}

export interface COPPER_SHAPE {
  name: string; ///< Shape name
  net_name: string; ///< Associated net (empty if unconnected)
  layer: number; ///< Layer number
  width: number; ///< Line width (for open polylines)
  filled: boolean; ///< True for filled shapes (COPCLS, COPCIR)
  is_cutout: boolean; ///< True for cutouts (COPCUT, COPCCO)
  outline: ARC_POINT[]; ///< Shape outline vertices
}

export enum PADS_LAYER_FUNCTION {
  UNKNOWN,
  ROUTING, ///< Copper routing layer
  PLANE, ///< Power/ground plane
  MIXED, ///< Mixed signal/plane
  UNASSIGNED, ///< Unassigned layer
  SOLDER_MASK, ///< Solder mask
  PASTE_MASK, ///< Solder paste mask
  SILK_SCREEN, ///< Silkscreen/legend
  ASSEMBLY, ///< Assembly drawing
  DOCUMENTATION, ///< Documentation layer
  DRILL, ///< Drill drawing
}

export interface LAYER_INFO {
  number: number; ///< PADS layer number
  name: string; ///< Layer name
  layer_type: PADS_LAYER_FUNCTION; ///< Parsed layer type from file
  is_copper: boolean; ///< True if copper layer
  required: boolean; ///< True if layer must be mapped
  layer_thickness: number; ///< Dielectric thickness (BASIC units)
  copper_thickness: number; ///< Copper foil thickness (BASIC units)
  dielectric_constant: number; ///< Relative permittivity (Er)
}

/** `LAYER_INFO{}`: `number` and the booleans value-initialised. */
export const newLayerInfo = (
  number = 0,
  name = '',
  layer_type = PADS_LAYER_FUNCTION.UNKNOWN,
  is_copper = false,
  required = false,
): LAYER_INFO => ({
  number,
  name,
  layer_type,
  is_copper,
  required,
  layer_thickness: 0,
  copper_thickness: 0,
  dielectric_constant: 0,
});

export interface REUSE_NET {
  merge: boolean; ///< True to merge nets, false to rename
  name: string; ///< Original net name from reuse definition
}

export interface REUSE_INSTANCE {
  instance_name: string; ///< Instance name
  part_naming: string; ///< Part naming scheme (may be multi-word like "PREFIX pref")
  net_naming: string; ///< Net naming scheme (may be multi-word like "SUFFIX suf")
  location: POINT; ///< Placement location
  rotation: number; ///< Rotation angle in degrees
  glued: boolean; ///< True if glued in place
}

export interface REUSE_BLOCK {
  name: string; ///< Block type name
  timestamp: number; ///< Creation/modification timestamp
  part_naming: string; ///< Default part naming scheme
  net_naming: string; ///< Default net naming scheme
  part_names: string[]; ///< Parts contained in this block
  nets: REUSE_NET[]; ///< Nets contained in this block with merge flags
  instances: REUSE_INSTANCE[]; ///< Placements of this block
}

export interface CLUSTER {
  name: string; ///< Cluster name/identifier
  id: number; ///< Cluster ID number
  net_names: string[]; ///< Nets belonging to this cluster
  segment_refs: string[]; ///< References to route segments in cluster
}

export interface TEST_POINT {
  type: string; ///< VIA or PIN
  x: number; ///< X coordinate
  y: number; ///< Y coordinate
  side: number; ///< Probe side (0=through, 1=top, 2=bottom)
  net_name: string; ///< Net this test point connects to
  symbol_name: string; ///< Symbol/pad name for the test point
}

export interface DIMENSION {
  name: string; ///< Dimension identifier
  x: number; ///< Origin X coordinate
  y: number; ///< Origin Y coordinate
  crossbar_pos: number; ///< Crossbar position (Y for horizontal, X for vertical)
  is_horizontal: boolean; ///< True for horizontal dimension
  layer: number; ///< Layer for dimension graphics
  points: POINT[]; ///< Dimension geometry points (measurement endpoints)
  text: string; ///< Dimension text/value
  text_height: number; ///< Text height
  text_width: number; ///< Text width
  rotation: number; ///< Text rotation angle
}

export enum KEEPOUT_TYPE {
  ALL, ///< All objects
  ROUTE, ///< Routing keepout (traces)
  VIA, ///< Via keepout
  COPPER, ///< Copper pour keepout
  PLACEMENT, ///< Component placement keepout
}

export interface KEEPOUT {
  type: KEEPOUT_TYPE; ///< Type of keepout
  outline: ARC_POINT[]; ///< Keepout boundary
  layers: number[]; ///< Affected layers (empty = all)
  no_traces: boolean; ///< Prohibit traces (R restriction)
  no_vias: boolean; ///< Prohibit vias (V restriction)
  no_copper: boolean; ///< Prohibit copper pours (C restriction)
  no_components: boolean; ///< Prohibit component placement (P restriction)
  height_restriction: boolean; ///< Component height restriction (H restriction)
  max_height: number; ///< Maximum component height when height_restriction is true
  no_test_points: boolean; ///< Prohibit test points (T restriction)
  no_accordion: boolean; ///< Prohibit accordion flex (A restriction for accordion, not all)
}

/** A `std::map`'s entries in key order (byte order: the keys are byte strings). */
export function sortedMap<K extends string | number, V>(aMap: ReadonlyMap<K, V>): [K, V][] {
  return [...aMap].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** C `isdigit` on a byte. */
const isdigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';

/** C `isalpha` on a byte ("C" locale). */
const isalpha = (c: string): boolean => /^[A-Za-z]$/.test(c);

/** `line[0]` of a std::string (the NUL when empty). */
const first = (s: string): string => s[0] ?? '\0';

/** `std::stoi( str, &pos, base )`: the value and the characters used, or null where it throws. */
function stoiPos(aStr: string, aBase = 10): { v: number; pos: number } | null {
  let i = 0;

  while (i < aStr.length && ' \t\n\v\f\r'.includes(aStr[i]!)) i++;

  let neg = false;

  if (aStr[i] === '+' || aStr[i] === '-') {
    neg = aStr[i] === '-';
    i++;
  }

  let base = aBase;

  if (base === 0) {
    if (
      aStr[i] === '0' &&
      (aStr[i + 1] === 'x' || aStr[i + 1] === 'X') &&
      /[0-9a-fA-F]/.test(aStr[i + 2] ?? '')
    ) {
      base = 16;
      i += 2;
    } else if (aStr[i] === '0') {
      base = 8;
    } else {
      base = 10;
    }
  }

  const start = i;
  let v = 0n;

  for (;;) {
    const c = aStr[i];
    if (c === undefined) break;
    const d = Number.parseInt(c, 36);
    if (Number.isNaN(d) || d >= base) break;
    v = v * BigInt(base) + BigInt(d);
    i++;
  }

  if (i === start) return null;

  const r = Number(neg ? -v : v);

  if (r < INT_MIN || r > INT_MAX) return null;

  return { v: r, pos: i };
}

/** `expandShortcutPattern`: "R{1-4}" → R1 … R4. */
function expandShortcutPattern(aPattern: string): string[] {
  const result: string[] = [];

  const braceStart = aPattern.indexOf('{');
  const braceEnd = aPattern.indexOf('}');

  if (braceStart < 0 || braceEnd < 0 || braceEnd <= braceStart) {
    result.push(aPattern);
    return result;
  }

  const prefix = aPattern.substring(0, braceStart);
  const suffix = braceEnd + 1 < aPattern.length ? aPattern.substring(braceEnd + 1) : '';
  const range = aPattern.substring(braceStart + 1, braceEnd);

  const dashPos = range.indexOf('-');

  if (dashPos < 0) {
    result.push(aPattern);
    return result;
  }

  const start = ParseInt(range.substring(0, dashPos), INT_MIN, 'shortcut range');
  const end = ParseInt(range.substring(dashPos + 1), INT_MIN, 'shortcut range');

  if (start === INT_MIN || end === INT_MIN) {
    result.push(aPattern);
    return result;
  }

  const MAX_EXPANSION = 10000;

  if (Math.abs(end - start) > MAX_EXPANSION) {
    result.push(aPattern);
    return result;
  }

  for (let i = start; i <= end; ++i) result.push(`${prefix}${i}${suffix}`);

  return result;
}

/** The arc a PADS `x y startTenths deltaTenths minX minY maxX maxY` corner describes. */
function bboxArc(
  iss: ISTRINGSTREAM,
  xloc: number,
  yloc: number,
  dx: number,
  dy: number,
  out: ARC_POINT[],
): void {
  const a = iss.int();
  const d = a === null ? null : iss.int();
  const x0 = d === null ? null : iss.dbl();
  const y0 = x0 === null ? null : iss.dbl();
  const x1 = y0 === null ? null : iss.dbl();
  const y1 = x1 === null ? null : iss.dbl();

  if (a !== null && d !== null && x0 !== null && y0 !== null && x1 !== null && y1 !== null) {
    const cx = (x0 + x1) / 2.0;
    const cy = (y0 + y1) / 2.0;
    const radius = (x1 - x0) / 2.0;
    const startAngle = a / 10.0;
    const deltaAngle = d / 10.0;
    const startAngleRad = (startAngle * Math.PI) / 180.0;
    const startX = cx + radius * cos(startAngleRad);
    const startY = cy + radius * sin(startAngleRad);
    const endAngleRad = ((startAngle + deltaAngle) * Math.PI) / 180.0;
    const endX = cx + radius * cos(endAngleRad);
    const endY = cy + radius * sin(endAngleRad);

    out.push(arcPoint(xloc + startX, yloc + startY));
    out.push(
      arcPoint(xloc + endX, yloc + endY, {
        cx: xloc + cx,
        cy: yloc + cy,
        radius,
        start_angle: startAngle,
        delta_angle: deltaAngle,
      }),
    );
  } else {
    out.push(arcPoint(xloc + dx, yloc + dy));
  }
}

/** A full-circle piece: its two diameter points on the next line(s). */
function circleFromLines(
  readLine: () => string | null,
  corners: number,
  xloc: number,
  yloc: number,
): ARC_POINT {
  let x1 = 0;
  let y1 = 0;
  let x2 = 0;
  let y2 = 0;

  let line = readLine();

  if (line !== null) {
    const c1 = new ISTRINGSTREAM(line);
    x1 = c1.readDouble(x1);
    y1 = c1.readDouble(y1);
  }

  if (corners >= 2) {
    line = readLine();

    if (line !== null) {
      const c2 = new ISTRINGSTREAM(line);
      x2 = c2.readDouble(x2);
      y2 = c2.readDouble(y2);
    }
  }

  const cx = xloc + (x1 + x2) / 2.0;
  const cy = yloc + (y1 + y2) / 2.0;
  const radius = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)) / 2.0;

  return arcPoint(cx + radius, cy, { cx, cy, radius, start_angle: 0.0, delta_angle: 360.0 });
}

export class PARSER {
  private m_parameters: PARAMETERS = {
    units: UNIT_TYPE.MILS,
    layer_count: 2,
    origin: { x: 0, y: 0 },
    user_grid: 0.0,
    thermal_line_width: 30.0,
    thermal_smd_width: 20.0,
    thermal_flags: 0,
    thermal_min_clearance: 5.0,
    thermal_min_spokes: 4,
    drill_oversize: 0.0,
    default_signal_via: '',
  };

  private m_parts: PART[] = [];
  private m_nets: NET[] = [];
  private m_routes: ROUTE[] = [];
  private m_texts: TEXT[] = [];
  private m_lines: LINE[] = [];
  private m_board_outlines: POLYLINE[] = [];
  private m_pours: POUR[] = [];
  private m_via_defs = new Map<string, VIA_DEF>();
  private m_decals = new Map<string, PART_DECAL>();
  private m_part_types = new Map<string, PART_TYPE>();
  private m_part_instance_attrs = new Map<string, Map<string, string>>();
  private m_reuse_blocks = new Map<string, REUSE_BLOCK>();
  private m_clusters: CLUSTER[] = [];
  private m_test_points: TEST_POINT[] = [];
  private m_dimensions: DIMENSION[] = [];
  private m_design_rules: DESIGN_RULES = newDesignRules();
  private m_net_classes: NET_CLASS_DEF[] = [];
  private m_diff_pairs: DIFF_PAIR_DEF[] = [];
  private m_keepouts: KEEPOUT[] = [];
  private m_jumper_defs: JUMPER_DEF[] = [];
  private m_copper_shapes: COPPER_SHAPE[] = [];
  private m_graphic_lines: GRAPHIC_LINE[] = [];
  private m_layer_defs = new Map<number, LAYER_INFO>();
  private m_file_header: FILE_HEADER = {
    product: '',
    version: '',
    units: '',
    mode: '',
    encoding: '',
    file_type: PADS_FILE_TYPE.PCB,
  };
  private m_is_basic_units = false;
  private m_has_font_lines = true;
  private m_pushed_line: string | null = null;

  // the file's lines (std::getline on the byte stream), and where the reader is
  private m_lines_in: string[] = [];
  private m_next = 0;

  GetParameters(): PARAMETERS {
    return this.m_parameters;
  }
  GetParts(): readonly PART[] {
    return this.m_parts;
  }
  GetNets(): readonly NET[] {
    return this.m_nets;
  }
  GetRoutes(): readonly ROUTE[] {
    return this.m_routes;
  }
  GetTexts(): readonly TEXT[] {
    return this.m_texts;
  }
  GetLines(): readonly LINE[] {
    return this.m_lines;
  }
  GetBoardOutlines(): readonly POLYLINE[] {
    return this.m_board_outlines;
  }
  GetPours(): readonly POUR[] {
    return this.m_pours;
  }
  GetViaDefs(): ReadonlyMap<string, VIA_DEF> {
    return this.m_via_defs;
  }
  GetPartDecals(): ReadonlyMap<string, PART_DECAL> {
    return this.m_decals;
  }
  GetPartTypes(): ReadonlyMap<string, PART_TYPE> {
    return this.m_part_types;
  }
  GetPartInstanceAttrs(): ReadonlyMap<string, Map<string, string>> {
    return this.m_part_instance_attrs;
  }
  GetReuseBlocks(): ReadonlyMap<string, REUSE_BLOCK> {
    return this.m_reuse_blocks;
  }
  GetClusters(): readonly CLUSTER[] {
    return this.m_clusters;
  }
  GetTestPoints(): readonly TEST_POINT[] {
    return this.m_test_points;
  }
  GetDimensions(): readonly DIMENSION[] {
    return this.m_dimensions;
  }
  GetDesignRules(): DESIGN_RULES {
    return this.m_design_rules;
  }
  GetNetClasses(): readonly NET_CLASS_DEF[] {
    return this.m_net_classes;
  }
  GetDiffPairs(): readonly DIFF_PAIR_DEF[] {
    return this.m_diff_pairs;
  }
  GetKeepouts(): readonly KEEPOUT[] {
    return this.m_keepouts;
  }
  GetJumperDefs(): readonly JUMPER_DEF[] {
    return this.m_jumper_defs;
  }
  GetCopperShapes(): readonly COPPER_SHAPE[] {
    return this.m_copper_shapes;
  }
  GetGraphicLines(): readonly GRAPHIC_LINE[] {
    return this.m_graphic_lines;
  }
  GetFileHeader(): FILE_HEADER {
    return this.m_file_header;
  }
  IsBasicUnits(): boolean {
    return this.m_is_basic_units;
  }

  /** `Parse( aFileName )`, over the file's bytes as a byte string. */
  Parse(aContent: string): void {
    // std::getline: split on '\n'; a final '\n' starts no further line
    const lines = aContent.split('\n');

    if (lines.length > 0 && lines[lines.length - 1] === '' && aContent.endsWith('\n')) lines.pop();

    if (aContent === '') lines.length = 0;

    this.m_lines_in = lines;
    this.m_next = 0;

    let line = this.readLine();

    if (line === null) throw new Error('Empty file');

    this.m_is_basic_units = false;
    this.m_file_header.file_type = PADS_FILE_TYPE.PCB;

    if (line.length > 2 && line[0] === '*' && line[line.length - 1] === '*') {
      const header = line.substring(1, line.length - 1);
      this.m_file_header.product = header;

      if (header.includes('LIBRARY-LINE-ITEMS') || header.includes('LIBRARY-LINE')) {
        this.m_file_header.file_type = PADS_FILE_TYPE.LIB_LINE;
      } else if (header.includes('LIBRARY-SCH-DECALS')) {
        this.m_file_header.file_type = PADS_FILE_TYPE.LIB_SCH_DECAL;
      } else if (header.includes('LIBRARY-PCB-DECALS') || header.includes('LIBRARY-DECALS')) {
        this.m_file_header.file_type = PADS_FILE_TYPE.LIB_PCB_DECAL;
      } else if (header.includes('LIBRARY-PART-TYPES')) {
        this.m_file_header.file_type = PADS_FILE_TYPE.LIB_PART_TYPE;
      }

      const v_pos = header.lastIndexOf('-V');

      if (v_pos >= 0) this.m_file_header.version = header.substring(v_pos + 1);

      this.m_parameters.units = UNIT_TYPE.MILS;
    } else if (line.length > 2 && line[0] === '!') {
      let close_pos = line.indexOf('!', 1);

      if (close_pos < 0) close_pos = line.length;

      const header = line.substring(1, close_pos);

      const parts = header.split('-');

      if (parts.length >= 4) {
        this.m_file_header.product = parts[1]!;
        this.m_file_header.version = parts[2]!;
        this.m_file_header.units = parts[3]!;

        if (parts.length >= 5) this.m_file_header.mode = parts[4]!;

        if (parts.length >= 6) this.m_file_header.encoding = parts[5]!;
      } else if (parts.length >= 2) {
        this.m_file_header.product = parts[0]!;
        this.m_file_header.version = parts[1]!;

        if (parts.length >= 3) this.m_file_header.units = parts[2]!;
      }

      const u = this.m_file_header.units;

      if (u === 'BASIC') this.m_is_basic_units = true;
      else if (u === 'MILS' || u === 'MIL') this.m_parameters.units = UNIT_TYPE.MILS;
      else if (u === 'MM' || u === 'METRIC') this.m_parameters.units = UNIT_TYPE.METRIC;
      else if (u === 'INCH' || u === 'INCHES') this.m_parameters.units = UNIT_TYPE.INCHES;
    } else if (line.includes('BASIC')) {
      this.m_is_basic_units = true;
    }

    const majorVer = this.parseMajorVersion();
    this.m_has_font_lines = majorVer === 0 || majorVer >= 9;

    for (line = this.readLine(); line !== null; line = this.readLine()) {
      if (line === '') continue;

      if (line.startsWith('*PCB*')) this.parseSectionPCB();
      else if (line.startsWith('*PART*')) this.parseSectionPARTS();
      else if (line.startsWith('*NET*')) this.parseSectionNETS();
      else if (line.startsWith('*ROUTE*')) this.parseSectionROUTES();
      else if (line.startsWith('*TEXT*')) this.parseSectionTEXT();
      else if (line.startsWith('*BOARD*')) this.parseSectionBOARD();
      else if (line.startsWith('*LINES*')) this.parseSectionLINES();
      else if (line.startsWith('*VIA*')) this.parseSectionVIA();
      else if (line.startsWith('*POUR*')) this.parseSectionPOUR();
      else if (line.startsWith('*PARTDECAL*')) this.parseSectionPARTDECAL();
      else if (line.startsWith('*PARTTYPE*')) this.parseSectionPARTTYPE();
      else if (line.startsWith('*REUSE*')) this.parseSectionREUSE();
      else if (line.startsWith('*CLUSTER*')) this.parseSectionCLUSTER();
      else if (line.startsWith('*JUMPER*')) this.parseSectionJUMPER();
      else if (line.startsWith('*TESTPOINT*')) this.parseSectionTESTPOINT();
      else if (line.startsWith('*NETCLASS*') || line.startsWith('*NETDEF*'))
        this.parseSectionNETCLASS();
      else if (line.startsWith('*DIFFPAIR*') || line.startsWith('*DIFFPAIRS*'))
        this.parseSectionDIFFPAIR();
      else if (line.startsWith('LAYER MILS') || line.startsWith('LAYER METRIC'))
        this.parseSectionLAYERDEFS();
      else if (line.startsWith('*MISC*')) this.parseSectionMISC();
    }
  }

  /** `readLine`: the next non-blank, non-*REMARK* line, trimmed of " \t\r\n". */
  private readLine(): string | null {
    if (this.m_pushed_line !== null) {
      const l = this.m_pushed_line;
      this.m_pushed_line = null;
      return l;
    }

    while (this.m_next < this.m_lines_in.length) {
      let l = this.m_lines_in[this.m_next++]!;

      l = l.replace(/^[ \t\r\n]+/, '').replace(/[ \t\r\n]+$/, '');

      if (l === '') continue;

      if (l.startsWith('*REMARK*')) continue;

      return l;
    }

    return null;
  }

  private pushBackLine(aLine: string): void {
    this.m_pushed_line = aLine;
  }

  private parseMajorVersion(): number {
    const ver = this.m_file_header.version;
    let start = 0;

    if (ver !== '' && (ver[0] === 'V' || ver[0] === 'v')) start = 1;

    const dot = ver.indexOf('.', start);
    const major_str = dot >= 0 ? ver.substring(start, dot) : ver.substring(start);

    const r = stoiPos(major_str);
    return r === null ? 0 : r.v;
  }

  private parseSectionPCB(): void {
    const P = this.m_parameters;
    const R = this.m_design_rules;

    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      const iss = new ISTRINGSTREAM(line);
      const token = iss.readString();

      if (token === 'UNITS') {
        const val = iss.readString();

        if (val === '0') P.units = UNIT_TYPE.MILS;
        else if (val === '1') P.units = UNIT_TYPE.METRIC;
        else if (val === '2') P.units = UNIT_TYPE.INCHES;
      } else if (token === 'USERGRID') P.user_grid = iss.readDouble(P.user_grid);
      else if (token === 'MAXIMUMLAYER') P.layer_count = iss.readInt(P.layer_count);
      else if (token === 'ORIGIN') {
        P.origin.x = iss.readDouble(P.origin.x);
        P.origin.y = iss.readDouble(P.origin.y);
      } else if (token === 'THERLINEWID')
        P.thermal_line_width = iss.readDouble(P.thermal_line_width);
      else if (token === 'THERSMDWID') P.thermal_smd_width = iss.readDouble(P.thermal_smd_width);
      else if (token === 'THERFLAGS') {
        const flags_str = iss.readString();
        const r = stoiPos(flags_str, 0);
        P.thermal_flags = r === null ? 0 : r.v;
      } else if (token === 'DRLOVERSIZE') P.drill_oversize = iss.readDouble(P.drill_oversize);
      else if (token === 'VIAPSHVIA') P.default_signal_via = iss.readString(P.default_signal_via);
      else if (token === 'STMINCLEAR')
        P.thermal_min_clearance = iss.readDouble(P.thermal_min_clearance);
      else if (token === 'STMINSPOKES') P.thermal_min_spokes = iss.readInt(P.thermal_min_spokes);
      else if (token === 'MINCLEAR') R.min_clearance = iss.readDouble(R.min_clearance);
      else if (token === 'DEFAULTCLEAR') R.default_clearance = iss.readDouble(R.default_clearance);
      else if (token === 'MINTRACKWID') R.min_track_width = iss.readDouble(R.min_track_width);
      else if (token === 'DEFAULTTRACKWID')
        R.default_track_width = iss.readDouble(R.default_track_width);
      else if (token === 'MINVIASIZE') R.min_via_size = iss.readDouble(R.min_via_size);
      else if (token === 'DEFAULTVIASIZE') R.default_via_size = iss.readDouble(R.default_via_size);
      else if (token === 'MINVIADRILL') R.min_via_drill = iss.readDouble(R.min_via_drill);
      else if (token === 'DEFAULTVIADRILL')
        R.default_via_drill = iss.readDouble(R.default_via_drill);
      else if (token === 'HOLEHOLE') R.hole_to_hole = iss.readDouble(R.hole_to_hole);
      else if (token === 'SILKCLEAR') R.silk_clearance = iss.readDouble(R.silk_clearance);
      else if (token === 'MASKCLEAR') R.mask_clearance = iss.readDouble(R.mask_clearance);
    }
  }

  /** The attribute line of a part, jumper or decal label (after its first token). */
  private readAttributeFields(iss: ISTRINGSTREAM, attr: ATTRIBUTE): string | null {
    attr.x = iss.readDouble(attr.x);
    attr.y = iss.readDouble(attr.y);
    attr.orientation = iss.readDouble(attr.orientation);
    attr.level = iss.readInt(attr.level);
    attr.height = iss.readDouble(attr.height);
    attr.width = iss.readDouble(attr.width);
    const mirrored_str = iss.readString();
    attr.hjust = iss.readString(attr.hjust);
    attr.vjust = iss.readString(attr.vjust);

    return iss.fail() ? null : mirrored_str;
  }

  private static isVisibleToken(t: string): boolean {
    return t === 'VALUE' || t === 'FULL_NAME' || t === 'NAME' || t === 'FULL_BOTH' || t === 'BOTH';
  }

  private parseSectionPARTS(): void {
    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (line.indexOf('*REMARK*') === 0) continue;

      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      if (line.startsWith('}') || line.startsWith('{')) continue;

      const iss = new ISTRINGSTREAM(line);
      const part: PART = {
        name: '',
        decal: '',
        part_type: '',
        alternate_decals: [],
        alt_decal_index: -1,
        value: '',
        units: '',
        location: { x: 0.0, y: 0.0 },
        rotation: 0.0,
        bottom_layer: false,
        glued: false,
        explicit_decal: false,
        attributes: [],
        reuse_instance: '',
        reuse_part: '',
      };

      const name_token = iss.readString();
      const parttype_string = iss.readString();
      part.location.x = iss.readDouble(part.location.x);
      part.location.y = iss.readDouble(part.location.y);
      part.rotation = iss.readDouble(part.rotation);

      if (iss.fail()) continue;

      const expanded_names = expandShortcutPattern(name_token);
      const is_shortcut = expanded_names.length > 1;
      part.name = expanded_names[0]!;

      const at_pos = parttype_string.indexOf('@');

      if (at_pos >= 0) {
        part.part_type = parttype_string.substring(0, at_pos);
        part.decal = parttype_string.substring(at_pos + 1);
        part.explicit_decal = true;
      } else {
        const pieces = parttype_string.split(':');
        part.decal = pieces[0]!;
        for (const d of pieces.slice(1)) part.alternate_decals.push(d);
      }

      const tokens: string[] = [];

      for (let t = iss.str(); t !== null; t = iss.str()) tokens.push(t);

      let labels = 0;

      for (let i = 0; i < tokens.length; ++i) {
        const t = tokens[i]!;

        if (t === 'G') part.glued = true;
        else if (t === 'M') part.bottom_layer = true;

        if (i === 2) {
          const alt = ParseInt(t, -1, 'PART ALT');

          if (alt >= 0) part.alt_decal_index = alt;
        }

        if (i === tokens.length - 1) {
          const r = stoiPos(t);
          labels = r === null || r.pos !== t.length ? 0 : r.v;
        }
      }

      line = this.readLine();

      if (line !== null) {
        if (line.indexOf('.REUSE.') === 0) {
          const riss = new ISTRINGSTREAM(line);
          riss.readString(); // reuse_keyword
          part.reuse_instance = riss.readString(part.reuse_instance);
          part.reuse_part = riss.readString(part.reuse_part);
        } else {
          this.pushBackLine(line);
        }
      }

      for (let i = 0; i < labels; ++i) {
        const attr = newAttribute();

        line = this.readLine();
        if (line === null) break;

        const iss_attr = new ISTRINGSTREAM(line);
        const visible_str = iss_attr.readString();
        const mirrored_str = this.readAttributeFields(iss_attr, attr);

        if (mirrored_str !== null) {
          attr.visible = PARSER.isVisibleToken(visible_str);
          attr.mirrored = mirrored_str === 'M';
          const right_reading_str = iss_attr.readString();
          attr.right_reading = right_reading_str === 'Y' || right_reading_str === 'ORTHO';
        }

        if (this.m_has_font_lines) {
          line = this.readLine();
          if (line === null) break;

          attr.font_info = line;
        }

        line = this.readLine();
        if (line === null) break;

        attr.name = line;
        part.attributes.push(attr);
      }

      this.m_parts.push(part);

      if (is_shortcut) {
        for (let i = 1; i < expanded_names.length; ++i) {
          const additional_part: PART = {
            ...part,
            location: { ...part.location },
            alternate_decals: [...part.alternate_decals],
            attributes: part.attributes.map((a) => ({ ...a })),
            name: expanded_names[i]!,
          };
          this.m_parts.push(additional_part);
        }
      }
    }
  }

  private parseSectionNETS(): void {
    let current_net: NET | null = null;

    const parsePinToken = (token: string, pin: NET_PIN): boolean => {
      const dot_pos = token.indexOf('.');

      if (dot_pos < 0) return false;

      pin.ref_des = token.substring(0, dot_pos);
      pin.pin_name = token.substring(dot_pos + 1);
      return true;
    };

    const expandShortcutPin = (token: string): string[] => {
      let results: string[] = [];

      if (!token.includes('{')) {
        results.push(token);
        return results;
      }

      interface RangePart {
        prefix: string;
        start: number;
        end: number;
        is_range: boolean;
      }

      const parts: RangePart[] = [];
      let pos = 0;
      let current_prefix = '';

      while (pos < token.length) {
        if (token[pos] === '{') {
          const close_pos = token.indexOf('}', pos);

          if (close_pos < 0) {
            results.push(token);
            return results;
          }

          const range_str = token.substring(pos + 1, close_pos);
          const dash_pos = range_str.indexOf('-');

          if (dash_pos >= 0) {
            const part: RangePart = {
              prefix: current_prefix,
              is_range: true,
              start: ParseInt(range_str.substring(0, dash_pos), INT_MIN, 'net range'),
              end: ParseInt(range_str.substring(dash_pos + 1), INT_MIN, 'net range'),
            };

            if (part.start === INT_MIN || part.end === INT_MIN) {
              results.push(token);
              return results;
            }

            parts.push(part);
            current_prefix = '';
          } else {
            current_prefix += range_str;
          }

          pos = close_pos + 1;
        } else {
          current_prefix += token[pos];
          pos++;
        }
      }

      if (current_prefix !== '' || parts.length === 0)
        parts.push({ prefix: current_prefix, is_range: false, start: 0, end: 0 });

      results.push('');

      for (const part of parts) {
        const new_results: string[] = [];

        if (part.is_range) {
          for (const base of results) {
            const step = part.start <= part.end ? 1 : -1;

            for (let i = part.start; step > 0 ? i <= part.end : i >= part.end; i += step)
              new_results.push(`${base}${part.prefix}${i}`);
          }
        } else {
          for (const base of results) new_results.push(base + part.prefix);
        }

        results = new_results;
      }

      return results;
    };

    const addPins = (tok: string): void => {
      for (const expanded of expandShortcutPin(tok)) {
        const pin = newNetPin();

        if (parsePinToken(expanded, pin)) current_net!.pins.push(pin);
      }
    };

    const reuse = (iss: ISTRINGSTREAM): void => {
      const instance = iss.readString();
      const rsignal = iss.readString();

      if (!iss.fail() && current_net!.pins.length > 0) {
        const last = current_net!.pins[current_net!.pins.length - 1]!;
        last.reuse_instance = instance;
        last.reuse_signal = rsignal;
      }
    };

    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      const iss = new ISTRINGSTREAM(line);
      let token = iss.readString();

      if (token === 'SIGNAL') {
        const net: NET = { name: '', pins: [] };
        net.name = iss.readString(net.name);
        this.m_nets.push(net);
        current_net = net;

        for (let pin_token = iss.str(); pin_token !== null; pin_token = iss.str()) {
          if (pin_token === '.REUSE.') {
            reuse(iss);
            continue;
          }

          addPins(pin_token);
        }
      } else if (current_net) {
        // do { ... } while( iss >> token ): `continue` still reads the next token
        for (;;) {
          if (token === '.REUSE.') reuse(iss);
          else addPins(token);

          token = iss.readString(token);

          if (iss.fail()) break;
        }
      }
    }
  }

  /** One pad stack line's shape-specific fields, as the VIA and PARTDECAL readers share. */
  private readShapeFields(
    ss: ISTRINGSTREAM,
    shape: string,
    layer_data: PAD_STACK_LAYER,
    aRfCorner: boolean,
  ): void {
    const corner = (c: number): void => {
      if (c < 0) {
        layer_data.corner_radius = -c;
        layer_data.chamfered = true;
      } else {
        layer_data.corner_radius = c;
      }
    };

    if (shape === 'R') {
      // nothing more
    } else if (shape === 'S') {
      const c = ss.dbl();

      if (c !== null) corner(c);
    } else if (shape === 'RA' || shape === 'SA') {
      // nothing more
    } else if (shape === 'A') {
      const intd = ss.dbl();

      if (intd !== null) layer_data.inner_diameter = intd;
    } else if (shape === 'OF' || shape === 'RF') {
      const ori = ss.dbl();
      const length = ori === null ? null : ss.dbl();
      const offset = length === null ? null : ss.dbl();

      if (ori !== null && length !== null && offset !== null) {
        layer_data.rotation = ori;
        layer_data.sizeB = length;
        layer_data.finger_offset = offset;

        if (shape === 'RF' && aRfCorner) {
          const c = ss.dbl();

          if (c !== null) corner(c);
        }
      }
    } else if (shape === 'RT' || shape === 'ST') {
      const ori = ss.dbl();
      const intd = ori === null ? null : ss.dbl();
      const spkwid = intd === null ? null : ss.dbl();
      const spknum = spkwid === null ? null : ss.int();

      if (ori !== null && intd !== null && spkwid !== null && spknum !== null) {
        layer_data.thermal_spoke_orientation = ori;
        layer_data.thermal_outer_diameter = intd;
        layer_data.thermal_spoke_width = spkwid;
        layer_data.thermal_spoke_count = spknum;
      }
    } else if (shape === 'O' || shape === 'OC') {
      // nothing more
    } else if (shape === 'RC') {
      const ori = ss.dbl();
      const length = ori === null ? null : ss.dbl();
      const offset = length === null ? null : ss.dbl();

      if (ori !== null && length !== null && offset !== null) {
        layer_data.rotation = ori;
        layer_data.sizeB = length;
        layer_data.finger_offset = offset;

        const c = ss.dbl();

        if (c !== null) corner(c);
      }
    }
  }

  private parseSectionVIA(): void {
    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        return;
      }

      const iss = new ISTRINGSTREAM(line);
      const name = iss.readString();
      const drill = iss.readDouble(0.0);
      const stacklines = iss.readInt(0);

      if (iss.fail()) continue;

      const def: VIA_DEF = {
        name,
        drill,
        size: 0,
        stack: [],
        start_layer: 0,
        end_layer: 0,
        via_type: VIA_TYPE.THROUGH,
        drill_start: 0,
        drill_end: 0,
        has_mask_front: false,
        has_mask_back: false,
      };

      const ds = iss.int();
      const de = ds === null ? null : iss.int();

      if (ds !== null && de !== null) {
        def.drill_start = ds;
        def.drill_end = de;
      }

      let min_layer = INT_MAX;
      let max_layer = INT_MIN;

      for (let i = 0; i < stacklines; ++i) {
        line = this.readLine();
        if (line === null) break;

        const iss2 = new ISTRINGSTREAM(line);
        const level = iss2.readInt(0);
        const size = iss2.readDouble(0.0);
        const shape = iss2.readString();

        if (iss2.fail()) continue;

        const layer_data = newPadStackLayer();
        layer_data.layer = level;
        layer_data.shape = shape;
        layer_data.sizeA = size;
        layer_data.plated = true;

        // the VIA reader's S takes its corner only for "S", its RF no corner
        this.readShapeFields(iss2, shape, layer_data, false);

        def.stack.push(layer_data);

        let effective_layer = level;

        if (level === -2) effective_layer = 1;
        else if (level === -1) effective_layer = this.m_parameters.layer_count;

        const is_copper = effective_layer >= 1 && effective_layer <= this.m_parameters.layer_count;

        if (is_copper) {
          if (size > def.size) def.size = size;

          if (effective_layer < min_layer) min_layer = effective_layer;

          if (effective_layer > max_layer) max_layer = effective_layer;
        }

        if (level === 25) def.has_mask_front = true;
        else if (level === 28) def.has_mask_back = true;
      }

      if (min_layer <= max_layer) {
        def.start_layer = min_layer;
        def.end_layer = max_layer;

        const layer_count = this.m_parameters.layer_count;
        const starts_at_surface = min_layer === 1 || max_layer === layer_count;
        const ends_at_surface = max_layer === layer_count || min_layer === 1;
        const is_full_span = min_layer === 1 && max_layer === layer_count;
        const span = max_layer - min_layer;

        if (is_full_span) def.via_type = VIA_TYPE.THROUGH;
        else if (span === 1 && (min_layer === 1 || max_layer === layer_count))
          def.via_type = VIA_TYPE.MICROVIA;
        else if (starts_at_surface || ends_at_surface) def.via_type = VIA_TYPE.BLIND;
        else def.via_type = VIA_TYPE.BURIED;
      }

      this.m_via_defs.set(name, def);
    }

    if (this.m_parameters.default_signal_via === '' && this.m_via_defs.size > 0)
      this.m_parameters.default_signal_via = sortedMap(this.m_via_defs)[0]![0];
  }

  private parseSectionPOUR(): void {
    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        return;
      }

      const iss = new ISTRINGSTREAM(line);
      const name = iss.readString();
      const type = iss.readString();
      const x = iss.readDouble(0.0);
      const y = iss.readDouble(0.0);
      const pieces = iss.readInt(0);
      iss.readInt(0); // flags

      if (iss.fail()) continue;

      let owner = '';
      let signame = '';
      let hatchgrid = 0.0;
      let hatchrad = 0.0;
      let priority = 0;

      owner = iss.readString(owner);
      signame = iss.readString(signame);

      if (!iss.fail()) {
        hatchgrid = iss.readDouble(hatchgrid);
        hatchrad = iss.readDouble(hatchrad);
        priority = iss.readInt(priority);
      }

      for (let i = 0; i < pieces; ++i) {
        line = this.readLine();
        if (line === null) break;

        const iss2 = new ISTRINGSTREAM(line);
        const poly_type = iss2.readString();
        const corners = iss2.readInt(0);
        const arcs = iss2.readInt(0);
        const width = iss2.readDouble(0.0);
        const level = iss2.readInt(0);

        if (iss2.fail()) continue;

        const pour: POUR = {
          name,
          net_name: signame,
          layer: level,
          priority,
          width,
          points: [],
          is_cutout: poly_type === 'POCUT' || poly_type === 'CUTOUT' || poly_type === 'CIRCUT',
          owner_pour: owner,
          style: POUR_STYLE.SOLID,
          hatch_grid: hatchgrid,
          hatch_width: hatchrad,
          thermal_type: THERMAL_TYPE.NONE,
          thermal_spoke_width: 0,
          thermal_spoke_count: 4,
          thermal_gap: 0,
        };

        if (type === 'HATOUT') {
          pour.style = POUR_STYLE.HATCHED;
        } else if (type === 'VOIDOUT') {
          pour.style = POUR_STYLE.VOIDOUT;
          pour.is_cutout = true;
        } else if (type === 'PADTHERM') {
          pour.thermal_type = THERMAL_TYPE.PAD;
        } else if (type === 'VIATHERM') {
          pour.thermal_type = THERMAL_TYPE.VIA;
        }

        if (poly_type === 'CIRCLE' || poly_type === 'CIRCUT') {
          line = this.readLine();
          if (line === null) break;

          const iss3 = new ISTRINGSTREAM(line);
          const cx = iss3.readDouble(0.0);
          const cy = iss3.readDouble(0.0);
          const radius = iss3.readDouble(0.0);

          if (!iss3.fail()) {
            pour.points.push(
              arcPoint(x + cx + radius, y + cy, {
                cx: x + cx,
                cy: y + cy,
                radius,
                start_angle: 0.0,
                delta_angle: 360.0,
              }),
            );
          }
        } else if (poly_type === 'SEG') {
          for (let j = 0; j < corners; ++j) {
            line = this.readLine();
            if (line === null) break;

            const iss3 = new ISTRINGSTREAM(line);
            const px = iss3.readDouble(0.0);
            const py = iss3.readDouble(0.0);

            if (!iss3.fail()) pour.points.push(arcPoint(x + px, y + py));
          }
        } else {
          const totalLines = corners + arcs;
          let nextIsArcEndpoint = false;
          let pendingArc = newArc();

          for (let j = 0; j < totalLines; ++j) {
            line = this.readLine();
            if (line === null) break;

            const iss3 = new ISTRINGSTREAM(line);
            const px = iss3.readDouble(0.0);
            const py = iss3.readDouble(0.0);

            if (iss3.fail()) continue;

            const angle1 = iss3.readInt(0);
            const angle2 = iss3.readInt(0);

            if (!iss3.fail()) {
              pendingArc = newArc();
              pendingArc.cx = x + px;
              pendingArc.cy = y + py;
              pendingArc.start_angle = angle1 / 10.0;
              pendingArc.delta_angle = angle2 / 10.0;

              if (pour.points.length > 0) {
                const last = pour.points[pour.points.length - 1]!;
                const dx = last.x - pendingArc.cx;
                const dy = last.y - pendingArc.cy;
                pendingArc.radius = Math.sqrt(dx * dx + dy * dy);
              }

              nextIsArcEndpoint = true;
            } else if (nextIsArcEndpoint) {
              if (pendingArc.radius === 0.0) {
                const dx = x + px - pendingArc.cx;
                const dy = y + py - pendingArc.cy;
                pendingArc.radius = Math.sqrt(dx * dx + dy * dy);
              }

              pour.points.push(arcPoint(x + px, y + py, pendingArc));
              nextIsArcEndpoint = false;
            } else {
              pour.points.push(arcPoint(x + px, y + py));
            }
          }
        }

        this.m_pours.push(pour);
      }
    }
  }

  private parseSectionPARTDECAL(): void {
    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        return;
      }

      const iss = new ISTRINGSTREAM(line);
      const name = iss.readString();
      const units = iss.readString();
      iss.readDouble(0.0); // orix
      iss.readDouble(0.0); // oriy
      const pieces = iss.readInt(0);
      const terminals = iss.readInt(0);
      const stacks = iss.readInt(0);
      const text_cnt = iss.readInt(0);
      const labels = iss.readInt(0);

      if (iss.fail()) continue;

      const decal: PART_DECAL = {
        name,
        units,
        items: [],
        attributes: [],
        terminals: [],
        pad_stacks: new Map(),
      };

      for (let i = 0; i < pieces; ++i) {
        line = this.readLine();
        if (line === null) break;

        const iss2 = new ISTRINGSTREAM(line);
        const type = iss2.readString();
        const corners = iss2.readInt(0);
        const width = iss2.readDouble(0);
        let level = 0;

        if (iss2.fail()) continue;

        const val1 = iss2.int();

        if (val1 !== null) {
          const val2 = iss2.int();
          level = val2 !== null ? val2 : val1;
        }

        const item: DECAL_ITEM = {
          type,
          layer: level,
          width,
          points: [],
          pinnum: -1,
          restrictions: '',
          is_tag_open: false,
          is_tag_close: false,
        };

        if (type === 'TAG') {
          item.is_tag_open = level === 1;
          item.is_tag_close = level === 0;
          decal.items.push(item);
          continue;
        }

        if (type.indexOf('COP') === 0) {
          const remaining = iss2.getline();
          const rem_ss = new ISTRINGSTREAM(remaining);
          const pinnum_val = rem_ss.int();

          if (pinnum_val !== null) item.pinnum = pinnum_val;
        }

        if (type.indexOf('KPT') === 0) {
          const restrictions = iss2.str();

          if (restrictions !== null) item.restrictions = restrictions;
        }

        for (let j = 0; j < corners; ++j) {
          line = this.readLine();
          if (line === null) break;

          const iss3 = new ISTRINGSTREAM(line);
          const px = iss3.readDouble(0.0);
          const py = iss3.readDouble(0.0);

          if (iss3.fail()) continue;

          bboxArc(iss3, 0, 0, px, py, item.points);
        }

        decal.items.push(item);
      }

      for (let i = 0; i < text_cnt + labels; ++i) {
        const attrLine = this.readLine();
        if (attrLine === null) break;

        let fontLine = '';

        if (this.m_has_font_lines) {
          const f = this.readLine();
          if (f === null) break;
          fontLine = f;
        }

        const nameLine = this.readLine();
        if (nameLine === null) break;

        const attr = newAttribute();
        const ss = new ISTRINGSTREAM(attrLine);
        const type_token = ss.readString();
        const mirrored_str = this.readAttributeFields(ss, attr);

        if (mirrored_str !== null) {
          attr.visible = PARSER.isVisibleToken(type_token);
          attr.mirrored = mirrored_str === 'M';
          const right_reading_str = ss.readString();
          attr.right_reading = right_reading_str === 'Y' || right_reading_str === 'ORTHO';
        }

        attr.font_info = fontLine;
        attr.name = nameLine;
        decal.attributes.push(attr);
      }

      for (let i = 0; i < terminals; ++i) {
        line = this.readLine();
        if (line === null) break;

        const t_pos = line.indexOf('T');

        if (t_pos >= 0) line = `${line.substring(0, t_pos)} ${line.substring(t_pos + 1)}`;

        const iss_t = new ISTRINGSTREAM(line);
        const term: TERMINAL = { x: 0, y: 0, name: '' };
        term.x = iss_t.readDouble(term.x);
        term.y = iss_t.readDouble(term.y);
        iss_t.readDouble(0.0); // nmx
        iss_t.readDouble(0.0); // nmy

        if (!iss_t.fail()) {
          term.name = iss_t.readString(term.name);

          if (term.name === '') term.name = String(i + 1);

          decal.terminals.push(term);
        }
      }

      for (let i = 0; i < stacks; ++i) {
        line = this.readLine();
        if (line === null) break;

        const iss_pad = new ISTRINGSTREAM(line);
        const token = iss_pad.readString();
        const pin_idx = iss_pad.readInt(0);
        const stack_lines = iss_pad.readInt(0);

        if (token !== 'PAD') continue;

        let default_plated = true;
        let header_drill = 0.0;

        const plated_token = iss_pad.str();

        if (plated_token !== null) {
          if (plated_token === 'P') default_plated = true;
          else if (plated_token === 'N') default_plated = false;
          else header_drill = ParseDouble(plated_token, 0.0, 'pad drill');
        }

        let header_slot_ori = 0.0;
        let header_slot_len = 0.0;
        let header_slot_off = 0.0;
        header_slot_ori = iss_pad.readDouble(header_slot_ori);
        header_slot_len = iss_pad.readDouble(header_slot_len);
        header_slot_off = iss_pad.readDouble(header_slot_off);

        const stack: PAD_STACK_LAYER[] = [];

        for (let j = 0; j < stack_lines; ++j) {
          line = this.readLine();
          if (line === null) break;

          const line_ss = new ISTRINGSTREAM(line);
          const layer = line_ss.readInt(0);
          const size = line_ss.readDouble(0.0);
          const shape = line_ss.readString();

          if (line_ss.fail()) continue;

          const layer_data = newPadStackLayer();
          layer_data.layer = layer;
          layer_data.sizeA = size;
          layer_data.sizeB = size;
          layer_data.shape = shape;
          layer_data.plated = default_plated;
          layer_data.drill = header_drill;
          layer_data.slot_orientation = header_slot_ori;
          layer_data.slot_length = header_slot_len;
          layer_data.slot_offset = header_slot_off;

          this.readShapeFields(line_ss, shape, layer_data, true);

          const remaining: string[] = [];

          for (let t = line_ss.str(); t !== null; t = line_ss.str()) remaining.push(t);

          if (remaining.length > 0) {
            let idx = 0;
            const drill_val = ParseDouble(remaining[idx]!, -1.0, 'pad layer drill');

            if (drill_val >= 0.0) {
              layer_data.drill = drill_val;
              idx++;
            }

            if (idx < remaining.length) {
              if (remaining[idx] === 'P' || remaining[idx] === 'Y') {
                layer_data.plated = true;
                idx++;
              } else if (remaining[idx] === 'N') {
                layer_data.plated = false;
                idx++;
              }
            }

            if (idx + 2 < remaining.length) {
              layer_data.slot_orientation = ParseDouble(remaining[idx]!, 0.0, 'slot params');
              layer_data.slot_length = ParseDouble(remaining[idx + 1]!, 0.0, 'slot params');
              layer_data.slot_offset = ParseDouble(remaining[idx + 2]!, 0.0, 'slot params');
            }
          }

          stack.push(layer_data);
        }

        decal.pad_stacks.set(pin_idx, stack);
      }

      this.m_decals.set(name, decal);
    }
  }

  private parseSectionROUTES(): void {
    let current_route: ROUTE | null = null;
    let current_track: TRACK = { layer: 0, width: 0, points: [] };
    let in_track = false;
    let prev_is_plane_connection = false;
    let last_plane_connection_pt = arcPoint();
    let last_plane_connection_layer = 0;
    let last_plane_connection_width = 0;
    let last_plane_on_copper = false;
    let default_via_name = '';
    let has_pending_arc_center = false;
    let pending_arc_center = arcPoint();
    let pending_arc_dir = '';

    const pushTrack = (): void => {
      current_route!.tracks.push(copyTrack(current_track));
    };

    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        if (line.startsWith('*SIGNAL*')) {
          if (in_track && current_route) {
            pushTrack();
            current_track.points = [];
            in_track = false;
          }

          prev_is_plane_connection = false;
          has_pending_arc_center = false;

          const iss = new ISTRINGSTREAM(line);
          iss.readString(); // *SIGNAL*
          const net_name = iss.readString();

          default_via_name = '';

          for (let token = iss.str(); token !== null; token = iss.str()) {
            let t = token;

            if (t !== '' && t[t.length - 1] === ';') t = t.substring(0, t.length - 1);

            if (this.m_via_defs.has(t)) default_via_name = t;
          }

          current_route = {
            net_name,
            tracks: [],
            vias: [],
            pins: [],
            teardrops: [],
            jumpers: [],
          };
          this.m_routes.push(current_route);
          continue;
        }

        this.pushBackLine(line);
        break;
      }

      if (!isdigit(line[0]) && line[0] !== '-' && line[0] !== '+') {
        if (in_track && current_route) {
          pushTrack();
          current_track.points = [];
          in_track = false;
        }

        prev_is_plane_connection = false;

        if (current_route) {
          const pin_iss = new ISTRINGSTREAM(line);

          for (let pin_token = pin_iss.str(); pin_token !== null; pin_token = pin_iss.str()) {
            const dot_pos = pin_token.indexOf('.');

            if (dot_pos >= 0) {
              const pin = newNetPin();
              pin.ref_des = pin_token.substring(0, dot_pos);
              pin.pin_name = pin_token.substring(dot_pos + 1);

              const found = current_route.pins.some(
                (e) => e.ref_des === pin.ref_des && e.pin_name === pin.pin_name,
              );

              if (!found) current_route.pins.push(pin);
            }
          }
        }

        continue;
      }

      const iss = new ISTRINGSTREAM(line);
      const pt = arcPoint();
      pt.x = iss.readDouble(pt.x);
      pt.y = iss.readDouble(pt.y);
      const layer = iss.readInt(0);
      const width = iss.readDouble(0.0);
      iss.readInt(0); // flags

      if (iss.fail()) continue;

      let via_name = '';
      let arc_dir = '';
      const is_unrouted = layer === 0;
      const is_plane_connection = is_unrouted;
      const teardrop: TEARDROP = {
        pad_width: 0,
        pad_length: 0,
        pad_flags: 0,
        net_width: 0,
        net_length: 0,
        net_flags: 0,
        has_pad_teardrop: false,
        has_net_teardrop: false,
      };
      const jumper: JUMPER_MARKER = { name: '', is_start: false, x: 0, y: 0 };
      let has_teardrop = false;
      let has_jumper = false;
      let has_power = false;

      for (let token = iss.str(); token !== null; token = iss.str()) {
        if (token === 'CW' || token === 'CCW') {
          arc_dir = token;
          continue;
        }

        if (token === 'POWER') {
          has_power = true;

          if (this.m_via_defs.has(token)) via_name = token;

          continue;
        }

        if (token === 'THERMAL') continue;

        if (this.m_via_defs.has(token)) {
          via_name = token;
          continue;
        }

        if (token === 'TEARDROP') {
          has_teardrop = true;

          for (let td_token = iss.str(); td_token !== null; td_token = iss.str()) {
            if (td_token === 'P' || td_token === 'N') {
              if (td_token === 'P') {
                teardrop.has_pad_teardrop = true;
                teardrop.pad_width = iss.readDouble(teardrop.pad_width);
                teardrop.pad_length = iss.readDouble(teardrop.pad_length);
              } else {
                teardrop.has_net_teardrop = true;
                teardrop.net_width = iss.readDouble(teardrop.net_width);
                teardrop.net_length = iss.readDouble(teardrop.net_length);
              }

              const pos = iss.tellg();
              const td_flags = iss.int();

              if (td_flags !== null) {
                if (td_token === 'P') teardrop.pad_flags = td_flags;
                else teardrop.net_flags = td_flags;
              } else {
                iss.clear();
                iss.seekg(pos);
              }
            } else {
              if (td_token === 'CW' || td_token === 'CCW') arc_dir = td_token;
              else if (td_token === 'POWER') {
                has_power = true;

                if (this.m_via_defs.has(td_token)) via_name = td_token;
              } else if (td_token === 'THERMAL') {
                // nothing
              } else if (this.m_via_defs.has(td_token)) via_name = td_token;

              break;
            }
          }

          continue;
        }

        const pos = iss.tellg();
        const jumper_flag = iss.str();

        if (jumper_flag !== null) {
          if (jumper_flag === 'S' || jumper_flag === 'E') {
            has_jumper = true;
            jumper.name = token;
            jumper.is_start = jumper_flag === 'S';
            jumper.x = pt.x;
            jumper.y = pt.y;
            continue;
          }

          iss.clear();
          iss.seekg(pos);
        } else {
          iss.clear();
          iss.seekg(pos);
        }

        if (token === 'REUSE' || token === '.REUSE.') {
          iss.readString(); // instance
          continue;
        }
      }

      if (arc_dir !== '') {
        pending_arc_center = copyPt(pt);
        pending_arc_dir = arc_dir;
        has_pending_arc_center = true;
        continue;
      }

      if (has_pending_arc_center) {
        has_pending_arc_center = false;

        if (in_track && current_track.points.length > 0) {
          const arc_start = current_track.points[current_track.points.length - 1]!;
          const dx0 = arc_start.x - pending_arc_center.x;
          const dy0 = arc_start.y - pending_arc_center.y;
          const start_angle = atan2(dy0, dx0);
          const end_angle = atan2(pt.y - pending_arc_center.y, pt.x - pending_arc_center.x);
          let sweep = end_angle - start_angle;

          if (pending_arc_dir === 'CCW') {
            while (sweep <= 0.0) sweep += 2.0 * Math.PI;
          } else {
            while (sweep >= 0.0) sweep -= 2.0 * Math.PI;
          }

          pt.is_arc = true;
          pt.arc.cx = pending_arc_center.x;
          pt.arc.cy = pending_arc_center.y;
          pt.arc.radius = Math.sqrt(dx0 * dx0 + dy0 * dy0);
          pt.arc.start_angle = (start_angle * 180.0) / Math.PI;
          pt.arc.delta_angle = (sweep * 180.0) / Math.PI;
        }
      }

      let effective_layer = layer;
      const is_pad_connection = layer === 65;

      if (is_unrouted && in_track) effective_layer = current_track.layer;

      const implicitVia = (): VIA => {
        let viaName = '';

        if (default_via_name !== '') viaName = default_via_name;
        else if (this.m_parameters.default_signal_via !== '')
          viaName = this.m_parameters.default_signal_via;

        return { name: viaName, location: { x: pt.x, y: pt.y } };
      };

      if (via_name !== '' && current_route)
        current_route.vias.push({ name: via_name, location: { x: pt.x, y: pt.y } });

      if (has_power && via_name === '' && !is_unrouted && !is_pad_connection && current_route)
        current_route.vias.push(implicitVia());

      if (has_teardrop && current_route) current_route.teardrops.push({ ...teardrop });

      if (has_jumper && current_route) current_route.jumpers.push({ ...jumper });

      if (is_plane_connection && prev_is_plane_connection) {
        if (!is_unrouted) {
          last_plane_connection_pt = copyPt(pt);
          last_plane_connection_layer = effective_layer;
          last_plane_connection_width = width;
          last_plane_on_copper = true;
        }

        prev_is_plane_connection = true;
        continue;
      }

      if (is_plane_connection && !prev_is_plane_connection) {
        if (in_track) {
          current_track.points.push(copyPt(pt));

          if (current_route && current_track.points.length > 1) pushTrack();

          current_track.points = [];
          in_track = false;
        }

        last_plane_on_copper = !is_unrouted;

        if (last_plane_on_copper) {
          last_plane_connection_pt = copyPt(pt);
          last_plane_connection_layer = effective_layer;
          last_plane_connection_width = width;
        }

        prev_is_plane_connection = true;
        continue;
      }

      if (!is_plane_connection && prev_is_plane_connection) {
        if (in_track && current_route && current_track.points.length > 1) pushTrack();

        prev_is_plane_connection = false;

        if (is_pad_connection) {
          in_track = false;
          continue;
        }

        current_track.points = [];

        if (last_plane_on_copper && last_plane_connection_layer === effective_layer) {
          current_track.layer = effective_layer;
          current_track.width = Math.max(width, last_plane_connection_width);
          current_track.points.push(copyPt(last_plane_connection_pt));
          current_track.points.push(copyPt(pt));
        } else {
          if (
            !has_power &&
            via_name === '' &&
            current_route &&
            last_plane_on_copper &&
            Math.abs(pt.x - last_plane_connection_pt.x) < 0.001 &&
            Math.abs(pt.y - last_plane_connection_pt.y) < 0.001
          ) {
            current_route.vias.push(implicitVia());
          }

          current_track.layer = effective_layer;
          current_track.width = width;
          current_track.points.push(copyPt(pt));
        }

        last_plane_on_copper = false;
        in_track = true;
        continue;
      }

      if (is_pad_connection) {
        if (in_track && current_track.points.length > 0) {
          current_track.points.push(copyPt(pt));

          if (current_route && current_track.points.length > 1) pushTrack();

          current_track.points = [];
          in_track = false;
        }

        continue;
      }

      prev_is_plane_connection = false;

      if (!in_track) {
        current_track.layer = effective_layer;
        current_track.width = width;
        current_track.points = [copyPt(pt)];
        in_track = true;
      } else {
        const layer_changed = effective_layer !== current_track.layer;
        const width_changed = Math.abs(width - current_track.width) > 0.001;

        if (layer_changed || width_changed) {
          let connect = true;

          if (layer_changed && via_name === '') {
            const last = current_track.points[current_track.points.length - 1]!;
            const same_location = pt.x === last.x && pt.y === last.y;

            if (same_location) {
              if (!has_power && current_route) {
                current_route.vias.push({
                  name: default_via_name === '' ? 'STANDARDVIA' : default_via_name,
                  location: { x: pt.x, y: pt.y },
                });
              }
            } else if (!has_power) {
              connect = false;
            }
          }

          if (connect) current_track.points.push(copyPt(pt));

          if (current_route) pushTrack();

          const prev_pt = copyPt(pt);
          current_track.layer = effective_layer;
          current_track.width = width;
          current_track.points = [prev_pt];
        } else {
          current_track.points.push(copyPt(pt));
        }
      }

      void current_track;
    }

    if (in_track && current_route) pushTrack();

    current_track = { layer: 0, width: 0, points: [] };
  }

  private parseSectionTEXT(): void {
    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      const iss = new ISTRINGSTREAM(line);
      const text = newText();
      text.location.x = iss.readDouble(text.location.x);
      text.location.y = iss.readDouble(text.location.y);
      text.rotation = iss.readDouble(text.rotation);
      text.layer = iss.readInt(text.layer);
      text.height = iss.readDouble(text.height);
      text.width = iss.readDouble(text.width);

      if (iss.fail()) continue;

      const mirrored = iss.readString();
      text.mirrored = mirrored === 'M';
      text.hjust = iss.readString(text.hjust);
      text.vjust = iss.readString(text.vjust);

      const token = iss.str();

      if (token !== null) {
        if (token === '.REUSE.') {
          text.reuse_instance = iss.readString(text.reuse_instance);
        } else {
          text.ndim = ParseInt(token, 0, 'text ndim');

          const t2 = iss.str();

          if (t2 !== null && t2 === '.REUSE.')
            text.reuse_instance = iss.readString(text.reuse_instance);
        }
      }

      if (this.m_has_font_lines) {
        const fl = this.readLine();

        if (fl !== null) {
          line = fl;
          const fiss = new ISTRINGSTREAM(line);
          const font_style_part = fiss.readString();
          const colon_pos = font_style_part.indexOf(':');

          if (colon_pos >= 0) {
            text.font_style = font_style_part.substring(0, colon_pos);
            const remaining = font_style_part.substring(colon_pos + 1);
            const second_colon = remaining.indexOf(':');

            if (second_colon >= 0) {
              text.font_height = ParseDouble(
                remaining.substring(0, second_colon),
                0.0,
                'font height',
              );
              text.font_descent = ParseDouble(
                remaining.substring(second_colon + 1),
                0.0,
                'font descent',
              );
            } else {
              text.font_height = ParseDouble(remaining, 0.0, 'font height');
            }
          } else {
            text.font_style = font_style_part;
          }

          const bracket_start = line.indexOf('<');
          const bracket_end = line.indexOf('>');

          if (bracket_start >= 0 && bracket_end >= 0) {
            text.font_face = substr(line, bracket_start + 1, bracket_end - bracket_start - 1);
          } else {
            let rest = fiss.getline();

            if (rest !== '' && rest[0] === ' ') rest = rest.substring(1);

            text.font_face = rest;
          }
        }
      }

      const cl = this.readLine();

      if (cl !== null) {
        let content = cl.replaceAll('\\n', '\n');

        if (this.m_file_header.mode === '250L') content = content.replaceAll('_', '\n');

        text.content = content;
        this.m_texts.push(text);
      }
    }
  }

  private parseSectionBOARD(): void {
    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      const iss = new ISTRINGSTREAM(line);
      iss.readString(); // name
      iss.readString(); // type
      const xloc = iss.readDouble(0.0);
      const yloc = iss.readDouble(0.0);
      const pieces = iss.readInt(0);

      for (let i = 0; i < pieces; ++i) {
        line = this.readLine();
        if (line === null) break;

        if (first(line) === '*') {
          this.pushBackLine(line);
          return;
        }

        const piss = new ISTRINGSTREAM(line);
        const shape_type = piss.readString();
        const corners = piss.readInt(0);
        const width = piss.readDouble(0.0);
        piss.readInt(0); // linestyle
        piss.readInt(0); // level

        if (shape_type === 'CLOSED' || shape_type === 'OPEN' || shape_type === 'BRDCLS') {
          const polyline: POLYLINE = {
            layer: 0,
            width,
            closed: shape_type === 'CLOSED' || shape_type === 'BRDCLS',
            points: [],
          };

          for (let j = 0; j < corners; ++j) {
            line = this.readLine();
            if (line === null) break;

            if (first(line) === '*') {
              this.pushBackLine(line);
              return;
            }

            const ciss = new ISTRINGSTREAM(line);
            const dx = ciss.readDouble(0.0);
            const dy = ciss.readDouble(0.0);

            bboxArc(ciss, xloc, yloc, dx, dy, polyline.points);
          }

          if (polyline.points.length > 0) this.m_board_outlines.push(polyline);
        } else if (shape_type === 'CIRCLE' || shape_type === 'BRDCIR') {
          const polyline: POLYLINE = { layer: 0, width, closed: true, points: [] };
          polyline.points.push(circleFromLines(() => this.readLine(), corners, xloc, yloc));
          this.m_board_outlines.push(polyline);
        } else {
          for (let j = 0; j < corners; ++j) {
            line = this.readLine();
            if (line === null) break;

            if (first(line) === '*') {
              this.pushBackLine(line);
              return;
            }
          }
        }
      }
    }
  }

  private parseSectionLINES(): void {
    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      const iss = new ISTRINGSTREAM(line);
      const name = iss.readString();
      const type = iss.readString();
      const xloc = iss.readDouble(0.0);
      const yloc = iss.readDouble(0.0);
      const pieces = iss.readInt(0);
      iss.readInt(0); // flags
      let textCount = 0;
      let signame = '';

      const tc = iss.int();

      if (tc !== null) {
        textCount = tc;
        signame = iss.readString(signame);
      } else {
        iss.clear();
        signame = iss.readString(signame);
      }

      let reuse_instance = '';

      line = this.readLine();

      if (line !== null) {
        if (line.includes('.REUSE.')) {
          const riss = new ISTRINGSTREAM(line);
          riss.readString(); // reuse_keyword
          reuse_instance = riss.readString(reuse_instance);
          riss.readString(); // reuse_signal
        } else {
          this.pushBackLine(line);
        }
      }

      /** A piece header's shape, corner count, width and level. */
      const pieceHeader = (
        l: string,
      ): {
        shape_type: string;
        corners: number;
        width: number;
        level: number;
        piss: ISTRINGSTREAM;
      } => {
        const piss = new ISTRINGSTREAM(l);
        const shape_type = piss.readString();
        const corners = piss.readInt(0);
        const width = piss.readDouble(0);
        piss.readInt(0); // piece_flags
        const level = piss.readInt(0);
        return { shape_type, corners, width, level, piss };
      };

      if (type === 'BOARD') {
        for (let i = 0; i < pieces; ++i) {
          line = this.readLine();
          if (line === null) break;

          if (first(line) === '*') {
            this.pushBackLine(line);
            return;
          }

          const { shape_type, corners, width } = pieceHeader(line);

          if (shape_type === 'CLOSED' || shape_type === 'OPEN' || shape_type === 'BRDCLS') {
            const polyline: POLYLINE = {
              layer: 0, // Board outline is layer-agnostic
              width,
              closed: shape_type === 'CLOSED' || shape_type === 'BRDCLS',
              points: [],
            };

            for (let j = 0; j < corners; ++j) {
              line = this.readLine();
              if (line === null) break;

              if (first(line) === '*') {
                this.pushBackLine(line);
                return;
              }

              const ciss = new ISTRINGSTREAM(line);
              const dx = ciss.readDouble(0.0);
              const dy = ciss.readDouble(0.0);

              bboxArc(ciss, xloc, yloc, dx, dy, polyline.points);
            }

            if (polyline.points.length > 0) this.m_board_outlines.push(polyline);
          } else if (shape_type === 'CIRCLE' || shape_type === 'BRDCIR') {
            const pt = circleFromLines(() => this.readLine(), corners, xloc, yloc);
            this.m_board_outlines.push({ layer: 0, width, closed: true, points: [pt] });
          } else {
            for (let j = 0; j < corners; ++j) {
              line = this.readLine();
              if (line === null) break;

              if (first(line) === '*') {
                this.pushBackLine(line);
                return;
              }
            }
          }
        }
      } else if (name.startsWith('DIM') && type === 'LINES') {
        const dim: DIMENSION = {
          name,
          x: xloc,
          y: yloc,
          crossbar_pos: 0,
          is_horizontal: true,
          layer: 0,
          points: [],
          text: '',
          text_height: 0,
          text_width: 0,
          rotation: 0,
        };

        let baspnt1_x = 0;
        let baspnt1_y = 0;
        let baspnt2_x = 0;
        let baspnt2_y = 0;
        let arwln_x = 0;
        let arwln_y = 0;
        let baspnt_count = 0;
        let hasArwln = false;

        for (let i = 0; i < pieces; ++i) {
          line = this.readLine();
          if (line === null) break;

          if (first(line) === '*') {
            this.pushBackLine(line);
            break;
          }

          const { shape_type, corners, level } = pieceHeader(line);
          dim.layer = level;

          for (let j = 0; j < corners; ++j) {
            line = this.readLine();
            if (line === null) break;

            if (first(line) === '*') {
              this.pushBackLine(line);
              break;
            }

            const ciss = new ISTRINGSTREAM(line);
            const dx = ciss.readDouble(0.0);
            const dy = ciss.readDouble(0.0);

            if (shape_type === 'BASPNT' && j === 0) {
              if (baspnt_count === 0) {
                baspnt1_x = xloc + dx;
                baspnt1_y = yloc + dy;
              } else if (baspnt_count === 1) {
                baspnt2_x = xloc + dx;
                baspnt2_y = yloc + dy;
              }

              baspnt_count++;
            }

            if (shape_type === 'ARWLN1' && j === 0) {
              arwln_x = xloc + dx;
              arwln_y = yloc + dy;
              hasArwln = true;
            }
          }
        }

        if (baspnt_count >= 2) {
          const dx = Math.abs(baspnt2_x - baspnt1_x);
          const dy = Math.abs(baspnt2_y - baspnt1_y);
          const isHorizontal = dx > dy;
          dim.is_horizontal = isHorizontal;

          if (hasArwln) dim.crossbar_pos = isHorizontal ? arwln_y : arwln_x;

          dim.points.push({ x: baspnt1_x, y: baspnt1_y });
          dim.points.push({ x: baspnt2_x, y: baspnt2_y });
        }

        for (let t = 0; t < textCount; ++t) {
          line = this.readLine();
          if (line === null) break;

          if (first(line) === '*') {
            this.pushBackLine(line);
            break;
          }

          const tiss = new ISTRINGSTREAM(line);
          tiss.readDouble(0.0); // tx
          tiss.readDouble(0.0); // ty

          if (tiss.fail()) {
            const skipLines = this.m_has_font_lines ? 2 : 1;

            for (let s = 0; s < skipLines; ++s) this.readLine();

            continue;
          }

          let trot = 0.0;
          let theight = 0.0;
          let twidth = 0.0;
          trot = tiss.readDouble(trot);
          tiss.readInt(0); // tlayer
          theight = tiss.readDouble(theight);
          twidth = tiss.readDouble(twidth);

          if (this.m_has_font_lines) {
            line = this.readLine();
            if (line === null) break;
          }

          line = this.readLine();
          if (line === null) break;

          if (t === 0) {
            dim.text = line;
            dim.text_height = theight;
            dim.text_width = twidth;
            dim.rotation = trot;
          }
        }

        textCount = 0;

        if (dim.points.length > 0) this.m_dimensions.push(dim);
      } else if (
        type === 'KEEPOUT' ||
        type === 'RESTRICTVIA' ||
        type === 'RESTRICTROUTE' ||
        type === 'RESTRICTAREA' ||
        type === 'PLACEMENT_KEEPOUT'
      ) {
        const keepout: KEEPOUT = {
          type: KEEPOUT_TYPE.ALL,
          outline: [],
          layers: [],
          no_traces: true,
          no_vias: true,
          no_copper: true,
          no_components: false,
          height_restriction: false,
          max_height: 0,
          no_test_points: false,
          no_accordion: false,
        };

        if (type === 'KEEPOUT' || type === 'RESTRICTAREA') {
          keepout.type = KEEPOUT_TYPE.ALL;
          keepout.no_traces = true;
          keepout.no_vias = true;
          keepout.no_copper = true;
        } else if (type === 'RESTRICTVIA') {
          keepout.type = KEEPOUT_TYPE.VIA;
          keepout.no_traces = false;
          keepout.no_vias = true;
          keepout.no_copper = false;
        } else if (type === 'RESTRICTROUTE') {
          keepout.type = KEEPOUT_TYPE.ROUTE;
          keepout.no_traces = true;
          keepout.no_vias = false;
          keepout.no_copper = false;
        } else if (type === 'PLACEMENT_KEEPOUT') {
          keepout.type = KEEPOUT_TYPE.PLACEMENT;
          keepout.no_traces = false;
          keepout.no_vias = false;
          keepout.no_copper = false;
          keepout.no_components = true;
        }

        for (let i = 0; i < pieces; ++i) {
          line = this.readLine();
          if (line === null) break;

          if (first(line) === '*') {
            this.pushBackLine(line);
            break;
          }

          const { shape_type, corners, width, level, piss } = pieceHeader(line);
          const restrictions = piss.readString();

          if (level > 0) keepout.layers.push(level);

          if (restrictions !== '') {
            let has_restriction_codes = false;

            for (const c of restrictions) {
              if (isalpha(c)) {
                has_restriction_codes = true;
                break;
              }
            }

            if (has_restriction_codes) {
              keepout.no_traces = false;
              keepout.no_vias = false;
              keepout.no_copper = false;
              keepout.no_components = false;
              keepout.height_restriction = false;
              keepout.no_test_points = false;
              keepout.no_accordion = false;

              for (const c of restrictions) {
                switch (c) {
                  case 'P':
                    keepout.no_components = true;
                    break;
                  case 'H':
                    keepout.height_restriction = true;
                    keepout.max_height = width;
                    break;
                  case 'R':
                    keepout.no_traces = true;
                    break;
                  case 'C':
                    keepout.no_copper = true;
                    break;
                  case 'V':
                    keepout.no_vias = true;
                    break;
                  case 'T':
                    keepout.no_test_points = true;
                    break;
                  case 'A':
                    keepout.no_accordion = true;
                    break;
                  default:
                    break;
                }
              }
            }
          }

          if (shape_type === 'KPTCIR') {
            keepout.outline.push(circleFromLines(() => this.readLine(), corners, xloc, yloc));
          } else {
            for (let j = 0; j < corners; ++j) {
              line = this.readLine();
              if (line === null) break;

              if (first(line) === '*') {
                this.pushBackLine(line);
                break;
              }

              const ciss = new ISTRINGSTREAM(line);
              const dx = ciss.readDouble(0.0);
              const dy = ciss.readDouble(0.0);

              bboxArc(ciss, xloc, yloc, dx, dy, keepout.outline);
            }
          }
        }

        if (keepout.outline.length > 0) this.m_keepouts.push(keepout);
      } else if (type === 'COPPER' || type === 'COPCUT') {
        for (let i = 0; i < pieces; ++i) {
          line = this.readLine();
          if (line === null) break;

          if (first(line) === '*') {
            this.pushBackLine(line);
            return;
          }

          const { shape_type, corners, width, level } = pieceHeader(line);

          const copper: COPPER_SHAPE = {
            name,
            layer: level,
            width,
            net_name: signame,
            filled: shape_type === 'COPCLS' || shape_type === 'COPCIR',
            is_cutout:
              shape_type === 'COPCUT' ||
              shape_type === 'COPCCO' ||
              shape_type === 'CIRCUR' ||
              type === 'COPCUT',
            outline: [],
          };

          if (shape_type === 'COPCIR' || shape_type === 'COPCCO' || shape_type === 'CIRCUR') {
            copper.outline.push(circleFromLines(() => this.readLine(), corners, xloc, yloc));
          } else {
            for (let j = 0; j < corners; ++j) {
              line = this.readLine();
              if (line === null) break;

              if (first(line) === '*') {
                this.pushBackLine(line);
                break;
              }

              const ciss = new ISTRINGSTREAM(line);
              const dx = ciss.readDouble(0.0);
              const dy = ciss.readDouble(0.0);

              bboxArc(ciss, xloc, yloc, dx, dy, copper.outline);
            }
          }

          if (copper.outline.length > 0) this.m_copper_shapes.push(copper);
        }
      } else if (type === 'LINES') {
        for (let i = 0; i < pieces; ++i) {
          line = this.readLine();
          if (line === null) break;

          if (first(line) === '*') {
            this.pushBackLine(line);
            return;
          }

          const { shape_type, corners, width, level } = pieceHeader(line);

          const graphic: GRAPHIC_LINE = {
            name,
            layer: level,
            width,
            style: LINE_STYLE.SOLID,
            closed: shape_type === 'CLOSED' || shape_type === 'CIRCLE',
            filled: false,
            points: [],
            reuse_instance,
          };

          if (shape_type === 'CIRCLE') {
            graphic.points.push(circleFromLines(() => this.readLine(), corners, xloc, yloc));
          } else {
            for (let j = 0; j < corners; ++j) {
              line = this.readLine();
              if (line === null) break;

              if (first(line) === '*') {
                this.pushBackLine(line);
                break;
              }

              const ciss = new ISTRINGSTREAM(line);
              const dx = ciss.readDouble(0.0);
              const dy = ciss.readDouble(0.0);

              bboxArc(ciss, xloc, yloc, dx, dy, graphic.points);
            }
          }

          if (graphic.points.length > 0) this.m_graphic_lines.push(graphic);
        }
      } else {
        for (let i = 0; i < pieces; ++i) {
          line = this.readLine();
          if (line === null) break;

          if (first(line) === '*') {
            this.pushBackLine(line);
            return;
          }

          const piss = new ISTRINGSTREAM(line);
          piss.readString(); // shape_type
          const corners = piss.readInt(0);

          for (let j = 0; j < corners; ++j) {
            line = this.readLine();
            if (line === null) break;

            if (first(line) === '*') {
              this.pushBackLine(line);
              return;
            }
          }
        }
      }

      for (let t = 0; t < textCount; ++t) {
        line = this.readLine();
        if (line === null) break;

        if (first(line) === '*') {
          this.pushBackLine(line);
          return;
        }

        const tiss = new ISTRINGSTREAM(line);
        const text = newText();
        text.location.x = tiss.readDouble(text.location.x);
        text.location.y = tiss.readDouble(text.location.y);
        text.rotation = tiss.readDouble(text.rotation);
        text.layer = tiss.readInt(text.layer);
        text.height = tiss.readDouble(text.height);
        text.width = tiss.readDouble(text.width);

        if (tiss.fail()) {
          const skipLines = this.m_has_font_lines ? 2 : 1;

          for (let s = 0; s < skipLines; ++s) this.readLine();

          continue;
        }

        text.location.x += xloc;
        text.location.y += yloc;

        const mirrored = tiss.readString();
        text.mirrored = mirrored === 'M';
        text.hjust = tiss.readString(text.hjust);
        text.vjust = tiss.readString(text.vjust);

        if (this.m_has_font_lines) {
          line = this.readLine();
          if (line === null) break;

          if (first(line) === '*') {
            this.pushBackLine(line);
            return;
          }

          const bracket_start = line.indexOf('<');
          const bracket_end = line.indexOf('>');

          if (bracket_start >= 0 && bracket_end >= 0)
            text.font_face = substr(line, bracket_start + 1, bracket_end - bracket_start - 1);

          const fiss = new ISTRINGSTREAM(line);
          const font_style_part = fiss.readString();
          const colon_pos = font_style_part.indexOf(':');

          text.font_style =
            colon_pos >= 0 ? font_style_part.substring(0, colon_pos) : font_style_part;
        }

        line = this.readLine();
        if (line === null) break;

        if (first(line) === '*') {
          this.pushBackLine(line);
          return;
        }

        text.content = line;
        this.m_texts.push(text);
      }
    }
  }

  private parseSectionPARTTYPE(): void {
    let currentPartType: PART_TYPE | null = null;
    let currentGate: GATE_DEF | null = null;

    const parsePinElecType = (c: string): PIN_ELEC_TYPE => {
      switch (c) {
        case 'S':
          return PIN_ELEC_TYPE.SOURCE;
        case 'B':
          return PIN_ELEC_TYPE.BIDIRECTIONAL;
        case 'C':
          return PIN_ELEC_TYPE.OPEN_COLLECTOR;
        case 'T':
          return PIN_ELEC_TYPE.TRISTATE;
        case 'L':
          return PIN_ELEC_TYPE.LOAD;
        case 'Z':
          return PIN_ELEC_TYPE.TERMINATOR;
        case 'P':
          return PIN_ELEC_TYPE.POWER;
        case 'G':
          return PIN_ELEC_TYPE.GROUND;
        default:
          return PIN_ELEC_TYPE.UNDEFINED;
      }
    };

    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      if (line === '') continue;

      if (line.startsWith('G ') && currentPartType) {
        const gss = new ISTRINGSTREAM(line);
        gss.readString(); // g_keyword
        const gateSwap = gss.readInt(0);
        gss.readInt(0); // pinCount
        const gate: GATE_DEF = { gate_swap_type: gateSwap, pins: [] };
        currentPartType.gates.push(gate);
        currentGate = gate;
        continue;
      }

      if (line.startsWith('SIGPIN') && currentPartType) {
        const sss = new ISTRINGSTREAM(line);
        sss.readString(); // keyword
        const sigpin: SIGPIN = { pin_number: '', width: 0.0, signal_name: '' };
        sigpin.pin_number = sss.readString(sigpin.pin_number);
        sigpin.width = sss.readDouble(sigpin.width);
        sigpin.signal_name = sss.readString(sigpin.signal_name);

        if (sigpin.pin_number !== '') currentPartType.signal_pins.push(sigpin);

        continue;
      }

      if (line.includes('.') && currentPartType) {
        const check_ss = new ISTRINGSTREAM(line);
        const first_token = check_ss.readString();
        let dot_count = 0;

        for (const c of first_token) if (c === '.') dot_count++;

        if (dot_count >= 2) {
          const ss = new ISTRINGSTREAM(line);

          for (let token = ss.str(); token !== null; token = ss.str()) {
            const parts = token.split('.');

            if (parts.length >= 3) {
              const isNumericSecond = parts[1] !== '' && [...parts[1]!].every((c) => isdigit(c));

              if (currentGate && parts[2]!.length === 1 && !isNumericSecond) {
                const gpin: GATE_PIN = {
                  pin_number: parts[0]!,
                  swap_type: ParseInt(parts[1]!, 0, 'gate pin swap'),
                  elec_type: PIN_ELEC_TYPE.UNDEFINED,
                  func_name: '',
                };

                if (parts[2] !== '') gpin.elec_type = parsePinElecType(parts[2]![0]!);

                if (parts.length >= 4) gpin.func_name = parts[3]!;

                currentGate.pins.push(gpin);
              } else if (isNumericSecond) {
                const padIdx = ParseInt(parts[1]!, -1, 'pad index');

                if (padIdx >= 0) currentPartType.pin_pad_map.set(parts[0]!, padIdx);
              }
            }
          }

          continue;
        }
      }

      if (first(line) === '{' && currentPartType) {
        for (line = this.readLine(); line !== null; line = this.readLine()) {
          if (line === '' || first(line) === '}') break;

          if (first(line) === '*') {
            this.pushBackLine(line);
            return;
          }

          const [attrName, attrValue] = PARSER.attributeLine(line);

          if (attrName !== '' && attrValue !== '')
            currentPartType.attributes.set(attrName, attrValue);
        }

        continue;
      }

      if (first(line) === '{' || first(line) === '}') continue;

      const ss = new ISTRINGSTREAM(line);
      const name = ss.readString();
      const decal = ss.readString();

      if (name !== '' && name[0] !== 'G') {
        const pt: PART_TYPE = {
          name,
          decal_name: decal,
          pin_pad_map: new Map(),
          attributes: new Map(),
          signal_pins: [],
          gates: [],
        };
        this.m_part_types.set(name, pt);
        currentPartType = pt;
        currentGate = null;
      }
    }
  }

  /** An attribute line of a `{ … }` block: a quoted or bare name, then the value. */
  private static attributeLine(line: string): [string, string] {
    let attrName = '';
    let attrValue = '';

    if (line[0] === '"') {
      const endQuote = line.indexOf('"', 1);

      if (endQuote >= 0) {
        attrName = line.substring(1, endQuote);
        attrValue = line.substring(endQuote + 1);
      }
    } else {
      const attrSS = new ISTRINGSTREAM(line);
      attrName = attrSS.readString(attrName);
      attrValue = attrSS.ws().getline(attrValue);
    }

    if (attrValue !== '' && attrValue[0] === ' ') attrValue = attrValue.substring(1);

    return [attrName, attrValue];
  }

  private parseSectionREUSE(): void {
    let currentBlock: REUSE_BLOCK | null = null;

    const restOfLine = (ss: ISTRINGSTREAM): string => {
      let v = ss.getline();

      if (v !== '' && v[0] === ' ') v = v.substring(1);

      return v;
    };

    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      const ss = new ISTRINGSTREAM(line);
      const keyword = ss.readString();

      if (keyword === 'TYPE') {
        const typename_val = restOfLine(ss);

        const block: REUSE_BLOCK = {
          name: typename_val,
          timestamp: 0,
          part_naming: '',
          net_naming: '',
          part_names: [],
          nets: [],
          instances: [],
        };
        this.m_reuse_blocks.set(typename_val, block);
        currentBlock = block;
      } else if (keyword === 'TIMESTAMP' && currentBlock) {
        currentBlock.timestamp = ss.readLong(0);
      } else if (keyword === 'PART_NAMING' && currentBlock) {
        currentBlock.part_naming = restOfLine(ss);
      } else if (keyword === 'PART' && currentBlock) {
        currentBlock.part_names.push(restOfLine(ss));
      } else if (keyword === 'NET_NAMING' && currentBlock) {
        currentBlock.net_naming = restOfLine(ss);
      } else if (keyword === 'NET' && currentBlock) {
        const merge_flag = ss.readInt(0);
        const netname = restOfLine(ss);
        currentBlock.nets.push({ merge: merge_flag === 1, name: netname });
      } else if (keyword === 'REUSE' && currentBlock) {
        const instance: REUSE_INSTANCE = {
          instance_name: '',
          part_naming: '',
          net_naming: '',
          location: { x: 0, y: 0 },
          rotation: 0,
          glued: false,
        };
        instance.instance_name = ss.readString(instance.instance_name);
        let next_token = ss.readString();

        if (next_token === 'PREFIX' || next_token === 'SUFFIX') {
          const param = ss.readString();
          instance.part_naming = `${next_token} ${param}`;
          next_token = ss.readString(next_token);
        } else if (next_token === 'START' || next_token === 'INCREMENT') {
          const num = ss.readString();
          instance.part_naming = `${next_token} ${num}`;
          next_token = ss.readString(next_token);
        } else if (next_token === 'NEXT') {
          instance.part_naming = next_token;
          next_token = ss.readString(next_token);
        }

        if (next_token === 'PREFIX' || next_token === 'SUFFIX') {
          const param = ss.readString();
          instance.net_naming = `${next_token} ${param}`;
        } else if (next_token === 'START' || next_token === 'INCREMENT') {
          const num = ss.readString();
          instance.net_naming = `${next_token} ${num}`;
        } else if (next_token === 'NEXT') {
          instance.net_naming = next_token;
        }

        instance.location.x = ss.readDouble(instance.location.x);
        instance.location.y = ss.readDouble(instance.location.y);
        instance.rotation = ss.readDouble(instance.rotation);
        const glued_str = ss.readString();
        instance.glued = glued_str === 'Y' || glued_str === 'YES' || glued_str === '1';
        currentBlock.instances.push(instance);
      }
    }
  }

  private parseSectionCLUSTER(): void {
    let currentCluster: CLUSTER | null = null;

    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      const ss = new ISTRINGSTREAM(line);
      const firstToken = ss.readString();

      if (firstToken === '') continue;

      const isNumeric = [...firstToken].every((c) => isdigit(c));

      if (isNumeric) {
        const cluster: CLUSTER = {
          name: '',
          id: ParseInt(firstToken, 0, 'CLUSTER'),
          net_names: [],
          segment_refs: [],
        };

        const name = ss.str();

        cluster.name = name !== null ? name : `Cluster_${firstToken}`;

        this.m_clusters.push(cluster);
        currentCluster = cluster;
      } else if (currentCluster) {
        const add = (item: string): void => {
          if (item.includes('.')) currentCluster!.segment_refs.push(item);
          else currentCluster!.net_names.push(item);
        };

        add(firstToken);

        for (let item = ss.str(); item !== null; item = ss.str()) add(item);
      }
    }
  }

  private parseSectionJUMPER(): void {
    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      const ss = new ISTRINGSTREAM(line);
      const name = ss.readString();
      const flags = ss.readString();
      const minlen = ss.readDouble(0.0);
      const maxlen = ss.readDouble(0.0);
      const lenincr = ss.readDouble(0.0);
      const lcount = ss.readInt(0);
      const padstack = ss.readString();

      if (ss.fail()) continue;

      const end_padstack = ss.readString();

      const jumper: JUMPER_DEF = {
        name,
        via_enabled: false,
        wirebond: false,
        display_silk: false,
        glued: false,
        min_length: minlen,
        max_length: maxlen,
        length_increment: lenincr,
        padstack,
        end_padstack,
        labels: [],
      };

      for (const c of flags) {
        switch (c) {
          case 'V':
            jumper.via_enabled = true;
            break;
          case 'N':
            jumper.via_enabled = false;
            break;
          case 'W':
            jumper.wirebond = true;
            break;
          case 'D':
            jumper.display_silk = true;
            break;
          case 'G':
            jumper.glued = true;
            break;
          default:
            break;
        }
      }

      for (let i = 0; i < lcount; ++i) {
        const attr = newAttribute();

        line = this.readLine();
        if (line === null) break;

        const ss_attr = new ISTRINGSTREAM(line);
        const visible_str = ss_attr.readString();
        const mirrored_str = this.readAttributeFields(ss_attr, attr);

        if (mirrored_str !== null) {
          attr.visible = PARSER.isVisibleToken(visible_str);
          attr.mirrored = mirrored_str === 'M' || mirrored_str === '1';
          const right_reading_str = ss_attr.readString();
          attr.right_reading = right_reading_str === 'Y' || right_reading_str === 'ORTHO';
        }

        if (this.m_has_font_lines) {
          line = this.readLine();
          if (line === null) break;

          attr.font_info = line;
        }

        jumper.labels.push(attr);
      }

      this.m_jumper_defs.push(jumper);
    }
  }

  private parseSectionTESTPOINT(): void {
    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      const ss = new ISTRINGSTREAM(line);
      const type = ss.readString();

      if (type === '') continue;

      const tp: TEST_POINT = { type, x: 0, y: 0, side: 0, net_name: '', symbol_name: '' };
      tp.x = ss.readDouble(tp.x);
      tp.y = ss.readDouble(tp.y);
      tp.side = ss.readInt(tp.side);
      tp.net_name = ss.readString(tp.net_name);
      tp.symbol_name = ss.readString(tp.symbol_name);

      if (tp.net_name !== '') this.m_test_points.push(tp);
    }
  }

  private parseSectionNETCLASS(): void {
    let currentClass = newNetClass();
    let inClass = false;

    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        if (inClass && currentClass.name !== '')
          this.m_net_classes.push(copyNetClass(currentClass));

        this.pushBackLine(line);
        break;
      }

      const ss = new ISTRINGSTREAM(line);
      const token = ss.readString();

      if (token === '') continue;

      if (token === 'CLASS' || token === 'NETCLASS') {
        if (inClass && currentClass.name !== '')
          this.m_net_classes.push(copyNetClass(currentClass));

        currentClass = newNetClass();
        currentClass.name = ss.readString(currentClass.name);
        inClass = true;
      } else if (token === 'CLEARANCE' && inClass) {
        currentClass.clearance = ss.readDouble(currentClass.clearance);
      } else if (token === 'TRACKWIDTH' && inClass) {
        currentClass.track_width = ss.readDouble(currentClass.track_width);
      } else if (token === 'VIASIZE' && inClass) {
        currentClass.via_size = ss.readDouble(currentClass.via_size);
      } else if (token === 'VIADRILL' && inClass) {
        currentClass.via_drill = ss.readDouble(currentClass.via_drill);
      } else if (token === 'DIFFPAIRGAP' && inClass) {
        currentClass.diff_pair_gap = ss.readDouble(currentClass.diff_pair_gap);
      } else if (token === 'DIFFPAIRWIDTH' && inClass) {
        currentClass.diff_pair_width = ss.readDouble(currentClass.diff_pair_width);
      } else if (token === 'NET' && inClass) {
        const netName = ss.readString();

        if (netName !== '') currentClass.net_names.push(netName);
      } else if (token !== '' && token[0] !== '#') {
        if (!inClass || (inClass && currentClass.name === '')) {
          currentClass = newNetClass();
          currentClass.name = token;
          inClass = true;
        }
      }
    }

    if (inClass && currentClass.name !== '') this.m_net_classes.push(copyNetClass(currentClass));
  }

  private parseSectionDIFFPAIR(): void {
    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      const ss = new ISTRINGSTREAM(line);
      const token = ss.readString();

      if (token === '') continue;

      const last = (): DIFF_PAIR_DEF => this.m_diff_pairs[this.m_diff_pairs.length - 1]!;

      if (token === 'DIFFPAIR' || token === 'PAIR') {
        const dp = newDiffPair();
        dp.name = ss.readString(dp.name);
        const posNet = ss.readString();
        const negNet = ss.readString();

        if (posNet !== '') dp.positive_net = posNet;

        if (negNet !== '') dp.negative_net = negNet;

        const gap = ss.dbl();

        if (gap !== null) dp.gap = gap;

        const width = ss.dbl();

        if (width !== null) dp.width = width;

        if (dp.name !== '') this.m_diff_pairs.push(dp);
      } else if (token === 'POS' && this.m_diff_pairs.length > 0) {
        last().positive_net = ss.readString(last().positive_net);
      } else if (token === 'NEG' && this.m_diff_pairs.length > 0) {
        last().negative_net = ss.readString(last().negative_net);
      } else if (token === 'GAP' && this.m_diff_pairs.length > 0) {
        last().gap = ss.readDouble(last().gap);
      } else if ((token === 'WIDTH' || token === 'TRACKWIDTH') && this.m_diff_pairs.length > 0) {
        last().width = ss.readDouble(last().width);
      }
    }
  }

  private parseSectionLAYERDEFS(): void {
    let braceDepth = 0;
    let currentLayerNum = -1;
    let currentLayer = newLayerInfo();
    let inLayerBlock = false;

    const parseLayerType = (typeStr: string): PADS_LAYER_FUNCTION => {
      switch (typeStr) {
        case 'ROUTING':
          return PADS_LAYER_FUNCTION.ROUTING;
        case 'PLANE':
          return PADS_LAYER_FUNCTION.PLANE;
        case 'MIXED':
          return PADS_LAYER_FUNCTION.MIXED;
        case 'UNASSIGNED':
          return PADS_LAYER_FUNCTION.UNASSIGNED;
        case 'SOLDER_MASK':
          return PADS_LAYER_FUNCTION.SOLDER_MASK;
        case 'PASTE_MASK':
          return PADS_LAYER_FUNCTION.PASTE_MASK;
        case 'SILK_SCREEN':
          return PADS_LAYER_FUNCTION.SILK_SCREEN;
        case 'ASSEMBLY':
          return PADS_LAYER_FUNCTION.ASSEMBLY;
        case 'DOCUMENTATION':
          return PADS_LAYER_FUNCTION.DOCUMENTATION;
        case 'DRILL':
          return PADS_LAYER_FUNCTION.DRILL;
        default:
          return PADS_LAYER_FUNCTION.UNKNOWN;
      }
    };

    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (line === '') continue;

      if (first(line) === '*') {
        this.pushBackLine(line);
        break;
      }

      const iss = new ISTRINGSTREAM(line);
      const token = iss.readString();

      if (token === '{') {
        braceDepth++;
        continue;
      }

      if (token === '}') {
        braceDepth--;

        if (inLayerBlock && braceDepth === 1) {
          if (currentLayerNum >= 0) {
            currentLayer.number = currentLayerNum;
            currentLayer.is_copper =
              currentLayer.layer_type === PADS_LAYER_FUNCTION.ROUTING ||
              currentLayer.layer_type === PADS_LAYER_FUNCTION.PLANE ||
              currentLayer.layer_type === PADS_LAYER_FUNCTION.MIXED;
            currentLayer.required = currentLayer.is_copper;
            this.m_layer_defs.set(currentLayerNum, { ...currentLayer });
          }

          inLayerBlock = false;
          currentLayerNum = -1;
        }

        if (braceDepth <= 0) break;

        continue;
      }

      if (token === 'LAYER') {
        const layerNum = iss.readInt(-1);

        if (!iss.fail() && layerNum >= 0) {
          currentLayerNum = layerNum;
          currentLayer = newLayerInfo();
          currentLayer.number = layerNum;
          currentLayer.layer_type = PADS_LAYER_FUNCTION.UNKNOWN;
          inLayerBlock = true;
        }
      } else if (token === 'LAYER_NAME' && inLayerBlock) {
        currentLayer.name = iss.ws().getline(currentLayer.name);
      } else if (token === 'LAYER_TYPE' && inLayerBlock) {
        currentLayer.layer_type = parseLayerType(iss.readString());
      } else if (token === 'LAYER_THICKNESS' && inLayerBlock) {
        currentLayer.layer_thickness = iss.readDouble(currentLayer.layer_thickness);
      } else if (token === 'COPPER_THICKNESS' && inLayerBlock) {
        currentLayer.copper_thickness = iss.readDouble(currentLayer.copper_thickness);
      } else if (token === 'DIELECTRIC' && inLayerBlock) {
        currentLayer.dielectric_constant = iss.readDouble(currentLayer.dielectric_constant);
      }
    }
  }

  private parseSectionMISC(): void {
    const R = this.m_design_rules;
    let braceDepth = 0;
    let inDifPair = false;
    let inNetClassData = false;
    let inNetClass = false;
    let inRuleSet = false;
    let inRuleSetFor = false;
    let inClearanceRule = false;
    let netClassDataDepth = -1;
    let netClassDepth = -1;
    let ruleSetDepth = -1;
    let clearanceRuleDepth = -1;
    let foundDefaultRules = false;
    let isDefaultRuleSet = false;
    let ruleSetNetClass = '';
    let currentDiffPair = newDiffPair();
    let currentNetClass = newNetClass();

    for (let line = this.readLine(); line !== null; line = this.readLine()) {
      if (line === '') continue;

      if (first(line) === '*' && braceDepth === 0) {
        this.pushBackLine(line);
        break;
      }

      for (const c of line) {
        if (c === '{') {
          braceDepth++;
        } else if (c === '}') {
          braceDepth--;

          if (braceDepth === 0 && inDifPair) {
            if (currentDiffPair.name !== '') this.m_diff_pairs.push({ ...currentDiffPair });

            inDifPair = false;
            currentDiffPair = newDiffPair();
          }

          if (inNetClass && braceDepth <= netClassDepth) {
            if (currentNetClass.name !== '') this.m_net_classes.push(copyNetClass(currentNetClass));

            inNetClass = false;
            currentNetClass = newNetClass();
          }

          if (inNetClassData && braceDepth <= netClassDataDepth) inNetClassData = false;

          if (inClearanceRule && braceDepth < clearanceRuleDepth) {
            inClearanceRule = false;

            if (isDefaultRuleSet) {
              if (R.default_clearance === DBL_MAX)
                R.default_clearance = newDesignRules().default_clearance;

              R.min_clearance = R.default_clearance;

              if (R.copper_edge_clearance === DBL_MAX)
                R.copper_edge_clearance = R.default_clearance;

              foundDefaultRules = true;
            }
          }

          if (inRuleSetFor && braceDepth < ruleSetDepth + 1) inRuleSetFor = false;

          if (inRuleSet && braceDepth < ruleSetDepth) {
            inRuleSet = false;
            isDefaultRuleSet = false;
            ruleSetNetClass = '';
          }
        }
      }

      const iss = new ISTRINGSTREAM(line);
      const token = iss.readString();

      if (token === 'LAYER') {
        const secondToken = iss.readString();

        if (secondToken === 'DATA') {
          this.parseSectionLAYERDEFS();
          continue;
        }
      }

      if (token === 'NET_CLASS') {
        const secondToken = iss.readString();

        if (secondToken === 'DATA') {
          inNetClassData = true;
          netClassDataDepth = braceDepth;
        } else if (inNetClassData && secondToken !== '') {
          if (inNetClass && currentNetClass.name !== '')
            this.m_net_classes.push(copyNetClass(currentNetClass));

          currentNetClass = newNetClass();
          currentNetClass.name = secondToken;
          inNetClass = true;
          netClassDepth = braceDepth;
        } else if (inRuleSetFor && secondToken !== '') {
          ruleSetNetClass = secondToken;
        }
      } else if (inNetClass && token === 'NET') {
        const netName = iss.readString();

        if (netName !== '') currentNetClass.net_names.push(netName);
      } else if (token === 'RULE_SET') {
        const ruleNum = iss.readString();
        inRuleSet = true;
        ruleSetDepth = braceDepth;
        ruleSetNetClass = '';
        isDefaultRuleSet = ruleNum === '(1)' && !foundDefaultRules;
      } else if (inRuleSet && !inClearanceRule && token === 'FOR') {
        inRuleSetFor = true;
      } else if (inRuleSet && token === 'CLEARANCE_RULE') {
        inClearanceRule = true;
        clearanceRuleDepth = braceDepth;

        if (isDefaultRuleSet) {
          R.default_clearance = DBL_MAX;
          R.copper_edge_clearance = DBL_MAX;
        }
      } else if (inClearanceRule) {
        const val = iss.readDouble(0.0);

        if (!iss.fail() && val > 0.0) {
          if (isDefaultRuleSet) {
            if (token === 'MIN_TRACK_WIDTH') {
              R.min_track_width = val;
            } else if (token === 'REC_TRACK_WIDTH') {
              R.default_track_width = val;
            } else if (token === 'DRILL_TO_DRILL') {
              R.hole_to_hole = val;
            } else if (
              token === 'OUTLINE_TO_TRACK' ||
              token === 'OUTLINE_TO_VIA' ||
              token === 'OUTLINE_TO_PAD' ||
              token === 'OUTLINE_TO_COPPER' ||
              token === 'OUTLINE_TO_SMD'
            ) {
              R.copper_edge_clearance = Math.min(R.copper_edge_clearance, val);
            } else if (
              token.startsWith('SAME_NET_') ||
              token === 'BODY_TO_BODY' ||
              token === 'MAX_TRACK_WIDTH' ||
              token.startsWith('TEXT_TO_') ||
              token.startsWith('COPPER_TO_')
            ) {
              // not clearances KiCad takes
            } else if (
              token === 'TRACK_TO_TRACK' ||
              token.startsWith('VIA_TO_') ||
              token.startsWith('PAD_TO_') ||
              token.startsWith('SMD_TO_') ||
              token.startsWith('DRILL_TO_')
            ) {
              R.default_clearance = Math.min(R.default_clearance, val);
            }
          } else if (ruleSetNetClass !== '') {
            for (const nc of this.m_net_classes) {
              if (nc.name === ruleSetNetClass) {
                if (token === 'REC_TRACK_WIDTH') nc.track_width = val;
                else if (token === 'TRACK_TO_TRACK') nc.clearance = val;

                break;
              }
            }
          }
        }
      } else if (token === 'DIF_PAIR') {
        if (inDifPair && currentDiffPair.name !== '')
          this.m_diff_pairs.push({ ...currentDiffPair });

        currentDiffPair = newDiffPair();
        currentDiffPair.name = iss.readString(currentDiffPair.name);
        inDifPair = true;
      } else if (inDifPair) {
        if (token === 'NET') {
          const netName = iss.readString();

          if (currentDiffPair.positive_net === '') currentDiffPair.positive_net = netName;
          else if (currentDiffPair.negative_net === '') currentDiffPair.negative_net = netName;
        } else if (token === 'GAP') {
          currentDiffPair.gap = iss.readDouble(currentDiffPair.gap);
        } else if (token === 'WIDTH') {
          currentDiffPair.width = iss.readDouble(currentDiffPair.width);
        } else if (token === 'CONNECTION') {
          // nothing
        } else if (token === 'ASSOCIATED') {
          const keyword = iss.readString();
          const netName = iss.readString();

          if (keyword === 'NET') {
            if (currentDiffPair.positive_net === '') currentDiffPair.positive_net = netName;
            else if (currentDiffPair.negative_net === '') currentDiffPair.negative_net = netName;
          }
        }
      }

      if (token === 'PART' && !inDifPair && !inNetClass) {
        const partName = iss.readString();

        if (partName !== '') {
          const savedDepth = braceDepth;
          let attrs = this.m_part_instance_attrs.get(partName);

          if (!attrs) {
            attrs = new Map();
            this.m_part_instance_attrs.set(partName, attrs);
          }

          for (line = this.readLine(); line !== null; line = this.readLine()) {
            if (line === '') continue;

            if (first(line) === '}') break;

            if (first(line) === '{') continue;

            if (first(line) === '*') {
              this.pushBackLine(line);
              this.clampDesignRuleSentinels();
              return;
            }

            const [attrName, attrValue] = PARSER.attributeLine(line);

            if (attrName !== '' && attrValue !== '') attrs.set(attrName, attrValue);
          }

          braceDepth = savedDepth;
        }

        continue;
      }
    }

    this.clampDesignRuleSentinels();
  }

  private clampDesignRuleSentinels(): void {
    const defaults = newDesignRules();

    if (this.m_design_rules.default_clearance === DBL_MAX)
      this.m_design_rules.default_clearance = defaults.default_clearance;

    if (this.m_design_rules.copper_edge_clearance === DBL_MAX)
      this.m_design_rules.copper_edge_clearance = defaults.copper_edge_clearance;
  }

  GetLayerInfos(): LAYER_INFO[] {
    const layers: LAYER_INFO[] = [];
    let layerCount = this.m_parameters.layer_count;

    if (layerCount < 1) layerCount = 2;

    const isCopperLayer = (num: number): boolean => num >= 1 && num <= layerCount;

    for (let i = 1; i <= layerCount; ++i) {
      const parsed = this.m_layer_defs.get(i);

      if (parsed) {
        layers.push({ ...parsed });
      } else {
        let name: string;

        if (i === 1) name = 'Top';
        else if (i === layerCount) name = 'Bottom';
        else name = `Inner ${i - 1}`;

        layers.push(newLayerInfo(i, name, PADS_LAYER_FUNCTION.ROUTING, true, true));
      }
    }

    for (const [num, layerDef] of sortedMap(this.m_layer_defs)) {
      if (!isCopperLayer(num)) layers.push({ ...layerDef });
    }

    if (this.m_layer_defs.size === 0) {
      const F = PADS_LAYER_FUNCTION;
      layers.push(newLayerInfo(21, 'Assembly Top', F.ASSEMBLY));
      layers.push(newLayerInfo(22, 'Assembly Bottom', F.ASSEMBLY));
      layers.push(newLayerInfo(25, 'Solder Mask Top', F.SOLDER_MASK));
      layers.push(newLayerInfo(26, 'Silkscreen Top', F.SILK_SCREEN));
      layers.push(newLayerInfo(27, 'Silkscreen Bottom', F.SILK_SCREEN));
      layers.push(newLayerInfo(28, 'Solder Mask Bottom', F.SOLDER_MASK));
      layers.push(newLayerInfo(29, 'Paste Top', F.PASTE_MASK));
      layers.push(newLayerInfo(30, 'Paste Bottom', F.PASTE_MASK));
    }

    return layers;
  }
}

/** `std::string::substr( pos, n )` with n possibly past the end (or "npos"-like when negative). */
function substr(s: string, pos: number, n: number): string {
  if (n < 0) return s.substring(pos);
  return s.substring(pos, pos + n);
}
