// LangChain (group `ai-langchain`) and LangGraph (group `ai-langgraph`): every message between app, runtime,
// model API and tools as a numbered sequence, and graphs run node by node with the State after each step.
import type { Detail } from '../algo/frames';
import { boardDemo, N } from '../machine/lib/board';
import type { Beat, Board, BoardNode } from '../machine/lib/board';
import type { Row } from '../machine/lib/draw';
import { sdDemo, seqFrames } from '../sd/lib';
import type { Actor, Seq, SeqMsg } from '../sd/lib';
import { agentGraph, approvalGraph, chatGraph, END, feeGraph, fmtVal, guessGraph, MemorySaver, promptTemplate, runGraph, runnable, scriptedModel, strParser, supervisorGraph, TOOLS, wordsGraph } from './langsim';
import type { GRun, GState, GraphSpec, Msg } from './langsim';

export * from './langsim';

const D = (title: string, text: string, code?: string): Detail => (code ? { title, text, code } : { title, text });

// ---------------- shared actors ----------------
const APP: Actor = { id: 'app', label: 'your app', sub: 'Python', detail: D('Your application', 'Owns the loop: it calls the chain or graph, and it runs any tool the model asks for.', 'chain = prompt | llm | StrOutputParser()\nprint(chain.invoke({"question": q}))') };
const LLM: Actor = { id: 'llm', label: 'LLM API', sub: 'chat model', detail: D('Chat model API', 'Stateless: every call must carry the whole conversation. It only returns text or tool-call requests, it never runs code.', 'llm = ChatOllama(model="llama3.2:3b",\n                 temperature=0)\nmsg = llm.invoke(messages)  # AIMessage') };
const PROMPT: Actor = { id: 'prompt', label: 'prompt', sub: 'ChatPromptTemplate', detail: D('Prompt template', 'A Runnable that turns a dict of variables into a list of chat messages.', 'prompt = ChatPromptTemplate.from_messages([\n    ("system", "Answer in exactly one word."),\n    ("human", "{question}"),\n])') };
const PARSER: Actor = { id: 'parser', label: 'parser', sub: 'StrOutputParser', detail: D('Output parser', 'A Runnable that unwraps the AIMessage into a plain string (or parses JSON, or a Pydantic model).', 'chain = prompt | llm | StrOutputParser()\nchain.invoke({"question": "sky color?"})\n# "Blue"') };

const lcDemo = (slug: string, title: string, summary: string, seqs: Record<string, [string, () => Seq]>) =>
  sdDemo('ai-langchain', slug, title, summary, Object.fromEntries(Object.entries(seqs).map(([k, [label, s]]) => [k, [label, () => seqFrames(s())]])));

const q1 = 'What color is the sky on a clear day?';
const PROMPT_TPL: [Msg['role'], string][] = [
  ['system', 'Answer in exactly one word.'],
  ['human', '{question}'],
];
const prompt = promptTemplate(PROMPT_TPL);
const fakeLlm = runnable<Msg[], Msg>('ChatOllama', ms => ({ role: 'ai', content: /sky/.test(ms.at(-1)!.content) ? 'Blue' : /2\+2/.test(ms.at(-1)!.content) ? '4' : '6' }));
export const lcelChain = prompt.pipe(fakeLlm).pipe(strParser);

// ---------------- LangChain: prompts, LCEL, structured output ----------------
lcDemo('lc-chain', 'Prompts, LCEL & structured output', 'prompt | model | parser as one Runnable: each hop between template, model API and parser, plus batch and with_structured_output.', {
  template: [
    'Prompt template',
    () => {
      const ms = prompt.invoke({ question: q1 });
      return {
        actors: [APP, PROMPT, LLM],
        intro: 'A prompt template is a recipe for messages with holes like {question}. Nothing has been sent yet.',
        panel: 'Messages',
        msgs: [
          { from: 'app', to: 'prompt', label: 'invoke(vars)', kind: 'req', note: 'The app calls the template with a dict of variables.', rows: [['question', `"${q1.slice(0, 24)}…"`]] },
          { from: 'prompt', to: 'prompt', label: 'fill {question}', kind: 'self', note: 'The template substitutes the variable and builds two messages.', rows: ms.map((m, i) => [`msg ${i + 1} ${m.role}`, m.content.length > 26 ? `${m.content.slice(0, 24)}…` : m.content] as Row) },
          { from: 'prompt', to: 'app', label: `${ms.length} messages`, kind: 'resp', note: 'Back comes a ChatPromptValue: system + human, ready for any chat model.', rows: [['messages', ms.length]] },
          { from: 'app', to: 'llm', label: 'invoke(msgs)', kind: 'req', note: 'The app sends those messages to the model API itself.', rows: [['roles', ms.map(m => m.role).join(', ')]] },
          { from: 'llm', to: 'app', label: 'AIMessage', kind: 'resp', note: 'Without a parser the answer comes wrapped in an AIMessage object, not a string.', rows: [['content', '"Blue"'], ['type', 'AIMessage']] },
        ],
      };
    },
  ],
  lcel: [
    'prompt | llm | parser',
    () => ({
      actors: [APP, PROMPT, LLM, PARSER],
      intro: `LCEL pipes Runnables like shell commands: ${lcelChain.name} is one Runnable.`,
      panel: 'Chain',
      rows: [['chain', 'prompt | llm | parser']],
      msgs: [
        { from: 'app', to: 'prompt', label: 'invoke(vars)', kind: 'req', note: 'chain.invoke() feeds the input dict to the first Runnable.', rows: [['input', '{question}']] },
        { from: 'prompt', to: 'llm', label: 'messages', kind: 'req', note: "The prompt's output becomes the model's input, with no glue code in between.", rows: [['messages', 2]] },
        { from: 'llm', to: 'parser', label: 'AIMessage', kind: 'resp', note: "The model's AIMessage flows straight into the parser.", rows: [['content', '"Blue"']] },
        { from: 'parser', to: 'app', label: '"Blue"', kind: 'resp', note: `The parser returns a plain string: "${lcelChain.invoke({ question: q1 })}".`, rows: [['output', 'str']] },
      ],
    }),
  ],
  batch: [
    '.batch()',
    () => {
      const out = lcelChain.batch([{ question: '2+2?' }, { question: '3+3?' }]);
      return {
        actors: [APP, { id: 'chain', label: 'chain', sub: 'Runnable', detail: D('A composed chain', 'invoke, batch and stream come free on every Runnable.', 'answers = chain.batch([\n    {"question": "2+2?"},\n    {"question": "3+3?"},\n])') }, LLM],
        intro: 'batch() runs several inputs through the same chain, concurrently where the provider allows.',
        panel: 'Batch',
        msgs: [
          { from: 'app', to: 'chain', label: 'batch([2])', kind: 'req', note: 'One call with two input dicts.', rows: [['inputs', 2]] },
          { from: 'chain', to: 'llm', label: '"2+2?"', kind: 'req', note: 'The chain fans out: the first input goes to the model.' },
          { from: 'chain', to: 'llm', label: '"3+3?"', kind: 'req', note: 'The second goes out without waiting for the first.' },
          { from: 'llm', to: 'chain', label: `"${out[0]}"`, kind: 'resp', note: 'Answers come back in whatever order the API finishes.' },
          { from: 'llm', to: 'chain', label: `"${out[1]}"`, kind: 'resp', note: 'Second answer in.' },
          { from: 'chain', to: 'app', label: JSON.stringify(out), kind: 'resp', note: 'batch() returns results in input order, whatever order they finished in.', rows: [['output', JSON.stringify(out)]] },
        ],
      };
    },
  ],
  structured: [
    'Structured output',
    () => ({
      actors: [APP, LLM, { id: 'pyd', label: 'Pydantic', sub: 'MovieReview', detail: D('Schema as a Pydantic model', 'with_structured_output turns this class into a JSON-schema tool the model must fill in.', 'class MovieReview(BaseModel):\n    title: str\n    sentiment: str  # positive|negative|mixed\n    one_line_summary: str\n\ns = llm.with_structured_output(MovieReview)') }],
      intro: 'with_structured_output(MovieReview) asks for typed data instead of prose.',
      panel: 'Structured output',
      msgs: [
        { from: 'app', to: 'pyd', label: 'schema()', kind: 'self', note: 'The Pydantic class becomes a JSON schema with three string fields.', rows: [['fields', 'title, sentiment, summary']] },
        { from: 'app', to: 'llm', label: 'review + schema', kind: 'req', note: 'The review text goes out with the schema attached as a tool the model must call.', rows: [['tool', 'MovieReview']] },
        { from: 'llm', to: 'app', label: 'tool_call args', kind: 'resp', note: 'The model answers with JSON arguments for that tool, not free text.', rows: [['title', '"Dune: Part Two"'], ['sentiment', '"mixed"']] },
        { from: 'app', to: 'pyd', label: 'validate', kind: 'req', note: 'LangChain validates the JSON against the class.' },
        { from: 'pyd', to: 'app', label: 'MovieReview', kind: 'resp', note: 'You get a typed object: result.sentiment, not a regex over prose.', rows: [['type', 'MovieReview']] },
      ],
    }),
  ],
});

