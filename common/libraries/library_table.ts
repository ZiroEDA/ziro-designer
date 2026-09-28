// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `LIBRARY_TABLE` and `LIBRARY_TABLE_ROW` (common/libraries/library_table.cpp,
 * include/libraries/library_table.h): one `sym-lib-table`, `fp-lib-table` or
 * `design-block-lib-table`, parsed by LIBRARY_TABLE_PARSER and written back
 * through XNODE, as upstream's `Format` does.
 *
 * Web deltas, both about the file the table came from:
 *
 *  - The file constructor reads through the caller: `LIBRARY_TABLE.FromFile`
 *    takes the path and the file's text (null when there is no such file),
 *    because a project's files are the editor's, not a disk's.
 *  - `IsReadOnly` is upstream's "the file exists but is not writable". There is
 *    no permission bit to ask, so the table is told (`SetReadOnly`): the hosted
 *    library set that stands in for the global table is the one read-only case.
 *
 * `Save()` is not here: nothing writes a file directly. A caller formats the
 * table (`Format` into a `PRETTIFIED_STRING_FORMATTER` in
 * `FORMAT_MODE::LIBRARY_TABLE`, which is what `Save` does into a file) and
 * stores the text where the project keeps it.
 */
import { FORMAT_MODE } from '../io/kicad/kicad_io_utils.js';
import { type OUTPUTFORMATTER, PRETTIFIED_STRING_FORMATTER } from '../richio.js';
import { XNODE, wxXmlNodeType } from '../xnode.js';
import {
  LIBRARY_TABLE_PARSER,
  type LIBRARY_TABLE_IR,
  type LIBRARY_TABLE_ROW_IR,
} from './library_table_parser.js';

/** `LIBRARY_TABLE_TYPE`. */
export enum LIBRARY_TABLE_TYPE {
  UNINITIALIZED,
  SYMBOL,
  FOOTPRINT,
  DESIGN_BLOCK,
}

/** `LIBRARY_TABLE_SCOPE`. */
export enum LIBRARY_TABLE_SCOPE {
  UNINITIALIZED,
  GLOBAL,
  PROJECT,
  BOTH,
}

/** `LIBRARY_ERROR`. */
export class LIBRARY_ERROR {
  constructor(readonly message: string) {}
}

/** `LIBRARY_TABLE_OK`: the "error" a table row's plugin lookup answers with. */
export class LIBRARY_TABLE_OK extends LIBRARY_ERROR {
  constructor() {
    super('Table_OK');
  }
}

/** `LIBRARY_RESULT<T>`, `tl::expected<T, LIBRARY_ERROR>`. */
export type LIBRARY_RESULT<T> = { ok: true; value: T } | { ok: false; error: LIBRARY_ERROR };

/** `LIBRARY_TABLE_ROW`. */
export class LIBRARY_TABLE_ROW {
  /** `TABLE_TYPE_NAME`: a row of this type names another table, not a library. */
  static readonly TABLE_TYPE_NAME = 'Table';

  private m_nickname = '';
  private m_uri = '';
  private m_type = '';
  private m_options = '';
  private m_description = '';
  private m_disabled = false;
  private m_hidden = false;
  private m_ok = false;
  private m_errorDescription = '';
  private m_scope = LIBRARY_TABLE_SCOPE.UNINITIALIZED;

  /** The copy constructor; the rows are values upstream. */
  Clone(): LIBRARY_TABLE_ROW {
    const row = new LIBRARY_TABLE_ROW();
    Object.assign(row, this);
    return row;
  }

  /** `operator==`: everything but `m_ok` and the error description. */
  equals(aOther: LIBRARY_TABLE_ROW): boolean {
    return (
      this.m_scope === aOther.m_scope &&
      this.m_nickname === aOther.m_nickname &&
      this.m_uri === aOther.m_uri &&
      this.m_type === aOther.m_type &&
      this.m_options === aOther.m_options &&
      this.m_description === aOther.m_description &&
      this.m_disabled === aOther.m_disabled &&
      this.m_hidden === aOther.m_hidden
    );
  }

  SetNickname(aNickname: string): void {
    this.m_nickname = aNickname;
  }
  Nickname(): string {
    return this.m_nickname;
  }
  SetURI(aUri: string): void {
    this.m_uri = aUri;
  }
  URI(): string {
    return this.m_uri;
  }
  SetType(aType: string): void {
    this.m_type = aType;
  }
  Type(): string {
    return this.m_type;
  }
  SetOptions(aOptions: string): void {
    this.m_options = aOptions;
  }
  Options(): string {
    return this.m_options;
  }
  SetDescription(aDescription: string): void {
    this.m_description = aDescription;
  }
  Description(): string {
    return this.m_description;
  }
  SetScope(aScope: LIBRARY_TABLE_SCOPE): void {
    this.m_scope = aScope;
  }
  Scope(): LIBRARY_TABLE_SCOPE {
    return this.m_scope;
  }
  SetDisabled(aDisabled = true): void {
    this.m_disabled = aDisabled;
  }
  Disabled(): boolean {
    return this.m_disabled;
  }
  SetHidden(aHidden = true): void {
    this.m_hidden = aHidden;
  }
  Hidden(): boolean {
    return this.m_hidden;
  }

