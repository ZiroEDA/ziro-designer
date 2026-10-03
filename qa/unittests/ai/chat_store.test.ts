// @vitest-environment happy-dom
import { loadChats, type SavedChat, storeChats } from '@ziroeda/ai/chat_pane.js';
import { describe, expect, it } from 'vitest';

const chat = (id: string, title: string): SavedChat => ({
  id,
  title,
  updated: 1,
  msgs: [{ role: 'user', text: title }],
  totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, turns: 0 },
});

describe('chats are kept per project', () => {
  it("a project sees its own chats and never another project's", () => {
    storeChats('blinky', [chat('a', 'make a blinker')]);
    storeChats('sensor', [chat('b', 'add a sensor')]);
    expect(loadChats('blinky').map((c) => c.title)).toEqual(['make a blinker']);
    expect(loadChats('sensor').map((c) => c.title)).toEqual(['add a sensor']);
    expect(loadChats('other')).toEqual([]);
  });
});
