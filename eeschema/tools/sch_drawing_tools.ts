// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_DRAWING_TOOLS` (eeschema/tools/sch_drawing_tools.{h,cpp}): the tool that places items on
 * the live model. Symbols (S5-5b), single-click items (no-connects, junctions, bus
 * entries), two-click items (labels, text, sheet pins), sheets, and the sheet-pin helpers (S5-5a)
 * are here; shapes, rule areas, tables, images and imports follow.
 *
 * Every dialog is the window's, through SCH_EDIT_FRAME::ShowModalDialog / EditSheetProperties.
 */
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { IGNORE_PARENT_GROUP, RECURSE_MODE } from '@ziroeda/common/eda_item.js';
import {
  ENDPOINT,
  IS_MOVING,
  IS_NEW,
  SKIP_STRUCT,
  STARTPOINT,
  STRUCT_DELETED,
} from '@ziroeda/common/eda_item_flags.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { parseColor4d } from '@ziroeda/common/gal/color4d.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { type KIID, newKiid } from '@ziroeda/common/kiid.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { Pgm, PgmOrNull } from '@ziroeda/common/pgm_base.js';
import type { DESIGN_BLOCK } from '@ziroeda/common/design_block.js';
import {
  imageFileWildcard,
  kicadSchematicWildcard,
} from '@ziroeda/common/wildcards_and_files_ext.js';
import { wxFD_FILE_MUST_EXIST, wxFD_OPEN } from '@ziroeda/common/wx/defs.js';
import { wxFileExists, wxReadFileSync } from '@ziroeda/common/wx/filefn.js';
import { SCH_BITMAP } from '../sch_bitmap.js';
import { SCH_GROUP } from '../sch_group.js';
import {
  MakeFileDlgImportSheetContents,
  TransferImportSheetContents,
} from '../widgets/sch_design_block_pane.js';
import { UniqueGroupName } from './sch_tool_utils.js';
import { NULL_REPORTER } from '@ziroeda/common/reporter.js';
import { strNumCmp } from '@ziroeda/common/string_utils.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ACTIONS, type INCREMENT } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import type { SELECTION_CONDITION } from '@ziroeda/common/tool/selection_conditions.js';
import {
  BUT_LEFT,
  BUT_RIGHT,
  MD_SHIFT,
  TA_CHOICE_MENU_CHOICE,
  TC_COMMAND,
  type TOOL_EVENT,
} from '@ziroeda/common/tool/tool_event.js';
import { SYNC_HANDLER } from '@ziroeda/common/tool/tool_interactive.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { wxID_OK } from '@ziroeda/common/wx/menu.js';
import { wxBell } from '@ziroeda/common/wx/utils.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_0, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { SEG } from '@ziroeda/kimath/src/geometry/seg.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { type SCH_BUS_ENTRY_BASE, SCH_BUS_WIRE_ENTRY } from '../sch_bus_entry.js';
import { SCH_COMMIT } from '../sch_commit.js';
import type { SCH_EDIT_FRAME } from '../sch_edit_frame.js';
import { SCH_FIELD } from '../sch_field.js';
import { AUTOPLACE_ALGO, type SCH_ITEM } from '../sch_item.js';
import { SCH_JUNCTION } from '../sch_junction.js';
import {
  LABEL_FLAG_SHAPE,
  SCH_DIRECTIVE_LABEL,
  SCH_GLOBALLABEL,
  SCH_HIERLABEL,
  SCH_LABEL,
  type SCH_LABEL_BASE,
  SPIN_STYLE,
} from '../sch_label.js';
import type { SCH_LINE } from '../sch_line.js';
import { SCH_NO_CONNECT } from '../sch_no_connect.js';
import {
  type ANNOTATE_ALGO_T,
  type ANNOTATE_ORDER_T,
  ANNOTATE_SCOPE_T,
  SCH_REFERENCE,
  SCH_REFERENCE_LIST,
} from '../sch_reference_list.js';
import type { PICKED_SYMBOL } from '../sch_screen.js';
import { SCH_SYMBOL } from '../sch_symbol.js';
import { id_eeschema_frm } from '../eeschema_id.js';
import { SYMBOL_LIBRARY_FILTER } from '../symbol_library_common.js';
import type { SCH_SCREEN } from '../sch_screen.js';
import { MIN_SHEET_HEIGHT, MIN_SHEET_WIDTH, SCH_SHEET } from '../sch_sheet.js';
import { SCH_SHEET_PATH, SYMBOL_FILTER } from '../sch_sheet_path.js';
import { SCH_SHEET_PIN, SHEET_SIDE } from '../sch_sheet_pin.js';
import { SCH_TEXT } from '../sch_text.js';
import type { SCHEMATIC } from '../schematic.js';
import { type Color4d, COLOR4D_UNSPECIFIED } from '@ziroeda/common/gal/color4d.js';
import {
  LeaderMode,
  POLYGON_GEOM_MANAGER,
} from '@ziroeda/common/preview_items/polygon_geom_manager.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import type { SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { KiROUND } from '@ziroeda/kimath/src/math/util.js';
import { SCH_SHAPE } from '../sch_shape.js';
import { SCH_TABLE } from '../sch_table.js';
import { SCH_TABLECELL } from '../sch_tablecell.js';
import { SCH_TEXTBOX } from '../sch_textbox.js';
import { LINE_MODE } from './sch_actions.js';
import { RULE_AREA_CREATE_HELPER } from './rule_area_create_helper.js';
import { EE_GRID_HELPER } from './ee_grid_helper.js';
import {
  type PLACE_SYMBOL_PARAMS,
  type PLACE_SYMBOL_UNIT_PARAMS,
  SCH_ACTIONS,
} from './sch_actions.js';
import { GetUnplacedUnitsForSymbol, IsUnannotatedUnitOccupied } from './sch_tool_utils.js';
import { SCH_LINE_WIRE_BUS_TOOL } from './sch_line_wire_bus_tool.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';

/** `FILEEXT::KiCadSchematicFileExtension` (wildcards_and_files_ext.cpp). */
const KiCadSchematicFileExtension = 'kicad_sch';

/** `POWER_SYMBOLS` (eeschema_settings.h:55): drawing.new_power_symbols' DEFAULT, GLOBAL, LOCAL. */
const POWER_SYMBOLS_GLOBAL = 1;
const POWER_SYMBOLS_LOCAL = 2;

export class SCH_DRAWING_TOOLS extends SCH_TOOL_BASE<SCH_EDIT_FRAME> {
  // The tool's memory of the last choices (sch_drawing_tools.cpp:83-104).
  m_lastSheetPinType: LABEL_FLAG_SHAPE = LABEL_FLAG_SHAPE.L_INPUT;
  m_lastGlobalLabelShape: LABEL_FLAG_SHAPE = LABEL_FLAG_SHAPE.L_INPUT;
  m_lastNetClassFlagShape: LABEL_FLAG_SHAPE = LABEL_FLAG_SHAPE.F_ROUND;
  m_lastTextOrientation: SPIN_STYLE = new SPIN_STYLE(SPIN_STYLE.RIGHT);
  m_lastTextBold = false;
  m_lastTextItalic = false;
  m_lastTextAngle: EDA_ANGLE = ANGLE_0;
  m_lastTextboxAngle: EDA_ANGLE = ANGLE_0;
  m_lastTextHJustify: GR_TEXT_H_ALIGN_T = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER;
  m_lastTextVJustify: GR_TEXT_V_ALIGN_T = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER;
  m_lastTextboxHJustify: GR_TEXT_H_ALIGN_T = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
  m_lastTextboxVJustify: GR_TEXT_V_ALIGN_T = GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_TOP;
  m_lastFillStyle: FILL_T = FILL_T.NO_FILL;
  m_lastFillColor: Color4d = COLOR4D_UNSPECIFIED;
  m_lastTextboxFillColor: Color4d = COLOR4D_UNSPECIFIED;
  m_lastStroke = new STROKE_PARAMS(0, LINE_STYLE.DEFAULT, COLOR4D_UNSPECIFIED);
  m_lastTextboxStroke = new STROKE_PARAMS(0, LINE_STYLE.DEFAULT, COLOR4D_UNSPECIFIED);
  m_lastTextboxFillStyle: FILL_T = FILL_T.NO_FILL;
  m_mruPath = '';
  m_lastAutoLabelRotateOnPlacement = false;
  m_drawingRuleArea = false;

  m_symbolHistoryList: PICKED_SYMBOL[] = [];
  m_powerHistoryList: PICKED_SYMBOL[] = [];

  private m_inDrawingTool = false; // Re-entrancy guard

  /**
   * \a aFrame is TS-only: a caller with no TOOL_MANAGER (the AI's headless frame) hands its frame
   * here and uses only the members that need nothing else (sizeSheet, createNewSheetPin…,
   * importHierLabel(s), autoPlaceSheetPins). A registered tool gets its frame from Init.
   */
  constructor(aFrame: SCH_EDIT_FRAME | null = null) {
    super('eeschema.InteractiveDrawing');
    this.m_frame = aFrame;
  }

  override Init(): boolean {
    super.Init();

    const belowRootSheetCondition: SELECTION_CONDITION = () =>
      this.m_frame!.GetCurrentSheet().Last() !== this.m_frame!.Schematic().Root();

    const inDrawingRuleArea: SELECTION_CONDITION = () => this.m_drawingRuleArea;

    const ctxMenu = this.m_menu.GetMenu();
    ctxMenu.AddItem(SCH_ACTIONS.leaveSheet, belowRootSheetCondition, 150);
    ctxMenu.AddItem(SCH_ACTIONS.closeOutline, inDrawingRuleArea, 200);
    ctxMenu.AddItem(SCH_ACTIONS.deleteLastPoint, inDrawingRuleArea, 200);

    return true;
  }

  private controls(): VIEW_CONTROLS {
    return this.getViewControls() as VIEW_CONTROLS;
  }

  private schematic(): SCHEMATIC {
    return this.m_frame!.Schematic();
  }

