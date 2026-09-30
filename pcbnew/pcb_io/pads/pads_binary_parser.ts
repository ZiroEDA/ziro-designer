// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `pcbnew/pcb_io/pads/pads_binary_parser.cpp` / `.h`: `PADS_IO::BINARY_PARSER`,
 * the reader for PADS Layout's binary `.pcb` (versions 0x2021 and
 * 0x2025-0x2027), into the same records as the ASCII parser. Upstream reads
 * only what it has reverse-engineered: parts, decal names, net names, texts,
 * the board outline (0x2026) and unnetted route segments and vias.
 */

import { IO_ERROR } from '@ziroeda/common/exceptions.js';
import { ParseDouble } from '@ziroeda/common/io/pads/pads_common.js';
import {
  arcPoint,
  type LAYER_INFO,
  type NET,
  newLayerInfo,
  newText,
  type PAD_STACK_LAYER,
  type PARAMETERS,
  PADS_LAYER_FUNCTION,
  newPadStackLayer,
  type PART,
  type PART_DECAL,
  type POLYLINE,
  type POUR,
  type ROUTE,
  type TEXT,
  type TRACK,
  UNIT_TYPE,
} from './pads_parser.js';

const FOOTER_GUID = '{2FE18320-6448-11d1-A412-000000000000}';

const PAD_SHAPE_NAMES = new Map<number, string>([
  [0x01, 'RF'],
  [0x02, 'R'],
  [0x03, 'S'],
  [0x04, 'OF'],
]);

const HEADER_SIZE = 10;
const FOOTER_SIZE = 46;
const DIR_ENTRY_SIZE = 16;
const ANGLE_SCALE = 1800000;

interface DirEntry {
  index: number;
  count: number;
  totalBytes: number;
  dataOffset: number;
  perItem: number;
}

interface LineVertex {
  x: number;
  y: number;
  extra: number;
}

interface RouteSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

/** C `isalnum` / `isalpha` / `isdigit` on a byte ("C" locale). */
const isalpha = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isdigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isalnum = (c: number): boolean => isalpha(c) || isdigit(c);

const newPart = (): PART => ({
  name: '',
  decal: '',
  part_type: '',
  alternate_decals: [],
  alt_decal_index: -1,
  value: '',
  units: '',
  location: { x: 0, y: 0 },
  rotation: 0,
  bottom_layer: false,
  glued: false,
  explicit_decal: false,
  attributes: [],
  reuse_instance: '',
  reuse_part: '',
});

export class BINARY_PARSER {
  private m_data: Uint8Array = new Uint8Array(0);
  private m_version = 0;
  private m_numDirEntries = 0;
  private m_dirEntries: DirEntry[] = [];
  private m_stringPoolBytes: Uint8Array = new Uint8Array(0);
  private m_lineVertices: LineVertex[] = [];
  private m_originX = 0;
  private m_originY = 0;
  private m_originFound = false;
  private m_padStackCache = new Map<number, PAD_STACK_LAYER[]>();
  private m_fpTypeToDecal = new Map<string, string>();
  private m_routeSegments: RouteSegment[] = [];
  private m_viaLocations: { x: number; y: number }[] = [];

  private m_parameters: PARAMETERS = {
    units: UNIT_TYPE.MILS,
    layer_count: 2,
    origin: { x: 0, y: 0 },
    user_grid: 0.0,
    thermal_line_width: 30.0,
    thermal_smd_width: 20.0,
    thermal_flags: 0,
    thermal_min_clearance: 5.0,
    thermal_min_spokes: 4,
    drill_oversize: 0.0,
    default_signal_via: '',
  };
  private m_parts: PART[] = [];
  private m_nets: NET[] = [];
  private m_routes: ROUTE[] = [];
  private m_texts: TEXT[] = [];
  private m_pours: POUR[] = [];
  private m_boardOutlines: POLYLINE[] = [];
  private m_decals = new Map<string, PART_DECAL>();

  GetParameters(): PARAMETERS {
    return this.m_parameters;
  }
  GetParts(): readonly PART[] {
    return this.m_parts;
  }
  GetNets(): readonly NET[] {
    return this.m_nets;
  }
  GetRoutes(): readonly ROUTE[] {
    return this.m_routes;
  }
  GetTexts(): readonly TEXT[] {
    return this.m_texts;
  }
  GetPours(): readonly POUR[] {
    return this.m_pours;
  }
  GetBoardOutlines(): readonly POLYLINE[] {
    return this.m_boardOutlines;
  }
  GetPartDecals(): ReadonlyMap<string, PART_DECAL> {
    return this.m_decals;
  }
  GetLayerCount(): number {
    return this.m_parameters.layer_count;
  }
  IsBasicUnits(): boolean {
    return true;
  }

