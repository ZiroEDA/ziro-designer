// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/gbr_netlist_metadata.cpp` + `include/gbr_netlist_metadata.h`
 * (GBR_DATA_FIELD, GBR_NETLIST_METADATA): the `%TO` object attributes a
 * Gerber item carries. Only the reading half GerbView uses is here; the
 * formatting (`GetGerberString`, `FormatNetAttribute`) is the plotter's, and
 * `pcbnew/plot_gerber.ts` still writes it inline.
 */

/**
 * `GBR_DATA_FIELD`: a Gerber data field, a Unicode string whose separator
 * characters are escaped when written.
 */
export class GBR_DATA_FIELD {
  private m_field = '';
  private m_useUTF8 = false;
  private m_escapeString = false;

  clear(): void {
    this.m_field = '';
    this.m_useUTF8 = false;
    this.m_escapeString = false;
  }

  Clear(): void {
    this.clear();
  }

  GetValue(): string {
    return this.m_field;
  }

  SetField(aField: string, aUseUTF8: boolean, aEscapeString: boolean): void {
    this.m_field = aField;
    this.m_useUTF8 = aUseUTF8;
    this.m_escapeString = aEscapeString;
  }

  IsEmpty(): boolean {
    return this.m_field.length === 0;
  }

  /** The value copy C++'s implicit copy constructor makes. */
  copyFrom(aOther: GBR_DATA_FIELD): void {
    this.m_field = aOther.m_field;
    this.m_useUTF8 = aOther.m_useUTF8;
    this.m_escapeString = aOther.m_escapeString;
  }
}

/** `GBR_NETLIST_METADATA::GBR_NETINFO_TYPE`; OR'ed together in `m_NetAttribType`. */
export enum GBR_NETINFO_TYPE {
  /** idle command (no command) */
  GBR_NETINFO_UNSPECIFIED = 0,
  /** print info associated to a flashed pad (TO.P attribute) */
  GBR_NETINFO_PAD = 1,
  /** print info associated to a net (TO.N attribute) */
  GBR_NETINFO_NET = 2,
  /** print info associated to a component (TO.C attribute) */
  GBR_NETINFO_CMP = 4,
}

/**
 * `GBR_NETLIST_METADATA`: the `%TO.P`, `%TO.N` and `%TO.C` attributes attached
 * to an object.
 */
export class GBR_NETLIST_METADATA {
  static readonly GBR_NETINFO_UNSPECIFIED = GBR_NETINFO_TYPE.GBR_NETINFO_UNSPECIFIED;
  static readonly GBR_NETINFO_PAD = GBR_NETINFO_TYPE.GBR_NETINFO_PAD;
  static readonly GBR_NETINFO_NET = GBR_NETINFO_TYPE.GBR_NETINFO_NET;
  static readonly GBR_NETINFO_CMP = GBR_NETINFO_TYPE.GBR_NETINFO_CMP;

  /** The type of net info (used to define the gerber string to create). */
  m_NetAttribType: number = GBR_NETINFO_TYPE.GBR_NETINFO_UNSPECIFIED;
  /** True if a pad of a footprint cannot be connected. */
  m_NotInNet = false;
  /** For a flashed pad: the pad name (TO.P attribute). */
  m_Padname = new GBR_DATA_FIELD();
  /** For a pad: the pin function (defined in schematic). */
  m_PadPinFunction = new GBR_DATA_FIELD();
  /** The component reference parent of the data. */
  m_Cmpref = '';
  /** For items associated to a net: the netname. */
  m_Netname = '';
  /** A string to print after %TO object attributes, if not empty. */
  m_ExtraData = '';
  /** true to init the next %TO attributes without clearing the previous ones. */
  m_TryKeepPreviousAttributes = false;

  ClearExtraData(): void {
    this.m_ExtraData = '';
  }

  SetExtraData(aExtraData: string): void {
    this.m_ExtraData = aExtraData;
  }

  /**
   * Remove the net attribute specified by `aName`; all of them when `aName`
   * is null or empty (`.CN` too).
   */
  ClearAttribute(aName: string | null): void {
    if (this.m_NetAttribType === GBR_NETINFO_TYPE.GBR_NETINFO_UNSPECIFIED) {
      this.m_Padname.clear();
      this.m_PadPinFunction.clear();
      this.m_Cmpref = '';
      this.m_Netname = '';
      return;
    }

    if (!aName || aName.length === 0 || aName === '.CN') {
      this.m_NetAttribType = GBR_NETINFO_TYPE.GBR_NETINFO_UNSPECIFIED;
      this.m_Padname.clear();
      this.m_PadPinFunction.clear();
      this.m_Cmpref = '';
      this.m_Netname = '';
      return;
    }

    if (aName === '.C') {
      this.m_NetAttribType &= ~GBR_NETINFO_TYPE.GBR_NETINFO_CMP;
      this.m_Cmpref = '';
      return;
    }

    if (aName === '.N') {
      this.m_NetAttribType &= ~GBR_NETINFO_TYPE.GBR_NETINFO_NET;
      this.m_Netname = '';
      return;
    }

    if (aName === '.P') {
      this.m_NetAttribType &= ~GBR_NETINFO_TYPE.GBR_NETINFO_PAD;
      this.m_Padname.clear();
      this.m_PadPinFunction.clear();
      return;
    }
  }

  /** `operator=`: the value copy `SetNetAttributes` stores on each item. */
  Clone(): GBR_NETLIST_METADATA {
    const c = new GBR_NETLIST_METADATA();
    c.m_NetAttribType = this.m_NetAttribType;
    c.m_NotInNet = this.m_NotInNet;
    c.m_Padname.copyFrom(this.m_Padname);
    c.m_PadPinFunction.copyFrom(this.m_PadPinFunction);
    c.m_Cmpref = this.m_Cmpref;
    c.m_Netname = this.m_Netname;
    c.m_ExtraData = this.m_ExtraData;
    c.m_TryKeepPreviousAttributes = this.m_TryKeepPreviousAttributes;
    return c;
  }
}
