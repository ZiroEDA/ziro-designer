// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/netclass.h` / `common/netclass.cpp`: `NETCLASS`, a collection of
 * nets and the parameters used to route or test these nets. `std::optional<int>`
 * is `number | undefined`; `Serialize`/`Deserialize` (protobuf) are not here.
 */

import { type Color4d, COLOR4D_UNSPECIFIED } from './color4d.js';
import { pcbIUScale, schIUScale } from './eda_units.js';
import { wildCompareString } from './string_utils.js';

// Initial values for netclass initialization
// track to track and track to pads clearance.
const DEFAULT_CLEARANCE = pcbIUScale.mmToIU(0.2);
const DEFAULT_VIA_DIAMETER = pcbIUScale.mmToIU(0.6);
const DEFAULT_VIA_DRILL = pcbIUScale.mmToIU(0.3);
const DEFAULT_UVIA_DIAMETER = pcbIUScale.mmToIU(0.3);
const DEFAULT_UVIA_DRILL = pcbIUScale.mmToIU(0.1);
const DEFAULT_TRACK_WIDTH = pcbIUScale.mmToIU(0.2);
const DEFAULT_DIFF_PAIR_WIDTH = pcbIUScale.mmToIU(0.2);
const DEFAULT_DIFF_PAIR_GAP = pcbIUScale.mmToIU(0.25);
const DEFAULT_DIFF_PAIR_VIAGAP = pcbIUScale.mmToIU(0.25);
const DEFAULT_WIRE_WIDTH = schIUScale.milsToIU(6);
const DEFAULT_BUS_WIDTH = schIUScale.milsToIU(12);
const DEFAULT_LINE_STYLE = 0; // solid

const colorEquals = (a: Color4d, b: Color4d): boolean =>
  a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;

/**
 * A collection of nets and the parameters used to route or test these nets.
 */
export class NETCLASS {
  /** the name of the default NETCLASS. This will get mapped to "kicad_default" in the specctra_export. */
  static readonly Default = 'Default';

  protected m_isDefault: boolean; ///< Mark if this instance is the default netclass

  protected m_constituents: NETCLASS[] = []; ///< NETCLASSes contributing to an aggregate

  protected m_Name!: string; ///< Name of the net class
  protected m_Priority!: number; ///< The priority for multiple netclass resolution
  protected m_Description = ''; ///< what this NETCLASS is for.

  protected m_Clearance: number | undefined;
  protected m_TrackWidth: number | undefined;
  protected m_ViaDia: number | undefined;
  protected m_ViaDrill: number | undefined;
  protected m_uViaDia: number | undefined;
  protected m_uViaDrill: number | undefined;
  protected m_diffPairWidth: number | undefined;
  protected m_diffPairGap: number | undefined;
  protected m_diffPairViaGap: number | undefined;
  protected m_wireWidth: number | undefined;
  protected m_busWidth: number | undefined;
  protected m_lineStyle: number | undefined;

  protected m_schematicColor!: Color4d;
  protected m_pcbColor!: Color4d; ///< Optional PCB color override for this netclass

  protected m_tuningProfile!: string; ///< The tuning profile name being used by this netclass

  // The NETCLASS providing each parameter

  protected m_clearanceParent!: NETCLASS;
  protected m_trackWidthParent!: NETCLASS;
  protected m_viaDiameterParent!: NETCLASS;
  protected m_viaDrillParent!: NETCLASS;
  protected m_uViaDiaParent!: NETCLASS;
  protected m_uViaDrillParent!: NETCLASS;
  protected m_diffPairWidthParent!: NETCLASS;
  protected m_diffPairGapParent!: NETCLASS;
  protected m_diffPairViaGapParent!: NETCLASS;
  protected m_wireWidthParent!: NETCLASS;
  protected m_busWidthParent!: NETCLASS;
  protected m_lineStyleParent!: NETCLASS;
  protected m_pcbColorParent!: NETCLASS;
  protected m_schematicColorParent!: NETCLASS;
  protected m_tuningProfileParent!: NETCLASS;

