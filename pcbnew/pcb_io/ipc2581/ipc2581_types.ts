// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/ipc2581/ipc2581_types.h`: the IPC-2581 schema's enumerations, transcribed
 * mechanically from the header (data, not chrome).
 */

export enum bomCategoryType {
  ELECTRICAL,
  PROGRAMMABLE,
  MECHANICAL,
  MATERIAL,
  DOCUMENT,
}

export enum boardTechnologyType {
  RIGID,
  RIGID_FLEX,
  FLEX,
  HDI,
  EMBEDDED_COMPONENT,
  OTHER,
}

export enum butterflyShapeType {
  ROUND,
  SQUARE,
}

export enum cadPinType {
  THRU,
  BLIND,
  SURFACE,
}

export enum auxLayerType {
  COVERING,
  PLUGGING,
  TENTING,
  FILLING,
  CAPPING,
}

export enum certificationCategoryType {
  ASSEMBLYDRAWING,
  ASSEMBLYFIXTUREGENERATION,
  ASSEMBLYPANEL,
  ASSEMBLYPREPTOOLS,
  ASSEMBLYTESTFIXTUREGENERATION,
  ASSEMBLYTESTGENERATION,
  BOARDFABRICATION,
  BOARDFIXTUREGENERATION,
  BOARDPANEL,
  BOARDTESTGENERATION,
  COMPONENTPLACEMENT,
  DETAILEDDRAWING,
  FABRICATIONDRAWING,
  GENERALASSEMBLY,
  GLUEDOT,
  MECHANICALHARDWARE,
  MULTIBOARDPARTSLIST,
  PHOTOTOOLS,
  SCHEMATICDRAWINGS,
  SINGLEBOARDPARTSLIST,
  SOLDERSTENCILPASTE,
  SPECSOURCECONTROLDRAWING,
  EMBEDDEDCOMPONENT,
  OTHER,
}

export enum certificationStatusType {
  ALPHA,
  BETA,
  CERTIFIED,
  SELFTEST,
}

export enum complianceListType {
  ROHS,
  CONFLICT_MINERALS,
  WEEE,
  REACH,
  HALOGEN_FREE,
  OTHER,
}

export enum conductorListType {
  CONDUCTIVITY,
  SURFACE_ROUGHNESS_UPFACING,
  SURFACE_ROUGHNESS_DOWNFACING,
  SURFACE_ROUGHNESS_TREATED,
  ETCH_FACTOR,
  FINISHED_HEIGHT,
  OTHER,
}

export enum colorListType {
  BLACK,
  WHITE,
  RED,
  GREEN,
  YELLOW,
  BLUE,
  BROWN,
  ORANGE,
  PINK,
  PURPLE,
  GRAY,
  OTHER,
}

export enum contextType {
  BOARD,
  BOARDPANEL,
  ASSEMBLY,
  ASSEMBLYPALLET,
  DOCUMENTATION,
  TOOLING,
  COUPON,
  MISCELLANEOUS,
}

export enum dfxCategoryType {
  COMPONENT,
  BOARDFAB,
  ASSEMBLY,
  TESTING,
  DATAQUALITY,
}

export enum dielectricListType {
  DIELECTRIC_CONSTANT,
  LOSS_TANGENT,
  GLASS_TYPE,
  GLASS_STYLE,
  RESIN_CONTENT,
  PROCESSABILITY_TEMP,
  OTHER,
}

export enum donutShapeType {
  ROUND,
  SQUARE,
  HEXAGON,
  OCTAGON,
}

export enum toolListType {
  CARBIDE,
  ROUTER,
  LASER,
  FLATNOSE,
  EXTENSION,
  V_CUTTER,
}

export enum toolPropertyListType {
  DRILL_SIZE,
  FINISHED_SIZE,
  BIT_ANGLE,
  OTHER,
}

export enum enterpriseCodeType {
  DUNNS,
  CAGE,
}

