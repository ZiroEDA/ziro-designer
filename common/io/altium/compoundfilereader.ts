// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
// Portions derived from compoundfilereader (MIT), copyright Hsiao-Chih Lai.
/**
 * `thirdparty/compoundfilereader/compoundfilereader.h` and `utf.h`: the
 * Microsoft Compound File (and Property Set) reader KiCad's Altium importers
 * sit on.
 *
 *     Format specification:
 *         MS-CFB: https://msdn.microsoft.com/en-us/library/dd942138.aspx
 *         MS-OLEPS: https://msdn.microsoft.com/en-us/library/dd942421.aspx
 *
 * Upstream it is its own CMake target under `thirdparty/`; here it sits next to
 * its only consumer, `altium_binary_parser.ts`, because a new workspace package
 * would need a lockfile change. The reader operates on the buffer in place, as
 * upstream's does: an entry is a view of its 128 bytes, decoded once.
 */

export class CFBException extends Error {
  constructor(desc: string) {
    super(desc);
    this.name = 'CFBException';
  }
}

export class WrongFormat extends CFBException {
  constructor() {
    super('Wrong file format');
  }
}

export class FileCorrupted extends CFBException {
  constructor() {
    super('File corrupted');
  }
}

/** `std::invalid_argument( "" )`. */
class InvalidArgument extends Error {
  constructor() {
    super('');
    this.name = 'invalid_argument';
  }
}

/** `sizeof( COMPOUND_FILE_HDR )`: 76 bytes of fields + 109 DIFAT entries. */
const SIZEOF_COMPOUND_FILE_HDR = 76 + 109 * 4;

/** `sizeof( COMPOUND_FILE_ENTRY )`. */
const SIZEOF_COMPOUND_FILE_ENTRY = 128;

/** `struct COMPOUND_FILE_HDR`, the fields the reader uses. */
export interface COMPOUND_FILE_HDR {
  minorVersion: number;
  majorVersion: number;
  byteOrder: number;
  sectorShift: number;
  miniSectorShift: number;
  numDirectorySector: number;
  numFATSector: number;
  firstDirectorySectorLocation: number;
  transactionSignatureNumber: number;
  miniStreamCutoffSize: number;
  firstMiniFATSectorLocation: number;
  numMiniFATSector: number;
  firstDIFATSectorLocation: number;
  numDIFATSector: number;
  headerDIFAT: Uint32Array;
}

/** `struct COMPOUND_FILE_ENTRY` (#pragma pack 1, 128 bytes). */
export interface COMPOUND_FILE_ENTRY {
  /** `uint16_t name[32]`. */
  readonly name: Uint16Array;
  /** Byte length of the name, including the terminating NUL. */
  readonly nameLen: number;
  readonly type: number;
  readonly colorFlag: number;
  /** Note that it's actually the left/right child in the RB-tree. */
  readonly leftSiblingID: number;
  /** So entry.leftSibling.rightSibling does NOT go back to entry. */
  readonly rightSiblingID: number;
  readonly childID: number;
  readonly stateBits: number;
  readonly startSectorLocation: number;
  /** `uint64_t size`; exact below 2^53. */
  readonly size: number;
}

export const MAXREGSECT = 0xfffffffa;

/** `utf16string`: a UTF-16 string, as its JS string. */
export type utf16string = string;

/** `EnumFilesCallback`: non-zero stops the walk of that level. */
export type EnumFilesCallback = (
  entry: COMPOUND_FILE_ENTRY,
  dir: utf16string,
  level: number,
) => number;

/**
 * `UTF16ToWstring( u16, len )` / `UTF16ToUTF8( u16 )` over an entry name: the
 * code units up to the first NUL. A JS string is UTF-16, so the surrogate
 * pairing both helpers do is the string's own.
 */
export function UTF16ToWstring(u16: Uint16Array): string {
  let ret = '';

  for (let i = 0; i < u16.length && u16[i] !== 0; i++) ret += String.fromCharCode(u16[i]!);

  return ret;
}

/** `UTF16ToUTF8( u16 )`: the same text; the UTF-8 byte form is the caller's `std::string`. */
export const UTF16ToUTF8 = UTF16ToWstring;