// ---------------- LangChain: tool calling ----------------
const TOOL_ACTOR: Record<string, Actor> = {
  get_weather: { id: 'get_weather', label: 'get_weather', sub: '@tool', detail: D('@tool get_weather', 'A plain function; its name, docstring and type hints become the schema the model sees.', '@tool\ndef get_weather(city: str) -> str:\n    """Look up the current weather for a city."""\n    return fake_data.get(city.lower(), "No data")') },
  add: { id: 'add', label: 'add', sub: '@tool', detail: D('@tool add', 'Another tool. The model picks between tools from their descriptions alone.', '@tool\ndef add(a: int, b: int) -> int:\n    """Add two integers."""\n    return a + b') },
};

function toolSeq(question: string, onlyAdd: boolean): Seq {
  const first = scriptedModel([{ role: 'human', content: question }]);
  const calls = (first.toolCalls ?? []).filter(c => !onlyAdd || c.name === 'add');
  const results = calls.map(c => ({ role: 'tool' as const, content: TOOLS[c.name](c.args), toolCallId: c.id }));
  const msgs: SeqMsg[] = [
    { from: 'app', to: 'llm', label: 'question + tools', kind: 'req', note: `The app sends "${question}" plus the schemas of both tools.`, rows: [['tools', 'get_weather, add'], ['bound by', 'bind_tools()']] },
    { from: 'llm', to: 'app', label: `tool_calls[${calls.length}]`, kind: 'resp', note: 'The model does not answer yet: it asks for tool calls, as JSON.', rows: calls.map(c => [c.id, `${c.name}(${Object.values(c.args).join(', ')})`] as Row) },
  ];
  calls.forEach((c, i) => {
    msgs.push({ from: 'app', to: c.name, label: `${c.name}(…)`, kind: 'req', note: `Your code, not the model, runs ${c.name} with the arguments it asked for.`, rows: [['args', JSON.stringify(c.args)]] });
    msgs.push({ from: c.name, to: 'app', label: results[i].content.slice(0, 14), kind: 'resp', note: `The result is wrapped in a ToolMessage tied to ${c.id}.`, rows: [['ToolMessage', results[i].content]] });
  });
  const final = onlyAdd ? `17 + 25 = ${results[0].content}.` : scriptedModel([{ role: 'human', content: question }, first, ...results]).content;
  msgs.push({ from: 'app', to: 'llm', label: `+${calls.length} ToolMessage`, kind: 'req', note: 'The whole conversation goes back: question, the tool-call request and each result.', rows: [['messages', 2 + calls.length]] });
  msgs.push({ from: 'llm', to: 'app', label: 'final answer', kind: 'resp', note: `Now the model can answer: "${final}"`, rows: [['content', final.length > 26 ? `${final.slice(0, 24)}…` : final]] });
  return { actors: [APP, LLM, ...(onlyAdd ? [TOOL_ACTOR.add] : [TOOL_ACTOR.get_weather, TOOL_ACTOR.add])], intro: 'Tools are bound to the model with bind_tools(). The model can only ask for a call; the app executes it.', panel: 'Tool calling', msgs };
}

lcDemo('lc-tools', 'Tool calling, message by message', 'bind_tools(): the model requests tool calls as JSON, your app runs them, ToolMessages go back, then the final answer.', {
  both: ['Weather + math', () => toolSeq("What's the weather in Tokyo, and 17 + 25?", false)],
  add: ['One tool', () => toolSeq('What is 17 plus 25?', true)],
});

