// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Local History: the snapshot store behind `View > Panels > Local History`.
 *
 * Counterpart: `LOCAL_HISTORY` (common/local_history.cpp) and the pane that
 * reads it (kicad/local_history_pane.cpp). Upstream keeps a real git repository
 * inside the project directory and drives it with libgit2 - a save runs the
 * registered savers, writes the files, and commits them:
 *
 *     bool CommitSnapshot( const std::vector<wxString>& aFiles, const wxString& aTitle );
 *     bool CommitFullProjectSnapshot( const wxString& aProjectPath, const wxString& aTitle );
 *     std::vector<LOCAL_HISTORY_SNAPSHOT_INFO> LoadSnapshots( const wxString& aProjectPath );
 *
 * and a snapshot is
 *
 *     struct LOCAL_HISTORY_SNAPSHOT_INFO
 *     {
 *         wxString      hash;
 *         wxDateTime    date;
 *         wxString      summary;
 *         wxString      message;
 *         int           filesChanged = 0;
 *         wxArrayString changedFiles;
 *     };
 *
 * There is no git here and no directory to put one in, so the *shape* is ported
 * rather than the mechanism: a snapshot is a list of file names each pointing
 * at a content hash, and the bytes live once per hash. That is what a git tree
 * is, minus the parts that exist to make it a distributed version control
 * system - packfiles, refs, merges, remotes - none of which a "restore what I
 * had an hour ago" pane uses.
 *
 * The consequence worth stating: unchanged files cost nothing across snapshots,
 * which is the property that makes snapshotting on every save affordable. A
 * board project is mostly footprints and 3D models that do not change while you
 * edit a schematic.
 *
 * This module is the store and the rules. The pane that renders it is
 * LocalHistoryPane.tsx.
 */

import { sha256Hex } from '../cloud/blobStore.js';
import type { StoredFile } from './projectStore.js';

/**
 * One snapshot, as the pane lists it.
 *
 * `LOCAL_HISTORY_SNAPSHOT_INFO`, with git's identifiers dropped: `hash` there
 * is a commit oid, which is how libgit2 addresses a commit; ours is an id
 * because there is no object database to look it up in.
 */
export interface Snapshot {
  /** Unique and sortable: the timestamp plus a counter, newest last. */
  id: string;
  /** `git_commit_time`, in ms. */
  at: number;
  /**
   * `info.message.BeforeFirst( '\n' )` - what the Title column shows.
   *
   * Upstream's is a commit message written by whatever asked for the snapshot,
   * and the pane tints two of them: a summary starting "Autosave" is drawn in
   * grey text, one starting "Backup" in blue. So the first word is load-bearing
   * and {@link SnapshotKind} keeps it that way rather than leaving it to
   * whoever writes the string.
   */
  title: string;
  /** What asked for the snapshot, which decides how the row is tinted. */
  kind: SnapshotKind;
  /** `filesChanged`, and the names behind it. */
  files: SnapshotFile[];
  /** Names whose content differs from the snapshot before this one. */
  changed: string[];
}

/** A file in a snapshot: its name and the hash its bytes are stored under. */
export interface SnapshotFile {
  name: string;
  hash: string;
  /** Uncompressed length, so a snapshot's size is known without reading it. */
  size: number;
}

/**
 * The three the pane distinguishes.
 *
 *     if( info.summary.StartsWith( wxS( "Autosave" ) ) )
 *         m_list->SetItemTextColour( row, ...GRAYTEXT );
 *     else if( info.summary.StartsWith( wxS( "Backup" ) ) )
 *         m_list->SetItemTextColour( row, wxColour( 80, 120, 200 ) );
 *
 * Everything else is drawn in the normal foreground, which is the manual save.
 */
export type SnapshotKind = 'save' | 'autosave' | 'backup';

/** Whether a snapshot has anything in it that the one before did not. */
export const isEmptySnapshot = (s: Snapshot): boolean => s.changed.length === 0;

/**
 * The Time column, ported exactly.
 *
 *     wxTimeSpan elapsed = now - info.date;
 *
 *     if( elapsed.GetMinutes() < 1 )        timeStr = _( "Moments ago" );
 *     else if( elapsed.GetMinutes() < 91 )  timeStr = Format( _( "%d minutes ago" ), minutes );
 *     else if( elapsed.GetHours() < 24 )    timeStr = Format( _( "%d hours ago" ), hours );
 *     else                                  timeStr = info.date.Format();
 *
 * The 91 is not a typo for 90 and not a rounding artefact: it means the list
 * says "90 minutes ago" and never "1 hours ago", because the hours branch only
 * starts once the minutes reading would have reached 91. Reproduced rather than
 * tidied to 60, because a list that switched units at an hour would disagree
 * with the same list in a desktop KiCad open beside it.
 *
 * `wxDateTime::Format()` with no argument is the locale's default date and
 * time, which is `toLocaleString()` here.
 */
