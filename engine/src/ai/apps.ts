// Building with LLMs: retrieval-augmented generation, agent loops with tools, durable agents, evaluation.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import { fmt } from './grid';
import { chunk, recallAtK, rrf } from './math';

// ---------------- RAG ----------------
const DOC_WORDS = 'Refunds are issued within 14 days of a return . Items must be unused . Gift returns get store credit . Shipping is free over 50 dollars .'.split(' ');
export const RAG_CHUNKS = chunk(DOC_WORDS, 10, 3);

const RAG_NODES = [
  N('user', 30, 40, 270, 100, 'user', '"can I get a refund?"', { detail: { title: 'User question', text: 'Free text, often phrased nothing like the documents.' } }),
  N('app', 365, 40, 270, 100, 'RAG app', 'orchestrates', { detail: { title: 'The RAG app', text: 'Glue code: embed the question, retrieve, build a prompt with the chunks, call the LLM, return the answer with sources.', code: 'q = embed(question)\nhits = store.search(q, k=20, where={"lang": "en"})\ntop = rerank(question, hits)[:4]\nprompt = TEMPLATE.format(ctx=top, q=question)\nreturn llm(prompt), [h.source for h in top]' } }),
  N('embed', 700, 40, 270, 100, 'embedding model', 'text → vector', { detail: { title: 'Embedding model', text: 'The same model embeds chunks at ingest and questions at query time.', code: 'ollama.embeddings(model="nomic-embed-text",\n                  prompt=question)' } }),
  N('store', 700, 250, 270, 110, 'vector store', 'chunks + vectors', { detail: { title: 'Vector store', text: 'Chunks with their vectors and metadata; approximate nearest-neighbour index (HNSW).', code: 'col = chroma.create_collection("docs")\ncol.add(ids=ids, embeddings=vecs,\n        documents=chunks, metadatas=meta)' } }),
  N('bm25', 365, 250, 270, 110, 'keyword index', 'BM25', { detail: { title: 'BM25', text: 'Classic term matching. Catches exact codes, names and numbers that embeddings blur.' } }),
  N('rerank', 365, 440, 270, 110, 'reranker', 'cross-encoder', { detail: { title: 'Reranker', text: 'Reads question and chunk together and scores relevance: slower, much more precise, so it runs on the top ~20 only.', code: 'scores = cross_encoder.predict(\n    [(question, h.text) for h in hits])' } }),
  N('llm', 700, 440, 270, 110, 'LLM', 'answers from context', { detail: { title: 'Generation', text: 'The prompt says: answer only from the context, cite sources, say "I don’t know" otherwise.' } }),
  N('docs', 30, 250, 270, 110, 'documents', 'policy.md', { detail: { title: 'Source documents', text: 'Split into overlapping chunks so an answer isn’t cut in half at a boundary.', code: `chunks = chunk(words, size=10, overlap=3)\n# ${RAG_CHUNKS.length} chunks` } }),
  N('answer', 30, 640, 940, 110, 'answer + sources', '"Yes, within 14 days of the return. [policy.md#1]"', { detail: { title: 'Grounded answer', text: 'Citations let users and evals check every claim against the retrieved chunk.' } }),
];
const RAG_EDGES = ['docs>embed', 'embed>store', 'user>app', 'app>embed', 'app>store', 'store>app', 'app>bm25', 'bm25>app', 'app>rerank', 'rerank>app', 'app>llm', 'llm>app', 'app>answer'];

const fused = rrf([
  ['c1', 'c3', 'c2'],
  ['c3', 'c1', 'c4'],
]);
const recall = recallAtK(['c1', 'c3', 'c2', 'c4'], ['c1', 'c3'], 2);

