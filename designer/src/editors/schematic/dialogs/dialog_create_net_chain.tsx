/**
 * Create Net Chain dialog. Counterpart:
 * `eeschema/dialogs/dialog_create_net_chain.cpp` (DIALOG_CREATE_NET_CHAIN),
 * a grid of this run's *uncommitted* potential chains (Suggested Name
 * editable; Terminals "R1:1 → R2:2"; Member Nets), a filter box, a Chain Name
 * input that falls back to the selected row's name, and multi-create: OK
 * commits the selected potential and keeps the dialog open.
 *
 * loadPotentials quirks carried over: potentials whose member nets already
 * belong to a committed chain are skipped, and the suggested name is the
 * longest member net's name. A focus hint (from the right-click selection)
 * pre-filters by symbol reference or net name.
 */

import { useMemo, useState, type JSX } from 'react';
import {
  isValidNetChainName,
  type CommittedNetChain,
  type DetectedNetChain,
} from '@ziroeda/eeschema';

/** DIALOG_CREATE_NET_CHAIN::FOCUS_HINT. */
export interface CreateChainFocusHint {
  fromRef?: string;
  toRef?: string;
  netName?: string;
}

interface Props {
  potentials: readonly DetectedNetChain[];
  committed: readonly CommittedNetChain[];
  hint?: CreateChainFocusHint;
  /** Commit one chain (validateAndCreate succeeded); the dialog stays open. */
  onCreate: (chain: CommittedNetChain) => void;
  onClose: () => void;
}

interface Row {
  potential: DetectedNetChain;
  suggestedName: string;
  terminals: string;
}

export function DialogCreateNetChain({
  potentials,
  committed,
  hint,
  onCreate,
  onClose,
}: Props): JSX.Element {
  const [filter, setFilter] = useState('');
  const [sel, setSel] = useState(0);
  const [nameInput, setNameInput] = useState('');
  const [status, setStatus] = useState('Select a potential net chain and choose a name.');
  const [editedNames, setEditedNames] = useState<Record<string, string>>({});
  const [created, setCreated] = useState(0);

  // loadPotentials: skip potentials whose nets are already in a committed
  // chain; suggest the longest member net name; terminals as "R1:1 → R2:2".
  const rows = useMemo<Row[]>(() => {
    const committedNets = new Set(committed.flatMap((c) => c.nets));
    return potentials
      .filter((p) => !p.nets.some((n) => committedNets.has(n)))
      .map((p) => {
        let suggested = '';
        for (const net of p.nets) if (net.length > suggested.length) suggested = net;
        const t = p.terminals;
        const terminals = t ? `${t[0].ref}:${t[0].pin} → ${t[1].ref}:${t[1].pin}` : '';
        return { potential: p, suggestedName: editedNames[p.name] ?? suggested, terminals };
      });
  }, [potentials, committed, editedNames]);

  const visible = useMemo(() => {
    // The focus hint narrows the initial view; the filter box narrows further.
    const needles: string[] = [];
    if (filter.trim() !== '') needles.push(filter.trim().toLowerCase());
    else {
      if (hint?.fromRef) needles.push(hint.fromRef.toLowerCase());
      if (hint?.netName) needles.push(hint.netName.toLowerCase());
    }
    if (needles.length === 0) return rows;
    const matches = rows.filter((r) => {
      const hay = `${r.suggestedName} ${r.terminals} ${r.potential.nets.join(' ')}`.toLowerCase();
      return needles.some((n) => hay.includes(n));
    });
    return matches.length > 0 ? matches : rows;
  }, [rows, filter, hint]);

  const doCreate = (): void => {
    const row = visible[sel];
    if (!row) {
      setStatus('Please select a chain from the list.');
      return;
    }
    const name = (nameInput.trim() || row.suggestedName).trim();
    if (!isValidNetChainName(name)) {
      setStatus(`"${name}" is not a valid net chain name.`);
      return;
    }
    if (committed.some((c) => c.name === name)) {
      setStatus(`A net chain named "${name}" already exists.`);
      return;
    }
    const t = row.potential.terminals;
    onCreate({
      name,
      from: t ? t[0] : { ref: '', pin: '' },
      to: t ? t[1] : { ref: '', pin: '' },
      netClass: '',
      color: '',
      nets: [...row.potential.nets],
    });
    // Multi-create: stay open, refresh the header like TransferDataFromWindow.
    setNameInput('');
    setCreated((n) => n + 1);
    setStatus(`Chain created (${created + 1} total). Select another or close.`);
  };

  return (
    <div className="ze-modal-backdrop" onMouseDown={onClose}>
      <div
        className="ze-modal"
        style={{ width: 640, maxWidth: '94vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="ze-modal-header">
          Create Net Chain
          <span className="x" title="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="ze-modal-body" style={{ display: 'block', padding: '10px 14px' }}>
          <div style={{ fontSize: 12.5, marginBottom: 6 }}>{status}</div>
          <input
            style={{ width: '100%', boxSizing: 'border-box', marginBottom: 6 }}
            placeholder="Filter by name, net or reference…"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSel(0);
            }}
          />
          <div className="ze-grid-pane" style={{ height: 220, overflow: 'auto' }}>
            <table className="ze-grid" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Suggested Name</th>
                  <th style={{ width: '30%' }}>Terminals</th>
                  <th>Member Nets</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => (
                  <tr
                    key={r.potential.name}
                    className={i === sel ? 'selected' : undefined}
                    onMouseDown={() => setSel(i)}
                  >
                    <td>
                      <input
                        className="ze-grid-input"
                        value={r.suggestedName}
                        onChange={(e) =>
                          setEditedNames((prev) => ({
                            ...prev,
                            [r.potential.name]: e.target.value,
                          }))
                        }
                      />
                    </td>
                    <td>
                      <span className="ze-grid-input">{r.terminals}</span>
                    </td>
                    <td>
                      <span className="ze-grid-input">{r.potential.nets.join(', ')}</span>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: 6 }}>
                      No uncommitted potential net chains.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            Chain Name:
            <input
              style={{ flex: 1 }}
              placeholder="(uses the selected row's name when empty)"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
          </label>
        </div>
        <div className="ze-modal-footer">
          <button className="ze-btn" onClick={onClose}>
            Close
          </button>
          <button className="ze-btn primary" disabled={visible.length === 0} onClick={doCreate}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
