// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `eeschema/bus_alias.h`: `BUS_ALIAS`, a named bus group (`(bus_alias "NAME" (members …))`)
 * (eeschema stage E3).
 */

/** `wxString::Strip( wxString::both )`: leading and trailing whitespace. */
function stripBoth(s: string): string {
  return s.replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '');
}

export class BUS_ALIAS {
  protected m_name = '';
  protected m_members: string[] = [];

  Clone(): BUS_ALIAS {
    const copy = new BUS_ALIAS();
    copy.m_name = this.m_name;
    copy.m_members = [...this.m_members];
    return copy;
  }

  GetName(): string {
    return this.m_name;
  }

  SetName(aName: string): void {
    this.m_name = stripBoth(aName);
  }

  Members(): readonly string[] {
    return this.m_members;
  }

  SetMembers(aMembers: readonly string[]): void {
    this.m_members = [];

    for (const member of aMembers) {
      const trimmed = stripBoth(member);

      if (trimmed !== '') this.m_members.push(trimmed);
    }
  }

  AddMember(aMember: string): void {
    const trimmed = stripBoth(aMember);

    if (trimmed !== '') this.m_members.push(trimmed);
  }

  ClearMembers(): void {
    this.m_members = [];
  }
}
