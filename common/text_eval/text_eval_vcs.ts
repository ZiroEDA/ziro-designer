// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `common/text_eval/text_eval_vcs.cpp`: `TEXT_EVAL_VCS`, the git queries
 * behind `vcsidentifier()`, `vcsbranch()` and the other `vcs*` expression
 * functions.
 *
 * A browser tab has no git checkout, so every query answers the way the C++
 * does when `OpenRepo` finds no repository: an empty string, 0 or false. The
 * evaluator turns an empty answer into `<unknown>`, exactly as KiCad shows a
 * project that is not under version control. The context path is kept, as it
 * is the interface the frames set; nothing reads a repository from it.
 */

let tl_contextPath = '';

/** `TEXT_EVAL_VCS::SetContextPath`. */
export function SetContextPath(aPath: string): void {
  tl_contextPath = aPath;
}

/** `TEXT_EVAL_VCS::GetContextPath`. */
export function GetContextPath(): string {
  return tl_contextPath === '' ? '.' : tl_contextPath;
}

/** `TEXT_EVAL_VCS::CONTEXT_PATH_SCOPE` - set the path, and `Restore()` the previous one. */
export class CONTEXT_PATH_SCOPE {
  private readonly m_previous: string;

  constructor(aPath: string) {
    this.m_previous = tl_contextPath;
    tl_contextPath = aPath;
  }

  /** The destructor. */
  Restore(): void {
    tl_contextPath = this.m_previous;
  }
}

/** `GetCommitHash`: no repository, so no hash. */
export function GetCommitHash(_aPath: string, _aLength: number): string {
  return '';
}

/** `GetNearestTag`: `GetDescribeInfo` with no repository is `{ "", 0 }`. */
export function GetNearestTag(_aMatch: string, _aAnyTags: boolean): string {
  return '';
}

/** `GetDistanceFromTag`: `GetDescribeInfo` with no repository is `{ "", 0 }`. */
export function GetDistanceFromTag(_aMatch: string, _aAnyTags: boolean): number {
  return 0;
}

/** `IsDirty`: no repository is never dirty. */
export function IsDirty(_aIncludeUntracked: boolean): boolean {
  return false;
}

export function GetAuthor(_aPath: string): string {
  return '';
}

export function GetAuthorEmail(_aPath: string): string {
  return '';
}

export function GetCommitter(_aPath: string): string {
  return '';
}

export function GetCommitterEmail(_aPath: string): string {
  return '';
}

export function GetBranch(): string {
  return '';
}

/** `GetCommitTimestamp`: 0 is the C++'s "no repository". */
export function GetCommitTimestamp(_aPath: string): number {
  return 0;
}

/** `GetCommitDate`: the timestamp as text, or empty when there is none. */
export function GetCommitDate(aPath: string): string {
  const timestamp = GetCommitTimestamp(aPath);
  return timestamp > 0 ? String(timestamp) : '';
}
