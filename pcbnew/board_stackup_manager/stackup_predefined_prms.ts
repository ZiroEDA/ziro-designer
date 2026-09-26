// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/board_stackup_manager/stackup_predefined_prms.h` + `.cpp`: the
 * copper finishes and the mask/silk/dielectric colour lists a stackup can
 * name. The names are `.gbrjob` keywords, so they are data, not chrome.
 */
import type { Color4d } from '@ziroeda/common/color4d.js';
import {
  BOARD_STACKUP_ITEM_TYPE,
  DEFAULT_SOLDERMASK_OPACITY,
  NotSpecifiedPrm,
} from './board_stackup.js';

const { BS_ITEM_TYPE_DIELECTRIC, BS_ITEM_TYPE_SILKSCREEN, BS_ITEM_TYPE_SOLDERMASK } =
  BOARD_STACKUP_ITEM_TYPE;

/** `wxColor( r, g, b, a = 255 )` as a COLOR4D. */
const wxColor = (r: number, g: number, b: number, a = 255): Color4d => ({
  r: r / 255,
  g: g / 255,
  b: b / 255,
  a: a / 255,
});

/** A minor struct to handle color in gerber job file and dialog. */
export class FAB_LAYER_COLOR {
  private m_colorName: string; // the name (in job file) of the color
  // User values are the HTML encoded "#rrggbbaa" RGB hexa value.
  private m_color: Color4d;

  constructor(aColorName = '', aColor: Color4d = wxColor(0, 0, 0)) {
    this.m_colorName = aColorName;
    this.m_color = aColor;
  }

  GetName(): string {
    return this.m_colorName;
  }

  GetColor(aItemType: BOARD_STACKUP_ITEM_TYPE): Color4d {
    if (aItemType === BS_ITEM_TYPE_SOLDERMASK)
      return { ...this.m_color, a: DEFAULT_SOLDERMASK_OPACITY };

    return { ...this.m_color, a: 1.0 };
  }

  /**
   * @return a color name acceptable in gerber job file
   * one of normalized color name, or the string R<integer>G<integer>B<integer>
   * integer is a decimal value from 0 to 255
   */
  GetColorAsString(): string {
    if (IsColorNameNormalized(this.m_colorName)) return this.m_colorName;

    return `R${Math.trunc(this.m_color.r * 255)}G${Math.trunc(this.m_color.g * 255)}B${Math.trunc(this.m_color.b * 255)}`;
  }
}

// A list of copper finish standard type names.
// They are standard names in .gbdjob files, so avoid changing them or ensure they are
// compatible with .gbrjob file spec.
// [data] stackup_predefined_prms.cpp:36-52
const copperFinishType = (): string[] => [
  NotSpecifiedPrm(), // Not specified, not in .gbrjob file
  'ENIG', // used in .gbrjob file
  'ENEPIG', // used in .gbrjob file
  'HAL SnPb', // used in .gbrjob file
  'HAL lead-free', // used in .gbrjob file
  'Hard gold', // used in .gbrjob file
  'Immersion tin', // used in .gbrjob file
  'Immersion nickel', // used in .gbrjob file
  'Immersion silver', // used in .gbrjob file
  'Immersion gold', // used in .gbrjob file
  'HT_OSP', // used in .gbrjob file
  'OSP', // used in .gbrjob file
  'None', // used in .gbrjob file
  'User defined', // keep this option at end
];