  /**
   * Create a NETCLASS instance with \a aName.
   * The units on the optional parameters are Internal Units (1 nm)
   * @param aName is the name of this new netclass.
   * @param aInitWithDefaults if true, initalise the netclass with default values
   */
  constructor(aName: string, aInitWithDefaults = true) {
    this.m_isDefault = false;
    this.m_constituents.push(this);
    this.SetName(aName);
    this.SetPriority(-1);
    this.SetTuningProfile('');

    // Colors are a special optional case - always set, but UNSPECIFIED used in place of optional
    this.SetPcbColor(COLOR4D_UNSPECIFIED);
    this.SetSchematicColor(COLOR4D_UNSPECIFIED);

    if (aInitWithDefaults) {
      this.SetClearance(DEFAULT_CLEARANCE);
      this.SetViaDrill(DEFAULT_VIA_DRILL);
      this.SetuViaDrill(DEFAULT_UVIA_DRILL);
      this.SetTrackWidth(DEFAULT_TRACK_WIDTH);
      this.SetViaDiameter(DEFAULT_VIA_DIAMETER);
      this.SetuViaDiameter(DEFAULT_UVIA_DIAMETER);
      this.SetDiffPairWidth(DEFAULT_DIFF_PAIR_WIDTH);
      this.SetDiffPairGap(DEFAULT_DIFF_PAIR_GAP);
      this.SetDiffPairViaGap(DEFAULT_DIFF_PAIR_VIAGAP);
      this.SetWireWidth(DEFAULT_WIRE_WIDTH);
      this.SetBusWidth(DEFAULT_BUS_WIDTH);
      this.SetLineStyle(DEFAULT_LINE_STYLE);
    }

    this.ResetParents();
  }

  /** `operator==`: the same constituents, in order. */
  equals(other: NETCLASS): boolean {
    if (this.m_constituents.length !== other.m_constituents.length) return false;

    for (let i = 0; i < this.m_constituents.length; ++i)
      if (this.m_constituents[i] !== other.m_constituents[i]) return false;

    return true;
  }

  GetClass(): string {
    return 'NETCLASS';
  }

  /// @brief Resets all parent fields to point to this netclass
  ResetParents(): void {
    this.SetClearanceParent(this);
    this.SetTrackWidthParent(this);
    this.SetViaDiameterParent(this);
    this.SetViaDrillParent(this);
    this.SetuViaDiameterParent(this);
    this.SetuViaDrillParent(this);
    this.SetDiffPairWidthParent(this);
    this.SetDiffPairGapParent(this);
    this.SetDiffPairViaGapParent(this);
    this.SetWireWidthParent(this);
    this.SetBusWidthParent(this);
    this.SetLineStyleParent(this);
    this.SetPcbColorParent(this);
    this.SetSchematicColorParent(this);
    this.SetTuningProfileParent(this);
  }

  /// @brief Resets all parameters (except Name and Description)
  ResetParameters(): void {
    this.SetPcbColor(COLOR4D_UNSPECIFIED);
    this.SetSchematicColor(COLOR4D_UNSPECIFIED);
    this.SetClearance(undefined);
    this.SetViaDrill(undefined);
    this.SetuViaDrill(undefined);
    this.SetTrackWidth(undefined);
    this.SetViaDiameter(undefined);
    this.SetuViaDiameter(undefined);
    this.SetDiffPairWidth(undefined);
    this.SetDiffPairGap(undefined);
    this.SetDiffPairViaGap(undefined);
    this.SetWireWidth(undefined);
    this.SetBusWidth(undefined);
    this.SetLineStyle(undefined);
    this.ResetParents();
  }

  /// @brief Gets the netclasses which make up this netclass
  // For a root netcless, this is the netclass this pointer, for aggregate netclasses is contains
  // all constituent netclasses, in order of priority.
  GetConstituentNetclasses(): readonly NETCLASS[] {
    return this.m_constituents;
  }

