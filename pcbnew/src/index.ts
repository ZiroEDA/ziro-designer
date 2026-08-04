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
// Only the DXF-prefixed names are re-exported here. The plotter's generic
// companions (FILL_T, LINE_STYLE, formatCoord, ...) mirror KiCad names other
// ports will want too, so they stay importable from './plot_dxf.js' alone
// rather than competing for a slot on the package surface.
export {
  DxfPlotter,
  DXF_UNITS,
  DXF_LAYER_OUTPUT_MODE,
  DXF_OUTLINE_MODE,
  type DxfRenderSettings,
  type DxfPlotParams,
  type DxfTextAttributes,
  type DxfLayerExport,
} from './plot_dxf.js';
// Same rule for the SVG back-end: only the SVG-prefixed names travel to the
// package surface. FILL_T, LINE_STYLE, PLOT_TEXT_MODE, Color4d, XmlEsc, fixed
// and base64Encode are KiCad names the DXF module already claims or another
// port will want, so they stay importable from './plot_svg.js' alone.
export {
  SvgPlotter,
  svgRenderSettings,
  type SvgRenderSettings,
  type SvgTextAttributes,
  type SvgFont,
  type SvgImage,
} from './plot_svg.js';
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
  NetlistParseError,
  guessNetlistFileType,
  loadCmpFootprintLinks,
  loadLegacyNetlist,
  loadNetlist,
  type LegacyNetlistOptions,
  type LoadNetlistOptions,
  type LoadNetlistResult,
  type NetlistFileType,
} from './netlist_reader/netlist_reader.js';
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
// Rule Area Properties (pcbnew/dialogs/dialog_rule_area_properties.cpp).
export {
  collectRuleAreaValues,
  applyRuleAreaValues,
  ruleAreaValuesError,
  hasKeepoutParametersSet,
  initialRuleAreaPage,
  collectPlacementSources,
  collectPlacementPage,
  placementFromPage,
  withPlacementRadio,
  withPlacementSelection,
  NO_LAYERS_SELECTED,
  type RuleAreaValues,
  type PlacementSources,
  type PlacementPage,
  type PlacementCombo,
  type ZoneBorderStyle,
  type ZoneValueError,
} from './rule_area_properties.js';
// Non-Copper Zone Properties (pcbnew/dialogs/dialog_non_copper_zones_properties.cpp).
export {
  collectNonCopperZoneValues,
  applyNonCopperZoneValues,
  nonCopperZoneValuesError,
  NO_LAYER_SELECTED,
  type NonCopperZoneValues,
} from './non_copper_zone_properties.js';
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

export {
  wildCompareString,
  passesGlobalTrackViaFilters,
  applyGlobalTrackViaEdit,
  countGlobalTrackViaTargets,
  type GlobalTrackViaEditOptions,
  type GlobalTrackViaEditContext,
} from './global_edit_tracks_and_vias.js';

export {
  exportD356,
  writeD356Records,
  buildViaTestpoints,
  buildPadTestpoints,
  internNewD356Netname,
  computePadAccessCode,
  viaAccessCode,
  viaLayerPair,
  expandLayerTokens,
  layerNameToId,
  iuToD356,
  boardTentVias,
  viaIsTented,
  type D356Record,
} from './export_d356.js';

export {
  genPositionData,
  decorateFilename,
  placeFileName,
  hasThroughHolePads,
  sortPlaceFileList,
  formatFixed,
  type PlaceFileOptions,
} from './place_file_exporter.js';

export {
  cleanupGraphics,
  isNullShape,
  areEquivalent,
  equivalentPt,
  DRC_EPSILON,
  ARC_HIGH_DEF,
  type CleanupItem,
  type CleanupCode,
  type CleanupGraphicsOptions,
} from './graphics_cleaner.js';

export {
  globalDeletionFilterEnabled,
  globalDeletionLayerChoices,
  layerMatchesFilter,
  layerMatchesDrawingFilter,
  globalDeletionIds,
  globalDeletionRebuildsRatsnest,
  applyGlobalDeletion,
  countGlobalDeletionTargets,
  DEFAULT_GLOBAL_DELETION_OPTIONS,
  type GlobalDeletionOptions,
} from './global_deletion.js';

export {
  padEnumerationNumber,
  padEnumerationAccuracy,
  padIsOnLayer,
  padIsAperturePad,
  padCanHaveNumber,
  startPadEnumeration,
  padEnumerationPreview,
  padEnumerationPrompt,
  padEnumerationHitOrder,
  applyPadEnumeration,
  getNextPadNumber,
  DEFAULT_PAD_ENUMERATION_PARAMS,
  DEFAULT_LAST_PAD_NUMBER,
  PAD_ENUMERATION_COMMIT_LABEL,
  PAD_ENUMERATION_ACCURACY_PX,
  PAD_ENUMERATION_SAMPLE_STEP_IU,
  type SequentialPadEnumerationParams,
  type PadEnumerationState,
  type PadEnumerationUndo,
} from './pad_enumerate.js';

