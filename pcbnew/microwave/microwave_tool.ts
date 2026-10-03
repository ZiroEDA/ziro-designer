// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `MICROWAVE_TOOL` - `pcbnew/microwave/microwave_tool.{h,cpp}`: adds microwave
 * features (gap, stub, arc stub, polygonal shape, S-shaped inductor) to a board.
 *
 * The C++ splits the class over four .cpp files; the generators are functions
 * in `microwave_footprint.ts`, `microwave_polygon.ts` and `microwave_inductor.ts`
 * over {@link MICROWAVE_HOST}, which is what the C++ asks its `PCB_EDIT_FRAME`
 * for (the dialogs, the current track width, unit conversion, a new blank
 * footprint, the commit). The dialogs are awaited here, so a generator is a
 * Promise, run from the tool's coroutine through `RunMainStackModal`.
 */
import { BUT_LEFT, BUT_RIGHT, type TOOL_EVENT } from '@ziroeda/common/tool/tool_event.js';
import type { COROUTINE_BODY } from '@ziroeda/common/tool/coroutine.js';
import { KICURSOR } from '@ziroeda/common/gal/cursors.js';
import type { Color4d } from '@ziroeda/common/gal/color4d.js';
import { VIEW_UPDATE_FLAGS } from '@ziroeda/common/view/view_item.js';
import type { VIEW_CONTROLS } from '@ziroeda/common/view/view_controls.js';
import { CENTRELINE_RECT_ITEM } from '@ziroeda/common/preview_items/centreline_rect_item.js';
import { TWO_POINT_GEOMETRY_MANAGER } from '@ziroeda/common/preview_items/two_point_geom_manager.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { wxTextValidator } from '@ziroeda/common/validators.js';
import type { BOARD_ITEM } from '../board_item.js';
import type { FOOTPRINT } from '../footprint.js';
import { MICROWAVE_FOOTPRINT_SHAPE, PCB_ACTIONS } from '../tools/pcb_actions.js';
import {
  INTERACTIVE_PLACEMENT_OPTIONS,
  INTERACTIVE_PLACER_BASE,
  PCB_TOOL_BASE,
} from '../tools/pcb_tool_base.js';
import { createBaseFootprint, createFootprint } from './microwave_footprint.js';
import { createInductorBetween, createMicrowaveInductor } from './microwave_inductor.js';
import { createPolygonShape } from './microwave_polygon.js';

export { MICROWAVE_FOOTPRINT_SHAPE };

/** `MICROWAVE_INDUCTOR_PATTERN`: parameters for construction of a microwave inductor. */
export interface MICROWAVE_INDUCTOR_PATTERN {
  m_Start: VECTOR2I;
  m_End: VECTOR2I;
  /** full length trace. */
  m_Length: number;
  /** Trace width. */
  m_Width: number;
}

/** What the microwave generators ask their `PCB_EDIT_FRAME` for. */
export interface MICROWAVE_HOST {
  /** `GetDesignSettings().GetCurrentTrackWidth()`. */
  GetCurrentTrackWidth(): number;
  /** `PCB_BASE_FRAME::StringFromValue( aIU )`. */
  StringFromValue(aIU: number): string;
  /** `PCB_BASE_FRAME::ValueFromString( aText )`. */
  ValueFromString(aText: string): number;
  /** `PCB_EDIT_FRAME::CreateNewFootprint( aName, aLib )`. */
  CreateNewFootprint(aName: string, aLib: string): FOOTPRINT;
  /** `PCB_BASE_FRAME::OnModify`. */
  OnModify(): void;
  /** `EDA_BASE_FRAME::ShowInfoBarError`. */
  ShowInfoBarError(aMessage: string): void;
  /** `DisplayError( frame, msg )`. */
  DisplayError(aMessage: string): void;
  /** `WX_TEXT_ENTRY_DIALOG( frame, prompt, caption, value )`; null on cancel. */
  TextEntry(
    aPrompt: string,
    aCaption: string,
    aValue: string,
    aValidator?: wxTextValidator,
  ): Promise<string | null>;
  /**
   * `MWAVE_POLYGONAL_SHAPE_DLG::ShowModal`: true on OK. It leaves its choices in
   * `g_MwaveShape` / `g_PolyEdges` (microwave_polygon.ts), as the C++ leaves
   * them in its statics.
   */
  PolygonShapeDialog(): Promise<boolean>;
  /**
   * `createInductorBetween`'s tail: select the footprint, `commit.Add`, and
   * `commit.Push( _( "Add Microwave Inductor" ) )`.
   */
  AddInductor(aFootprint: FOOTPRINT): void;
}

