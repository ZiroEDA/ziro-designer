// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/** @ziroeda/pcbnew, board engine mirroring KiCad's pcbnew/. */
export * from './types.js';
export { connectedTrackEnds, type TrackEndRef } from './connectivity.js';
export {
  buildRatsnest,
  prepareLocalRatsnest,
  type LocalRatsnest,
  type RatsnestEdge,
} from './ratsnest.js';
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
  findItemsFromSyncSelection,
  crossProbeZoomScale,
  crossProbeViewChange,
  crossProbeSelection,
  crossProbeHighlightNet,
  crossProbeFlashSelection,
  CROSS_PROBE_FLASH_INTERVAL_MS,
  CROSS_PROBE_FLASH_LAST_PHASE,
  type CrossProbeView,
} from './cross_probe.js';
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
// And again for the PDF back-end. Only the PDF-prefixed names travel; FILL_T,
// LINE_STYLE, PLOT_TEXT_MODE, Color4d, fixed, formatG, encodeStringForPlotter
// and the two image-stream writers stay importable from './plot_pdf.js' alone,
// because the DXF and SVG modules already spell their own copies of the first
// four and the rest are KiCad names a later port will want.
export {
  PdfPlotter,
  pdfRenderSettings,
  pdfCreationDate,
  type PdfRenderSettings,
  type PdfImage,
  type PdfDeflate,
  type PdfProject,
  type PdfBox2,
} from './plot_pdf.js';
// And once more for the PostScript back-end, which is PDF's sibling under
// PSLIKE_PLOTTER and repeats the same helpers for the same reason. Only the
// PS-prefixed names travel; FILL_T, LINE_STYLE, PLOT_TEXT_MODE, Color4d, fixed,
// formatG, getFillId, encodeStringForPlotter, GetPenSizeForBold and the
// PS_MACRO_PROLOG / POSTSCRIPT_TEXT_ASCENT constants stay importable from
// './plot_ps.js' alone, because three of the four back-ends already spell their
// own copies of the enums and the rest are KiCad names, not Ziro ones.
export {
  PsPlotter,
  psRenderSettings,
  psPageInfo,
  psCreationDate,
  type PsRenderSettings,
  type PsPageInfo,
  type PsImage,
  type PsFont,
  type PsTextAttributes,
} from './plot_ps.js';
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
export {
  checkLibraryParity,
  type LibraryParityOptions,
} from './drc/drc_library_parity.js';

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
export {
  computeFootprintShift,
  uniquePadCount,
  uniquePadNumbers,
  type FootprintShift,
} from './footprint_utils.js';
export {
  spreadFootprints,
  spreadBoardFootprints,
  getRefDesPrefix,
  getTrailingInt,
  type SpreadFootprintsOptions,
} from './spread_footprints.js';

// Footprint autoplacement (pcbnew/autorouter: AR_AUTOPLACER + AR_MATRIX).
export {
  autoplaceFootprints,
  AR_STEP_MM,
  type AutoplaceOptions,
  type AutoplaceResult,
} from './autoplace_footprints.js';

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

export {
  footprintDifferences,
  footprintNeedsUpdate,
  type DiffMode,
} from './footprint_diff.js';

export {
  diffFootprintAgainstLibrary,
  resolveLibraryFootprint,
  type FootprintDiffReport,
  type LibraryFootprintQuery,
  type LibraryFootprintStatus,
  type ResolvedLibraryFootprint,
} from './diff_footprint.js';

// Graphics import (DXF/SVG into board graphics). Only the import-specific
// names travel: BOX2D, MATRIX3x3D, the IMPORTED_* shape classes and
// setupSplineOrLine are KiCad names another port will want and stay importable
// from '@ziroeda/common/src/import_gfx/graphics_importer.js' / './graphics_importer_pcbnew.js' alone.
export {
  GRAPHICS_IMPORTER_BUFFER,
  IMPORTED_STROKE,
  POLY_FILL_RULE,
} from '@ziroeda/common/src/import_gfx/graphics_importer.js';