export class CompoundFileReader {
  private readonly m_buffer: Uint8Array;
  private readonly m_view: DataView;
  private readonly m_bufferLen: number;
  private readonly m_hdr: COMPOUND_FILE_HDR;
  private m_sectorSize: number;
  private readonly m_minisectorSize: number;
  private m_miniStreamStartSector: number;
  /** Entries decoded so far, so one id is always one object (upstream: one address). */
  private readonly m_entries = new Map<number, COMPOUND_FILE_ENTRY>();

  constructor(buffer: Uint8Array | null, len?: number) {
    if (buffer === null || buffer.length === 0 || len === 0) throw new InvalidArgument();

    this.m_buffer = buffer;
    this.m_bufferLen = len ?? buffer.length;
    this.m_view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.m_sectorSize = 512;
    this.m_minisectorSize = 64;
    this.m_miniStreamStartSector = 0;

    const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

    if (
      this.m_bufferLen < SIZEOF_COMPOUND_FILE_HDR ||
      signature.some((b, i) => this.m_buffer[i] !== b)
    ) {
      throw new WrongFormat();
    }

    const v = this.m_view;
    const headerDIFAT = new Uint32Array(109);

    for (let i = 0; i < 109; i++) headerDIFAT[i] = v.getUint32(76 + i * 4, true);

    this.m_hdr = {
      minorVersion: v.getUint16(24, true),
      majorVersion: v.getUint16(26, true),
      byteOrder: v.getUint16(28, true),
      sectorShift: v.getUint16(30, true),
      miniSectorShift: v.getUint16(32, true),
      numDirectorySector: v.getUint32(40, true),
      numFATSector: v.getUint32(44, true),
      firstDirectorySectorLocation: v.getUint32(48, true),
      transactionSignatureNumber: v.getUint32(52, true),
      miniStreamCutoffSize: v.getUint32(56, true),
      firstMiniFATSectorLocation: v.getUint32(60, true),
      numMiniFATSector: v.getUint32(64, true),
      firstDIFATSectorLocation: v.getUint32(68, true),
      numDIFATSector: v.getUint32(72, true),
      headerDIFAT,
    };

    this.m_sectorSize = this.m_hdr.majorVersion === 3 ? 512 : 4096;

    // The file must contains at least 3 sectors
    if (this.m_bufferLen < this.m_sectorSize * 3) throw new FileCorrupted();

    const root = this.GetEntry(0);
    if (root === null) throw new FileCorrupted();

    this.m_miniStreamStartSector = root.startSectorLocation;
  }

  /**
   * Get entry (directory or file) by its ID.
   * Pass "0" to get the root directory entry. -- This is the start point to navigate the compound file.
   * Use the returned object to access child entries.
   */
  GetEntry(entryID: number): COMPOUND_FILE_ENTRY | null {
    if (entryID === 0xffffffff) return null;

    if (Math.floor(this.m_bufferLen / SIZEOF_COMPOUND_FILE_ENTRY) <= entryID)
      throw new InvalidArgument();

    const cached = this.m_entries.get(entryID);
    if (cached) return cached;

    const [sector, offset] = this.LocateFinalSector(
      this.m_hdr.firstDirectorySectorLocation,
      entryID * SIZEOF_COMPOUND_FILE_ENTRY,
    );
    const addr = this.SectorOffsetToAddress(sector, offset);

    // An entry that straddles the end of the buffer reads zeros, where upstream reads past it.
    const byte = (o: number): number =>
      addr + o < this.m_bufferLen ? this.m_buffer[addr + o]! : 0;
    const u16 = (o: number): number => byte(o) | (byte(o + 1) << 8);
    const u32 = (o: number): number => (u16(o) | (u16(o + 2) << 16)) >>> 0;

    const name = new Uint16Array(32);
    for (let i = 0; i < 32; i++) name[i] = u16(i * 2);

    const entry: COMPOUND_FILE_ENTRY = {
      name,
      nameLen: u16(64),
      type: byte(66),
      colorFlag: byte(67),
      leftSiblingID: u32(68),
      rightSiblingID: u32(72),
      childID: u32(76),
      stateBits: u32(96),
      startSectorLocation: u32(116),
      size: u32(120) + u32(124) * 0x100000000,
    };

    this.m_entries.set(entryID, entry);
    return entry;
  }

