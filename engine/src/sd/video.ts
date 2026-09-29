// Video streaming (group sd-video): ABR player loop, VOD and live pipelines, HLS requests through a CDN.
import type { Frame, Shape } from '../algo/frames';
import { box, Film, line, panel, text } from '../machine/lib/draw';
import { boardDemo, N } from '../machine/lib/board';
import type { Actor, SeqMsg } from './lib';
import { abrPick, sdDemo, seqFrames } from './lib';

const G = 'sd-video';
export const LADDER = [400, 1200, 2500, 5000, 8000];
const RES: Record<number, string> = { 400: '240p', 1200: '480p', 2500: '720p', 5000: '1080p', 8000: '4K' };
const SEG = 4;

export interface AbrStep {
  seg: number;
  tput: number;
  buffer: number;
  pick: number;
  dl: number;
  stalled: boolean;
}

/** Simulate a player: estimate = last segment's throughput; buffer drains by download time, gains SEG per segment. */
export function simulateAbr(tputs: number[], startBuffer = 0): AbrStep[] {
  let buffer = startBuffer;
  let est = 1000;
  const out: AbrStep[] = [];
  tputs.forEach((tput, seg) => {
    const pick = abrPick(LADDER, est, buffer);
    const dl = (pick * SEG) / tput;
    const stalled = dl > buffer && seg > 0;
    buffer = Math.max(0, buffer - dl) + SEG;
    buffer = Math.min(buffer, 30);
    est = tput;
    out.push({ seg, tput, buffer, pick, dl, stalled });
  });
  return out;
}

const PROFILES: Record<string, { label: string; tputs: number[]; intro: string; outro: string }> = {
  steady: { label: 'Steady Wi-Fi', tputs: [9000, 9500, 9000, 10000, 9500, 9800, 9200, 9600], intro: 'Each 4 s segment, the player measures throughput and picks the next rendition.', outro: 'It starts low to start fast, then climbs to the highest bitrate that fits.' },
  drop: { label: 'Train tunnel', tputs: [9000, 9500, 9000, 1500, 900, 1200, 6000, 9000], intro: 'The connection collapses mid-stream, then recovers.', outro: 'Quality dips instead of stalling, then climbs back. The buffer absorbed the gap.' },
  flaky: { label: 'Noisy 4G', tputs: [4000, 1500, 5500, 1800, 6000, 2000, 5000, 2500], intro: 'Throughput swings every segment on a noisy connection.', outro: 'Buffer health damps the swings. Picking by throughput alone would flip quality every segment.' },
};

function abrFrames(key: string): Frame[] {
  const p = PROFILES[key];
  const steps = simulateAbr(p.tputs);
  const f = new Film();
  const X0 = 90;
  const BW = 108;
  const H = 520;
  const top = 120;
  const y = (kbps: number) => top + H - (Math.min(kbps, 10000) / 10000) * H;
  const draw = (upto: number): Shape[] => {
    const out: Shape[] = [text('ttl', 20, 40, 'kbps per 4 s segment', { align: 'left', size: 26, bold: true })];
    LADDER.forEach((r) => out.push(line(`g${r}`, X0, y(r), X0 + BW * 8, y(r), 'muted', { dashed: true, width: 1 }), text(`gl${r}`, X0 - 8, y(r), RES[r], { align: 'right', size: 24, tone: 'muted' })));
    steps.slice(0, upto + 1).forEach((s, i) => {
      const x = X0 + i * BW + 8;
      out.push(box(`tp${i}`, x, y(s.tput), BW - 16, top + H - y(s.tput), undefined, { tone: 'visited', dashed: true, filled: false }));
      out.push(box(`pk${i}`, x + 16, y(s.pick), BW - 48, top + H - y(s.pick), undefined, { tone: s.stalled ? 'fail' : i === upto ? 'current' : 'accent' }));
      out.push(text(`bf${i}`, x + (BW - 16) / 2, top + H + 40, `${s.buffer.toFixed(0)}s`, { size: 24, tone: s.buffer < 6 ? 'warn' : 'default' }));
    });
    out.push(text('bfl', 20, top + H + 40, 'buf', { align: 'left', size: 24, tone: 'muted' }));
    out.push(box('leg1', 90, 760, 380, 60, 'dashed = throughput', { tone: 'visited', filled: false }), box('leg2', 520, 760, 380, 60, 'solid = chosen', { tone: 'accent' }));
    const s = steps[upto];
    if (s) out.push(box('pick', 90, 860, 810, 100, `segment ${upto + 1}: ${RES[s.pick]} (${s.pick} kbps)`, { sub: `downloaded in ${s.dl.toFixed(1)} s, buffer ${s.buffer.toFixed(0)} s`, tone: s.stalled ? 'fail' : 'current' }));
    return out;
  };
  const rows = (i: number) => {
    const s = steps[i];
    return panel('ABR', s ? [['throughput', `${s.tput} kbps`], ['chosen', RES[s.pick], s.stalled ? 'fail' : 'ok'], ['buffer', `${s.buffer.toFixed(1)} s`, s.buffer < 6 ? 'warn' : undefined], ['stalls', steps.slice(0, i + 1).filter((x) => x.stalled).length]] : [['ladder', LADDER.length]]);
  };
  f.add(p.intro, draw(-1), rows(-1));
  steps.forEach((s, i) => {
    const why = s.buffer < 6 && s.pick === LADDER[0] ? 'Buffer is low, so it drops to the safest rendition.' : `It picks ${RES[s.pick]}, the highest that fits 80% of the last measured ${Math.round(i ? steps[i - 1].tput : 1000)} kbps.`;
    f.add(`Segment ${i + 1}: ${why}`, draw(i), rows(i));
  });
  f.add(p.outro, draw(steps.length - 1), rows(steps.length - 1));
  return f.frames;
}