export {
  GRAPHICS_IMPORTER_PCBNEW,
  DEFAULT_IMPORT_LAYER,
  lineStyleToStrokeType,
  type IMPORTED_ITEM,
  type LayerMapTarget,
} from './graphics_importer_pcbnew.js';
export { PnsLayerRange } from './router/pns_layerset.js';

export {
  defaultShapeCollider,
  getRouterIface,
  getShapeCollider,
  hasNet,
  makeCollisionSearchContext,
  NO_NET,
  ObstacleSet,
  PnsConstraintType,
  resolveCollisionSearchOptions,
  setRouterIface,
  setShapeCollider,
  type CollisionNode,
  type CollisionSearchContext,
  type CollisionSearchOptions,
  type DpNetPair,
  type KeepoutResult,
  type NetHandle,
  type Obstacle,
  type PnsConstraint,
  type PnsRouterIface,
  type PnsRuleResolver,
  type ResolvedCollisionSearchOptions,
  type ShapeCollider,
  type ShapeCollision,
} from './router/pns_collision.js';

export {
  LineMarker,
  OwnableItem,
  PnsItem,
  PnsKind,
  PnsLinkedItem,
  PnsLinkHolder,
  type PnsBoardItem,
  type PnsItemOwner,
  type PnsLineLike,
  type PnsViaLike,
} from './router/pns_item.js';

export { PnsItemSet } from './router/pns_itemset.js';

export { jointTagsEqual, PnsJoint, type JointTag } from './router/pns_joint.js';

export { PnsIndex, type IndexVisitor } from './router/pns_index.js';

export { PnsHole } from './router/pns_hole.js';

export { PnsSolid } from './router/pns_solid.js';

export { PnsSegment, type ShapeSegment } from './router/pns_segment.js';

export { PnsArc, type ShapeArc } from './router/pns_arc.js';

export {
  PnsVia,
  PnsVVia,
  ViaStackMode,
  type PnsViaType,
  type ViaHandle,
} from './router/pns_via.js';

export { moveShape } from './drc/drc_geometry.js';

export {
  PnsLine,
  PnsLineChain,
  PNS_HULL_MARGIN,
} from './router/pns_line_item.js';

export { PnsNode, type PnsBox } from './router/pns_node.js';
// ----- the shape collision table (shape_collisions.cpp) -------------------------

export {
  arcCollidePoint,
  arcCollideSeg,
  arcIsEffectiveLine,
  arcNearestPointsArc,
  arcNearestPointsCircle,
  arcSliceContainsPoint,
  chainCollideSeg,
  chainPointInside,
  circleFurthestPoint,
  circleIntersectCircle,
  circleIntersectSeg,
  circleNearestPoint,
  collideArcArc,
  collideArcChain,
  collideArcCircle,
  collideArcSegment,
  collideChainChain,
  collideChainSegment,
  collideCircleChain,
  collideCircleCircle,
  collideCircleSegment,
  collideSegmentSegment,
  collideShapes,
  segCollide,
  segNearestPointToPoint,
  segNearestPointToSeg,
  segSquaredDistanceToPoint,
  segSquaredDistanceToSeg,
  shapeCircleCollideSeg,
  shapeSegmentCollideSeg,
  type CollideArc,
  type CollideChain,
  type CollideCircle,
  type CollideSeg,
  type CollideSegment,
  type ShapeCollisionResult,
} from './drc/shape_collisions.js';

export {
  installLocatingShapeCollider,
  locatingShapeCollider,
} from './router/pns_shape_collider.js';

export {
  rescale64,
  segApproxParallel,
  segContains,
  segLength,
  segLineProject,
  segReflectPoint,
  segSquaredDistanceToPointExact,
  segSquaredLength,
} from './router/pns_seg_ops.js';

export {
  ARC_POLYGONIZATION_MAX_ERROR,
  arcCenterFromStartEndAngle,
  arcCenterI,
  arcCentralAngle,
  arcConvertToPolyline,
  arcIsCCW,
  arcIsClockwise,
  arcLength,
  arcMirror,
  arcRadius,
  arcStartAngle,
  constructArcFromStartEndAngle,
  constructArcFromStartEndCenter,
  shapeArcCenter,
  perpendicular,
  resizeD,
  truncToInt,
  truncVec,
} from './router/shape_arc_ops.js';

