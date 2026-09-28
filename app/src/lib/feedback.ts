import * as FS from '@dr.pogodin/react-native-fs';

// Contract: ~/.claude/skills/app-feedback/SKILL.md — pulled off the phone via devicectl.
export const FEEDBACK_PATH = `${FS.DocumentDirectoryPath}/feedback.json`;

export const STATUSES = ['open', 'in_progress', 'done', 'wontfix'] as const;
export type FeedbackStatus = (typeof STATUSES)[number];

export interface FeedbackItem {
  id: string;
  text: string;
  status: FeedbackStatus;
  createdAt: string;
  updatedAt: string;
  note?: string;
  [k: string]: unknown;
}

interface FeedbackFile {
  version: number;
  items: FeedbackItem[];
  [k: string]: unknown;
}

async function readFile(): Promise<FeedbackFile> {
  if (!(await FS.exists(FEEDBACK_PATH))) return { version: 1, items: [] };
  const raw = await FS.readFile(FEEDBACK_PATH, 'utf8');
  if (!raw.trim()) return { version: 1, items: [] };
  let f;
  try {
    f = JSON.parse(raw);
  } catch {
    throw new Error('feedback.json is corrupt; not overwriting it.');
  }
  return { ...f, version: f.version ?? 1, items: Array.isArray(f.items) ? f.items : [] };
}

// NSFileManager createFileAtPath writes atomically.
const writeFile = (f: FeedbackFile) => FS.writeFile(FEEDBACK_PATH, JSON.stringify(f, null, 1), 'utf8');

const newest = (items: FeedbackItem[]) => [...items].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

async function modify(fn: (items: FeedbackItem[]) => FeedbackItem[]): Promise<FeedbackItem[]> {
  const f = await readFile();
  const items = fn(f.items);
  await writeFile({ ...f, items });
  return newest(items);
}

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export const loadFeedback = async () => newest((await readFile()).items);

export const addFeedback = (text: string) => {
  const now = new Date().toISOString();
  return modify(items => [{ id: uuid(), text, status: 'open', createdAt: now, updatedAt: now, note: '' }, ...items]);
};

export const setFeedbackStatus = (id: string, status: FeedbackStatus) =>
  modify(items => items.map(i => (i.id === id ? { ...i, status, updatedAt: new Date().toISOString() } : i)));

export const deleteFeedback = (id: string) => modify(items => items.filter(i => i.id !== id));