boardDemo('ai-rag', 'ai-rag', 'Retrieval-augmented generation', 'Ingest (chunk → embed → store), then every request/response of a query: embed, vector + keyword search, rerank, prompt, answer with sources.', {
  ingest: [
    'Ingest',
    {
      panel: 'Ingest',
      nodes: RAG_NODES,
      edges: RAG_EDGES,
      beats: [
        { note: `The policy document is split into ${RAG_CHUNKS.length} overlapping chunks of 10 words.`, hot: { docs: 'current' }, hide: ['user', 'app', 'bm25', 'rerank', 'llm', 'answer'], rows: [['chunks', RAG_CHUNKS.length]] },
        { note: 'Request: each chunk goes to the embedding model; response: one vector per chunk.', hot: { embed: 'current', 'docs>embed': 'accent' }, hide: ['user', 'app', 'bm25', 'rerank', 'llm', 'answer'], rows: [['vector', '768 dims']] },
        { note: 'Vectors, text and metadata go into the vector store, ready for queries.', hot: { store: 'ok', 'embed>store': 'accent' }, hide: ['user', 'app', 'bm25', 'rerank', 'llm', 'answer'], rows: [['indexed', RAG_CHUNKS.length, 'ok']] },
      ],
    },
  ],
  query: [
    'Query, hop by hop',
    {
      panel: 'Query',
      nodes: RAG_NODES,
      edges: RAG_EDGES,
      beats: [
        { note: 'Request: the user asks the app a question.', hot: { user: 'current', 'user>app': 'accent' }, hide: ['bm25', 'rerank', 'answer'], rows: [['hop', 'user → app']] },
        { note: 'Request: the app embeds the question; response: a query vector.', hot: { embed: 'current', 'app>embed': 'accent' }, hide: ['bm25', 'rerank', 'answer'], rows: [['hop', 'app ↔ embedder']] },
        { note: 'Request: nearest-neighbour search; response: the top 20 chunks by cosine similarity.', hot: { store: 'current', 'app>store': 'accent', 'store>app': 'ok' }, hide: ['bm25', 'rerank', 'answer'], rows: [['candidates', 20]] },
        { note: 'Request: the prompt with the best chunks goes to the LLM; response: an answer grounded in them.', hot: { llm: 'current', 'app>llm': 'accent', 'llm>app': 'ok' }, hide: ['bm25', 'rerank', 'answer'], rows: [['prompt', '4 chunks + question']] },
        { note: 'The app returns the answer with the chunk ids as citations.', hot: { answer: 'ok', 'app>answer': 'accent' }, hide: ['bm25', 'rerank'], rows: [['latency', '~1.2 s']] },
      ],
    },
  ],
  hybrid: [
    'Hybrid + rerank',
    {
      panel: 'Retrieval',
      nodes: RAG_NODES,
      edges: RAG_EDGES,
      beats: [
        { note: 'Vector search misses exact terms like "14 days"; BM25 misses paraphrases like "money back".', hot: { store: 'warn', bm25: 'warn' }, hide: ['answer'], rows: [['vector', 'c1, c3, c2'], ['BM25', 'c3, c1, c4']] },
        { note: 'Hybrid search asks both in parallel and merges the lists with reciprocal rank fusion.', hot: { store: 'current', bm25: 'current', 'app>store': 'accent', 'app>bm25': 'accent', 'store>app': 'ok', 'bm25>app': 'ok' }, hide: ['answer'], rows: [['RRF top', `${fused[0].id} ${fmt(fused[0].score * 1000)}‰`, 'ok']] },
        { note: 'Request: the fused top 20 go to a cross-encoder reranker; response: them re-ordered by true relevance.', hot: { rerank: 'current', 'app>rerank': 'accent', 'rerank>app': 'ok' }, hide: ['answer'], rows: [['kept', 4]] },
        { note: `Evaluate retrieval separately from generation: here recall@2 = ${fmt(recall)}.`, hot: { answer: 'ok' }, rows: [['recall@2', fmt(recall), 'ok'], ['faithfulness', 'LLM judge']] },
      ],
    },
  ],
});

