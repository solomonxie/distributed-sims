// Load content/ sources and validate them. Run directly: node scripts/validate-content.mjs [--lenient]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import YAML from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT = path.join(ROOT, 'content');

export const KNOB_KINDS = ['number', 'int', 'bool', 'enum', 'ms', 'percent', 'string'];
export const CONTAINER_KINDS = ['region', 'availability-zone', 'vpc', 'bounded-context', 'layer', 'tenant', 'cell', 'k8s-namespace'];
export const CHAOS_GROUPS = ['Node', 'Network', 'Data', 'Time', 'Traffic', 'Infra', 'Security', 'Protocol'];
export const CHAOS_TARGETS = ['node', 'edge', 'pair', 'container', 'source', 'none'];
export const TRAFFIC_ACTIONS = ['burst', 'ramp', 'set', 'flash-crowd', 'hot-key', 'bots', 'herd'];
export const SHAPE_KINDS = ['constant', 'ramp', 'diurnal', 'spike-train'];

// lucide icon names (PascalCase exports of app/node_modules/lucide); null = package not installed, skip check
const LUCIDE = (() => {
  try {
    return createRequire(path.join(ROOT, 'app', 'package.json'))('lucide');
  } catch {
    return null;
  }
})();
export const lucideName = (kebab) => String(kebab).split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');

const TOPIC_GROUPS = ['topics', 'under-the-hood', 'network', 'machine', 'languages', 'ai', 'patterns'];
const LANGUAGES = ['cpp', 'go', 'python', 'java', 'rust', 'csharp', 'fp'];
const PROBLEM_CATEGORIES = ['classic', 'product', 'infra'];

const list = (dir, ext) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(ext) && !f.startsWith('.')).sort() : [];

/** Parse every source file. Parse failures go to `problems` (errors, or warnings when lenient). */
export function loadContent(root = CONTENT, { lenient = false } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (msg) => (lenient ? warnings : errors).push(msg);
  const readYaml = (file) => {
    try {
      return YAML.parse(fs.readFileSync(file, 'utf8'), { merge: true });
    } catch (e) {
      fail(`${path.relative(root, file)}: parse error: ${e.message.split('\n')[0]}`);
      return undefined;
    }
  };
  const readOpt = (name) => (fs.existsSync(path.join(root, name)) ? readYaml(path.join(root, name)) : undefined);
  const many = (dir, key) =>
    list(path.join(root, dir), '.yaml').flatMap(f => {
      const d = readYaml(path.join(root, dir, f));
      if (d == null) return [];
      const items = Array.isArray(d) ? d : Array.isArray(d[key]) ? d[key] : [d];
      return items.map(x => ({ ...x, __file: `${dir}/${f}` }));
    });

  const catalogFiles = list(path.join(root, 'catalog'), '.yaml')
    .map(f => ({ file: `catalog/${f}`, data: readYaml(path.join(root, 'catalog', f)) }))
    .filter(x => x.data);

  const templates = {};
  for (const f of list(path.join(root, 'templates'), '.json')) {
    try {
      templates[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(root, 'templates', f), 'utf8'));
    } catch (e) {
      fail(`templates/${f}: parse error: ${e.message}`);
    }
  }

  const icons = {};
  for (const f of list(path.join(root, 'icons'), '.svg')) icons[f.replace(/\.svg$/, '')] = fs.readFileSync(path.join(root, 'icons', f), 'utf8').trim();

  return {
    catalogFiles,
    containers: readOpt('containers.yaml')?.containers ?? [],
    chaos: readOpt('chaos.yaml')?.events ?? [],
    traffic: readOpt('traffic.yaml') ?? { shapes: [], presets: [] },
    icons,
    templates,
    topics: many('topics', 'topics'),
    problems: many('problems', 'problems'),
    tech: many('tech', 'tech'),
    errors,
    warnings,
  };
}

