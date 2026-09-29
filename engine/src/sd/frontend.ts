// Frontend architecture (group sd-frontend): CSR/SSR/SSG/ISR timelines, CORS, CSRF, XSS as message sequences.
import type { Lane } from './lib';
import type { Actor, SeqMsg } from './lib';
import { sdDemo, seqFrames, timelineFrames } from './lib';

const G = 'sd-frontend';

const LANES: Record<string, Lane> = {
  csr: {
    id: 'csr',
    label: 'CSR',
    segs: [
      { from: 0, to: 60, label: 'shell', tone: 'read' },
      { from: 60, to: 420, label: 'JS bundle', tone: 'accent' },
      { from: 420, to: 560, label: 'run JS', tone: 'write' },
      { from: 560, to: 820, label: 'API', tone: 'protocol' },
      { from: 820, to: 1000, label: 'usable', tone: 'ok' },
    ],
    detail: { title: 'Client-side rendering', text: 'The server sends an empty shell; the browser downloads JS, runs it, then fetches data before anything useful shows.', code: '<div id="root"></div>\n<script src="/app.3f9c.js"></script>' },
  },
  ssr: {
    id: 'ssr',
    label: 'SSR',
    segs: [
      { from: 0, to: 220, label: 'server render', tone: 'write' },
      { from: 220, to: 300, label: 'HTML', tone: 'read' },
      { from: 300, to: 640, label: 'JS bundle', tone: 'accent' },
      { from: 640, to: 780, label: 'hydrate', tone: 'warn' },
      { from: 780, to: 1000, label: 'usable', tone: 'ok' },
    ],
    detail: { title: 'Server-side rendering', text: 'The server runs the component tree per request and sends full HTML. The page is visible early but only interactive after hydration.', code: 'export async function getServerSideProps() {\n  return { props: { items: await db.list() } };\n}' },
  },
  ssg: {
    id: 'ssg',
    label: 'SSG',
    segs: [
      { from: 0, to: 40, label: 'CDN', tone: 'read' },
      { from: 40, to: 380, label: 'JS bundle', tone: 'accent' },
      { from: 380, to: 500, label: 'hydrate', tone: 'warn' },
      { from: 500, to: 1000, label: 'usable', tone: 'ok' },
    ],
    detail: { title: 'Static site generation', text: 'HTML is rendered once at build time and served from the CDN. Only as fresh as the last build.', code: 'export async function getStaticProps() {\n  return { props: { post: await cms.get(slug) } };\n}' },
  },
  isr: {
    id: 'isr',
    label: 'ISR',
    segs: [
      { from: 0, to: 40, label: 'CDN', tone: 'read' },
      { from: 40, to: 380, label: 'JS bundle', tone: 'accent' },
      { from: 380, to: 500, label: 'hydrate', tone: 'warn' },
      { from: 500, to: 1000, label: 'usable', tone: 'ok' },
    ],
    detail: { title: 'Incremental static regeneration', text: 'Serve the static page (maybe slightly stale) and regenerate it in the background after the revalidate window.', code: 'return {\n  props: { post },\n  revalidate: 60, // seconds\n};' },
  },
  regen: { id: 'regen', label: 'ISR rebuild', segs: [{ from: 60, to: 320, label: 'regenerate', tone: 'protocol' }] },
};

const tl = (ids: string[], beats: Parameters<typeof timelineFrames>[0]['beats']) => () => timelineFrames({ lanes: ids.map((i) => LANES[i]), span: 1000, unit: 'ms', beats, panel: 'First load' });