// ---------------- agents ----------------
const AGENT_NODES = [
  N('user', 30, 40, 280, 100, 'user', '"weather in Paris, in °F?"', { detail: { title: 'User', text: 'A goal that needs outside information or actions, not just text.' } }),
  N('loop', 360, 40, 280, 100, 'agent loop', 'your code', { detail: { title: 'The agent loop', text: 'Send messages + tool schemas to the model; if it asks for a tool, run it, append the result, and call the model again.', code: 'while True:\n    r = llm(messages, tools=TOOLS)\n    if not r.tool_calls:\n        return r.content\n    for c in r.tool_calls:\n        out = TOOLS[c.name](**c.args)\n        messages.append(tool_msg(c.id, out))' } }),
  N('llm', 690, 40, 280, 100, 'LLM', 'decides next action', { detail: { title: 'Tool calling', text: 'The model returns either text or a structured call {name, arguments} matching a JSON schema you provided.', code: '{"name": "get_weather",\n "arguments": {"city": "Paris"}}' } }),
  N('weather', 360, 260, 280, 110, 'get_weather', 'HTTP API', { detail: { title: 'Tool: weather API', text: 'Ordinary code. Errors are returned to the model as text so it can retry or change plan.' } }),
  N('calc', 690, 260, 280, 110, 'calculator', 'python sandbox', { detail: { title: 'Tool: code sandbox', text: 'Model-written code runs in an isolated container with CPU, memory and network limits.', code: 'kern run --memory 256m --cpus 0.5 \\\n  --network none python:3.12 \\\n  python -c "print(18 * 9 / 5 + 32)"' } }),
  N('memory', 30, 260, 280, 110, 'messages', 'the context so far', { detail: { title: 'Conversation state', text: 'Every call re-sends the whole transcript: user turn, tool calls and tool results.' } }),
  N('store', 30, 480, 280, 110, 'checkpoint', 'state after each step', { detail: { title: 'Checkpointing', text: 'LangGraph saves graph state per thread after every node, so a run can pause for a human or resume after a crash.', code: 'app = graph.compile(checkpointer=SqliteSaver(conn))\napp.invoke(inp, {"configurable":\n    {"thread_id": "t1"}})' } }),
  N('temporal', 360, 480, 610, 110, 'durable workflow (Temporal)', 'activities retried, history replayed', { detail: { title: 'Durable execution', text: 'Each LLM or tool call is an activity with retries; the workflow’s event history survives crashes and restarts exactly where it stopped.', code: '@workflow.defn\nclass Agent:\n    @workflow.run\n    async def run(self, goal):\n        plan = await workflow.execute_activity(\n            call_llm, goal,\n            retry_policy=RetryPolicy(max_attempts=5))' } }),
  N('answer', 30, 700, 940, 100, 'answer', '"18 °C, which is 64.4 °F."', { detail: { title: 'Final answer', text: 'The loop stops when the model replies with text instead of a tool call.' } }),
];
const AGENT_EDGES = ['user>loop', 'loop>llm', 'llm>loop', 'loop>weather', 'weather>loop', 'loop>calc', 'calc>loop', 'loop>memory', 'loop>answer', 'memory>store', 'store>temporal'];

boardDemo('ai-agents', 'ai-agent', 'Agents & tool use', 'The ReAct loop request by request (model → tool call → result → model), then state checkpoints and durable execution.', {
  react: [
    'Tool loop, hop by hop',
    {
      panel: 'Agent',
      nodes: AGENT_NODES,
      edges: AGENT_EDGES,
      beats: [
        { note: 'The user’s goal enters the agent loop.', hot: { user: 'current', 'user>loop': 'accent' }, hide: ['store', 'temporal', 'answer'], rows: [['turn', 1]] },
        { note: 'Request 1: messages and tool schemas go to the LLM; response: a get_weather call for Paris.', hot: { llm: 'current', 'loop>llm': 'accent', 'llm>loop': 'ok' }, hide: ['store', 'temporal', 'answer'], rows: [['LLM calls', 1]] },
        { note: 'Request: the loop runs the tool; response: {"temp_c": 18}.', hot: { weather: 'current', 'loop>weather': 'accent', 'weather>loop': 'ok' }, hide: ['store', 'temporal', 'answer'], rows: [['tool calls', 1]] },
        { note: 'The call and its result are appended to the messages.', hot: { memory: 'current', 'loop>memory': 'accent' }, hide: ['store', 'temporal', 'answer'], rows: [['messages', 4]] },
        { note: 'Request 2: the LLM sees the result and asks for a conversion; response: calculator("18*9/5+32").', hot: { llm: 'current', 'loop>llm': 'accent', 'llm>loop': 'ok' }, hide: ['store', 'temporal', 'answer'], rows: [['LLM calls', 2]] },
        { note: 'Request: the code runs in a sandbox; response: 64.4.', hot: { calc: 'current', 'loop>calc': 'accent', 'calc>loop': 'ok' }, hide: ['store', 'temporal', 'answer'], rows: [['tool calls', 2]] },
        { note: 'Request 3: with both results, the LLM answers in plain text, which ends the loop.', hot: { llm: 'ok', answer: 'ok', 'loop>llm': 'accent', 'loop>answer': 'accent' }, hide: ['store', 'temporal'], rows: [['LLM calls', 3], ['stop', 'no tool call', 'ok']] },
      ],
    },
  ],
  durable: [
    'State & durability',
    {
      panel: 'Durability',
      nodes: AGENT_NODES,
      edges: AGENT_EDGES,
      beats: [
        { note: 'Long agent runs fail midway: rate limits, crashes, a human needs to approve.', hot: { loop: 'warn' }, rows: [['risk', 'lost progress', 'warn']] },
        { note: 'A graph framework saves the messages and state after every node to a checkpointer.', hot: { store: 'current', 'memory>store': 'accent' }, rows: [['checkpoints', 'per step']] },
        { note: 'Human-in-the-loop: the run pauses at an approval node and resumes from the checkpoint days later.', hot: { store: 'ok', user: 'current' }, rows: [['pause', 'interrupt_before']] },
        { note: 'Temporal goes further: each LLM and tool call is a retried activity, and a crashed worker resumes from event history.', hot: { temporal: 'ok', 'store>temporal': 'accent' }, rows: [['guarantee', 'exactly-once workflow', 'ok']] },
      ],
    },
  ],
});

