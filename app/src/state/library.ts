import { create } from 'zustand';
import * as FS from '@dr.pogodin/react-native-fs';
import type { SystemDoc } from '@dsims/engine';

export const SYSTEMS_DIR = `${FS.DocumentDirectoryPath}/systems`;
export const EXT = '.dsim.json';
export const SCHEMA_VERSION = 1;

export interface LibraryItem {
  id: string;
  name: string;
  nodes: number;
  updatedAt: string;
  doc: SystemDoc;
}

interface LibraryState {
  items: LibraryItem[];
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useLibrary = create<LibraryState>(set => ({
  items: [],
  loaded: false,
  refresh: async () => {
    await ensureDir();
    const files = (await FS.readDir(SYSTEMS_DIR)).filter(f => f.name.endsWith(EXT));
    const items: LibraryItem[] = [];
    for (const f of files) {
      try {
        const doc = JSON.parse(await FS.readFile(f.path, 'utf8')) as SystemDoc;
        items.push({ id: doc.id, name: doc.name, nodes: doc.nodes.length, updatedAt: doc.updatedAt ?? '', doc });
      } catch {
        // skip unreadable files
      }
    }
    items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    set({ items, loaded: true });
  },
}));

async function ensureDir() {
  if (!(await FS.exists(SYSTEMS_DIR))) await FS.mkdir(SYSTEMS_DIR);
}

export const pathFor = (id: string) => `${SYSTEMS_DIR}/${id}${EXT}`;

export async function saveSystem(doc: SystemDoc) {
  await ensureDir();
  await FS.writeFile(pathFor(doc.id), JSON.stringify(doc, null, 1), 'utf8');
  useLibrary.getState().refresh();
}

export async function deleteSystem(id: string) {
  // recoverable: move to caches
  const dest = `${FS.CachesDirectoryPath}/trash-${id}-${Date.now()}${EXT}`;
  if (await FS.exists(pathFor(id))) await FS.moveFile(pathFor(id), dest);
  await useLibrary.getState().refresh();
}

export function newId() {
  return `sys-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function blankDoc(name = 'Untitled system'): SystemDoc {
  return {
    schemaVersion: 1,
    id: newId(),
    name,
    nodes: [],
    edges: [],
    containers: [],
    alerts: [],
    scenario: { sources: [], events: [], durationSec: 120 },
    updatedAt: new Date().toISOString(),
  };
}

/** Fork a template/preset into the user's library. */
export function forkDoc(src: SystemDoc, name?: string): SystemDoc {
  const d = JSON.parse(JSON.stringify(src)) as SystemDoc;
  d.id = newId();
  d.name = name ?? src.name;
  d.updatedAt = new Date().toISOString();
  return d;
}

export type ImportResult = { ok: true; doc: SystemDoc } | { ok: false; error: string };

export async function importFile(path: string, fileName: string): Promise<ImportResult> {
  try {
    const doc = JSON.parse(await FS.readFile(path, 'utf8')) as SystemDoc;
    if (typeof doc.schemaVersion !== 'number' || !Array.isArray(doc.nodes)) return { ok: false, error: `Couldn't open "${fileName}": not a system file.` };
    if (doc.schemaVersion > SCHEMA_VERSION) return { ok: false, error: `Couldn't open "${fileName}": schema v${doc.schemaVersion} is newer than this app.` };
    const copy = forkDoc(doc, doc.name);
    await saveSystem(copy);
    return { ok: true, doc: copy };
  } catch {
    return { ok: false, error: `Couldn't open "${fileName}": the file is damaged.` };
  }
}