// ---------------- LangChain: RAG ----------------
const EMB: Actor = { id: 'emb', label: 'embeddings', sub: 'nomic-embed-text', detail: D('Embedding model', 'A different model from the chat model: text in, a vector out, similar meaning ends up close together.', 'embeddings = OllamaEmbeddings(\n    model="nomic-embed-text")\nv = embeddings.embed_query("refund?")  # 768 floats') };
const STORE: Actor = { id: 'store', label: 'vector store', sub: 'InMemoryVectorStore', detail: D('Vector store', 'Keeps (vector, document) pairs and answers nearest-neighbour queries. Chroma, pgvector and Pinecone share the same interface.', 'store = InMemoryVectorStore(embeddings)\nstore.add_documents(docs)\nhits = store.similarity_search(q, k=1)') };
const RAG_Q = 'Can I get my money back after 20 days?';
lcDemo('lc-rag', 'A RAG chain, hop by hop', 'Ingest (split → embed → store) and a query (embed → similarity search → prompt with context → model), every call shown.', {
  ingest: [
    'Ingest',
    () => ({
      actors: [APP, { id: 'split', label: 'splitter', sub: 'TextSplitter', detail: D('Text splitter', 'Cuts long documents into overlapping chunks small enough to embed and to fit in a prompt.', 'splitter = RecursiveCharacterTextSplitter(\n    chunk_size=500, chunk_overlap=50)\nchunks = splitter.split_documents(docs)') }, EMB, STORE],
      intro: 'Before any question, the documents are chunked, embedded and stored.',
      panel: 'Ingest',
      msgs: [
        { from: 'app', to: 'split', label: 'split 4 docs', kind: 'req', note: 'Four short documents: Eiffel Tower, Everest, the return policy and the GIL.', rows: [['documents', 4]] },
        { from: 'split', to: 'app', label: '4 chunks', kind: 'resp', note: 'Each is short enough to stay one chunk here.', rows: [['chunks', 4]] },
        { from: 'app', to: 'emb', label: 'embed ×4', kind: 'req', note: 'Every chunk goes to the embedding model.' },
        { from: 'emb', to: 'app', label: '4 × 768 floats', kind: 'resp', note: 'Back come four vectors, one per chunk.', rows: [['dims', 768]] },
        { from: 'app', to: 'store', label: 'add_documents', kind: 'req', note: 'Vectors and texts are stored together.' },
        { from: 'store', to: 'app', label: '4 ids', kind: 'resp', note: 'The store is ready to answer similarity queries.', rows: [['stored', 4]] },
      ],
    }),
  ],
  query: [
    'Question',
    () => ({
      actors: [APP, EMB, STORE, LLM],
      intro: `The user asks "${RAG_Q}"`,
      panel: 'Query',
      msgs: [
        { from: 'app', to: 'emb', label: 'embed(query)', kind: 'req', note: 'The question is embedded with the same model as the chunks.' },
        { from: 'emb', to: 'app', label: 'query vector', kind: 'resp', note: 'Now it can be compared with the stored vectors.' },
        { from: 'app', to: 'store', label: 'search k=1', kind: 'req', note: 'similarity_search ranks chunks by cosine similarity.', rows: [['k', 1]] },
        { from: 'store', to: 'app', label: 'refund policy', kind: 'resp', note: 'The closest chunk is the return policy, though it shares few words with the question.', rows: [['hit', '"refunds within 30 days…"']] },
        { from: 'app', to: 'app', label: 'fill prompt', kind: 'self', note: 'The chunk goes into {context} and the question into {question}.', rows: [['system', 'use ONLY the context']] },
        { from: 'app', to: 'llm', label: 'context + q', kind: 'req', note: 'The model gets the policy text alongside the question.' },
        { from: 'llm', to: 'app', label: 'grounded answer', kind: 'resp', note: 'The answer quotes your document, not the model’s training data.', rows: [['answer', '"Yes, within 30 days…"']] },
      ],
    }),
  ],
  offtopic: [
    'Off-topic question',
    () => ({
      actors: [APP, EMB, STORE, LLM],
      intro: 'Now a question the documents do not cover.',
      panel: 'Query',
      msgs: [
        { from: 'app', to: 'emb', label: 'embed(query)', kind: 'req', note: '"What\'s the capital of France?" is embedded.' },
        { from: 'emb', to: 'app', label: 'query vector', kind: 'resp', note: 'Its nearest neighbours are all far away.' },
        { from: 'app', to: 'store', label: 'search k=1', kind: 'req', note: 'The store always returns the best k, even when nothing is relevant.' },
        { from: 'store', to: 'app', label: 'Eiffel Tower', kind: 'resp', note: 'The closest chunk mentions Paris but not a capital.', rows: [['hit', 'Eiffel Tower, 1889'], ['relevant', 'no']] },
        { from: 'app', to: 'llm', label: 'context + q', kind: 'req', note: 'The prompt still says to use only the context.' },
        { from: 'llm', to: 'app', label: 'not covered', kind: 'resp', note: 'A well-prompted model says the context does not cover it instead of guessing.', rows: [['answer', '"The context doesn\'t say."']] },
      ],
    }),
  ],
});

