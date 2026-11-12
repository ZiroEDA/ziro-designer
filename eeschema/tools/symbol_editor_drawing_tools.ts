// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SYMBOL_EDITOR_DRAWING_TOOLS` (eeschema/tools/symbol_editor_drawing_tools.{h,cpp}): the tool
 * responsible for drawing / placing items in the symbol editor - body outlines, text boxes, pins,
 * text, the anchor - Repeat Last Item, and Import Graphics.
 */
import { type KIID, niluuid } from '@ziroeda/common/kiid.js';
import type { EDA_ITEM } from '@ziroeda/common/eda_item.js';
import { IS_MOVING, IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { FILL_T, SHAPE_T } from '@ziroeda/common/eda_shape.js';
import { type Color4d, COLOR4D_UNSPECIFIED } from '@ziroeda/common/gal/color4d.js';
import { LINE_STYLE, STROKE_PARAMS } from '@ziroeda/common/stroke_params.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { PgmOrNull } from '@ziroeda/common/pgm_base.js';
import { NoPrintableChars } from '@ziroeda/common/string_utils.js';
import { ACTIONS, type INCREMENT } from '@ziroeda/common/tool/actions.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import type { SELECTION } from '@ziroeda/common/tool/selection.js';
import { BUT_LEFT, BUT_RIGHT, MD_SHIFT, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { KICAD_T } from '@ziroeda/core/typeinfo.js';
import { ANGLE_HORIZONTAL, type EDA_ANGLE } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { toVECTOR2I, type VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { wxID_OK } from '@ziroeda/wx/menu.js';
import { wxCENTER, wxOK } from '@ziroeda/wx/defs.js';
import { GRID_HELPER_GRIDS } from '@ziroeda/common/tool/grid_helper.js';
import { SCH_SELECTION } from './sch_selection.js';
import type { LIB_SYMBOL } from '../lib_symbol.js';
import { SCH_COMMIT } from '../sch_commit.js';
import { SCH_ITEM } from '../sch_item.js';
import type { SCH_PIN } from '../sch_pin.js';
import { SCH_SHAPE } from '../sch_shape.js';
import { SCH_TEXT } from '../sch_text.js';
import { SCH_TEXTBOX } from '../sch_textbox.js';
import { currentSymbolEditorSettings } from '../symbol_editor/symbol_editor_settings.js';
import type { SYMBOL_EDIT_FRAME } from '../symbol_editor/symbol_edit_frame.js';
import { EE_GRID_HELPER } from './ee_grid_helper.js';
import { SCH_ACTIONS } from './sch_actions.js';
import { SCH_TOOL_BASE } from './sch_tool_base.js';
import { SYMBOL_EDITOR_PIN_TOOL } from './symbol_editor_pin_tool.js';
import type { IMPORT_GFX_RESULT } from '../import_gfx/dialog_import_gfx_sch.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

export class SYMBOL_EDITOR_DRAWING_TOOLS extends SCH_TOOL_BASE<SYMBOL_EDIT_FRAME> {
  private m_lastTextBold = false;
  private m_lastTextItalic = false;
  private m_lastTextAngle: EDA_ANGLE = ANGLE_HORIZONTAL;
  private m_lastTextJust = GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_LEFT;
  private m_lastFillStyle = FILL_T.NO_FILL;
  private m_lastFillColor: Color4d = COLOR4D_UNSPECIFIED;
  private m_lastStroke = new STROKE_PARAMS(0, LINE_STYLE.DEFAULT, COLOR4D_UNSPECIFIED);
  private m_drawSpecificBodyStyle = true;
  private m_drawSpecificUnit = false;

  ///< Re-entrancy guards
  private m_inDrawShape = false;
  private m_inPlaceAnchor = false;
  private m_inTwoClickPlace = false;

  /** `g_lastPin`: the pin Repeat Last Item repeats. */
  static g_lastPin: KIID = niluuid;

  constructor() {
    super('eeschema.SymbolDrawing');
  }

  override Init(): boolean {
    super.Init();

    const isDrawingCondition = (aSel: SELECTION): boolean => {
      const item = aSel.Front();
      return item instanceof SCH_ITEM && item.IsNew();
    };

    this.m_menu.GetMenu().AddItem(ACTIONS.finishInteractive, isDrawingCondition, 2);

    return true;
  }

  SetLastTextAngle(aAngle: EDA_ANGLE): void {
    this.m_lastTextAngle = aAngle;
  }

  GetLastTextAngle(): EDA_ANGLE {
    return this.m_lastTextAngle;
  }

  SetDrawSpecificBodyStyle(aSpecific: boolean): void {
    this.m_drawSpecificBodyStyle = aSpecific;
  }

  GetDrawSpecificBodyStyle(): boolean {
    return this.m_drawSpecificBodyStyle;
  }

  SetDrawSpecificUnit(aSpecific: boolean): void {
    this.m_drawSpecificUnit = aSpecific;
  }

  GetDrawSpecificUnit(): boolean {
    return this.m_drawSpecificUnit;
  }

  *TwoClickPlace(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const type = aEvent.Parameter<KICAD_T>();
    const cfg = currentSymbolEditorSettings();
    const pinTool =
      type === KICAD_T.SCH_PIN_T ? this.m_toolMgr!.GetTool(SYMBOL_EDITOR_PIN_TOOL) : null;

    if (this.m_inTwoClickPlace) return 0;

    // REENTRANCY_GUARD guard( &m_inTwoClickPlace )
    this.m_inTwoClickPlace = true;

    try {
      const frame = this.m_frame!;
      const controls = this.controls();
      const grid = new EE_GRID_HELPER(this.m_toolMgr!);
      let cursorPos: VECTOR2I = { x: 0, y: 0 };
      let ignorePrimePosition = false;
      let item: SCH_ITEM | null = null;
      const isText = aEvent.IsAction(SCH_ACTIONS.placeSymbolText);
      const common_settings = PgmOrNull()?.GetCommonSettings() ?? null;

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      frame.PushTool(aEvent);

      const setCursor = (): void => {
        if (item) frame.GetCanvas()!.SetCurrentCursor(KICURSOR.PLACE);
        else if (isText) frame.GetCanvas()!.SetCurrentCursor(KICURSOR.TEXT);
        else frame.GetCanvas()!.SetCurrentCursor(KICURSOR.PENCIL);
      };

      const cleanup = (): void => {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);
        this.m_view!.ClearPreview();
        item = null;
      };

      this.Activate();
      // Must be done after Activate() so that it gets set into the correct context
      controls.ShowCursor(true);
      // Set initial cursor
      setCursor();

      if (aEvent.HasPosition()) {
        this.m_toolMgr!.PrimeTool(aEvent.Position());
      } else if ((common_settings?.m_Input.immediate_actions ?? true) && !aEvent.IsReactivate()) {
        this.m_toolMgr!.PrimeTool({ x: 0, y: 0 });
        ignorePrimePosition = true;
      }

      const commit = new SCH_COMMIT(this.m_toolMgr!);

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();
        grid.SetSnap(!evt.Modifier(MD_SHIFT));
        grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

        cursorPos = grid.Align(controls.GetMousePosition(), grid.GetItemGrid(item));
        controls.ForceCursorPosition(true, cursorPos);

        // The tool hotkey is interpreted as a click when drawing
        const isSyntheticClick =
          !!item && evt.IsActivate() && evt.HasPosition() && evt.Matches(aEvent);

        if (evt.IsCancelInteractive()) {
          frame.GetInfoBar()?.Dismiss();

          if (item) {
            cleanup();
          } else {
            frame.PopTool(aEvent);
            break;
          }
        } else if (evt.IsActivate() && !isSyntheticClick) {
          if (item && evt.IsMoveTool()) {
            // we're already moving our own item; ignore the move tool
            evt.SetPassEvent(false);
            continue;
          }

          if (item) {
            frame.ShowInfoBarMsg(_('Press <ESC> to cancel item creation.'));
            evt.SetPassEvent(false);
            continue;
          }

          if (evt.IsPointEditor()) {
            // don't exit (the point editor runs in the background)
          } else if (evt.IsMoveTool()) {
            break;
          } else {
            frame.PopTool(aEvent);
            break;
          }
        } else if (evt.IsClick(BUT_LEFT) || evt.IsDblClick(BUT_LEFT) || isSyntheticClick) {
          const symbol = frame.GetCurSymbol();

          if (!symbol) continue;

          // First click creates...
          if (!item) {
            this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

            switch (type) {
              case KICAD_T.SCH_PIN_T: {
                item = yield* pinTool!.CreatePin(cursorPos, symbol, this);

                if (item) SYMBOL_EDITOR_DRAWING_TOOLS.g_lastPin = item.m_Uuid;

                break;
              }

              case KICAD_T.SCH_TEXT_T: {
                const text = new SCH_TEXT(cursorPos, '', SCH_LAYER_ID.LAYER_DEVICE);

                text.SetParent(symbol);

                if (this.m_drawSpecificUnit) text.SetUnit(frame.GetUnit());

                if (this.m_drawSpecificBodyStyle) text.SetBodyStyle(frame.GetBodyStyle());

                const size = schIUScale.milsToIU(cfg.defaults.text_size);
                text.SetTextSize({ x: size, y: size });

                text.SetTextAngle(this.m_lastTextAngle);

                // DIALOG_TEXT_PROPERTIES dlg( m_frame, text ): the window's.
                const ret = yield* this.RunMainStackModal(() =>
                  frame.ShowModalDialog('DIALOG_TEXT_PROPERTIES', [text]),
                );

                if (ret === wxID_OK && !NoPrintableChars(text.GetText())) item = text;

                break;
              }

              default:
                console.assert(false, 'TwoClickPlace(): unknown type');
            }

            // If we started with a hotkey which has a position then warp back to that.
            // Otherwise update to the current mouse position pinned inside the autoscroll
            // boundaries.
            if (evt.IsPrime() && !ignorePrimePosition) {
              cursorPos = grid.Align(toVECTOR2I(evt.Position()), grid.GetItemGrid(item));
              controls.WarpMouseCursor(cursorPos, true);
            } else {
              controls.PinCursorInsideNonAutoscrollArea(true);
              cursorPos = grid.Align(controls.GetMousePosition(), grid.GetItemGrid(item));
            }

            if (item) {
              item.SetPosition({ x: cursorPos.x, y: -cursorPos.y });

              item.SetFlags(IS_NEW | IS_MOVING);
              this.m_view!.ClearPreview();
              this.m_view!.AddToPreview(item, false);
              this.m_selectionTool!.AddItemToSel(item);

              // update the cursor so it looks correct before another event
              setCursor();
            }

            if (frame.GetMoveWarpsCursor()) controls.SetCursorPosition(cursorPos, false);

            this.m_toolMgr!.PostAction(ACTIONS.refreshPreview);
          }
          // ... and second click places:
          else {
            commit.Modify(symbol, frame.GetScreen());

            switch (item.Type()) {
              case KICAD_T.SCH_PIN_T:
                yield* pinTool!.PlacePin(commit, item as SCH_PIN, this);
                item.ClearEditFlags();
                commit.Push(_('Place Pin'));
                break;

              case KICAD_T.SCH_TEXT_T:
                symbol.AddDrawItem(item as SCH_TEXT);
                item.ClearEditFlags();
                commit.Push(_('Draw Text'));
                break;

              default:
                console.assert(false, 'TwoClickPlace(): unknown type');
            }

            item = null;
            this.m_view!.ClearPreview();
            frame.RebuildView();
          }
        } else if (evt.IsClick(BUT_RIGHT)) {
          // Warp after context menu only if dragging...
          if (!item) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else if (evt.IsAction(ACTIONS.increment)) {
          const param: INCREMENT = evt.HasParameter()
            ? evt.Parameter<INCREMENT>()
            : { Delta: 1, Index: 0 };

          yield* this.RunSynchronousActionWait(ACTIONS.increment, commit, param);
        } else if (item && (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion())) {
          item.SetPosition({ x: cursorPos.x, y: cursorPos.y });
          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(item, false);
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
      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
      return 0;
    } finally {
      this.m_inTwoClickPlace = false;
    }
  }

  *DrawShape(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const requestedShape = aEvent.Parameter<SHAPE_T>();

    return yield* this.doDrawShape(aEvent, requestedShape);
  }

  *DrawSymbolTextBox(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    return yield* this.doDrawShape(aEvent, null /* Draw text box */);
  }

  private *doDrawShape(aEvent: TOOL_EVENT, aDrawingShape: SHAPE_T | null): COROUTINE_BODY<number> {
    const isTextBox = aDrawingShape === null;
    const toolType = aDrawingShape ?? SHAPE_T.SEGMENT;

    const controls = this.controls();
    const cfg = currentSymbolEditorSettings();
    const grid = new EE_GRID_HELPER(this.m_toolMgr!);
    let cursorPos: VECTOR2I = { x: 0, y: 0 };
    const shapeType = toolType === SHAPE_T.SEGMENT ? SHAPE_T.POLY : toolType;
    const frame = this.m_frame!;
    let symbol: LIB_SYMBOL | null = frame.GetCurSymbol();
    let item: SCH_SHAPE | null = null;
    let description = '';

    if (this.m_inDrawShape) return 0;

    // REENTRANCY_GUARD guard( &m_inDrawShape )
    this.m_inDrawShape = true;

    try {
      // We might be running as the same shape in another co-routine.  Make sure that one
      // gets whacked.
      this.m_toolMgr!.DeactivateTool();

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      frame.PushTool(aEvent);

      const setCursor = (): void => {
        frame.GetCanvas()!.SetCurrentCursor(KICURSOR.PENCIL);
      };

      const cleanup = (): void => {
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

        cursorPos = grid.Align(controls.GetMousePosition(), grid.GetItemGrid(item));
        controls.ForceCursorPosition(true, cursorPos);

        // The tool hotkey is interpreted as a click when drawing
        const isSyntheticClick =
          !!item && evt.IsActivate() && evt.HasPosition() && evt.Matches(aEvent);

        if (evt.IsCancelInteractive()) {
          if (item) {
            cleanup();
          } else {
            frame.PopTool(aEvent);
            break;
          }
        } else if (evt.IsActivate() && !isSyntheticClick) {
          if (item) cleanup();

          if (evt.IsPointEditor()) {
            // don't exit (the point editor runs in the background)
          } else if (evt.IsMoveTool()) {
            // leave ourselves on the stack so we come back after the move
            break;
          } else {
            frame.PopTool(aEvent);
            break;
          }
        } else if (evt.IsClick(BUT_LEFT) && !item) {
          // Update in case the symbol was changed while the tool was running
          symbol = frame.GetCurSymbol();

          if (!symbol) continue;

          this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

          const lineWidth = schIUScale.milsToIU(cfg.defaults.line_width);

          if (isTextBox) {
            const textbox = new SCH_TEXTBOX(
              SCH_LAYER_ID.LAYER_DEVICE,
              lineWidth,
              this.m_lastFillStyle,
            );

            textbox.SetParent(symbol);

            const size = schIUScale.milsToIU(cfg.defaults.text_size);
            textbox.SetTextSize({ x: size, y: size });

            // Must be after SetTextSize()
            textbox.SetBold(this.m_lastTextBold);
            textbox.SetItalic(this.m_lastTextItalic);

            textbox.SetTextAngle(this.m_lastTextAngle);
            textbox.SetHorizJustify(this.m_lastTextJust);

            item = textbox;
            description = _('Add Text Box');
          } else {
            item = new SCH_SHAPE(
              shapeType,
              SCH_LAYER_ID.LAYER_DEVICE,
              lineWidth,
              this.m_lastFillStyle,
            );
            item.SetParent(symbol);
            description = wxFormat(_('Add %s'), item.GetFriendlyName());
          }

          item.SetStroke(this.m_lastStroke);
          item.SetFillColor(this.m_lastFillColor);

          item.SetFlags(IS_NEW);
          item.BeginEdit(cursorPos);

          if (this.m_drawSpecificUnit) item.SetUnit(frame.GetUnit());

          if (this.m_drawSpecificBodyStyle) item.SetBodyStyle(frame.GetBodyStyle());

          this.m_selectionTool!.AddItemToSel(item);
        } else if (
          item &&
          (evt.IsClick(BUT_LEFT) ||
            evt.IsDblClick(BUT_LEFT) ||
            isSyntheticClick ||
            evt.IsAction(ACTIONS.finishInteractive))
        ) {
          const drawn: SCH_SHAPE = item;

          if (symbol !== frame.GetCurSymbol()) {
            symbol = frame.GetCurSymbol();
            drawn.SetParent(symbol);
          }

          if (
            evt.IsDblClick(BUT_LEFT) ||
            evt.IsAction(ACTIONS.finishInteractive) ||
            !drawn.ContinueEdit({ x: cursorPos.x, y: cursorPos.y })
          ) {
            if (toolType === SHAPE_T.POLY) {
              drawn.CalcEdit(drawn.GetPosition()); // Close shape
              drawn.EndEdit(true);
            } else {
              drawn.EndEdit();
            }

            drawn.ClearEditFlags();

            if (isTextBox) {
              const textbox = drawn as SCH_TEXTBOX;

              // DIALOG_TEXT_PROPERTIES: QuasiModal required for syntax help and Scintilla
              // auto-complete. The window's.
              if (
                (yield* this.RunMainStackModal(() =>
                  frame.ShowModalDialog('DIALOG_TEXT_PROPERTIES', [textbox]),
                )) !== wxID_OK
              ) {
                cleanup();
                continue;
              }

              this.m_lastTextBold = textbox.IsBold();
              this.m_lastTextItalic = textbox.IsItalic();
              this.m_lastTextAngle = textbox.GetTextAngle();
              this.m_lastTextJust = textbox.GetHorizJustify();
            }

            this.m_lastStroke = drawn.GetStroke();
            this.m_lastFillStyle = drawn.GetFillMode();
            this.m_lastFillColor = drawn.GetFillColor();

            this.m_view!.ClearPreview();

            const commit = new SCH_COMMIT(this.m_toolMgr!);
            commit.Modify(symbol!, frame.GetScreen());

            symbol!.AddDrawItem(drawn);
            item = null;

            commit.Push(description);
            frame.RebuildView();
            this.m_toolMgr!.PostAction(ACTIONS.activatePointEditor);
          }
        } else if (item && (evt.IsAction(ACTIONS.refreshPreview) || evt.IsMotion())) {
          item.CalcEdit(cursorPos);
          this.m_view!.ClearPreview();
          this.m_view!.AddToPreview(item.Clone());
        } else if (evt.IsDblClick(BUT_LEFT) && !item) {
          this.m_toolMgr!.RunAction(SCH_ACTIONS.properties);
        } else if (evt.IsClick(BUT_RIGHT)) {
          // Warp after context menu only if dragging...
          if (!item) this.m_toolMgr!.VetoContextMenuMouseWarp();

          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else {
          evt.SetPassEvent();
        }

        // Enable autopanning and cursor capture only when there is a shape being drawn
        controls.SetAutoPan(item !== null);
        controls.CaptureCursor(item !== null);
      }

      controls.SetAutoPan(false);
      controls.CaptureCursor(false);
      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
      return 0;
    } finally {
      this.m_inDrawShape = false;
    }
  }

  *PlaceAnchor(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    if (this.m_inPlaceAnchor) return 0;

    // REENTRANCY_GUARD guard( &m_inPlaceAnchor )
    this.m_inPlaceAnchor = true;

    try {
      const frame = this.m_frame!;
      frame.PushTool(aEvent);

      const setCursor = (): void => {
        frame.GetCanvas()!.SetCurrentCursor(KICURSOR.BULLSEYE);
      };

      this.Activate();
      // Must be done after Activate() so that it gets set into the correct context
      this.controls().ShowCursor(true);
      // Set initial cursor
      setCursor();

      // Main loop: keep receiving events
      for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
        setCursor();

        if (evt.IsCancelInteractive()) {
          frame.PopTool(aEvent);
          break;
        } else if (evt.IsActivate()) {
          frame.PopTool(aEvent);
          break;
        } else if (evt.IsClick(BUT_LEFT) || evt.IsDblClick(BUT_LEFT)) {
          const symbol = frame.GetCurSymbol();

          if (!symbol) continue;

          const cursorPos = this.controls().GetCursorPosition(!evt.DisableGridSnapping());

          symbol.Move({ x: -cursorPos.x, y: -cursorPos.y });

          // Refresh the view without changing the viewport
          const center = this.m_view!.GetCenter();
          this.m_view!.SetCenter({ x: center.x + cursorPos.x, y: center.y + cursorPos.y });
          this.m_view!.RecacheAllItems();
          frame.OnModify();
        } else if (evt.IsClick(BUT_RIGHT)) {
          this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
        } else {
          evt.SetPassEvent();
        }
      }

      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
      return 0;
    } finally {
      this.m_inPlaceAnchor = false;
    }
  }

  /**
   * `ImportGraphics( aEvent )` (symbol_editor_drawing_tools.cpp): DIALOG_IMPORT_GFX_SCH's items
   * added to the symbol at once, or carried on the cursor and dropped with a click.
   */
  *ImportGraphics(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const frame = this.m_frame!;
    const symbol = frame.GetCurSymbol();

    if (!symbol) return 0;

    // DIALOG_IMPORT_GFX_SCH dlg( m_frame ): the window's; it fills the result on OK.
    const dlg: IMPORT_GFX_RESULT = { items: [], interactive: true };
    const dlgResult = yield* this.RunMainStackModal(() =>
      frame.ShowModalDialog('DIALOG_IMPORT_GFX_SCH', [], dlg),
    );

    const list = dlg.items;

    if (dlgResult !== wxID_OK) return 0;

    // Ensure the list is not empty:
    if (list.length === 0) {
      yield* this.RunMainStackModal(() =>
        frame.ShowModalDialog('wxMessageBox', [], {
          message: _('No graphic items found in file.'),
          caption: 'Message',
          style: wxOK | wxCENTER,
        }),
      );
      return 0;
    }

    this.m_toolMgr!.RunAction(ACTIONS.cancelInteractive);

    const controls = this.controls();
    const newItems: SCH_ITEM[] = []; // all new items, including group
    const selectedItems: SCH_ITEM[] = []; // the group, or newItems if no group
    const preview = new SCH_SELECTION();
    const commit = new SCH_COMMIT(this.m_toolMgr!);

    for (const item of list) {
      newItems.push(item);
      selectedItems.push(item);
      preview.Add(item);
    }

    if (!dlg.interactive) {
      commit.Modify(symbol, frame.GetScreen());

      // Place the imported drawings
      for (const item of newItems) {
        symbol.AddDrawItem(item);
        item.ClearEditFlags();
      }

      commit.Push(_('Import Graphic'));
      frame.RebuildView();

      return 0;
    }

    this.m_view!.Add(preview);

    // Clear the current selection then select the drawings so that edit tools work on them
    this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

    const selItems: EDA_ITEM[] = [...selectedItems];
    this.m_toolMgr!.RunAction(ACTIONS.selectItems, selItems);

    frame.PushTool(aEvent);

    const setCursor = (): void => {
      frame.GetCanvas()!.SetCurrentCursor(KICURSOR.MOVING);
    };

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    controls.ForceCursorPosition(false);
    // Set initial cursor
    setCursor();

    const grid = new EE_GRID_HELPER(this.m_toolMgr!);

    // Now move the new items to the current cursor position:
    let cursorPos = controls.GetCursorPosition(!aEvent.DisableGridSnapping());
    let delta = cursorPos;
    const currentOffset = { x: 0, y: 0 };

    for (const item of selectedItems) item.Move(delta);

    currentOffset.x += delta.x;
    currentOffset.y += delta.y;

    this.m_view!.Update(preview);

    // Main loop: keep receiving events
    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();

      grid.SetSnap(!evt.Modifier(MD_SHIFT));
      grid.SetUseGrid(this.getView()!.GetGAL()!.GetGridSnapping() && !evt.DisableGridSnapping());

      cursorPos = grid.Align(controls.GetMousePosition(), GRID_HELPER_GRIDS.GRID_GRAPHICS);
      controls.ForceCursorPosition(true, cursorPos);

      if (evt.IsCancelInteractive() || evt.IsActivate()) {
        this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

        // `delete item`: the items were never added to anything.
        break;
      } else if (evt.IsMotion()) {
        delta = { x: cursorPos.x - currentOffset.x, y: cursorPos.y - currentOffset.y };

        for (const item of selectedItems) item.Move(delta);

        currentOffset.x += delta.x;
        currentOffset.y += delta.y;

        this.m_view!.Update(preview);
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_menu.ShowContextMenu(this.m_selectionTool!.GetSelection());
      } else if (evt.IsClick(BUT_LEFT) || evt.IsDblClick(BUT_LEFT)) {
        commit.Modify(symbol, frame.GetScreen());

        // Place the imported drawings
        for (const item of newItems) {
          symbol.AddDrawItem(item);
          item.ClearEditFlags();
        }

        commit.Push(_('Import Graphic'));
        break; // This is a one-shot command, not a tool
      } else {
        evt.SetPassEvent();
      }
    }

    preview.Clear();
    this.m_view!.Remove(preview);

    frame.RebuildView();

    frame.GetCanvas()!.SetCurrentCursor(KICURSOR.ARROW);
    controls.ForceCursorPosition(false);

    frame.PopTool(aEvent);

    return 0;
  }

  *RepeatDrawItem(_aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const pinTool = this.m_toolMgr!.GetTool(SYMBOL_EDITOR_PIN_TOOL)!;
    const symbol: LIB_SYMBOL | null = this.m_frame!.GetCurSymbol();
    let sourcePin: SCH_PIN | null = null;

    if (!symbol) return 0;

    for (const test of symbol.GetPins()) {
      if (test.m_Uuid === SYMBOL_EDITOR_DRAWING_TOOLS.g_lastPin) {
        sourcePin = test;
        break;
      }
    }

    if (sourcePin) {
      const pin = yield* pinTool.RepeatPin(sourcePin, this);

      if (pin) SYMBOL_EDITOR_DRAWING_TOOLS.g_lastPin = pin.m_Uuid;

      this.m_toolMgr!.RunAction(ACTIONS.selectionClear);

      if (pin) this.m_toolMgr!.RunAction<EDA_ITEM>(ACTIONS.selectItem, pin);
    }

    return 0;
  }

  /** `getViewControls()`, with the VIEW_CONTROLS methods the TOOL_MANAGER's interface leaves out. */
  private controls(): VIEW_CONTROLS {
    return this.getViewControls() as unknown as VIEW_CONTROLS;
  }

  protected override setTransitions(): void {
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeSymbolPin.MakeEvent());
    this.Go(this.TwoClickPlace, SCH_ACTIONS.placeSymbolText.MakeEvent());
    this.Go(this.DrawShape, SCH_ACTIONS.drawRectangle.MakeEvent());
    this.Go(this.DrawShape, SCH_ACTIONS.drawCircle.MakeEvent());
    this.Go(this.DrawShape, SCH_ACTIONS.drawArc.MakeEvent());
    this.Go(this.DrawShape, SCH_ACTIONS.drawBezier.MakeEvent());
    this.Go(this.DrawShape, SCH_ACTIONS.drawSymbolLines.MakeEvent());
    this.Go(this.DrawShape, SCH_ACTIONS.drawSymbolPolygon.MakeEvent());
    this.Go(this.DrawSymbolTextBox, SCH_ACTIONS.drawSymbolTextBox.MakeEvent());
    this.Go(this.PlaceAnchor, SCH_ACTIONS.placeSymbolAnchor.MakeEvent());
    this.Go(this.ImportGraphics, SCH_ACTIONS.importGraphics.MakeEvent());
    this.Go(this.RepeatDrawItem, SCH_ACTIONS.repeatDrawItem.MakeEvent());
  }
}