// A list of available colors for solder mask and silkscreen.
// These names are used in .gbrjob file, so they are not fully free.  Use only what is allowed in
// .gbrjob files.
// For other colors (user defined), the defined value is the html color syntax in .kicad_pcb files
// and R<integer>G<integer>B<integer> in .gbrjob file.
// [data] stackup_predefined_prms.cpp:60-71
const gbrjobColors: FAB_LAYER_COLOR[] = [
  new FAB_LAYER_COLOR(NotSpecifiedPrm(), wxColor(80, 80, 80)), // Not specified, not in .gbrjob file
  new FAB_LAYER_COLOR('Green', wxColor(60, 150, 80)), // used in .gbrjob file
  new FAB_LAYER_COLOR('Red', wxColor(128, 0, 0)), // used in .gbrjob file
  new FAB_LAYER_COLOR('Blue', wxColor(0, 0, 128)), // used in .gbrjob file
  new FAB_LAYER_COLOR('Purple', wxColor(80, 0, 80)), // used in .gbrjob file
  new FAB_LAYER_COLOR('Black', wxColor(20, 20, 20)), // used in .gbrjob file
  new FAB_LAYER_COLOR('White', wxColor(200, 200, 200)), // used in .gbrjob file
  new FAB_LAYER_COLOR('Yellow', wxColor(128, 128, 0)), // used in .gbrjob file
  new FAB_LAYER_COLOR('User defined', wxColor(128, 128, 128)), // Free; the name is a dummy name here
];

// These are used primarily as a source for the 3D renderer.  They are written
// as R<integer>G<integer>B<integer>  to the .gbrjob file.
// [data] stackup_predefined_prms.cpp:76-85
const dielectricColors: FAB_LAYER_COLOR[] = [
  new FAB_LAYER_COLOR(NotSpecifiedPrm(), wxColor(80, 80, 80, 255)),
  new FAB_LAYER_COLOR('FR4 natural', wxColor(109, 116, 75, 212)),
  new FAB_LAYER_COLOR('PTFE natural', wxColor(252, 252, 250, 230)),
  new FAB_LAYER_COLOR('Polyimide', wxColor(205, 130, 0, 170)),
  new FAB_LAYER_COLOR('Phenolic natural', wxColor(92, 17, 6, 230)),
  new FAB_LAYER_COLOR('Aluminum', wxColor(213, 213, 213, 255)),
  new FAB_LAYER_COLOR('User defined', wxColor(128, 128, 128, 212)),
];

/** `GetStandardCopperFinishes( aTranslate )`; there is no translation here. */
export function GetStandardCopperFinishes(_aTranslate = false): string[] {
  return copperFinishType();
}

const dummy: FAB_LAYER_COLOR[] = [];

export function GetStandardColors(aType: BOARD_STACKUP_ITEM_TYPE): readonly FAB_LAYER_COLOR[] {
  switch (aType) {
    case BS_ITEM_TYPE_SILKSCREEN:
      return gbrjobColors;
    case BS_ITEM_TYPE_SOLDERMASK:
      return gbrjobColors;
    case BS_ITEM_TYPE_DIELECTRIC:
      return dielectricColors;
    default:
      return dummy;
  }
}

export function GetColorUserDefinedListIdx(aType: BOARD_STACKUP_ITEM_TYPE): number {
  // this is the last item in list
  return GetStandardColors(aType).length - 1;
}

export function GetDefaultUserColor(aType: BOARD_STACKUP_ITEM_TYPE): Color4d {
  return GetStandardColors(aType)[GetColorUserDefinedListIdx(aType)]!.GetColor(aType);
}

export function GetStandardColor(aType: BOARD_STACKUP_ITEM_TYPE, aIdx: number): Color4d {
  return GetStandardColors(aType)[aIdx]!.GetColor(aType);
}

export function GetStandardColorName(aType: BOARD_STACKUP_ITEM_TYPE, aIdx: number): string {
  return GetStandardColors(aType)[aIdx]!.GetName();
}

export function IsCustomColorIdx(aType: BOARD_STACKUP_ITEM_TYPE, aIdx: number): boolean {
  return aIdx === GetColorUserDefinedListIdx(aType);
}

/** @return true if aName is one of the six .gbrjob colour keywords (case insensitive). */
export function IsColorNameNormalized(aName: string): boolean {
  const list = ['Green', 'Red', 'Blue', 'Black', 'White', 'Yellow'];

  for (const candidate of list) if (candidate.toLowerCase() === aName.toLowerCase()) return true;

  return false;
}