export function relativeTime(at: number, now: number): string {
  const elapsedMs = Math.max(0, now - at);
  const minutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(elapsedMs / 3_600_000);

  if (minutes < 1) return 'Moments ago';
  if (minutes < 91) return `${minutes} minutes ago`;
  if (hours < 24) return `${hours} hours ago`;
  return new Date(at).toLocaleString();
}

/**
 * The hover tooltip:
 *
 *     wxString tip = info.message;
 *     ...
 *     tip << wxS( "\n" ) << info.date.FormatISOCombined();
 *
 * `FormatISOCombined` is `YYYY-MM-DDTHH:MM:SS` in *local* time, which is not
 * what `toISOString()` gives - that is UTC, and would read an hour or thirteen
 * out from the row above it.
 */
export function snapshotTooltip(s: Snapshot, at = s.at): string {
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const iso =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const changed = s.changed.length > 0 ? `\n${s.changed.join('\n')}` : '';
  return `${s.title}${changed}\n${iso}`;
}

/**
 * Which files differ from the previous snapshot.
 *
 * `filesChanged` upstream is what git reports for the commit, so a rename is
 * two entries and a deletion is one. Same here: a name present in one and not
 * the other counts, as does a name whose hash moved.
 */
export function changedAgainst(
  previous: readonly SnapshotFile[] | undefined,
  next: readonly SnapshotFile[],
): string[] {
  const before = new Map((previous ?? []).map((f) => [f.name, f.hash]));
  const out: string[] = [];

  for (const f of next) {
    if (before.get(f.name) !== f.hash) out.push(f.name);
    before.delete(f.name);
  }
  // Whatever is left was in the previous snapshot and is not in this one.
  out.push(...before.keys());

  return out.sort();
}

/** The file list of a project, hashed, ready to be committed as a snapshot. */
export async function hashFiles(files: readonly StoredFile[]): Promise<SnapshotFile[]> {
  const out = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      hash: await sha256Hex(f.bytes),
      size: f.bytes.length,
    })),
  );
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The title a snapshot gets, in the form the pane's tinting depends on.
 *
 * Upstream's messages are written at each call site; centralising it here is
 * the difference between a rule and a convention, given the pane decides a
 * row's colour by reading the first word back out of the string.
 */
export function snapshotTitle(kind: SnapshotKind, detail?: string): string {
  const head = kind === 'autosave' ? 'Autosave' : kind === 'backup' ? 'Backup' : 'Save';
  return detail ? `${head}: ${detail}` : head;
}

/**
 * The two commit messages `RestoreCommit` writes verbatim
 * (common/local_history.cpp:2288 and :2371).
 *
 * [data] KiCad hardcodes both. Neither begins "Autosave" or "Backup", so both
 * take the pane's default row colour upstream, and `kindOfTitle` puts them on
 * `save` here for the same reason.
 */
export const PRE_RESTORE_TITLE = 'Pre-restore backup';

/** `wxString::Format( wxS( "Restored from %s" ), aHash )`. */
export const restoredFromTitle = (hash: string): string => `Restored from ${hash}`;

/**
 * `KICAD_MESSAGE_DIALOG`'s wording in `RestoreCommit`
 * (common/local_history.cpp:2252-2270), which is shown when `aConfirm` is set —
 * the Local History pane's menu item leaves it at its default of true, and only
 * the recovery prompt passes false, "the recovery prompt already asked".
 *
 * `wxYES_NO | wxNO_DEFAULT | wxICON_QUESTION` with
 * `SetYesNoLabels( _( "Restore" ), _( "Cancel" ) )`, so Cancel holds the focus
 * ring: the destructive answer is never the one Enter picks.
 */
export const RESTORE_CAPTION = 'Restore Version';
export const RESTORE_YES_LABEL = 'Restore';
export const RESTORE_NO_LABEL = 'Cancel';
export const RESTORE_EXTENDED =
  'Your current files are backed up first so you can undo the restore. Files ' +
  'that are not part of this version are left untouched.';

/**
 * `_( "Restore the project to the version from %s?" )` with the commit's own
 * time, formatted `wxS( "%Y-%m-%d %H:%M:%S" )`.
 *
 * `wxDateTime::Format` renders LOCAL time, so this does too — a snapshot taken
 * at 14:05 must read 14:05 to the person who took it. `toISOString` would print
 * UTC and silently shift the number the user is being asked about.
 */
export function restoreConfirmMessage(at: number): string {
  const d = new Date(at);
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return `Restore the project to the version from ${stamp}?`;
}