export {
  IU_PER_PS,
  MEANDER_DEFAULT_DELAY_TOLERANCE,
  MEANDER_DEFAULT_LENGTH_TOLERANCE,
  MEANDER_DELAY_UNCONSTRAINED,
  MEANDER_LENGTH_UNCONSTRAINED,
  MEANDER_SKEW_UNCONSTRAINED,
  MeanderShape,
  MeanderSide,
  MeanderStyle,
  MeanderType,
  MeanderedLine,
  basicMeanderPlacer,
  chainLength,
  copyMeanderSettings,
  lineChainCollideSeg,
  defaultMeanderSettings,
  minOptMaxMax,
  minOptMaxMin,
  minOptMaxOpt,
  setTargetLength,
  setTargetLengthDelay,
  setTargetLengthDelayFromConstraint,
  setTargetLengthFromConstraint,
  setTargetSignalLength,
  setTargetSignalLengthDelay,
  setTargetSignalLengthDelayFromConstraint,
  setTargetSignalLengthFromConstraint,
  setTargetSkew,
  setTargetSkewDelay,
  setTargetSkewDelayFromConstraint,
  setTargetSkewFromConstraint,
  type MeanderPlacer,
  type MeanderSettings,
} from './router/pns_meander.js';
// ----- PNS: branching, commit and line assembly (pns_node, pns_topology) ----------

// `arcLength` is NOT re-exported here: shape_arc_ops.js (#453) already exports
// that name for the same upstream function, SHAPE_ARC::GetLength(). The two
// implementations differ — this one falls back to the chord length for a
// degenerate arc, the other does not — so they are left side by side and
// deduplicated deliberately rather than at a merge. pns_line_item imports
// this one directly from './pns_arc.js'.
export { convertArcToPolyline, reversedArc } from './router/pns_arc.js';
export {
  PnsTopology,
  PNS_FOLLOW_BRANCH_TIMEOUT_MS,
  type PnsPathResult,
  type PnsTerminalJoints,
} from './router/pns_topology.js';

export {
  DL_Attributes,
  DL_CREATION_ADAPTER,
  DL_Extrusion,
  DL_NANDOUBLE,
  DXF_READER,
  stripWhiteSpace,
  toInt,
  toInt16,
  toReal,
} from '@ziroeda/common/src/import_gfx/dxf_reader.js';

export { SPLINE_ERROR, bsplineToBeziers } from '@ziroeda/common/src/import_gfx/dxf_spline.js';

