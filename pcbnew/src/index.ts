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
  addBoardZone,
  rotateBoardItems,
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