  /** `IsBinaryPadsFile`: the magic and a known version in the first four bytes. */
  static IsBinaryPadsFile(aData: Uint8Array | null): boolean {
    if (!aData || aData.length < 4) return false;

    if (aData[0] !== 0x00 || aData[1] !== 0xff) return false;

    const version = aData[2]! | (aData[3]! << 8);
    return version === 0x2021 || version === 0x2025 || version === 0x2026 || version === 0x2027;
  }

  /** `Parse( aFileName )`, over the file's bytes. */
  Parse(aData: Uint8Array): void {
    this.m_data = aData;

    this.parseHeader();
    this.parseFooter();
    this.parseDirectory();
    this.parseBoardSetup();
    this.parseStringPool();
    this.parseMetadataRegion();
    this.parsePartPlacements();
    this.parseSection19Parts();
    this.parsePadStacks();
    this.parsePartDecals();
    this.parseFootprintDefs();
    this.parseLineVertices();
    this.parseBoardOutline();
    this.parseNetNames();
    this.parseTextRecords();
    this.parseRouteVertices();
    this.parseCopperPours();

    this.m_parts = this.m_parts.filter((p) => p.name !== '');
  }

  private isOldFormat(): boolean {
    return this.m_version === 0x2021;
  }

  private dirEntryCount(): number {
    switch (this.m_version) {
      case 0x2021:
        return 73;
      case 0x2025:
      case 0x2026:
      case 0x2027:
        return 74;
      default:
        return 0;
    }
  }

  private outOfBounds(aOffset: number): never {
    throw new IO_ERROR(
      `PADS binary read out of bounds at offset ${aOffset} (file size ${this.m_data.length})`,
    );
  }

  private readU8(aOffset: number): number {
    if (aOffset >= this.m_data.length) this.outOfBounds(aOffset);

    return this.m_data[aOffset]!;
  }

  private readU16(aOffset: number): number {
    if (aOffset + 2 > this.m_data.length) this.outOfBounds(aOffset);

    return this.m_data[aOffset]! | (this.m_data[aOffset + 1]! << 8);
  }

  private readU32(aOffset: number): number {
    if (aOffset + 4 > this.m_data.length) this.outOfBounds(aOffset);

    const d = this.m_data;
    return (
      (d[aOffset]! | (d[aOffset + 1]! << 8) | (d[aOffset + 2]! << 16) | (d[aOffset + 3]! << 24)) >>>
      0
    );
  }

  private readI32(aOffset: number): number {
    return this.readU32(aOffset) | 0;
  }

  /** A NUL-terminated printable string of at most aMaxLen bytes, trailing spaces trimmed. */
  private readFixedString(aOffset: number, aMaxLen: number): string {
    if (aOffset >= this.m_data.length) return '';

    const available = Math.min(aMaxLen, this.m_data.length - aOffset);
    let len = 0;

    while (len < available && this.m_data[aOffset + len] !== 0) len++;

    let result = '';

    for (let i = 0; i < len; ++i) {
      const b = this.m_data[aOffset + i]!;

      if (b < 0x20 || b >= 0x7f) return '';

      result += String.fromCharCode(b);
    }

    return result.replace(/ +$/, '');
  }

  private parseHeader(): void {
    if (this.m_data.length < HEADER_SIZE + FOOTER_SIZE)
      throw new IO_ERROR('File too small for PADS binary format');

    if (this.m_data[0] !== 0x00 || this.m_data[1] !== 0xff)
      throw new IO_ERROR('Invalid magic bytes');

    this.m_version = this.readU16(2);

    if (
      this.m_version !== 0x2021 &&
      this.m_version !== 0x2025 &&
      this.m_version !== 0x2026 &&
      this.m_version !== 0x2027
    )
      throw new IO_ERROR('Unsupported PADS binary version');

    this.m_numDirEntries = this.dirEntryCount();
  }

  private parseFooter(): void {
    const footerStart = this.m_data.length - FOOTER_SIZE;

    for (let i = 0; i < 38; i++) {
      if (this.m_data[footerStart + 4 + i] !== FOOTER_GUID.charCodeAt(i))
        throw new IO_ERROR('Invalid footer GUID');
    }

    // a size mismatch is only logged upstream (wxLogWarning)
  }