  /** `GetOptionsMap()`: `ParseOptions` of the options column. */
  GetOptionsMap(): Map<string, string> {
    return LIBRARY_TABLE.ParseOptions(this.m_options);
  }

  SetOk(aOk = true): void {
    this.m_ok = aOk;
  }
  IsOk(): boolean {
    return this.m_ok;
  }
  SetErrorDescription(aDescription: string): void {
    this.m_errorDescription = aDescription;
  }
  ErrorDescription(): string {
    return this.m_errorDescription;
  }
}

/** The leading keyword `Format` writes for each table type. */
const TABLE_KEYWORDS = new Map<LIBRARY_TABLE_TYPE, string>([
  [LIBRARY_TABLE_TYPE.SYMBOL, 'sym_lib_table'],
  [LIBRARY_TABLE_TYPE.FOOTPRINT, 'fp_lib_table'],
  [LIBRARY_TABLE_TYPE.DESIGN_BLOCK, 'design_block_lib_table'],
]);

/** `boost::lexical_cast<int>` as `initFromIR` uses it: strict, all or nothing. */
function lexicalCastInt(aText: string): number | undefined {
  if (!/^[+-]?\d+$/.test(aText)) return undefined;
  const value = Number(aText);
  return value >= -2147483648 && value <= 2147483647 ? value : undefined;
}

/** `LIBRARY_TABLE`. */
export class LIBRARY_TABLE {
  /** The full path to the file this table was parsed from, if any. */
  private m_path = '';
  private m_scope: LIBRARY_TABLE_SCOPE;
  /** What type of content this table contains. */
  private m_type = LIBRARY_TABLE_TYPE.UNINITIALIZED;
  /** The format version, if present in the parsed file. */
  private m_version: number | undefined = undefined;
  private m_ok = false;
  private m_errorDescription = '';
  private m_rows: LIBRARY_TABLE_ROW[] = [];
  /** Web delta: stands in for the file's writability (see the file comment). */
  private m_readOnly = false;

  /**
   * `LIBRARY_TABLE( aFromClipboard, aBuffer, aScope )`: a table parsed from
   * text. A failed parse leaves `IsOk()` false and no rows - upstream only
   * builds rows from a successful parse, so one bad row loses the whole table.
   */
  constructor(_aFromClipboard: boolean, aBuffer: string | null, aScope: LIBRARY_TABLE_SCOPE) {
    this.m_scope = aScope;

    if (aBuffer === null) return;

    const ir = new LIBRARY_TABLE_PARSER().ParseBuffer(aBuffer);

    if (ir.ok) {
      this.m_ok = this.initFromIR(ir.value);
    } else {
      this.m_ok = false;
      this.m_errorDescription = ir.error.description;
    }
  }

  /**
   * `LIBRARY_TABLE( aPath, aScope, aExpectedType )`: a table read from a file,
   * whose text the caller supplies (`null`: no such file).
   */
  static FromFile(
    aPath: string,
    aText: string | null,
    aScope: LIBRARY_TABLE_SCOPE,
    aExpectedType = LIBRARY_TABLE_TYPE.UNINITIALIZED,
  ): LIBRARY_TABLE {
    const table = LIBRARY_TABLE.Empty(aScope);
    table.m_path = aPath;

    if (aText === null) {
      table.m_ok = false;
      table.m_errorDescription = `The library table path '${aPath}' does not exist`;
      return table;
    }

    // test for an empty file, 1 byte allowed for BOM
    if (new TextEncoder().encode(aText).length <= 1) {
      table.m_ok = true;
      table.m_type = aExpectedType;
      return table;
    }

    const ir = new LIBRARY_TABLE_PARSER().Parse(aPath, aText);

    if (ir.ok) {
      if (aExpectedType !== LIBRARY_TABLE_TYPE.UNINITIALIZED && ir.value.type !== aExpectedType) {
        table.m_ok = false;
        table.m_errorDescription = 'The library table is of wrong type';
        return table;
      }

      table.m_ok = table.initFromIR(ir.value);
    } else {
      table.m_ok = false;
      table.m_errorDescription = ir.error.description;
    }

    return table;
  }

