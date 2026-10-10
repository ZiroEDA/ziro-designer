// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/sch_io/pads/pads_sch_schematic_builder.cpp` / `.h`: wires, junctions, net labels,
 * symbol fields, title blocks and hierarchical sheets from a parsed PADS Logic schematic.
 */
import { ADVANCED_CFG } from '@ziroeda/common/advanced_config.js';
import { IS_NEW } from '@ziroeda/common/eda_item_flags.js';
import { schIUScale } from '@ziroeda/common/eda_units.js';
import { GR_TEXT_H_ALIGN_T, GR_TEXT_V_ALIGN_T } from '@ziroeda/common/font/text_attributes.js';
import { PADS_ATTRIBUTE_MAPPER } from '@ziroeda/common/io/pads/pads_attribute_mapper.js';
import { ConvertInvertedNetName, FromUTF8 } from '@ziroeda/common/io/pads/pads_common.js';
import { SCH_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { TITLE_BLOCK } from '@ziroeda/common/title_block.js';
import { KiCadSchematicFileExtension } from '@ziroeda/common/wildcards_and_files_ext.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { SCH_FIELD } from '../../sch_field.js';
import { SCH_JUNCTION } from '../../sch_junction.js';
import { LABEL_FLAG_SHAPE, SCH_GLOBALLABEL, SCH_HIERLABEL, SPIN_STYLE } from '../../sch_label.js';
import { SCH_LINE } from '../../sch_line.js';
import { SCH_SCREEN } from '../../sch_screen.js';
import { SCH_SHEET } from '../../sch_sheet.js';
import { SCH_SHEET_PIN, SHEET_SIDE } from '../../sch_sheet_pin.js';
import type { SCH_SYMBOL } from '../../sch_symbol.js';
import type { SCHEMATIC } from '../../schematic.js';
import type { PARAMETERS, PART_PLACEMENT, SCH_SIGNAL, WIRE_SEGMENT } from './pads_sch_parser.js';

const isalpha = (c: string | undefined): boolean =>
  c !== undefined && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'));

/** `std::toupper` over a byte string: ASCII only, as the "C" locale does. */
export const asciiUpper = (s: string): string => s.replace(/[a-z]/g, (c) => c.toUpperCase());

/** `std::map<std::pair<int, int>, …>` walked in key order. */
function pairOrder(a: [number, number], b: [number, number]): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1];
}