  /// @brief Sets the netclasses which make up this netclass
  SetConstituentNetclasses(constituents: NETCLASS[]): void {
    this.m_constituents = constituents;
  }

  /// @brief Determines if the given netclass name is a constituent of this (maybe aggregate)
  /// netclass
  ContainsNetclassWithName(netclass: string): boolean {
    return this.m_constituents.some((nc) => nc && wildCompareString(netclass, nc.GetName(), true));
  }

  /// @ brief Determines if this is marked as the default netclass
  IsDefault(): boolean {
    return this.m_isDefault;
  }

  /// @brief Set the name of this netclass. Only relevant for root netclasses (i.e. those which
  /// are not an aggregate)
  SetName(aName: string): void {
    this.m_Name = aName;

    if (aName === NETCLASS.Default) this.m_isDefault = true;
  }

  /// @brief Gets the name of this (maybe aggregate) netclass in a format for internal usage or
  /// for export to external tools / netlists. WARNING: Do not use this to display a netclass
  /// name to a user. Use GetHumanReadableName instead.
  GetName(): string {
    if (this.m_constituents.length === 1) return this.m_Name;

    console.assert(this.m_constituents.length >= 2);

    let name = '';
    name += this.m_constituents[0]!.m_Name;

    for (let i = 1; i < this.m_constituents.length; ++i) {
      name += ',';
      name += this.m_constituents[i]!.m_Name;
    }

    return name;
  }

  /// @brief Gets the consolidated name of this netclass (which may be an aggregate). This is
  /// intended for display to users (e.g. in infobars or messages). WARNING: Do not use this
  /// to compare equivalence, or to export to other tools)
  GetHumanReadableName(): string {
    if (this.m_constituents.length === 1) return this.m_Name;

    console.assert(this.m_constituents.length >= 2);

    let name = '';

    if (this.m_constituents.length === 2) {
      name = `${this.m_constituents[0]!.GetName()} and ${this.m_constituents[1]!.GetName()}`;
    } else if (this.m_constituents.length === 3) {
      name = `${this.m_constituents[0]!.GetName()}, ${this.m_constituents[1]!.GetName()} and ${this.m_constituents[2]!.GetName()}`;
    } else if (this.m_constituents.length > 3) {
      name = `${this.m_constituents[0]!.GetName()}, ${this.m_constituents[1]!.GetName()} and ${this.m_constituents.length - 2} more`;
    }

    return name;
  }

  GetDescription(): string {
    return this.m_Description;
  }
  SetDescription(aDesc: string): void {
    this.m_Description = aDesc;
  }

  HasClearance(): boolean {
    return this.m_Clearance !== undefined;
  }
  GetClearance(): number {
    return this.m_Clearance ?? -1;
  }
  GetClearanceOpt(): number | undefined {
    return this.m_Clearance;
  }
  SetClearance(a: number | undefined): void {
    this.m_Clearance = a;
  }
  SetClearanceParent(parent: NETCLASS): void {
    this.m_clearanceParent = parent;
  }
  GetClearanceParent(): NETCLASS {
    return this.m_clearanceParent;
  }

  HasTrackWidth(): boolean {
    return this.m_TrackWidth !== undefined;
  }
  GetTrackWidth(): number {
    return this.m_TrackWidth ?? -1;
  }
  GetTrackWidthOpt(): number | undefined {
    return this.m_TrackWidth;
  }
  SetTrackWidth(a: number | undefined): void {
    this.m_TrackWidth = a;
  }
  SetTrackWidthParent(parent: NETCLASS): void {
    this.m_trackWidthParent = parent;
  }
  GetTrackWidthParent(): NETCLASS {
    return this.m_trackWidthParent;
  }

