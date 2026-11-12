// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * `PANEL_SETUP_RULES` (pcbnew/dialogs/panel_setup_rules.cpp), Board Setup > Design Rules >
 * Custom Rules: the project's .kicad_dru in a code editor on PANEL_SETUP_RULES_BASE, checked by
 * OnCompile through DRC_RULES_PARSER and checkPlausibility into the errors report, whose
 * line:offset links put the caret on the problem.
 *
 * Not ported: OnSyntaxHelp's help window (the rules help is Markdown KiCad converts with
 * ConvertMarkdown2Html, which we do not have), and the editor's autocomplete and brace matching.
 */

import { type JSX, useRef, useState } from 'react';
import { ExpandTextVars } from '@ziroeda/common/common.js';
import { PARSE_ERROR } from '@ziroeda/common/dsnlexer.js';
import { RPT_SEVERITY_WARNING, Reporter } from '@ziroeda/common/reporter.js';
import { StcGotoLine } from '@ziroeda/wx/stc.js';
import type { BOARD } from '../board.js';
import { DRC_RULES_PARSER } from '../drc/drc_rule_parser.js';
import { type DRC_RULE, IsComponentClassSelector } from '../drc/drc_rule.js';
import { PANEL_SETUP_RULES_BASE } from './panel_setup_rules_base.js';
import { _ } from '@ziroeda/wx/translation.js';
import { wxFormat } from '@ziroeda/wx/wxstring.js';

/** The page's text: the project's .kicad_dru, which the frame hands in. */
export interface CustomRules {
  text: string;
}

/** `checkPlausibility`: rules sharing a condition, undefined netclasses, undefined layers. */
export function checkPlausibility(
  aRules: readonly DRC_RULE[],
  aBoard: BOARD,
  aReporter: Reporter,
): void {
  const bds = aBoard.GetDesignSettings();
  const enabledLayers = aBoard.GetEnabledLayers();
  // Keyed by (condition, layerSource) so rules with different layer scopes are distinct.
  const seenConditions = new Map<string, string>();
  const netclassPattern = /NetClass\s*[!=]=\s*'"?([^"\s]+)'"?/g;

  for (const rule of aRules) {
    const condition = (rule.m_Condition ? rule.m_Condition.GetExpression() : '').trim();
    const key = `${condition}\u0000${rule.m_LayerSource}`;
    const seen = seenConditions.get(key);

    if (seen !== undefined)
      aReporter.Report(
        wxFormat(_("Rules '%s' and '%s' share the same condition."), rule.m_Name, seen),
        RPT_SEVERITY_WARNING,
      );
    else seenConditions.set(key, rule.m_Name);

    for (const m of condition.matchAll(netclassPattern)) {
      const ncName = m[1]!;
      if (!bds.m_NetSettings.HasNetclass(ncName))
        aReporter.Report(
          wxFormat(_("Rule '%s' references undefined netclass '%s'."), rule.m_Name, ncName),
          RPT_SEVERITY_WARNING,
        );
    }

    const isInner = rule.m_LayerSource.toLowerCase() === "'inner'";
    const isOuter = rule.m_LayerSource.toLowerCase() === "'outer'";

    if (rule.m_LayerSource !== '' && !isInner && !isOuter) {
      const invalid = rule.m_LayerCondition.and(enabledLayers.not());
      if (invalid.any()) {
        const badLayers = invalid
          .Seq()
          .map((layer) => aBoard.GetLayerName(layer))
          .join(', ');
        aReporter.Report(
          wxFormat(_("Rule '%s' references undefined layer(s): %s."), rule.m_Name, badLayers),
          RPT_SEVERITY_WARNING,
        );
      }
    }
  }
}

/** `OnCompile`: what m_errorsReport holds after the rules are checked. */
export function compileRules(aText: string, aBoard: BOARD | null): string[] {
  const report = new Reporter();

  try {
    const dummyRules: DRC_RULE[] = [];
    let rulesText = aText;

    if (aBoard) {
      rulesText = aBoard.ConvertCrossReferencesToKIIDs(rulesText);
      rulesText = ExpandTextVars(rulesText, (token) =>
        IsComponentClassSelector(token.value) ? false : aBoard.ResolveTextVar(token, 0),
      );
    }

    const parser = new DRC_RULES_PARSER(rulesText, _('DRC rules'));
    parser.Parse(dummyRules, report);
    if (aBoard) checkPlausibility(dummyRules, aBoard, report);
  } catch (pe) {
    if (!(pe instanceof PARSE_ERROR)) throw pe;
    report.Report(`ERROR: <a href='${pe.lineNumber}:${pe.byteIndex}'>${pe.ParseProblem()}</a>`);
  }

  return report.lines.map((l) => l.message);
}

interface Props {
  value: CustomRules;
  onChange: (next: CustomRules) => void;
  /** m_frame->GetBoard(), which the rules' text variables and plausibility checks read. */
  board?: BOARD | null;
}

export function PanelPcbCustomRules({ value, onChange, board = null }: Props): JSX.Element {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  // TransferDataToWindow: a rules file that loads is compiled at once.
  const [errors, setErrors] = useState<string[]>(() =>
    value.text !== '' ? compileRules(value.text, board) : [],
  );

  return (
    <PANEL_SETUP_RULES_BASE
      onSyntaxHelp={() => {}}
      m_textEditor={{
        value: value.text,
        onChange: (aText) => onChange({ ...value, text: aText }),
        ref: editorRef,
      }}
      onCompile={() => setErrors(compileRules(value.text, board))}
      m_errorsReport={errors}
      onErrorLinkClicked={(aHref) => {
        // OnErrorLinkClicked: "line:offset".
        const [line, offset] = aHref.split(':').map((n) => Number.parseInt(n, 10) || 0);
        if (editorRef.current) StcGotoLine(editorRef.current, line ?? 0, offset ?? 0);
      }}
    />
  );
}