export {
  DXF2BRD_ENTITY_DATA,
  DXF_IMPORT_BLOCK,
  DXF_IMPORT_LAYER,
  DXF_IMPORT_LINEWEIGHT_BY_BLOCK,
  DXF_IMPORT_LINEWEIGHT_BY_LAYER,
  DXF_IMPORT_LINEWEIGHT_BY_LW_DEFAULT,
  DXF_IMPORT_PLUGIN,
  DXF_IMPORT_STYLE,
  DXF_IMPORT_UNITS,
  matrixFromRows,
  matrixMul,
  matrixMulVec3,
  matrixSetRotation,
  matrixSetScale,
  matrixZero,
} from '@ziroeda/common/src/import_gfx/dxf_import_plugin.js';
// And once more for the PNG back-end, the raster one. Only the PNG-prefixed
// names travel; FILL_T, LINE_STYLE, Color4d, COLOR4D_BLACK/WHITE and the two
// line-width sentinels stay importable from './plot_png.js' alone, because all
// four document back-ends already spell their own copies of them. The encoder
// travels whole — pngEncodeRgba8, the CRC and the zlib stream are ours, not
// KiCad's, so nothing else will ever want those names.
export {
  PngPlotter,
  pngRecordingBackend,
  pngCanvas2DBackend,
  pngMemorySurface,
  cssRgba,
  CAIRO_STATUS,
  CAIRO_ANTIALIAS,
  CAIRO_OPERATOR,
  CAIRO_LINE_CAP,
  CAIRO_LINE_JOIN,
  DEFAULT_PNG_DPI,
  MIN_PNG_DPI,
  MAX_PNG_DPI,
  MAX_PNG_DIMENSION,
  type PngBackend,
  type PngCanvas2D,
  type PngContext,
  type PngImage,
  type PngOp,
  type PngRecordingBackend,
  type PngRecordingContext,
  type PngSurface,
} from './plot_png.js';
export {
  pngEncodeRgba8,
  pngCrc32,
  pngChunk,
  pngPremultiplyRgba8,
  pngUnpremultiplyArgb32,
  zlibStored,
  adler32,
  PNG_SIGNATURE,
  type PngEncodeOptions,
} from './png_encoder.js';
// ----- PNS: collision querying (pns_node, pns_rule_resolver, pns_item_hull) --------
//
// `PnsNode`'s three collision entry points are methods, so they arrive with the
// class that #450 already exports. What is new here as free names is the
// visitor base class the queries are written on, the corner-mode singleton
// `NearestObstacle` reads, the `ITEM::Hull` dispatch, and the rule resolver
// that turns a `.kicad_dru` rule set into the clearance a route must keep.
export {
  PnsCornerMode,
  PnsObstacleVisitor,
  getRouterCornerMode,
  setRouterCornerMode,
} from './router/pns_node.js';
export {
  ARC_LOW_DEF,
  arcHull,
  buildHullForPrimitiveShape,
  convexHull,
  itemHull,
} from './router/pns_item_hull.js';
export { PnsBoardRuleResolver, type PnsResolverHost } from './router/pns_rule_resolver.js';

export {
  DEFAULT_ROUTING_SETTINGS,
  PNS_SCHEMA_VERSION,
  PNS_SETTINGS_PATH,
  PnsMode,
  PnsOptimizationEffort,
  pnsAllowDrcViolations,
  pnsCycleMode,
  pnsFollowMouse,
  pnsInitialDirection,
  pnsSettingsEnableState,
  readRoutingSettings,
  writeRoutingSettings,
  type PnsSettingsEnableState,
  type RoutingSettings,
  type RoutingSettingsJson,
} from './router/pns_routing_settings.js';
// --- SVG graphics import (svg_import_plugin) --------------------------------
export {
  NSVG_FLAGS_VISIBLE,
  NSVGfillRule,
  NSVGlineCap,
  NSVGlineJoin,
  NSVGpaintType,
  nsvgParse,
  type NSVGbounds,
  type NSVGimage,
  type NSVGpaint,
  type NSVGpath,
  type NSVGshape,
} from '@ziroeda/common/src/import_gfx/nanosvg.js';

export {
  GatherInterpolatedCubicBezierCurve,
  GatherInterpolatedCubicBezierPath,
  SVG_IMPORT_PLUGIN,
  calculateBezierSegmentationThreshold,
  distanceFromPointToLine,
  getBezierPoint,
} from '@ziroeda/common/src/import_gfx/svg_import_plugin.js';
// ----- PNS::SHOVE ----------------------------------------------------------------
//
// The push-and-shove core: given a head, push the nearest obstacle out of the
// way, then whatever *that* now collides with, until nothing collides or the
// cascade is abandoned. It runs entirely on a `PnsNode` branch, so a shove that
// does not settle costs nothing — the branch is dropped and the board is
// untouched.
//
// `PnsShoveStatus` and the heads-based entry points (`clearHeads`, `addHeads`,
// `run`, `headsModified`, `getModifiedHead`) are the surface `PNS::LINE_PLACER`
// calls. The `ShoveLines`/`ShoveMultiLines` API some callers may expect no
// longer exists upstream; see the class doc.
export {
  DEFAULT_SHOVE_SETTINGS,
  PnsOptimizerFlags,
  PnsShove,
  PnsShovePolicy,
  PnsShoveStatus,
  itemChangedArea,
  lineChangedArea,
  lineWalkaround,
  viaChangedArea,
  type PnsShoveRootLineEntry,
  type PnsShoveSettings,
} from './router/pns_shove.js';
export { RangedNum } from './router/ranged_num.js';