// ---------------- evaluation ----------------
const EVAL_NODES = [
  N('cases', 30, 60, 440, 120, 'test cases', 'input + expected / rubric', { detail: { title: 'Eval set', text: 'A versioned file of real inputs with what a good answer must contain. Grows with every bug found.', code: '- input: "refund after 20 days?"\n  must_include: ["14 days"]\n  rubric: "polite, cites policy"' } }),
  N('model', 530, 60, 440, 120, 'system under test', 'prompt + model + RAG', { detail: { title: 'System under test', text: 'Test the whole pipeline, not just the model: prompts, retrieval and parsing change behaviour too.' } }),
  N('exact', 30, 300, 290, 120, 'exact / regex', 'cheap, strict', { detail: { title: 'String metrics', text: 'Exact match, contains, regex, JSON-schema valid. Fast and deterministic: use them wherever the answer is checkable.', code: 'assert "14 days" in out\nassert json.loads(out)["status"] in {"ok", "err"}' } }),
  N('judge', 355, 300, 290, 120, 'LLM as judge', 'rubric score 1–5', { detail: { title: 'LLM-as-judge', text: 'A second model grades against a rubric. Check it against human labels; judges favour long and first-listed answers.', code: 'score = judge(f"Rubric: {rubric}\\nAnswer: {out}\\n"\n              "Score 1-5, reply JSON")' } }),
  N('pair', 680, 300, 290, 120, 'pairwise A vs B', 'which is better?', { detail: { title: 'Pairwise comparison', text: 'Easier for judges than absolute scores. Run both orders to cancel position bias.' } }),
  N('report', 30, 540, 940, 130, 'report per version', 'pass rate · score · cost · latency', { detail: { title: 'Regression tracking', text: 'Store every run keyed by prompt/model version; a drop in pass rate blocks the change like a failing unit test.' } }),
];

boardDemo('ai-eval', 'ai-eval', 'Evaluating LLM systems', 'From exact-match checks to LLM-as-judge and pairwise comparison, run as a regression suite per version.', {
  suite: [
    'Eval suite',
    {
      panel: 'Eval',
      nodes: EVAL_NODES,
      edges: ['cases>model', 'model>exact', 'model>judge', 'model>pair', 'exact>report', 'judge>report', 'pair>report'],
      beats: [
        { note: 'Start from real inputs with what a good answer must contain.', hot: { cases: 'current' }, rows: [['cases', 120]] },
        { note: 'Request: every case runs through the full system; response: its output.', hot: { model: 'current', 'cases>model': 'accent' }, rows: [['runs', 120]] },
        { note: 'Checkable answers get exact or regex checks: free and deterministic.', hot: { exact: 'current', 'model>exact': 'accent' }, rows: [['string checks', '84 pass']] },
        { note: 'Open-ended answers go to a judge model with a rubric, validated against human labels.', hot: { judge: 'current', 'model>judge': 'accent' }, rows: [['judge mean', '4.1 / 5']] },
        { note: 'Two versions can be compared head to head, in both orders to cancel position bias.', hot: { pair: 'current', 'model>pair': 'accent' }, rows: [['B beats A', '61%']] },
        { note: 'Results are stored per version, so a regression blocks the change like a failing test.', hot: { report: 'ok', 'exact>report': 'accent', 'judge>report': 'accent', 'pair>report': 'accent' }, rows: [['pass rate', '91% → 87%', 'fail']] },
      ],
    },
  ],
});

export type { Detail };