// ---------------- LangChain: memory & tracing ----------------
lcDemo('lc-memory', 'Chat history & tracing', 'The model is stateless: history is resent every turn. Callbacks report every step to LangSmith.', {
  history: [
    'Chat history',
    () => ({
      actors: [APP, { id: 'hist', label: 'history', sub: 'list of messages', detail: D('Chat history', 'Just a list you append to. The model remembers nothing between calls.', 'history = []\nhistory.append(HumanMessage(text))\nreply = llm.invoke(history)\nhistory.append(reply)') }, LLM],
      intro: 'Two turns: "My favorite color is teal", then "What\'s my favorite color?"',
      panel: 'Memory',
      msgs: [
        { from: 'app', to: 'hist', label: 'append human', kind: 'self', note: 'Turn 1: the human message is appended.', rows: [['history', 1]] },
        { from: 'app', to: 'llm', label: '[1 message]', kind: 'req', note: 'The whole history, one message, is sent.' },
        { from: 'llm', to: 'app', label: '"Noted!"', kind: 'resp', note: 'The reply is appended too.', rows: [['history', 2]] },
        { from: 'app', to: 'hist', label: 'append human', kind: 'self', note: 'Turn 2: the question is appended.', rows: [['history', 3]] },
        { from: 'app', to: 'llm', label: '[3 messages]', kind: 'req', note: 'All three messages go out again, so the model can see turn 1.' },
        { from: 'llm', to: 'app', label: '"It\'s teal."', kind: 'resp', note: 'It "remembers" only because the app resent the history.', rows: [['history', 4], ['tokens', 'grow every turn']] },
      ],
    }),
  ],
  trace: [
    'Callbacks & LangSmith',
    () => ({
      actors: [APP, { id: 'chain', label: 'chain', sub: 'Runnable', detail: D('Callbacks', 'Every Runnable emits start/end/error events to its callback handlers.', 'chain.invoke(x, config={"callbacks": [h],\n    "tags": ["checkout"], "run_name": "qa"})') }, LLM, { id: 'ls', label: 'LangSmith', sub: 'tracing', detail: D('LangSmith tracing', 'Enabled with environment variables; runs are uploaded in the background as a nested run tree.', 'export LANGSMITH_TRACING=true\nexport LANGSMITH_API_KEY=lsv2_...\nexport LANGSMITH_PROJECT=hello-langchain') }],
      intro: 'With tracing on, each step reports to LangSmith off the request path.',
      panel: 'Tracing',
      msgs: [
        { from: 'app', to: 'chain', label: 'invoke', kind: 'req', note: 'The app calls the chain as usual.' },
        { from: 'chain', to: 'ls', label: 'chain start', kind: 'async', note: 'A run is opened for the chain, in the background.', rows: [['run', 'RunnableSequence']] },
        { from: 'chain', to: 'llm', label: 'messages', kind: 'req', note: 'The model call becomes a child run.' },
        { from: 'llm', to: 'chain', label: 'AIMessage', kind: 'resp', note: 'Tokens and latency are captured.', rows: [['tokens', '41 in / 3 out']] },
        { from: 'chain', to: 'ls', label: 'llm end', kind: 'async', note: 'The child run is closed with its inputs, outputs and token counts.' },
        { from: 'chain', to: 'app', label: 'result', kind: 'resp', note: 'The app gets its answer; tracing never blocked it.' },
        { from: 'chain', to: 'ls', label: 'run tree', kind: 'async', note: 'The finished tree shows every prompt and output for debugging.', rows: [['runs', 3]] },
      ],
    }),
  ],
});

// ---------------- LangGraph: graph views ----------------
const CODE_TITLE = 'agent.py';
const node = (id: string, x: number, y: number, w: number, h: number, label: string, sub: string, detail: Detail): BoardNode => N(id, x, y, w, h, label, sub, { detail });
const START_NODE = (x: number, y: number) => node('start', x, y, 200, 70, 'START', 'input', D('START', 'Where invoke() enters the graph with the input State.', 'builder.add_edge(START, "first_node")'));
const END_NODE = (x: number, y: number) => node('end', x, y, 200, 70, 'END', 'return state', D('END', 'Reaching END returns the final State to the caller.', 'builder.add_edge("last_node", END)\nresult = graph.invoke(inputs)'));

/** State rows after a step: changed keys highlighted */
const stateRows = (s: GState, keys: string[], changed: string[] = []): Row[] => keys.map(k => [k, fmtVal(s[k]), changed.includes(k) ? 'write' : undefined] as Row);

/** One beat per super-step of a real run, lighting the node that ran and the edge taken. */
function runBeats(run: GRun, keys: string[], first: string, say: (st: GRun['steps'][number], i: number) => string, input: GState): Beat[] {
  const beats: Beat[] = [{ note: `graph.invoke() starts at START with ${Object.keys(input).join(', ')}.`, hot: { start: 'current', [`start>${first}`]: 'accent' }, rows: [...stateRows(input, keys), ['step', 0]] }];
  run.steps.forEach((st, i) => {
    const next = st.next === END ? 'end' : st.next;
    beats.push({ note: say(st, i), hot: { [st.node]: 'current', [`${st.node}>${next}`]: 'accent', ...(next === 'end' ? { end: 'ok' } : {}) }, rows: [...stateRows(st.state, keys, st.changed), ['step', i + 1]] });
  });
  return beats;
}

const wordsInput = { text: 'hello graph world', word_count: 0 };
const wordsRun = runGraph(wordsGraph, wordsInput);
const basicsBoard: Board = {
  panel: 'State',
  codeTitle: CODE_TITLE,
  code: ['builder = StateGraph(State)', 'builder.add_node("count_words", count_words)', 'builder.add_node("shout", shout)', 'builder.add_edge(START, "count_words")', 'builder.add_edge("count_words", "shout")', 'builder.add_edge("shout", END)', 'graph = builder.compile()'],
  nodes: [
    START_NODE(400, 330),
    node('count_words', 300, 450, 400, 100, 'count_words', 'returns {word_count}', D('A node is a function', 'It gets the current State and returns only the keys it changes.', 'def count_words(state: State) -> dict:\n    return {"word_count":\n            len(state["text"].split())}')),
    node('shout', 300, 610, 400, 100, 'shout', 'returns {text}', D('Partial updates', 'LangGraph merges the returned dict into the State; word_count is left alone.', 'def shout(state: State) -> dict:\n    return {"text": state["text"].upper() + "!"}')),
    END_NODE(400, 780),
  ],
  edges: ['start>count_words', 'count_words>shout', 'shout>end'],
  beats: [
    ...runBeats(wordsRun, ['text', 'word_count'], 'count_words', st => (st.node === 'count_words' ? `count_words returns only {word_count: ${st.update.word_count}}, merged into the State.` : 'shout returns only {text}; the count from the step before is kept.'), wordsInput),
    { note: `END returns the final State: ${fmtVal(wordsRun.state.text)}, ${wordsRun.state.word_count} words.`, hot: { end: 'ok' }, rows: stateRows(wordsRun.state, ['text', 'word_count']) },
  ],
};