  private parseDirectory(): void {
    const dirStart = HEADER_SIZE;
    const dirSize = this.m_numDirEntries * DIR_ENTRY_SIZE;

    if (dirStart + dirSize > this.m_data.length)
      throw new IO_ERROR('File too small for section directory');

    let dataOffset = dirStart + dirSize;

    this.m_dirEntries = [];

    for (let i = 0; i < this.m_numDirEntries; ++i) {
      const off = dirStart + i * DIR_ENTRY_SIZE;
      const entry: DirEntry = {
        index: i,
        count: this.readU32(off),
        totalBytes: this.readU32(off + 4),
        dataOffset: 0,
        perItem: 0,
      };

      if (i > 0) {
        entry.dataOffset = dataOffset;

        if (entry.count > 0 && entry.totalBytes > 0)
          entry.perItem = Math.trunc(entry.totalBytes / entry.count);

        // uint32_t arithmetic
        dataOffset = (dataOffset + entry.totalBytes) >>> 0;
      }

      this.m_dirEntries.push(entry);
    }
  }

  private getSection(aIndex: number): DirEntry | null {
    if (aIndex >= 0 && aIndex < this.m_dirEntries.length) return this.m_dirEntries[aIndex]!;

    return null;
  }

  /** `sectionData`: where the section's bytes start, or null. */
  private sectionData(aIndex: number): number | null {
    const entry = this.getSection(aIndex);

    if (!entry || entry.totalBytes === 0) return null;

    if ((entry.dataOffset + entry.totalBytes) >>> 0 > this.m_data.length) return null;

    return entry.dataOffset;
  }

  private sectionSize(aIndex: number): number {
    const entry = this.getSection(aIndex);

    return entry ? entry.totalBytes : 0;
  }

  private toBasicCoordX(aRawValue: number): number {
    return (aRawValue - (this.m_originFound ? this.m_originX : 0)) | 0;
  }

  private toBasicCoordY(aRawValue: number): number {
    return (aRawValue - (this.m_originFound ? this.m_originY : 0)) | 0;
  }

  private toBasicAngle(aRawAngle: number): number {
    if (aRawAngle === 0) return 0.0;

    return aRawAngle / ANGLE_SCALE;
  }

  private parseBoardSetup(): void {
    const data = this.sectionData(1);
    const size = this.sectionSize(1);

    if (data === null || size < 160) return;

    const maxLayer = this.readU32(this.m_dirEntries[1]!.dataOffset + 4 * 4);

    this.m_parameters.layer_count = maxLayer >= 1 && maxLayer <= 64 ? maxLayer : 2;

    const secBase = this.m_dirEntries[1]!.dataOffset;

    if (size >= 68) {
      this.m_originX = this.readI32(secBase + 60);
      this.m_originY = this.readI32(secBase + 64);
      this.m_originFound = true;
      this.m_parameters.origin.x = this.m_originX;
      this.m_parameters.origin.y = this.m_originY;
    }

    this.m_parameters.units = UNIT_TYPE.MILS;
  }

  private parseStringPool(): void {
    const data = this.sectionData(57);
    const size = this.sectionSize(57);

    if (data === null || size === 0) return;

    this.m_stringPoolBytes = this.m_data.slice(data, data + size);
  }

  private pushPart(
    aBase: number,
    nameOff: number,
    xOff: number,
    yOff: number,
    angleOff: number,
  ): string | null {
    const refDes = this.readFixedString(aBase + nameOff, 16);

    if (refDes === '' || !isalnum(refDes.charCodeAt(0))) return null;

    const x = this.readI32(aBase + xOff);
    const y = yOff >= 0 ? this.readI32(aBase + yOff) : 0;
    const angleRaw = this.readI32(aBase + angleOff);

    const part = newPart();
    part.name = refDes;
    part.location.x = this.toBasicCoordX(x);
    part.location.y = this.toBasicCoordY(y);
    part.rotation = this.toBasicAngle(angleRaw);
    part.bottom_layer = false;
    part.units = 'M';
    this.m_parts.push(part);

    return refDes;
  }

  private partOffsets(): { nameOff: number; xOff: number; yOff: number; angleOff: number } {
    return this.isOldFormat()
      ? { nameOff: 76, xOff: 92, yOff: -1, angleOff: 4 }
      : { nameOff: 44, xOff: 60, yOff: 64, angleOff: 68 };
  }