// `segLength`, `segLineProject`, `segContains`, `segApproxParallel` and
// `rescale64` are NOT re-exported here: `pns_seg_ops.js` already exports those
// names. This module imports them from there rather than defining rivals — with
// one documented exception, its own private `segLength`, which rounds where
// that one truncates.
export {
  chainLengthI,
  chainSelfIntersecting,
  chainsIntersect,
  DiffPair,
  DpGateway,
  DpGateways,
  DpPrimitivePair,
  makeGapVector,
  segCollinear,
  segDistance,
  segIntersect,
  segIntersectLines,
  type CoupledSegments,
} from './router/pns_diff_pair.js';

// ----- OPTIMIZER's pad-aware passes (SMART_PADS, FANOUT_CLEANUP) -----------------
//
// Kept out of pns_optimizer.js because these take a PnsNode and a PnsLine where
// the merge passes take a chain and a callback. BreakoutList and BreakoutRect
// stay importable from './router/pns_smart_pads.js' alone.
export {
  approximateSegmentAsRect,
  circleBreakouts,
  computeBreakouts,
  countCorners,
  customBreakouts,
  fanoutCleanup,
  findPadOrVia,
  polyAsAxisAlignedRect,
  rectBreakouts,
  runSmartPads,
  smartPadsSingle,
  SMART_PADS_FORBIDDEN_ANGLES,
} from './router/pns_smart_pads.js';
// The length-tuning placers: `PNS::MEANDER_PLACER_BASE` and its three
// subclasses. `pns_meander.js` above is the geometry these drive.
//
// `MeanderPlacerHost` is the seam where `PNS::ROUTER`, `ROUTER_IFACE` and
// `TOPOLOGY`'s two assemblers would be, none of which exist in this tree yet;
// a caller supplies them. `chainSplitAt` / `chainSplitRange` are
// `SHAPE_LINE_CHAIN::Split`, which `PnsLineChain` does not carry.
export {
  LENGTH_TARGET_TOLERANCE,
  PnsMeanderPlacerBase,
  PnsTuningStatus,
  chainSplitAt,
  chainSplitRange,
  findAmplitudeBinarySearch,
  findAmplitudeForLength,
  getSnappedStartPoint,
  segDistanceToPoint,
  segNearestPoint,
  segSide,
  tuneLineLength,
  type ChainSplit,
  type MeanderClearanceResolver,
  type MeanderPlacerHost,
  type MeanderRouterIface,
  type TuningPathResult,
} from './router/pns_meander_placer_base.js';
export { PnsMeanderPlacer } from './router/pns_meander_placer.js';
export { PnsDpMeanderPlacer } from './router/pns_dp_meander_placer.js';
export { PnsMeanderSkewPlacer } from './router/pns_meander_skew_placer.js';
// `PNS::DIFF_PAIR_PLACER`, the interactive differential-pair routing session.
//
// `DpPlacerHost`, `DpPlacerSizes` and `DEFAULT_DP_PLACER_SIZES` are exported
// from the module but deliberately **not** re-exported here. They stand in for
// `PNS::ROUTER`, `PNS::PLACEMENT_ALGO` and `PNS::SIZES_SETTINGS`, none of which
// is ported; `PNS::LINE_PLACER` needs the same three and will declare its own
// until someone ports them properly, and two modules exporting rival names
// through this file is exactly the conflict that costs a merge. Import them
// from `router/pns_diff_pair_placer.js` directly.
export {
  DP_ERR_NO_COMPLEMENTARY_NET,
  DP_ERR_NO_STARTING_POINT,
  DpPlacerState,
  PnsDiffPairPlacer,
  diffPairViaGap,
  dpErrNoCoupledStartingPoint,
  effectiveDiffPairViaGap,
  findDpPrimitivePair,
  getDanglingAnchor,
  pushoutForce,
  type DpPrimitivePairSearch,
} from './router/pns_diff_pair_placer.js';
// ---------------------------------------------------------------------------
// PNS draggers: `pcbnew/router/pns_dragger.{h,cpp}`,
// `pns_component_dragger.{h,cpp}` and `pns_multi_dragger.{h,cpp}`, plus the
// `DRAG_ALGO` base they share and the two small collaborators they needed
// (`LINE::DragCorner`/`DragSegment` as free functions, `MOUSE_TRAIL_TRACER`).
//
// `segDistance`, `segIntersectLines` and `segLineProject` are deliberately NOT
// re-exported from `pns_multi_dragger.js`: the first two are already exported
// above from `pns_diff_pair.js`, and re-exporting rivals under the same names
// would break the barrel. Import them from their own module when the multi
// dragger's integer conventions are what you want.
export {
  PNS_IU_PER_MM,
  PNS_MAX_TANGENT_ANGLE_DEVIATION_DEG,
  PNS_MAX_TRACK_LENGTH_TO_KEEP_MM,
  PNS_UNDEFINED_LAYER,
  PnsDragAlgo,
  PnsDragMode,
  makePnsRouterHost,
  toShoveSettings,
  type PnsRouterHost,
} from './router/pns_drag_algo.js';
export { PnsMouseTrailTracer } from './router/pns_mouse_trail_tracer.js';
export {
  chainSplit,
  lineDragArc,
  lineDragCorner,
  lineDragSegment,
  type LineDragArcFn,
} from './router/pns_line_drag.js';
export {
  PnsDragger,
  collectObstacleHulls,
  viaPushoutForce,
  viaPushoutForceAgainstItem,
} from './router/pns_dragger.js';
export { PnsComponentDragger } from './router/pns_component_dragger.js';
export {
  PnsMultiDragger,
  chainPointAlong,
  clipToOtherLine,
  directionOpposite,
  segLineDistance,
} from './router/pns_multi_dragger.js';

