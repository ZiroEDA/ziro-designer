// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** @ziroeda/pcbnew, board engine mirroring KiCad's pcbnew/. */
export * from './types.js';
export { connectedTrackEnds, type TrackEndRef } from './connectivity.js';
export { buildRatsnest, type RatsnestEdge } from './ratsnest.js';
export { readBoard, readFootprintFile, rotatePcb, tessellateArc, arcCenter } from './read-board.js';
export {
  serializeFootprint,
  writeFootprintNode,
  buildPadNode,
  buildShapeNode,
  buildTextNode,
  FOOTPRINT_FILE_VERSION,
} from './write-footprint.js';
export {
  fpItemId,
  parseFpItemId,
  footprintBBox,
  fpItemBBox,
  hitTestFootprint,
  itemsInBox,
  moveFootprintItems,
  rotateFootprintItems,
  mirrorFootprintItems,
  deleteFootprintItems,
  addPad,
  addShape,
  addText,
  replaceFootprintItem,
  setFootprintReference,
  setFootprintValue,
  setFootprintDescription,
  setFootprintKeywords,
  footprintStringChild,
  patchPad,
  type FpItemKind,
  type FpItemRef,
  type FpBBox,
  type PadEdit,
} from './edit-footprint.js';
export {
  boardItemId,
  parseBoardItemId,
  boardItemBBox,
  hitTestBoard,
  boardHitCandidates,
  boardItemsInBox,
  allBoardItemIds,
  moveBoardItems,
  dragBoardItems,
  setFootprintField,
  setFootprintLocked,
  setFootprintOrientation,
  subsetBoardItems,
  deleteBoardItems,
  addBoardShape,
  addBoardTrack,
  addBoardVia,
  addBoardText,
  addBoardDimension,
  addBoardImage,
  addBoardTextBox,
  addBoardTable,
  addBoardZone,
  rotateBoardItems,
  rotateBoardItemsBy,
  duplicateBoardItems,
  boardSelectionBBox,
  mirrorBoardItems,
  groupBoardItems,
  ungroupBoardItems,
  addToGroupItems,
  removeFromGroupItems,
  expandGroupIds,
  filterSelectionForFreePads,
  filterSelectionForDelete,
  zoneHandles,
  moveZoneCorner,
  moveZoneEdge,
  type ZoneHandle,
  groupContaining,
  boardUuidIndex,
  setBoardItemsLocked,
  isBoardItemLocked,
  setBoardPageSettings,
  type BoardPageSettings,
  type BoardItemKind,
  type BoardItemRef,
  type BoardBBox,
} from './edit-board.js';
export {
  plotGerberLayer,
  plotExcellonDrill,
  gerberProtelExtension,
  plotGerberJob,
  gerberFileFunction,
  boardAuxOrigin,
  boardGridOrigin,
  type GerberPlotOpts,
} from './plot_gerber.js';
export {
  serializeBoard,
  writeBoardNode,
  buildTrackNode,
  buildArcTrackNode,
  buildViaNode,
  buildBoardShapeNode,
  buildBoardTextNode,
  buildDimensionNode,
  buildTextBoxNode,
  buildTableNode,
  buildImageNode,
  BASE64_LINE_WIDTH,
  buildTableCellNode,
} from './write-board.js';
export {
  runDrc,
  type DrcOptions,
  type DrcViolation,
  type DrcItemRef,
} from './drc/drc_engine.js';