  GetRootEntry(): COMPOUND_FILE_ENTRY | null {
    return this.GetEntry(0);
  }

  GetFileInfo(): COMPOUND_FILE_HDR {
    return this.m_hdr;
  }

  /**
   * Get file(stream) data start with "offset".
   * The buffer must have enough space to store "len" bytes. Typically "len" is derived by the steam length.
   */
  ReadFile(entry: COMPOUND_FILE_ENTRY, offset: number, buffer: Uint8Array, len: number): void {
    if (entry.size < offset || entry.size - offset < len) throw new InvalidArgument();

    if (entry.size < this.m_hdr.miniStreamCutoffSize) {
      this.ReadMiniStream(entry.startSectorLocation, offset, buffer, len);
    } else {
      this.ReadStream(entry.startSectorLocation, offset, buffer, len);
    }
  }

  IsPropertyStream(entry: COMPOUND_FILE_ENTRY): boolean {
    // defined in [MS-OLEPS] 2.23 "Property Set Stream and Storage Names"
    return entry.name[0] === 5;
  }

  IsStream(entry: COMPOUND_FILE_ENTRY): boolean {
    return entry.type === 2;
  }

  EnumFiles(entry: COMPOUND_FILE_ENTRY, maxLevel: number, callback: EnumFilesCallback): void {
    const dir: utf16string = '';
    this.EnumNodes(this.GetEntry(entry.childID), 0, maxLevel, dir, callback);
  }

  // Enum entries with same level, including 'entry' itself
  private EnumNodes(
    entry: COMPOUND_FILE_ENTRY | null,
    currentLevel: number,
    maxLevel: number,
    dir: utf16string,
    callback: EnumFilesCallback,
  ): void {
    if (maxLevel > 0 && currentLevel >= maxLevel) return;
    if (entry === null) return;

    if (callback(entry, dir, currentLevel + 1) !== 0) return;

    const child = this.GetEntry(entry.childID);
    if (child !== null) {
      let newDir = dir;
      if (dir.length !== 0) newDir += '\n';
      // newDir.append( entry->name, entry->nameLen / 2 ): the name's code units, NUL included
      for (let i = 0; i < entry.nameLen >> 1; i++)
        newDir += String.fromCharCode(i < 32 ? entry.name[i]! : 0);
      this.EnumNodes(this.GetEntry(entry.childID), currentLevel + 1, maxLevel, newDir, callback);
    }

    this.EnumNodes(this.GetEntry(entry.leftSiblingID), currentLevel, maxLevel, dir, callback);
    this.EnumNodes(this.GetEntry(entry.rightSiblingID), currentLevel, maxLevel, dir, callback);
  }

  private ReadStream(sectorIn: number, offsetIn: number, buffer: Uint8Array, lenIn: number): void {
    let [sector, offset] = this.LocateFinalSector(sectorIn, offsetIn);
    let len = lenIn;
    let out = 0;

    // copy as many as possible in each step
    // copylen typically iterate as: m_sectorSize - offset   -->   m_sectorSize   -->   m_sectorSize  --> ... -->    remaining
    while (len > 0) {
      const src = this.SectorOffsetToAddress(sector, offset);
      const copylen = Math.min(len, this.m_sectorSize - offset);
      if (this.m_bufferLen < src + copylen) throw new FileCorrupted();

      buffer.set(this.m_buffer.subarray(src, src + copylen), out);
      out += copylen;
      len -= copylen;
      sector = this.GetNextSector(sector);
      offset = 0;
    }
  }