sdDemo(G, 'sd-fe-render', 'Rendering strategies', 'CSR, SSR, SSG and ISR on a first page load: when content shows and when it becomes interactive.', {
  csr: [
    'CSR',
    tl(['csr'], [
      { note: 'Client-side rendering: the first response is an almost empty HTML shell.', at: 60, rows: [['visible', 'blank']] },
      { note: 'Nothing shows until the JS bundle downloads and runs.', at: 560, rows: [['visible', 'spinner', 'warn']] },
      { note: 'Then it calls the API for data, one more round trip.', at: 820 },
      { note: 'Content and interactivity arrive together, late. Later route changes are fast because no page reloads.', at: 1000, marks: [[820, 'paint = usable', 'ok']], rows: [['first paint', '820 ms', 'warn'], ['interactive', '820 ms']] },
    ]),
  ],
  ssr: [
    'SSR',
    tl(['ssr'], [
      { note: 'Server-side rendering: the server renders HTML for this request, costing server CPU each time.', at: 220, rows: [['server cost', 'per request', 'warn']] },
      { note: 'Real content paints as soon as the HTML arrives. Crawlers see it too.', at: 300, marks: [[300, 'first paint', 'ok']], rows: [['first paint', '300 ms', 'ok']] },
      { note: 'The page looks ready but clicks do nothing until the JS loads and hydrates it.', at: 780, marks: [[300, 'first paint', 'ok'], [780, 'interactive']], rows: [['dead clicks', '480 ms', 'warn']] },
      { note: 'Streaming SSR and selective hydration shrink that gap. Hydration mismatches, from Date.now() during render for example, are the classic SSR bug.', at: 1000, marks: [[300, 'first paint', 'ok'], [780, 'interactive']] },
    ]),
  ],
  ssg: [
    'SSG',
    tl(['ssg'], [
      { note: 'Static generation: HTML was rendered at build time, so the CDN answers in tens of ms.', at: 40, marks: [[40, 'first paint', 'ok']], rows: [['server cost', 'none per request', 'ok']] },
      { note: 'The same bundle download and hydration still follow.', at: 500, marks: [[40, 'first paint', 'ok'], [500, 'interactive']] },
      { note: 'Fastest possible first load. But content is only as fresh as the last build and deploy.', at: 1000, marks: [[40, 'first paint', 'ok'], [500, 'interactive']], rows: [['freshness', 'last build', 'warn']] },
    ]),
  ],
  isr: [
    'ISR',
    tl(['isr', 'regen'], [
      { note: 'ISR serves the static page instantly, even if it is past its 60 s revalidate window.', at: 40, marks: [[40, 'stale page', 'warn']] },
      { note: 'That request also triggers a regeneration in the background.', at: 320, marks: [[40, 'stale page', 'warn']] },
      { note: 'The next visitor gets the fresh page, still from the CDN. It is stale-while-revalidate applied to whole pages.', at: 1000, marks: [[40, 'stale page', 'warn'], [320, 'fresh copy ready', 'ok']], rows: [['staleness', '≤ one request']] },
    ]),
  ],
  compare: [
    'Side by side',
    tl(['csr', 'ssr', 'ssg'], [
      { note: 'The three strategies on the same page and network.', at: 50 },
      { note: 'SSG paints first, SSR next, CSR last.', at: 400, marks: [[40, 'SSG'], [300, 'SSR'], [820, 'CSR']] },
      { note: 'Mix per route: marketing pages SSG, product pages SSR or ISR, the logged-in dashboard CSR.', at: 1000, marks: [[40, 'SSG'], [300, 'SSR'], [820, 'CSR']], rows: [['default', 'per-route mix', 'ok']] },
    ]),
  ],
});