// --- Netlist (eeschema -> pcbnew) --------------------------------------------
export {
  COMPONENT,
  COMPONENT_NET,
  NETLIST,
  fpidIsLegacy,
  fpidItemName,
  fpidLibNickname,
  type NETLIST_GROUP,
  type UNIT_INFO,
} from './netlist_reader/pcb_netlist.js';
export { loadKicadNetlist, parseKicadNetlist } from './netlist_reader/kicad_netlist_reader.js';
export {
  BOARD_NETLIST_UPDATER,
  fpidsEquivalent,
  type BoardNetlistUpdaterOptions,
  type BoardNetlistUpdateResult,
  type FootprintLoader,
} from './netlist_reader/board_netlist_updater.js';
export {
  appendNet,
  declaredNetCodes,
  findNet,
  netName,
  removeUnusedNets,
  renameNet,
  UNCONNECTED_NET,
} from './netinfo.js';
export {
  exchangeFootprint,
  placeFootprint,
  newUuid as newBoardUuid,
  type PlaceFootprintOptions,
} from './board_exchange_footprint.js';
export { computeFootprintShift, type FootprintShift } from './footprint_utils.js';
export {
  spreadFootprints,
  spreadBoardFootprints,
  getRefDesPrefix,
  getTrailingInt,
  type SpreadFootprintsOptions,
} from './spread_footprints.js';

// Zone filling (pcbnew/zone_filler.cpp: ZONE_FILLER).
export { fillZone, fillZones, type ZoneFillOptions } from './zone_filler.js';

// Track dragging (pcbnew/router: PNS::DRAGGER + PNS::LINE geometry).
export {
  assembleLine,
  startTrackDrag,
  updateTrackDrag,
  trackDragSegments,
  applyTrackDrag,
  type AssembledLine,
  type TrackDrag,
  type DragMode,
} from './router/pns_drag.js';

// Teardrops (pcbnew/teardrop: TEARDROP_MANAGER).
export {
  updateTeardrops,
  applyTeardrops,
  removeTeardrops,
  boardHasTeardrops,
  teardropInputsChanged,
  teardropZones,
  addTeardropsOnTracks,
  setTeardropPriorities,
  computeTeardropPolygon,
  defaultTeardropParameters,
  defaultTeardropParametersList,
  MAGIC_TEARDROP_ZONE_ID,
  TargetTd,
  type Teardrop,
  type TeardropType,
  type TeardropParameters,
  type TeardropParametersList,
  type UpdateTeardropsOptions,
} from './teardrop.js';

// Edit Teardrops (pcbnew/dialogs/dialog_global_edit_teardrops.cpp).
export {
  applyGlobalTeardropEdit,
  countGlobalTeardropTargets,
  DEFAULT_GLOBAL_TEARDROP_EDIT,
  type GlobalTeardropEditOptions,
  type GlobalTeardropEditContext,
  type TeardropEditAction,
} from './teardrop_global_edit.js';

// Item properties dialogs (pcbnew/dialogs/: DIALOG_TRACK_VIA_PROPERTIES,
// DIALOG_COPPER_ZONE over PANEL_ZONE_PROPERTIES).
export {
  trackViaSelection,
  collectTrackViaValues,
  applyTrackViaValues,
  hasTrackOrVia,
  type TrackViaSelection,
  type TrackViaValues,
} from './track_via_properties.js';
export {
  zoneAt,
  collectZoneValues,
  applyZoneValues,
  type ZoneValues,
} from './zone_properties.js';
export {
  footprintAt,
  collectFootprintValues,
  applyFootprintValues,
  attributesFor,
  FOOTPRINT_ATTRIBUTES,
  type FootprintValues,
  type FootprintAttribute,
} from './footprint_properties.js';
export {
  padAt,
  collectPadValues,
  applyPadValues,
  padLocalPos,
  type PadRef,
  type PadValues,
} from './pad_properties.js';
export {
  textAt,
  shapeAt,
  collectTextValues,
  applyTextValues,
  collectShapeValues,
  applyShapeValues,
  shapePointsUsed,
  type TextValues,
  type ShapeValues,
} from './graphic_properties.js';