/** The frame a MICROWAVE_TOOL runs in hosts its generators. */
interface MICROWAVE_FRAME {
  MicrowaveHost(): MICROWAVE_HOST;
}

// [data] microwave_tool.cpp:120-126
const inductorAreaFill: Color4d = { r: 0.3, g: 0.3, b: 0.5, a: 0.3 };
const inductorAreaStroke: Color4d = { r: 0.4, g: 1.0, b: 1.0, a: 1.0 };
const inductorAreaStrokeWidth = 1.0;

///< Aspect of the preview rectangle - this is hardcoded in the
///< microwave backend for now
const inductorAreaAspect = 0.5;

export class MICROWAVE_TOOL extends PCB_TOOL_BASE {
  static readonly NAME = 'pcbnew.MicrowaveTool';

  /** @param aHost the generators' host; by default the frame the tool runs in. */
  constructor(private readonly m_host: MICROWAVE_HOST | null = null) {
    super(MICROWAVE_TOOL.NAME);
  }

  private host(): MICROWAVE_HOST {
    return this.m_host ?? this.frame<MICROWAVE_FRAME>().MicrowaveHost();
  }

  /** `addMicrowaveFootprint` (microwave_tool.cpp:56-104). */
  *addMicrowaveFootprint(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const tool = this;
    const itemType = aEvent.Parameter<MICROWAVE_FOOTPRINT_SHAPE>();

    class MICROWAVE_PLACER extends INTERACTIVE_PLACER_BASE {
      override CreateItem(): COROUTINE_BODY<BOARD_ITEM | null> {
        return tool.RunMainStackModal(() => tool.createMicrowaveFeature(itemType));
      }
    }

    yield* this.doInteractiveItemPlacement(
      aEvent,
      new MICROWAVE_PLACER(),
      'Place microwave feature',
      INTERACTIVE_PLACEMENT_OPTIONS.IPO_REPEAT |
        INTERACTIVE_PLACEMENT_OPTIONS.IPO_ROTATE |
        INTERACTIVE_PLACEMENT_OPTIONS.IPO_FLIP,
    );

    return 0;
  }

  /**
   * `MICROWAVE_PLACER::CreateItem`: the footprint the placement then rides on
   * the cursor, or null when the user cancelled a dialog.
   */
  async createMicrowaveFeature(aType: MICROWAVE_FOOTPRINT_SHAPE): Promise<FOOTPRINT | null> {
    switch (aType) {
      case MICROWAVE_FOOTPRINT_SHAPE.GAP:
      case MICROWAVE_FOOTPRINT_SHAPE.STUB:
      case MICROWAVE_FOOTPRINT_SHAPE.STUB_ARC:
        return this.createFootprint(aType);

      case MICROWAVE_FOOTPRINT_SHAPE.FUNCTION_SHAPE:
        return this.createPolygonShape();

      default:
        return null;
    }
  }