sdDemo(G, 'sd-video-abr', 'Adaptive bitrate', 'The player picks a rendition per segment from measured throughput and buffer health.', Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, [p.label, () => abrFrames(k)]])), {
  'dashed = throughput': { title: 'Measured throughput', text: 'Bytes of the last segment divided by the time it took. The player only knows the past.' },
  'solid = chosen': { title: 'Chosen rendition', text: 'The bitrate the player asks for next. The manifest lists every rendition’s URL.', code: '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\n720p/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\n1080p/index.m3u8' },
});

// ---------- pipelines ----------
boardDemo(G, 'sd-video-pipeline', 'VOD & live pipelines', 'Upload → transcode → storage → CDN, and the live variant with ingest and a growing manifest.', {
  vod: [
    'VOD',
    {
      panel: 'Pipeline',
      nodes: [
        N('up', 30, 60, 290, 110, 'upload', 'mezzanine 20 GB'),
        N('raw', 355, 60, 290, 110, 'object store', 'raw/'),
        N('tc', 680, 60, 290, 110, 'transcoder fleet', 'per-segment jobs', { detail: { title: 'Transcoding', text: 'CPU/GPU heavy and parallel per segment. Produces every rendition of the ladder and the manifests.', code: 'ffmpeg -i in.mov -c:v libx264 -b:v 2500k \\\n  -s 1280x720 -hls_time 4 \\\n  -hls_playlist_type vod 720p/index.m3u8' } }),
        N('rend', 355, 290, 290, 110, 'renditions', '240p … 4K + .m3u8'),
        N('cdn', 355, 510, 290, 110, 'CDN edge', 'caches segments', { detail: { title: 'CDN edge', text: 'Segments are plain files over HTTP, so any CDN can cache them. Hit rate is the biggest cost and latency lever.', code: 'Cache-Control: public, max-age=31536000, immutable\n# segment URLs never change → cache forever' } }),
        N('play', 355, 730, 290, 110, 'player', 'ABR'),
      ],
      edges: ['up>raw', 'raw>tc', 'tc>rend', 'rend>cdn', 'cdn>play'],
      beats: [
        { note: 'A creator uploads one high-quality source file to object storage.', hot: { up: 'current', raw: 'write', 'up>raw': 'accent' }, rows: [['latency budget', 'minutes to hours']] },
        { note: 'The transcoder splits it into segments and encodes each one at every rendition, in parallel.', hot: { tc: 'current', 'raw>tc': 'accent' }, rows: [['jobs', 'segments × renditions']] },
        { note: 'Renditions and manifests land back in object storage. Storage grows with renditions × titles.', hot: { rend: 'write', 'tc>rend': 'accent' }, rows: [['cost lever', 'per-title ladders, AV1']] },
        { note: 'The CDN pulls segments on first request and serves every later viewer from the edge.', hot: { cdn: 'ok', 'rend>cdn': 'accent' }, rows: [['target hit rate', '> 95%', 'ok']] },
        { note: 'The player reads the manifest and fetches segments with ABR. No streaming server is involved, only HTTP.', hot: { play: 'ok', 'cdn>play': 'accent' }, rows: [['protocol', 'HLS / DASH over HTTP']] },
      ],
    },
  ],
  live: [
    'Live',
    {
      panel: 'Pipeline',
      nodes: [
        N('enc', 30, 60, 290, 110, 'encoder (OBS)', 'camera'),
        N('ing', 355, 60, 290, 110, 'ingest', 'RTMP', { detail: { title: 'Ingest', text: 'RTMP is still the common way to push a live feed from the encoder to the server.', code: 'rtmp://ingest.example/live/<stream-key>' } }),
        N('ltc', 680, 60, 290, 110, 'live transcoder', 'real time'),
        N('pkg', 355, 290, 290, 110, 'packager', 'manifest grows', { detail: { title: 'Live manifest', text: 'New segments are appended as they are encoded. Players re-fetch the manifest to see them.', code: '#EXT-X-MEDIA-SEQUENCE:1841\n#EXTINF:2.0,\nseg_1841.ts\n#EXTINF:2.0,\nseg_1842.ts' } }),
        N('cdn', 355, 510, 290, 110, 'CDN edge', 'short TTL manifest'),
        N('play', 355, 730, 290, 110, 'viewers', 'glass-to-glass 6-20 s'),
      ],
      edges: ['enc>ing', 'ing>ltc', 'ltc>pkg', 'pkg>cdn', 'cdn>play'],
      beats: [
        { note: 'Live has seconds, not hours: the encoder pushes a continuous feed over RTMP.', hot: { enc: 'current', ing: 'current', 'enc>ing': 'accent' }, rows: [['latency budget', 'seconds']] },
        { note: 'The live transcoder produces every rendition segment by segment as the feed arrives.', hot: { ltc: 'current', 'ing>ltc': 'accent' } },
        { note: 'The packager appends each new segment to a manifest that keeps growing.', hot: { pkg: 'write', 'ltc>pkg': 'accent' } },
        { note: 'Shorter segments cut latency but cost compression and more requests. Low-latency HLS streams parts of a segment early.', hot: { cdn: 'current' }, rows: [['segment', '2 s → ~6 s latency']] },
        { note: 'When a big stream starts, every viewer requests the first segments at once. Pre-warm the CDN and coalesce origin fetches.', hot: { play: 'warn', cdn: 'warn' }, rows: [['risk', 'thundering herd', 'warn']] },
      ],
    },
  ],
});