// Custom design rules (pcbnew/drc: DRC_RULES_PARSER, LIBEVAL over PCBEXPR).
export {
  parseDrcRules,
  parseRuleValue,
  type DrcRule,
  type DrcRuleSet,
  type DrcConstraint,
  type DrcConstraintType,
  type DrcSeverity,
  type MinOptMax,
} from './drc/drc_rule.js';
export {
  parseDrcExpr,
  evalDrcExpr,
  testDrcCondition,
  DrcExprError,
  type DrcExpr,
  type DrcExprContext,
} from './drc/drc_expr.js';
export {
  buildDrcRuleEngine,
  evalDrcRules,
  ruleMatchesLayer,
  boardSetupRules,
  netClassRules,
  type DrcRuleEngine,
  type DrcEvalItem,
  type DrcItemType,
  type ResolvedConstraint,
  reportDrcConstraint,
  type ConstraintReport,
} from './drc/drc_rules_engine.js';

export {
  boardEditHandles,
  dragBoardHandle,
  hasEditPoints,
  editablePointItems,
  arcHandleCentre,
  type BoardEditHandle,
  type HandleKind,
} from './point_editor.js';

export {
  createArray,
  arraySize,
  arrayTransform,
  type ArraySpec,
  type CreateArrayResult,
} from './create_array.js';

export {
  outsetItems,
  outsetSegmentRing,
  roundRectOutwards,
  type OutsetOptions,
  type OutsetResult,
} from './outset_items.js';

export {
  polygonBoolean,
  booleanableShapeCount,
  shapeAsPolygon,
  type PolygonBoolean,
  type PolygonBooleanOptions,
  type PolygonBooleanResult,
} from './polygon_booleans.js';

export {
  modifyLines,
  modifiableLineCount,
  type LineModification,
  type ModifyLinesOptions,
  type ModifyLinesResult,
} from './modify_lines.js';

export {
  convertToLines,
  itemRings,
  segmentToArc,
  bowedMidpoint,
  ARC_BOW_RATIO,
  type LineTarget,
  type ConvertToLinesOptions,
} from './convert_lines.js';

export {
  chainSegmentsToPolygons,
  chainableItem,
  closedShapeRing,
  convertToPoly,
  convertToPolygons,
  convertToZone,
  resolvedLineWidth,
  CHAINING_EPSILON,
  DEFAULT_RULE_AREA_KEEPOUT,
  type ConvertStrategy,
  type ConvertToPolyOptions,
  type ConvertToZoneOptions,
} from './convert_shapes.js';

export {
  positionRelative,
  promotePadsToFootprints,
  selectionAnchorId,
  selectionAnchorPosition,
  topLeftItem,
  type PositionAnchorType,
  type PositionRelativeOptions,
} from './position_relative.js';

export {
  distributeBoardItems,
  type DistributeAction,
} from './distribute_items.js';

export {
  defaultRotationAnchor,
  itemAnchorPoint,
  MAX_BOARD_COORD,
  moveExact,
  moveKeepsSelectionInBounds,
  polarTranslation,
  type MoveExactOptions,
  type RotationAnchor,
} from './move_exact.js';

export {
  allItemsState,
  DEFAULT_SELECTION_FILTER,
  filterSelection,
  itemPassesFilter,
  setAllFilterItems,
  type SelectionFilter,
} from './filter_selection.js';

export {
  buildClearanceReport,
  buildConstraintsReport,
  formatInspectReport,
  type InspectItem,
  type InspectSection,
} from './drc/drc_inspect.js';

export {
  ARROW_ANGLE_DEG,
  INWARD_ARROW_LENGTH_TO_HEAD_RATIO,
  arrowSegments,
  dimensionBBox,
  dimensionSegments,
  distanceToDimension,
  hitTestDimension,
  measuredValue,
  resize,
  type DimSegment,
} from './dimension_geometry.js';

export {
  startDimension,
  moveDimension,
  clickDimension,
  setHeightFromCursor,
  dimensionClickCount,
  radialKnee,
  DEFAULT_DIMENSION_DEFAULTS,
  DEFAULT_ARROW_LENGTH,
  DEFAULT_EXTENSION_OFFSET,
  DEFAULT_LINE_THICKNESS,
  type DimensionDefaults,
  type DimensionDraw,
  type DimensionDrawStep,
} from './draw_dimension.js';