// `PNS::TOPOLOGY`, completed: cluster assembly, differential-pair recovery,
// ratlines and tuning paths. `PnsTopology` itself is already exported above,
// with the trivial-path walk; these are the names the rest of the file grew.
//
// `PnsCluster` here is `TOPOLOGY::CLUSTER`. `pns_shove.ts` exports a private
// structural twin of the same struct under the same name from its own module;
// that one is deliberately not re-exported through this file, so there is no
// conflict to resolve.
export {
  DP_PARALLELITY_THRESHOLD,
  type PnsBoardPadHandle,
  type PnsBoardViaHandle,
  type PnsCluster,
  type PnsNearestUnconnected,
  type PnsTuningHost,
  type PnsUnconnectedAnchor,
} from './router/pns_topology.js';
// `OPTIMIZER::Optimize( DIFF_PAIR* )` and the passes underneath it.
//
// `linesCollide` used to be exported alongside them, as the local stand-in for
// the `LINE::Collide( LINE* )` that ZiroEDA issue #484 made unreachable. That
// issue is fixed — `PnsItem.shapes()` hands the collision path a LINE's chain —
// so the stand-in is gone and its callers use `PnsItem.collide` directly.
export {
  checkDpColliding,
  coupledBypass,
  findCoupledVertices,
  mergeDpSegments,
  mergeDpStep,
  optimizeDiffPair,
  verifyDpBypass,
} from './router/pns_optimizer_diff_pair.js';