  /**
   * A table with no rows and no source, to fill in code (the hosted global
   * table, a copy). OK, since nothing failed to parse.
   */
  static Empty(
    aScope: LIBRARY_TABLE_SCOPE,
    aType = LIBRARY_TABLE_TYPE.UNINITIALIZED,
  ): LIBRARY_TABLE {
    const table = new LIBRARY_TABLE(true, null, aScope);
    table.m_type = aType;
    table.m_ok = true;
    return table;
  }

  /** The copy constructor (`LIB_TABLE_GRID_DATA_MODEL` keeps a working copy). */
  Clone(): LIBRARY_TABLE {
    const table = LIBRARY_TABLE.Empty(this.m_scope, this.m_type);
    table.m_path = this.m_path;
    table.m_version = this.m_version;
    table.m_ok = this.m_ok;
    table.m_errorDescription = this.m_errorDescription;
    table.m_readOnly = this.m_readOnly;
    table.m_rows = this.m_rows.map((r) => r.Clone());
    return table;
  }

  /** `operator==`. */
  equals(aOther: LIBRARY_TABLE): boolean {
    return (
      this.m_path === aOther.m_path &&
      this.m_scope === aOther.m_scope &&
      this.m_type === aOther.m_type &&
      this.m_version === aOther.m_version &&
      this.m_rows.length === aOther.m_rows.length &&
      this.m_rows.every((row, i) => row.equals(aOther.m_rows[i]!))
    );
  }

  private initFromIR(aIR: LIBRARY_TABLE_IR): boolean {
    this.m_type = aIR.type;
    this.m_version = lexicalCastInt(aIR.version);

    for (const row of aIR.rows) this.addRowFromIR(row);

    return true;
  }

  private addRowFromIR(aIR: LIBRARY_TABLE_ROW_IR): boolean {
    const row = new LIBRARY_TABLE_ROW();
    row.SetNickname(aIR.nickname);
    row.SetURI(aIR.uri);
    row.SetType(aIR.type);
    row.SetOptions(aIR.options);
    row.SetDescription(aIR.description);
    row.SetHidden(aIR.hidden);
    row.SetDisabled(aIR.disabled);
    row.SetOk(true);
    row.SetScope(this.m_scope);
    this.m_rows.push(row);
    return true;
  }

  /** `MakeRow`: a new row suitable for this table (not inserted). */
  MakeRow(): LIBRARY_TABLE_ROW {
    const row = new LIBRARY_TABLE_ROW();
    row.SetScope(this.m_scope);
    row.SetOk();
    return row;
  }

  /** `InsertRow`: a new row at the end of the table. */
  InsertRow(): LIBRARY_TABLE_ROW {
    const row = this.MakeRow();
    this.m_rows.push(row);
    return row;
  }

  Path(): string {
    return this.m_path;
  }
  SetPath(aPath: string): void {
    this.m_path = aPath;
  }
  Type(): LIBRARY_TABLE_TYPE {
    return this.m_type;
  }
  SetType(aType: LIBRARY_TABLE_TYPE): void {
    this.m_type = aType;
  }
  SetScope(aScope: LIBRARY_TABLE_SCOPE): void {
    this.m_scope = aScope;
  }
  Scope(): LIBRARY_TABLE_SCOPE {
    return this.m_scope;
  }
  Version(): number | undefined {
    return this.m_version;
  }
  SetVersion(aVersion: number | undefined): void {
    this.m_version = aVersion;
  }
  IsOk(): boolean {
    return this.m_ok;
  }
  ErrorDescription(): string {
    return this.m_errorDescription;
  }

  /** `IsReadOnly`: the underlying file exists but is not writable. */
  IsReadOnly(): boolean {
    return this.m_readOnly;
  }
  /** Web delta: what `wxFileName::IsFileWritable` would have answered. */
  SetReadOnly(aReadOnly = true): void {
    this.m_readOnly = aReadOnly;
  }

  /** `Rows()`: the live list - upstream hands out a reference to its deque. */
  Rows(): LIBRARY_TABLE_ROW[] {
    return this.m_rows;
  }