  /**
   * PlaceSymbol. The chooser and the library are the window's: SCH_EDIT_FRAME::
   * PickSymbolFromLibrary and GetLibSymbol answer asynchronously, so the coroutine waits on them
   * (RunMainStackModal) where the C++ blocks in the modal. The "already placed" list reads each
   * symbol's embedded library copy where the C++ reloads it from the library (SchGetLibSymbol),
   * which is asynchronous here; the copy is what that lookup returns for a loaded schematic.
   */
  *PlaceSymbol(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const toolParams = aEvent.Parameter<PLACE_SYMBOL_PARAMS>();

    let symbol: SCH_SYMBOL | null = toolParams.m_Symbol;

    // If we get a parameterised symbol, we probably just want to place that and get out of the
    // placmeent tool, rather than popping up the chooser afterwards
    const placeOneOnly = symbol !== null;

    const filter = new SYMBOL_LIBRARY_FILTER();
    let historyList: PICKED_SYMBOL[] | null = null;
    let ignorePrimePosition = false;
    const common_settings = Pgm().GetCommonSettings();
    const schSettings = this.schematic().Settings();
    const screen = this.m_frame!.GetScreen()!;
    let keepSymbol = false;
    let placeAllUnits = false;

    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    try {
      const controls = this.controls();
      const grid = new EE_GRID_HELPER(this.m_toolMgr);
      let cursorPos: VECTOR2I = { x: 0, y: 0 };

      // First we need to get all instances of this sheet so we can annotate whatever symbols we
      // place on all copies
      const hierarchy = this.schematic().Hierarchy();
      const newInstances = hierarchy.FindAllSheetsForScreen(
        this.m_frame!.GetCurrentSheet().LastScreen()!,
      );
      newInstances.SortByPageNumbers();

      // Get a list of all references in the schematic to avoid duplicates wherever they're placed
      const existingRefs = new SCH_REFERENCE_LIST();
      hierarchy.GetSymbols(existingRefs, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
      existingRefs.SortByReferenceOnly();

      if (aEvent.IsAction(SCH_ACTIONS.placeSymbol)) {
        historyList = this.m_symbolHistoryList;
      } else if (aEvent.IsAction(SCH_ACTIONS.placePower)) {
        historyList = this.m_powerHistoryList;
        filter.FilterPowerSymbols(true);
      } else {
        // wxFAIL_MSG( "PlaceSymbol(): unexpected request" )
      }

      this.m_frame!.PushTool(aEvent);

      const addSymbol = (aSymbol: SCH_SYMBOL) => {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_selectionTool!.AddItemToSel(aSymbol);

        aSymbol.SetFlags(IS_NEW | IS_MOVING);

        this.m_view!.ClearPreview();
        this.m_view!.AddToPreview(aSymbol, false); // Add, but not give ownership

        // Set IS_MOVING again, as AddItemToCommitAndScreen() will have cleared it.
        aSymbol.SetFlags(IS_MOVING);
        this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
      };

      const setCursor = () => {
        this.m_frame!.GetCanvas()?.SetCurrentCursor(symbol ? KICURSOR.MOVING : KICURSOR.COMPONENT);
      };

      const cleanup = () => {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view!.ClearPreview();
        symbol = null;

        existingRefs.Clear();
        hierarchy.GetSymbols(existingRefs, SYMBOL_FILTER.SYMBOL_FILTER_ALL);
        existingRefs.SortByReferenceOnly();
      };

      const annotate = () => {
        const cfg = this.m_frame!.eeconfig();

        // Then we need to annotate all instances by sheet
        for (const instance of newInstances) {
          const newReference = new SCH_REFERENCE(symbol!, instance);
          const refs = new SCH_REFERENCE_LIST();
          refs.AddItem(newReference);
          refs.SetRefDesTracker(schSettings.m_refDesTracker);

          if (cfg?.annotation.automatic || newReference.AlwaysAnnotate()) {
            refs.ReannotateByOptions(
              schSettings.m_AnnotateSortOrder as ANNOTATE_ORDER_T,
              schSettings.m_AnnotateMethod as ANNOTATE_ALGO_T,
              schSettings.m_AnnotateStartNum,
              existingRefs,
              false,
              hierarchy,
            );

            refs.UpdateAnnotation();

            // Update existing refs for next iteration
            for (let i = 0; i < refs.GetCount(); i++) existingRefs.AddItem(refs.at(i));
          }
        }

        this.m_frame!.GetCurrentSheet().UpdateAllScreenReferences();
      };

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      // Prime the pump
      if (symbol) {
        addSymbol(symbol);

        if (toolParams.m_Reannotate) annotate();

        controls.WarpMouseCursor(controls.GetMousePosition(false));
      } else if (aEvent.HasPosition()) {
        this.m_toolMgr!.PrimeTool(aEvent.Position());
      } else if ((common_settings?.m_Input.immediate_actions ?? true) && !aEvent.IsReactivate()) {
        this.m_toolMgr!.PrimeTool({ x: 0, y: 0 });
        ignorePrimePosition = true;
      }

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        cursorPos = grid.Align(controls.GetMousePosition(), GRID_HELPER_GRIDS.GRID_CONNECTABLE);
        controls.ForceCursorPosition(true, cursorPos);

        // The tool hotkey is interpreted as a click when drawing
        const isSyntheticClick =
          !!symbol && evt.IsActivate() && evt.HasPosition() && evt.Matches(aEvent);

        if (evt.IsCancelInteractive() || (symbol && evt.IsAction(ACTIONS.undo))) {
          this.m_frame!.GetInfoBar()?.Dismiss();

          if (symbol) {
            cleanup();

            if (keepSymbol) {
              // Re-enter symbol chooser
              this.m_toolMgr!.PostAction(ACTIONS.cursorClick);
            }
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (evt.IsActivate() && !isSyntheticClick) {
          if (symbol && evt.IsMoveTool()) {
            // we're already moving our own item; ignore the move tool
            evt.SetPassEvent(false);
            continue;
          }

          if (symbol) {
            this.m_frame!.ShowInfoBarMsg('Press <ESC> to cancel symbol creation.');
            evt.SetPassEvent(false);
            continue;
          }

          if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (
          evt.IsClick(BUT_LEFT) ||
          evt.IsDblClick(BUT_LEFT) ||
          isSyntheticClick ||
          evt.IsAction(ACTIONS.cursorClick) ||
          evt.IsAction(ACTIONS.cursorDblClick)
        ) {
          if (!symbol) {
            this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

            const unique_libid = new Set<string>();
            const alreadyPlaced: PICKED_SYMBOL[] = [];

            for (const sheet of hierarchy) {
              for (const item of sheet.LastScreen()!.Items().OfType(KICAD_T.SCH_SYMBOL_T)) {
                const s = item as SCH_SYMBOL;

                if (unique_libid.has(s.GetLibId().Format())) continue;

                unique_libid.add(s.GetLibId().Format());

                const libSymbol = s.GetLibSymbolRef();

                if (libSymbol) {
                  if (libSymbol.IsPower() !== filter.GetFilterPowerSymbols()) continue;

                  alreadyPlaced.push({
                    LibId: libSymbol.GetLibId(),
                    Unit: 1,
                    Convert: 1,
                    Fields: [],
                  });
                }
              }
            }

            // Pick the symbol to be placed
            const footprintPreviews = !!this.m_frame!.eeconfig()?.appearance.footprint_preview;
            const sel = yield* this.RunMainStackModal(() =>
              this.m_frame!.PickSymbolFromLibrary(
                filter,
                historyList!,
                alreadyPlaced,
                footprintPreviews,
              ),
            );

            keepSymbol = !!sel?.KeepSymbol;
            placeAllUnits = !!sel?.PlaceAllUnits;

            const libSymbol =
              sel && sel.LibId.IsValid()
                ? yield* this.RunMainStackModal(() => this.m_frame!.GetLibSymbol(sel.LibId))
                : null;

            if (!sel || !libSymbol) continue;

            // If we started with a hotkey which has a position then warp back to that.
            // Otherwise update to the current mouse position pinned inside the autoscroll
            // boundaries.
            if (evt.IsPrime() && !ignorePrimePosition) {
              cursorPos = grid.Align(evt.Position(), GRID_HELPER_GRIDS.GRID_CONNECTABLE);
              controls.WarpMouseCursor(cursorPos, true);
            } else {
              controls.PinCursorInsideNonAutoscrollArea(true);
              cursorPos = grid.Align(
                controls.GetMousePosition(),
                GRID_HELPER_GRIDS.GRID_CONNECTABLE,
              );
            }

            const cfg = this.m_frame!.eeconfig();

            // Only convert between power symbol types. Regular (non-power) symbols must never be
            // promoted to power symbols just because the default is set to Global or Local. The
            // preference's Default option means "follow the symbol definition" and any
            // conversion only applies to symbols that are already power symbols.
            if (
              libSymbol.IsPower() &&
              !libSymbol.IsLocalPower() &&
              cfg?.drawing.new_power_symbols === POWER_SYMBOLS_LOCAL
            ) {
              libSymbol.SetLocalPower();
              let keywords = libSymbol.GetKeyWords();

              // Adjust the KiCad library default fields to match the new power symbol type
              if (keywords.includes('global power')) {
                keywords = keywords.replaceAll('global power', 'local power');
                libSymbol.SetKeyWords(keywords);
              }

              let desc = libSymbol.GetDescription();

              if (desc.includes('global label')) {
                desc = desc.replaceAll('global label', 'local label');
                libSymbol.SetDescription(desc);
              }
            } else if (
              libSymbol.IsPower() &&
              !libSymbol.IsGlobalPower() &&
              cfg?.drawing.new_power_symbols === POWER_SYMBOLS_GLOBAL
            ) {
              // We do not currently have local power symbols in the KiCad library, so
              // don't update any fields
              libSymbol.SetGlobalPower();
            }

            const placed = SCH_SYMBOL.fromPicked(
              libSymbol,
              this.m_frame!.GetCurrentSheet(),
              sel,
              cursorPos,
              this.schematic(),
            );
            symbol = placed;
            addSymbol(placed);
            annotate();

            // Update the list of references for the next symbol placement.
            const placedSymbolReference = new SCH_REFERENCE(
              placed,
              this.m_frame!.GetCurrentSheet(),
            );
            existingRefs.AddItem(placedSymbolReference);
            existingRefs.SortByReferenceOnly();

            if (this.m_frame!.eeconfig()?.autoplace_fields.enable) {
              // Not placed yet, so pass a nullptr screen reference
              placed.AutoplaceFields(null, AUTOPLACE_ALGO.AUTOPLACE_AUTO);
            }

            // Update cursor now that we have a symbol
            setCursor();
          } else {
            const placed: SCH_SYMBOL = symbol;
            this.m_view!.ClearPreview();
            this.m_frame!.AddToScreen(placed, screen);

            if (this.m_frame!.eeconfig()?.autoplace_fields.enable)
              placed.AutoplaceFields(screen, AUTOPLACE_ALGO.AUTOPLACE_AUTO);

            this.m_frame!.SaveCopyForRepeatItem(placed);

            const commit = new SCH_COMMIT(this.m_toolMgr!);
            commit.Added(placed, screen);

            const lwbTool = this.m_toolMgr!.GetTool(SCH_LINE_WIRE_BUS_TOOL)!;
            lwbTool.TrimOverLappingWires(commit, this.m_selectionTool!.GetSelection());
            lwbTool.AddJunctionsIfNeeded(commit, this.m_selectionTool!.GetSelection());

            commit.Push('Place Symbol');

            if (placeOneOnly) {
              this.m_frame!.PopTool(aEvent);
              break;
            }

            let nextSymbol: SCH_SYMBOL | null = null;

            if (keepSymbol || placeAllUnits) {
              const currentReference = new SCH_REFERENCE(placed, this.m_frame!.GetCurrentSheet());
              const schematic = this.schematic();

              if (placeAllUnits) {
                // For unannotated references all U?-prefix symbols share the same ref string
                // regardless of the library symbol they originate from. Only consider units
                // already used by THIS library symbol when stepping through units, so different
                // multi-unit parts that share a reference prefix do not collide pre-annotation.
                const currentRefStr = currentReference.GetRef();
                const isUnannotated = currentRefStr !== '' && currentRefStr.endsWith('?');
                const symLibId = placed.GetLibId();

                const unitOccupied = (aUnit: number): boolean => {
                  if (!isUnannotated) {
                    const candidate = currentReference.Clone();
                    candidate.SetUnit(aUnit);
                    return schematic.Contains(candidate);
                  }

                  return IsUnannotatedUnitOccupied(existingRefs, currentRefStr, symLibId, aUnit);
                };

                while (
                  currentReference.GetUnit() <= placed.GetUnitCount() &&
                  unitOccupied(currentReference.GetUnit())
                ) {
                  currentReference.SetUnit(currentReference.GetUnit() + 1);
                }

                if (currentReference.GetUnit() > placed.GetUnitCount()) {
                  currentReference.SetUnit(1);
                }
              }

              // We are either stepping to the next unit or next symbol
              if (keepSymbol || currentReference.GetUnit() > 1) {
                nextSymbol = placed.Duplicate(IGNORE_PARENT_GROUP) as SCH_SYMBOL;
                nextSymbol.SetUnit(currentReference.GetUnit());
                nextSymbol.SetUnitSelection(currentReference.GetUnit());

                addSymbol(nextSymbol);
                symbol = nextSymbol;

                if (currentReference.GetUnit() === 1) annotate();

                // Update the list of references for the next symbol placement.
                const placedSymbolReference = new SCH_REFERENCE(
                  nextSymbol,
                  this.m_frame!.GetCurrentSheet(),
                );
                existingRefs.AddItem(placedSymbolReference);
                existingRefs.SortByReferenceOnly();
              }
            }

            symbol = nextSymbol;
          }
        } else if (evt.IsClick(BUT_RIGHT)) {
          // Warp after context menu only if dragging...
          if (!symbol) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (evt.Category() === TC_COMMAND && evt.Action() === TA_CHOICE_MENU_CHOICE) {
          const id = evt.GetCommandId()!;

          if (
            id >= id_eeschema_frm.ID_POPUP_SCH_SELECT_UNIT &&
            id <= id_eeschema_frm.ID_POPUP_SCH_SELECT_UNIT_END
          ) {
            const unit = id - id_eeschema_frm.ID_POPUP_SCH_SELECT_UNIT;

            if (symbol) {
              this.m_frame!.SelectUnit(symbol, unit);
              this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
            }
          } else if (
            id >= id_eeschema_frm.ID_POPUP_SCH_SELECT_BODY_STYLE &&
            id <= id_eeschema_frm.ID_POPUP_SCH_SELECT_BODY_STYLE_END
          ) {
            const bodyStyle = id - id_eeschema_frm.ID_POPUP_SCH_SELECT_BODY_STYLE + 1;

            if (symbol && symbol.GetBodyStyle() !== bodyStyle) {
              this.m_frame!.SelectBodyStyle(symbol, bodyStyle);
              this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
            }
          }
        } else if (
          evt.IsAction(ACTIONS.duplicate) ||
          evt.IsAction(SCH_ACTIONS.repeatDrawItem) ||
          evt.IsAction(ACTIONS.paste)
        ) {
          if (symbol) {
            wxBell();
            continue;
          }

          // Exit.  The duplicate/repeat/paste will run in its own loop.
          this.m_frame!.PopTool(aEvent);
          evt.SetPassEvent();
          break;
        } else if (symbol && (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion())) {
          symbol.SetPosition(cursorPos);
          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(symbol, false); // Add, but not give ownership
          this.m_frame!.SetMsgPanel(symbol);
        } else if (symbol && evt.IsAction(ACTIONS.doDelete)) {
          cleanup();
        } else if (
          symbol &&
          (evt.IsAction(ACTIONS.redo) ||
            evt.IsAction(SCH_ACTIONS.editWithLibEdit) ||
            evt.IsAction(SCH_ACTIONS.changeSymbol))
        ) {
          wxBell();
        } else if (
          symbol &&
          (evt.IsAction(SCH_ACTIONS.properties) ||
            evt.IsAction(SCH_ACTIONS.editReference) ||
            evt.IsAction(SCH_ACTIONS.editValue) ||
            evt.IsAction(SCH_ACTIONS.editFootprint) ||
            evt.IsAction(SCH_ACTIONS.autoplaceFields) ||
            evt.IsAction(SCH_ACTIONS.cycleBodyStyle) ||
            evt.IsAction(SCH_ACTIONS.setExcludeFromBOM) ||
            evt.IsAction(SCH_ACTIONS.setExcludeFromBoard) ||
            evt.IsAction(SCH_ACTIONS.setExcludeFromSim) ||
            evt.IsAction(SCH_ACTIONS.setExcludeFromPosFiles) ||
            evt.IsAction(SCH_ACTIONS.setDNP) ||
            evt.IsAction(SCH_ACTIONS.rotateCW) ||
            evt.IsAction(SCH_ACTIONS.rotateCCW) ||
            evt.IsAction(SCH_ACTIONS.mirrorV) ||
            evt.IsAction(SCH_ACTIONS.mirrorH))
        ) {
          this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
          evt.SetPassEvent();
        } else {
          evt.SetPassEvent();
        }

        // Enable autopanning and cursor capture only when there is a symbol to be placed
        controls.SetAutoPan(symbol !== null);
        controls.CaptureCursor(symbol !== null);
      }

      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);

      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  PlaceNextSymbolUnit(aEvent: TOOL_EVENT): number {
    const params = aEvent.Parameter<PLACE_SYMBOL_UNIT_PARAMS>();
    let symbol: SCH_SYMBOL | null = params.m_Symbol;
    const requestedUnit = params.m_Unit;

    // TODO: get from selection
    if (!symbol) {
      const symbolTypes = [KICAD_T.SCH_SYMBOL_T];
      const selection = this.m_selectionTool!.RequestSelection(symbolTypes);

      if (selection.Size() !== 1) {
        this.m_frame!.ShowInfoBarMsg('Select a single symbol to place the next unit.');
        return 0;
      }

      if (selection.Front()!.Type() !== KICAD_T.SCH_SYMBOL_T) return 0; // wxCHECK
      symbol = selection.Front() as SCH_SYMBOL;
    }

    if (!symbol) return 0;

    if (!symbol.IsMultiUnit()) {
      this.m_frame!.ShowInfoBarMsg('This symbol has only one unit.');
      return 0;
    }

    const missingUnits = GetUnplacedUnitsForSymbol(symbol);

    if (missingUnits.size === 0) {
      this.m_frame!.ShowInfoBarMsg('All units of this symbol are already placed.');
      return 0;
    }

    let nextMissing: number;

    if (requestedUnit > 0) {
      if (!missingUnits.has(requestedUnit)) {
        this.m_frame!.ShowInfoBarMsg('Requested unit already placed.');
        return 0;
      }

      nextMissing = requestedUnit;
    } else {
      // Find the lowest unit number that is missing
      nextMissing = Math.min(...missingUnits);
    }

    // std::make_unique<SCH_SYMBOL>( *symbol ): the copy constructor
    const newSymbol = symbol.Clone() as SCH_SYMBOL;
    const sheetPath = this.m_frame!.GetCurrentSheet();

    // Use SetUnitSelection(int) to update ALL instance references at once.
    // This is important for shared sheets where the same screen is used by multiple
    // sheet instances - we want the new symbol unit to appear correctly on all instances.
    newSymbol.SetUnitSelection(nextMissing);
    newSymbol.SetUnit(nextMissing);
    newSymbol.SetRefProp(symbol.GetRef(sheetPath, false));

    // Post the new symbol - don't reannotate it - we set the reference ourselves
    this.m_toolMgr!.PostAction<PLACE_SYMBOL_PARAMS>(SCH_ACTIONS.placeSymbol, {
      m_Symbol: newSymbol,
      m_Reannotate: false,
    });
    return 0;
  }

  *SingleClickPlace(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    let cursorPos: VECTOR2I = { x: 0, y: 0 };
    const type = aEvent.Parameter<KICAD_T>();
    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    const controls = this.controls();
    let previewItem: SCH_ITEM;
    let loggedInfoBarError = false;
    let description: string;
    const screen = this.m_frame!.GetScreen()!;
    let allowRepeat = false; // Set to true to allow new item repetition

    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    try {
      if (type === KICAD_T.SCH_JUNCTION_T && aEvent.HasPosition()) {
        const selection = this.m_selectionTool!.GetSelection();
        const front = selection.Front();
        const wire = front?.Type() === KICAD_T.SCH_LINE_T ? (front as SCH_LINE) : null;

        if (wire) {
          const seg = new SEG(wire.GetStartPoint(), wire.GetEndPoint());
          const nearest = seg.NearestPoint(controls.GetCursorPosition());
          controls.SetCrossHairCursorPosition(nearest, false);
          controls.WarpMouseCursor(controls.GetCursorPosition(), true);
        }
      }

      switch (type) {
        case KICAD_T.SCH_NO_CONNECT_T:
          previewItem = new SCH_NO_CONNECT(cursorPos);
          previewItem.SetParent(screen);
          description = 'Add No Connect Flag';
          allowRepeat = true;
          break;

        case KICAD_T.SCH_JUNCTION_T:
          previewItem = new SCH_JUNCTION(cursorPos);
          previewItem.SetParent(screen);
          description = 'Add Junction';
          break;

        case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
          previewItem = new SCH_BUS_WIRE_ENTRY(cursorPos);
          previewItem.SetParent(screen);
          description = 'Add Wire to Bus Entry';
          allowRepeat = true;
          break;

        default:
          // wxASSERT_MSG( false, "Unknown item type in SCH_DRAWING_TOOLS::SingleClickPlace" )
          return 0;
      }

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      cursorPos = aEvent.HasPosition() ? aEvent.Position() : controls.GetMousePosition();

      this.m_frame!.PushTool(aEvent);

      const setCursor = () => {
        this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.PLACE);
      };

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      this.m_view!.ClearPreview();
      this.m_view!.AddToPreview(previewItem.Clone());

      // Prime the pump
      if (aEvent.HasPosition() && (type as KICAD_T) !== KICAD_T.SCH_SHEET_PIN_T)
        this.m_toolMgr!.PrimeTool(aEvent.Position());
      else this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        cursorPos = evt.IsPrime() ? evt.Position() : controls.GetMousePosition();
        cursorPos = grid.BestSnapAnchor(cursorPos, grid.GetItemGrid(previewItem), null);
        controls.ForceCursorPosition(true, cursorPos);

        if (evt.IsCancelInteractive()) {
          this.m_frame!.PopTool(aEvent);
          break;
        } else if (evt.IsActivate()) {
          if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (
          evt.IsClick(BUT_LEFT) ||
          evt.IsDblClick(BUT_LEFT) ||
          evt.IsAction(ACTIONS.cursorClick) ||
          evt.IsAction(ACTIONS.cursorDblClick)
        ) {
          if (!screen.GetItem(cursorPos, 0, type)) {
            if (type === KICAD_T.SCH_JUNCTION_T) {
              if (!screen.IsExplicitJunctionAllowed(cursorPos)) {
                this.m_frame!.ShowInfoBarError(
                  'Junction location contains no joinable wires and/or pins.',
                );
                loggedInfoBarError = true;
                continue;
              } else if (loggedInfoBarError) {
                this.m_frame!.GetInfoBar()?.Dismiss();
              }
            }

            if (type === KICAD_T.SCH_JUNCTION_T) {
              const commit = new SCH_COMMIT(this.m_toolMgr!);
              const lwbTool = this.m_toolMgr!.GetTool(SCH_LINE_WIRE_BUS_TOOL)!;
              lwbTool.AddJunction(commit, screen, cursorPos);

              this.schematic().CleanUp(commit);

              commit.Push(description);
            } else {
              const newItem = previewItem.Clone() as SCH_ITEM;
              (newItem as { m_Uuid: KIID }).m_Uuid = newKiid();
              newItem.SetPosition(cursorPos);
              newItem.SetFlags(IS_NEW);
              this.m_frame!.AddToScreen(newItem, screen);

              if (allowRepeat) this.m_frame!.SaveCopyForRepeatItem(newItem);

              const commit = new SCH_COMMIT(this.m_toolMgr!);
              commit.Added(newItem, screen);

              this.schematic().CleanUp(commit);

              commit.Push(description);
            }
          }

          if (evt.IsDblClick(BUT_LEFT) || (type as KICAD_T) === KICAD_T.SCH_SHEET_PIN_T) {
            // Finish tool.
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (evt.IsClick(BUT_RIGHT)) {
          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion()) {
          previewItem.SetPosition(cursorPos);
          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(previewItem.Clone());
          this.m_frame!.SetMsgPanel(previewItem);
        } else if (evt.Category() === TC_COMMAND) {
          if (
            type === KICAD_T.SCH_BUS_WIRE_ENTRY_T &&
            (evt.IsAction(SCH_ACTIONS.rotateCW) ||
              evt.IsAction(SCH_ACTIONS.rotateCCW) ||
              evt.IsAction(SCH_ACTIONS.mirrorV) ||
              evt.IsAction(SCH_ACTIONS.mirrorH))
          ) {
            const busItem = previewItem as SCH_BUS_ENTRY_BASE;

            if (evt.IsAction(SCH_ACTIONS.rotateCW)) {
              busItem.Rotate(busItem.GetPosition(), false);
            } else if (evt.IsAction(SCH_ACTIONS.rotateCCW)) {
              busItem.Rotate(busItem.GetPosition(), true);
            } else if (evt.IsAction(SCH_ACTIONS.mirrorV)) {
              busItem.MirrorVertically(busItem.GetPosition().y);
            } else if (evt.IsAction(SCH_ACTIONS.mirrorH)) {
              busItem.MirrorHorizontally(busItem.GetPosition().x);
            }

            this.m_view!.ClearPreview();
            this.m_view!.AddToPreview(previewItem.Clone());
          } else if (evt.IsAction(SCH_ACTIONS.properties)) {
            switch (type) {
              case KICAD_T.SCH_BUS_WIRE_ENTRY_T:
                yield* this.RunMainStackModal(() =>
                  this.m_frame!.ShowModalDialog('DIALOG_WIRE_BUS_PROPERTIES', [previewItem]),
                );
                break;

              case KICAD_T.SCH_JUNCTION_T:
                yield* this.RunMainStackModal(() =>
                  this.m_frame!.ShowModalDialog('DIALOG_JUNCTION_PROPS', [previewItem]),
                );
                break;

              default:
                // Do nothing
                break;
            }

            this.m_view!.ClearPreview();
            this.m_view!.AddToPreview(previewItem.Clone());
          } else {
            evt.SetPassEvent();
          }
        } else {
          evt.SetPassEvent();
        }
      }

      this.m_view!.ClearPreview();

      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);
      controls.ForceCursorPosition(false);

      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  private findWire(aPosition: VECTOR2I): SCH_LINE | null {
    for (const item of this.m_frame!.GetScreen()!
      .Items()
      .Overlapping(KICAD_T.SCH_LINE_T, aPosition)) {
      const line = item as SCH_LINE;

      if (line.GetEditFlags() & STRUCT_DELETED) continue;

      if (line.IsWire()) return line;
    }

    return null;
  }

  ///< Gets the (global) label name driving this wire, if it is driven by a label
  private findWireLabelDriverName(aWire: SCH_LINE): string {
    const sheetPath = this.m_frame!.GetCurrentSheet();
    const wireConnection = aWire.Connection(sheetPath);

    if (wireConnection) {
      const wireDriver = wireConnection.Driver();

      if (wireDriver?.IsType([KICAD_T.SCH_LABEL_T, KICAD_T.SCH_GLOBAL_LABEL_T]))
        return wireConnection.LocalName();
    }

    return '';
  }

  /**
   * `createNewLabel` (sch_drawing_tools.cpp:1854): a label of \a aType (its layer), named from the
   * wire it lands on or by DIALOG_LABEL_PROPERTIES, which may itself fill \a aLabelList (a pasted
   * list of names). False when the dialog was cancelled.
   */
  *createNewLabel(
    aPosition: VECTOR2I,
    aType: SCH_LAYER_ID,
    aLabelList: SCH_LABEL_BASE[],
  ): COROUTINE_BODY<boolean> {
    const settings = this.schematic().Settings();
    let labelItem: SCH_LABEL_BASE;
    let netName = '';

    switch (aType) {
      case SCH_LAYER_ID.LAYER_LOCLABEL: {
        labelItem = new SCH_LABEL(aPosition);

        const wire = this.findWire(aPosition);

        if (wire) netName = this.findWireLabelDriverName(wire);

        break;
      }

      case SCH_LAYER_ID.LAYER_NETCLASS_REFS: {
        labelItem = new SCH_DIRECTIVE_LABEL(aPosition);
        labelItem.SetShape(this.m_lastNetClassFlagShape);
        labelItem.GetFields().push(new SCH_FIELD(labelItem, FIELD_T.USER, 'Netclass'));
        labelItem.GetFields().push(new SCH_FIELD(labelItem, FIELD_T.USER, 'Component Class'));
        const last = labelItem.GetFields()[labelItem.GetFields().length - 1]!;
        last.SetItalic(true);
        last.SetVisible(true);
        break;
      }

      case SCH_LAYER_ID.LAYER_HIERLABEL:
        labelItem = new SCH_HIERLABEL(aPosition);
        labelItem.SetShape(this.m_lastGlobalLabelShape);
        labelItem.SetAutoRotateOnPlacement(this.m_lastAutoLabelRotateOnPlacement);
        break;

      case SCH_LAYER_ID.LAYER_GLOBLABEL: {
        const globalLabel = new SCH_GLOBALLABEL(aPosition);
        globalLabel.SetShape(this.m_lastGlobalLabelShape);
        globalLabel.GetField(FIELD_T.INTERSHEET_REFS)!.SetVisible(settings.m_IntersheetRefsShow);
        globalLabel.SetAutoRotateOnPlacement(this.m_lastAutoLabelRotateOnPlacement);
        labelItem = globalLabel;

        const wire = this.findWire(aPosition);

        if (wire) netName = this.findWireLabelDriverName(wire);

        break;
      }

      default:
        // wxFAIL_MSG( "SCH_DRAWING_TOOLS::createNewLabel() unknown label type" )
        return false;
    }

    // The normal parent is the current screen for these labels, set by SCH_SCREEN::Append()
    // but it is also used during placement for SCH_HIERLABEL before beeing appended
    labelItem.SetParent(this.m_frame!.GetScreen());

    labelItem.SetTextSize({ x: settings.m_DefaultTextSize, y: settings.m_DefaultTextSize });

    if (aType !== SCH_LAYER_ID.LAYER_NETCLASS_REFS) {
      // Must be after SetTextSize()
      labelItem.SetBold(this.m_lastTextBold);
      labelItem.SetItalic(this.m_lastTextItalic);
    }

    labelItem.SetSpinStyle(this.m_lastTextOrientation);
    labelItem.SetFlags(IS_NEW | IS_MOVING);

    if (netName !== '') {
      // Auto-create from attached wire
      labelItem.SetText(netName);
    } else {
      // DIALOG_LABEL_PROPERTIES dlg( m_frame, labelItem, true ); dlg.SetLabelList( &aLabelList ):
      // QuasiModal required for syntax help and Scintilla auto-complete
      if (
        (yield* this.RunMainStackModal(() =>
          this.m_frame!.ShowModalDialog('DIALOG_LABEL_PROPERTIES', [labelItem], {
            isNew: true,
            labelList: aLabelList,
          }),
        )) !== wxID_OK
      )
        return false;
    }

    if (aType !== SCH_LAYER_ID.LAYER_NETCLASS_REFS) {
      this.m_lastTextBold = labelItem.IsBold();
      this.m_lastTextItalic = labelItem.IsItalic();
    }

    this.m_lastTextOrientation = labelItem.GetSpinStyle();

    if (aType === SCH_LAYER_ID.LAYER_GLOBLABEL || aType === SCH_LAYER_ID.LAYER_HIERLABEL) {
      this.m_lastGlobalLabelShape = labelItem.GetShape();
      this.m_lastAutoLabelRotateOnPlacement = labelItem.AutoRotateOnPlacement();
    } else if (aType === SCH_LAYER_ID.LAYER_NETCLASS_REFS) {
      this.m_lastNetClassFlagShape = labelItem.GetShape();
    }

    // DIALOG_LABEL_PROPERTIES already filled in aLabelList when it is not empty; labelItem is
    // then extraneous to needs
    if (aLabelList.length === 0) aLabelList.push(labelItem);

    return true;
  }

  private *createNewText(aPosition: VECTOR2I): COROUTINE_BODY<SCH_TEXT | null> {
    const schematic = this.schematic();
    const settings = schematic.Settings();

    const textItem = new SCH_TEXT(aPosition);
    textItem.SetParent(schematic);
    textItem.SetTextSize({ x: settings.m_DefaultTextSize, y: settings.m_DefaultTextSize });
    // Must be after SetTextSize()
    textItem.SetBold(this.m_lastTextBold);
    textItem.SetItalic(this.m_lastTextItalic);
    textItem.SetHorizJustify(this.m_lastTextHJustify);
    textItem.SetVertJustify(this.m_lastTextVJustify);
    textItem.SetTextAngle(this.m_lastTextAngle);
    textItem.SetFlags(IS_NEW | IS_MOVING);

    // DIALOG_TEXT_PROPERTIES: QuasiModal required for syntax help and Scintilla auto-complete
    if (
      (yield* this.RunMainStackModal(() =>
        this.m_frame!.ShowModalDialog('DIALOG_TEXT_PROPERTIES', [textItem]),
      )) !== wxID_OK
    )
      return null;

    this.m_lastTextBold = textItem.IsBold();
    this.m_lastTextItalic = textItem.IsItalic();
    this.m_lastTextHJustify = textItem.GetHorizJustify();
    this.m_lastTextVJustify = textItem.GetVertJustify();
    this.m_lastTextAngle = textItem.GetTextAngle();
    return textItem;
  }

  /** `createNewSheetPin` (sch_drawing_tools.cpp:2003). */
  createNewSheetPin(aSheet: SCH_SHEET, aPosition: VECTOR2I): SCH_SHEET_PIN {
    const settings = aSheet.Schematic()!.Settings();
    const pin = new SCH_SHEET_PIN(aSheet);

    pin.SetFlags(IS_NEW | IS_MOVING);
    pin.SetText(`${aSheet.GetPins().length + 1}`);
    pin.SetTextSize({ x: settings.m_DefaultTextSize, y: settings.m_DefaultTextSize });
    pin.SetPosition(aPosition);
    pin.ClearSelected();

    this.m_lastSheetPinType = pin.GetShape();

    return pin;
  }

  /** `createNewSheetPinFromLabel` (sch_drawing_tools.cpp:2020). */
  createNewSheetPinFromLabel(
    aSheet: SCH_SHEET,
    aPosition: VECTOR2I,
    aLabel: SCH_HIERLABEL,
  ): SCH_SHEET_PIN {
    const pin = this.createNewSheetPin(aSheet, aPosition);
    pin.SetText(aLabel.GetText());
    pin.SetShape(aLabel.GetShape());
    return pin;
  }

  /**
   * TwoClickPlace. The Sync Sheet Pins dialog's placement template (m_dialogSyncSheetPin) is not
   * ported: that dialog is the window's, and it places through placeHierLabel / placeSheetPin as
   * the plain tools do.
   */
  *TwoClickPlace(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    let item: SCH_ITEM | null = null;
    const controls = this.controls();
    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    let ignorePrimePosition = false;
    const common_settings = Pgm().GetCommonSettings();
    let sheet: SCH_SHEET | null = null;
    let description = '';

    const itemsToPlace: SCH_LABEL_BASE[] = [];

    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    try {
      const isText = aEvent.IsAction(SCH_ACTIONS.placeSchematicText);
      const isGlobalLabel = aEvent.IsAction(SCH_ACTIONS.placeGlobalLabel);
      const isHierLabel = aEvent.IsAction(SCH_ACTIONS.placeHierLabel);
      const isClassLabel = aEvent.IsAction(SCH_ACTIONS.placeClassLabel);
      const isNetLabel = aEvent.IsAction(SCH_ACTIONS.placeLabel);
      const isSheetPin = aEvent.IsAction(SCH_ACTIONS.placeSheetPin);

      const snapGrid = isText ? GRID_HELPER_GRIDS.GRID_TEXT : GRID_HELPER_GRIDS.GRID_CONNECTABLE;

      // If we have a selected sheet use it, otherwise try to get one under the cursor
      if (isSheetPin) {
        const front = this.m_selectionTool!.GetSelection().Front();
        sheet = front instanceof SCH_SHEET ? front : null;
      }

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.m_frame!.PushTool(aEvent);

      const setCursor = () => {
        const canvas = this.m_frame!.GetCanvas();

        if (item) canvas?.SetCurrentCursor(KICURSOR.PLACE);
        else if (isText) canvas?.SetCurrentCursor(KICURSOR.TEXT);
        else if (isGlobalLabel) canvas?.SetCurrentCursor(KICURSOR.LABEL_GLOBAL);
        else if (isNetLabel || isClassLabel) canvas?.SetCurrentCursor(KICURSOR.LABEL_NET);
        else if (isHierLabel) canvas?.SetCurrentCursor(KICURSOR.LABEL_HIER);
        else canvas?.SetCurrentCursor(KICURSOR.PENCIL);
      };

      const updatePreview = () => {
        this.m_view!.ClearPreview();
        this.m_view!.AddToPreview(item!, false);
        item!.RunOnChildren((aChild: SCH_ITEM) => {
          this.m_view!.AddToPreview(aChild, false);
        }, RECURSE_MODE.NO_RECURSE);
        this.m_frame!.SetMsgPanel(item!);
      };

      const cleanup = () => {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view!.ClearPreview();
        item = null;

        itemsToPlace.length = 0;
      };

      const prepItemForPlacement = (aItem: SCH_ITEM, cursorPos: VECTOR2I) => {
        aItem.SetPosition(cursorPos);

        aItem.SetFlags(IS_NEW | IS_MOVING);

        // Not placed yet, so pass a nullptr screen reference
        aItem.AutoplaceFields(null, AUTOPLACE_ALGO.AUTOPLACE_AUTO);

        updatePreview();
        this.m_selectionTool!.ClearSelection(true);
        this.m_selectionTool!.AddItemToSel(aItem);
        this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);

        // update the cursor so it looks correct before another event
        setCursor();
      };

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      if (aEvent.HasPosition()) {
        this.m_toolMgr!.PrimeTool(aEvent.Position());
      } else if (
        (common_settings?.m_Input.immediate_actions ?? true) &&
        !aEvent.IsReactivate() &&
        (isText || isGlobalLabel || isHierLabel || isClassLabel || isNetLabel)
      ) {
        this.m_toolMgr!.PrimeTool({ x: 0, y: 0 });
        ignorePrimePosition = true;
      }

      const commit = new SCH_COMMIT(this.m_toolMgr!);

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        let cursorPos = controls.GetMousePosition();
        cursorPos = grid.BestSnapAnchor(cursorPos, snapGrid, item);
        controls.ForceCursorPosition(true, cursorPos);

        // The tool hotkey is interpreted as a click when drawing
        const isSyntheticClick =
          !!item && evt.IsActivate() && evt.HasPosition() && evt.Matches(aEvent);

        if (evt.IsCancelInteractive() || evt.IsAction(ACTIONS.undo)) {
          this.m_frame!.GetInfoBar()?.Dismiss();

          if (item) {
            cleanup();
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (evt.IsActivate() && !isSyntheticClick) {
          if (item && evt.IsMoveTool()) {
            // we're already moving our own item; ignore the move tool
            evt.SetPassEvent(false);
            continue;
          }

          if (item) {
            this.m_frame!.ShowInfoBarMsg('Press <ESC> to cancel item creation.');
            evt.SetPassEvent(false);
            continue;
          }

          if (evt.IsPointEditor()) {
            // don't exit (the point editor runs in the background)
          } else if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (
          evt.IsClick(BUT_LEFT) ||
          evt.IsDblClick(BUT_LEFT) ||
          isSyntheticClick ||
          evt.IsAction(ACTIONS.cursorClick) ||
          evt.IsAction(ACTIONS.cursorDblClick)
        ) {
          // First click creates...
          if (!item) {
            this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

            if (isText) {
              item = yield* this.createNewText(cursorPos);
              description = 'Add Text';
            } else if (isHierLabel) {
              yield* this.createNewLabel(cursorPos, SCH_LAYER_ID.LAYER_HIERLABEL, itemsToPlace);
              description = 'Add Hierarchical Label';
            } else if (isNetLabel) {
              yield* this.createNewLabel(cursorPos, SCH_LAYER_ID.LAYER_LOCLABEL, itemsToPlace);
              description = 'Add Label';
            } else if (isGlobalLabel) {
              yield* this.createNewLabel(cursorPos, SCH_LAYER_ID.LAYER_GLOBLABEL, itemsToPlace);
              description = 'Add Label';
            } else if (isClassLabel) {
              yield* this.createNewLabel(cursorPos, SCH_LAYER_ID.LAYER_NETCLASS_REFS, itemsToPlace);
              description = 'Add Label';
            } else if (isSheetPin) {
              const i: { value: EDA_ITEM | null } = { value: null };

              // If we didn't have a sheet selected, try to find one under the cursor
              if (
                !sheet &&
                (yield* this.m_selectionTool!.SelectPoint(cursorPos, [KICAD_T.SCH_SHEET_T], i))
              )
                sheet = i.value instanceof SCH_SHEET ? i.value : null;

              if (!sheet) {
                // STATUS_TEXT_POPUP "Click over a sheet." for 2 s: the infobar here.
                this.m_frame!.ShowInfoBarMsg('Click over a sheet.');
                item = null;
              } else {
                // User is using the 'Place Sheet Pins' tool
                const label = this.importHierLabel(sheet);

                if (!label) {
                  this.m_frame!.ShowInfoBarMsg('No new hierarchical labels found.');
                  item = null;

                  this.m_frame!.PopTool(aEvent);
                  break;
                }

                item = this.createNewSheetPinFromLabel(sheet, cursorPos, label);
              }

              description = 'Add Sheet Pin';
            }

            // If we started with a hotkey which has a position then warp back to that.
            // Otherwise update to the current mouse position pinned inside the autoscroll
            // boundaries.
            if (evt.IsPrime() && !ignorePrimePosition) {
              cursorPos = grid.Align(evt.Position());
              controls.WarpMouseCursor(cursorPos, true);
            } else {
              controls.PinCursorInsideNonAutoscrollArea(true);
              cursorPos = controls.GetMousePosition();
              cursorPos = grid.BestSnapAnchor(cursorPos, snapGrid, item);
            }

            if (itemsToPlace.length > 0) item = itemsToPlace.shift()!;

            if (item) prepItemForPlacement(item, cursorPos);

            if (this.m_frame!.GetMoveWarpsCursor()) controls.SetCursorPosition(cursorPos, false);

            this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
          } else {
            // ... and second click places:
            const placed: SCH_ITEM = item;
            placed.ClearFlags(IS_MOVING);

            if (placed.IsConnectable())
              this.m_frame!.AutoRotateItem(this.m_frame!.GetScreen()!, placed);

            if (isSheetPin && sheet) {
              // Sheet pins are owned by their parent sheet.
              commit.Modify(sheet, this.m_frame!.GetScreen());
              sheet.AddPin(placed as SCH_SHEET_PIN);
            } else {
              this.m_frame!.SaveCopyForRepeatItem(placed);
              this.m_frame!.AddToScreen(placed, this.m_frame!.GetScreen());
              commit.Added(placed, this.m_frame!.GetScreen());
            }

            placed.AutoplaceFields(this.m_frame!.GetScreen(), AUTOPLACE_ALGO.AUTOPLACE_AUTO);

            commit.Push(description);

            this.m_view!.ClearPreview();

            item = null;

            if (isSheetPin && sheet) {
              const label = this.importHierLabel(sheet);

              if (!label) {
                this.m_frame!.ShowInfoBarMsg('No new hierarchical labels found.');

                this.m_frame!.PopTool(aEvent);
                break;
              }

              item = this.createNewSheetPinFromLabel(sheet, cursorPos, label);
            } else if (itemsToPlace.length > 0) {
              item = itemsToPlace.shift()!;
              prepItemForPlacement(item, cursorPos);
            }
          }
        } else if (evt.IsClick(BUT_RIGHT)) {
          // Warp after context menu only if dragging...
          if (!item) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (item && evt.IsSelectionEvent()) {
          // This happens if our text was replaced out from under us by ConvertTextType()
          const selection = this.m_selectionTool!.GetSelection();

          if (selection.GetSize() === 1) {
            item = selection.Front() as SCH_ITEM;
            updatePreview();
          } else {
            item = null;
          }
        } else if (evt.IsAction(ACTIONS.increment)) {
          if (evt.HasParameter())
            this.m_toolMgr!.RunSynchronousAction(
              ACTIONS.increment,
              commit,
              evt.Parameter<INCREMENT>(),
            );
          else
            this.m_toolMgr!.RunSynchronousAction<INCREMENT>(ACTIONS.increment, commit, {
              Delta: 1,
              Index: 0,
            });
        } else if (
          evt.IsAction(ACTIONS.duplicate) ||
          evt.IsAction(SCH_ACTIONS.repeatDrawItem) ||
          evt.IsAction(ACTIONS.paste)
        ) {
          if (item) {
            wxBell();
            continue;
          }

          // Exit.  The duplicate/repeat/paste will run in its own loop.
          this.m_frame!.PopTool(aEvent);
          evt.SetPassEvent();
          break;
        } else if (item && (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion())) {
          item.SetPosition(cursorPos);

          // Not placed yet, so pass a nullptr screen reference
          item.AutoplaceFields(null, AUTOPLACE_ALGO.AUTOPLACE_AUTO);

          updatePreview();
        } else if (item && evt.IsAction(ACTIONS.doDelete)) {
          cleanup();
        } else if (evt.IsAction(ACTIONS.redo)) {
          wxBell();
        } else if (
          item &&
          (evt.IsAction(SCH_ACTIONS.toDLabel) ||
            evt.IsAction(SCH_ACTIONS.toGLabel) ||
            evt.IsAction(SCH_ACTIONS.toHLabel) ||
            evt.IsAction(SCH_ACTIONS.toLabel) ||
            evt.IsAction(SCH_ACTIONS.toText) ||
            evt.IsAction(SCH_ACTIONS.toTextBox))
        ) {
          wxBell();
        } else if (
          item &&
          (evt.IsAction(SCH_ACTIONS.properties) ||
            evt.IsAction(SCH_ACTIONS.autoplaceFields) ||
            evt.IsAction(SCH_ACTIONS.rotateCW) ||
            evt.IsAction(SCH_ACTIONS.rotateCCW) ||
            evt.IsAction(SCH_ACTIONS.mirrorV) ||
            evt.IsAction(SCH_ACTIONS.mirrorH))
        ) {
          this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
          evt.SetPassEvent();
        } else {
          evt.SetPassEvent();
        }

        // Enable autopanning and cursor capture only when there is an item to be placed
        controls.SetAutoPan(item !== null);
        controls.CaptureCursor(item !== null);
      }

      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      controls.ForceCursorPosition(false);
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);

      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  *DrawShape(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const schematic = this.schematic();
    const sch_settings = schematic.Settings();
    let item: SCH_SHAPE | null = null;
    const isTextBox = aEvent.IsAction(SCH_ACTIONS.drawTextBox);
    const type = aEvent.Parameter<SHAPE_T>();
    let description = '';

    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    try {
      const controls = this.controls();
      const grid = new EE_GRID_HELPER(this.m_toolMgr);
      let cursorPos: VECTOR2I = { x: 0, y: 0 };

      // We might be running as the same shape in another co-routine.  Make sure that one
      // gets whacked.
      this.m_toolMgr!.DeactivateTool();

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.m_frame!.PushTool(aEvent);

      const setCursor = () => {
        this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.PENCIL);
      };

      const cleanup = () => {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view!.ClearPreview();
        item = null;
      };

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      if (aEvent.HasPosition()) this.m_toolMgr!.PrimeTool(aEvent.Position());

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        cursorPos = grid.Align(controls.GetMousePosition(), GRID_HELPER_GRIDS.GRID_GRAPHICS);
        controls.ForceCursorPosition(true, cursorPos);

        // The tool hotkey is interpreted as a click when drawing
        const isSyntheticClick =
          !!item && evt.IsActivate() && evt.HasPosition() && evt.Matches(aEvent);

        if (evt.IsCancelInteractive() || (item && evt.IsAction(ACTIONS.undo))) {
          if (item) {
            cleanup();
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (evt.IsActivate() && !isSyntheticClick) {
          if (item && evt.IsMoveTool()) {
            // we're already drawing our own item; ignore the move tool
            evt.SetPassEvent(false);
            continue;
          }

          if (item) cleanup();

          if (evt.IsPointEditor()) {
            // don't exit (the point editor runs in the background)
          } else if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (!item && (evt.IsClick(BUT_LEFT) || evt.IsAction(ACTIONS.cursorClick))) {
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

          let created: SCH_SHAPE;

          if (isTextBox) {
            const textbox = new SCH_TEXTBOX(
              SCH_LAYER_ID.LAYER_NOTES,
              0,
              this.m_lastTextboxFillStyle,
            );

            textbox.SetTextSize({
              x: sch_settings.m_DefaultTextSize,
              y: sch_settings.m_DefaultTextSize,
            });

            // Must come after SetTextSize()
            textbox.SetBold(this.m_lastTextBold);
            textbox.SetItalic(this.m_lastTextItalic);

            textbox.SetTextAngle(this.m_lastTextboxAngle);
            textbox.SetHorizJustify(this.m_lastTextboxHJustify);
            textbox.SetVertJustify(this.m_lastTextboxVJustify);
            textbox.SetStroke(this.m_lastTextboxStroke);
            textbox.SetFillColor(this.m_lastTextboxFillColor);
            textbox.SetParent(schematic);

            created = textbox;
            description = 'Add Text Box';
          } else {
            created = new SCH_SHAPE(type, SCH_LAYER_ID.LAYER_NOTES, 0, this.m_lastFillStyle);

            created.SetStroke(this.m_lastStroke);
            created.SetFillColor(this.m_lastFillColor);
            created.SetParent(schematic);
            description = `Add ${created.GetFriendlyName()}`;
          }

          item = created;
          created.SetFlags(IS_NEW);
          created.BeginEdit(cursorPos);

          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(created.Clone());
        } else if (
          item &&
          (evt.IsClick(BUT_LEFT) ||
            evt.IsDblClick(BUT_LEFT) ||
            isSyntheticClick ||
            evt.IsAction(ACTIONS.cursorClick) ||
            evt.IsAction(ACTIONS.cursorDblClick) ||
            evt.IsAction(ACTIONS.finishInteractive))
        ) {
          const drawn: SCH_SHAPE = item;
          let finished = false;

          if (
            evt.IsDblClick(BUT_LEFT) ||
            evt.IsAction(ACTIONS.cursorDblClick) ||
            evt.IsAction(ACTIONS.finishInteractive)
          ) {
            finished = true;
          } else {
            finished = !drawn.ContinueEdit(cursorPos);
          }

          if (finished) {
            drawn.EndEdit();
            drawn.ClearEditFlags();
            drawn.SetFlags(IS_NEW);

            if (isTextBox) {
              const textbox = drawn as SCH_TEXTBOX;

              controls.SetAutoPan(false);
              controls.CaptureCursor(false);

              // DIALOG_TEXT_PROPERTIES: QuasiModal required for syntax help and Scintilla auto-complete
              if (
                (yield* this.RunMainStackModal(() =>
                  this.m_frame!.ShowModalDialog('DIALOG_TEXT_PROPERTIES', [textbox]),
                )) !== wxID_OK
              ) {
                cleanup();
                continue;
              }

              this.m_lastTextBold = textbox.IsBold();
              this.m_lastTextItalic = textbox.IsItalic();
              this.m_lastTextboxAngle = textbox.GetTextAngle();
              this.m_lastTextboxHJustify = textbox.GetHorizJustify();
              this.m_lastTextboxVJustify = textbox.GetVertJustify();
              this.m_lastTextboxStroke = textbox.GetStroke();
              this.m_lastTextboxFillStyle = textbox.GetFillMode();
              this.m_lastTextboxFillColor = textbox.GetFillColor();
            } else {
              this.m_lastStroke = drawn.GetStroke();
              this.m_lastFillStyle = drawn.GetFillMode();
              this.m_lastFillColor = drawn.GetFillColor();
            }

            const commit = new SCH_COMMIT(this.m_toolMgr!);
            commit.Add(drawn, this.m_frame!.GetScreen());
            commit.Push(`Draw ${drawn.GetClass()}`);

            this.m_selectionTool!.AddItemToSel(drawn);
            item = null;

            this.m_view!.ClearPreview();
            this.m_toolMgr!.PostAction(ACTIONS.activatePointEditor);
          }
        } else if (
          evt.IsAction(ACTIONS.duplicate) ||
          evt.IsAction(SCH_ACTIONS.repeatDrawItem) ||
          evt.IsAction(ACTIONS.paste)
        ) {
          if (item) {
            wxBell();
            continue;
          }

          // Exit.  The duplicate/repeat/paste will run in its own loop.
          this.m_frame!.PopTool(aEvent);
          evt.SetPassEvent();
          break;
        } else if (item && (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion())) {
          const drawn: SCH_SHAPE = item;
          drawn.CalcEdit(cursorPos);
          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(drawn.Clone());
          this.m_frame!.SetMsgPanel(drawn);
        } else if (evt.IsDblClick(BUT_LEFT) && !item) {
          this.m_toolMgr!.RunAction(SCH_ACTIONS.properties);
        } else if (evt.IsClick(BUT_RIGHT)) {
          // Warp after context menu only if dragging...
          if (!item) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (item && evt.IsAction(ACTIONS.redo)) {
          wxBell();
        } else {
          evt.SetPassEvent();
        }

        // Enable autopanning and cursor capture only when there is a shape being drawn
        controls.SetAutoPan(item !== null);
        controls.CaptureCursor(item !== null);
      }

      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);
      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  *DrawRuleArea(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool ); SCOPED_SET_RESET scopedDrawMode( m_drawingRuleArea, true )
    this.m_inDrawingTool = true;
    const wasDrawingRuleArea = this.m_drawingRuleArea;
    this.m_drawingRuleArea = true;

    const controls = this.controls();
    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    let cursorPos: VECTOR2I = { x: 0, y: 0 };

    const ruleAreaTool = new RULE_AREA_CREATE_HELPER(
      this.getView()!,
      this.m_frame!,
      this.m_toolMgr!,
    );
    const polyGeomMgr = new POLYGON_GEOM_MANAGER(ruleAreaTool);
    let started = false;

    try {
      // We might be running as the same shape in another co-routine.  Make sure that one
      // gets whacked.
      this.m_toolMgr!.DeactivateTool();

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.m_frame!.PushTool(aEvent);

      const setCursor = () => {
        this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.PENCIL);
      };

      const cleanup = () => {
        polyGeomMgr.Reset();
        started = false;
        controls.SetAutoPan(false);
        controls.CaptureCursor(false);
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
      };

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      if (aEvent.HasPosition()) this.m_toolMgr!.PrimeTool(aEvent.Position());

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();

        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        cursorPos = grid.Align(controls.GetMousePosition(), GRID_HELPER_GRIDS.GRID_CONNECTABLE);
        controls.ForceCursorPosition(true, cursorPos);

        polyGeomMgr.SetLeaderMode(
          this.m_frame!.eeconfig()?.drawing.line_mode === LINE_MODE.LINE_MODE_FREE
            ? LeaderMode.DIRECT
            : LeaderMode.DEG45,
        );

        if (evt.IsCancelInteractive()) {
          if (started) {
            cleanup();
          } else {
            this.m_frame!.PopTool(aEvent);

            // We've handled the cancel event.  Don't cancel other tools
            evt.SetPassEvent(false);
            break;
          }
        } else if (evt.IsActivate()) {
          if (started) cleanup();

          if (evt.IsPointEditor()) {
            // don't exit (the point editor runs in the background)
          } else if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (evt.IsClick(BUT_RIGHT)) {
          if (!started) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        }
        // events that lock in nodes
        else if (
          evt.IsClick(BUT_LEFT) ||
          evt.IsDblClick(BUT_LEFT) ||
          evt.IsAction(ACTIONS.cursorClick) ||
          evt.IsAction(ACTIONS.cursorDblClick) ||
          evt.IsAction(SCH_ACTIONS.closeOutline)
        ) {
          // Check if it is double click / closing line (so we have to finish the zone)
          const endPolygon =
            evt.IsDblClick(BUT_LEFT) ||
            evt.IsAction(ACTIONS.cursorDblClick) ||
            evt.IsAction(SCH_ACTIONS.closeOutline) ||
            polyGeomMgr.NewPointClosesOutline(cursorPos);

          if (endPolygon) {
            polyGeomMgr.SetFinished();
            polyGeomMgr.Reset();

            started = false;
            controls.SetAutoPan(false);
            controls.CaptureCursor(false);
          }
          // adding a corner
          else if (polyGeomMgr.AddPoint(cursorPos)) {
            if (!started) {
              started = true;

              controls.SetAutoPan(true);
              controls.CaptureCursor(true);
            }
          }
        } else if (
          started &&
          (evt.IsAction(SCH_ACTIONS.deleteLastPoint) ||
            evt.IsAction(ACTIONS.doDelete) ||
            evt.IsAction(ACTIONS.undo))
        ) {
          const last = polyGeomMgr.DeleteLastCorner();

          if (last) {
            cursorPos = last;
            controls.WarpMouseCursor(cursorPos, true);
            controls.ForceCursorPosition(true, cursorPos);
            polyGeomMgr.SetCursorPosition(cursorPos);
          } else {
            cleanup();
          }
        } else if (started && (evt.IsMotion() || evt.IsDrag(BUT_LEFT))) {
          polyGeomMgr.SetCursorPosition(cursorPos);
        } else if (
          evt.IsAction(ACTIONS.duplicate) ||
          evt.IsAction(SCH_ACTIONS.repeatDrawItem) ||
          evt.IsAction(ACTIONS.paste)
        ) {
          if (started) {
            wxBell();
            continue;
          }

          // Exit.  The duplicate/repeat/paste will run in its own loop.
          this.m_frame!.PopTool(aEvent);
          evt.SetPassEvent();
          break;
        } else {
          evt.SetPassEvent();
        }
      } // end while

      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);
      return 0;
    } finally {
      ruleAreaTool.Dispose();
      this.m_drawingRuleArea = wasDrawingRuleArea;
      this.m_inDrawingTool = false;
    }
  }

  *DrawTable(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const schematic = this.schematic();
    let table: SCH_TABLE | null = null;

    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    try {
      const controls = this.controls();
      const grid = new EE_GRID_HELPER(this.m_toolMgr);
      let cursorPos: VECTOR2I = { x: 0, y: 0 };

      // We might be running as the same shape in another co-routine.  Make sure that one
      // gets whacked.
      this.m_toolMgr!.DeactivateTool();

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.m_frame!.PushTool(aEvent);

      const setCursor = () => {
        this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.PENCIL);
      };

      const cleanup = () => {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view!.ClearPreview();
        table = null;
      };

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      if (aEvent.HasPosition()) this.m_toolMgr!.PrimeTool(aEvent.Position());

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        cursorPos = grid.Align(controls.GetMousePosition(), GRID_HELPER_GRIDS.GRID_GRAPHICS);
        controls.ForceCursorPosition(true, cursorPos);

        // The tool hotkey is interpreted as a click when drawing
        const isSyntheticClick =
          !!table && evt.IsActivate() && evt.HasPosition() && evt.Matches(aEvent);

        if (evt.IsCancelInteractive() || (table && evt.IsAction(ACTIONS.undo))) {
          if (table) {
            cleanup();
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (evt.IsActivate() && !isSyntheticClick) {
          if (table && evt.IsMoveTool()) {
            // we're already drawing our own item; ignore the move tool
            evt.SetPassEvent(false);
            continue;
          }

          if (table) cleanup();

          if (evt.IsPointEditor()) {
            // don't exit (the point editor runs in the background)
          } else if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (!table && (evt.IsClick(BUT_LEFT) || evt.IsAction(ACTIONS.cursorClick))) {
          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

          const created = new SCH_TABLE(0);
          created.SetColCount(1);

          const tableCell = new SCH_TABLECELL();
          const defaultTextSize = schematic.Settings().m_DefaultTextSize;

          tableCell.SetTextSize({ x: defaultTextSize, y: defaultTextSize });
          created.AddCell(tableCell);

          created.SetParent(schematic);
          created.SetFlags(IS_NEW);
          created.SetPosition(cursorPos);
          table = created;

          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(created.Clone());
        } else if (
          table &&
          (evt.IsClick(BUT_LEFT) ||
            evt.IsDblClick(BUT_LEFT) ||
            isSyntheticClick ||
            evt.IsAction(ACTIONS.cursorClick) ||
            evt.IsAction(ACTIONS.cursorDblClick) ||
            evt.IsAction(ACTIONS.finishInteractive))
        ) {
          const drawn: SCH_TABLE = table;
          drawn.ClearEditFlags();
          drawn.SetFlags(IS_NEW);
          drawn.Normalize();

          // DIALOG_TABLE_PROPERTIES: QuasiModal required for Scintilla auto-complete
          if (
            (yield* this.RunMainStackModal(() =>
              this.m_frame!.ShowModalDialog('DIALOG_TABLE_PROPERTIES', [drawn]),
            )) === wxID_OK
          ) {
            const commit = new SCH_COMMIT(this.m_toolMgr!);
            commit.Add(drawn, this.m_frame!.GetScreen());
            commit.Push('Draw Table');

            this.m_selectionTool!.AddItemToSel(drawn);
            this.m_toolMgr!.PostAction(ACTIONS.activatePointEditor);
          }

          table = null;
          this.m_view!.ClearPreview();
        } else if (table && (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion())) {
          const sizing: SCH_TABLE = table;
          const gridSize = grid.GetGridSize(grid.GetItemGrid(sizing));
          const fontSize = schematic.Settings().m_DefaultTextSize;
          const origin = sizing.GetPosition();
          const requestedSize = { x: cursorPos.x - origin.x, y: cursorPos.y - origin.y };

          // int division truncates toward zero
          const colCount = Math.max(1, Math.trunc(requestedSize.x / (fontSize * 15)));
          const rowCount = Math.max(1, Math.trunc(requestedSize.y / (fontSize * 2)));

          const cellSize = {
            x: Math.max(gridSize.x * 5, Math.trunc(requestedSize.x / colCount)),
            y: Math.max(gridSize.y * 2, Math.trunc(requestedSize.y / rowCount)),
          };

          cellSize.x = KiROUND(cellSize.x / gridSize.x) * gridSize.x;
          cellSize.y = KiROUND(cellSize.y / gridSize.y) * gridSize.y;

          sizing.ClearCells();
          sizing.SetColCount(colCount);

          for (let col = 0; col < colCount; ++col) sizing.SetColWidth(col, cellSize.x);

          for (let row = 0; row < rowCount; ++row) {
            sizing.SetRowHeight(row, cellSize.y);

            for (let col = 0; col < colCount; ++col) {
              const cell = new SCH_TABLECELL();
              const defaultTextSize = schematic.Settings().m_DefaultTextSize;

              cell.SetTextSize({ x: defaultTextSize, y: defaultTextSize });
              cell.SetPosition({ x: origin.x + col * cellSize.x, y: origin.y + row * cellSize.y });
              cell.SetEnd({
                x: cell.GetPosition().x + cellSize.x,
                y: cell.GetPosition().y + cellSize.y,
              });
              sizing.AddCell(cell);
            }
          }

          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(sizing.Clone());
          this.m_frame!.SetMsgPanel(sizing);
        } else if (evt.IsDblClick(BUT_LEFT) && !table) {
          this.m_toolMgr!.RunAction(SCH_ACTIONS.properties);
        } else if (evt.IsClick(BUT_RIGHT)) {
          // Warp after context menu only if dragging...
          if (!table) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (
          evt.IsAction(ACTIONS.duplicate) ||
          evt.IsAction(SCH_ACTIONS.repeatDrawItem) ||
          evt.IsAction(ACTIONS.paste)
        ) {
          if (table) {
            wxBell();
            continue;
          }

          // Exit.  The duplicate/repeat/paste will run in its own loop.
          this.m_frame!.PopTool(aEvent);
          evt.SetPassEvent();
          break;
        } else if (table && evt.IsAction(ACTIONS.redo)) {
          wxBell();
        } else {
          evt.SetPassEvent();
        }

        // Enable autopanning and cursor capture only when there is a shape being drawn
        controls.SetAutoPan(table !== null);
        controls.CaptureCursor(table !== null);
      }

      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);
      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  /**
   * `PlaceImage( aEvent )` (sch_drawing_tools.cpp:1110): a click asks for an image file, the image
   * follows the cursor, and the next click places it. Given a SCH_BITMAP (a pasted image) it starts
   * already following the cursor and ends after one placement.
   */
  *PlaceImage(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    let image: SCH_BITMAP | null = aEvent.Parameter<SCH_BITMAP>() ?? null;
    const immediateMode = image !== null;
    let ignorePrimePosition = false;
    const common_settings = PgmOrNull()?.GetCommonSettings() ?? null;

    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    const controls = this.controls();
    let cursorPos: VECTOR2I = { x: 0, y: 0 };

    try {
      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      // Add all the drawable symbols to preview
      if (image) {
        image.SetPosition(controls.GetCursorPosition());
        this.m_view!.ClearPreview();
        this.m_view!.AddToPreview(image, false); // Add, but not give ownership
      }

      this.m_frame!.PushTool(aEvent);

      const setCursor = () => {
        this.m_frame!.GetCanvas()?.SetCurrentCursor(image ? KICURSOR.MOVING : KICURSOR.ARROW);
      };

      const cleanup = () => {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view!.ClearPreview();
        this.m_view!.RecacheAllItems();
        image = null;
      };

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      // Prime the pump
      if (image) {
        this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
      } else if (aEvent.HasPosition()) {
        this.m_toolMgr!.PrimeTool(aEvent.Position());
      } else if (common_settings?.m_Input.immediate_actions && !aEvent.IsReactivate()) {
        this.m_toolMgr!.PrimeTool({ x: 0, y: 0 });
        ignorePrimePosition = true;
      }

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        cursorPos = grid.Align(controls.GetMousePosition(), GRID_HELPER_GRIDS.GRID_GRAPHICS);
        controls.ForceCursorPosition(true, cursorPos);

        // The tool hotkey is interpreted as a click when drawing
        const isSyntheticClick =
          !!image && evt.IsActivate() && evt.HasPosition() && evt.Matches(aEvent);

        if (evt.IsCancelInteractive() || (image && evt.IsAction(ACTIONS.undo))) {
          this.m_frame!.GetInfoBar()?.Dismiss();

          if (image) {
            cleanup();
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }

          if (immediateMode) {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (evt.IsActivate() && !isSyntheticClick) {
          if (image && evt.IsMoveTool()) {
            // we're already moving our own item; ignore the move tool
            evt.SetPassEvent(false);
            continue;
          }

          if (image) {
            this.m_frame!.ShowInfoBarMsg('Press <ESC> to cancel image creation.');
            evt.SetPassEvent(false);
            continue;
          }

          if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          }

          this.m_frame!.PopTool(aEvent);
          break;
        } else if (
          evt.IsClick(BUT_LEFT) ||
          evt.IsDblClick(BUT_LEFT) ||
          isSyntheticClick ||
          evt.IsAction(ACTIONS.cursorClick) ||
          evt.IsAction(ACTIONS.cursorDblClick)
        ) {
          if (!image) {
            this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

            const fullFilename = yield* this.RunMainStackModal(() =>
              this.m_frame!.ShowFileDialog(
                'Choose Image',
                this.m_mruPath,
                '',
                [imageFileWildcard()],
                wxFD_OPEN,
              ),
            );

            if (!fullFilename) continue;

            // If we started with a hotkey which has a position then warp back to that.
            // Otherwise update to the current mouse position pinned inside the autoscroll
            // boundaries.
            if (evt.IsPrime() && !ignorePrimePosition) {
              cursorPos = grid.Align(evt.Position());
              controls.WarpMouseCursor(cursorPos, true);
            } else {
              controls.PinCursorInsideNonAutoscrollArea(true);
              cursorPos = controls.GetMousePosition();
            }

            this.m_mruPath = fullFilename.slice(0, Math.max(0, fullFilename.lastIndexOf('/')));

            if (wxFileExists(fullFilename)) image = new SCH_BITMAP(cursorPos);

            const bytes = wxReadFileSync(fullFilename);

            if (!image || !bytes || !image.GetReferenceImage().ReadImageFile(bytes)) {
              // wxMessageBox
              this.m_frame!.DisplayError(`Could not load image from '${fullFilename}'.`);
              image = null;
              continue;
            }

            image.SetFlags(IS_NEW | IS_MOVING);

            this.m_frame!.SaveCopyForRepeatItem(image);

            this.m_view!.ClearPreview();
            this.m_view!.AddToPreview(image, false); // Add, but not give ownership
            this.m_view!.RecacheAllItems(); // Bitmaps are cached in Opengl

            this.m_selectionTool!.AddItemToSel(image);

            controls.SetCursorPosition(cursorPos, false);
            setCursor();
          } else {
            const commit = new SCH_COMMIT(this.m_toolMgr!);
            commit.Add(image, this.m_frame!.GetScreen());
            commit.Push('Place Image');

            image = null;
            this.m_toolMgr!.PostAction(ACTIONS.activatePointEditor);

            this.m_view!.ClearPreview();

            if (immediateMode) {
              this.m_frame!.PopTool(aEvent);
              break;
            }
          }
        } else if (evt.IsClick(BUT_RIGHT)) {
          // Warp after context menu only if dragging...
          if (!image) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu?.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (
          evt.IsAction(ACTIONS.duplicate) ||
          evt.IsAction(SCH_ACTIONS.repeatDrawItem) ||
          evt.IsAction(ACTIONS.paste)
        ) {
          if (image) {
            // This doesn't really make sense; we'll just end up dragging a stack of objects so
            // we ignore the duplicate and just carry on.
            wxBell();
            continue;
          }

          // Exit.  The duplicate/repeat/paste will run in its own loop.
          this.m_frame!.PopTool(aEvent);
          evt.SetPassEvent();
          break;
        } else if (image && (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion())) {
          image.SetPosition(cursorPos);
          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(image, false); // Add, but not give ownership
          this.m_view!.RecacheAllItems(); // Bitmaps are cached in Opengl
          this.m_frame!.SetMsgPanel(image);
        } else if (image && evt.IsAction(ACTIONS.doDelete)) {
          cleanup();
        } else if (image && evt.IsAction(ACTIONS.redo)) {
          wxBell();
        } else {
          evt.SetPassEvent();
        }

        // Enable autopanning and cursor capture only when there is an image to be placed
        controls.SetAutoPan(image !== null);
        controls.CaptureCursor(image !== null);
      }

      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);

      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  /**
   * `ImportSheet( aEvent )` (sch_drawing_tools.cpp:729), also Place Design Block: a schematic's
   * contents placed under the cursor (as a group, annotated or not, repeatedly), or a click that
   * starts drawing the sheet that will hold it.
   */
  *ImportSheet(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const common_settings = PgmOrNull()?.GetCommonSettings() ?? null;
    const cfg = this.m_frame!.eeconfig();
    // m_DesignBlockChooserPanel lives on APP_SETTINGS_BASE, not in the eeschema JSON slice
    const chooser = this.m_frame!.config()?.m_DesignBlockChooserPanel ?? null;
    const schSettings = this.schematic().Settings();
    const screen = this.m_frame!.GetScreen()!;
    const sheetPath = this.m_frame!.GetCurrentSheet();

    const controls = this.controls();
    const grid = new EE_GRID_HELPER(this.m_toolMgr);
    let cursorPos: VECTOR2I = { x: 0, y: 0 };

    // Guard to reset forced cursor positioning on exit, regardless of error path
    try {
      if (!cfg || !common_settings || !chooser) return 0;

      if (this.m_inDrawingTool) return 0;

      const placingDesignBlock = aEvent.IsAction(SCH_ACTIONS.placeDesignBlock);

      let designBlock: DESIGN_BLOCK | null = null;
      let sheetFileName = '';

      if (placingDesignBlock) {
        const designBlockPane = this.m_frame!.GetDesignBlockPane();

        if (designBlockPane?.GetSelectedLibId().IsValid()) {
          designBlock = designBlockPane.GetDesignBlock(
            designBlockPane.GetSelectedLibId(),
            true,
            true,
          );

          if (!designBlock) {
            this.m_frame!.ShowInfoBarError(
              `Could not find design block ${designBlockPane.GetSelectedLibId().GetUniStringLibId()}.`,
              true,
            );
            return 0;
          }

          sheetFileName = designBlock.GetSchematicFile();

          if (sheetFileName === '' || !wxFileExists(sheetFileName)) {
            this.m_frame!.ShowInfoBarError('Design block has no schematic to place.', true);
            return 0;
          }
        }
      } else {
        const importSourceFile = aEvent.Parameter<string>();

        if (importSourceFile) sheetFileName = importSourceFile;
      }

      const setCursor = () => {
        this.m_frame!.GetCanvas()?.SetCurrentCursor(
          designBlock ? KICURSOR.MOVING : KICURSOR.COMPONENT,
        );
      };

      const self = this;

      function* placeSheetContents(): COROUTINE_BODY<boolean> {
        const commit = new SCH_COMMIT(self.m_toolMgr!);
        // m_toolMgr->GetTool<SCH_SELECTION_TOOL>(): the tool's own m_selectionTool
        const selectionTool = self.m_selectionTool!;

        const newItems: EDA_ITEM[] = [];
        const keepAnnotations = chooser!.keep_annotations;
        const placeAsGroup = chooser!.place_as_group;

        selectionTool.ClearSelection();

        // Mark all existing items on the screen so we don't select them after appending
        for (const item of screen.Items()) item.SetFlags(SKIP_STRUCT);

        const loaded = yield* self.RunMainStackModal(() =>
          self.m_frame!.LoadSheetFromFile(
            sheetPath.Last()!,
            sheetPath,
            sheetFileName,
            true,
            placingDesignBlock,
          ),
        );

        if (!loaded) return false;

        self.m_frame!.SetSheetNumberAndCount();

        self.m_frame!.SyncView();
        self.m_frame!.OnModify();
        self.m_frame!.HardRedraw(); // Full reinit of the current screen and the display.

        let group: SCH_GROUP | null = null;

        if (placeAsGroup) {
          group = new SCH_GROUP(screen);

          let baseName: string;

          if (designBlock) {
            baseName = designBlock.GetLibId().GetLibItemName();
            group.SetDesignBlockLibId(designBlock.GetLibId());
          } else {
            const full = sheetFileName.slice(sheetFileName.lastIndexOf('/') + 1);
            baseName = full.includes('.') ? full.slice(0, full.lastIndexOf('.')) : full;
          }

          group.SetName(UniqueGroupName(screen, baseName));
        }

        const autoAnnotate = !keepAnnotations && cfg!.annotation.automatic;

        // Select all new items
        for (const item of [...screen.Items()]) {
          if (!item.HasFlag(SKIP_STRUCT)) {
            // When auto-annotating, preserve original refs so that AnnotateSymbols can build
            // correct locked groups for multi-unit symbols before assigning new references.
            // Clearing first would leave locked groups empty, causing units from different
            // same-value arrays to get mixed.
            if (item.Type() === KICAD_T.SCH_SYMBOL_T && !keepAnnotations && !autoAnnotate)
              (item as SCH_SYMBOL).ClearAnnotation(sheetPath, false);

            if (item.Type() === KICAD_T.SCH_LINE_T) item.SetFlags(STARTPOINT | ENDPOINT);

            if (!item.GetParentGroup()) {
              if (placeAsGroup) group!.AddItem(item);

              newItems.push(item);
            }

            commit.Added(item, screen);
          } else {
            item.ClearFlags(SKIP_STRUCT);
          }
        }

        if (placeAsGroup) {
          commit.Add(group!, screen);
          selectionTool.AddItemToSel(group!);
        } else {
          selectionTool.AddItemsToSel(newItems, true);
        }

        cursorPos = grid.Align(
          controls.GetMousePosition(),
          grid.GetSelectionGrid(selectionTool.GetSelection()),
        );
        controls.ForceCursorPosition(true, cursorPos);

        // Move everything to our current mouse position now that we have a selection to get a
        // reference point
        const anchorPos = selectionTool.GetSelection().GetReferencePoint();
        const delta = { x: cursorPos.x - anchorPos.x, y: cursorPos.y - anchorPos.y };

        // Will all be SCH_ITEMs as these were pulled from the screen->Items()
        for (const item of newItems) (item as SCH_ITEM).Move(delta);

        if (!keepAnnotations || placingDesignBlock) {
          if (autoAnnotate) {
            self.m_frame!.AnnotateSymbols(
              commit,
              ANNOTATE_SCOPE_T.ANNOTATE_SELECTION,
              schSettings.m_AnnotateSortOrder as ANNOTATE_ORDER_T,
              schSettings.m_AnnotateMethod as ANNOTATE_ALGO_T,
              true /* recursive */,
              schSettings.m_AnnotateStartNum,
              true /* aResetAnnotation */,
              false,
              false,
              new NULL_REPORTER(),
              SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
            );
          }

          if (placingDesignBlock) {
            if (placeAsGroup) selectionTool.AddItemToSel(group!);
            else selectionTool.AddItemsToSel(newItems, true);

            self.m_frame!.AnnotateSymbols(
              commit,
              ANNOTATE_SCOPE_T.ANNOTATE_SELECTION,
              schSettings.m_AnnotateSortOrder as ANNOTATE_ORDER_T,
              schSettings.m_AnnotateMethod as ANNOTATE_ALGO_T,
              true /* recursive */,
              schSettings.m_AnnotateStartNum,
              true /* aResetAnnotation */,
              false,
              false,
              new NULL_REPORTER(),
              SYMBOL_FILTER.SYMBOL_FILTER_POWER,
            );
          }

          // Annotation will clear selection, so we need to restore it
          for (const item of newItems) {
            if (item.Type() === KICAD_T.SCH_LINE_T) item.SetFlags(STARTPOINT | ENDPOINT);
          }

          if (placeAsGroup) selectionTool.AddItemToSel(group!);
          else selectionTool.AddItemsToSel(newItems, true);
        }

        // Start moving selection, cancel undoes the insertion
        const placed = yield* self.RunSynchronousActionWait(SCH_ACTIONS.move, commit);

        // Update our cursor position to the new location in case we're placing repeated copies
        cursorPos = grid.Align(controls.GetMousePosition(), GRID_HELPER_GRIDS.GRID_CONNECTABLE);

        if (placed)
          commit.Push(placingDesignBlock ? 'Add Design Block' : 'Import Schematic Sheet Content');
        else commit.Revert();

        selectionTool.RebuildSelection();
        self.m_frame!.UpdateHierarchyNavigator();

        return placed;
      }

      // Whether we are placing the sheet as a sheet, or as its contents, we need to get a filename
      // if we weren't provided one
      if (sheetFileName === '') {
        if (!placingDesignBlock) {
          const fullName = this.m_frame!.Prj().GetProjectFullName();
          const path = fullName.slice(0, Math.max(0, fullName.lastIndexOf('/')));

          // Open file chooser dialog even if we have been provided a file so the user can select
          // the options they want
          const dlgHook = MakeFileDlgImportSheetContents(chooser);
          const chosen = yield* this.RunMainStackModal(() =>
            this.m_frame!.ShowFileDialog(
              'Choose Schematic',
              path,
              '',
              [kicadSchematicWildcard()],
              wxFD_OPEN | wxFD_FILE_MUST_EXIST,
              dlgHook,
            ),
          );

          if (!chosen) return 0;

          TransferImportSheetContents(dlgHook, chooser);
          sheetFileName = chosen;

          this.m_frame!.GetDesignBlockPane()?.UpdateCheckboxes();
        }

        if (sheetFileName === '') return 0;
      }

      // If we're placing sheet contents, we don't even want to run our tool loop, just add the
      // items to the canvas and run the move tool
      if (!chooser.place_as_sheet) {
        while ((yield* placeSheetContents()) && chooser.repeated_placement) {
          // place another copy
        }

        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view?.ClearPreview();
        return 0;
      }

      // We're placing a sheet as a sheet, we need to run a small tool loop to get the starting
      // coordinate of the sheet drawing
      this.m_frame!.PushTool(aEvent);

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      if (common_settings.m_Input.immediate_actions && !aEvent.IsReactivate())
        this.m_toolMgr!.PrimeTool({ x: 0, y: 0 });

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        cursorPos = grid.Align(controls.GetMousePosition(), GRID_HELPER_GRIDS.GRID_CONNECTABLE);
        controls.ForceCursorPosition(true, cursorPos);

        // The tool hotkey is interpreted as a click when drawing
        const isSyntheticClick =
          !!designBlock && evt.IsActivate() && evt.HasPosition() && evt.Matches(aEvent);

        if (evt.IsCancelInteractive() || (designBlock && evt.IsAction(ACTIONS.undo))) {
          this.m_frame!.GetInfoBar()?.Dismiss();
          break;
        } else if (evt.IsActivate() && !isSyntheticClick) {
          this.m_frame!.GetInfoBar()?.Dismiss();
          break;
        } else if (
          evt.IsClick(BUT_LEFT) ||
          evt.IsDblClick(BUT_LEFT) ||
          isSyntheticClick ||
          evt.IsAction(ACTIONS.cursorClick) ||
          evt.IsAction(ACTIONS.cursorDblClick)
        ) {
          // drawSheet must delete designBlock / sheetFileName
          if (placingDesignBlock)
            this.m_toolMgr!.PostAction(SCH_ACTIONS.drawSheetFromDesignBlock, designBlock);
          else this.m_toolMgr!.PostAction(SCH_ACTIONS.drawSheetFromFile, sheetFileName);

          break;
        } else if (evt.IsClick(BUT_RIGHT)) {
          // Warp after context menu only if dragging...
          if (!designBlock) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu?.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (evt.IsAction(ACTIONS.duplicate) || evt.IsAction(SCH_ACTIONS.repeatDrawItem)) {
          wxBell();
        } else {
          evt.SetPassEvent();
        }
      }

      this.m_frame!.PopTool(aEvent);
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);

      return 0;
    } finally {
      controls.ForceCursorPosition(false);
    }
  }

  /**
   * DrawSheet. drawSheetFromDesignBlock (a DESIGN_BLOCK's schematic) is not ported yet: the design
   * block libraries are not on the live model.
   */
  *DrawSheet(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const isDrawSheetCopy = aEvent.IsAction(SCH_ACTIONS.drawSheetFromFile);

    let sheet: SCH_SHEET | null = null;
    let filename = '';

    if (isDrawSheetCopy) {
      const ptr = aEvent.Parameter<string>();

      if (!ptr) return 0; // wxCHECK

      // We own the string if we're importing a sheet
      filename = ptr;
    }

    if (isDrawSheetCopy && !this.m_frame!.FileExists(filename)) {
      this.m_frame!.DisplayError(`File '${filename}' does not exist.`);
      return 0;
    }

    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    try {
      const cfg = this.m_frame!.eeconfig();
      // m_DesignBlockChooserPanel lives on APP_SETTINGS_BASE, not in the eeschema JSON slice
      const designBlockChooser = this.m_frame!.config()?.m_DesignBlockChooserPanel;
      const schSettings = this.schematic().Settings();
      const controls = this.controls();
      const grid = new EE_GRID_HELPER(this.m_toolMgr);
      let cursorPos: VECTOR2I = { x: 0, y: 0 };
      let startedWithDrag = false; // Track if initial sheet placement started with a drag

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.m_frame!.PushTool(aEvent);

      const setCursor = () => {
        this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.PENCIL);
      };

      const cleanup = () => {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view!.ClearPreview();
        sheet = null;
      };

      this.Activate();

      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);

      // Set initial cursor
      setCursor();

      if (aEvent.HasPosition() && !isDrawSheetCopy) this.m_toolMgr!.PrimeTool(aEvent.Position());

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        cursorPos = grid.Align(controls.GetMousePosition(), GRID_HELPER_GRIDS.GRID_GRAPHICS);
        controls.ForceCursorPosition(true, cursorPos);

        // The tool hotkey is interpreted as a click when drawing
        const isSyntheticClick =
          !!sheet && evt.IsActivate() && evt.HasPosition() && evt.Matches(aEvent);

        if (evt.IsCancelInteractive() || (sheet && evt.IsAction(ACTIONS.undo))) {
          this.m_frame!.GetInfoBar()?.Dismiss();

          if (sheet) {
            cleanup();
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (evt.IsActivate() && !isSyntheticClick) {
          if (sheet && evt.IsMoveTool()) {
            // we're already drawing our own item; ignore the move tool
            evt.SetPassEvent(false);
            continue;
          }

          if (sheet) {
            this.m_frame!.ShowInfoBarMsg('Press <ESC> to cancel sheet creation.');
            evt.SetPassEvent(false);
            continue;
          }

          if (evt.IsPointEditor()) {
            // don't exit (the point editor runs in the background)
          } else if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          } else {
            this.m_frame!.PopTool(aEvent);
            break;
          }
        } else if (
          !sheet &&
          (evt.IsClick(BUT_LEFT) ||
            evt.IsDblClick(BUT_LEFT) ||
            evt.IsAction(ACTIONS.cursorClick) ||
            evt.IsAction(ACTIONS.cursorDblClick) ||
            evt.IsDrag(BUT_LEFT))
        ) {
          const selection = this.m_selectionTool!.GetSelection();

          if (
            selection.Size() === 1 &&
            selection.Front()!.Type() === KICAD_T.SCH_SHEET_T &&
            selection.Front()!.GetBoundingBox().Contains(cursorPos)
          ) {
            if (evt.IsClick(BUT_LEFT) || evt.IsAction(ACTIONS.cursorClick)) {
              // sheet already selected
              continue;
            } else if (evt.IsDblClick(BUT_LEFT) || evt.IsAction(ACTIONS.cursorDblClick)) {
              this.m_toolMgr!.PostAction(SCH_ACTIONS.enterSheet);
              this.m_frame!.PopTool(aEvent);
              break;
            }
          }

          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

          const sheetPos = evt.IsDrag(BUT_LEFT)
            ? grid.Align(evt.DragOrigin(), GRID_HELPER_GRIDS.GRID_GRAPHICS)
            : cursorPos;

          // Remember whether this sheet was initiated with a drag so we can treat mouse-up as
          // the terminating (second) click.
          startedWithDrag = evt.IsDrag(BUT_LEFT);

          const newSheet = new SCH_SHEET(this.m_frame!.GetCurrentSheet().Last(), sheetPos);
          sheet = newSheet;
          newSheet.SetScreen(null);

          const ext = `.${KiCadSchematicFileExtension}`;

          if (isDrawSheetCopy) {
            // wxFileName( filename ).GetName(): the base name without directory or extension
            const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');

            newSheet.GetField(FIELD_T.SHEET_NAME)!.SetText(base);
            newSheet.GetField(FIELD_T.SHEET_FILENAME)!.SetText(base + ext);
          } else {
            newSheet.GetField(FIELD_T.SHEET_NAME)!.SetText('Untitled Sheet');
            newSheet.GetField(FIELD_T.SHEET_FILENAME)!.SetText(`untitled${ext}`);
          }

          newSheet.SetFlags(IS_NEW | IS_MOVING);

          if (cfg) {
            newSheet.SetBorderWidth(schIUScale.milsToIU(cfg.drawing.default_line_thickness));
            newSheet.SetBorderColor(parseColor4d(cfg.drawing.default_sheet_border_color));
            newSheet.SetBackgroundColor(parseColor4d(cfg.drawing.default_sheet_background_color));
          }

          this.sizeSheet(newSheet, cursorPos);

          const hierarchy = this.schematic().Hierarchy();
          const instance = this.m_frame!.GetCurrentSheet().Clone();
          instance.push_back(newSheet);

          // Find the next available page number by checking all existing page numbers
          const usedPageNumbers = new Set<number>();

          for (const path of hierarchy) {
            const existingPageNum = path.GetPageNumber();
            // wxString::ToLong: the whole string must be a number
            const pageNum = /^\s*[-+]?\d+$/.test(existingPageNum)
              ? Number.parseInt(existingPageNum, 10)
              : 0;

            if (pageNum > 0) usedPageNumbers.add(pageNum);
          }

          // Find the first available number starting from 1
          let nextAvailable = 1;

          while (usedPageNumbers.has(nextAvailable)) nextAvailable++;

          instance.SetPageNumber(`${nextAvailable}`);

          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(newSheet.Clone());
        } else if (
          sheet &&
          (evt.IsClick(BUT_LEFT) ||
            evt.IsDblClick(BUT_LEFT) ||
            isSyntheticClick ||
            evt.IsAction(ACTIONS.cursorClick) ||
            evt.IsAction(ACTIONS.cursorDblClick) ||
            evt.IsAction(ACTIONS.finishInteractive) ||
            (startedWithDrag && evt.IsMouseUp(BUT_LEFT)))
        ) {
          const placed: SCH_SHEET = sheet;
          controls.SetAutoPan(false);
          controls.CaptureCursor(false);

          if (
            yield* this.RunMainStackModal(() =>
              this.m_frame!.EditSheetProperties(
                placed,
                this.m_frame!.GetCurrentSheet(),
                isDrawSheetCopy ? filename : undefined,
              ),
            )
          ) {
            this.m_view!.ClearPreview();

            placed.AutoplaceFields(this.m_frame!.GetScreen(), AUTOPLACE_ALGO.AUTOPLACE_AUTO);

            // Use the commit we were provided or make our own
            const eventCommit = evt.Commit();
            const c =
              eventCommit instanceof SCH_COMMIT ? eventCommit : new SCH_COMMIT(this.m_toolMgr!);

            // We need to manually add the sheet to the screen otherwise annotation will not be able
            // to find the sheet and its symbols to annotate.
            this.m_frame!.AddToScreen(placed);
            c.Added(placed, this.m_frame!.GetScreen());

            // Refresh the hierarchy so the new sheet and its symbols are found during annotation.
            // The cached hierarchy was built before this sheet was added.
            this.schematic().RefreshHierarchy();

            const annotateNonPowerSymbols =
              !!cfg?.annotation.automatic &&
              !(isDrawSheetCopy && !!designBlockChooser?.keep_annotations);

            if (annotateNonPowerSymbols) {
              // Annotation will remove this from selection, but we add it back later
              this.m_selectionTool!.AddItemToSel(placed);

              this.m_frame!.AnnotateSymbols(
                c,
                ANNOTATE_SCOPE_T.ANNOTATE_SELECTION,
                schSettings.m_AnnotateSortOrder as ANNOTATE_ORDER_T,
                schSettings.m_AnnotateMethod as ANNOTATE_ALGO_T,
                true /* recursive */,
                schSettings.m_AnnotateStartNum,
                true /* reset */,
                false /* regroup */,
                false /* repair */,
                NULL_REPORTER.GetInstance(),
                SYMBOL_FILTER.SYMBOL_FILTER_NON_POWER,
              );
            }

            c.Push(isDrawSheetCopy ? 'Import Sheet Copy' : 'Draw Sheet');

            this.m_selectionTool!.AddItemToSel(placed);

            if (isDrawSheetCopy && !designBlockChooser?.repeated_placement) {
              this.m_frame!.PopTool(aEvent);
              sheet = null;
              break;
            }
          } else {
            this.m_view!.ClearPreview();
          }

          sheet = null;
        } else if (
          evt.IsAction(ACTIONS.duplicate) ||
          evt.IsAction(SCH_ACTIONS.repeatDrawItem) ||
          evt.IsAction(ACTIONS.paste)
        ) {
          if (sheet) {
            wxBell();
            continue;
          }

          // Exit.  The duplicate/repeat/paste will run in its own loop.
          this.m_frame!.PopTool(aEvent);
          evt.SetPassEvent();
          break;
        } else if (
          sheet &&
          (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion() || evt.IsDrag(BUT_LEFT))
        ) {
          const sizing: SCH_SHEET = sheet;
          this.sizeSheet(sizing, cursorPos);
          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(sizing.Clone());
          this.m_frame!.SetMsgPanel(sizing);
        } else if (evt.IsClick(BUT_RIGHT)) {
          // Warp after context menu only if dragging...
          if (!sheet) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (sheet && evt.IsAction(ACTIONS.redo)) {
          wxBell();
        } else {
          evt.SetPassEvent();
        }

        // Enable autopanning and cursor capture only when there is a sheet to be placed
        controls.SetAutoPan(sheet !== null);
        controls.CaptureCursor(sheet !== null);
      }

      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      this.m_frame!.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);

      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  /** `sizeSheet` (sch_drawing_tools.cpp:3603): size \a aSheet to reach \a aPos, at least the minimum. */
  sizeSheet(aSheet: SCH_SHEET, aPos: VECTOR2I): void {
    const pos = aSheet.GetPosition();
    const size = { x: aPos.x - pos.x, y: aPos.y - pos.y };

    size.x = Math.max(size.x, schIUScale.milsToIU(MIN_SHEET_WIDTH));
    size.y = Math.max(size.y, schIUScale.milsToIU(MIN_SHEET_HEIGHT));

    const grid = this.m_frame!.GetNearestGridPosition({ x: pos.x + size.x, y: pos.y + size.y });
    aSheet.Resize({ x: grid.x - pos.x, y: grid.y - pos.y });
  }

  /**
   * `doSyncSheetsPins` (sch_drawing_tools.cpp:3616): DIALOG_SYNC_SHEET_PINS over \a aSheetPaths.
   * The dialog and its SHEET_SYNCHRONIZATION_AGENT are the window's.
   */
  private doSyncSheetsPins(
    aSheetPaths: SCH_SHEET_PATH[],
    aInitialSheet: SCH_SHEET | null = null,
  ): number {
    if (aSheetPaths.length === 0) return 0;

    void this.m_frame!.ShowModalDialog('DIALOG_SYNC_SHEET_PINS', [], {
      sheetPaths: aSheetPaths,
      initialSheet: aInitialSheet,
    });
    return 0;
  }

  *SyncSheetsPins(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const front = this.m_selectionTool!.GetSelection().Front();
    let sheet = front instanceof SCH_SHEET ? front : null;

    if (!sheet) {
      const cursorPos = this.controls().GetMousePosition();
      const i: { value: EDA_ITEM | null } = { value: null };

      yield* this.m_selectionTool!.SelectPoint(cursorPos, [KICAD_T.SCH_SHEET_T], i);

      if (i.value) sheet = i.value instanceof SCH_SHEET ? i.value : null;
    }

    if (sheet) {
      const current = this.m_frame!.GetCurrentSheet().Clone();
      current.push_back(sheet);
      return this.doSyncSheetsPins([current]);
    }

    return 0;
  }

  /**
   * AutoPlaceAllSheetPins: a pin for every hierarchical label of the selected sheet that has none.
   * The work after the selection is autoPlaceSheetPins, which the AI calls with a sheet in hand.
   */
  AutoPlaceAllSheetPins(_aEvent: TOOL_EVENT): number {
    if (this.m_inDrawingTool) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawingTool )
    this.m_inDrawingTool = true;

    try {
      const front = this.m_selectionTool!.GetSelection().Front();
      const sheet = front instanceof SCH_SHEET ? front : null;

      if (!sheet) return 0;

      if (this.importHierLabels(sheet).length === 0) {
        // m_statusPopup "No new hierarchical labels found." for 2 s: the infobar here.
        this.m_frame!.ShowInfoBarMsg('No new hierarchical labels found.');
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view?.ClearPreview();
        return 0;
      }

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      this.autoPlaceSheetPins(sheet);
      return 0;
    } finally {
      this.m_inDrawingTool = false;
    }
  }

  /**
   * AutoPlaceAllSheetPins' body from the commit on (sch_drawing_tools.cpp:3744-3818): pins for
   * \a aSheet's unmatched hierarchical labels, outputs down the right edge and the rest down the
   * left, stacked below the pins already there, the sheet grown to fit. Returns how many.
   */
  autoPlaceSheetPins(aSheet: SCH_SHEET): number {
    const labels = this.importHierLabels(aSheet);

    if (labels.length === 0) return 0;

    const commit = this.m_toolMgr ? new SCH_COMMIT(this.m_toolMgr) : new SCH_COMMIT(this.m_frame!);
    commit.Modify(aSheet, this.m_frame!.GetScreen());

    // Vertical pitch big enough to keep pin text from touching, snapped to grid.
    const grid = schIUScale.milsToIU(50);
    const textSize = aSheet.Schematic()!.Settings().m_DefaultTextSize;
    let pitch = Math.max(Math.round(textSize * 2.0), schIUScale.milsToIU(100));
    pitch = Math.round(pitch / grid) * grid;

    const margin = pitch;
    const leftX = aSheet.GetPosition().x;
    const rightX = aSheet.GetPosition().x + aSheet.GetSize().x;
    const topY = aSheet.GetPosition().y;

    // Stack new pins below whatever is already on each edge, without moving it.
    let leftY = topY + margin - pitch;
    let rightY = topY + margin - pitch;

    for (const pin of aSheet.GetPins()) {
      if (pin.GetSide() === SHEET_SIDE.RIGHT) rightY = Math.max(rightY, pin.GetPosition().y);
      else if (pin.GetSide() === SHEET_SIDE.LEFT) leftY = Math.max(leftY, pin.GetPosition().y);
    }

    // New pins: outputs on the right edge, everything else on the left.
    const leftLabels: SCH_HIERLABEL[] = [];
    const rightLabels: SCH_HIERLABEL[] = [];

    for (const label of labels) {
      if (label.GetShape() === LABEL_FLAG_SHAPE.L_OUTPUT) rightLabels.push(label);
      else leftLabels.push(label);
    }

    // std::sort with a->GetText() < b->GetText(): wxString's operator<, a plain code-unit compare.
    const byText = (a: SCH_HIERLABEL, b: SCH_HIERLABEL) =>
      a.GetText() < b.GetText() ? -1 : a.GetText() > b.GetText() ? 1 : 0;

    leftLabels.sort(byText);
    rightLabels.sort(byText);

    // Grow the sheet if the new pins would run past the bottom edge.
    const botLeft = leftY + leftLabels.length * pitch;
    const botRight = rightY + rightLabels.length * pitch;
    const needBot = Math.max(botLeft, botRight) + margin;

    if (needBot > topY + aSheet.GetSize().y)
      aSheet.SetSize({ x: aSheet.GetSize().x, y: needBot - topY });

    const placeColumn = (aLabels: SCH_HIERLABEL[], aX: number, aStartY: number) => {
      let y = Math.round(aStartY / grid) * grid;

      for (const label of aLabels) {
        y += pitch;

        const pin = this.createNewSheetPinFromLabel(aSheet, { x: aX, y }, label);
        pin.ClearFlags(IS_NEW | IS_MOVING);
        aSheet.AddPin(pin);
        pin.AutoplaceFields(this.m_frame!.GetScreen(), AUTOPLACE_ALGO.AUTOPLACE_AUTO);
      }
    };

    placeColumn(leftLabels, leftX, leftY);
    placeColumn(rightLabels, rightX, rightY);

    commit.Push('Auto-place Sheet Pins');
    return labels.length;
  }

  SyncAllSheetsPins(_aEvent: TOOL_EVENT): number {
    const getSheetChildren = (
      aPaths: SCH_SHEET_PATH[],
      aScene: SCH_SCREEN | null,
      aVisited: Set<SCH_SCREEN>,
      aCurPath: SCH_SHEET_PATH,
    ): void => {
      if (!aScene || aVisited.has(aScene)) return;

      const sheetChildren: SCH_ITEM[] = [];
      aScene.GetSheets(sheetChildren);
      aVisited.add(aScene);

      for (const child of sheetChildren) {
        const cp = aCurPath.Clone();
        const sheet = child as SCH_SHEET;
        cp.push_back(sheet);
        aPaths.push(cp);
        getSheetChildren(aPaths, sheet.GetScreen(), aVisited, cp);
      }
    };

    const sheetPaths: SCH_SHEET_PATH[] = [];
    const visited = new Set<SCH_SCREEN>();

    // Build sheet paths for each top-level sheet (don't include virtual root in paths)
    const topLevelSheets = this.schematic().GetTopLevelSheets();

    for (const topSheet of topLevelSheets) {
      if (topSheet?.GetScreen()) {
        const current = new SCH_SHEET_PATH();
        current.push_back(topSheet);
        getSheetChildren(sheetPaths, topSheet.GetScreen(), visited, current);
      }
    }

    if (sheetPaths.length === 0) {
      this.m_frame!.ShowInfoBarMsg('No sub schematic found in the current project');
      return 0;
    }

    // If a sheet is currently selected, pre-select its tab in the dialog
    const front = this.m_selectionTool!.GetSelection().Front();
    const selectedSheet = front instanceof SCH_SHEET ? front : null;

    return this.doSyncSheetsPins(sheetPaths, selectedSheet);
  }

  /** `importHierLabel` (sch_drawing_tools.cpp:3873): the first, by name, without a pin yet. */
  importHierLabel(aSheet: SCH_SHEET): SCH_HIERLABEL | null {
    if (!aSheet.GetScreen()) return null;

    const labels = [
      ...aSheet.GetScreen()!.Items().OfType(KICAD_T.SCH_HIER_LABEL_T),
    ] as SCH_HIERLABEL[];

    labels.sort((label1, label2) => strNumCmp(label1.GetText(), label2.GetText(), true));

    for (const label of labels) {
      if (!aSheet.HasPin(label.GetText())) return label;
    }

    return null;
  }

  /** `importHierLabels` (sch_drawing_tools.cpp:3902): every one without a pin yet. */
  importHierLabels(aSheet: SCH_SHEET): SCH_HIERLABEL[] {
    if (!aSheet.GetScreen()) return [];

    const labels: SCH_HIERLABEL[] = [];

    for (const item of aSheet.GetScreen()!.Items().OfType(KICAD_T.SCH_HIER_LABEL_T)) {
      const label = item as SCH_HIERLABEL;

      if (!aSheet.HasPin(label.GetText())) labels.push(label);
    }

    return labels;
  }

  protected override setTransitions(): void {
    // clang-format off
    // ImportSheet, PlaceImage and ImportGraphics follow.
    this.Go(this.DrawShape, SCH_ACTIONS.drawRectangle.MakeEvent());
    this.Go(this.DrawShape, SCH_ACTIONS.drawCircle.MakeEvent());
    this.Go(this.DrawShape, SCH_ACTIONS.drawArc.MakeEvent());
    this.Go(this.DrawShape, SCH_ACTIONS.drawBezier.MakeEvent());
    this.Go(this.DrawShape, SCH_ACTIONS.drawTextBox.MakeEvent());
    this.Go(this.DrawRuleArea, SCH_ACTIONS.drawRuleArea.MakeEvent());
    this.Go(this.DrawTable, SCH_ACTIONS.drawTable.MakeEvent());
    this.Go(this.PlaceSymbol, SCH_ACTIONS.placeSymbol.MakeEvent());
    this.Go(this.PlaceSymbol, SCH_ACTIONS.placePower.MakeEvent());
    this.Go(SYNC_HANDLER(this.PlaceNextSymbolUnit), SCH_ACTIONS.placeNextSymbolUnit.MakeEvent());
    this.Go(this.SingleClickPlace, SCH_ACTIONS.placeNoConnect.MakeEvent());
    this.Go(this.SingleClickPlace, SCH_ACTIONS.placeJunction.MakeEvent());
    this.Go(this.SingleClickPlace, SCH_ACTIONS.placeBusWireEntry.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeLabel.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeClassLabel.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeHierLabel.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeGlobalLabel.MakeEvent());
    this.Go(this.PlaceImage, SCH_ACTIONS.placeImage.MakeEvent());
    this.Go(this.ImportSheet, SCH_ACTIONS.placeDesignBlock.MakeEvent());
    this.Go(this.ImportSheet, SCH_ACTIONS.importSheet.MakeEvent());
    this.Go(this.DrawSheet, SCH_ACTIONS.drawSheet.MakeEvent());
    this.Go(this.DrawSheet, SCH_ACTIONS.drawSheetFromFile.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeSheetPin.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeSchematicText.MakeEvent());
    this.Go(this.SyncSheetsPins, SCH_ACTIONS.syncSheetPins.MakeEvent());
    this.Go(SYNC_HANDLER(this.SyncAllSheetsPins), SCH_ACTIONS.syncAllSheetsPins.MakeEvent());
    this.Go(
      SYNC_HANDLER(this.AutoPlaceAllSheetPins),
      SCH_ACTIONS.autoplaceAllSheetPins.MakeEvent(),
    );
    // clang-format on
  }
}