// ----- PNS::ROUTER and PNS::TOOL_BASE -------------------------------------------
//
// The driver that ties the router together: a four-state machine (IDLE,
// ROUTE_TRACK, DRAG_SEGMENT, DRAG_COMPONENT), the mode dispatch that picks a
// placer, and the commit path that turns a placer's answers into board edits.
//
// `PnsRouterIface` is `PNS::ROUTER_IFACE`, **declared but not implemented** —
// upstream's only implementation is `PNS_KICAD_IFACE`, 3293 lines of
// wxWidgets/BOARD bridge this repo replaces with its own. Implementing it
// against Ziro's `Board` is a separate PR, and this type is its contract.
//
// `PnsPlacementAlgo` is `PNS::PLACEMENT_ALGO`, which nothing else in this tree
// declares. The four ported placers all satisfy it structurally, asserted at
// compile time in `qa/unittests/pcbnew/pns_router.test.ts`.
//
// `PnsDragMode` and `PnsDragAlgo` are NOT exported from here — they are
// `pns_drag_algo.js`'s, re-exported above, and `ROUTER` uses those directly.
// This port added `setDebugDecorator`/`dbg` to that abstract class:
// `ALGO_BASE` carries them upstream (`pns_algo_base.h`) and
// `ROUTER::StartDragging` calls the setter on whichever dragger it just built
// (`pns_router.cpp:196`).
//
// `PnsRouterSizes` extends `pns_diff_pair_placer.js`'s `DpPlacerSizes` rather
// than creating a rival `pns_sizes_settings` module; see that file's note on
// why a second module inventing the name costs a merge.
export {
  DEFAULT_ROUTER_SIZES,
  PNS_HEAD_TRACE,
  PNS_HOVER_ITEM,
  PNS_SEMI_SOLID,
  PnsRouter,
  PnsRouterMode,
  PnsRouterState,
  type PnsPlacementAlgo,
  type PnsRouterAlgoFactory,
  type PnsRouterDeps,
  type PnsRouterSizes,
} from './router/pns_router.js';
// `PnsRouterIface` is deliberately NOT re-exported here. `pns_collision.js`
// already exports a type of that name — the one-member slice
// (`isFlashedOnLayer`) the item model reaches through the router singleton —
// and it is re-exported above. The full `ROUTER_IFACE` extends that slice, so
// the two are compatible, but two modules exporting rival names through this
// file is exactly the conflict that costs a merge. Import it from
// `router/pns_router.js` directly.

// `PNS::TOOL_BASE`, the three methods of it that are routing decisions rather
// than wxWidgets event plumbing. `PCB_GRID_HELPER` shrinks to the three calls
// `snapToItem` makes; the frame/view inputs `pickSingleItem` reads become
// explicit context fields.
export {
  PNS_COORDS_PADDING,
  PnsGridHelperGrid,
  PnsMagneticOption,
  checkSnap,
  pickSingleItem,
  snapToItem,
  type PnsMagneticSettings,
  type PnsPickContext,
  type PnsSnapContext,
  type PnsSnapGridHelper,
} from './router/pns_tool_base.js';
// ----- PNS: interactive single-track placement (pns_line_placer) -------------------
//
// `LINE_PLACER` is what turns the finished `NODE` into a router a person can
// drive: the head/tail split, the posture solver, the three routing modes, via
// placement and the fix/unfix lifecycle. `SHOVE` is a sibling port, so the
// placer's shove paths are written against `PnsShoveLike` — upstream's method
// names, no implementation — and everything else is ported whole.
export {
  PnsFixedTail,
  PnsLinePlacer,
  PnsOptimizerEffort,
  PnsWalkStatus,
  optimizeLine,
  walkaroundRoute,
  type PnsFixPoint,
  type PnsFixedTailStage,
  type PnsPlacerIface,
  type PnsRouterLike,
  type PnsShoveLike,
  type PnsWalkPolicyResult,
  type PnsWalkResult,
} from './router/pns_line_placer.js';
// `PnsMode`, `PnsOptimizationEffort` and `RoutingSettings` are already exported
// above, from the routing-settings block this port builds on.
export { PnsSizesSettings, type PnsViaTypeSetting } from './router/pns_sizes_settings.js';
export type { ChainIntersection } from './router/pns_line_item.js';
// The board bridge — `PNS_KICAD_IFACE` over this repo's `Board`. `PnsRouterIface`
// itself is *not* re-exported: `pns_collision.ts` already exports a type of that
// name (the one-member `isFlashedOnLayer` slice), and the full interface is
// imported from `./router/pns_router.js` directly for the same reason
// `DpPlacerHost` is.
export {
  PnsBoardIface,
  PNS_ORPHANED_NET,
  asBoardItem,
  boardLayerFromPnsLayer,
  padHoleShape,
  pnsLayerFromBoardLayer,
  solidShapeForPad,
  type PnsBoardIfaceDeps,
  type PnsBoardNet,
  type PnsPendingChange,
} from './router/pns_board_iface.js';
