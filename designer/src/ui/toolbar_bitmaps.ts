// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Which KiCad bitmap each toolbar id wears.
 *
 * Names come from the `.Icon( BITMAPS::… )` line of the matching TOOL_ACTION in
 * KiCad's `*_actions.cpp`, and each names a file vendored under
 * `assets/toolbar/`.
 *
 * Split out of `toolbarIcons.ts` so it can be tested: that module resolves the
 * files with `import.meta.glob`, which only Vite understands, so `qa` cannot
 * import it. A key that matches no toolbar id fails silently — the button just
 * falls back to the hand-drawn glyph in `icons.tsx`, which looks deliberate.
 * That is exactly how `syncAllSheetsPins` (upstream's action name) sat here
 * unused while the button's id was `syncAllSheetPins`.
 */
export const BITMAP: Record<string, string> = {
  showPcbNew: 'icon_pcbnew_24',
  // pcb editor (icons per PCB_ACTIONS/ACTIONS .Icon() in pcb_actions.cpp)
  boardSetup: 'options_board',
  threeDViewer: 'three_d',
  updatePcbFromSch: 'update_pcb_from_sch',
  runDRC: 'drc',
  showEeschema: 'icon_eeschema_24',
  lock: 'locked',
  unlock: 'lock_unlock',
  footprintBrowser: 'library_browser',
  togglePolarCoords: 'polar_coord',
  crosshair45: 'cursor_fullscreen45',
  showRatsnest: 'general_ratsnest',
  ratsnestLineMode: 'curved_ratsnest',
  highContrast: 'contrast_mode',
  toggleNetHighlight: 'net_highlight',
  zoneDisplayFilled: 'show_zone',
  zoneDisplayOutline: 'show_zone_disable',
  padDisplayMode: 'pad_sketch',
  viaDisplayMode: 'via_sketch',
  trackDisplayMode: 'showtrack',
  showLayersManager: 'layers_manager',
  selectLasso: 'lasso',
  localRatsnest: 'tool_ratsnest',
  placeFootprint: 'module',
  routeTrack: 'add_tracks',
  routeDiffPair: 'ps_diff_pair',
  tuneLength: 'ps_tune_length',
  tuneDiffPair: 'ps_diff_pair_tune_length',
  tuneSkew: 'ps_diff_pair_tune_phase',
  drawVia: 'add_via',
  drawZone: 'add_zone',
  drawRuleArea: 'add_keepout_area',
  drawLine: 'add_graphical_segments',
  drawArc: 'add_arc',
  drawRectangle: 'add_rectangle',
  drawCircle: 'add_circle',
  drawPolygon: 'add_graphical_polygon',
  drawBezier: 'add_bezier',
  placeImage: 'image',
  drawTextBox: 'add_textbox',
  drawTable: 'table',
  dimAligned: 'add_aligned_dimension',
  dimOrthogonal: 'add_orthogonal_dimension',
  dimCenter: 'add_center_dimension',
  dimRadial: 'add_radial_dimension',
  dimLeader: 'add_leader',
  deleteTool: 'delete_cursor',
  drillOrigin: 'set_origin',
  gridOrigin: 'grid_select_axis',
  placePoint: 'add_point',
  measure: 'measurement',
  // pcb editor right toolbar (master DefaultToolbarConfig ids)
  selectSetRect: 'cursor',
  selectSetLasso: 'lasso',
  localRatsnestTool: 'tool_ratsnest',
  routeSingleTrack: 'add_tracks',
  tuneSingleTrack: 'ps_tune_length',
  showDiffPhaseSkew: 'tune_diff_pair_skew_legend',
  drawEllipseArc: 'add_ellipse_arc',
  drawEllipse: 'add_ellipse',
  // The schematic's own ids for the same two shapes.
  ellipseArc: 'add_ellipse_arc',
  ellipse: 'add_ellipse',
  addConstraintCoincident: 'constraint_coincident',
  addConstraintPointOnLine: 'constraint_point_on_line',
  addConstraintMidpoint: 'constraint_midpoint',
  addConstraintSymmetric: 'constraint_symmetric',
  addConstraintParallel: 'constraint_parallel',
  addConstraintPerpendicular: 'constraint_perpendicular',
  addConstraintCollinear: 'constraint_collinear',
  addConstraintHorizontal: 'constraint_horizontal',
  addConstraintVertical: 'constraint_vertical',
  addConstraintTangent: 'constraint_tangent',
  addConstraintEqualLength: 'constraint_equal_length',
  addConstraintEqualRadius: 'constraint_equal_radius',
  addConstraintConcentric: 'constraint_concentric',
  addConstraintFixedLength: 'constraint_fixed_length',
  addConstraintFixedRadius: 'constraint_fixed_radius',
  addConstraintArcAngle: 'constraint_arc_angle',
  addConstraintAngular: 'constraint_angular_dimension',
  placeReferenceImage: 'image',
  drawOrthogonalDimension: 'add_orthogonal_dimension',
  drawAlignedDimension: 'add_aligned_dimension',
  drawCenterDimension: 'add_center_dimension',
  drawRadialDimension: 'add_radial_dimension',
  drawLeader: 'add_leader',
  placeBarcode: 'add_barcode',
  gridSetOrigin: 'grid_select_axis',
  measureTool: 'measurement',
  // top toolbar
  new: 'new_generic',
  open: 'directory_open',
  save: 'save',
  schematicSetup: 'options_schematic',
  pageSettings: 'sheetset',
  print: 'print_button',
  plot: 'plot',
  paste: 'paste',
  undo: 'undo',
  redo: 'redo',
  find: 'find',
  findReplace: 'find_replace',
  zoomRedraw: 'refresh',
  zoomIn: 'zoom_in',
  zoomOut: 'zoom_out',
  zoomFit: 'zoom_fit_in_page',
  zoomFitObjects: 'zoom_fit_to_objects',
  zoomTool: 'zoom_area',
  navBack: 'left',
  navUp: 'up',
  navFwd: 'right',
  rotateCCW: 'rotate_ccw',
  rotateCW: 'rotate_cw',
  mirrorV: 'mirror_v',
  mirrorH: 'mirror_h',
  group: 'group',
  ungroup: 'group_ungroup',
  symbolEditor: 'libedit',
  symbolBrowser: 'library_browser',
  footprintEditor: 'module_editor',
  annotate: 'annotate',
  erc: 'erc',
  simulator: 'simulator',
  assignFootprints: 'icon_cvpcb_24',
  editSymbolFields: 'spreadsheet',
  bom: 'post_bom',
  // left toolbar
  toggleGrid: 'grid',
  toggleGridOverrides: 'grid_override',
  unitsInches: 'unit_inch',
  unitsMils: 'unit_mil',
  unitsMm: 'unit_mm',
  crosshairSmall: 'cursor_shape',
  crosshairFull: 'cursor_fullscreen',
  toggleHiddenPins: 'hidden_pin',
  lineModeFree: 'lines_any',
  lineMode90: 'lines90',
  lineMode45: 'hv45mode',
  annotateAuto: 'annotate',
  showHierarchy: 'hierarchy_nav',
  showProperties: 'tools',
  // right toolbar
  select: 'cursor',
  highlightNet: 'net_highlight_schematic',
  placeSymbol: 'add_component',
  placePower: 'add_power',
  drawWire: 'add_line',
  drawBus: 'add_bus',
  busEntry: 'add_line2bus',
  noConnect: 'noconn',
  junction: 'add_junction',
  placeLabel: 'add_label',
  placeClassLabel: 'add_class_flag',
  placeGlobalLabel: 'add_glabel',
  placeHierLabel: 'add_hierarchical_label',
  drawSheet: 'add_hierarchical_subsheet',
  sheetPin: 'add_hierar_pin',
  // Both sync actions use BITMAPS::import_hierarchical_label. Keyed on the
  // toolbar's id *and* on the icon name, because the lookup tries the id first
  // and our button id is `syncAllSheetPins` — the name the handler dispatches
  // on, not upstream's `syncAllSheetsPins`, which is what this key used to say
  // and why the button fell back to a hand-drawn glyph.
  syncAllSheetPins: 'import_hierarchical_label',
  syncSheetPins: 'import_hierarchical_label',
  placeText: 'text',
  textBox: 'add_textbox',
  table: 'table',
  rectangle: 'add_rectangle',
  circle: 'add_circle',
  arc: 'add_arc',
  bezier: 'add_bezier',
  lines: 'add_graphical_segments',
  image: 'image',
  delete: 'delete_cursor',
  // symbol editor (icons per SCH_ACTIONS/ACTIONS .Icon() used by toolbars_symbol_editor.cpp)
  newSymbol: 'new_component',
  symbolProperties: 'part_properties',
  pinTable: 'pin_table',
  showDatasheet: 'datasheet',
  checkSymbol: 'erc',
  morganStd: 'morgan1',
  morganAlt: 'morgan2',
  syncedPins: 'pin2pin',
  addSymbolToSchematic: 'add_symbol_to_schematic',
  showElectricalTypes: 'pin_show_etype',
  // annotate dialog sort-order bitmaps (dialog_annotate.cpp)
  annotateDownRight: 'annotate_down_right',
  annotateRightDown: 'annotate_right_down',
  // symbol library browser (toolbars_symbol_viewer.cpp)
  previousSymbol: 'lib_previous',
  nextSymbol: 'lib_next',
  showPinNumbers: 'pin',
  showHiddenFields: 'text_sketch',
  showLibraryTree: 'search_tree',
  placePin: 'pin',
  placeAnchor: 'anchor',
  polygon: 'add_graphical_polygon',
  newLibrary: 'new_library',
  addLibrary: 'add_library',
  saveAs: 'save_as',
  revert: 'restore_from_file',
  importSymbol: 'import',
  exportSymbol: 'export_file',
  cut: 'cut',
  copy: 'copy',
  library: 'library',
  editWithLibEdit: 'edit_cmp_symb_links',
  preferences: 'preference',
  // footprint editor (icons per PCB_ACTIONS/ACTIONS .Icon() in toolbars_footprint_editor.cpp).
  // KiCad's footprint-specific bitmaps aren't all vendored yet, so these reuse the
  // closest available SVGs (a footprint glyph, sketch/props icons, import/export…).
  newFootprint: 'module',
  createFootprint: 'new_generic',
  footprintProperties: 'part_properties',
  padTable: 'spreadsheet',
  defaultPadProperties: 'pad_sketch',
  checkFootprint: 'erc',
  placePad: 'pad_sketch',
  loadFpFromBoard: 'import',
  saveFpToBoard: 'export_file',
  setAnchor: 'anchor',
  graphicsOutlines: 'pad_sketch',
  textOutlines: 'text_sketch',
  // drawing sheet editor (icons per PL_ACTIONS .Icon() in pl_actions.cpp)
  dsAddLine: 'add_graphical_segments',
  dsAddRect: 'add_rectangle',
  dsAddText: 'text',
  dsAddBitmap: 'image',
  dsAppend: 'import',
  dsDelete: 'delete_cursor',
  appendSheet: 'import',
  inspect: 'spreadsheet',
  previewSettings: 'sheetset',
  layoutNormalMode: 'pagelayout_normal_view_mode',
  layoutEditMode: 'pagelayout_special_view_mode',
  // Gerber Viewer. Every one of these is now the bitmap the action itself
  // names in `gerbview/tools/gerbview_actions.cpp` or `common/tool/actions.cpp`,
  // vendored from `resources/bitmaps_png/sources/dark` like the rest of the
  // table. They used to be "the closest SVG we had" - which put the SAME
  // `import` glyph on the job, drill and zip buttons, `contrast_mode` on both
  // the XOR and the high-contrast toggles, and `via_sketch` on Ghost Negative
  // Objects.
  gerbClear: 'delete_gerber', // clearAllLayers, gerbview_actions.cpp:112
  gerbOpen: 'load_gerber', // openGerber, :49 - openAutodetected shares it, :42
  gerbOpenAutodetected: 'load_gerber',
  gerbOpenJob: 'file_gerber_job', // openJobFile, :63
  gerbOpenDrill: 'load_drill', // openDrillFile, :56
  gerbOpenZip: 'zip', // openZipFile, :70
  gerbExportToPcb: 'export_to_pcbnew', // exportToPcbnew, :97
  gerbReload: 'reload', // reloadAllLayers, :115
  gerbClearLayer: 'delete_sheet', // clearLayer, :104
  gerbSort: 'reload',
  gerbDcodeList: 'show_dcodenumber', // showDCodes, :83
  gerbMeasure: 'measurement',
  gerbTogglePolar: 'polar_coord',
  gerbFlashedSketch: 'pad_sketch', // flashedDisplayOutlines, :195
  gerbLinesSketch: 'showtrack', // linesDisplayOutlines, :185
  gerbPolygonsSketch: 'opt_show_polygon', // polygonsDisplayOutlines, :205
  gerbNegativeObjects: 'gerbview_show_negative_objects', // negativeObjectDisplay, :214
  gerbShowDcodes: 'show_dcodenumber', // dcodeDisplay, :224
  gerbForceOpacity: 'gbr_select_mode1', // toggleForceOpacityMode, :232
  gerbXorMode: 'gbr_select_mode2', // toggleXORMode, :240
  gerbHighContrast: 'contrast_mode', // ACTIONS::highContrastMode
  gerbFlipView: 'flip_board', // flipGerberView, :248
  gerbLayerManager: 'layers_manager', // toggleLayerManager, :77
  gerbHighlight: 'net_highlight',
  gerbClearHighlight: 'net_highlight',
  gerbNextLayer: 'right',
  gerbPrevLayer: 'left',
  recent: 'recent',
  tools: 'tools',
  // The toolbar resolves icons by the tool *id*, so the left/right Gerber
  // toggles (whose ids differ from their `icon` field) need id-keyed entries
  // too, otherwise they render as empty placeholder squares.
  togglePolar: 'polar_coord',
  flashedSketch: 'pad_sketch',
  linesSketch: 'showtrack',
  polygonsSketch: 'opt_show_polygon',
  showNegativeObjects: 'gerbview_show_negative_objects',
  showDcodes: 'show_dcodenumber',
  forceOpacityMode: 'gbr_select_mode1',
  xorMode: 'gbr_select_mode2',
  flipView: 'flip_board',
  showLayerManager: 'layers_manager',
  // Assign Footprints (cvpcb, per CVPCB_ACTIONS .Icon()).
  cvpcbSaveToSchematic: 'save',
  cvpcbViewFootprint: 'show_footprint',
  cvpcbPrevNA: 'left',
  cvpcbNextNA: 'right',
  cvpcbUndo: 'undo',
  cvpcbRedo: 'redo',
  cvpcbDeleteAll: 'delete_association',
  cvpcbFilterFp: 'module_filtered_list',
  cvpcbFilterPin: 'module_pin_filtered_list',
  cvpcbFilterLib: 'module_library_list',
  cvpcbLibTable: 'library_table',
  // DIALOG_LABEL_PROPERTIES / DIALOG_TEXT_PROPERTIES (the ids are the bitmap
  // names, since these are dialog buttons rather than toolbar tools).
  small_plus: 'small_plus',
  small_trash: 'small_trash',
  small_up: 'small_up',
  small_down: 'small_down',
  text_bold: 'text_bold',
  text_italic: 'text_italic',
  label_align_left: 'label_align_left',
  label_align_right: 'label_align_right',
  label_align_bottom: 'label_align_bottom',
  label_align_top: 'label_align_top',
  text_align_left: 'text_align_left',
  text_align_center: 'text_align_center',
  text_align_right: 'text_align_right',
  text_align_bottom: 'text_align_bottom',
  text_align_top: 'text_align_top',
  text_valign_top: 'text_valign_top',
  text_valign_center: 'text_valign_center',
  text_valign_bottom: 'text_valign_bottom',
  text_horizontal: 'text_horizontal',
  text_vertical: 'text_vertical',
  pinorient_up: 'pinorient_up',
  pinorient_down: 'pinorient_down',
  pinorient_left: 'pinorient_left',
  pinorient_right: 'pinorient_right',

  // 3D viewer (EDA_3D_ACTIONS, 3d-viewer/3d_viewer/tools/eda_3d_actions.cpp).
  // The ids match `EDA_3D_ACTIONS::<name>` so the toolbar and menu transcripts
  // read against the upstream source.
  reloadBoard3d: 'import3d',
  copyToClipboard3d: 'copy',
  exportImage3d: 'export_file',
  toggleRaytracing: 'ray_tracing',
  rotateXCW: 'rotate_cw_x',
  rotateXCCW: 'rotate_ccw_x',
  rotateYCW: 'rotate_cw_y',
  rotateYCCW: 'rotate_ccw_y',
  rotateZCW: 'rotate_cw_z',
  rotateZCCW: 'rotate_ccw_z',
  // `flipView` is already gerbview's mirror action, and `showLayersManager` is
  // shared with the PCB appearance pane — the 3D one takes a suffix.
  flipView3d: 'flip_board',
  moveLeft3d: 'left',
  moveRight3d: 'right',
  moveUp3d: 'up',
  moveDown3d: 'down',
  toggleOrtho: 'ortho',
  viewTop: 'axis3d_top',
  viewBottom: 'axis3d_bottom',
  viewLeft: 'axis3d_left',
  viewRight: 'axis3d_right',
  viewFront: 'axis3d_front',
  viewBack: 'axis3d_back',
};