  private parsePartPlacements(): void {
    const entry = this.getSection(22);

    if (!entry || entry.count === 0 || entry.perItem === 0) return;

    if (this.sectionData(22) === null) return;

    const recSize = entry.perItem;
    const { nameOff, xOff, yOff, angleOff } = this.partOffsets();

    for (let i = 0; i < entry.count; ++i) {
      const off = i * recSize;

      if (off + recSize > entry.totalBytes) break;

      this.pushPart(entry.dataOffset + off, nameOff, xOff, yOff, angleOff);
    }
  }

  private parseSection19Parts(): void {
    const { nameOff, xOff, yOff, angleOff } = this.partOffsets();
    const feffOff = this.isOldFormat() ? 28 : 92;
    const recSize = feffOff + 2;

    const existingRefs = new Set<string>(this.m_parts.map((p) => p.name));

    for (const secIdx of [19, 21]) {
      const entry = this.getSection(secIdx);

      if (!entry || entry.totalBytes === 0) continue;

      const data = this.sectionData(secIdx);
      const size = this.sectionSize(secIdx);

      if (data === null || size === 0) continue;

      for (let pos = 0; pos + 1 < size; ++pos) {
        if (this.m_data[data + pos] !== 0xfe || this.m_data[data + pos + 1] !== 0xff) continue;

        const recStart = pos - feffOff;

        if (recStart < 0 || recStart + recSize > size) continue;

        const base = entry.dataOffset + recStart;
        const refDes = this.readFixedString(base + nameOff, 16);

        if (refDes === '' || !isalnum(refDes.charCodeAt(0))) continue;

        if (existingRefs.has(refDes)) continue;

        this.pushPart(base, nameOff, xOff, yOff, angleOff);
        existingRefs.add(refDes);
      }
    }
  }

  private parsePadStacks(): void {
    const entry = this.getSection(4);

    if (!entry || entry.count === 0 || entry.perItem === 0) return;

    if (this.sectionData(4) === null) return;

    const isNew = !this.isOldFormat();
    const recSize = entry.perItem;

    for (let i = 0; i < entry.count; ++i) {
      const off = i * recSize;

      if (off + recSize > entry.totalBytes) break;

      const base = entry.dataOffset + off;
      const o = isNew
        ? { w: 28, d: 32, f: 36, a: 48, m: 56, s: 57 }
        : { w: 24, d: 28, f: 32, a: 40, m: 48, s: 49 };

      const padWidth = this.readI32(base + o.w);
      const drill = this.readI32(base + o.d);
      const finLength = this.readI32(base + o.f);
      const angleRaw = this.readI32(base + o.a);
      const marker = this.readU8(base + o.m);
      const shapeCode = this.readU8(base + o.s);
      this.readU16(base + o.s + 1); // layerCount

      if (marker !== 0xfe) continue;

      const psl = newPadStackLayer();
      psl.layer = 0;
      psl.shape = PAD_SHAPE_NAMES.get(shapeCode) ?? 'R';
      psl.sizeA = padWidth;
      psl.sizeB = padWidth;
      psl.drill = drill;
      psl.plated = drill > 0;
      psl.rotation = this.toBasicAngle(angleRaw);
      psl.finger_offset = finLength;

      const list = this.m_padStackCache.get(i) ?? [];
      list.push(psl);
      this.m_padStackCache.set(i, list);
    }
  }

  private parsePartDecals(): void {
    const entry = this.getSection(10);

    if (!entry || entry.count === 0 || entry.perItem === 0) return;

    if (this.sectionData(10) === null) return;

    const isNew = !this.isOldFormat();
    const recSize = entry.perItem;

    for (let i = 0; i < entry.count; ++i) {
      const off = i * recSize;

      if (off + recSize > entry.totalBytes) break;

      const base = entry.dataOffset + off;
      let name: string;
      let units = 'I';

      if (isNew) {
        name = this.readFixedString(base + 44, 32);
        const unitFlag = this.readU8(base + 76);
        units = unitFlag === 0x4d ? 'M' : 'I';
      } else {
        name = this.readFixedString(base + 28, 32);
      }

      if (name === '') continue;

      this.m_decals.set(name, {
        name,
        units,
        items: [],
        attributes: [],
        terminals: [],
        pad_stacks: new Map(),
      });
    }
  }

