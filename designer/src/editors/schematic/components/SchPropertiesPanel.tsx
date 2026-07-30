// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
// Portions derived from KiCad, copyright The KiCad Developers. See NOTICE.md.
/**
 * The docked Properties panel grid. Counterpart:
 * `eeschema/widgets/sch_properties_panel.cpp` / `common/widgets/
 * properties_panel.cpp`: group header rows, a name column and an editable
 * value column; text/number rows commit on Enter or blur, checkboxes and
 * choices commit immediately. Distances render in the editor's current
 * units through `fmt`/`parse`.
 */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { EditCommand, PropRow } from '@ziroeda/eeschema';

function ValueEditor({
  row,
  fmt,
  parse,
  onCommand,
}: {
  row: PropRow;
  fmt: (iu: number) => string;
  parse: (text: string) => number | null;
  onCommand: (cmd: EditCommand) => void;
}): JSX.Element {
  const isDist = row.kind === 'coord' || row.kind === 'dist';
  const display = isDist ? fmt(row.value as number) : String(row.value);
  const [text, setText] = useState(display);
  // Re-sync when the document (and so the row value) changes under us.
  // biome-ignore lint/correctness/useExhaustiveDependencies: display is derived
  useEffect(() => setText(display), [display]);

  if (!row.set) return <span className="ze-muted">{display}</span>;

  if (row.kind === 'bool') {
    return (
      <input
        type="checkbox"
        checked={row.value as boolean}
        onChange={(e) => {
          const cmd = row.set!(e.target.checked);
          if (cmd) onCommand(cmd);
        }}
      />
    );
  }

  if (row.kind === 'choice') {
    return (
      <select
        value={String(row.value)}
        onChange={(e) => {
          const cmd = row.set!(e.target.value);
          if (cmd) onCommand(cmd);
        }}
      >
        {row.choices?.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    );
  }

  const commit = (): void => {
    if (text === display) return;
    let v: string | number | boolean = text;
    if (isDist) {
      const iu = parse(text);
      if (iu === null) {
        setText(display);
        return;
      }
      v = iu;
    } else if (row.kind === 'int') {
      const n = Number(text);
      if (!Number.isInteger(n)) {
        setText(display);
        return;
      }
      v = n;
    }
    const cmd = row.set!(v);
    if (cmd) onCommand(cmd);
    else setText(display);
  };

  return (
    <input
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setText(display);
        e.stopPropagation();
      }}
    />
  );
}

export function SchPropertiesPanel({
  rows,
  fmt,
  parse,
  onCommand,
}: {
  rows: PropRow[];
  fmt: (iu: number) => string;
  parse: (text: string) => number | null;
  onCommand: (cmd: EditCommand) => void;
}): JSX.Element {
  // Rows arrive grouped by construction ('' base group first, like upstream).
  const groups: { title: string; rows: PropRow[] }[] = [];
  for (const r of rows) {
    const g = groups.find((x) => x.title === r.group);
    if (g) g.rows.push(r);
    else groups.push({ title: r.group, rows: [r] });
  }
  return (
    <div className="ze-propgrid">
      {groups.map((g) => (
        <div key={g.title || 'base'}>
          {g.title && <div className="ze-propgrid-group">{g.title}</div>}
          {g.rows.map((r) => (
            <div className="ze-propgrid-row" key={`${g.title}/${r.name}`}>
              <span className="ze-propgrid-name" title={r.name}>
                {r.name}
              </span>
              <span className="ze-propgrid-value">
                <ValueEditor
                  key={`${r.name}:${String(r.value)}`}
                  row={r}
                  fmt={fmt}
                  parse={parse}
                  onCommand={onCommand}
                />
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
