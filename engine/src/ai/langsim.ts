// Tiny deterministic models of LangChain's LCEL and LangGraph's StateGraph, so the demos draw real runs.

// ---------------- LCEL ----------------
export interface Runnable<I, O> {
  name: string;
  invoke(x: I): O;
  batch(xs: I[]): O[];
  /** `a.pipe(b)` = `a | b` */
  pipe<P>(next: Runnable<O, P>): Runnable<I, P>;
}

export function runnable<I, O>(name: string, fn: (x: I) => O): Runnable<I, O> {
  const r: Runnable<I, O> = {
    name,
    invoke: fn,
    batch: xs => xs.map(fn),
    pipe: next => runnable(`${name} | ${next.name}`, (x: I) => next.invoke(fn(x))),
  };
  return r;
}

export interface Msg {
  role: 'system' | 'human' | 'ai' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, string | number>;
}

/** ChatPromptTemplate.from_messages([...]).invoke(vars) */
export const promptTemplate = (tpl: [Msg['role'], string][]) =>
  runnable<Record<string, string>, Msg[]>('prompt', vars => tpl.map(([role, t]) => ({ role, content: t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`) })));

export const strParser = runnable<Msg, string>('StrOutputParser', m => m.content);

// ---------------- StateGraph ----------------
export const START = '__start__';
export const END = '__end__';
export type GState = Record<string, unknown>;
export type Reducer = (old: unknown, update: unknown) => unknown;
/** Annotated[list, add_messages]: append instead of overwrite */
export const addMessages: Reducer = (a, b) => [...((a as unknown[]) ?? []), ...((b as unknown[]) ?? [])];

export interface GraphSpec {
  nodes: Record<string, (s: GState, resume?: unknown) => GState>;
  /** static next node, or a router reading the state */
  edges: Record<string, string | ((s: GState) => string)>;
  entry: string;
  reducers?: Record<string, Reducer>;
  /** nodes that call interrupt(payload) before doing their work */
  interrupts?: Record<string, (s: GState) => unknown>;
}

export interface GStep {
  node: string;
  update: GState;
  state: GState;
  changed: string[];
  checkpoint: string;
  next: string;
}

export interface GRun {
  steps: GStep[];
  state: GState;
  interrupted?: { node: string; payload: unknown; checkpoint: string };
}

export function mergeState(state: GState, update: GState, reducers: Record<string, Reducer> = {}): GState {
  const out = { ...state };
  for (const [k, v] of Object.entries(update)) out[k] = reducers[k] ? reducers[k](state[k], v) : v;
  return out;
}

/** graph.invoke(): run super-steps from `entry` (or resume a paused node) until END, an interrupt, or maxSteps. */
export function runGraph(spec: GraphSpec, input: GState, opts: { thread?: string; maxSteps?: number; from?: GState; seq?: number; resume?: { node: string; value: unknown; state: GState; seq: number } } = {}): GRun {
  const thread = opts.thread ?? 't1';
  let seq = opts.resume?.seq ?? opts.seq ?? 0;
  let state = opts.resume ? opts.resume.state : mergeState(opts.from ?? {}, input, spec.reducers);
  let node = opts.resume ? opts.resume.node : spec.entry;
  const steps: GStep[] = [];
  const max = opts.maxSteps ?? 25;
  let resumeValue = opts.resume?.value;
  let resuming = !!opts.resume;
  while (node !== END && steps.length < max) {
    const ask = spec.interrupts?.[node];
    if (ask && !resuming) return { steps, state, interrupted: { node, payload: ask(state), checkpoint: `${thread}:${seq}` } };
    const update = spec.nodes[node](state, resuming ? resumeValue : undefined);
    resuming = false;
    resumeValue = undefined;
    state = mergeState(state, update, spec.reducers);
    const e = spec.edges[node];
    const next = typeof e === 'function' ? e(state) : e ?? END;
    steps.push({ node, update, state, changed: Object.keys(update), checkpoint: `${thread}:${++seq}`, next });
    node = next;
  }
  return { steps, state };
}

// ---------------- the user's hello-langgraph graphs ----------------
export const wordsGraph: GraphSpec = {
  entry: 'count_words',
  nodes: {
    count_words: s => ({ word_count: String(s.text).split(/\s+/).filter(Boolean).length }),
    shout: s => ({ text: `${String(s.text).toUpperCase()}!` }),
  },
  edges: { count_words: 'shout', shout: END },
};

export const feeGraph: GraphSpec = {
  entry: 'classify',
  nodes: {
    classify: s => ({ category: (s.amount as number) < 100 ? 'small' : (s.amount as number) < 10_000 ? 'medium' : 'large' }),
    small: s => ({ fee: (s.amount as number) * 0.05 }),
    medium: s => ({ fee: (s.amount as number) * 0.02 }),
    large: s => ({ fee: (s.amount as number) * 0.005 }),
  },
  edges: { classify: s => String(s.category), small: END, medium: END, large: END },
};

export const guessGraph: GraphSpec = {
  entry: 'guess',
  nodes: {
    guess: s => {
      const g = s.guess as number;
      let n = g + Math.floor(((s.target as number) - g) / 2);
      if (n === g) n += 1;
      return { guess: n, attempts: (s.attempts as number) + 1 };
    },
  },
  edges: { guess: s => (s.guess === s.target || (s.attempts as number) >= 10 ? END : 'guess') },
};

// agent loop: a scripted model that first asks for tools, then answers
export const WEATHER: Record<string, string> = { tokyo: '18°C, cloudy', austin: '31°C, sunny' };
export const TOOLS: Record<string, (a: ToolCall['args']) => string> = {
  get_weather: a => WEATHER[String(a.city).toLowerCase()] ?? `No data for ${a.city}`,
  add: a => String(Number(a.a) + Number(a.b)),
};

export function scriptedModel(messages: Msg[]): Msg {
  const toolResults = messages.filter(m => m.role === 'tool');
  if (!toolResults.length)
    return {
      role: 'ai',
      content: '',
      toolCalls: [
        { id: 'call_1', name: 'get_weather', args: { city: 'Tokyo' } },
        { id: 'call_2', name: 'add', args: { a: 17, b: 25 } },
      ],
    };
  return { role: 'ai', content: `Tokyo is ${toolResults[0].content}, and 17 + 25 = ${toolResults[1]?.content ?? '?'}.` };
}

export const agentGraph: GraphSpec = {
  entry: 'agent',
  reducers: { messages: addMessages },
  nodes: {
    agent: s => ({ messages: [scriptedModel(s.messages as Msg[])] }),
    tools: s => {
      const last = (s.messages as Msg[]).at(-1)!;
      return { messages: (last.toolCalls ?? []).map(c => ({ role: 'tool' as const, content: TOOLS[c.name](c.args), toolCallId: c.id })) };
    },
  },
  edges: { agent: s => ((s.messages as Msg[]).at(-1)?.toolCalls?.length ? 'tools' : END), tools: 'agent' },
};

export const approvalGraph: GraphSpec = {
  entry: 'write_draft',
  nodes: {
    write_draft: s => ({ draft: `Hi ${s.recipient}, let's sync tomorrow at 2pm.` }),
    send_email: (_s, approved) => ({ sent: !!approved }),
  },
  edges: { write_draft: 'send_email', send_email: END },
  interrupts: { send_email: s => ({ action: 'send_email', to: s.recipient }) },
};

/** supervisor picks the next worker from what's still missing */
export const supervisorGraph: GraphSpec = {
  entry: 'supervisor',
  nodes: {
    supervisor: s => ({ next: !s.notes ? 'researcher' : !s.draft ? 'writer' : 'FINISH' }),
    researcher: () => ({ notes: '3 facts on KV cache' }),
    writer: s => ({ draft: `post from ${s.notes}` }),
  },
  edges: { supervisor: s => (s.next === 'FINISH' ? END : String(s.next)), researcher: 'supervisor', writer: 'supervisor' },
};

/** "a, b" for a state dict, short values */
export function showState(s: GState, keys: string[]): string {
  return keys.map(k => `${k}=${fmtVal(s[k])}`).join(' ');
}
export function fmtVal(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'string') return v.length > 18 ? `"${v.slice(0, 16)}…"` : `"${v}"`;
  return String(v);
}

// ---------------- checkpointer ----------------
export interface Checkpoint {
  id: string;
  thread: string;
  /** node that just ran, or 'input' for the state saved when a call arrives */
  after: string;
  state: GState;
  parent?: string;
}

/** MemorySaver: state saved after every step, keyed by thread_id; a new invoke continues the thread. */
export class MemorySaver {
  checkpoints: Checkpoint[] = [];

  latest(thread: string): Checkpoint | undefined {
    return [...this.checkpoints].reverse().find(c => c.thread === thread);
  }

  /** graph.invoke(input, {"configurable": {"thread_id": thread}}); `fromId` = time travel: continue from an older checkpoint */
  invoke(spec: GraphSpec, thread: string, input: GState, fromId?: string): GRun {
    const base = fromId ? this.checkpoints.find(c => c.id === fromId) : this.latest(thread);
    const seq = this.checkpoints.filter(c => c.thread === thread).length;
    const state = mergeState(base?.state ?? {}, input, spec.reducers);
    const inputCk: Checkpoint = { id: `${thread}:${seq}`, thread, after: 'input', state, parent: base?.id };
    this.checkpoints.push(inputCk);
    const run = runGraph(spec, {}, { thread, from: state, seq: seq });
    let parent = inputCk.id;
    for (const st of run.steps) {
      this.checkpoints.push({ id: st.checkpoint, thread, after: st.node, state: st.state, parent });
      parent = st.checkpoint;
    }
    return run;
  }
}

/** a chat model that remembers only what's in the messages it is sent */
export function memoryModel(messages: Msg[]): Msg {
  const last = messages.at(-1)?.content ?? '';
  const told = messages.find(m => m.role === 'human' && /favorite color is (\w+)/.test(m.content));
  if (/what'?s my favorite color/i.test(last)) return { role: 'ai', content: told ? `It's ${told.content.match(/favorite color is (\w+)/)![1]}.` : "I don't know yet." };
  return { role: 'ai', content: 'Noted!' };
}

export const chatGraph: GraphSpec = {
  entry: 'chat',
  reducers: { messages: addMessages },
  nodes: { chat: s => ({ messages: [memoryModel(s.messages as Msg[])] }) },
  edges: { chat: END },
};
