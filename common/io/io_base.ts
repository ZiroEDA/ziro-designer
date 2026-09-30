// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `include/io/io_base.h` / `common/io/io_base.cpp`: the base of every
 * import/export plugin (`PCB_IO`, `SCH_IO`), with its file-type description.
 *
 * One addition, the browser's: KiCad's plugins open their files by path; ours
 * read them through `m_readFile`, the file source the caller installs with
 * `SetFileReader` (a project's in-memory files, a dropped file). A plugin asks
 * it for the bytes of the path it would have opened.
 */

import { IO_ERROR } from '../exceptions.js';
import { fileFilter } from '../wildcards_and_files_ext.js';
import type { ChooserFilter } from '../wx/filedlg.js';
import type { PROGRESS_REPORTER } from '../progress_reporter.js';
import type { Reporter } from '../reporter.js';
import { RPT_SEVERITY_UNDEFINED, type Severity } from '../reporter.js';

/** `formatWildcardExt( aWildcard )` on GTK: each letter as `[xX]`, so the pattern ignores case. */
function formatWildcardExt(aWildcard: string): string {
  let wc = '';

  for (const ch of aWildcard) {
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    wc += lo === up ? ch : `[${lo}${up}]`;
  }

  return wc;
}

/** What a plugin opens a path with: the file's bytes, or null when there is none. */
export type IO_FILE_READER = (aPath: string) => Uint8Array | null;

/** `wxFileName( aPath ).GetExt()`: after the last dot of the last component. */
export function fileNameExt(aPath: string): string {
  const name = aPath.substring(Math.max(aPath.lastIndexOf('/'), aPath.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.substring(dot + 1) : '';
}

export class IO_FILE_DESC {
  /** Description shown in the file picker dialog */
  m_Description: string;
  /** Filter used for file pickers if m_IsFile is true. */
  m_FileExtensions: string[];
  /** In case of folders: extensions of files inside. */
  m_ExtensionsInDir: string[];
  /** Whether the library is a folder or a file */
  m_IsFile: boolean;
  /** Whether the IO can read this file type */
  m_CanRead: boolean;
  /** Whether the IO can write this file type */
  m_CanWrite: boolean;

  constructor(
    aDescription = '',
    aFileExtensions: readonly string[] = [],
    aExtsInFolder: readonly string[] = [],
    aIsFile = true,
    aCanRead = true,
    aCanWrite = true,
  ) {
    this.m_Description = aDescription;
    this.m_FileExtensions = [...aFileExtensions];
    this.m_ExtensionsInDir = [...aExtsInFolder];
    this.m_IsFile = aIsFile;
    this.m_CanRead = aCanRead;
    this.m_CanWrite = aCanWrite;
  }

  /**
   * `FileFilter()`: the description then `AddFileExtListToFilter( m_FileExtensions )`,
   * `"Desc (*.a; *.b)|*.a;*.b"`, each pattern extension in both cases as
   * `formatWildcardExt` spells it for GTK.
   */
  FileFilter(): string {
    return `${this.Chooser().label}|${
      this.m_FileExtensions.length === 0
        ? '*'
        : this.m_FileExtensions.map((e) => `*.${formatWildcardExt(e)}`).join(';')
    }`;
  }

  /** The same filter as the file chooser's type combo takes it. */
  Chooser(): ChooserFilter {
    const f = fileFilter(this.m_Description, this.m_FileExtensions);
    return { label: f.label, extensions: this.m_FileExtensions.map((e) => e.toLowerCase()) };
  }

  /** `operator bool()`. */
  valid(): boolean {
    return this.m_Description !== '';
  }
}

/** `NOT_IMPLEMENTED( aCaller )`. */
export function NOT_IMPLEMENTED(aName: string, aCaller: string): never {
  throw new IO_ERROR(`IO interface "${aName}" does not implement the "${aCaller}" function.`);
}

export abstract class IO_BASE {
  /** Name of the IO loader */
  protected m_name: string;
  /** Reporter to log errors/warnings to, may be nullptr */
  protected m_reporter: Reporter | null = null;
  /** Progress reporter to track the progress of the operation, may be nullptr */
  protected m_progressReporter: PROGRESS_REPORTER | null = null;
  /** Where the plugin's paths are read from (see the file header). */
  protected m_readFile: IO_FILE_READER = () => null;

  protected constructor(aName: string) {
    this.m_name = aName;
  }

  GetName(): string {
    return this.m_name;
  }

  IsPCB_IO(): boolean {
    return false;
  }

  SetReporter(aReporter: Reporter | null): void {
    this.m_reporter = aReporter;
  }

  SetProgressReporter(aReporter: PROGRESS_REPORTER | null): void {
    this.m_progressReporter = aReporter;
  }

  /** The browser's file source; see the file header. */
  SetFileReader(aReader: IO_FILE_READER): void {
    this.m_readFile = aReader;
  }

  abstract GetLibraryDesc(): IO_FILE_DESC;

  GetLibraryFileDesc(): IO_FILE_DESC {
    return this.GetLibraryDesc();
  }

  CanReadLibrary(aFileName: string): boolean {
    const desc = this.GetLibraryDesc();

    if (desc.m_IsFile) {
      const fileExt = fileNameExt(aFileName).toLowerCase();

      for (const ext of desc.m_FileExtensions) {
        if (fileExt === ext.toLowerCase()) return true;
      }
    }

    // A folder library (wxDir over its files) has no reader here.
    return false;
  }

  CreateLibrary(_aLibraryPath: string): void {
    NOT_IMPLEMENTED(this.m_name, 'CreateLibrary');
  }

  DeleteLibrary(_aLibraryPath: string): boolean {
    NOT_IMPLEMENTED(this.m_name, 'DeleteLibrary');
  }

  IsLibraryWritable(_aLibraryPath: string): boolean {
    NOT_IMPLEMENTED(this.m_name, 'IsLibraryWritable');
  }

  Report(aText: string, aSeverity: Severity = RPT_SEVERITY_UNDEFINED): void {
    this.m_reporter?.report(aText, aSeverity);
  }

  AdvanceProgressPhase(): void {
    this.m_progressReporter?.AdvancePhase();
  }
}