export {
  checkFootprint,
  checkPad,
  isNetTie,
  mapPadNumbersToNetTieGroups,
  getNetTiePads,
  type PadFinding,
} from './footprint_checker.js';

export {
  textGfxLayerClass,
  TEXT_GFX_LAYER_CLASSES,
  styleTextFromSettings,
  styleShapeFromSettings,
  styleTextBoxFromSettings,
  styleDimensionFromSettings,
  autoTextThicknessDisplay,
  globalTextGfxSizesValid,
  applyGlobalTextAndGraphicsEdit,
  countGlobalTextAndGraphicsTargets,
  DEFAULT_GLOBAL_TEXT_GFX_OPTIONS,
  type TextGfxLayerClass,
  type TextGfxClassDefaultsIU,
  type TextGfxDefaultsIU,
  type DimensionDefaultsIU,
  type GlobalTextGfxOptions,
  type GlobalTextGfxContext,
} from './global_edit_text_and_graphics.js';

export {
  isExternalCopperLayer,
  unconnectedLayerModeOf,
  getRemoveUnconnected,
  getKeepEndLayers,
  boardCopperLayerCount,
  boardLayerDepth,
  viaHasPotentiallyUnusedLayers,
  padHasPotentiallyUnusedLayers,
  withPadUnconnectedLayerMode,
  withViaUnconnectedLayerMode,
  unusedPadLayersMode,
  updateUnusedPadLayers,
  conditionallyFlashed,
  padFlashState,
  viaFlashState,
  DEFAULT_UNUSED_PAD_LAYERS_OPTIONS,
  type UnusedPadLayersOptions,
  type UnusedPadLayersContext,
  type UnusedPadLayersResult,
  type FlashState,
} from './unused_pad_layers.js';

export {
  computeBoardStatistics,
  initialiseBoardStatisticsData,
  collectDrillLineItems,
  sameDrillLineItem,
  getBoardPolygonOutlines,
  DEFAULT_BOARD_STATISTICS_OPTIONS,
  STATISTICS_INT_MAX,
  type BoardStatisticsData,
  type BoardStatisticsOptions,
  type BoardPolygonOutlines,
  type BoardOutlinePolygon,
  type DrillLineItem,
  type PadDrillShape,
  type FootprintStatisticsEntry,
  type StatisticsCountEntry,
  type PadAttribute,
  type CountedPadProperty,
  type ViaTypeName,
} from './board_statistics.js';

export {
  planBoardReannotate,
  applyBoardReannotate,
  reannotateBoard,
  reannotateDuplicates,
  reannotateSortCodes,
  compareReannotateFootprints,
  roundToReannotateGrid,
  filterReannotatePrefix,
  DEFAULT_REANNOTATE_OPTIONS,
  REANNOTATE_ACTION_MESSAGE,
  REANNOTATE_MIN_GRID,
  REANNOTATE_MAX_ERROR,
  REANNOTATE_VALID_PREFIX_CHARS,
  type ReannotateAction,
  type ReannotateScope,
  type ReannotateOptions,
  type ReannotatePlan,
  type ReannotateChange,
  type ReannotateRefDesInfo,
  type ReannotatePrefixInfo,
  type ReannotateSortCodes,
} from './board_reannotate.js';

export { cleanupErrorText, type CleanupRcCode, type CleanupRcItem } from './cleanup_item.js';

export {
  cleanupTrackGeometry,
  type TrackGeometryCleanupOptions,
  type TrackGeometryCleanupResult,
} from './tracks_cleaner.js';

export {
  parseLibraryTable,
  parseLibraryTableOptions,
  formatLibraryTableOptions,
  expandEnvVarSubstitutions,
  expandLibraryUri,
  libraryRowFullUri,
  flattenLibraryRows,
  findLibraryRow,
  findLibraryRowForFpid,
  NESTED_TABLE_ROW_TYPE,
  type LibraryTable,
  type LibraryTableRow,
  type LibraryTableScope,
  type LibraryTableSet,
  type LibraryTableType,
  type UriVarResolver,
} from './fp_lib_table.js';

export {
  loadLibraryTable,
  loadFootprintLibraryTables,
  loadFootprintLibrary,
  footprintLibraryNames,
  footprintLibraryTimestamp,
  footprintLibraryIsModified,
  getLibraryFootprint,
  loadFootprintFromLibraries,
  FP_LIB_TABLE_FILE_NAME,
  type FootprintLibrary,
  type FootprintLibraryFs,
  type LibraryDirEntry,
  type LoadFootprintOptions,
  type LoadFootprintTablesOptions,
} from './footprint_library.js';
