// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
export interface MarkedLiteral {
  msgid: string;
  plural?: string;
  line: number;
}
export interface DomainMessage {
  plural: string | null;
  refs: Set<string>;
}
export function kicadMsgids(aTranslationDir: string): Set<string>;
export function markedLiterals(aFileName: string, aSource: string): MarkedLiteral[];
export function poString(aKeyword: string, aText: string): string;
export function buildPot(aMessages: Map<string, DomainMessage>): string;
export function mergePo(
  aExisting: string | null,
  aMessages: Map<string, DomainMessage>,
  aLang: string,
  aPluralForms: string,
): string;