  /**
   * `Format( aOutput )`: the table as an XNODE tree. The version is always 7
   * (upstream's "TODO(JE) library tables - version management?"), and a URI's
   * backslashes become slashes.
   */
  Format(aOutput: OUTPUTFORMATTER): void {
    const keyword = TABLE_KEYWORDS.get(this.Type());

    if (keyword === undefined)
      throw new Error(`Unknown library table type: ${this.Type() as number}`);

    const self = new XNODE(wxXmlNodeType.wxXML_ELEMENT_NODE, keyword);

    self.AddAttributeInt('version', 7);

    for (const row of this.Rows()) {
      const uri = row.URI().replaceAll('\\', '/');

      const rowNode = new XNODE(wxXmlNodeType.wxXML_ELEMENT_NODE, 'lib');
      rowNode.AddAttribute('name', row.Nickname());
      rowNode.AddAttribute('type', row.Type());
      rowNode.AddAttribute('uri', uri);
      rowNode.AddAttribute('options', row.Options());
      rowNode.AddAttribute('descr', row.Description());

      if (row.Disabled()) rowNode.AddChild(new XNODE(wxXmlNodeType.wxXML_ELEMENT_NODE, 'disabled'));

      if (row.Hidden()) rowNode.AddChild(new XNODE(wxXmlNodeType.wxXML_ELEMENT_NODE, 'hidden'));

      self.AddChild(rowNode);
    }

    self.Format(aOutput);
  }

  /**
   * What `Save()` writes: `Format` through a `PRETTIFIED_FILE_OUTPUTFORMATTER`
   * in `FORMAT_MODE::LIBRARY_TABLE`, minus the file.
   */
  FormatForSave(): string {
    const formatter = new PRETTIFIED_STRING_FORMATTER(FORMAT_MODE.LIBRARY_TABLE);
    this.Format(formatter);
    return formatter.Finish();
  }

  HasRow(aNickname: string): boolean {
    return this.m_rows.some((row) => row.Nickname() === aNickname);
  }

  /**
   * `HasRowWithURI( aUri, aProject, aSubstituted )`. The substituted form
   * compares `LIBRARY_MANAGER::ExpandURI` of each row, which the caller
   * supplies (it needs the project).
   */
  HasRowWithURI(aUri: string, aExpandURI?: (aShortURI: string) => string): boolean {
    for (const row of this.m_rows) {
      if (!aExpandURI && row.URI() === aUri) return true;

      if (aExpandURI && aExpandURI(row.URI()) === aUri) return true;
    }

    return false;
  }

  /** `Row( aNickname )`. */
  Row(aNickname: string): LIBRARY_TABLE_ROW | undefined {
    return this.m_rows.find((row) => row.Nickname() === aNickname);
  }

  /** `ParseOptions`. */
  static ParseOptions(aOptionsList: string): Map<string, string> {
    return parseLibraryTableOptions(aOptionsList);
  }

  /** `FormatOptions`. */
  static FormatOptions(aProperties: ReadonlyMap<string, string> | null): string {
    return aProperties ? formatLibraryTableOptions(aProperties) : '';
  }
}

const OPT_SEP = '|';

/** ASCII `isspace`, the classification `ParseOptions` skips leading run with. */
const isSpace = (ch: string): boolean => ch === ' ' || (ch >= '\t' && ch <= '\r');

/**
 * `LIBRARY_TABLE::ParseOptions`: `a=1|b=2` into a map. Whitespace is skipped
 * only at the *start* of each pair, so `a = 1` gives the key `a ` and the value
 * ` 1`; a `\|` is an escaped separator; a pair with no `=` maps to the empty
 * string, which is how a valueless flag is recorded.
 */
export function parseLibraryTableOptions(optionsList: string): Map<string, string> {
  const props = new Map<string, string>();
  let cp = 0;
  const end = optionsList.length;

  while (cp < end) {
    let pair = '';

    while (cp < end && isSpace(optionsList[cp]!)) cp++;

    while (cp < end) {
      if (optionsList[cp] === '\\' && cp + 1 < end && optionsList[cp + 1] === OPT_SEP) {
        cp++;
        pair += optionsList[cp++];
      } else if (optionsList[cp] === OPT_SEP) {
        cp++;
        break;
      } else {
        pair += optionsList[cp++];
      }
    }

    if (pair.length === 0) continue;

    const eqNdx = pair.indexOf('=');

    if (eqNdx !== -1) props.set(pair.slice(0, eqNdx), pair.slice(eqNdx + 1));
    else props.set(pair, '');
  }

  return props;
}

/**
 * `LIBRARY_TABLE::FormatOptions`. Keys come out sorted because upstream walks a
 * `std::map`, and only the *value* has its separators escaped — a key
 * containing `|` is emitted raw and will not survive a re-parse.
 */
export function formatLibraryTableOptions(properties: ReadonlyMap<string, string>): string {
  let ret = '';

  for (const name of [...properties.keys()].sort()) {
    const value = properties.get(name)!;

    if (ret.length) ret += OPT_SEP;

    ret += name;

    if (value.length) {
      ret += '=';

      for (const ch of value) {
        if (ch === OPT_SEP) ret += '\\';
        ret += ch;
      }
    }
  }

  return ret;
}