/** Merge catalog group files into the engine Catalog shape. */
export function buildCatalog(c) {
  const groups = [];
  const types = [];
  const skins = [];
  for (const { file, data } of c.catalogFiles) {
    const g = data.group ?? {};
    // several files may share a group id (e.g. data.yaml + stores.yaml): merge, keep lowest order
    const same = g.id && groups.find(x => x.id === g.id);
    if (same) {
      same.order = Math.min(same.order, g.order ?? 99);
      same.label ??= g.label;
    } else groups.push({ id: g.id, label: g.label, order: g.order ?? 99, __file: file });
    for (const t of data.types ?? []) types.push({ ...t, group: g.id, knobs: t.knobs ?? [], __file: file });
    for (const s of data.skins ?? []) skins.push({ ...s, defaults: s.defaults ?? {}, __file: file });
  }
  groups.sort((a, b) => a.order - b.order || String(a.id).localeCompare(String(b.id)));
  const rank = new Map(groups.map((g, i) => [g.id, i]));
  types.sort((a, b) => (rank.get(a.group) ?? 99) - (rank.get(b.group) ?? 99));
  return { groups, types, skins, containers: c.containers };
}

/** Returns { errors, warnings }. */
export function validate(c) {
  const errors = [...c.errors];
  const warnings = [...c.warnings];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const cat = buildCatalog(c);

  const dupes = (items, key, what) => {
    const seen = new Map();
    for (const it of items) {
      const k = it[key];
      if (!k) err(it.__file ?? what, `${what} missing '${key}'`);
      else if (seen.has(k)) err(it.__file ?? what, `duplicate ${what} '${k}' (also in ${seen.get(k)})`);
      else seen.set(k, it.__file ?? what);
    }
  };

  const checkKnobs = (where, knobs) => {
    const keys = new Set();
    for (const k of knobs ?? []) {
      if (!k.key) err(where, 'knob missing key');
      else if (keys.has(k.key)) err(where, `duplicate knob '${k.key}'`);
      keys.add(k.key);
      if (!KNOB_KINDS.includes(k.kind)) err(where, `knob '${k.key}' has invalid kind '${k.kind}' (valid: ${KNOB_KINDS.join(', ')})`);
      if (k.kind === 'enum') {
        if (!Array.isArray(k.options) || !k.options.length) err(where, `enum knob '${k.key}' needs options`);
        else if (k.default !== undefined && !k.options.includes(k.default)) err(where, `knob '${k.key}' default '${k.default}' not in options`);
      }
      if (typeof k.min === 'number' && typeof k.max === 'number' && k.min > k.max) err(where, `knob '${k.key}' min > max`);
    }
  };

  const lucide = c.lucide === undefined ? LUCIDE : c.lucide;
  const iconOk = (where, icon) => {
    if (!icon) err(where, 'missing icon');
    else if (String(icon).startsWith('brand:')) {
      if (!c.icons[icon.slice(6)]) err(where, `icon '${icon}' not in content/icons/`);
    } else if (lucide && !lucide[lucideName(icon)]) err(where, `icon '${icon}' is not a lucide icon (${lucideName(icon)})`);
  };

  // catalog
  dupes(cat.groups, 'id', 'group');
  dupes(cat.types, 'type', 'type');
  dupes(cat.skins, 'name', 'skin');
  const typeByName = new Map(cat.types.map(t => [t.type, t]));
  const skinByName = new Map(cat.skins.map(s => [s.name, s]));
  for (const t of cat.types) {
    const w = `${t.__file} type '${t.type}'`;
    if (!t.label) err(w, 'missing label');
    iconOk(w, t.icon);
    checkKnobs(w, t.knobs);
  }
  for (const s of cat.skins) {
    const w = `${s.__file} skin '${s.name}'`;
    if (!typeByName.has(s.type)) err(w, `type '${s.type}' does not exist`);
    iconOk(w, s.icon);
  }

  // containers
  dupes(c.containers.map(x => ({ ...x, __file: 'containers.yaml' })), 'kind', 'container');
  for (const x of c.containers) {
    if (!CONTAINER_KINDS.includes(x.kind)) err('containers.yaml', `unknown container kind '${x.kind}'`);
    iconOk(`containers.yaml ${x.kind}`, x.icon);
    checkKnobs(`containers.yaml ${x.kind}`, x.knobs);
  }

  // chaos
  const unknownApplies = new Set();
  dupes(c.chaos.map(x => ({ ...x, __file: 'chaos.yaml' })), 'kind', 'chaos kind');
  for (const e of c.chaos) {
    const w = `chaos.yaml ${e.kind}`;
    if (!CHAOS_GROUPS.includes(e.group)) err(w, `invalid group '${e.group}'`);
    for (const f of ['label', 'description', 'emoji']) if (!e[f]) err(w, `missing ${f}`);
    if (!('defaultDurationSec' in e)) err(w, 'missing defaultDurationSec');
    for (const k of e.params ?? []) if (k.default === undefined) err(w, `param '${k.key}' needs a default`);
    iconOk(w, e.icon);
    if (!CHAOS_TARGETS.includes(e.target)) err(w, `invalid target '${e.target}'`);
    if (e.appliesTo !== 'any' && !Array.isArray(e.appliesTo)) err(w, `appliesTo must be 'any' or a list`);
    checkKnobs(w, e.params);
    if (e.traffic && !TRAFFIC_ACTIONS.includes(e.traffic.action)) err(w, `invalid traffic action '${e.traffic.action}'`);
    if (Array.isArray(e.appliesTo)) for (const t of e.appliesTo) if (!typeByName.has(t) && !CONTAINER_KINDS.includes(t)) unknownApplies.add(t);
  }
  if (unknownApplies.size) warnings.push(`chaos.yaml appliesTo types not in catalog (yet): ${[...unknownApplies].join(', ')}`);

  // traffic
  for (const s of c.traffic.shapes ?? []) {
    if (!SHAPE_KINDS.includes(s.kind)) err('traffic.yaml', `invalid shape '${s.kind}'`);
    iconOk(`traffic.yaml shape ${s.kind}`, s.icon);
    checkKnobs(`traffic.yaml shape ${s.kind}`, s.params);
  }
  dupes((c.traffic.presets ?? []).map(x => ({ ...x, __file: 'traffic.yaml' })), 'id', 'traffic preset');
  for (const p of c.traffic.presets ?? []) {
    if (!TRAFFIC_ACTIONS.includes(p.event?.action)) err(`traffic.yaml preset ${p.id}`, `invalid action '${p.event?.action}'`);
    iconOk(`traffic.yaml preset ${p.id}`, p.icon);
  }

  // templates
  const chaosKinds = new Set([...c.chaos.map(e => e.kind), 'heal-all']);
  for (const [slug, doc] of Object.entries(c.templates)) checkDoc(`templates/${slug}.json`, doc);

  function checkDoc(w, doc) {
    if (doc.schemaVersion !== 1) err(w, 'schemaVersion must be 1');
    const nodes = doc.nodes ?? [];
    const edges = doc.edges ?? [];
    const containers = doc.containers ?? [];
    const ids = new Set();
    for (const x of [...nodes, ...edges, ...containers]) {
      if (!x.id) err(w, 'item missing id');
      else if (ids.has(x.id)) err(w, `duplicate id '${x.id}'`);
      ids.add(x.id);
    }
    const nodeIds = new Set(nodes.map(n => n.id));
    const contIds = new Set(containers.map(x => x.id));
    const edgeIds = new Set(edges.map(e => e.id));
    for (const x of containers) {
      if (!CONTAINER_KINDS.includes(x.kind)) err(w, `container '${x.id}' has unknown kind '${x.kind}'`);
      if (x.parent && !contIds.has(x.parent)) err(w, `container '${x.id}' parent '${x.parent}' missing`);
    }
    for (const n of nodes) {
      if (!typeByName.has(n.type)) err(w, `node '${n.id}' type '${n.type}' not in catalog`);
      if (n.skin) {
        const s = skinByName.get(n.skin);
        if (!s) err(w, `node '${n.id}' skin '${n.skin}' not in catalog`);
        else if (s.type !== n.type) err(w, `node '${n.id}' skin '${n.skin}' is a ${s.type}, not ${n.type}`);
      }
      if (n.parent && !contIds.has(n.parent)) err(w, `node '${n.id}' parent '${n.parent}' missing`);
      if (!n.pos || typeof n.pos.x !== 'number' || typeof n.pos.y !== 'number') err(w, `node '${n.id}' needs pos {x,y}`);
    }
    for (const e of edges) {
      if (!nodeIds.has(e.from)) err(w, `edge '${e.id}' from '${e.from}' is not a node`);
      if (!nodeIds.has(e.to)) err(w, `edge '${e.id}' to '${e.to}' is not a node`);
    }
    const sc = doc.scenario;
    if (sc) {
      const srcIds = new Set();
      for (const s of sc.sources ?? []) {
        srcIds.add(s.id);
        if (!nodeIds.has(s.node)) err(w, `source '${s.id}' node '${s.node}' missing`);
        if (!SHAPE_KINDS.includes(s.shape?.kind)) err(w, `source '${s.id}' invalid shape '${s.shape?.kind}'`);
      }
      for (const { atSec, event: ev } of sc.events ?? []) {
        const at = `event @${atSec}s`;
        if (!ev) { err(w, `${at} missing event`); continue; }
        if (ev.kind === 'traffic') {
          if (!TRAFFIC_ACTIONS.includes(ev.action)) err(w, `${at} invalid traffic action '${ev.action}'`);
          if (ev.source && !srcIds.has(ev.source)) err(w, `${at} source '${ev.source}' missing`);
          continue;
        }
        if (c.chaos.length && !chaosKinds.has(ev.kind)) err(w, `${at} unknown chaos kind '${ev.kind}'`);
        for (const t of [ev.target, ev.target2])
          if (t && !nodeIds.has(t) && !contIds.has(t) && !edgeIds.has(t)) err(w, `${at} target '${t}' missing`);
      }
    }
  }

  // Illustration rule (technologies.md): every lesson/tech/problem ships a template, scenario or algo demo.
  const tplOk = (w, slug) => {
    if (slug && !c.templates[slug]) err(w, `template '${slug}' not found in content/templates/`);
  };
  const checkLesson = (w, l) => {
    const lw = `${w} lesson '${l.id}'`;
    if (!l.id || !l.title) err(lw, 'lesson needs id and title');
    if (!l.template && !l.scenario && !l.algo)
      err(lw, 'Illustration rule: lesson must reference a template, scenario or algo demo slug (technologies.md)');
    tplOk(lw, l.template);
    if (!Array.isArray(l.steps) || !l.steps.length) err(lw, 'lesson needs steps');
  };

  dupes(c.topics, 'id', 'topic');
  for (const t of c.topics) {
    const w = `${t.__file} topic '${t.id}'`;
    if (!TOPIC_GROUPS.includes(t.group)) err(w, `group must be one of ${TOPIC_GROUPS.join('|')}`);
    if ((t.group === 'languages') !== LANGUAGES.includes(t.language)) err(w, `languages topics need language: ${LANGUAGES.join('|')} (and only they)`);
    if (!Array.isArray(t.lessons) || !t.lessons.length) err(w, 'topic needs lessons');
    dupes((t.lessons ?? []).map(l => ({ ...l, __file: w })), 'id', 'lesson');
    for (const l of t.lessons ?? []) checkLesson(w, l);
  }
  dupes(c.tech, 'id', 'tech');
  for (const t of c.tech) {
    const w = `${t.__file} tech '${t.id}'`;
    if (!t.template) err(w, 'Illustration rule: tech must reference a template');
    tplOk(w, t.template);
    for (const l of t.lessons ?? []) checkLesson(w, l);
  }
  dupes(c.problems, 'id', 'problem');
  for (const p of c.problems) {
    const w = `${p.__file} problem '${p.id}'`;
    if (!PROBLEM_CATEGORIES.includes(p.category)) err(w, `category must be one of ${PROBLEM_CATEGORIES.join('|')}`);
    if (!Array.isArray(p.designs) || !p.designs.length) err(w, 'Illustration rule: problem needs at least one design template');
    for (const d of p.designs ?? []) tplOk(`${w} design '${d.id}'`, d.template);
    for (const ch of p.challenges ?? []) {
      if (!ch.template && !ch.scenario) err(`${w} challenge '${ch.id}'`, 'Illustration rule: challenge needs a template or scenario');
      tplOk(`${w} challenge '${ch.id}'`, ch.template);
    }
  }

  return { errors, warnings };
}

