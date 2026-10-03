// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 ZiroEDA and contributors.
/**
 * The wire format between the chat pane and the AI agent server (a separate program the pane
 * talks to over HTTP). The server keeps its own copy of these types; change both together.
 */

export interface ChatRequest {
  /** The Claude Code session to continue; absent on the first turn. */
  sessionId?: string;
  message: string;
  /** Pictures the user attached (base64, no data: prefix). */
  images?: { mediaType: string; data: string }[];
  model?: string;
}

/** One NDJSON line sent to the chat pane. */
export type ChatEvent =
  | { type: 'text'; text: string }
  /** What the model is doing while nothing visible streams: thinking, writing a tool call. */
  | { type: 'status'; text: string }
  | { type: 'session'; sessionId: string; model?: string }
  /** One model call's tokens, as it ends; no cost (the CLI prices the turn). */
  | { type: 'usage-live'; input: number; output: number; cacheRead: number; cacheWrite: number }
  | {
      type: 'usage';
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      costUsd: number;
    }
  | { type: 'error'; message: string }
  /** The model called a tool: the tab runs it and posts /tool-result. */
  | { type: 'tool'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'done' };

/** What the tab posts back for a tool call. */
export interface ToolResult {
  id: string;
  text: string;
  isError?: boolean;
  /** A picture for the model (PNG, base64). */
  imagePng?: string;
}
