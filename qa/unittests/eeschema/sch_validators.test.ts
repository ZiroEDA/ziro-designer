// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `SCH_NETNAME_VALIDATOR::IsValid` (sch_validators.cpp): the base
 * `NETNAME_VALIDATOR` checks (no CR/LF, no spaces unless allowed) plus the
 * bus-group/bus-vector refinement.
 */
import { describe, expect, it } from 'vitest';
import { SCH_NETNAME_VALIDATOR } from '@ziroeda/eeschema/sch_validators.js';

describe('SCH_NETNAME_VALIDATOR', () => {
  it('accepts a plain signal name', () => {
    expect(new SCH_NETNAME_VALIDATOR().IsValid('RESET')).toBe('');
  });

  it('rejects CR/LF from the base NETNAME_VALIDATOR check', () => {
    expect(new SCH_NETNAME_VALIDATOR().IsValid('A\nB')).not.toBe('');
    expect(new SCH_NETNAME_VALIDATOR().IsValid('A\rB')).not.toBe('');
  });

  it('rejects spaces unless the constructor allows them', () => {
    expect(new SCH_NETNAME_VALIDATOR(false).IsValid('A B')).not.toBe('');
    expect(new SCH_NETNAME_VALIDATOR(true).IsValid('A B')).toBe('');
  });

  it('does not validate a single character beyond the base check', () => {
    // A lone '{' or '[' looks like the start of a bus pattern, but the C++
    // explicitly skips the bus check for length-1 strings.
    expect(new SCH_NETNAME_VALIDATOR().IsValid('{')).toBe('');
    expect(new SCH_NETNAME_VALIDATOR().IsValid('[')).toBe('');
  });

  it('accepts a valid bus vector name', () => {
    expect(new SCH_NETNAME_VALIDATOR().IsValid('D[7..0]')).toBe('');
  });

  it('rejects unbalanced/invalid bracket use that is not a real bus vector', () => {
    expect(new SCH_NETNAME_VALIDATOR().IsValid('D[oops')).not.toBe('');
  });

  it('accepts a valid bus group name', () => {
    expect(new SCH_NETNAME_VALIDATOR().IsValid('USB{DP DM}')).toBe('');
  });

  it('rejects a brace that looks like a bus group but does not parse as one', () => {
    // A space in the group name makes ParseBusGroup fail even though the
    // string has both a matching '{' and '}'.
    expect(new SCH_NETNAME_VALIDATOR().IsValid('US B{DP}')).not.toBe('');
  });

  it('does not treat a text-variable "${...}" opener as a bus group', () => {
    // The C++ regex `(^|[^$_^~]){` deliberately excludes a brace preceded by
    // $, _, ^ or ~ so `${SHEETNAME}`-style variable text is left alone.
    expect(new SCH_NETNAME_VALIDATOR().IsValid('${SHEETNAME}')).toBe('');
  });
});