  HasViaDiameter(): boolean {
    return this.m_ViaDia !== undefined;
  }
  GetViaDiameter(): number {
    return this.m_ViaDia ?? -1;
  }
  GetViaDiameterOpt(): number | undefined {
    return this.m_ViaDia;
  }
  SetViaDiameter(a: number | undefined): void {
    this.m_ViaDia = a;
  }
  SetViaDiameterParent(parent: NETCLASS): void {
    this.m_viaDiameterParent = parent;
  }
  GetViaDiameterParent(): NETCLASS {
    return this.m_viaDiameterParent;
  }

  HasViaDrill(): boolean {
    return this.m_ViaDrill !== undefined;
  }
  GetViaDrill(): number {
    return this.m_ViaDrill ?? -1;
  }
  GetViaDrillOpt(): number | undefined {
    return this.m_ViaDrill;
  }
  SetViaDrill(a: number | undefined): void {
    this.m_ViaDrill = a;
  }
  SetViaDrillParent(parent: NETCLASS): void {
    this.m_viaDrillParent = parent;
  }
  GetViaDrillParent(): NETCLASS {
    return this.m_viaDrillParent;
  }

  HasuViaDiameter(): boolean {
    return this.m_uViaDia !== undefined;
  }
  GetuViaDiameter(): number {
    return this.m_uViaDia ?? -1;
  }
  GetuViaDiameterOpt(): number | undefined {
    return this.m_uViaDia;
  }
  SetuViaDiameter(a: number | undefined): void {
    this.m_uViaDia = a;
  }
  SetuViaDiameterParent(parent: NETCLASS): void {
    this.m_uViaDiaParent = parent;
  }
  GetuViaDiameterParent(): NETCLASS {
    return this.m_uViaDiaParent;
  }

  HasuViaDrill(): boolean {
    return this.m_uViaDrill !== undefined;
  }
  GetuViaDrill(): number {
    return this.m_uViaDrill ?? -1;
  }
  GetuViaDrillOpt(): number | undefined {
    return this.m_uViaDrill;
  }
  SetuViaDrill(a: number | undefined): void {
    this.m_uViaDrill = a;
  }
  SetuViaDrillParent(parent: NETCLASS): void {
    this.m_uViaDrillParent = parent;
  }
  GetuViaDrillParent(): NETCLASS {
    return this.m_uViaDrillParent;
  }

  HasDiffPairWidth(): boolean {
    return this.m_diffPairWidth !== undefined;
  }
  GetDiffPairWidth(): number {
    return this.m_diffPairWidth ?? -1;
  }
  GetDiffPairWidthOpt(): number | undefined {
    return this.m_diffPairWidth;
  }
  SetDiffPairWidth(a: number | undefined): void {
    this.m_diffPairWidth = a;
  }
  SetDiffPairWidthParent(parent: NETCLASS): void {
    this.m_diffPairWidthParent = parent;
  }
  GetDiffPairWidthParent(): NETCLASS {
    return this.m_diffPairWidthParent;
  }

  HasDiffPairGap(): boolean {
    return this.m_diffPairGap !== undefined;
  }
  GetDiffPairGap(): number {
    return this.m_diffPairGap ?? -1;
  }
  GetDiffPairGapOpt(): number | undefined {
    return this.m_diffPairGap;
  }
  SetDiffPairGap(a: number | undefined): void {
    this.m_diffPairGap = a;
  }
  SetDiffPairGapParent(parent: NETCLASS): void {
    this.m_diffPairGapParent = parent;
  }
  GetDiffPairGapParent(): NETCLASS {
    return this.m_diffPairGapParent;
  }

  HasDiffPairViaGap(): boolean {
    return this.m_diffPairViaGap !== undefined;
  }
  GetDiffPairViaGap(): number {
    return this.m_diffPairViaGap ?? -1;
  }
  GetDiffPairViaGapOpt(): number | undefined {
    return this.m_diffPairViaGap;
  }
  SetDiffPairViaGap(a: number | undefined): void {
    this.m_diffPairViaGap = a;
  }
  SetDiffPairViaGapParent(parent: NETCLASS): void {
    this.m_diffPairViaGapParent = parent;
  }
  GetDiffPairViaGapParent(): NETCLASS {
    return this.m_diffPairViaGapParent;
  }