/** Jest-free self test: a known-bad fixture must trip each rule. */
export function smoke() {
  const bad = {
    errors: [],
    warnings: [],
    icons: {},
    lucide: { Box: {} },
    catalogFiles: [
      { file: 'catalog/a.yaml', data: { group: { id: 'a', label: 'A', order: 1 }, types: [{ type: 't', label: 'T', icon: 'box', knobs: [{ key: 'k', label: 'K', kind: 'weird', default: 1 }] }], skins: [{ name: 's', type: 'nope', icon: 'box' }, { name: 's', type: 't', icon: 'brand:missing' }] } },
      { file: 'catalog/b.yaml', data: { group: { id: 'a', label: 'A', order: 0 }, types: [{ type: 'u', label: 'U', icon: 'no-such-icon' }] } },
    ],
    containers: [],
    chaos: [{ kind: 'kill', group: 'Node', target: 'node', appliesTo: 'any' }, { kind: 'kill', group: 'Node', target: 'node', appliesTo: 'any' }],
    traffic: { shapes: [], presets: [] },
    templates: { x: { schemaVersion: 1, nodes: [{ id: 'n1', type: 't', skin: 'ghost', pos: { x: 0, y: 0 } }], edges: [{ id: 'e1', from: 'n1', to: 'n2' }], containers: [] } },
    topics: [{ id: 'tp', group: 'topics', lessons: [{ id: 'l1', title: 'L', steps: [{ title: 'a', body: 'b' }] }], __file: 'topics/tp.yaml' }],
    problems: [],
    tech: [],
  };
  const { errors } = validate(bad);
  if (buildCatalog(bad).groups.length !== 1 || buildCatalog(bad).groups[0].order !== 0) throw new Error('validate smoke check failed: group merge');
  const expect = ["'no-such-icon' is not a lucide icon", 'invalid kind', 'does not exist', 'duplicate skin', "brand:missing", 'duplicate chaos kind', "skin 'ghost'", "to 'n2'", 'Illustration rule'];
  const missed = expect.filter(e => !errors.some(x => x.includes(e)));
  if (missed.length) throw new Error(`validate smoke check failed; rules not triggered: ${missed.join(', ')}`);
}

export function report({ errors, warnings }) {
  for (const w of warnings) console.warn(`warn  ${w}`);
  for (const e of errors) console.error(`error ${e}`);
  return errors.length === 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  smoke();
  const c = loadContent(CONTENT, { lenient: process.argv.includes('--lenient') });
  const ok = report(validate(c));
  const cat = buildCatalog(c);
  console.log(`${ok ? 'ok' : 'FAILED'}: ${cat.groups.length} groups, ${cat.types.length} types, ${cat.skins.length} skins, ${c.chaos.length} chaos, ${Object.keys(c.templates).length} templates`);
  process.exit(ok ? 0 : 1);
}
