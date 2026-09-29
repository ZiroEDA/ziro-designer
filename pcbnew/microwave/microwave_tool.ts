// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `MICROWAVE_TOOL` - `pcbnew/microwave/microwave_tool.{h,cpp}`: adds microwave
 * features (gap, stub, arc stub, polygonal shape, S-shaped inductor) to a board.
 *
 * The C++ splits the class over four .cpp files; the generators are functions
 * in `microwave_footprint.ts`, `microwave_polygon.ts` and `microwave_inductor.ts`
 * over {@link MICROWAVE_HOST}, and this class is the entry points the actions
 * bind to. What the C++ asks its `PCB_EDIT_FRAME` for (the dialogs, the current
 * track width, unit conversion, a new blank footprint, the commit) is the host.
 *
 * `addMicrowaveFootprint` builds the footprint and hands it to the host to
 * place (`doInteractiveItemPlacement( IPO_REPEAT | IPO_ROTATE | IPO_FLIP )`);
 * `drawMicrowaveInductor` is the two-click rectangle, whose end points the
 * frame reports to {@link MICROWAVE_TOOL.createInductorBetween}.
 */
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import type { FOOTPRINT } from '../footprint.js';
import type { wxTextValidator } from '@ziroeda/common/validators.js';
import { MICROWAVE_FOOTPRINT_SHAPE } from '../tools/pcb_actions.js';
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

export class MICROWAVE_TOOL {
  static readonly NAME = 'pcbnew.MicrowaveTool';

  constructor(private readonly m_host: MICROWAVE_HOST) {}

  /**
   * `CreateItem()` of `addMicrowaveFootprint`'s MICROWAVE_PLACER: the footprint
   * the tool then places, or null when the user cancels.
   */
  async addMicrowaveFootprint(aType: MICROWAVE_FOOTPRINT_SHAPE): Promise<FOOTPRINT | null> {
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

  /** `createInductorBetween`, driven by the two clicks of `drawMicrowaveInductor`. */
  createInductorBetween(aStart: VECTOR2I, aEnd: VECTOR2I): Promise<void> {
    return createInductorBetween(this.m_host, aStart, aEnd);
  }

  createFootprint(aShape: MICROWAVE_FOOTPRINT_SHAPE): Promise<FOOTPRINT | null> {
    return createFootprint(this.m_host, aShape);
  }

  createPolygonShape(): Promise<FOOTPRINT | null> {
    return createPolygonShape(this.m_host);
  }

  createMicrowaveInductor(aPattern: MICROWAVE_INDUCTOR_PATTERN) {
    return createMicrowaveInductor(this.m_host, aPattern);
  }

  createBaseFootprint(aValue: string, aTextSize: number, aPadCount: number): FOOTPRINT {
    return createBaseFootprint(this.m_host, aValue, aTextSize, aPadCount);
  }
}
