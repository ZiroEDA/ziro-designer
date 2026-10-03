/**
 * The app-wide AI chat pane, docked on the right of every editor.
 *
 * It talks to whatever editor registered a bridge (ai_bridge.ts). Each turn
 * sends the compact view of the open document only when it changed since the
 * model last saw it. The model works through tools (read_schematic,
 * apply_zsch, run_erc) and runs its own loop until it is done; this pane only
 * executes each call against the bridge, so every edit is one undoable
 * commit in that editor.
 */
import { useEffect, useRef, useState } from 'react';
import { aiBridge, allBridges, type EditorKind, type ToolOutput } from './ai_bridge.js';
import { hideDoc, showDoc } from './doc_viewer.js';
import { Markdown } from './markdown.js';
import { AI_AGENT_URL } from './ai_flag.js';
import type { ChatEvent, ToolResult } from './protocol.js';
import './chat_pane.css';

/** One tool call as the chat shows it: running, then what it did. */
export interface Step {
  label: string;
  state: 'running' | 'done' | 'error';
}

/**
 * The conversation. A run of tool calls is one `steps` entry: open while
 * the model works, folded to a one-line summary once text follows it or the
 * turn ends; the user can unfold it.
 */
type Msg =
  | { role: 'user' | 'ai' | 'note'; text: string; images?: string[] }
  | { role: 'steps'; steps: Step[]; open: boolean };

/** What a tool is doing, before its own note says what it did. */
export function runningLabel(tool: string): string {
  const words = tool.replace(/_/g, ' ');
  if (tool.startsWith('read_')) return `Reading the ${words.slice(5)}`;
  if (tool.startsWith('view_')) return `Looking at the ${words.slice(5)}`;
  if (tool.startsWith('search_')) return `Searching ${words.slice(7)}`;
  if (tool.startsWith('run_')) return `Running ${words.slice(4).toUpperCase()}`;
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** A folded run of steps, in one line. */
export function stepsSummary(steps: readonly Step[]): string {
  const failed = steps.filter((s) => s.state === 'error').length;
  return `${steps.length} step${steps.length === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`;
}

/** Fold every steps entry (the turn ended, or text came after them). */
const fold = (m: Msg[]): Msg[] =>
  m.map((x) => (x.role === 'steps' && x.open ? { ...x, open: false } : x));

export interface Totals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  turns: number;
}

/** A tool that has not answered by then is reported to the model as failed,
 *  so one stuck call cannot hang the whole turn. */
const TOOL_TIMEOUT_MS = 120_000;

const ZERO: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, turns: 0 };

export function addUsage(a: Totals, b: Totals): Totals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUsd: a.costUsd + b.costUsd,
    turns: a.turns + b.turns,
  };
}
function subUsage(a: Totals, b: Totals): Totals {
  return addUsage(a, {
    input: -b.input,
    output: -b.output,
    cacheRead: -b.cacheRead,
    cacheWrite: -b.cacheWrite,
    costUsd: -b.costUsd,
    turns: -b.turns,
  });
}