function feeBoard(amount: number): Board {
  const input = { amount, category: '', fee: 0 };
  const run = runGraph(feeGraph, input);
  return {
    panel: 'State',
    codeTitle: CODE_TITLE,
    code: ['def route_by_category(state) -> str:', '    return state["category"]', '', 'builder.add_conditional_edges("classify",', '    route_by_category,', '    {"small": "small", "medium": "medium",', '     "large": "large"})'],
    nodes: [
      START_NODE(400, 330),
      node('classify', 330, 440, 340, 100, 'classify', 'sets category', D('classify', 'Writes a category into the State; the router reads it next.', 'def classify(state):\n    a = state["amount"]\n    cat = ("small" if a < 100 else\n           "medium" if a < 10_000 else "large")\n    return {"category": cat}')),
      node('small', 40, 620, 280, 100, 'small', 'fee 5%', D('small', 'One of three branches; only the routed one runs.', 'def small_fee(state):\n    return {"fee": state["amount"] * 0.05}')),
      node('medium', 360, 620, 280, 100, 'medium', 'fee 2%', D('medium', 'Chosen when 100 ≤ amount < 10,000.', 'def medium_fee(state):\n    return {"fee": state["amount"] * 0.02}')),
      node('large', 680, 620, 280, 100, 'large', 'fee 0.5%', D('large', 'Chosen for 10,000 and up.', 'def large_fee(state):\n    return {"fee": state["amount"] * 0.005}')),
      END_NODE(400, 820),
    ],
    edges: ['start>classify', 'classify>small', 'classify>medium', 'classify>large', 'small>end', 'medium>end', 'large>end'],
    beats: [
      ...runBeats(run, ['amount', 'category', 'fee'], 'classify', st => (st.node === 'classify' ? `classify sets category = "${st.state.category}", and route_by_category sends the run down that branch.` : `Only ${st.node} runs: fee = ${fmtVal(st.state.fee)}.`), input),
      { note: 'A conditional edge is an if/elif/else between nodes. The routing function reads State and returns a name.', hot: { end: 'ok' }, rows: stateRows(run.state, ['amount', 'category', 'fee']) },
    ],
  };
}

const guessInput = { target: 73, guess: 0, attempts: 0 };
const guessRun = runGraph(guessGraph, guessInput);
const loopBoard: Board = {
  panel: 'State',
  codeTitle: CODE_TITLE,
  code: ['def is_close_enough(state) -> str:', '    if state["guess"] == state["target"]:', '        return "done"', '    if state["attempts"] >= 10: return "give_up"', '    return "keep_guessing"'],
  nodes: [
    START_NODE(400, 250),
    node('guess', 300, 370, 400, 100, 'guess', 'halfway to target', D('A node in a cycle', 'Runs again every time the router sends the run back, until done or the cap.', 'def guess(state):\n    g = state["guess"]\n    n = g + (state["target"] - g) // 2\n    return {"guess": n,\n            "attempts": state["attempts"] + 1}')),
    node('route', 300, 560, 400, 100, 'is_close_enough', 'router', D('The router', 'A conditional edge that can point backwards: this is what makes it a graph, not a chain.', 'builder.add_conditional_edges("guess",\n  is_close_enough,\n  {"keep_guessing": "guess",\n   "done": END, "give_up": END})')),
    node('again', 760, 450, 220, 90, 'keep_guessing', 'loop back', D('The cycle', 'Every loop needs a hard cap as well as a done condition.')),
    END_NODE(400, 780),
  ],
  edges: ['start>guess', 'guess>route', 'route>again', 'again>guess', 'route>end'],
  beats: [
    { note: 'Start at guess = 0, target 73.', hot: { start: 'current', 'start>guess': 'accent' }, rows: stateRows(guessInput, ['target', 'guess', 'attempts']) },
    ...guessRun.steps.map((st, i): Beat => {
      const done = st.next === END;
      return {
        note: done ? `Attempt ${i + 1} hits ${st.state.guess}, so the router returns "done".` : `Attempt ${i + 1}: guess ${st.state.guess}, not there yet, so the edge loops back.`,
        hot: { guess: 'current', 'guess>route': 'accent', route: 'write', ...(done ? { 'route>end': 'ok', end: 'ok' } : { 'route>again': 'accent', again: 'write', 'again>guess': 'accent' }) },
        rows: stateRows(st.state, ['target', 'guess', 'attempts'], st.changed),
      };
    }),
  ],
};

boardDemo('ai-langgraph', 'lg-graph', 'StateGraph: nodes, edges, routers & cycles', 'Typed State, nodes that return partial updates, conditional edges and loops, run node by node from the hello-langgraph examples.', {
  basics: ['Nodes & edges', basicsBoard],
  small: ['Router: 42', feeBoard(42)],
  medium: ['Router: 5,000', feeBoard(5000)],
  large: ['Router: 250,000', feeBoard(250_000)],
  loop: ['Cycle', loopBoard],
});

// ---------------- LangGraph: the agent loop ----------------
const agentInput = { messages: [{ role: 'human', content: "Weather in Tokyo, and 17 + 25?" } as Msg] };
export const agentRun = runGraph(agentGraph, agentInput);
const msgSummary = (m: Msg) => (m.toolCalls?.length ? `ai: ${m.toolCalls.length} tool_calls` : `${m.role}: ${m.content.length > 18 ? `${m.content.slice(0, 16)}…` : m.content}`);

const agentBoard: Board = {
  panel: 'State',
  codeTitle: CODE_TITLE,
  code: ['builder.add_node("agent", call_model)', 'builder.add_node("tools", ToolNode(tools))', 'builder.add_edge(START, "agent")', 'builder.add_conditional_edges("agent",', '    tools_condition)  # tools or END', 'builder.add_edge("tools", "agent")'],
  nodes: [
    START_NODE(90, 300),
    node('agent', 100, 420, 320, 100, 'agent', 'LLM + bind_tools', D('Model node', 'Calls the model with the whole messages list and appends its reply.', 'def call_model(state):\n    msg = llm_with_tools.invoke(\n        state["messages"])\n    return {"messages": [msg]}')),
    node('route', 100, 600, 320, 100, 'tools_condition', 'tool_calls?', D('tools_condition', 'Routes to tools if the last AI message asked for any, else to END.', 'from langgraph.prebuilt import tools_condition')),
    node('tools', 560, 600, 320, 100, 'tools', 'ToolNode', D('ToolNode', 'Runs every requested tool call and appends one ToolMessage each.', 'tools = [get_weather, add]\nbuilder.add_node("tools", ToolNode(tools))')),
    END_NODE(160, 800),
  ],
  edges: ['start>agent', 'agent>route', 'route>tools', 'tools>agent', 'route>end'],
  beats: [
    { note: 'The State holds one key, messages, merged with add_messages so updates append.', hot: { start: 'current', 'start>agent': 'accent' }, rows: [['messages', 1], ['last', msgSummary(agentInput.messages[0])]] },
    ...agentRun.steps.map((st, i): Beat => {
      const ms = st.state.messages as Msg[];
      const last = ms.at(-1)!;
      if (st.node === 'agent' && st.next === 'tools') return { note: `Step ${i + 1}: the model asks for ${last.toolCalls!.length} tool calls, so tools_condition routes to tools.`, hot: { agent: 'current', 'agent>route': 'accent', route: 'write', 'route>tools': 'accent' }, rows: [['messages', ms.length, 'write'], ['last', msgSummary(last), 'write']] };
      if (st.node === 'tools') return { note: `Step ${i + 1}: ToolNode runs both tools and appends ${(st.update.messages as Msg[]).length} ToolMessages, then goes back to agent.`, hot: { tools: 'current', 'tools>agent': 'accent' }, rows: [['messages', ms.length, 'write'], ['last', msgSummary(last), 'write']] };
      return { note: `Step ${i + 1}: no tool calls this time, so the loop ends with the answer.`, hot: { agent: 'current', 'agent>route': 'accent', route: 'write', 'route>end': 'ok', end: 'ok' }, rows: [['messages', ms.length, 'write'], ['answer', last.content.slice(0, 26), 'ok']] };
    }),
  ],
};