  private parseFootprintDefs(): void {
    if (this.isOldFormat()) return;

    const entry = this.getSection(17);

    if (!entry || entry.count === 0 || entry.perItem < 188) return;

    if (this.sectionData(17) === null) return;

    const decalEntry = this.getSection(10);
    const decalIndexToName = new Map<number, string>();

    if (decalEntry && decalEntry.count > 0 && decalEntry.perItem > 0) {
      for (let i = 0; i < decalEntry.count; ++i) {
        const dOff = i * decalEntry.perItem;

        if (dOff + decalEntry.perItem > decalEntry.totalBytes) break;

        const decalName = this.readFixedString(decalEntry.dataOffset + dOff + 44, 32);

        if (decalName !== '') decalIndexToName.set(i, decalName);
      }
    }

    const recSize = entry.perItem;
    const fpTypeToDecal = new Map<string, string>();

    for (let i = 0; i < entry.count; ++i) {
      const off = i * recSize;

      if (off + recSize > entry.totalBytes) break;

      const base = entry.dataOffset + off;
      const decalIdx = this.readU32(base + 112);
      const fpTypeName = this.readFixedString(base + 156, 32);

      if (fpTypeName === '') continue;

      const decalName = decalIndexToName.get(decalIdx);

      if (decalName !== undefined) fpTypeToDecal.set(fpTypeName, decalName);
    }

    this.m_fpTypeToDecal = fpTypeToDecal;
  }

  private parseLineVertices(): void {
    const entry = this.getSection(12);

    if (!entry || entry.count === 0) return;

    if (this.sectionData(12) === null) return;

    this.m_lineVertices = [];

    for (let i = 0; i < entry.count; ++i) {
      const off = i * 12;

      if (off + 12 > entry.totalBytes) break;

      const base = entry.dataOffset + off;
      this.m_lineVertices.push({
        x: this.readI32(base),
        y: this.readI32(base + 4),
        extra: this.readU32(base + 8),
      });
    }
  }

  private parseBoardOutline(): void {
    if (this.m_version !== 0x2026) return;

    if (this.m_lineVertices.length === 0) return;

    const entry = this.getSection(21);

    if (!entry || entry.count === 0) return;

    if (this.sectionData(21) === null) return;

    let vertexIdx = 0;

    for (let i = 0; i < entry.count; ++i) {
      const off = i * 16;

      if (off + 16 > entry.totalBytes) break;

      const base = entry.dataOffset + off;
      const vertexCount = this.readU32(base);
      const sentinel = this.readU32(base + 12);

      if (sentinel !== 0xffffffff) continue;

      if (
        vertexCount === 0 ||
        vertexCount > 10000 ||
        vertexIdx + vertexCount > this.m_lineVertices.length
      )
        continue;

      const outline: POLYLINE = { layer: 1, width: 0.0, closed: true, points: [] };

      for (let v = 0; v < vertexCount; ++v) {
        const lv = this.m_lineVertices[vertexIdx + v]!;
        outline.points.push(arcPoint(lv.x, lv.y));
      }

      vertexIdx += vertexCount;

      if (outline.points.length >= 3) this.m_boardOutlines.push(outline);
    }
  }

  private isValidNetName(aName: string): boolean {
    if (aName === '') return false;

    const first = aName.charCodeAt(0);

    return isalpha(first) || isdigit(first) || '+~_/'.includes(aName[0]!);
  }