const fmtK = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function AiChatPane(): JSX.Element {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [totals, setTotals] = useState<Totals>(ZERO);
  const [last, setLast] = useState<Totals | null>(null);
  /** What the model is doing right now, and since when. */
  const [status, setStatus] = useState<{ text: string; since: number } | null>(null);
  const [, setTick] = useState(0);
  /** Pictures attached to the next message. */
  const [attached, setAttached] = useState<Attachment[]>([]);
  const [listening, setListening] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** This project's saved chats, and which one is on screen. */
  const [project, setProject] = useState<string | null>(() => currentProject());
  const [chats, setChats] = useState<SavedChat[]>(() => loadChats(currentProject()));
  const [chatId, setChatId] = useState(() => newId());
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const session = useRef<string | undefined>(undefined);
  const lastSeen = useRef(new Map<EditorKind, string>());
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // A running clock on the status line, so a long think never looks dead.
  useEffect(() => {
    if (!status) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new message
  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [msgs]);

  const newChat = () => {
    session.current = undefined;
    lastSeen.current.clear();
    setMsgs([]);
    setTotals(ZERO);
    setLast(null);
    setChatId(newId());
    setMenuOpen(false);
  };

  /** Reopen a saved chat of this project; the CLI session resumes with it. */
  const openChat = (c: SavedChat) => {
    session.current = c.sessionId;
    lastSeen.current.clear();
    setMsgs(c.msgs);
    setTotals(c.totals);
    setLast(null);
    setChatId(c.id);
    setMenuOpen(false);
  };

  // The chat on screen is saved under the open project as it changes.
  useEffect(() => {
    if (msgs.length === 0) return;
    const firstUser = msgs.find(
      (m): m is Extract<Msg, { role: 'user' | 'ai' | 'note' }> => m.role === 'user',
    );
    const saved: SavedChat = {
      id: chatId,
      sessionId: session.current,
      title: (firstUser?.text ?? 'Chat').slice(0, 60),
      updated: Date.now(),
      // Pictures are not kept: a saved chat says how many there were.
      msgs: msgs.map((m) => (m.role !== 'steps' && m.images ? { ...m, images: undefined } : m)),
      totals,
    };
    setChats((list) => {
      const next = [saved, ...list.filter((c) => c.id !== chatId)].slice(0, MAX_CHATS);
      storeChats(project, next);
      return next;
    });
  }, [msgs, totals, chatId, project]);

  // Another project opened: its own chats, starting from a fresh one.
  useEffect(() => {
    const id = setInterval(() => {
      const p = currentProject();
      if (p === project) return;
      setProject(p);
      // The spec on screen was the old project's.
      hideDoc();
      setChats(loadChats(p));
      if (!busy) {
        session.current = undefined;
        lastSeen.current.clear();
        setMsgs([]);
        setTotals(ZERO);
        setChatId(newId());
      }
    }, 1000);
    return () => clearInterval(id);
  }, [project, busy]);

  const attach = async (files: FileList | File[]) => {
    const pics = [...files].filter((f) => f.type.startsWith('image/'));
    const read = await Promise.all(
      pics.map(
        (f) =>
          new Promise<Attachment>((resolve) => {
            const r = new FileReader();
            r.onload = () => {
              const url = String(r.result);
              resolve({ url, mediaType: f.type, data: url.replace(/^data:[^,]*,/, '') });
            };
            r.readAsDataURL(f);
          }),
      ),
    );
    setAttached((a) => [...a, ...read]);
  };

  /** Voice input: the browser's speech recognition, dictating into the box. */
  const toggleVoice = () => {
    if (listening) {
      recognizer.current?.stop();
      return;
    }
    const Ctor = speechRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      let said = '';
      for (let i = e.resultIndex; i < e.results.length; i++)
        said += e.results[i]?.[0]?.transcript ?? '';
      if (said.trim())
        setDraft((d) => (d ? `${d.replace(/\s*$/, '')} ${said.trim()}` : said.trim()));
    };
    rec.onend = () => {
      setListening(false);
      recognizer.current = null;
    };
    recognizer.current = rec;
    setListening(true);
    rec.start();
  };

  /** Run one tool call from the model on whichever editor owns that tool. */
  const runTool = async (name: string, args: Record<string, unknown>): Promise<ToolOutput> => {
    for (const b of allBridges()) {
      const refused = b.guard?.(name);
      if (refused) return refused;
    }
    for (const b of [...allBridges()].sort(
      (x, y) => Number(y.kind === 'app') - Number(x.kind === 'app'),
    )) {
      const out = b.run(name, args);
      if (out) {
        // The editor doing the work is the one on screen.
        if (b.kind === 'sch' || b.kind === 'pcb') aiBridge('app')?.show?.(b.kind);
        const r = await out;
        // What the model just read is what it has seen.
        if (name.startsWith('read_')) lastSeen.current.set(b.kind, r.text);
        return r;
      }
    }
    return {
      text: `Nothing open can run ${name} right now: open the editor it belongs to (open_editor) first.`,
      isError: true,
      note: `${name}: its editor is not open`,
    };
  };

  const send = async (override?: string) => {
    const text = (override ?? draft).trim();
    const pics = attached;
    if ((!text && pics.length === 0) || busy) return;
    if (override === undefined) setDraft('');
    setAttached([]);
    setBusy(true);
    // Each open editor's view, when it changed since the model last saw it.
    const views: string[] = [];
    for (const b of allBridges()) {
      const view = b.read();
      if (!view || view === lastSeen.current.get(b.kind)) continue;
      lastSeen.current.set(b.kind, view);
      const tag = b.kind === 'sch' ? 'schematic' : b.kind === 'app' ? 'workspace' : 'board';
      views.push(`<${tag}>\n${view}\n</${tag}>`);
    }
    const message = views.length ? `${views.join('\n\n')}\n\n${text}` : text;
    setMsgs((m) => [
      ...m,
      { role: 'user', text, ...(pics.length ? { images: pics.map((p) => p.url) } : {}) },
    ]);
    // Assistant text arrives between tool calls; each run of it is one bubble.
    let bubble = false;
    const say = (t: string) => {
      const open = bubble;
      bubble = true;
      setMsgs((m) => {
        const lastMsg = m[m.length - 1];
        return open && lastMsg?.role === 'ai'
          ? [...m.slice(0, -1), { role: 'ai', text: lastMsg.text + t }]
          : [...fold(m), { role: 'ai', text: t }];
      });
    };
    const note = (t: string) => {
      bubble = false;
      setMsgs((m) => [...m, { role: 'note', text: t }]);
    };
    /** A step joins the run at the end of the chat, or starts one. */
    const stepStart = (label: string) => {
      bubble = false;
      setMsgs((m) => {
        const lastMsg = m[m.length - 1];
        const step: Step = { label, state: 'running' };
        return lastMsg?.role === 'steps'
          ? [...m.slice(0, -1), { ...lastMsg, open: true, steps: [...lastMsg.steps, step] }]
          : [...m, { role: 'steps', open: true, steps: [step] }];
      });
    };
    const stepEnd = (label: string, failed: boolean) =>
      setMsgs((m) => {
        const lastMsg = m[m.length - 1];
        if (lastMsg?.role !== 'steps') return m;
        const steps = lastMsg.steps.map((x, i) =>
          i === lastMsg.steps.length - 1
            ? ({ label, state: failed ? 'error' : 'done' } as Step)
            : x,
        );
        return [...m.slice(0, -1), { ...lastMsg, steps }];
      });
    const ctl = new AbortController();
    abort.current = ctl;
    let turnLive: Totals = ZERO;
    try {
      const res = await fetch(`${AI_AGENT_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.current,
          message: message || 'See the picture.',
          ...(pics.length
            ? { images: pics.map((p) => ({ mediaType: p.mediaType, data: p.data })) }
            : {}),
        }),
        signal: ctl.signal,
      });
      if (!res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        for (let nl = buf.indexOf('\n'); nl >= 0; nl = buf.indexOf('\n')) {
          const e = JSON.parse(buf.slice(0, nl)) as ChatEvent;
          buf = buf.slice(nl + 1);
          if (e.type === 'text') {
            setStatus(null);
            say(e.text);
          } else if (e.type === 'status')
            setStatus(e.text ? { text: e.text, since: Date.now() } : null);
          else if (e.type === 'session') {
            session.current = e.sessionId;
          } else if (e.type === 'tool') {
            setStatus(null);
            stepStart(runningLabel(e.name));
            const answer = await Promise.race([
              runTool(e.name, e.args).catch(
                (err: unknown): ToolOutput => ({
                  text: `${e.name} failed: ${String(err)}`,
                  isError: true,
                  note: `${e.name} failed: ${String(err)}`,
                }),
              ),
              new Promise<ToolOutput>((res) =>
                setTimeout(
                  () =>
                    res({
                      text: `${e.name} did not answer within ${TOOL_TIMEOUT_MS / 1000} s`,
                      isError: true,
                      note: `${e.name} timed out after ${TOOL_TIMEOUT_MS / 1000} s`,
                    }),
                  TOOL_TIMEOUT_MS,
                ),
              ),
            ]);
            stepEnd(answer.note.charAt(0).toUpperCase() + answer.note.slice(1), !!answer.isError);
            setStatus({ text: 'thinking', since: Date.now() });
            const result: ToolResult = {
              id: e.id,
              text: answer.text,
              isError: answer.isError,
              ...(answer.imagePng ? { imagePng: answer.imagePng } : {}),
            };
            await fetch(`${AI_AGENT_URL}/tool-result`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result),
            });
          } else if (e.type === 'usage-live') {
            // Counted as each call ends, so a long or stopped turn still shows.
            turnLive = addUsage(turnLive, { ...e, costUsd: 0, turns: 0 });
            setTotals((t) => addUsage(t, { ...e, costUsd: 0, turns: 0 }));
            setLast(turnLive);
          } else if (e.type === 'usage') {
            // The CLI's own account of the turn (with its price) replaces the
            // running count for it.
            const final = { ...e, turns: 1 };
            const live = turnLive;
            setTotals((t) => addUsage(subUsage(t, live), final));
            setLast(final);
            turnLive = ZERO;
          } else if (e.type === 'error') note(`Error: ${e.message}`);
        }
      }
    } catch (err) {
      note(ctl.signal.aborted ? 'Stopped.' : `Error: ${String(err)}`);
    }
    abort.current = null;
    setStatus(null);
    setMsgs(fold);
    setBusy(false);
  };

  const toggleSteps = (index: number) =>
    setMsgs((m) =>
      m.map((x, i) => (i === index && x.role === 'steps' ? { ...x, open: !x.open } : x)),
    );

  const openSpec = async () => {
    const out = await aiBridge('app')?.run('read_design_doc', {});
    if (out && !out.isError)
      showDoc({ title: `DESIGN.md - ${currentProject() ?? ''}`, text: out.text });
    else {
      hideDoc();
      setMsgs((m) => [
        ...m,
        { role: 'note', text: 'No project is open, so there is no spec to show.' },
      ]);
    }
  };

  const tokenTitle = [
    `This chat: ${fmtK(totals.input + totals.cacheRead + totals.cacheWrite)} in, ${fmtK(totals.output)} out`,
    `Last turn: ${fmtK((last?.input ?? 0) + (last?.cacheRead ?? 0) + (last?.cacheWrite ?? 0))} in, ${fmtK(last?.output ?? 0)} out`,
  ].join('\n');

  return (
    <div className="ze-panel ze-ai-pane" data-testid="ai-pane">
      <div className="ze-ai-head">
        <div className="ze-ai-menu-anchor">
          <button
            type="button"
            className="ze-ai-iconbtn"
            title="Chats in this project"
            aria-label="Chats in this project"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path
                d="M2.5 4h11M2.5 8h11M2.5 12h11"
                stroke="currentColor"
                strokeWidth="1.4"
                fill="none"
              />
            </svg>
          </button>
          {menuOpen && (
            <div className="ze-dropdown ze-ai-menu" role="menu">
              <button type="button" className="ze-ai-menu-item" onClick={newChat} disabled={busy}>
                New chat
              </button>
              {chats.length > 0 && <div className="ze-ai-menu-sep" />}
              {chats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`ze-ai-menu-item${c.id === chatId ? ' current' : ''}`}
                  disabled={busy}
                  onClick={() => openChat(c)}
                  title={new Date(c.updated).toLocaleString()}
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="ze-ai-head-fill" />
        <span className="ze-ai-cost" title={tokenTitle}>
          ${totals.costUsd.toFixed(2)}
        </span>
      </div>
      <div className="ze-panel-body ze-ai-body">
        <div className="ze-ai-list" ref={listRef}>
          {msgs.length === 0 && (
            <div className="ze-ai-empty">
              Describe a circuit or a change. The assistant edits the open schematic and board,
              checks its work with ERC and DRC, and every edit is one undo.
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === 'steps' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: messages are append-only
              <div key={i} className="ze-ai-msg ze-ai-steps">
                <button type="button" className="ze-ai-steps-head" onClick={() => toggleSteps(i)}>
                  <Chevron open={m.open} /> {stepsSummary(m.steps)}
                </button>
                {m.open &&
                  m.steps.map((x, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: steps are append-only
                    <div key={j} className={`ze-ai-step ${x.state}`}>
                      <StepIcon state={x.state} />
                      <span>{x.label}</span>
                    </div>
                  ))}
              </div>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: messages are append-only
              <div key={i} className={`ze-ai-msg ze-ai-${m.role}`}>
                {m.role === 'user' && m.images?.length ? (
                  <div className="ze-ai-thumbs">
                    {m.images.map((url, j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: attachments never reorder
                      <img key={j} src={url} alt="attached" />
                    ))}
                  </div>
                ) : null}
                {m.role === 'ai' ? <Markdown text={m.text} /> : m.text}
              </div>
            ),
          )}
          {busy && status && (
            <div className="ze-ai-thinking">
              {status.text.startsWith('writing ')
                ? `Preparing ${runningLabel(status.text.slice(8)).toLowerCase()}`
                : 'Thinking'}
              … {Math.round((Date.now() - status.since) / 1000)} s
            </div>
          )}
        </div>
        <div className="ze-ai-composer">
          {attached.length > 0 && (
            <div className="ze-ai-thumbs">
              {attached.map((a, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: attachments never reorder
                <span key={j} className="ze-ai-thumb">
                  <img src={a.url} alt="attachment" />
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => setAttached((list) => list.filter((_, k) => k !== j))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            value={draft}
            placeholder="Ask, or describe a circuit to draw…"
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.some((f) => f.type.startsWith('image/'))) void attach(files);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="ze-ai-composer-row">
            <button
              type="button"
              className="ze-ai-roundbtn"
              title="Attach images"
              onClick={() => fileRef.current?.click()}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" fill="none" />
              </svg>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void attach(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              className="ze-ai-pillbtn"
              title="Open the project's spec (DESIGN.md)"
              onClick={() => void openSpec()}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path
                  d="M4 1.5h5.5L12.5 4.5V14.5H4zM9.5 1.5v3h3M6 8h4.5M6 10.5h4.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
              </svg>
              Spec
            </button>
            <span className="ze-ai-head-fill" />
            {speechRecognition() && (
              <button
                type="button"
                className={`ze-ai-roundbtn${listening ? ' live' : ''}`}
                title={listening ? 'Stop dictation' : 'Dictate'}
                onClick={toggleVoice}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <rect
                    x="6"
                    y="2"
                    width="4"
                    height="8"
                    rx="2"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14.5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    fill="none"
                  />
                </svg>
              </button>
            )}
            {busy ? (
              <button
                type="button"
                className="ze-ai-roundbtn send"
                title="Stop"
                onClick={() => abort.current?.abort()}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="currentColor" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                className="ze-ai-roundbtn send"
                title="Send"
                disabled={!draft.trim() && attached.length === 0}
                onClick={() => void send()}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                  <path
                    d="M8 13V3.5M3.5 8 8 3.5 12.5 8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    fill="none"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The step's state: a spinner while it runs, a tick or a cross after. */
function StepIcon({ state }: { state: Step['state'] }): JSX.Element {
  if (state === 'running') return <span className="ze-ai-spinner" aria-label="running" />;
  return (
    <svg className="ze-ai-step-icon" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      {state === 'done' ? (
        <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      ) : (
        <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      )}
    </svg>
  );
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg className="ze-ai-chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
      <path
        d={open ? 'M2 3.5l3 3 3-3' : 'M3.5 2l3 3-3 3'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

interface Attachment {
  url: string;
  mediaType: string;
  data: string;
}

/** A chat kept under its project, to reopen from the menu. */
export interface SavedChat {
  id: string;
  sessionId?: string;
  title: string;
  updated: number;
  msgs: Msg[];
  totals: Totals;
}

/** [ours] how many chats a project keeps. */
const MAX_CHATS = 30;
const chatsKey = (project: string | null) => `ziroeda.ai.chats.${project ?? '(no project)'}`;
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** The open project, as the app bridge reports it. */
function currentProject(): string | null {
  return aiBridge('app')?.project?.() ?? null;
}

export function loadChats(project: string | null): SavedChat[] {
  try {
    const raw = localStorage.getItem(chatsKey(project));
    return raw ? (JSON.parse(raw) as SavedChat[]) : [];
  } catch {
    return [];
  }
}

export function storeChats(project: string | null, chats: readonly SavedChat[]): void {
  try {
    localStorage.setItem(chatsKey(project), JSON.stringify(chats));
  } catch {
    // private window or full storage: the chat is just not kept
  }
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/** The browser's speech recognition, where it has one (Chrome, Edge, Safari). */
function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