function agentWire(): Seq {
  const GRAPH: Actor = { id: 'graph', label: 'graph', sub: 'compiled', detail: D('Compiled graph', 'Runs super-steps: pick the next node, call it, merge its update into the State.', 'graph = builder.compile()\nfor chunk in graph.stream(inputs,\n        stream_mode="updates"):\n    print(chunk)') };
  const TOOLS_A: Actor = { id: 'tools', label: 'tools', sub: 'get_weather, add', detail: TOOL_ACTOR.get_weather.detail };
  const msgs: SeqMsg[] = [{ from: 'app', to: 'graph', label: 'invoke', kind: 'req', note: 'The app hands the graph one human message.', rows: [['messages', 1]] }];
  for (const st of agentRun.steps) {
    const ms = st.state.messages as Msg[];
    if (st.node === 'agent') {
      const reply = ms.at(-1)!;
      msgs.push({ from: 'graph', to: 'llm', label: `${ms.length - 1} msgs + tools`, kind: 'req', note: 'Node agent: the whole message list and the tool schemas go to the model.', rows: [['messages sent', ms.length - 1]] });
      msgs.push({ from: 'llm', to: 'graph', label: reply.toolCalls?.length ? `${reply.toolCalls.length} tool_calls` : 'answer', kind: 'resp', note: reply.toolCalls?.length ? 'The model asks for tools; the edge routes to the tools node.' : 'A plain answer: the edge routes to END.', rows: reply.toolCalls?.map(c => [c.id, c.name] as Row) ?? [['answer', reply.content.slice(0, 24)]] });
    } else {
      for (const t of st.update.messages as Msg[]) {
        msgs.push({ from: 'graph', to: 'tools', label: t.toolCallId!, kind: 'req', note: `Node tools runs the call ${t.toolCallId}.` });
        msgs.push({ from: 'tools', to: 'graph', label: t.content.slice(0, 14), kind: 'resp', note: 'Its result is appended as a ToolMessage.', rows: [['ToolMessage', t.content]] });
      }
    }
  }
  msgs.push({ from: 'graph', to: 'app', label: 'final State', kind: 'resp', note: `invoke() returns every message; the last one is the answer.`, rows: [['messages', (agentRun.state.messages as Msg[]).length]] });
  return { actors: [APP, GRAPH, LLM, TOOLS_A], intro: 'The same agent loop, as the messages that cross the wire.', panel: 'Agent', msgs };
}

boardDemo('ai-langgraph', 'lg-agent', 'The agent loop as a graph', 'agent ↔ tools until the model stops asking for tools: the graph view and every model/tool call on the wire. See also AI → Agents for ReAct in general.', {
  graph: ['Graph view', agentBoard],
});
sdDemo('ai-langgraph', 'lg-agent-wire', 'Agent loop on the wire', 'The same LangGraph agent run as numbered messages between app, graph runtime, model API and tools.', {
  wire: ['On the wire', () => seqFrames(agentWire())],
});

// ---------------- LangGraph: checkpoints, time travel, human in the loop ----------------
const human = (content: string): Msg => ({ role: 'human', content });
const ckNode = (id: string, x: number, y: number, label: string, sub: string, state: GState): BoardNode => node(id, x, y, 180, 90, label, sub, D(`Checkpoint ${label}`, 'The full State saved after this step, under its thread_id.', `graph.get_state(config)\n# messages: ${((state.messages as Msg[]) ?? []).length}\n# ${((state.messages as Msg[]) ?? []).map(m => m.role).join(', ')}`));

