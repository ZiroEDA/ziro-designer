// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/odbpp/odb_eda_data.{h,cpp}`: the step's `eda/data` file - nets with their subnets
 * (toeprints, traces, vias, planes) and the feature ids each owns, and the packages with their
 * pins and outlines.
 *
 * Packages are told apart by `hash_fp_item` (hash_eda.ts's canonical string): the map keyed by it
 * is only looked up, and packages are written in the order they were added.
 */
import { ERROR_LOC } from '@ziroeda/kimath/src/convert_basic_shapes_to_polygon.js';
import { ANGLE_0 } from '@ziroeda/kimath/src/geometry/eda_angle.js';
import { FLIP_DIRECTION } from '@ziroeda/kimath/src/core/mirror.js';
import type { POLYGON } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import { SHAPE_POLY_SET } from '@ziroeda/kimath/src/geometry/shape_poly_set.js';
import type { VECTOR2I } from '@ziroeda/kimath/src/math/vector2.js';
import { PCB_LAYER_ID } from '@ziroeda/common/layer_id.js';
import { pcbIUScale } from '@ziroeda/common/eda_units.js';
import { FILL_T } from '@ziroeda/common/eda_shape.js';
import type { FOOTPRINT } from '../../footprint.js';
import { HASH_FLAGS, hash_fp_item } from '../../hash_eda.js';
import type { NETINFO_ITEM } from '../../netinfo.js';
import type { PAD } from '../../pad.js';
import { PAD_ATTRIB, PADSTACK } from '../../padstack.js';
import type { PCB_TRACK } from '../../pcb_track.js';
import type { ZONE } from '../../zone.js';
import { ATTR_MANAGER, ATTR_RECORD_WRITER } from './odb_attribute.js';
import { ODB_SURFACE_DATA } from './odb_feature.js';
import { AddXY, Data2String, ODB_SETTINGS, type OSTREAM, RemoveWhitespace } from './odb_util.js';

/** The plugin's maps from board items to the subnets their features belong to. */
export interface ODB_SUBNET_MAPS {
  GetPadSubnetMap(): Map<PAD, SUB_NET_TOEPRINT>;
  /** `std::map<std::pair<PCB_LAYER_ID, ZONE*>, …>`, by zone then layer. */
  GetPlaneSubnetMap(): Map<ZONE, Map<PCB_LAYER_ID, SUB_NET_PLANE>>;
  GetViaTraceSubnetMap(): Map<PCB_TRACK, SUB_NET>;
}

/** `EDA_DATA::FEATURE_ID::TYPE`. */
export enum FEATURE_ID_TYPE {
  COPPER,
  LAMINATE,
  HOLE,
}

export class FEATURE_ID {
  constructor(
    public type: FEATURE_ID_TYPE,
    public layer: number,
    public feature_id: number,
  ) {}

  Write(ost: OSTREAM): void {
    // Upstream's map has only COPPER and HOLE: a LAMINATE id would throw (std::map::at).
    const t =
      this.type === FEATURE_ID_TYPE.COPPER ? 'C' : this.type === FEATURE_ID_TYPE.HOLE ? 'H' : null;

    if (t === null) throw new RangeError('map::at');

    ost.write('FID ', t, ' ', this.layer, ' ', this.feature_id, '\n');
  }
}

export abstract class SUB_NET {
  readonly feature_ids: FEATURE_ID[] = [];

  constructor(
    readonly m_index: number,
    protected readonly m_edadata: EDA_DATA,
  ) {}

  Write(ost: OSTREAM): void {
    ost.write('SNT ');

    this.WriteSubnet(ost);

    ost.write('\n');

    for (const fid of this.feature_ids) fid.Write(ost);
  }

  AddFeatureID(type: FEATURE_ID_TYPE, layer: string, feature_id: number): void {
    this.feature_ids.push(new FEATURE_ID(type, this.m_edadata.GetLyrIdx(layer), feature_id));
  }

  protected abstract WriteSubnet(ost: OSTREAM): void;
}

export class SUB_NET_VIA extends SUB_NET {
  protected WriteSubnet(ost: OSTREAM): void {
    ost.write('VIA');
  }
}

export class SUB_NET_TRACE extends SUB_NET {
  protected WriteSubnet(ost: OSTREAM): void {
    ost.write('TRC');
  }
}

export enum FILL_TYPE {
  SOLID,
  OUTLINE,
}

export enum CUTOUT_TYPE {
  CIRCLE,
  RECT,
  OCTAGON,
  EXACT,
}

export class SUB_NET_PLANE extends SUB_NET {
  constructor(
    aIndex: number,
    aEda: EDA_DATA,
    public fill_type: FILL_TYPE,
    public cutout_type: CUTOUT_TYPE,
    public fill_size: number,
  ) {
    super(aIndex, aEda);
  }

  protected WriteSubnet(ost: OSTREAM): void {
    const fill = this.fill_type === FILL_TYPE.SOLID ? 'S' : 'O';
    const cutout = ['C', 'R', 'O', 'E'][this.cutout_type]!;

    ost.write('PLN ', fill, ' ', cutout, ' ', this.fill_size);
  }
}

export enum SIDE {
  TOP,
  BOTTOM,
}

export class SUB_NET_TOEPRINT extends SUB_NET {
  constructor(
    aIndex: number,
    aEda: EDA_DATA,
    public side: SIDE,
    public comp_num: number,
    public toep_num: number,
  ) {
    super(aIndex, aEda);
  }

  protected WriteSubnet(ost: OSTREAM): void {
    ost.write(
      'TOP ',
      this.side === SIDE.BOTTOM ? 'B' : 'T',
      ' ',
      this.comp_num,
      ' ',
      this.toep_num,
    );
  }
}

export class NET extends ATTR_RECORD_WRITER {
  readonly subnets: SUB_NET[] = [];

  constructor(
    readonly m_index: number,
    public m_name: string,
  ) {
    super();
  }

  /** `AddSubnet<T>( args… )`: the subnet's index is the count before it. */
  AddSubnet<T extends SUB_NET>(aMake: (aIndex: number) => T): T {
    const r = aMake(this.subnets.length);
    this.subnets.push(r);
    return r;
  }

  Write(ost: OSTREAM): void {
    ost.write('NET ', this.m_name);

    this.WriteAttributes(ost);

    ost.write('\n');

    for (const subnet of this.subnets) subnet.Write(ost);
  }
}

export enum PIN_TYPE {
  THROUGH_HOLE,
  BLIND,
  SURFACE,
}

export enum ELECTRICAL_TYPE {
  ELECTRICAL,
  MECHANICAL,
  UNDEFINED,
}

export enum MOUNT_TYPE {
  SMT,
  SMT_RECOMMENDED,
  THROUGH_HOLE,
  THROUGH_RECOMMENDED,
  PRESSFIT,
  NON_BOARD,
  HOLE,
  UNDEFINED,
}

export abstract class PKG_OUTLINE {
  abstract Write(ost: OSTREAM): void;
}

export class OUTLINE_RECT extends PKG_OUTLINE {
  constructor(
    public m_lower_left: VECTOR2I,
    public m_width: number,
    public m_height: number,
  ) {
    super();
  }

  Write(ost: OSTREAM): void {
    ost.write(
      'RC ',
      Data2String(this.m_lower_left.x),
      ' ',
      Data2String(this.m_lower_left.y),
      ' ',
      Data2String(this.m_width),
      ' ',
      Data2String(this.m_height),
      '\n',
    );
  }
}

export class OUTLINE_CONTOUR extends PKG_OUTLINE {
  m_surfaces: ODB_SURFACE_DATA | null = null;

  constructor(aPolygon: POLYGON, aFillType: FILL_T = FILL_T.FILLED_SHAPE) {
    super();

    if (aPolygon.length > 0 && aPolygon[0]!.PointCount() >= 3) {
      this.m_surfaces = new ODB_SURFACE_DATA(aPolygon);

      if (aFillType !== FILL_T.NO_FILL) this.m_surfaces.AddPolygonHoles(aPolygon);
    }
  }

  Write(ost: OSTREAM): void {
    if (!this.m_surfaces) return;

    ost.write('CT', '\n');
    this.m_surfaces.WriteData(ost);
    ost.write('CE', '\n');
  }
}

export class OUTLINE_SQUARE extends PKG_OUTLINE {
  constructor(
    public m_center: VECTOR2I,
    public m_halfSide: number,
  ) {
    super();
  }

  Write(ost: OSTREAM): void {
    ost.write(
      'SQ ',
      Data2String(this.m_center.x),
      ' ',
      Data2String(this.m_center.y),
      ' ',
      Data2String(this.m_halfSide),
      '\n',
    );
  }
}

export class OUTLINE_CIRCLE extends PKG_OUTLINE {
  constructor(
    public m_center: VECTOR2I,
    public m_radius: number,
  ) {
    super();
  }

  Write(ost: OSTREAM): void {
    ost.write(
      'CR ',
      Data2String(this.m_center.x),
      ' ',
      Data2String(this.m_center.y),
      ' ',
      Data2String(this.m_radius),
      '\n',
    );
  }
}

export class PIN {
  m_center: [string, string] = ['', ''];
  type: PIN_TYPE = PIN_TYPE.SURFACE;
  etype: ELECTRICAL_TYPE = ELECTRICAL_TYPE.UNDEFINED;
  mtype: MOUNT_TYPE = MOUNT_TYPE.UNDEFINED;
  readonly m_pinOutlines: PKG_OUTLINE[] = [];

  constructor(
    readonly m_index: number,
    public m_name: string,
  ) {}

  Write(ost: OSTREAM): void {
    const type =
      this.type === PIN_TYPE.SURFACE ? 'S' : this.type === PIN_TYPE.THROUGH_HOLE ? 'T' : 'B';
    const etype = ['E', 'M', 'U'][this.etype]!;
    // Upstream's map holds THROUGH_HOLE, HOLE, SMT and UNDEFINED only.
    const mtypes = new Map<MOUNT_TYPE, string>([
      [MOUNT_TYPE.THROUGH_HOLE, 'T'],
      [MOUNT_TYPE.HOLE, 'H'],
      [MOUNT_TYPE.SMT, 'S'],
      [MOUNT_TYPE.UNDEFINED, 'U'],
    ]);
    const mtype = mtypes.get(this.mtype);

    if (mtype === undefined) throw new RangeError('map::at');

    ost.write(
      'PIN ',
      this.m_name,
      ' ',
      type,
      ' ',
      this.m_center[0],
      ' ',
      this.m_center[1],
      ' 0 ',
      etype,
      ' ',
      mtype,
      '\n',
    );

    for (const outline of this.m_pinOutlines) outline.Write(ost);
  }
}

export class PACKAGE extends ATTR_RECORD_WRITER {
  m_pitch = 0;
  m_xmin = 0;
  m_ymin = 0;
  m_xmax = 0;
  m_ymax = 0;
  readonly m_pkgOutlines: PKG_OUTLINE[] = [];
  private readonly m_pinsVec: PIN[] = [];

  constructor(
    /** Reference number of the package to be used in CMP. */
    readonly m_index: number,
    public m_name: string,
  ) {
    super();
  }

  GetEdaPkgPin(aPadIndex: number): PIN {
    const pin = this.m_pinsVec[aPadIndex];

    if (!pin) throw new RangeError('vector::at');

    return pin;
  }

  AddPin(aPad: PAD, aPinNum: number): void {
    // ODB is unhappy with whitespace in most places
    let name = RemoveWhitespace(aPad.GetNumber());

    // Pins are required to have names, so if our pad doesn't have a name, we need to
    // generate one that is unique

    if (aPad.GetAttribute() === PAD_ATTRIB.NPTH) name = `NPTH${aPinNum}`;
    else if (name === '') name = `PAD${aPinNum}`;

    // // for SNT record, pad, net, pin
    const pin = new PIN(this.m_pinsVec.length, name);
    this.m_pinsVec.push(pin);

    pin.m_center = AddXY(aPad.GetFPRelativePosition());

    pin.type = aPad.HasHole() ? PIN_TYPE.THROUGH_HOLE : PIN_TYPE.SURFACE;

    if (aPad.GetAttribute() === PAD_ATTRIB.NPTH) pin.etype = ELECTRICAL_TYPE.MECHANICAL;
    else if (aPad.IsOnCopperLayer()) pin.etype = ELECTRICAL_TYPE.ELECTRICAL;
    else pin.etype = ELECTRICAL_TYPE.UNDEFINED;

    if ((aPad.HasHole() && aPad.IsOnCopperLayer()) || aPad.GetAttribute() === PAD_ATTRIB.PTH)
      pin.mtype = MOUNT_TYPE.THROUGH_HOLE;
    else if (aPad.HasHole() && aPad.GetAttribute() === PAD_ATTRIB.NPTH) pin.mtype = MOUNT_TYPE.HOLE;
    else if (aPad.GetAttribute() === PAD_ATTRIB.SMD) pin.mtype = MOUNT_TYPE.SMT;
    else pin.mtype = MOUNT_TYPE.UNDEFINED;

    const polygons = aPad.GetEffectivePolygon(PADSTACK.ALL_LAYERS, ERROR_LOC.ERROR_INSIDE);

    // TODO: Here we put all pad shapes as polygonl, we should switch by pad shape
    // Note:pad only use polygons->Polygon(0),
    if (polygons.OutlineCount() > 0)
      pin.m_pinOutlines.push(new OUTLINE_CONTOUR(polygons.Polygon(0)));
  }

  Write(ost: OSTREAM): void {
    ost.write(
      'PKG ',
      this.m_name,
      ' ',
      Data2String(this.m_pitch),
      ' ',
      Data2String(this.m_xmin),
      ' ',
      Data2String(this.m_ymin),
      ' ',
      Data2String(this.m_xmax),
      ' ',
      Data2String(this.m_ymax),
      ';',
      '\n',
    );

    for (const outline of this.m_pkgOutlines) outline.Write(ost);

    for (const pin of this.m_pinsVec) pin.Write(ost);
  }
}

/** `UINT64_MAX`, as a double. */
const UINT64_MAX = 2 ** 64;

export class EDA_DATA extends ATTR_MANAGER {
  /** std::map<size_t, NET>, by netcode. */
  private readonly nets_map = new Map<number, NET>();
  private readonly nets: NET[] = [];
  private readonly packages_map = new Map<string, PACKAGE>(); //hash value, package
  private readonly packages: PACKAGE[] = [];
  private readonly layers_map = new Map<string, number>();
  private readonly layers: string[] = [];
  private readonly m_eda_footprints: FOOTPRINT[] = [];

  constructor(
    private readonly m_now: string,
    private readonly m_buildVersion: string,
  ) {
    super();

    const x = new NET(this.nets.length, '$NONE$');
    this.nets_map.set(0, x);
    this.nets.push(x);
  }

  GetEdaFootprints(): FOOTPRINT[] {
    return this.m_eda_footprints;
  }

  AddNET(aNet: NETINFO_ITEM): void {
    if (this.nets_map.has(aNet.GetNetCode())) return;

    const netName = RemoveWhitespace(aNet.GetNetname());

    const net = new NET(this.nets.length, netName);
    this.nets_map.set(aNet.GetNetCode(), net);
    this.nets.push(net);

    //TODO: netname check
  }

  GetNet(aNetcode: number): NET {
    const net = this.nets_map.get(aNetcode);

    if (!net) throw new RangeError('map::at');

    return net;
  }

  GetLyrIdx(aLayer: string): number {
    const known = this.layers_map.get(aLayer);

    if (known !== undefined) return known;

    const idx = this.layers_map.size;
    this.layers_map.set(aLayer, idx);
    this.layers.push(aLayer);
    return idx;
  }

  GetPackage(aHash: string): PACKAGE {
    const pkg = this.packages_map.get(aHash);

    if (!pkg) throw new RangeError('map::at');

    return pkg;
  }

  AddPackage(aFp: FOOTPRINT): void {
    // ODBPP only need unique PACKAGE in PKG record in eda/data file.
    // the PKG index can repeat to be ref in CMP record in component file.

    const fp = aFp.Clone();
    this.m_eda_footprints.push(fp);
    fp.SetParentGroup(null);
    fp.SetPosition({ x: 0, y: 0 });

    if (aFp.IsFlipped()) {
      // ODB++ needs both flips
      fp.Flip(fp.GetPosition(), FLIP_DIRECTION.LEFT_RIGHT);
      fp.Flip(fp.GetPosition(), FLIP_DIRECTION.TOP_BOTTOM);
    }

    fp.SetOrientation(ANGLE_0);

    const hash = hash_fp_item(fp, HASH_FLAGS.HASH_POS | HASH_FLAGS.REL_COORD);
    const pkg_index = this.packages_map.size;
    let fp_name = RemoveWhitespace(fp.GetFPID().GetLibItemName());

    if (fp_name === '') fp_name = '__';

    if (this.packages_map.has(hash)) return;

    const pkg = new PACKAGE(pkg_index, fp_name);
    this.packages_map.set(hash, pkg);

    this.packages.push(pkg);

    const bbox = fp.GetBoundingBox();
    pkg.m_xmin = bbox.GetPosition().x;
    pkg.m_ymin = bbox.GetPosition().y;
    pkg.m_xmax = bbox.GetEnd().x;
    pkg.m_ymax = bbox.GetEnd().y;
    pkg.m_pitch = UINT64_MAX;

    const pads = fp.Pads();

    if (pads.length < 2) pkg.m_pitch = pcbIUScale.mmToIU(1.0); // placeholder value

    for (let i = 0; i < pads.length; ++i) {
      const c1 = pads[i]!.GetCenter();

      for (let j = i + 1; j < pads.length; ++j) {
        const c2 = pads[j]!.GetCenter();
        // VECTOR2I::EuclideanNorm() is a double; the uint64_t takes its integer part.
        const pin_dist = Math.trunc(Math.hypot(c1.x - c2.x, c1.y - c2.y));
        pkg.m_pitch = Math.min(pkg.m_pitch, pin_dist);
      }
    }

    const courtyard = fp.GetCourtyard(PCB_LAYER_ID.F_CrtYd);
    const courtyard_back = fp.GetCourtyard(PCB_LAYER_ID.B_CrtYd);
    let pkg_outline = new SHAPE_POLY_SET();

    if (courtyard.OutlineCount() > 0) pkg_outline = courtyard;

    if (courtyard_back.OutlineCount() > 0) pkg_outline = courtyard_back;

    if (!courtyard.OutlineCount() && !courtyard_back.OutlineCount())
      pkg_outline = fp.GetBoundingHull();

    // TODO: Here we put rect, square, and circle, all as polygon

    for (let ii = 0; ii < pkg_outline.OutlineCount(); ++ii)
      pkg.m_pkgOutlines.push(new OUTLINE_CONTOUR(pkg_outline.Polygon(ii)));

    for (let i = 0; i < pads.length; ++i) pkg.AddPin(pads[i]!, i);
  }

  Write(ost: OSTREAM): void {
    ost.write('# ', this.m_now, '\n');
    ost.write('HDR KiCad EDA ', this.m_buildVersion, '\n');
    ost.write('UNITS=', ODB_SETTINGS.m_unitsStr, '\n');
    ost.write('LYR');

    for (const layer of this.layers) ost.write(' ', layer);

    ost.write('\n');

    this.WriteAttributes(ost, '#');

    for (const net of this.nets) {
      ost.write('#NET ', net.m_index, '\n');
      net.Write(ost);
    }

    let i = 0;

    for (const pkg of this.packages) {
      ost.write('# PKG ', i, '\n');
      i++;
      pkg.Write(ost);
      ost.write('#', '\n');
    }
  }
}