// ---------- CORS ----------
const js: Actor = { id: 'js', label: 'app.com JS', detail: { title: 'Script on app.com', text: 'Runs in the browser under the app.com origin. The same-origin policy blocks it from reading responses from other origins by default.', code: 'fetch("https://api.com/me", {\n  credentials: "include",\n})' } };
const br: Actor = { id: 'br', label: 'Browser', detail: { title: 'The browser enforces it', text: 'CORS is enforced by the browser, not the server. curl or a backend can call api.com freely.' } };
const api: Actor = { id: 'api', label: 'api.com', detail: { title: 'The API decides who may read', text: 'CORS is the server opting in to cross-origin reads via response headers.', code: 'Access-Control-Allow-Origin: https://app.com\nAccess-Control-Allow-Credentials: true\nVary: Origin' } };
const simple: SeqMsg[] = [
  { from: 'js', to: 'br', label: 'fetch(api.com/me)', note: 'Script on app.com calls a different origin: scheme, host or port differ.' },
  { from: 'br', to: 'api', label: 'GET /me  Origin: app.com', note: 'A simple GET goes out at once. The browser adds the Origin header.' },
  { from: 'api', to: 'br', label: '200 (no ACAO)', kind: 'resp', note: 'The server answers, but without Access-Control-Allow-Origin.' },
  { from: 'br', to: 'js', label: 'TypeError: blocked', kind: 'fail', note: 'The browser hides the response from the script. The request still ran on the server.' },
];
const pre: SeqMsg[] = [
  { from: 'js', to: 'br', label: 'fetch PUT + JSON', note: 'A PUT with a JSON body and a custom header is not a simple request.' },
  { from: 'br', to: 'api', label: 'OPTIONS preflight', note: 'The browser first asks permission with a preflight OPTIONS request.' },
  { from: 'api', to: 'br', label: '204 Allow-Methods PUT', kind: 'resp', note: 'The server lists allowed origin, methods and headers, cacheable via Max-Age.' },
  { from: 'br', to: 'api', label: 'PUT /me', note: 'Only now does the real request go out.' },
  { from: 'api', to: 'br', label: '200 + ACAO app.com', kind: 'resp', note: 'The response carries the allow header again.' },
  { from: 'br', to: 'js', label: 'response readable', kind: 'resp', note: 'The script can read it. Two round trips for the first call, then the preflight is cached.' },
];
const creds: SeqMsg[] = [
  { from: 'js', to: 'br', label: 'fetch with cookies', note: 'The app wants the user’s session cookie sent cross-origin.' },
  { from: 'br', to: 'api', label: 'GET /me + cookie', note: 'With credentials included, the cookie rides along.' },
  { from: 'api', to: 'br', label: '200 ACAO: *', kind: 'resp', note: 'A wildcard origin plus credentials would let any site read a user’s private data.' },
  { from: 'br', to: 'js', label: 'blocked', kind: 'fail', note: 'So browsers refuse that combination. Echo one exact origin from an allow-list instead.' },
];
sdDemo(G, 'sd-fe-cors', 'CORS', 'Same-origin policy, simple requests, preflights and credentials, request by request.', {
  simple: ['Blocked read', () => seqFrames({ actors: [js, br, api], msgs: simple, intro: 'Two origins: the app on app.com, its API on api.com.', panel: 'CORS' })],
  preflight: ['Preflight', () => seqFrames({ actors: [js, br, api], msgs: pre, intro: 'A write with JSON triggers a preflight.', panel: 'CORS' })],
  credentials: ['Credentials', () => seqFrames({ actors: [js, br, api], msgs: creds, intro: 'Sending cookies across origins is stricter.', panel: 'CORS' })],
});

// ---------- CSRF ----------
const victim: Actor = { id: 'v', label: 'Victim browser', sub: 'logged in to bank' };
const evil: Actor = { id: 'ev', label: 'evil.com' };
const bank: Actor = { id: 'bk', label: 'bank.com', detail: { title: 'The target', text: 'Trusts "a valid session cookie was present" as proof of intent. That is the bug CSRF exploits.' } };
const attack: SeqMsg[] = [
  { from: 'v', to: 'ev', label: 'GET /cute-cats', note: 'The victim, still logged in to the bank, visits another site.' },
  { from: 'ev', to: 'v', label: 'page + hidden form', kind: 'resp', note: 'The page contains a form that auto-submits to bank.com.' },
  { from: 'v', to: 'bk', label: 'POST /transfer + cookie', kind: 'fail', note: 'The browser attaches the bank cookie automatically. CORS does not stop sending, only reading.' },
  { from: 'bk', to: 'bk', label: 'session valid → pay', kind: 'self', note: 'The bank sees a valid session and moves the money.' },
  { from: 'bk', to: 'v', label: '200', kind: 'resp', note: 'The attacker never saw the response and did not need to.' },
];
const samesite: SeqMsg[] = [
  { from: 'bk', to: 'v', label: 'Set-Cookie SameSite=Lax', note: 'At login the bank sets its session cookie with SameSite=Lax.' },
  { from: 'v', to: 'ev', label: 'GET /cute-cats', note: 'Same visit to the attacker page.' },
  { from: 'v', to: 'bk', label: 'POST /transfer (no cookie)', note: 'On a cross-site POST the browser now leaves the cookie off.' },
  { from: 'bk', to: 'v', label: '401 not logged in', kind: 'resp', note: 'No session, no transfer. Lax still sends it on top-level link clicks, which stay safe as GETs.' },
];
const token: SeqMsg[] = [
  { from: 'v', to: 'bk', label: 'GET /transfer form', note: 'The real form comes from the bank itself.' },
  { from: 'bk', to: 'v', label: 'form + csrf=9f2c…', kind: 'resp', note: 'It embeds an unpredictable token tied to the session.' },
  { from: 'v', to: 'bk', label: 'POST + cookie + 9f2c', note: 'Genuine submits include the token.' },
  { from: 'bk', to: 'v', label: '200 transferred', kind: 'resp', note: 'Token matches, so the request is accepted.' },
  { from: 'v', to: 'bk', label: 'forged POST (no token)', kind: 'fail', note: 'The attacker’s page can trigger a POST but cannot read the page to learn the token.' },
  { from: 'bk', to: 'v', label: '403', kind: 'resp', note: 'Rejected. Use SameSite and tokens together for sensitive actions.' },
];
sdDemo(G, 'sd-fe-csrf', 'CSRF', 'A forged cross-site request riding the victim’s cookie, then SameSite and CSRF tokens.', {
  attack: ['Attack', () => seqFrames({ actors: [victim, evil, bank], msgs: attack, intro: 'The attacker makes the victim’s own browser send the request.', panel: 'CSRF' })],
  samesite: ['SameSite', () => seqFrames({ actors: [victim, evil, bank], msgs: samesite, intro: 'Cookie attributes close most CSRF vectors.', panel: 'CSRF' })],
  token: ['CSRF token', () => seqFrames({ actors: [victim, evil, bank], msgs: token, intro: 'A token the attacker cannot know.', panel: 'CSRF' })],
});