function threadsBoard(): Board {
  const saver = new MemorySaver();
  saver.invoke(chatGraph, 'conversation-1', { messages: [human('My favorite color is teal.')] });
  saver.invoke(chatGraph, 'conversation-1', { messages: [human("What's my favorite color?")] });
  saver.invoke(chatGraph, 'conversation-2', { messages: [human("What's my favorite color?")] });
  const t1 = saver.checkpoints.filter(c => c.thread === 'conversation-1');
  const t2 = saver.checkpoints.filter(c => c.thread === 'conversation-2');
  const last = (c: (typeof t1)[number]) => (c.state.messages as Msg[]).at(-1)!;
  const nodes = [
    node('t1', 20, 330, 960, 60, 'thread_id = "conversation-1"', '', D('A thread', 'Every invoke with the same thread_id continues the same saved State.', 'config = {"configurable":\n          {"thread_id": "conversation-1"}}\ngraph.invoke({"messages": [msg]}, config)')),
    ...t1.map((c, i) => ckNode(`c1-${i}`, 20 + i * 245, 420, c.id, `after ${c.after}`, c.state)),
    node('t2', 20, 620, 960, 60, 'thread_id = "conversation-2"', '', D('Another thread', 'Isolated: it sees none of conversation-1.')),
    ...t2.map((c, i) => ckNode(`c2-${i}`, 20 + i * 245, 710, c.id, `after ${c.after}`, c.state)),
  ];
  const edges = [...t1.slice(1).map((_, i) => `c1-${i}>c1-${i + 1}`), ...t2.slice(1).map((_, i) => `c2-${i}>c2-${i + 1}`)];
  const hide = (upto: string[]) => nodes.map(n => n.id).filter(id => !upto.includes(id));
  const ids1 = t1.map((_, i) => `c1-${i}`);
  const ids2 = t2.map((_, i) => `c2-${i}`);
  return {
    panel: 'Checkpoints',
    codeTitle: CODE_TITLE,
    code: ['graph = builder.compile(checkpointer=MemorySaver())', 'config = {"configurable": {"thread_id": "conversation-1"}}', 'graph.invoke({"messages": [HumanMessage(text)]}, config)'],
    nodes,
    edges,
    beats: [
      { note: 'Turn 1 arrives: the input is saved as a checkpoint before any node runs.', hot: { t1: 'current', 'c1-0': 'write' }, hide: hide(['t1', 'c1-0']), rows: [['thread', 'conversation-1'], ['messages', (t1[0].state.messages as Msg[]).length]] },
      { note: `chat runs and replies "${last(t1[1]).content}"; a new checkpoint holds 2 messages.`, hot: { 'c1-1': 'write', 'c1-0>c1-1': 'accent' }, hide: hide(['t1', 'c1-0', 'c1-1']), rows: [['messages', 2], ['saved', t1[1].id]] },
      { note: 'Turn 2 passes only the new question; the checkpointer adds it to the saved history.', hot: { 'c1-2': 'write', 'c1-1>c1-2': 'accent' }, hide: hide(['t1', ...ids1.slice(0, 3)]), rows: [['messages', 3], ['passed in', 1]] },
      { note: `The model sees all 3 messages and answers "${last(t1[3]).content}"`, hot: { 'c1-3': 'ok', 'c1-2>c1-3': 'accent' }, hide: hide(['t1', ...ids1]), rows: [['messages', 4], ['saved', t1[3].id]] },
      { note: `A different thread_id starts empty, so the same question gets "${last(t2[1]).content}"`, hot: { t2: 'current', 'c2-1': 'warn', 'c2-0>c2-1': 'accent' }, rows: [['threads', 2], ['conversation-2', `${(t2[1].state.messages as Msg[]).length} messages`]] },
      { note: 'Swap MemorySaver for SqliteSaver or PostgresSaver and the same threads survive restarts.', hot: Object.fromEntries([...ids1, ...ids2].map(id => [id, 'ok'])), rows: [['checkpoints', saver.checkpoints.length]] },
    ],
  };
}

function timeTravelBoard(): Board {
  const saver = new MemorySaver();
  saver.invoke(chatGraph, 't', { messages: [human('My favorite color is teal.')] });
  saver.invoke(chatGraph, 't', { messages: [human("What's my favorite color?")] });
  const fork = saver.checkpoints[1].id;
  saver.invoke(chatGraph, 't', { messages: [human('Actually, my favorite color is red.')] }, fork);
  const cs = saver.checkpoints;
  const main = cs.slice(0, 4);
  const branch = cs.slice(4);
  const lastOf = (c: (typeof cs)[number]) => (c.state.messages as Msg[]).at(-1)!.content;
  const nodes = [...main.map((c, i) => ckNode(`m${i}`, 20 + i * 245, 380, c.id, `after ${c.after}`, c.state)), ...branch.map((c, i) => ckNode(`b${i}`, 265 + (i + 1) * 245, 620, c.id, `after ${c.after}`, c.state))];
  return {
    panel: 'Time travel',
    codeTitle: CODE_TITLE,
    code: ['history = list(graph.get_state_history(config))', 'old = history[-2].config  # after turn 1', 'graph.invoke({"messages": [msg]}, old)', '# forks a new branch from that checkpoint'],
    nodes,
    edges: ['m0>m1', 'm1>m2', 'm2>m3', 'm1>b0', 'b0>b1'],
    beats: [
      { note: 'Every step of the thread is kept, not just the latest State.', hot: { m0: 'write', m1: 'write', m2: 'write', m3: 'write' }, hide: ['b0', 'b1'], rows: [['checkpoints', main.length]] },
      { note: `get_state_history lists them; pick ${fork}, the State right after turn 1.`, hot: { m1: 'current' }, hide: ['b0', 'b1'], rows: [['chosen', fork], ['messages', 2]] },
      { note: 'Invoke with that checkpoint in the config: the new input is appended to the old State.', hot: { m1: 'current', 'm1>b0': 'accent', b0: 'write' }, hide: ['b1'], rows: [['parent', fork], ['messages', (branch[0].state.messages as Msg[]).length]] },
      { note: `chat runs on the branch and replies "${lastOf(branch[1])}"`, hot: { b0: 'write', 'b0>b1': 'accent', b1: 'ok' }, rows: [['branch', `${branch.length} checkpoints`], ['original', 'kept']] },
      { note: 'The original path still exists: you can replay or debug from any point.', hot: { m3: 'ok', b1: 'ok' }, rows: [['total', cs.length]] },
    ],
  };
}

function hitlBoard(): Board {
  const input = { recipient: 'Priya', draft: '', sent: false };
  const r1 = runGraph(approvalGraph, input, { thread: 'approval-1' });
  const r2 = runGraph(approvalGraph, {}, { thread: 'approval-1', resume: { node: 'send_email', value: true, state: r1.state, seq: r1.steps.length } });
  const keys = ['recipient', 'draft', 'sent'];
  return {
    panel: 'State',
    codeTitle: CODE_TITLE,
    code: ['def send_email(state):', '    ok = interrupt({"action": "send_email",', '                    "to": state["recipient"]})', '    return {"sent": bool(ok)}', '# later: graph.invoke(Command(resume=True), config)'],
    nodes: [
      START_NODE(400, 300),
      node('write_draft', 300, 400, 400, 100, 'write_draft', 'drafts the email', D('write_draft', 'Runs once; resuming later does not re-run it.', 'def write_draft(state):\n    return {"draft": f"Hi {state[\'recipient\']}..."}')),
      node('send_email', 300, 570, 400, 100, 'send_email', 'interrupt()', D('interrupt()', 'Pauses the graph inside this node and hands the payload to the caller. Needs a checkpointer.', 'from langgraph.types import interrupt, Command\napproved = interrupt({"to": state["recipient"]})')),
      node('human', 760, 570, 220, 100, 'human', 'approve?', D('The human', 'Any UI can answer: a CLI, a Slack button, a web form.', 'payload = result["__interrupt__"][0].value\ngraph.invoke(Command(resume=True), config)')),
      END_NODE(400, 760),
    ],
    edges: ['start>write_draft', 'write_draft>send_email', 'send_email>human', 'send_email>end'],
    beats: [
      { note: 'The graph starts with a recipient and no draft.', hot: { start: 'current', 'start>write_draft': 'accent' }, rows: stateRows(input, keys) },
      { note: 'write_draft fills in the draft and a checkpoint is saved.', hot: { write_draft: 'current', 'write_draft>send_email': 'accent' }, rows: stateRows(r1.steps[0].state, keys, r1.steps[0].changed) },
      { note: `send_email calls interrupt(): the run pauses at ${r1.interrupted!.checkpoint} and invoke() returns __interrupt__.`, hot: { send_email: 'warn', 'send_email>human': 'accent', human: 'current' }, rows: [...stateRows(r1.state, keys), ['status', 'paused', 'warn']] },
      { note: 'Nothing runs while the human reads the draft, for seconds or days.', hot: { human: 'current', send_email: 'warn' }, rows: [['payload', 'send_email → Priya'], ['status', 'paused', 'warn']] },
      { note: 'Command(resume=True) re-enters send_email, where interrupt() now returns True.', hot: { human: 'ok', send_email: 'current', 'send_email>end': 'accent' }, rows: stateRows(r2.steps[0].state, keys, r2.steps[0].changed) },
      { note: 'The email is sent and the graph reaches END; write_draft did not run again.', hot: { end: 'ok', send_email: 'ok' }, rows: [...stateRows(r2.state, keys), ['status', 'done', 'ok']] },
    ],
  };
}