  HasWireWidth(): boolean {
    return this.m_wireWidth !== undefined;
  }
  GetWireWidth(): number {
    return this.m_wireWidth ?? -1;
  }
  GetWireWidthOpt(): number | undefined {
    return this.m_wireWidth;
  }
  SetWireWidth(a: number | undefined): void {
    this.m_wireWidth = a;
  }
  SetWireWidthParent(parent: NETCLASS): void {
    this.m_wireWidthParent = parent;
  }
  GetWireWidthParent(): NETCLASS {
    return this.m_wireWidthParent;
  }

  HasBusWidth(): boolean {
    return this.m_busWidth !== undefined;
  }
  GetBusWidth(): number {
    return this.m_busWidth ?? -1;
  }
  GetBusWidthOpt(): number | undefined {
    return this.m_busWidth;
  }
  SetBusWidth(a: number | undefined): void {
    this.m_busWidth = a;
  }
  SetBusWidthParent(parent: NETCLASS): void {
    this.m_busWidthParent = parent;
  }
  GetBusWidthParent(): NETCLASS {
    return this.m_busWidthParent;
  }

  HasLineStyle(): boolean {
    return this.m_lineStyle !== undefined;
  }
  GetLineStyle(): number {
    return this.m_lineStyle ?? 0;
  }
  GetLineStyleOpt(): number | undefined {
    return this.m_lineStyle;
  }
  SetLineStyle(a: number | undefined): void {
    this.m_lineStyle = a;
  }
  SetLineStyleParent(parent: NETCLASS): void {
    this.m_lineStyleParent = parent;
  }
  GetLineStyleParent(): NETCLASS {
    return this.m_lineStyleParent;
  }

  HasPcbColor(): boolean {
    return this.m_isDefault ? false : !colorEquals(this.m_pcbColor, COLOR4D_UNSPECIFIED);
  }
  GetPcbColor(aIsForSave = false): Color4d {
    // If we are saving netclases, return the underlying color (which may be set from an old
    // schematic with a default color set - this allows us to roll back the no-default-colors
    // changes later if required)
    if (aIsForSave || !this.m_isDefault) return this.m_pcbColor;

    return COLOR4D_UNSPECIFIED;
  }
  SetPcbColor(aColor: Color4d): void {
    this.m_pcbColor = aColor;
  }
  SetPcbColorParent(parent: NETCLASS): void {
    this.m_pcbColorParent = parent;
  }
  GetPcbColorParent(): NETCLASS {
    return this.m_pcbColorParent;
  }

  GetSchematicColor(aIsForSave = false): Color4d {
    // If we are saving netclases, return the underlying color (which may be set from an old
    // schematic with a default color set - this allows us to roll back the no-default-colors
    // changes later if required)
    if (aIsForSave || !this.m_isDefault) return this.m_schematicColor;

    return COLOR4D_UNSPECIFIED;
  }
  SetSchematicColor(aColor: Color4d): void {
    this.m_schematicColor = aColor;
  }
  SetSchematicColorParent(parent: NETCLASS): void {
    this.m_schematicColorParent = parent;
  }
  GetSchematicColorParent(): NETCLASS {
    return this.m_schematicColorParent;
  }

  SetPriority(aPriority: number): void {
    this.m_Priority = aPriority;
  }
  GetPriority(): number {
    return this.m_Priority;
  }

  HasTuningProfile(): boolean {
    return this.m_tuningProfile !== '';
  }
  SetTuningProfile(aTuningProfile: string): void {
    this.m_tuningProfile = aTuningProfile;
  }
  GetTuningProfile(): string {
    return this.m_tuningProfile;
  }
  SetTuningProfileParent(aParent: NETCLASS): void {
    this.m_tuningProfileParent = aParent;
  }
  GetTuningProfileParent(): NETCLASS {
    return this.m_tuningProfileParent;
  }
}
