// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcbplot.cpp` (declarations in `pcbplot.h`): the Gerber file
 * extensions and the X2 file attributes (`TF.GenerationSoftware`,
 * `TF.CreationDate`, `TF.ProjectId`, `TF.SameCoordinates`,
 * `TF.FileFunction`, `TF.FilePolarity`) a board plot writes into each Gerber
 * header.
 *
 * `PLOT_CONTROLLER` (the scripting entry point) and `BuildPlotFileName` are
 * not ported: the plot dialog names its files itself.
 *
 * `TF.GenerationSoftware` names us, not KiCad (`common/generator.ts`).
 */

import { ExpandTextVars } from '@ziroeda/common/common.js';
import {
  GBR_NC_STRING_FORMAT,
  GbrMakeCreationDateAttributeString,
  GbrMakeProjectGUIDfromString,
} from '@ziroeda/common/gbr_metadata.js';
import { GENERATOR_APPLICATION, GENERATOR_VENDOR } from '@ziroeda/common/generator.js';
import { GetBuildVersion } from '@ziroeda/common/build_version.js';
import { CopperLayerToOrdinal, IsCopperLayer, PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import type { PLOTTER } from '@ziroeda/common/plotters/plotter.js';
import type { BOARD } from './board.js';

/** `GetGerberProtelExtension( int aLayer )`. */
export function GetGerberProtelExtension(aLayer: number): string {
  if (IsCopperLayer(aLayer)) {
    if (aLayer === PCB_LAYER_ID.F_Cu) return 'gtl';
    else if (aLayer === PCB_LAYER_ID.B_Cu) return 'gbl';
    else return `g${CopperLayerToOrdinal(aLayer)}`;
  } else {
    switch (aLayer) {
      case PCB_LAYER_ID.B_Adhes:
        return 'gba';
      case PCB_LAYER_ID.F_Adhes:
        return 'gta';

      case PCB_LAYER_ID.B_Paste:
        return 'gbp';
      case PCB_LAYER_ID.F_Paste:
        return 'gtp';

      case PCB_LAYER_ID.B_SilkS:
        return 'gbo';
      case PCB_LAYER_ID.F_SilkS:
        return 'gto';

      case PCB_LAYER_ID.B_Mask:
        return 'gbs';
      case PCB_LAYER_ID.F_Mask:
        return 'gts';

      case PCB_LAYER_ID.Edge_Cuts:
        return 'gm1';

      default:
        return 'gbr';
    }
  }
}

/** `GetGerberFileFunctionAttribute( const BOARD* aBoard, int aLayer )`. */
export function GetGerberFileFunctionAttribute(aBoard: BOARD, aLayer: number): string {
  let attrib: string;

  switch (aLayer) {
    case PCB_LAYER_ID.F_Adhes:
      attrib = 'Glue,Top';
      break;

    case PCB_LAYER_ID.B_Adhes:
      attrib = 'Glue,Bot';
      break;

    case PCB_LAYER_ID.F_SilkS:
      attrib = 'Legend,Top';
      break;

    case PCB_LAYER_ID.B_SilkS:
      attrib = 'Legend,Bot';
      break;

    case PCB_LAYER_ID.F_Mask:
      attrib = 'Soldermask,Top';
      break;

    case PCB_LAYER_ID.B_Mask:
      attrib = 'Soldermask,Bot';
      break;

    case PCB_LAYER_ID.F_Paste:
      attrib = 'Paste,Top';
      break;

    case PCB_LAYER_ID.B_Paste:
      attrib = 'Paste,Bot';
      break;

    case PCB_LAYER_ID.Edge_Cuts:
      // Board outline.
      // Can be "Profile,NP" (Not Plated: usual) or "Profile,P"
      // This last is the exception (Plated)
      attrib = 'Profile,NP';
      break;

    case PCB_LAYER_ID.Dwgs_User:
      attrib = 'OtherDrawing,Comment';
      break;

    case PCB_LAYER_ID.Cmts_User:
      attrib = 'Other,Comment';
      break;

    case PCB_LAYER_ID.Eco1_User:
      attrib = 'Other,ECO1';
      break;

    case PCB_LAYER_ID.Eco2_User:
      attrib = 'Other,ECO2';
      break;

    case PCB_LAYER_ID.B_Fab:
      // This is actually a assembly layer
      attrib = 'AssemblyDrawing,Bot';
      break;

    case PCB_LAYER_ID.F_Fab:
      // This is actually a assembly layer
      attrib = 'AssemblyDrawing,Top';
      break;

    case PCB_LAYER_ID.B_Cu:
      attrib = `Copper,L${aBoard.GetCopperLayerCount()},Bot`;
      break;

    case PCB_LAYER_ID.F_Cu:
      attrib = 'Copper,L1,Top';
      break;

    default:
      if (IsCopperLayer(aLayer)) {
        // aLayer use even values, and the first internal layer
        // is B_Cu + 2. And in gerber file, layer id is 2 (1 is F_Cu)
        const ly_id = Math.trunc((aLayer - PCB_LAYER_ID.B_Cu) / 2) + 1;
        attrib = `Copper,L${ly_id},Inr`;
      } else {
        // `attrib.Printf( wxT( "Other,User" ), aLayer+1 )`: the argument has no
        // conversion to fill.
        attrib = 'Other,User';
      }
      break;
  }

  // (The optional ",Signal" / ",Plane" / ",Mixed" copper type suffix is behind
  // an `#if 0` upstream: "not used by Pcbnew".)

  return `%TF.FileFunction,${attrib}*%`;
}

/**
 * `GetGerberFilePolarityAttribute( int aLayer )`: `%TF.FilePolarity,Positive*%`
 * or `…Negative*%`, or '' for layers which do not use a polarity.
 */
function GetGerberFilePolarityAttribute(aLayer: number): string {
  /* The value of the .FilePolarity specifies whether the image represents the
   * presence or absence of material.
   * Solder mask images usually represent solder mask openings and are then negative.
   */
  let polarity = 0;

  switch (aLayer) {
    case PCB_LAYER_ID.F_Adhes:
    case PCB_LAYER_ID.B_Adhes:
    case PCB_LAYER_ID.F_SilkS:
    case PCB_LAYER_ID.B_SilkS:
    case PCB_LAYER_ID.F_Paste:
    case PCB_LAYER_ID.B_Paste:
      polarity = 1;
      break;

    case PCB_LAYER_ID.F_Mask:
    case PCB_LAYER_ID.B_Mask:
      polarity = -1;
      break;

    default:
      if (IsCopperLayer(aLayer)) polarity = 1;
      break;
  }

  let filePolarity = '';

  if (polarity === 1) filePolarity = '%TF.FilePolarity,Positive*%';
  if (polarity === -1) filePolarity = '%TF.FilePolarity,Negative*%';

  return filePolarity;
}

// A helper function to convert a X2 attribute string to a X1 structured comment:
function makeStringCompatX1(aText: string, aUseX1CompatibilityMode: boolean): string {
  if (aUseX1CompatibilityMode) return `G04 #@! ${aText.replaceAll('%', '')}`;

  return aText;
}

// A helper function to replace reserved chars (separators in gerber fields)
// in a gerber string field.
// reserved chars are replaced by _ (for ,) or an escaped sequence (for * and %)
function replaceReservedCharsField(aMsg: string): string {
  return aMsg
    .replaceAll(',', '_') // can be replaced by \\u002C
    .replaceAll('*', '\\u002A')
    .replaceAll('%', '\\u0025');
}

/** `wxString::ToAscii()`: every character above 0x7F becomes '_'. */
const toAscii = (aText: string): string =>
  Array.from(aText, (c) => (c.codePointAt(0)! > 0x7f ? '_' : c)).join('');

/** `wxFileName( path ).GetFullName()` and `.GetName()`. */
function fileNameParts(aPath: string): { fullName: string; name: string } {
  const fullName = aPath.split(/[\\/]/).pop() ?? '';
  const dot = fullName.lastIndexOf('.');

  return { fullName, name: dot > 0 ? fullName.slice(0, dot) : fullName };
}

/**
 * `AddGerberX2Header`: add some X2 attributes to the file header, as defined
 * in the Gerber file format specification J4 and "Revision 2015.06".
 *
 * @param aDate is "now" for `TF.CreationDate`; upstream reads the clock.
 */
export function AddGerberX2Header(
  aPlotter: PLOTTER,
  aBoard: BOARD,
  aUseX1CompatibilityMode: boolean,
  aDate: Date = new Date(),
): void {
  // Creates the TF,.GenerationSoftware. Format is:
  // %TF,.GenerationSoftware,<vendor>,<application name>[,<application version>]*%
  aPlotter.AddLineToHeader(
    makeStringCompatX1(
      `%TF.GenerationSoftware,${GENERATOR_VENDOR},${GENERATOR_APPLICATION},${GetBuildVersion()}*%`,
      aUseX1CompatibilityMode,
    ),
  );

  // creates the TF.CreationDate attribute:
  aPlotter.AddLineToHeader(
    GbrMakeCreationDateAttributeString(
      aUseX1CompatibilityMode
        ? GBR_NC_STRING_FORMAT.GBR_NC_STRING_FORMAT_X1
        : GBR_NC_STRING_FORMAT.GBR_NC_STRING_FORMAT_X2,
      aDate,
    ),
  );

  // Creates the TF,.ProjectId. Format is (from Gerber file format doc):
  // %TF.ProjectId,<project id>,<project GUID>,<revision id>*%
  // <project id> is the name of the project, restricted to basic ASCII symbols only,
  // Rem: <project id> accepts only ASCII 7 code (only basic ASCII codes are allowed in
  // gerber files) and comma not accepted.
  // All illegal chars will be replaced by underscore.
  //
  // <project GUID> is a string which is an unique id of a project.
  // However Kicad does not handle such a project GUID, so it is built from the board name
  const fn = fileNameParts(aBoard.GetFileName());

  // Build a <project GUID>, from the board name
  const guid = GbrMakeProjectGUIDfromString(fn.fullName);

  // build the <project id> string: this is the board short filename (without ext)
  // and all non ASCII chars and reserved chars (, * % ) are replaced by '_'
  const msg = replaceReservedCharsField(fn.name);

  // build the <revision id> string. All non ASCII chars and reserved chars are replaced by '_'
  const project = aBoard.GetProject();
  let rev = replaceReservedCharsField(
    ExpandTextVars(aBoard.GetTitleBlock().GetRevision(), (token) =>
      project ? project.TextVarResolver(token) : false,
    ),
  );

  if (rev === '') rev = 'rev?';

  aPlotter.AddLineToHeader(
    makeStringCompatX1(
      `%TF.ProjectId,${toAscii(msg)},${guid},${toAscii(rev)}*%`,
      aUseX1CompatibilityMode,
    ),
  );

  // Add the TF.SameCoordinates to specify that all gerber files uses the same origin and
  // orientation, and the registration between files is OK.
  // The parameter of TF.SameCoordinates is a string that is common to all files using the
  // same registration.  The string value has no meaning; it is just a key.
  // Because there is no mirroring/rotation in Kicad, only the plot offset origin can create
  // incorrect registration, so we create a key from plot offset options.
  //
  // Currently the key is "Original" when using absolute Pcbnew coordinates, and the PY and PY
  // position of the auxiliary axis when using it.
  // If we ever add user-settable absolute Pcbnew coordinates, we'll need to change the way
  // the key is built to ensure file only using the *same* axis have the same key.
  let registration_id = 'Original';
  const auxOrigin = aBoard.GetDesignSettings().GetAuxOrigin();

  // `%x` of an int: a negative coordinate prints as its 32-bit two's complement.
  const hex32 = (v: number): string => (v >>> 0).toString(16);

  if (aBoard.GetPlotOptions().GetUseAuxOrigin() && auxOrigin.x && auxOrigin.y)
    registration_id = `PX${hex32(auxOrigin.x)}PY${hex32(auxOrigin.y)}`;

  aPlotter.AddLineToHeader(
    makeStringCompatX1(`%TF.SameCoordinates,${registration_id}*%`, aUseX1CompatibilityMode),
  );
}

/** `AddGerberX2Attribute`: the header, then `TF.FileFunction` and `TF.FilePolarity`. */
export function AddGerberX2Attribute(
  aPlotter: PLOTTER,
  aBoard: BOARD,
  aLayer: number,
  aUseX1CompatibilityMode: boolean,
  aDate: Date = new Date(),
): void {
  AddGerberX2Header(aPlotter, aBoard, aUseX1CompatibilityMode, aDate);

  // Add the TF.FileFunction
  aPlotter.AddLineToHeader(
    makeStringCompatX1(GetGerberFileFunctionAttribute(aBoard, aLayer), aUseX1CompatibilityMode),
  );

  // Add the TF.FilePolarity (for layers which support that)
  const text = GetGerberFilePolarityAttribute(aLayer);

  if (text !== '') aPlotter.AddLineToHeader(makeStringCompatX1(text, aUseX1CompatibilityMode));
}
