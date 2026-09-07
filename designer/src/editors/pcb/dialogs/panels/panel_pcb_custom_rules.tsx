// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * Board Setup > Design Rules > Custom Rules. Counterpart:
 * `pcbnew/dialogs/panel_setup_rules_base.cpp` (PANEL_SETUP_RULES), a "DRC Rules"
 * code editor (KiCad uses a wxStyledTextCtrl over the project's `.kicad_dru`
 * text) with a line-number gutter and a Syntax-help link. Custom rules
 * constrain DRC beyond the per-netclass values.
 *
 * "Syntax help" is a `wxHyperlinkCtrl` (`panel_setup_rules_base.cpp:30`), so it
 * is `.ze-hyperlink` — the theme's link colour at the dialog's own font. It was
 * drawn as dim grey text at 11.5px, which reads as a caption rather than
 * something to click.
 *
 * NOT PORTED YET: the compile button and the `WX_HTML_REPORT_BOX` under the
 * editor (`:76-84`), which report rule-parse errors. There is no `.kicad_dru`
 * evaluator here yet, so there is nothing to report; see BOARD_SETUP_STATUS.md.
 */

import { useRef, type JSX, type UIEvent } from 'react';
import type { CustomRules } from '../../board_settings.js';

// The data model lives in board_settings.ts (KiCad's data/UI split);
// re-exported so panel users keep importing from the panel module.
export { defaultCustomRules, type CustomRules } from '../../board_settings.js';

interface Props {
  value: CustomRules;
  onChange: (next: CustomRules) => void;
}

export function PanelPcbCustomRules({ value, onChange }: Props): JSX.Element {
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = Math.max(1, value.text.split('\n').length);
  // Keep the gutter scrolled in lock-step with the editor (wxStyledTextCtrl margin).
  const onScroll = (e: UIEvent<HTMLTextAreaElement>): void => {
    if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
  };

  return (
    <div className="ze-pcb-rules">
      <div className="ze-pcb-rules-head">
        <span>DRC Rules</span>
        <button
          type="button"
          className="ze-hyperlink"
          title="Custom DRC rule syntax (KiCad .kicad_dru)"
        >
          Syntax help
        </button>
      </div>

      <div className="ze-pcb-rules-editor">
        <div ref={gutterRef} className="ze-pcb-rules-gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
        </div>
        <textarea
          className="ze-pcb-rules-text"
          aria-label="DRC Rules"
          spellCheck={false}
          value={value.text}
          onScroll={onScroll}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
        />
      </div>
    </div>
  );
}