// ---------- HLS requests ----------
const player: Actor = { id: 'p', label: 'Player' };
const edge: Actor = { id: 'e', label: 'CDN edge', detail: { title: 'Edge cache', text: 'Answers from its cache when it can, otherwise fetches from the shield or origin once and keeps the copy.' } };
const shield: Actor = { id: 'sh', label: 'Origin shield', detail: { title: 'Origin shield', text: 'One extra cache tier in front of the origin, so a miss on 300 edges becomes one origin request.' } };
const origin: Actor = { id: 'o', label: 'Origin', sub: 'object store' };
const playback: SeqMsg[] = [
  { from: 'p', to: 'e', label: 'GET master.m3u8', note: 'The player first fetches the master manifest, which lists the renditions.' },
  { from: 'e', to: 'sh', label: 'miss → GET', note: 'The edge doesn’t have it yet, so it asks the shield.' },
  { from: 'sh', to: 'o', label: 'GET master.m3u8', note: 'The shield misses too and goes to the origin once.' },
  { from: 'o', to: 'sh', label: '200 manifest', kind: 'resp', note: 'The origin answers; the shield keeps a copy.' },
  { from: 'sh', to: 'e', label: '200', kind: 'resp', note: 'The edge caches it for everyone nearby.' },
  { from: 'e', to: 'p', label: '200 master', kind: 'resp', note: 'The player now knows the 240p to 4K options.' },
  { from: 'p', to: 'e', label: 'GET 720p/index.m3u8', note: 'It starts with a middle rendition’s media playlist.' },
  { from: 'e', to: 'p', label: '200 (hit)', kind: 'resp', note: 'A hit: another viewer already pulled it through this edge.' },
  { from: 'p', to: 'e', label: 'GET seg_001.ts', note: 'Then the first 4 s segment.' },
  { from: 'e', to: 'p', label: '200 (hit) 1.2 MB', kind: 'resp', note: 'Served from the edge in a few ms. Most segment requests look like this.' },
  { from: 'p', to: 'e', label: 'GET 480p/seg_002.ts', note: 'Throughput dropped, so ABR switches to 480p for the next segment.' },
  { from: 'e', to: 'p', label: '200 (hit)', kind: 'resp', note: 'Switching is just asking for a different URL. That is why HLS and DASH scale on plain CDNs.' },
];
const herd: SeqMsg[] = [
  { from: 'p', to: 'e', label: '50k × GET seg_1', note: 'A popular live stream starts and fifty thousand players ask for segment 1 at once.' },
  { from: 'e', to: 'sh', label: '300 edges miss', note: 'Every edge misses at the same moment.' },
  { from: 'sh', to: 'sh', label: 'coalesce', kind: 'self', note: 'The shield collapses the 300 identical misses into one pending fetch.' },
  { from: 'sh', to: 'o', label: '1 × GET seg_1', note: 'The origin sees a single request instead of 50,000.' },
  { from: 'o', to: 'sh', label: '200', kind: 'resp', note: 'The segment comes back once.' },
  { from: 'sh', to: 'e', label: '200 to 300 edges', kind: 'resp', note: 'Every waiting edge gets the same response.' },
  { from: 'e', to: 'p', label: '200 × 50k', kind: 'resp', note: 'Viewers are served from the edges. Without the shield and coalescing, the origin falls over at kickoff.' },
];
sdDemo(G, 'sd-video-hls', 'HLS through a CDN', 'Manifest and segment requests hop by hop: edge, shield, origin, and a live-start stampede.', {
  playback: ['Playback', () => seqFrames({ actors: [player, edge, shield, origin], msgs: playback, intro: 'One viewer presses play. Every request is plain HTTP.', panel: 'HLS' })],
  herd: ['Live start herd', () => seqFrames({ actors: [player, edge, shield, origin], msgs: herd, intro: 'The moment a big live event starts.', panel: 'HLS' })],
});