export {
  dimensionAt,
  collectDimensionValues,
  applyDimensionValues,
  type DimensionValues,
} from './dimension_properties.js';

export { textBoxCorners, textBoxBBox } from './textbox_geometry.js';

export {
  textBoxAt,
  collectTextBoxValues,
  applyTextBoxValues,
  splitJustify,
  joinJustify,
  type TextBoxValues,
  type HorizJustify,
  type VertJustify,
} from './textbox_properties.js';

export {
  newTextBox,
  normalizeCorners,
  legacyTextMargin,
  isDrawableTextBox,
  DEFAULT_TEXTBOX_DEFAULTS,
  type TextBoxDefaults,
} from './draw_textbox.js';

export {
  tableBBox,
  tableBorderSegments,
  tableCell,
  tableRowCount,
  type TableSegment,
} from './table_geometry.js';

export {
  tableAt,
  collectTableValues,
  applyTableValues,
  isBackLayer,
  displayToStoredCol,
  type TableValues,
} from './table_properties.js';

export {
  newTable,
  tableGridSize,
  tableCellSize,
  DEFAULT_TABLE_DEFAULTS,
  COL_STEP_IN_FONT_WIDTHS,
  ROW_STEP_IN_FONT_HEIGHTS,
  MIN_CELL_IN_FONT_WIDTHS,
  MIN_CELL_IN_FONT_HEIGHTS,
  type TableDefaults,
} from './draw_table.js';

export {
  imageBBox,
  imageSizeIU,
  iuPerPixel,
  FALLBACK_PIXELS,
} from './image_geometry.js';

export {
  startPlaceImage,
  newReferenceImage,
  fileChosen,
  moveImage,
  clickImage,
  cancelPlaceImage,
  type ImagePlaceState,
  type ImagePlaceStep,
} from './place_image.js';

export {
  imageAt,
  collectImageValues,
  applyImageValues,
  scaleForWidth,
  scaleForHeight,
  sizeForScale,
  type ImageValues,
} from './image_properties.js';

export {
  findSliverPoints,
  SLIVER_WIDTH_TOLERANCE,
  SLIVER_ANGLE_TOLERANCE_DEG,
  SLIVER_MINIMUM_LENGTH,
  type SliverOptions,
} from './drc/drc_sliver.js';

export {
  CreepageGraph,
  pathsBetween,
  isValidPath,
  closestPointOnSegment,
  isConductive,
  type PathConnection,
  type CreepShape,
  type BePoint,
  type BeCircle,
  type CuSegment,
  type CuCircle,
  type BeArc,
  type CuArc,
  angleBetweenStartAndEnd,
  segmentIntersectsArc,
  type BoardSurface,
} from './drc/creepage_graph.js';

export { creepageDistance, type CreepageShapes, type CreepageResult } from './drc/drc_creepage.js';

export {
  octagonalHull,
  segmentHull,
  viaHull,
  circleHull,
  rectHull,
  isSegment45Degree,
  type Hull,
} from './router/pns_hull.js';

export {
  pointInside,
  pointOnEdge,
  edgeContainingPoint,
  findPoint,
  splitAt,
  rawIntersections,
  hullIntersection,
  type HullIntersect,
} from './router/pns_chain.js';

export {
  walkaround,
  nearestObstacle,
  routeAround,
  routeShortest,
  type WalkStatus,
  type WalkOptions,
  type WalkResult,
} from './router/pns_walkaround.js';

export { boardObstacleHulls, type ObstacleQuery } from './router/pns_obstacles.js';

export {
  optimize,
  cornerCost,
  chainCornerCost,
  mergeColinear,
  mergeObtuse,
  mergeFull,
  type CollisionTest,
  type OptimizeEffort,
} from './router/pns_optimizer.js';

export {
  isCopperLayerName,
  copperRank,
  enabledCopperLayers,
  buildSwapLayerMap,
  swapItemLayers,
  swapViaLayerPair,
  swapBoardLayers,
} from './swap_layers.js';
