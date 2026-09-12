// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * PCB_FIELD, a footprint text field (Reference, Value, Datasheet, or a user
 * field): pcbnew/pcb_field.{h,cpp}. A PCB_TEXT with a field id/name.
 */

import { type EdaTextOpts, PCB_TEXT } from './pcb_text.js';
import type { PCB_LAYER_NAME } from './layer_ids.js';

export enum MANDATORY_FIELD_T {
  REFERENCE = 0,
  VALUE = 1,
  DATASHEET = 2,
  FOOTPRINT_FIELD = 3,
  DESCRIPTION = 4,
}

export class PCB_FIELD extends PCB_TEXT {
  private m_id: number;
  private m_name: string;

  constructor(layer: PCB_LAYER_NAME, id: number, name: string, opts: EdaTextOpts = {}) {
    super(layer, opts);
    this.m_id = id;
    this.m_name = name;
  }

  GetId(): number {
    return this.m_id;
  }
  GetName(): string {
    return this.m_name;
  }
  IsReference(): boolean {
    return this.m_id === MANDATORY_FIELD_T.REFERENCE;
  }
  IsValue(): boolean {
    return this.m_id === MANDATORY_FIELD_T.VALUE;
  }
}
