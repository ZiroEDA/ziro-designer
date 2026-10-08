// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The tab's link to the AI agent running on the user's machine (`npx ziroeda-agent`): whether
 * it is there and which AI it drives, and - while it is - a live link over which tool calls from
 * the user's own AI app (Claude Code, Cursor, Codex... connected to the agent as an MCP server)
 * reach this tab. Each runs like a panel tool call (runAiTool) and its answer goes back.
 */
import { useEffect, useState } from 'react';
import { AI_AGENT_URL } from './ai_flag.js';
import { runAiTool, type ToolOutput } from './ai_bridge.js';

export interface AgentState {
  connected: boolean;
  /** The AI the agent drives ("claude-code"), or null when it found none. */
  engine: string | null;
}

/** How often the pane looks for the agent while it is not connected. */
const PROBE_MS = 5000;

export function useAgentLink(): AgentState {
  const [state, setState] = useState<AgentState>({ connected: false, engine: null });

  useEffect(() => {
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const probe = async () => {
      try {
        const r = await fetch(`${AI_AGENT_URL}/health`);
        const h = (await r.json()) as { ok?: boolean; engine?: string | null };
        if (stopped || !h.ok) throw new Error('no agent');
        setState({ connected: true, engine: h.engine ?? null });
        open();
      } catch {
        if (stopped) return;
        setState({ connected: false, engine: null });
        timer = setTimeout(probe, PROBE_MS);
      }
    };

    const open = () => {
      source = new EventSource(`${AI_AGENT_URL}/link`);
      source.addEventListener('tool', (ev) => {
        const call = JSON.parse((ev as MessageEvent<string>).data) as {
          id: string;
          name: string;
          args: Record<string, unknown>;
        };
        void runAiTool(call.name, call.args)

          .catch((err: unknown): { out: ToolOutput } => ({
            out: { text: `${call.name} failed: ${String(err)}`, isError: true, note: '' },
          }))
          .then(({ out }) =>
            fetch(`${AI_AGENT_URL}/tool-result`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: call.id,
                text: out.text,
                isError: out.isError,
                ...(out.imagePng ? { imagePng: out.imagePng } : {}),
              }),
            }),
          );
      });
      source.onerror = () => {
        source?.close();
        source = null;
        if (stopped) return;
        setState({ connected: false, engine: null });
        timer = setTimeout(probe, PROBE_MS);
      };
    };

    void probe();
    return () => {
      stopped = true;
      source?.close();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return state;
}

/** The line at the top of the pane: how to connect, or what is connected and how to use it elsewhere. */
export function AgentStatus({ agent }: { agent: AgentState }): JSX.Element {
  if (!agent.connected)
    return (
      <div className="ze-ai-agent ze-ai-agent-off" data-testid="ai-agent-status">
        Connect your AI: run <code>npx ziroeda-agent</code> in a terminal.
      </div>
    );

  return (
    <div className="ze-ai-agent ze-ai-agent-on" data-testid="ai-agent-status">
      Connected
      {agent.engine ? `: ${agent.engine === 'claude-code' ? 'Claude Code' : agent.engine}` : ''}.{' '}
      From your own AI app, add the MCP server <code>npx ziroeda-agent --mcp</code>.
    </div>
  );
}