/**
 * `DIALOG_RESTORE_LOCAL_HISTORY` (common/dialogs/dialog_restore_local_history.cpp),
 * behind File > "Restore Project from Local History..."
 * (kicad/tools/kicad_manager_actions.cpp:235-240 -> KICAD_MANAGER_FRAME::
 * RestoreLocalHistory, kicad/files-io.cpp:101-104 -> LOCAL_HISTORY::
 * ShowRestoreDialog, common/local_history.cpp:2384-2404).
 *
 * The three columns and their declared widths (:47-49, :89-91).
 *
 * [data] KiCad states the widths itself, as `FromDIP` pixels: 170 / 380 / 70.
 */
export const RESTORE_DIALOG_TITLE = 'Restore Project from Local History\u2026';
export const RESTORE_LIST_COLUMNS = [
  { key: 'time', label: 'Time', width: 170 },
  { key: 'action', label: 'Action', width: 380 },
  { key: 'count', label: 'Count', width: 70 },
] as const;

/** `SetMinSize( FromDIP( wxSize( 700, 500 ) ) )` (:68). */
export const RESTORE_DIALOG_MIN_WIDTH = 700;
export const RESTORE_DIALOG_MIN_HEIGHT = 500;

/**
 * `wxDateTime::FormatISOCombined()`, the Time column and the second line of the
 * details box (:80, :111).
 *
 * Default separator is 'T', and like every other wxDateTime formatter it renders
 * LOCAL time - `toISOString()` would print UTC and shift the stamp the user is
 * choosing between.
 */
export function formatISOCombined(at: number): string {
  const d = new Date(at);
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

/**
 * The Count column (:81-82):
 *
 *     snapshot.filesChanged > 0 ? wxString::Format( "%d", ... ) : wxString( "-" )
 *
 * A plain hyphen, not an em dash and not an empty cell.
 */
export const restoreCountText = (filesChanged: number): string =>
  filesChanged > 0 ? String(filesChanged) : '-';

/**
 * The read-only details box, `UpdateDetails` (:102-126), built in this order:
 *
 *     summary \n date(ISO combined) \n hash
 *     [ blank line, ONLY when there are changed files ]
 *     one changed file per line
 *
 * Upstream's per-file line is `<path> <adds>/<dels>/<updated>`, the line stats
 * libgit2 hands it from the diff (common/local_history.cpp:1083-1097). We store
 * the changed NAMES and never computed line stats, so ours is the path alone -
 * a reduction, stated here rather than faked with zeroes.
 */
export function restoreDetailText(snapshot: Snapshot): string {
  let text = `${snapshot.title}\n${formatISOCombined(snapshot.at)}\n${snapshot.id}`;
  if (snapshot.changed.length > 0) text += `\n\n${snapshot.changed.join('\n')}`;
  return text;
}

/** The kind a title encodes, which is how the pane tints a row it read back. */
export function kindOfTitle(title: string): SnapshotKind {
  if (title.startsWith('Autosave')) return 'autosave';
  if (title.startsWith('Backup')) return 'backup';
  return 'save';
}

/**
 * How much of the store a set of snapshots accounts for.
 *
 * Counted per distinct hash, not per file: the whole point of addressing by
 * content is that ten snapshots of a project where one file changed cost one
 * file, and a size that ignored that would report ten times the truth and drive
 * a retention policy to delete history nobody needed to lose.
 */
export function storedBytes(snapshots: readonly Snapshot[]): number {
  const seen = new Map<string, number>();
  for (const s of snapshots) {
    for (const f of s.files) seen.set(f.hash, f.size);
  }
  let total = 0;
  for (const size of seen.values()) total += size;
  return total;
}

/**
 * Which snapshots to drop to get under a byte budget, oldest first.
 *
 * `EnforceSizeLimit( aProjectPath, aMaxBytes, ... )` upstream, which walks back
 * from the oldest commit. Two rules that are not obvious:
 *
 *  - The newest snapshot is never dropped. A history whose limit is smaller
 *    than one snapshot should hold one snapshot, not none; deleting the last
 *    copy of the current state to satisfy a size cap is the one outcome nobody
 *    wants from a feature called history.
 *  - Dropping a snapshot frees only the hashes no surviving snapshot still
 *    references, which is why this measures what is left rather than what goes.
 */
export function snapshotsToEvict(snapshots: readonly Snapshot[], maxBytes: number): string[] {
  const byAge = [...snapshots].sort((a, b) => a.at - b.at);
  const evicted: string[] = [];

  for (let i = 0; i < byAge.length - 1; i++) {
    if (storedBytes(byAge.slice(i)) <= maxBytes) break;
    const victim = byAge[i];
    if (victim) evicted.push(victim.id);
  }

  return evicted;
}