export enum exposureType {
  EXPOSED,
  COVERED_PRIMARY,
  COVERED_SECONDARY,
  COVERED,
}

export enum floorLifeType {
  UNLIMITED,
  _1_YEAR,
  _4_WEEKS,
  _168_HOURS,
  _72_HOURS,
  _48_HOURS,
  _24_HOURS,
  BAKE,
}

export enum geometryUsageType {
  THIEVING,
  THERMAL_RELIEF,
  NONE,
}

export enum generalListType {
  ELECTRICAL,
  THERMAL,
  MATERIAL,
  INSTRUCTION,
  STANDARD,
  CONFIGURATION,
  OTHER,
}

export enum impedanceListType {
  IMPEDANCE,
  LINEWIDTH,
  SPACING,
  REF_PLANE_LAYER_ID,
  COPLANAR_GROUND_SPACING,
  OTHER,
}

export enum isoCodeType {
  AD,
  AE,
  AF,
  AG,
  AI,
  AL,
  AM,
  AN,
  AO,
  AQ,
  AR,
  AS,
  AT,
  AU,
  AW,
  AZ,
  BA,
  BB,
  BD,
  BE,
  BF,
  BG,
  BH,
  BI,
  BJ,
  BM,
  BN,
  BO,
  BR,
  BS,
  BT,
  BV,
  BW,
  BY,
  BZ,
  CA,
  CC,
  CF,
  CG,
  CH,
  CI,
  CK,
  CL,
  CM,
  CN,
  CO,
  CR,
  CU,
  CV,
  CX,
  CY,
  CZ,
  DE,
  DJ,
  DK,
  DM,
  DO,
  DZ,
  EC,
  EE,
  EG,
  EH,
  ER,
  ES,
  ET,
  FI,
  FJ,
  FK,
  FM,
  FO,
  FR,
  FX,
  GA,
  GB,
  GD,
  GE,
  GF,
  GH,
  GI,
  GL,
  GM,
  GN,
  GP,
  GQ,
  GR,
  GS,
  GT,
  GU,
  GW,
  GY,
  HK,
  HM,
  HN,
  HR,
  HT,
  HU,
  ID,
  IE,
  IL,
  IND, // iso code IN conflicts header, just use the A-3 type
  IO,
  IQ,
  IR,
  IS,
  IT,
  JM,
  JO,
  JP,
  KE,
  KG,
  KH,
  KI,
  KM,
  KN,
  KP,
  KR,
  KW,
  KY,
  KZ,
  LA,
  LB,
  LC,
  LI,
  LK,
  LR,
  LS,
  LT,
  LU,
  LV,
  LY,
  MA,
  MC,
  MD,
  MG,
  MH,
  MK,
  ML,
  MM,
  MN,
  MO,
  MP,
  MQ,
  MR,
  MS,
  MT,
  MU,
  MV,
  MW,
  MX,
  MY,
  MZ,
  NA,
  NC,
  NE,
  NF,
  NG,
  NI,
  NL,
  NO,
  NP,
  NR,
  NU,
  NZ,
  OM,
  PA,
  PE,
  PF,
  PG,
  PH,
  PK,
  PL,
  PM,
  PN,
  PR,
  PT,
  PW,
  PY,
  QA,
  RE,
  RO,
  RU,
  RW,
  SA,
  SB,
  SC,
  SD,
  SE,
  SG,
  SH,
  SI,
  SJ,
  SK,
  SL,
  SM,
  SN,
  SO,
  SR,
  ST,
  SV,
  SY,
  SZ,
  TC,
  TD,
  TF,
  TG,
  TH,
  TJ,
  TK,
  TM,
  TN,
  TO,
  TP,
  TR,
  TT,
  TV,
  TW,
  TZ,
  UA,
  UG,
  UM,
  US,
  UY,
  UZ,
  VA,
  VC,
  VE,
  VG,
  VI,
  VN,
  VU,
  WF,
  WS,
  YE,
  YT,
  YU,
  ZA,
  ZM,
  ZR,
  ZW,
}