boardDemo('ai-langgraph', 'lg-persist', 'Checkpoints, time travel & human in the loop', 'MemorySaver snapshots the State after every step per thread_id: multi-turn memory, forking from old checkpoints, and interrupt()/Command(resume) approvals.', {
  threads: ['Threads', threadsBoard()],
  timetravel: ['Time travel', timeTravelBoard()],
  hitl: ['Human approval', hitlBoard()],
});

// ---------------- LangGraph: multi-agent & streaming ----------------
function supervisorBoard(): Board {
  const run = runGraph(supervisorGraph, { notes: '', draft: '', next: '' });
  const keys = ['next', 'notes', 'draft'];
  return {
    panel: 'State',
    codeTitle: CODE_TITLE,
    code: ['builder.add_conditional_edges("supervisor",', '    lambda s: s["next"],', '    {"researcher": "researcher",', '     "writer": "writer", "FINISH": END})', 'builder.add_edge("researcher", "supervisor")', 'builder.add_edge("writer", "supervisor")'],
    nodes: [
      START_NODE(400, 300),
      node('supervisor', 300, 410, 400, 100, 'supervisor', 'LLM picks next', D('Supervisor', 'A model call whose only job is choosing which worker goes next, or FINISH.', 'def supervisor(state):\n    choice = router_llm.invoke(state)\n    return {"next": choice.next}')),
      node('researcher', 40, 620, 400, 100, 'researcher', 'gathers notes', D('Worker agent', 'Often its own subgraph with its own tools.', 'def researcher(state):\n    return {"notes": search(state["topic"])}')),
      node('writer', 560, 620, 400, 100, 'writer', 'writes the draft', D('Worker agent', 'Sees the shared State, so it can use the notes.', 'def writer(state):\n    return {"draft": llm.invoke(state["notes"])}')),
      END_NODE(400, 800),
    ],
    edges: ['start>supervisor', 'supervisor>researcher', 'supervisor>writer', 'supervisor>end'],
    beats: [
      { note: 'A supervisor graph: one router agent and two workers sharing the State.', hot: { start: 'current', 'start>supervisor': 'accent' }, rows: stateRows({ next: '', notes: '', draft: '' }, keys) },
      ...run.steps.map((st): Beat => {
        if (st.node === 'supervisor') {
          const to = st.next === END ? 'end' : st.next;
          return { note: st.next === END ? 'Notes and draft exist, so the supervisor returns FINISH.' : `Nothing for ${st.next} yet, so the supervisor hands off to it.`, hot: { supervisor: 'current', [`supervisor>${to}`]: 'accent', ...(to === 'end' ? { end: 'ok' } : {}) }, rows: stateRows(st.state, keys, st.changed) };
        }
        return { note: `${st.node} does its part and control returns to the supervisor.`, hot: { [st.node]: 'current', [`supervisor>${st.node}`]: 'write' }, rows: stateRows(st.state, keys, st.changed) };
      }),
    ],
  };
}

function streamBoard(): Board {
  const steps = wordsRun.steps;
  return {
    panel: 'stream()',
    codeTitle: CODE_TITLE,
    code: ['for chunk in graph.stream(inputs,', '        stream_mode="updates"):', '    print(chunk)', '# "values": full State after each step', '# "messages": LLM tokens as they arrive'],
    nodes: basicsBoard.nodes,
    edges: basicsBoard.edges,
    beats: [
      { note: 'stream() yields while the graph runs instead of only returning at END.', hot: { start: 'current' }, rows: [['mode', 'updates']] },
      { note: 'updates mode yields each node’s own partial update as soon as it returns.', hot: { count_words: 'current' }, rows: [['chunk 1', `{count_words: {word_count: ${steps[0].update.word_count}}}`]] },
      { note: 'The second chunk carries only what shout changed.', hot: { shout: 'current' }, rows: [['chunk 2', `{shout: {text: ${fmtVal(steps[1].update.text)}}}`]] },
      { note: 'values mode yields the whole State after every step instead.', hot: { count_words: 'write', shout: 'write' }, rows: [['mode', 'values'], ['chunk 2', `{text, word_count: ${steps[1].state.word_count}}`]] },
      { note: 'messages mode streams LLM tokens from inside nodes, for chat UIs.', hot: { end: 'ok' }, rows: [['mode', 'messages'], ['chunk', '("Tok", {node: "agent"})']] },
    ],
  };
}

boardDemo('ai-langgraph', 'lg-multi', 'Multi-agent & streaming', 'A supervisor routing between worker agents over shared State, and what stream() yields in updates, values and messages modes.', {
  supervisor: ['Supervisor', supervisorBoard()],
  stream: ['Streaming', streamBoard()],
});

/** exposed for tests */
export const _boards = { basicsBoard, loopBoard, agentBoard, feeBoard, threadsBoard, timeTravelBoard, hitlBoard, supervisorBoard, streamBoard };
export type { GraphSpec };
