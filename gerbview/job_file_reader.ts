// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `gerbview/job_file_reader.cpp`: `GERBER_JOBFILE_READER`, which reads a
 * `.gbrjob` Gerber job file for the list of Gerber files it names.
 *
 *     "FilesAttributes":
 *     [
 *       { "Path": "interf_u-Composant.gbr", "FileFunction": "Copper,L1,Top", ... },
 *       ...
 *     ]
 *
 * Only the JSON format is read; the old `%TF.` / `%TJ.` format is reported as
 * outdated and refused, as upstream does.
 *
 * `GERBVIEW_FRAME::LoadGerberJobFile`, which loads the named files, is the
 * frame's and waits with it (STRUCTURE.md). Browser divergence: the reader is
 * given the file's text beside its name.
 */
import { type Reporter as REPORTER, RPT_SEVERITY_WARNING } from '@ziroeda/common/reporter.js';
import { FILE, LINE_BUFFER } from './libc.js';

export class GERBER_JOBFILE_READER {
  private m_reporter: REPORTER | null;
  private m_filename: string;
  /** The text of the job file (`wxFopen( m_filename )`); null when it cannot be opened. */
  private m_fileText: string | null;
  /** List of gerber files in job. */
  private m_GerberFiles: string[] = [];

  constructor(aFileName: string, aReporter: REPORTER | null, aFileText: string | null) {
    this.m_filename = aFileName;
    this.m_reporter = aReporter;
    this.m_fileText = aFileText;
  }

  /** Read a .gbrjob file. */
  ReadGerberJobFile(): boolean {
    // Read the gerber file */
    if (this.m_fileText === null) return false;

    const jobfileReader = new FILE(this.m_fileText); // Will close jobFile
    const line = new LINE_BUFFER();

    // detect the file format: old (deprecated) gerber format of official JSON format
    let json_format = false;

    if (jobfileReader.fgets(line, Number.MAX_SAFE_INTEGER) === null)
      // end of file
      return false;

    let data = line.s;

    if (data.includes('{')) json_format = true;

    if (json_format) {
      while (jobfileReader.fgets(line, Number.MAX_SAFE_INTEGER) !== null) data += `\n${line.s}`;

      try {
        const js = JSON.parse(data) as { FilesAttributes?: unknown };
        const entries = js.FilesAttributes;

        // `for( json& entry : js["FilesAttributes"] )` over a missing key
        // iterates nothing; `entry["Path"].get<std::string>()` throws on a
        // missing or non-string path, which the catch below turns into false.
        if (entries !== undefined && entries !== null) {
          if (!Array.isArray(entries)) throw new Error('FilesAttributes');

          for (const entry of entries as { Path?: unknown }[]) {
            const name = entry.Path;

            if (typeof name !== 'string') throw new Error('Path');

            this.m_GerberFiles.push(this.formatStringFromJSON(name));
          }
        }
      } catch {
        return false;
      }
    } else {
      this.m_reporter?.reportTail(
        'This job file uses an outdated format. Please recreate it.',
        RPT_SEVERITY_WARNING,
      );

      return false;
    }

    return true;
  }

  GetGerberFiles(): string[] {
    return this.m_GerberFiles;
  }

  /**
   * "Convert a JSON string, that uses a escaped sequence of 4 hexadecimal
   * digits to encode unicode chars": the JSON reader already decoded them.
   */
  private formatStringFromJSON(name: string): string {
    return name;
  }
}