export enum lineEndType {
  NONE,
  ROUND,
  SQUARE,
}

export enum fillPropertyType {
  HOLLOW,
  HATCH,
  MESH,
  FILL,
  VOIDFILL,
}

export enum linePropertyType {
  SOLID,
  DOTTED,
  DASHED,
  CENTER,
  PHANTOM,
  ERASE,
}

export enum markingUsageType {
  REFDES,
  PARTNAME,
  TARGET,
  POLARITY_MARKING,
  ATTRIBUTE_GRAPHICS,
  PIN_ONE,
  NONE,
}

export enum mountType {
  SMT,
  THMT,
  OTHER,
}

export enum netClassType {
  CLK,
  FIXED,
  GROUND,
  SIGNAL,
  POWER,
  UNUSED,
}

export enum netPointType {
  END,
  MIDDLE,
}

export enum packageTypeType {
  AXIAL_LEADED,
  BARE_DIE,
  CERAMIC_BGA,
  CERAMIC_DIP,
  CERAMIC_FLATPACK,
  CERAMIC_QUAD_FLATPACK,
  CERAMIC_SIP,
  CHIP,
  CHIP_SCALE,
  CHOKE_SWITCH_SM,
  COIL,
  CONNECTOR_SM,
  CONNECTOR_TH,
  EMBEDDED,
  FLIPCHIP,
  HERMETIC_HYBRED,
  LEADLESS_CERAMIC_CHIP_CARRIER,
  MCM,
  MELF,
  FINEPITCH_BGA,
  MOLDED,
  NETWORK,
  PGA,
  PLASTIC_BGA,
  PLASTIC_CHIP_CARRIER,
  PLASTIC_DIP,
  PLASTIC_SIP,
  POWER_TRANSISTOR,
  RADIAL_LEADED,
  RECTANGULAR_QUAD_FLATPACK,
  RELAY_SM,
  RELAY_TH,
  SOD123,
  SOIC,
  SOJ,
  SOPIC,
  SOT143,
  SOT23,
  SOT52,
  SOT89,
  SQUARE_QUAD_FLATPACK,
  SSOIC,
  SWITCH_TH,
  TANTALUM,
  TO_TYPE,
  TRANSFORMER,
  TRIMPOT_SM,
  TRIMPOT_TH,
  OTHER,
}

export enum padUsageType {
  TERMINATION,
  VIA,
  PLANE,
  MASK,
  TOOLING_HOLE,
  THIEVING,
  THERMAL_RELIEF,
  FIDUCIAL,
  NONE,
}

export enum padUseType {
  REGULAR,
  ANTIPAD,
  THERMAL,
  OTHER,
}

export enum pinElectricalType {
  ELECTRICAL,
  MECHANICAL,
  UNDEFINED,
}

export enum pinMountType {
  SURFACE_MOUNT_PIN,
  SURFACE_MOUNT_PAD,
  THROUGH_HOLE_PIN,
  THROUGH_HOLE_HOLE,
  PRESSFIT,
  NONBOARD,
  HOLE,
  UNDEFINED,
}

export enum pinOneOrientationType {
  LOWER_LEFT,
  LEFT,
  LEFT_CENTER,
  UPPER_LEFT,
  UPPER_CENTER,
  UPPER_RIGHT,
  RIGHT,
  RIGHT_CENTER,
  LOWER_RIGHT,
  LOWER_CENTER,
  CENTER,
  OTHER,
}

export enum polarityType {
  POSITIVE,
  NEGATIVE,
}

export enum propertyUnitType {
  MM,
  INCH,
  MICRON,
  OHMS,
  MHO_CM,
  SIEMENS_M,
  CELCIUS,
  FARANHEIT,
  PERCENT,
  Hz,
  DEGREES,
  RMAX,
  RZ,
  RMS,
  SECTION,
  CLASS,
  ITEM,
  GAUGE,
  OTHER,
}