  /** `drawMicrowaveInductor` (microwave_tool.cpp:109-238): the two-click rectangle. */
  *drawMicrowaveInductor(aEvent: TOOL_EVENT): COROUTINE_BODY<number> {
    const view = this.getView()!;
    const controls = this.getViewControls() as unknown as VIEW_CONTROLS;
    const frame = this.frame();

    frame.PushTool(aEvent);

    const setCursor = (): void => {
      frame.GetCanvas()?.SetCurrentCursor(KICURSOR.PENCIL);
    };

    this.Activate();
    // Must be done after Activate() so that it gets set into the correct context
    controls.ShowCursor(true);
    controls.CaptureCursor(false);
    controls.SetAutoPan(false);
    // Set initial cursor
    setCursor();

    let originSet = false;
    const tpGeomMgr = new TWO_POINT_GEOMETRY_MANAGER();
    const previewRect = new CENTRELINE_RECT_ITEM(tpGeomMgr, inductorAreaAspect);

    previewRect.SetFillColor(inductorAreaFill);
    previewRect.SetStrokeColor(inductorAreaStroke);
    previewRect.SetLineWidth(inductorAreaStrokeWidth);
    view.Add(previewRect);

    for (let evt = yield* this.Wait(); evt; evt = yield* this.Wait()) {
      setCursor();
      const cursorPos = controls.GetCursorPosition();

      const cleanup = (): void => {
        originSet = false;
        controls.CaptureCursor(false);
        controls.SetAutoPan(false);
        view.SetVisible(previewRect, false);
        view.Update(previewRect, VIEW_UPDATE_FLAGS.GEOMETRY);
      };

      if (evt.IsCancelInteractive()) {
        if (originSet) {
          cleanup();
        } else {
          frame.PopTool(aEvent);
          break;
        }
      } else if (evt.IsActivate()) {
        if (originSet) cleanup();

        if (evt.IsMoveTool()) {
          // leave ourselves on the stack so we come back after the move
          break;
        } else {
          frame.PopTool(aEvent);
          break;
        }
      }
      // A click or drag starts
      else if (!originSet && (evt.IsClick(BUT_LEFT) || evt.IsDrag(BUT_LEFT))) {
        tpGeomMgr.SetOrigin(cursorPos);
        tpGeomMgr.SetEnd(cursorPos);

        originSet = true;
        controls.CaptureCursor(true);
        controls.SetAutoPan(true);
      }
      // another click after origin set is the end
      // left up is also the end, as you'll only get that after a drag
      else if (originSet && (evt.IsClick(BUT_LEFT) || evt.IsMouseUp(BUT_LEFT))) {
        // second click, we're done:
        // delegate to the point-to-point inductor creator function
        const origin = tpGeomMgr.GetOrigin();
        const end = tpGeomMgr.GetEnd();

        yield* this.RunMainStackModal(() =>
          this.createInductorBetween(
            { x: Math.round(origin.x), y: Math.round(origin.y) },
            { x: Math.round(end.x), y: Math.round(end.y) },
          ),
        );

        // start again if needed
        originSet = false;
        controls.CaptureCursor(false);
        controls.SetAutoPan(false);

        view.SetVisible(previewRect, false);
        view.Update(previewRect, VIEW_UPDATE_FLAGS.GEOMETRY);
      }
      // any move or drag once the origin was set updates
      // the end point
      else if (originSet && (evt.IsMotion() || evt.IsDrag(BUT_LEFT))) {
        tpGeomMgr.SetAngleSnap(this.GetAngleSnapMode());
        tpGeomMgr.SetEnd(cursorPos);

        view.SetVisible(previewRect, true);
        view.Update(previewRect, VIEW_UPDATE_FLAGS.GEOMETRY);
      } else if (evt.IsClick(BUT_RIGHT)) {
        this.m_menu.ShowContextMenu(this.selection());
      } else {
        evt.SetPassEvent();
      }
    }

    view.Remove(previewRect);

    frame.GetCanvas()?.SetCurrentCursor(KICURSOR.ARROW);
    controls.CaptureCursor(false);
    controls.SetAutoPan(false);
    return 0;
  }

  /** `createInductorBetween` (microwave_inductor.cpp). */
  createInductorBetween(aStart: VECTOR2I, aEnd: VECTOR2I): Promise<void> {
    return createInductorBetween(this.host(), aStart, aEnd);
  }

  createFootprint(aShape: MICROWAVE_FOOTPRINT_SHAPE): Promise<FOOTPRINT | null> {
    return createFootprint(this.host(), aShape);
  }

  createPolygonShape(): Promise<FOOTPRINT | null> {
    return createPolygonShape(this.host());
  }

  createMicrowaveInductor(aPattern: MICROWAVE_INDUCTOR_PATTERN) {
    return createMicrowaveInductor(this.host(), aPattern);
  }

  createBaseFootprint(aValue: string, aTextSize: number, aPadCount: number): FOOTPRINT {
    return createBaseFootprint(this.host(), aValue, aTextSize, aPadCount);
  }

  protected override setTransitions(): void {
    this.Go(this.addMicrowaveFootprint, PCB_ACTIONS.microwaveCreateGap.MakeEvent());
    this.Go(this.addMicrowaveFootprint, PCB_ACTIONS.microwaveCreateStub.MakeEvent());
    this.Go(this.addMicrowaveFootprint, PCB_ACTIONS.microwaveCreateStubArc.MakeEvent());
    this.Go(this.addMicrowaveFootprint, PCB_ACTIONS.microwaveCreateFunctionShape.MakeEvent());

    this.Go(this.drawMicrowaveInductor, PCB_ACTIONS.microwaveCreateLine.MakeEvent());
  }
}
