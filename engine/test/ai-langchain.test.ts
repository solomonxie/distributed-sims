import { allDemos, frames, getDemo } from '../src/algo';
import type { Shape } from '../src/algo';
import { agentGraph, approvalGraph, chatGraph, END, feeGraph, guessGraph, lcelChain, MemorySaver, mergeState, addMessages, promptTemplate, runGraph, runnable, supervisorGraph, wordsGraph } from '../src/ai/langchain';
import type { Msg } from '../src/ai/langchain';

describe('LCEL', () => {
  test('pipe composes left to right, batch keeps order', () => {
    const inc = runnable<number, number>('inc', x => x + 1);
    const dbl = runnable<number, number>('dbl', x => x * 2);
    const ch = inc.pipe(dbl);
    expect(ch.invoke(3)).toBe(8);
    expect(ch.name).toBe('inc | dbl');
    expect(ch.batch([1, 2])).toEqual([4, 6]);
  });
  test('prompt template fills variables; chain returns a string', () => {
    const p = promptTemplate([['system', 'one word'], ['human', '{question}']]);
    expect(p.invoke({ question: 'sky?' })).toEqual([{ role: 'system', content: 'one word' }, { role: 'human', content: 'sky?' }]);
    expect(lcelChain.invoke({ question: 'What color is the sky?' })).toBe('Blue');
    expect(lcelChain.batch([{ question: '2+2?' }, { question: '3+3?' }])).toEqual(['4', '6']);
  });
});

describe('StateGraph', () => {
  test('partial updates merge; reducers append', () => {
    expect(mergeState({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
    expect(mergeState({ m: [1] }, { m: [2] }, { m: addMessages })).toEqual({ m: [1, 2] });
  });
  test('hello-langgraph step 1', () => {
    const r = runGraph(wordsGraph, { text: 'hello graph world', word_count: 0 });
    expect(r.state).toEqual({ text: 'HELLO GRAPH WORLD!', word_count: 3 });
    expect(r.steps.map(s => s.node)).toEqual(['count_words', 'shout']);
    expect(r.steps[1].changed).toEqual(['text']);
  });
  test('router picks exactly one branch', () => {
    for (const [amount, cat, fee] of [[42, 'small', 2.1], [5000, 'medium', 100], [250000, 'large', 1250]] as const) {
      const r = runGraph(feeGraph, { amount, category: '', fee: 0 });
      expect(r.steps.map(s => s.node)).toEqual(['classify', cat]);
      expect(r.state.fee).toBeCloseTo(fee);
    }
  });
  test('cycle reaches 73 in 8 attempts', () => {
    const r = runGraph(guessGraph, { target: 73, guess: 0, attempts: 0 });
    expect(r.state).toMatchObject({ guess: 73, attempts: 8 });
    expect(r.steps.map(s => s.state.guess)).toEqual([36, 54, 63, 68, 70, 71, 72, 73]);
  });
  test('agent loop: agent → tools → agent → END', () => {
    const r = runGraph(agentGraph, { messages: [{ role: 'human', content: 'q' }] });
    expect(r.steps.map(s => s.node)).toEqual(['agent', 'tools', 'agent']);
    const ms = r.state.messages as Msg[];
    expect(ms.map(m => m.role)).toEqual(['human', 'ai', 'tool', 'tool', 'ai']);
    expect(ms.at(-1)!.content).toContain('42');
    expect(r.steps.at(-1)!.next).toBe(END);
  });
  test('interrupt pauses, resume continues without re-running earlier nodes', () => {
    const r1 = runGraph(approvalGraph, { recipient: 'Priya', draft: '', sent: false });
    expect(r1.interrupted?.node).toBe('send_email');
    expect(r1.steps.map(s => s.node)).toEqual(['write_draft']);
    const r2 = runGraph(approvalGraph, {}, { resume: { node: 'send_email', value: true, state: r1.state, seq: 1 } });
    expect(r2.steps.map(s => s.node)).toEqual(['send_email']);
    expect(r2.state.sent).toBe(true);
  });
  test('checkpointer threads remember; other threads are isolated; forks branch', () => {
    const s = new MemorySaver();
    const h = (content: string): Msg => ({ role: 'human', content });
    s.invoke(chatGraph, 'c1', { messages: [h('My favorite color is teal.')] });
    const r = s.invoke(chatGraph, 'c1', { messages: [h("What's my favorite color?")] });
    expect((r.state.messages as Msg[]).length).toBe(4);
    expect((r.state.messages as Msg[]).at(-1)!.content).toBe("It's teal.");
    const r2 = s.invoke(chatGraph, 'c2', { messages: [h("What's my favorite color?")] });
    expect((r2.state.messages as Msg[]).at(-1)!.content).toBe("I don't know yet.");
    const fork = s.invoke(chatGraph, 'c1', { messages: [h('My favorite color is red.')] }, 'c1:1');
    expect((fork.state.messages as Msg[]).length).toBe(4);
  });
  test('supervisor visits researcher then writer then finishes', () => {
    const r = runGraph(supervisorGraph, { notes: '', draft: '', next: '' });
    expect(r.steps.map(s => s.node)).toEqual(['supervisor', 'researcher', 'supervisor', 'writer', 'supervisor']);
  });
});

const GROUPS = ['ai-langchain', 'ai-langgraph'];
const demos = () => allDemos().filter(d => GROUPS.includes(d.group));

function points(s: Shape): number[] {
  switch (s.t) {
    case 'rect':
      return [s.x, s.y, s.x + s.w, s.y + s.h];
    case 'line':
      return [s.x1, s.y1, s.x2, s.y2];
    case 'arc':
      return [s.cx - s.r, s.cy - s.r, s.cx + s.r, s.cy + s.r];
    case 'node':
      return s.r ? [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r] : [s.x, s.y];
    case 'edge':
      return [s.from, s.to].flatMap(p => (typeof p === 'string' ? [] : [p.x, p.y]));
    default:
      return [s.x, s.y];
  }
}

test('both groups have demos', () => {
  for (const g of GROUPS) expect(demos().filter(d => d.group === g).length).toBeGreaterThanOrEqual(3);
});

describe.each(demos().flatMap(d => d.inputs.map(i => [`${d.slug}/${i.id}`, d.slug, i.data] as const)))('%s', (_n, slug, data) => {
  const fs = frames(getDemo(slug)!, data);
  test('≥ 3 frames, ends done', () => {
    expect(fs.length).toBeGreaterThanOrEqual(3);
    expect(fs[fs.length - 1].done).toBe(true);
    expect(fs.slice(0, -1).some(f => f.done)).toBe(false);
  });
  test('unique ids, bounds, short notes, details', () => {
    let tappable = 0;
    for (const f of fs) {
      const ids = f.shapes.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of f.shapes) {
        for (const v of points(s)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1000);
        }
        if ((s.t === 'rect' || s.t === 'node') && s.detail) {
          tappable++;
          expect(s.detail.title.length).toBeGreaterThan(0);
          expect(!!(s.detail.text || s.detail.code)).toBe(true);
          for (const l of (s.detail.code ?? '').split('\n')) expect(l.length).toBeLessThanOrEqual(60);
        }
      }
      expect([f.note, (f.note.match(/[.!?](\s|$)/g) ?? []).length <= 2]).toEqual([f.note, true]);
    }
    expect(tappable).toBeGreaterThan(0);
  });
});
