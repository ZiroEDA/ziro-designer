// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/odbpp/odb_component.{h,cpp}`: a component layer's `components` file - one CMP
 * record per footprint with its properties and toeprints.
 *
 * Upstream also logs a warning when a designator had to be renamed; there is no wx log here, and
 * the file is unchanged by it.
 */
import { FIELD_T } from '@ziroeda/common/template_fieldnames.js';
import { ANGLE_0, ANGLE_360 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { FOOTPRINT_ATTR_T, type FOOTPRINT } from '../../footprint.js';
import { ATTR_MANAGER, ATTR_RECORD_WRITER, COMP_MOUNT_TYPE, ODB_ATTR } from './odb_attribute.js';
import type { PACKAGE, PIN } from './odb_eda_data.js';
import {
  AddXY,
  Double2String,
  GenLegalComponentName,
  ODB_SETTINGS,
  type OSTREAM,
  RemoveWhitespace,
} from './odb_util.js';

export class TOEPRINT {
  /** index of PIN record in the eda/data file, 0~n-1. */
  readonly m_pin_num: number;
  /** Board location of the pin. */
  m_center: [string, string] = ['', ''];
  /** Rotation, clockwise, it equals to the actual PAD rotation, not CMP m_rot. */
  m_rot = '';
  /** equal to CMP m_mirror. */
  m_mirror = '';
  /** Number of NET record in the eda/data file. */
  m_net_num = 0;
  /** Number of subnet (SNT record TOP) in the referenced net */
  m_subnet_num = 0;
  /** Name of the pad in PIN record */
  m_toeprint_name: string;

  constructor(pin: PIN) {
    this.m_pin_num = pin.m_index;
    this.m_toeprint_name = pin.m_name;
  }

  Write(ost: OSTREAM): void {
    ost.write(
      'TOP ',
      this.m_pin_num,
      ' ',
      this.m_center[0],
      ' ',
      this.m_center[1],
      ' ',
      this.m_rot,
      ' ',
      this.m_mirror,
      ' ',
      this.m_net_num,
      ' ',
      this.m_subnet_num,
      ' ',
      this.m_toeprint_name,
      '\n',
    );
  }
}

export class ODB_COMPONENT extends ATTR_RECORD_WRITER {
  m_center: [string, string] = ['', ''];
  m_rot = '0';
  m_mirror = 'N';
  /** Unique reference designator (component name) */
  m_comp_name = '';
  /** Part identification is a single string of ASCII characters without spaces */
  m_part_name = '';
  /** Component Property Record (std::map: written sorted). */
  readonly m_prp = new Map<string, string>();
  readonly m_toeprints: TOEPRINT[] = [];

  constructor(
    /** CMP index number on board to be used in SNT(TOP), 0~n-1 */
    readonly m_index: number,
    /** package ref number from PKG in eda/data file, 0~n-1 */
    public m_pkg_ref: number,
  ) {
    super();
  }

  Write(ost: OSTREAM): void {
    ost.write('# CMP ', this.m_index, '\n');
    ost.write(
      'CMP ',
      this.m_pkg_ref,
      ' ',
      this.m_center[0],
      ' ',
      this.m_center[1],
      ' ',
      this.m_rot,
      ' ',
      this.m_mirror,
      ' ',
      this.m_comp_name,
      ' ',
      this.m_part_name,
    );

    this.WriteAttributes(ost);

    ost.write('\n');

    for (const key of [...this.m_prp.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))
      ost.write('PRP ', key, ' ', this.m_prp.get(key)!, '\n');

    for (const toep of this.m_toeprints) toep.Write(ost);

    ost.write('#', '\n');
  }
}

export class COMPONENTS_MANAGER extends ATTR_MANAGER {
  private readonly m_compList: ODB_COMPONENT[] = [];
  private readonly m_usedCompNames = new Set<string>();

  AddComponent(aFp: FOOTPRINT, aPkg: PACKAGE): ODB_COMPONENT {
    const comp = new ODB_COMPONENT(this.m_compList.length, aPkg.m_index);
    this.m_compList.push(comp);

    comp.m_center = AddXY(aFp.GetPosition());
    let angle = aFp.GetOrientation();

    if (!angle.equals(ANGLE_0)) {
      // odb Rotation is expressed in degrees and is always clockwise.
      // while kicad EDA_ANGLE is anticlockwise.
      angle = ANGLE_360.sub(angle);
      comp.m_rot = Double2String(angle.Normalize().AsDegrees());
    }

    if (aFp.IsFlipped()) comp.m_mirror = 'M';

    const originalRef = aFp.GetReference();
    comp.m_comp_name = GenLegalComponentName(originalRef);

    // ODB++ cannot handle spaces in these fields
    comp.m_part_name = RemoveWhitespace(
      `${aFp.GetFPID().GetFullLibraryName()}_${aFp.GetFPID().GetLibItemName()}`,
    );

    if (comp.m_comp_name === '') {
      // The spec requires a component name; some ODB++ parsers can't handle it being empty
      comp.m_comp_name = `UNNAMED${this.m_compList.length}`;
    }

    const base_comp_name = comp.m_comp_name;

    if (this.m_usedCompNames.has(comp.m_comp_name)) {
      let suffix = 1;
      let candidate: string;

      do {
        candidate = `${base_comp_name}_${suffix++}`;
      } while (this.m_usedCompNames.has(candidate));

      this.m_usedCompNames.add(candidate);
      comp.m_comp_name = candidate;
    } else {
      this.m_usedCompNames.add(comp.m_comp_name);
    }

    for (const field of aFp.GetFields()) {
      if (field.GetId() === FIELD_T.REFERENCE) continue;

      const key = RemoveWhitespace(field.GetName());
      comp.m_prp.set(key, `'${field.GetShownText(false)}'`);
    }

    const board = aFp.GetBoard();

    if (aFp.GetDNPForVariant(board ? board.GetCurrentVariant() : ''))
      this.AddSystemAttribute(comp, ODB_ATTR.NO_POP(true));

    if (aFp.GetAttributes() & FOOTPRINT_ATTR_T.FP_SMD)
      this.AddSystemAttribute(comp, ODB_ATTR.COMP_MOUNT_TYPE(COMP_MOUNT_TYPE.MT_SMD));
    else if (aFp.GetAttributes() & FOOTPRINT_ATTR_T.FP_THROUGH_HOLE)
      this.AddSystemAttribute(comp, ODB_ATTR.COMP_MOUNT_TYPE(COMP_MOUNT_TYPE.THT));
    else this.AddSystemAttribute(comp, ODB_ATTR.COMP_MOUNT_TYPE(COMP_MOUNT_TYPE.OTHER));

    return comp;
  }

  Write(ost: OSTREAM): void {
    ost.write('UNITS=', ODB_SETTINGS.m_unitsStr, '\n');

    this.WriteAttributes(ost);

    for (const comp of this.m_compList) comp.Write(ost);
  }
}