// ---------- XSS ----------
const attacker: Actor = { id: 'at', label: 'Attacker' };
const site: Actor = { id: 'st', label: 'forum.com', detail: { title: 'Escape by context', text: 'Frameworks escape interpolation by default. The risk sits in escape hatches like dangerouslySetInnerHTML or v-html.', code: '<p>{comment.text}</p>            // escaped\n<p dangerouslySetInnerHTML=\n  {{ __html: comment.text }} />  // XSS' } };
const reader: Actor = { id: 'rd', label: 'Reader browser' };
const stored: SeqMsg[] = [
  { from: 'at', to: 'st', label: 'POST comment <script>', note: 'The attacker posts a comment containing a script.' },
  { from: 'st', to: 'st', label: 'saved unescaped', kind: 'self', note: 'The forum stores it and later renders it without escaping.' },
  { from: 'rd', to: 'st', label: 'GET /thread/9', note: 'Another user opens the thread.' },
  { from: 'st', to: 'rd', label: 'HTML + <script>', kind: 'resp', note: 'The script arrives as if forum.com wrote it.' },
  { from: 'rd', to: 'rd', label: 'script runs', kind: 'self', note: 'It runs with the forum’s origin: cookies, storage, the DOM.' },
  { from: 'rd', to: 'at', label: 'document.cookie', kind: 'fail', note: 'It sends the session cookie to the attacker. That is stored XSS.' },
];
const csp: SeqMsg[] = [
  { from: 'at', to: 'st', label: 'POST comment <script>', note: 'Same attack, but the forum now escapes output and sends a CSP.' },
  { from: 'rd', to: 'st', label: 'GET /thread/9', note: 'A reader opens the thread.' },
  { from: 'st', to: 'rd', label: 'HTML + CSP header', kind: 'resp', note: 'The comment is escaped text, and the policy forbids inline scripts.' },
  { from: 'rd', to: 'rd', label: 'inline script blocked', kind: 'self', note: 'Even if an injection slipped through, the browser refuses to run it.' },
  { from: 'rd', to: 'at', label: '(nothing sent)', kind: 'fail', note: 'An httpOnly session cookie would be unreadable anyway. Escaping, CSP and httpOnly stack as layers.' },
];
sdDemo(G, 'sd-fe-xss', 'XSS', 'Stored XSS stealing a session, and escaping, CSP and httpOnly as layered defenses.', {
  stored: ['Stored XSS', () => seqFrames({ actors: [attacker, site, reader], msgs: stored, intro: 'The attacker’s code runs as if it were the site’s.', panel: 'XSS' })],
  csp: ['Defended', () => seqFrames({ actors: [attacker, site, reader], msgs: csp, intro: 'The same attempt against a defended site.', panel: 'XSS', rows: [['CSP', "script-src 'self'"]] })],
});