  private parseNetNames(): void {
    const existing = new Set<string>();

    const add = (name: string): void => {
      this.m_nets.push({ name, pins: [] });
      existing.add(name);
    };

    if (!this.isOldFormat()) {
      const entry23 = this.getSection(23);

      if (entry23 && entry23.count > 0 && entry23.perItem === 424) {
        for (let i = 0; i < entry23.count; ++i) {
          const off = i * 424;

          if (off + 424 > entry23.totalBytes) break;

          const name = this.readFixedString(entry23.dataOffset + off + 116, 48);

          if (name !== '' && this.isValidNetName(name) && !existing.has(name)) add(name);
        }
      }

      const entry22 = this.getSection(22);

      if (entry22 && entry22.count > 0 && entry22.perItem === 112) {
        for (let i = 0; i < entry22.count; ++i) {
          const off = i * 112;

          if (off + 112 > entry22.totalBytes) break;

          const base = entry22.dataOffset + off;

          for (const nameOff of [28, 52, 76]) {
            const name = this.readFixedString(base + nameOff, 24);

            if (name !== '' && this.isValidNetName(name) && !existing.has(name)) {
              const netIdx = this.readU32(base + nameOff - 4);

              if (netIdx < 100000 || netIdx >= 0xffff0000) {
                add(name);
                break;
              }
            }
          }
        }
      }
    } else {
      const entry23 = this.getSection(23);

      if (entry23 && entry23.count > 0 && entry23.perItem === 144) {
        for (let i = 0; i < entry23.count; ++i) {
          const off = i * 144;

          if (off + 144 > entry23.totalBytes) break;

          const base = entry23.dataOffset + off;
          const netIdx = this.readU32(base + 8);
          const name = this.readFixedString(base + 12, 48);

          if (name !== '' && this.isValidNetName(name) && netIdx < 100000 && !existing.has(name))
            add(name);
        }
      }

      const entry22 = this.getSection(22);

      if (entry22 && entry22.count > 0 && entry22.perItem === 96) {
        for (let i = 0; i < entry22.count; ++i) {
          const off = i * 96;

          if (off + 96 > entry22.totalBytes) break;

          const base = entry22.dataOffset + off;

          for (const nameOff of [12, 60]) {
            const name = this.readFixedString(base + nameOff, 48);

            if (name !== '' && this.isValidNetName(name) && !existing.has(name)) {
              const netIdx = this.readU32(base + nameOff - 4);

              if (netIdx < 100000) {
                add(name);
                break;
              }
            }
          }
        }
      }

      const entry19 = this.getSection(19);

      if (entry19 && entry19.count > 0) {
        const sec19 = this.sectionData(19);

        if (sec19 !== null) {
          const d = this.m_data;
          const sec19Size = entry19.totalBytes;

          for (let pos = 0; pos + 4 < sec19Size; ++pos) {
            const val =
              (d[sec19 + pos]! |
                (d[sec19 + pos + 1]! << 8) |
                (d[sec19 + pos + 2]! << 16) |
                (d[sec19 + pos + 3]! << 24)) >>>
              0;

            if (val === 0xffffffff) {
              for (let scan = pos + 4; scan + 2 < sec19Size && scan < pos + 40; ++scan) {
                const c = d[sec19 + scan]!;

                if (c !== 0 && isalpha(c)) {
                  const name = this.readFixedString(entry19.dataOffset + scan, 48);

                  if (name !== '' && this.isValidNetName(name) && !existing.has(name)) add(name);

                  break;
                }
              }

              pos += 3;
            }
          }
        }
      }
    }
  }

  private parseMetadataRegion(): void {
    if (this.m_originFound) return;

    let lastDataEnd = HEADER_SIZE + this.m_numDirEntries * DIR_ENTRY_SIZE;

    for (const entry of this.m_dirEntries) {
      if (entry.index > 0 && entry.totalBytes > 0) {
        const end = entry.dataOffset + entry.totalBytes;

        if (end > lastDataEnd) lastDataEnd = end;
      }
    }

    const footerStart = this.m_data.length - FOOTER_SIZE;

    if (lastDataEnd >= footerStart) return;

    const dirEnd = HEADER_SIZE + this.m_numDirEntries * DIR_ENTRY_SIZE;
    this.parseDftConfig(dirEnd, footerStart);
  }

  private matches(aPos: number, aText: string): boolean {
    for (let i = 0; i < aText.length; i++)
      if (this.m_data[aPos + i] !== aText.charCodeAt(i)) return false;

    return true;
  }

  private parseDftConfig(aStart: number, aEnd: number): void {
    const DFT_MARKER = 'DFT_CONFIGURATION';
    const markerLen = DFT_MARKER.length;
    const d = this.m_data;

    for (let pos = aStart; pos + markerLen + 1 < aEnd; ++pos) {
      if (this.matches(pos, DFT_MARKER) && d[pos + markerLen] === 0) {
        let configStart = pos + markerLen + 1;

        while (configStart < aEnd) {
          if (d[configStart] === 0) {
            ++configStart;
            continue;
          }

          if (configStart + 7 <= aEnd && this.matches(configStart, 'PARENT\0')) {
            configStart += 7;
            continue;
          }

          break;
        }

        if (configStart >= aEnd) return;

        let hasDot = false;

        if (configStart + 16 <= aEnd) {
          for (let i = configStart; i < configStart + 16; ++i) {
            if (d[i] === 0x2e) {
              hasDot = true;
              break;
            }
          }
        }

        const config = hasDot
          ? this.parseDftDotPadded(configStart, aEnd)
          : this.parseDftNullSeparated(configStart, aEnd);

        const xs = config.get('X');
        const ys = config.get('Y');

        if (xs !== undefined && ys !== undefined) {
          // std::stod throws where nothing converts; the origin is then left unset
          const x = ParseDouble(xs, Number.NaN);
          const y = Number.isNaN(x) ? Number.NaN : ParseDouble(ys, Number.NaN);

          if (!Number.isNaN(x) && !Number.isNaN(y)) {
            this.m_originX = Math.trunc(x) | 0;
            this.m_originY = Math.trunc(y) | 0;
            this.m_originFound = true;
            this.m_parameters.origin.x = this.m_originX;
            this.m_parameters.origin.y = this.m_originY;
          }
        }

        return;
      }
    }
  }