  // Same logic as "ReadStream" except that use MiniStream functions instead
  private ReadMiniStream(
    sectorIn: number,
    offsetIn: number,
    buffer: Uint8Array,
    lenIn: number,
  ): void {
    let [sector, offset] = this.LocateFinalMiniSector(sectorIn, offsetIn);
    let len = lenIn;
    let out = 0;

    // copy as many as possible in each step
    // copylen typically iterate as: m_sectorSize - offset   -->   m_sectorSize   -->   m_sectorSize  --> ... -->    remaining
    while (len > 0) {
      const src = this.MiniSectorOffsetToAddress(sector, offset);
      const copylen = Math.min(len, this.m_minisectorSize - offset);
      if (this.m_bufferLen < src + copylen) throw new FileCorrupted();

      buffer.set(this.m_buffer.subarray(src, src + copylen), out);
      out += copylen;
      len -= copylen;
      sector = this.GetNextMiniSector(sector);
      offset = 0;
    }
  }

  private GetNextSector(sector: number): number {
    // lookup FAT
    const entriesPerSector = this.m_sectorSize / 4;
    const fatSectorNumber = Math.floor(sector / entriesPerSector);
    const fatSectorLocation = this.GetFATSectorLocation(fatSectorNumber);
    return this.ParseUint32(
      this.SectorOffsetToAddress(fatSectorLocation, (sector % entriesPerSector) * 4),
    );
  }

  private GetNextMiniSector(miniSector: number): number {
    const [sector, offset] = this.LocateFinalSector(
      this.m_hdr.firstMiniFATSectorLocation,
      miniSector * 4,
    );
    return this.ParseUint32(this.SectorOffsetToAddress(sector, offset));
  }

  /** `helper::ParseUint32`. */
  private ParseUint32(addr: number): number {
    return this.m_view.getUint32(addr, true);
  }

  // Get absolute address from sector and offset.
  private SectorOffsetToAddress(sector: number, offset: number): number {
    if (
      sector >= MAXREGSECT ||
      offset >= this.m_sectorSize ||
      this.m_bufferLen <= this.m_sectorSize * sector + this.m_sectorSize + offset
    ) {
      throw new FileCorrupted();
    }

    return this.m_sectorSize + this.m_sectorSize * sector + offset;
  }

  private MiniSectorOffsetToAddress(sectorIn: number, offsetIn: number): number {
    if (
      sectorIn >= MAXREGSECT ||
      offsetIn >= this.m_minisectorSize ||
      this.m_bufferLen <= this.m_minisectorSize * sectorIn + offsetIn
    ) {
      throw new FileCorrupted();
    }

    const [sector, offset] = this.LocateFinalSector(
      this.m_miniStreamStartSector,
      sectorIn * this.m_minisectorSize + offsetIn,
    );
    return this.SectorOffsetToAddress(sector, offset);
  }

  // Locate the final sector/offset when original offset expands multiple sectors
  private LocateFinalSector(sectorIn: number, offsetIn: number): [number, number] {
    let sector = sectorIn;
    let offset = offsetIn;

    while (offset >= this.m_sectorSize) {
      offset -= this.m_sectorSize;
      sector = this.GetNextSector(sector);
    }

    return [sector, offset];
  }

  private LocateFinalMiniSector(sectorIn: number, offsetIn: number): [number, number] {
    let sector = sectorIn;
    let offset = offsetIn;

    while (offset >= this.m_minisectorSize) {
      offset -= this.m_minisectorSize;
      sector = this.GetNextMiniSector(sector);
    }

    return [sector, offset];
  }

  private GetFATSectorLocation(fatSectorNumberIn: number): number {
    let fatSectorNumber = fatSectorNumberIn;

    if (fatSectorNumber < 109) {
      return this.m_hdr.headerDIFAT[fatSectorNumber]!;
    }

    fatSectorNumber -= 109;
    const entriesPerSector = this.m_sectorSize / 4 - 1;
    let difatSectorLocation = this.m_hdr.firstDIFATSectorLocation;

    while (fatSectorNumber >= entriesPerSector) {
      fatSectorNumber -= entriesPerSector;
      const addr = this.SectorOffsetToAddress(difatSectorLocation, this.m_sectorSize - 4);
      difatSectorLocation = this.ParseUint32(addr);
    }

    return this.ParseUint32(this.SectorOffsetToAddress(difatSectorLocation, fatSectorNumber * 4));
  }
}