/** `wxFileName( aPath ).GetName()`. */
function fileName(aPath: string): string {
  const base = aPath.substring(Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.substring(0, dot);
}

export class PADS_SCH_SCHEMATIC_BUILDER {
  private readonly m_params: PARAMETERS;
  private readonly m_schematic: SCHEMATIC | null;
  private readonly m_pageHeightIU: number;

  constructor(aParams: PARAMETERS, aSchematic: SCHEMATIC | null) {
    this.m_params = aParams;
    this.m_schematic = aSchematic;
    // `MilsToIU( int )`: the double height is truncated to whole mils.
    this.m_pageHeightIU = schIUScale.milsToIU(Math.trunc(aParams.sheet_size.height));
  }

  /**
   * PADS Logic ASCII schematics always store geometry in mils. The UNITS field selects only
   * the design-rules unit and must not scale the schematic coordinates.
   */
  private toKiCadUnits(aPadsValue: number): number {
    return schIUScale.milsToIU(Math.trunc(aPadsValue));
  }

  private toKiCadY(aPadsY: number): number {
    return this.m_pageHeightIU - this.toKiCadUnits(aPadsY);
  }

  private convertNetName(aName: string): string {
    return ConvertInvertedNetName(aName);
  }

  CreateWires(aSignals: readonly SCH_SIGNAL[], aScreen: SCH_SCREEN): number {
    let wireCount = 0;

    for (const signal of aSignals) {
      for (const wire of signal.wires) {
        const schLine = this.CreateWire(wire);

        schLine.SetFlags(IS_NEW);
        aScreen.Append(schLine);
        wireCount++;
      }
    }

    return wireCount;
  }

  CreateWire(aWire: WIRE_SEGMENT): SCH_LINE {
    const start: VECTOR2I = {
      x: this.toKiCadUnits(aWire.start.x),
      y: this.toKiCadY(aWire.start.y),
    };
    const end: VECTOR2I = { x: this.toKiCadUnits(aWire.end.x), y: this.toKiCadY(aWire.end.y) };

    const line = new SCH_LINE(start, SCH_LAYER_ID.LAYER_WIRE);
    line.SetEndPoint(end);

    return line;
  }

  CreateJunctions(aSignals: readonly SCH_SIGNAL[], aScreen: SCH_SCREEN): number {
    const junctionPoints = this.findJunctionPoints(aSignals);

    for (const pt of junctionPoints) {
      const junction = new SCH_JUNCTION(pt);
      junction.SetFlags(IS_NEW);
      aScreen.Append(junction);
    }

    return junctionPoints.length;
  }

  private findJunctionPoints(aSignals: readonly SCH_SIGNAL[]): VECTOR2I[] {
    const junctions: VECTOR2I[] = [];

    for (const signal of aSignals) {
      // Count how many wire endpoints connect at each point
      const pointCount = new Map<string, [[number, number], number]>();
      const bump = (x: number, y: number): void => {
        const k = `${x},${y}`;
        const e = pointCount.get(k);
        if (e) e[1]++;
        else pointCount.set(k, [[x, y], 1]);
      };

      for (const wire of signal.wires) {
        bump(this.toKiCadUnits(wire.start.x), this.toKiCadY(wire.start.y));
        bump(this.toKiCadUnits(wire.end.x), this.toKiCadY(wire.end.y));
      }

      // Junction needed where 3+ wire endpoints meet
      for (const [coords, count] of [...pointCount.values()].sort((a, b) =>
        pairOrder(a[0], b[0]),
      )) {
        if (count >= 3) junctions.push({ x: coords[0], y: coords[1] });
      }
    }

    return junctions;
  }

  CreateNetLabels(
    aSignals: readonly SCH_SIGNAL[],
    aScreen: SCH_SCREEN,
    aSignalOpcIds: ReadonlySet<string>,
    aSkipSignals: ReadonlySet<string> = new Set(),
  ): number {
    let labelCount = 0;

    for (const signal of aSignals) {
      if (signal.name === '' || signal.name[0] === '$') continue;

      if (aSkipSignals.has(signal.name)) continue;

      if (signal.wires.length === 0) continue;

      // Collect label placements from OPC wire endpoints. Each OPC produces one label.
      const opcPlacements: [VECTOR2I, VECTOR2I][] = [];

      for (const wire of signal.wires) {
        if (wire.vertices.length < 2) continue;

        const at = (k: number): VECTOR2I => ({
          x: this.toKiCadUnits(wire.vertices[k]!.x),
          y: this.toKiCadY(wire.vertices[k]!.y),
        });

        // endpoint_a references first vertex, endpoint_b references last vertex
        if (wire.endpoint_a.startsWith('@@@') && aSignalOpcIds.has(wire.endpoint_a))
          opcPlacements.push([at(0), at(1)]);

        if (wire.endpoint_b.startsWith('@@@') && aSignalOpcIds.has(wire.endpoint_b)) {
          const last = wire.vertices.length - 1;
          opcPlacements.push([at(last), at(last - 1)]);
        }
      }

      for (const [labelPos, adjPos] of opcPlacements) {
        const orient = this.computeLabelOrientation(labelPos, adjPos);
        const label = this.CreateNetLabel(signal, labelPos, orient);

        label.SetFlags(IS_NEW);
        aScreen.Append(label);
        labelCount++;
      }
    }

    return labelCount;
  }

  private computeLabelOrientation(aLabelPos: VECTOR2I, aAdjacentPos: VECTOR2I): SPIN_STYLE {
    // The wire goes from aLabelPos toward aAdjacentPos. The label text extends
    // in the opposite direction so it doesn't overlap the wire.
    const dx = aAdjacentPos.x - aLabelPos.x;
    const dy = aAdjacentPos.y - aLabelPos.y;

    if (Math.abs(dx) >= Math.abs(dy))
      return new SPIN_STYLE(dx > 0 ? SPIN_STYLE.LEFT : SPIN_STYLE.RIGHT);

    return new SPIN_STYLE(dy > 0 ? SPIN_STYLE.UP : SPIN_STYLE.BOTTOM);
  }

  CreateNetLabel(
    aSignal: SCH_SIGNAL,
    aPosition: VECTOR2I,
    aOrientation: SPIN_STYLE = new SPIN_STYLE(SPIN_STYLE.RIGHT),
  ): SCH_GLOBALLABEL {
    const labelName = this.convertNetName(aSignal.name);

    const label = new SCH_GLOBALLABEL(aPosition, labelName);
    label.SetShape(LABEL_FLAG_SHAPE.L_BIDI);
    label.SetSpinStyle(aOrientation);

    const labelSize = schIUScale.milsToIU(50);
    label.SetTextSize({ x: labelSize, y: labelSize });

    return label;
  }

  chooseLabelPosition(aSignal: SCH_SIGNAL): VECTOR2I {
    if (aSignal.wires.length === 0) return { x: 0, y: 0 };

    // `static_cast<int>( v * 1000 )`: the key truncates.
    const key = (v: { x: number; y: number }): string =>
      `${Math.trunc(v.x * 1000)},${Math.trunc(v.y * 1000)}`;

    // Count how many wire segments share each endpoint. An endpoint referenced
    // only once is a dangling wire end -- the correct place for a global label.
    // Only first and last vertices are true endpoints; interior ones are bends.
    const endpointCount = new Map<string, number>();

    for (const wire of aSignal.wires) {
      if (wire.vertices.length < 2) continue;

      for (const v of [wire.vertices[0]!, wire.vertices[wire.vertices.length - 1]!])
        endpointCount.set(key(v), (endpointCount.get(key(v)) ?? 0) + 1);
    }

    // Also count pin connection positions so we can avoid placing on a pin
    const pinEndpoints = new Set<string>();

    for (const wire of aSignal.wires) {
      if (wire.vertices.length < 2) continue;

      // endpoint_a/endpoint_b hold pin references (e.g. "R1.1"); if non-empty,
      // that endpoint connects to a component pin. OPC references (starting
      // with "@@@") are off-page connectors, not physical pins.
      if (wire.endpoint_a !== '' && !wire.endpoint_a.startsWith('@@@'))
        pinEndpoints.add(key(wire.vertices[0]!));

      if (wire.endpoint_b !== '' && !wire.endpoint_b.startsWith('@@@'))
        pinEndpoints.add(key(wire.vertices[wire.vertices.length - 1]!));
    }

    const at = (v: { x: number; y: number }): VECTOR2I => ({
      x: this.toKiCadUnits(v.x),
      y: this.toKiCadY(v.y),
    });

    // Prefer a dangling endpoint that is NOT at a pin
    for (const wire of aSignal.wires) {
      if (wire.vertices.length < 2) continue;

      for (const vtx of [wire.vertices[0]!, wire.vertices[wire.vertices.length - 1]!]) {
        if ((endpointCount.get(key(vtx)) ?? 0) === 1 && !pinEndpoints.has(key(vtx))) return at(vtx);
      }
    }

    // Fallback: any dangling endpoint (even if at a pin)
    for (const wire of aSignal.wires) {
      if (wire.vertices.length < 2) continue;

      for (const vtx of [wire.vertices[0]!, wire.vertices[wire.vertices.length - 1]!]) {
        if ((endpointCount.get(key(vtx)) ?? 0) === 1) return at(vtx);
      }
    }

    // Last resort: first endpoint of the first wire that has vertices
    for (const wire of aSignal.wires) {
      if (wire.vertices.length > 0) return at(wire.vertices[0]!);
    }

    return { x: 0, y: 0 };
  }

  CreateBusWires(aSignals: readonly SCH_SIGNAL[], aScreen: SCH_SCREEN): number {
    let busCount = 0;

    for (const signal of aSignals) {
      if (!PADS_SCH_SCHEMATIC_BUILDER.IsBusSignal(signal.name)) continue;

      for (const wire of signal.wires) {
        const busLine = this.CreateBusWire(wire);

        busLine.SetFlags(IS_NEW);
        aScreen.Append(busLine);
        busCount++;
      }
    }

    return busCount;
  }

  CreateBusWire(aWire: WIRE_SEGMENT): SCH_LINE {
    const start: VECTOR2I = {
      x: this.toKiCadUnits(aWire.start.x),
      y: this.toKiCadY(aWire.start.y),
    };
    const end: VECTOR2I = { x: this.toKiCadUnits(aWire.end.x), y: this.toKiCadY(aWire.end.y) };

    const line = new SCH_LINE(start, SCH_LAYER_ID.LAYER_BUS);
    line.SetEndPoint(end);

    return line;
  }

  static IsBusSignal(aName: string): boolean {
    if (aName === '') return false;

    // Check for bus naming patterns commonly used in PADS
    // Pattern 1: NAME[n:m] or NAME[n..m] - range notation; Pattern 2: NAME<n:m> or NAME<n..m>
    for (const [open, close] of [
      ['[', ']'],
      ['<', '>'],
    ] as const) {
      const openPos = aName.indexOf(open);

      if (openPos !== -1) {
        const closePos = aName.indexOf(close, openPos);

        if (closePos !== -1) {
          const range = aName.substring(openPos + 1, closePos);

          if (range.includes(':') || range.includes('..')) return true;
        }
      }
    }

    return false;
  }

  ApplyPartAttributes(aSymbol: SCH_SYMBOL | null, aPlacement: PART_PLACEMENT): void {
    if (!aSymbol || !this.m_schematic) return;

    // Set reference designator, stripping any gate suffix (e.g., "U17-A" → "U17")
    if (aPlacement.reference !== '') {
      let ref = aPlacement.reference;
      let sepPos = ref.lastIndexOf('-');

      if (sepPos === -1) sepPos = ref.lastIndexOf('.');

      if (sepPos !== -1 && sepPos + 1 < ref.length && isalpha(ref[sepPos + 1]))
        ref = ref.substring(0, sepPos);

      aSymbol.SetRef(this.m_schematic.CurrentSheet(), FromUTF8(ref));
    }

    // Value field is always the PARTTYPE name. Parametric values like VALUE1
    // flow through CreateCustomFields as user-defined fields.
    if (aPlacement.part_type !== '') aSymbol.SetValueFieldText(FromUTF8(aPlacement.part_type));

    // Look for PCB DECAL attribute to set footprint
    for (const attr of aPlacement.attributes) {
      if (attr.name === 'PCB DECAL' || attr.name === 'PCB_DECAL' || attr.name === 'FOOTPRINT') {
        if (attr.value !== '') aSymbol.SetFootprintFieldText(FromUTF8(attr.value));

        break;
      }
    }

    // Apply visibility and position settings
    this.ApplyFieldSettings(aSymbol, aPlacement);
  }

  ApplyFieldSettings(aSymbol: SCH_SYMBOL | null, aPlacement: PART_PLACEMENT): void {
    if (!aSymbol) return;

    const mapper = new PADS_ATTRIBUTE_MAPPER();

    for (const attr of aPlacement.attributes) {
      let field: SCH_FIELD | null = null;
      let isRefOrValue = false;

      if (mapper.IsReferenceField(attr.name)) {
        field = aSymbol.GetField(FIELD_T.REFERENCE);
        isRefOrValue = true;
      } else if (mapper.IsValueField(attr.name)) {
        field = aSymbol.GetField(FIELD_T.VALUE);
        isRefOrValue = true;
      } else if (mapper.IsFootprintField(attr.name)) {
        field = aSymbol.GetField(FIELD_T.FOOTPRINT);
      }

      if (field) {
        const isRef = mapper.IsReferenceField(attr.name);

        if (isRef) field.SetVisible(true);
        else field.SetVisible(isRefOrValue ? attr.visible : false);

        // PADS field positions are in CAEDECAL coordinates (pre-mirror).
        // KiCad applies the symbol transform to field positions, so
        // pre-compensate X for mirrored-Y symbols.
        let fx = this.toKiCadUnits(attr.position.x);

        if (aPlacement.mirror_flags & 1) fx = -fx;

        const pos = aSymbol.GetPosition();
        field.SetPosition({ x: pos.x + fx, y: pos.y - this.toKiCadUnits(attr.position.y) });

        if (attr.rotation !== 0.0) field.SetTextAngleDegrees(attr.rotation);

        if (attr.height > 0) {
          const scaledH = Math.trunc(
            schIUScale.milsToIU(attr.height) * ADVANCED_CFG.GetCfg().m_PadsSchTextHeightScale,
          );
          const scaledW = Math.trunc(
            schIUScale.milsToIU(attr.height) * ADVANCED_CFG.GetCfg().m_PadsSchTextWidthScale,
          );
          field.SetTextSize({ x: scaledW, y: scaledH });
        } else {
          const fieldTextSize = schIUScale.milsToIU(50);
          field.SetTextSize({ x: fieldTextSize, y: fieldTextSize });
        }

        if (attr.width > 0) field.SetTextThickness(schIUScale.milsToIU(attr.width));

        field.SetHorizJustify(GR_TEXT_H_ALIGN_T.GR_TEXT_H_ALIGN_CENTER);
        field.SetVertJustify(
          isRef
            ? GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_BOTTOM
            : GR_TEXT_V_ALIGN_T.GR_TEXT_V_ALIGN_CENTER,
        );
      }
    }
  }

  CreateCustomFields(aSymbol: SCH_SYMBOL | null, aPlacement: PART_PLACEMENT): number {
    if (!aSymbol) return 0;

    let fieldsCreated = 0;
    const mapper = new PADS_ATTRIBUTE_MAPPER();

    const processedNames = new Set<string>();

    for (const attr of aPlacement.attributes) {
      // Skip standard fields that are handled by ApplyPartAttributes
      if (mapper.IsStandardField(attr.name)) continue;

      // Skip empty attributes
      if (attr.value === '') continue;

      processedNames.add(attr.name);

      // Get the mapped field name
      const fieldName = mapper.GetKiCadFieldName(attr.name);

      // Check if this field already exists on the symbol
      const existingField = aSymbol.GetField(FromUTF8(fieldName));

      if (existingField) {
        // Update existing field value and settings
        existingField.SetText(FromUTF8(attr.value));
        existingField.SetVisible(false);
      } else {
        // Create a new custom field using FIELD_T::USER for custom fields
        const newField = new SCH_FIELD(aSymbol, FIELD_T.USER, FromUTF8(fieldName));

        newField.SetText(FromUTF8(attr.value));
        newField.SetVisible(false);

        // Apply position offset from attribute
        const pos = aSymbol.GetPosition();
        newField.SetPosition({
          x: pos.x + this.toKiCadUnits(attr.position.x),
          y: pos.y - this.toKiCadUnits(attr.position.y),
        });

        // Apply rotation if specified
        if (attr.rotation !== 0.0) newField.SetTextAngleDegrees(attr.rotation);

        // Apply text size if specified
        if (attr.size > 0.0) {
          const textSize = this.toKiCadUnits(attr.size);
          newField.SetTextSize({ x: textSize, y: textSize });
        }

        aSymbol.AddField(newField);
        fieldsCreated++;
      }
    }

    // Create fields from attr_overrides that weren't in the attributes vector (`std::map` order)
    for (const [name, value] of [...aPlacement.attr_overrides].sort((a, b) =>
      a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
    )) {
      if (value === '' || processedNames.has(name) || mapper.IsStandardField(name)) continue;

      const fieldName = mapper.GetKiCadFieldName(name);
      const existingField = aSymbol.GetField(FromUTF8(fieldName));

      if (existingField) {
        existingField.SetText(FromUTF8(value));
        existingField.SetVisible(false);
      } else {
        const newField = new SCH_FIELD(aSymbol, FIELD_T.USER, FromUTF8(fieldName));
        newField.SetText(FromUTF8(value));
        newField.SetVisible(false);
        newField.SetPosition(aSymbol.GetPosition());

        aSymbol.AddField(newField);
        fieldsCreated++;
      }
    }

    return fieldsCreated;
  }

  CreateTitleBlock(aScreen: SCH_SCREEN | null): void {
    if (!aScreen) return;

    // Look up the first non-empty value from a list of candidate field names
    const findField = (aCandidates: readonly string[]): string => {
      for (const name of aCandidates) {
        const v = this.m_params.fields.get(name);

        if (v !== undefined && v !== '') return v;
      }

      return '';
    };

    const tb = new TITLE_BLOCK();

    let title = findField(['Title', 'TITLE1']);

    if (title === '') title = this.m_params.job_name;

    if (title !== '') tb.SetTitle(FromUTF8(title));

    const date = findField(['DATE', 'Release Date', 'Drawn Date']);

    if (date !== '') tb.SetDate(FromUTF8(date));

    const revision = findField(['Revision', 'VER']);

    if (revision !== '') tb.SetRevision(FromUTF8(revision));

    const company = findField(['Company Name']);

    if (company !== '') tb.SetCompany(FromUTF8(company));

    const comments: [number, string[]][] = [
      [0, ['DN', 'Drawing Number']],
      [1, ['DESIGNER']],
      [2, ['DRAWNBY', 'Drawn By']],
      [3, ['BUILTFOR']],
    ];

    for (const [idx, names] of comments) {
      const v = findField(names);

      if (v !== '') tb.SetComment(idx, FromUTF8(v));
    }

    aScreen.SetTitleBlock(tb);
  }

  CreateHierarchicalSheet(
    aSheetNumber: number,
    aTotalSheets: number,
    aParentSheet: SCH_SHEET | null,
    aBaseFilename: string,
  ): SCH_SHEET | null {
    if (!aParentSheet || !this.m_schematic) return null;

    const pos = this.CalculateSheetPosition(aSheetNumber - 1, aTotalSheets);
    const size = this.GetDefaultSheetSize();

    const sheet = new SCH_SHEET(aParentSheet, pos, size);

    // Create a screen for this sheet
    const screen = new SCH_SCREEN(this.m_schematic);
    sheet.SetScreen(screen);

    // Generate sheet filename based on base filename and sheet number
    const sheetFilename = `${fileName(aBaseFilename)}_sheet${aSheetNumber}.${KiCadSchematicFileExtension}`;

    // Set the sheet filename field
    sheet.GetField(FIELD_T.SHEET_FILENAME)!.SetText(sheetFilename);

    // Set sheet name
    sheet.GetField(FIELD_T.SHEET_NAME)!.SetText(`Sheet ${aSheetNumber}`);

    // Set full path for the screen if project is available
    if (this.m_schematic.IsValid())
      screen.SetFileName(this.m_schematic.Project().GetProjectPath() + sheetFilename);
    else screen.SetFileName(sheetFilename);

    sheet.SetFlags(IS_NEW);

    // Add the sheet to the parent's screen
    const parentScreen = aParentSheet.GetScreen();

    if (parentScreen) parentScreen.Append(sheet);

    return sheet;
  }

  GetDefaultSheetSize(): VECTOR2I {
    // Default sheet symbol size in mils (approximately 2" x 1.5")
    return { x: schIUScale.milsToIU(2000), y: schIUScale.milsToIU(1500) };
  }

  CalculateSheetPosition(aSheetIndex: number, aTotalSheets: number): VECTOR2I {
    // Arrange sheet symbols in a grid on the root sheet
    // Start position offset from origin
    const startX = schIUScale.milsToIU(500);
    const startY = schIUScale.milsToIU(500);

    // Spacing between sheet symbols
    const spacingX = schIUScale.milsToIU(2500);
    const spacingY = schIUScale.milsToIU(2000);

    // Calculate grid columns based on total sheets (aim for roughly square layout)
    let columns = Math.trunc(Math.ceil(Math.sqrt(aTotalSheets)));

    if (columns < 1) columns = 1;

    const row = Math.trunc(aSheetIndex / columns);
    const col = aSheetIndex % columns;

    return { x: startX + col * spacingX, y: startY + row * spacingY };
  }

  CreateSheetPin(
    aSheet: SCH_SHEET | null,
    aSignalName: string,
    aPinIndex: number,
  ): SCH_SHEET_PIN | null {
    if (!aSheet) return null;

    const name = FromUTF8(aSignalName);

    // Position pins along the left edge of the sheet
    const sheetPos = aSheet.GetPosition();

    const pinSpacing = schIUScale.milsToIU(200);
    const yOffset = schIUScale.milsToIU(100) + aPinIndex * pinSpacing;

    const pin = new SCH_SHEET_PIN(aSheet, { x: sheetPos.x, y: sheetPos.y + yOffset }, name);
    pin.SetSide(SHEET_SIDE.LEFT);
    pin.SetShape(LABEL_FLAG_SHAPE.L_UNSPECIFIED);

    aSheet.AddPin(pin);

    return pin;
  }

  CreateHierLabel(
    aSignalName: string,
    aPosition: VECTOR2I,
    aScreen: SCH_SCREEN | null,
  ): SCH_HIERLABEL | null {
    if (!aScreen) return null;

    const label = new SCH_HIERLABEL(aPosition, FromUTF8(aSignalName));
    label.SetShape(LABEL_FLAG_SHAPE.L_UNSPECIFIED);
    label.SetFlags(IS_NEW);

    aScreen.Append(label);

    return label;
  }

  private static readonly s_globalPatterns = new Set([
    'VCC',
    'VDD',
    'VEE',
    'VSS',
    'GND',
    'AGND',
    'DGND',
    'PGND',
    'V+',
    'V-',
    'VBAT',
    'VBUS',
    'VIN',
    'VOUT',
    '+5V',
    '+3V3',
    '+3.3V',
    '+12V',
    '-12V',
    '+24V',
    '0V',
    'EARTH',
    'CHASSIS',
  ]);

  static IsGlobalSignal(aSignalName: string, aSheetNumbers: ReadonlySet<number>): boolean {
    if (aSignalName === '') return false;

    // Signals appearing on multiple sheets should be global
    if (aSheetNumbers.size > 1) return true;

    // Common power net names are always global
    const upperName = asciiUpper(aSignalName);

    if (PADS_SCH_SCHEMATIC_BUILDER.s_globalPatterns.has(upperName)) return true;

    // Check for voltage patterns like +1V8, +2V5, etc.
    if ((upperName[0] === '+' || upperName[0] === '-') && upperName.length >= 3) {
      const rest = upperName.substring(1);
      const hasDigit = /[0-9]/.test(rest);
      const hasV = rest.includes('V');

      if (hasDigit && hasV) return true;
    }

    return false;
  }
}