  private bytes(aStart: number, aEnd: number): string {
    let s = '';

    for (let i = aStart; i < aEnd; i++) s += String.fromCharCode(this.m_data[i]!);

    return s;
  }

  private parseDftDotPadded(aPos: number, aEnd: number): Map<string, string> {
    const config = new Map<string, string>();
    const d = this.m_data;

    while (aPos + 16 <= aEnd) {
      let validKey = true;

      for (let i = aPos; i < aPos + 16; ++i) {
        const b = d[i]!;

        if (!((b >= 0x20 && b <= 0x7e) || b === 0x00)) {
          validKey = false;
          break;
        }
      }

      if (!validKey) break;

      let key = '';

      for (let i = aPos; i < aPos + 16; ++i) {
        if (d[i] === 0 || d[i] === 0x2e) break;

        key += String.fromCharCode(d[i]!);
      }

      if (key === '') break;

      aPos += 16;

      if (aPos < aEnd && d[aPos] === 0) ++aPos;

      const valStart = aPos;

      while (aPos < aEnd && d[aPos] !== 0) ++aPos;

      if (aPos > valStart) config.set(key, this.bytes(valStart, aPos));

      if (aPos < aEnd) ++aPos;

      if (aPos + 7 <= aEnd && this.matches(aPos, 'PARENT\0')) aPos += 7;
    }

    return config;
  }

  private parseDftNullSeparated(aPos: number, aEnd: number): Map<string, string> {
    const config = new Map<string, string>();
    const d = this.m_data;

    while (aPos < aEnd) {
      const keyStart = aPos;

      while (aPos < aEnd && d[aPos] !== 0) ++aPos;

      if (aPos === keyStart) break;

      let validKey = true;

      for (let i = keyStart; i < aPos; ++i) {
        if (d[i]! < 0x20 || d[i]! > 0x7e) {
          validKey = false;
          break;
        }
      }

      if (!validKey) break;

      const key = this.bytes(keyStart, aPos);

      if (aPos < aEnd) ++aPos;

      if (key === 'PARENT') continue;

      const valStart = aPos;

      while (aPos < aEnd && d[aPos] !== 0) ++aPos;

      if (aPos <= valStart) break;

      config.set(key, this.bytes(valStart, aPos));

      if (aPos < aEnd) ++aPos;
    }

    return config;
  }

  private resolveString(aByteOffset: number): string {
    const pool = this.m_stringPoolBytes;

    if (pool.length === 0 || aByteOffset >= pool.length) return '';

    let s = '';

    for (let i = aByteOffset; i < pool.length && pool[i] !== 0; i++) {
      const b = pool[i]!;

      if (b < 0x20 || b >= 0x7f) return '';

      s += String.fromCharCode(b);
    }

    return s;
  }

  private parseTextRecords(): void {
    const entry = this.getSection(8);

    if (!entry || entry.count === 0 || entry.perItem < 72) return;

    if (this.sectionData(8) === null) return;

    for (let i = 0; i < entry.count; ++i) {
      const off = i * 72;

      if (off + 72 > entry.totalBytes) break;

      const base = entry.dataOffset + off;
      const strOffset = this.readU32(base);
      const height = this.readI32(base + 28);
      const linewidth = this.readI32(base + 32);
      const x = this.readI32(base + 44);
      const y = this.readI32(base + 48);
      const angleRaw = this.readI32(base + 52);
      const layer = this.readU8(base + 56);

      const content = this.resolveString(strOffset);

      if (content === '') continue;

      const text = newText();
      text.content = content;
      text.location.x = this.toBasicCoordX(x);
      text.location.y = this.toBasicCoordY(y);
      text.height = height;
      text.width = linewidth;
      text.layer = layer;
      text.rotation = this.toBasicAngle(angleRaw);
      this.m_texts.push(text);
    }
  }