export enum roleFunctionType {
  SENDER,
  OWNER,
  RECEIVER,
  DESIGNER,
  ENGINEER,
  BUYER,
  CUSTOMERSERVICE,
  DELIVERTO,
  BILLTO,
  OTHER,
}

export enum platingStatusType {
  PLATED,
  NONPLATED,
  VIA,
}

export enum standardPrimitive {
  BUTTERFLY,
  CIRCLE,
  CONTOUR,
  DIAMOND,
  DONUT,
  ELLIPSE,
  HEXAGON,
  MOIRE,
  OCTAGON,
  OVAL,
  RECTCENTER,
  RECTCHAM,
  RECTCORNER,
  RECTROUND,
  THERMAL,
  TRIANGLE,
}

export enum structureListType {
  STRIPLINE,
  PLANE_LESS_STRIPLINE,
  MICROSTRIP_EMBEDDED,
  MICROSTRIP_NO_MASK,
  MICROSTRIP_MASK_COVERED,
  MICROSTRIP_DUAL_MASKED_COVERED,
  COPLANAR_WAVEGUIDE_STRIPLINE,
  COPLANAR_WAVEGUIDE_EMBEDDED,
  COPLANAR_WAVEGUIDE_NO_MASK,
  COPLANAR_WAVEGUIDE_MASK_COVERED,
  COPLANAR_WAVEGUIDE_DUAL_MASKED_COVERED,
  OTHER,
}

export enum technologyListType {
  RIGID,
  RIGID_FLEX,
  FLEX,
  HDI,
  EMBEDDED_COMPONENT,
  OTHER,
}

export enum temperatureListType {
  THERMAL_DELAMINATION,
  EXPANSION_Z_AXIS,
  EXPANSION_X_Y_AXIS,
  OTHER,
}

export enum thermalShapeType {
  ROUND,
  SQUARE,
  HEXAGON,
  OCTAGON,
}

export enum thievingListType {
  KEEP_IN,
  KEEP_OUT,
}

export enum transmissionListType {
  SINGLE_ENDED,
  EDGE_COUPLED,
  BROADSIDE_COUPLED,
  OTHER,
}

export enum unitModeType {
  DISTANCE,
  AREA,
  RESISTANCE,
  CAPACITANCE,
  IMPEDANCE,
  PERCENTAGE,
  SIZE,
  NONE,
}

export enum unitsType {
  MILLIMETER,
  MICRON,
  INCH,
}

export enum vCutListType {
  ANGLE,
  THICKNESS_REMAINING,
  OFFSET,
  OTHER,
}

export enum edgeChamferListType {
  ANGLE,
  WIDTH,
  SIDE,
}

export enum whereMeasuredType {
  LAMINATE,
  METAL,
  MASK,
  OTHER,
}

/**
 * IPC-6012 surface finish types from Table 3-3 "Final Finish and Coating Requirements".
 * Used in IPC-2581C Section 8.1.1.16 SurfaceFinish specification.
 *
 * ENIG/ENEPIG suffixes: -N = Normal (soldering), -G = Gold wire bonding (thicker gold)
 */
export enum surfaceFinishType {
  NONE, // No surface finish / not specified - skip coating layer generation
  ENIG_N, // ENIG for soldering (normal gold thickness)
  ENEPIG_N, // ENEPIG for soldering (normal gold thickness)
  OSP, // Organic Solderability Preservative
  HT_OSP, // High Temperature OSP
  IAG, // Immersion Silver
  ISN, // Immersion Tin
  G, // Gold (hard gold)
  N, // Nickel
  DIG, // Direct Immersion Gold
  S, // Solder (HASL/SMOBC)
  OTHER, // Non-standard finish
}