  private parseRouteVertices(): void {
    if (this.isOldFormat()) return;

    this.m_routeSegments = [];
    this.m_viaLocations = [];

    const entry60 = this.getSection(60);

    if (!entry60 || entry60.count === 0 || entry60.perItem === 0 || this.sectionData(60) === null)
      return;

    const n60 = entry60.count;
    const r60 = entry60.perItem;

    const sampleCount = Math.min(n60, 100);
    let bestPos = -1;
    let bestCount = 0;

    for (let candidate = 8; candidate < 28 && candidate + 8 < r60; ++candidate) {
      let hits = 0;

      for (let s = 0; s < sampleCount; ++s) {
        const recOff = s * r60;

        if (recOff + r60 > entry60.totalBytes) break;

        if (this.readU8(entry60.dataOffset + recOff + candidate) === 0x80) hits++;
      }

      if (hits > bestCount) {
        bestCount = hits;
        bestPos = candidate;
      }
    }

    if (bestCount < Math.trunc(sampleCount / 2)) return;

    const markerOffset = bestPos;
    const xyOffset = markerOffset + 1;

    const readSec60XY = (aRecIdx: number): [number, number] | null => {
      if (aRecIdx >= n60) return null;

      const off = aRecIdx * r60;

      if (off + r60 > entry60.totalBytes) return null;

      const base = entry60.dataOffset + off;

      if (this.readU8(base + markerOffset) !== 0x80) return null;

      return [this.readI32(base + xyOffset), this.readI32(base + xyOffset + 4)];
    };

    const SEC24_SENTINEL = 0xfe000000;
    const SEC24_REC_SIZE = 68;

    const entry24 = this.getSection(24);

    if (
      entry24 &&
      entry24.count > 0 &&
      entry24.perItem === SEC24_REC_SIZE &&
      this.sectionData(24) !== null
    ) {
      for (let i = 0; i < entry24.count; ++i) {
        const off = i * SEC24_REC_SIZE;

        if (off + SEC24_REC_SIZE > entry24.totalBytes) break;

        const base = entry24.dataOffset + off;

        if (this.readU32(base + 20) !== SEC24_SENTINEL) continue;

        const sec60Start = this.readI32(base + 8);
        const sec60End = this.readI32(base + 12);

        if (sec60Start < 0 || sec60End < 0) continue;

        const p1 = readSec60XY(sec60Start);

        if (!p1) continue;

        const p2 = readSec60XY(sec60End);

        if (!p2) continue;

        this.m_routeSegments.push({
          x1: p1[0],
          y1: p1[1],
          x2: p2[0],
          y2: p2[1],
          width: this.readI32(base + 24),
        });
      }
    }

    const entry59 = this.getSection(59);

    if (entry59 && entry59.count > 0 && entry59.perItem > 0 && this.sectionData(59) !== null) {
      const recSize = entry59.perItem;

      for (let i = 0; i < entry59.count; ++i) {
        const off = i * recSize;

        if (off + recSize > entry59.totalBytes) break;

        const base = entry59.dataOffset + off;

        if (this.readU8(base + markerOffset) !== 0x80) continue;

        this.m_viaLocations.push({
          x: this.readI32(base + xyOffset),
          y: this.readI32(base + xyOffset + 4),
        });
      }
    }

    if (this.m_routeSegments.length === 0 && this.m_viaLocations.length === 0) return;

    const route: ROUTE = {
      net_name: '',
      tracks: [],
      vias: [],
      pins: [],
      teardrops: [],
      jumpers: [],
    };

    for (const seg of this.m_routeSegments) {
      const track: TRACK = { layer: 0, width: seg.width, points: [] };
      track.points.push(arcPoint(seg.x1, seg.y1));
      track.points.push(arcPoint(seg.x2, seg.y2));
      route.tracks.push(track);
    }

    for (const via of this.m_viaLocations)
      route.vias.push({ name: '', location: { x: via.x, y: via.y } });

    this.m_routes.push(route);
  }

  private parseCopperPours(): void {
    // not decoded upstream either
  }

  GetLayerInfos(): LAYER_INFO[] {
    const infos: LAYER_INFO[] = [];
    const layerCount = this.m_parameters.layer_count;

    for (let i = 1; i <= layerCount; ++i)
      infos.push(newLayerInfo(i, `Layer ${i}`, PADS_LAYER_FUNCTION.ROUTING, true, true));

    return infos;
  }
}
