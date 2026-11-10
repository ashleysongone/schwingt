/** 曲库：自带的曲子来自 public/scores，导入的曲子按原文件存在浏览器本地（IndexedDB） */

export interface LibraryItem {
  id: string;
  title: string;
  composer: string;
  note?: string;
  builtin: boolean;
}

export interface ScoreFile {
  /** 原文件名，用来判断格式 */
  name: string;
  data: ArrayBuffer;
}

interface StoredScore extends ScoreFile {
  id: string;
  title: string;
  composer: string;
  added: number;
}

interface BuiltinEntry {
  id: string;
  title: string;
  composer: string;
  file: string;
  note?: string;
}

const DB_NAME = 'schwingt';
const STORE = 'files';
const BASE = import.meta.env.BASE_URL;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

let builtins: BuiltinEntry[] | undefined;

async function loadBuiltins(): Promise<BuiltinEntry[]> {
  if (!builtins) {
    try {
      const res = await fetch(`${BASE}scores/index.json`, { cache: 'no-cache' });
      builtins = res.ok ? ((await res.json()) as BuiltinEntry[]) : [];
    } catch {
      builtins = [];
    }
  }
  return builtins;
}

export async function listScores(): Promise<LibraryItem[]> {
  const items: LibraryItem[] = (await loadBuiltins()).map((b) => ({
    id: `builtin:${b.id}`,
    title: b.title,
    composer: b.composer,
    note: b.note,
    builtin: true,
  }));
  try {
    const stored = await withStore<StoredScore[]>('readonly', (s) => s.getAll());
    stored.sort((a, b) => b.added - a.added);
    for (const s of stored) items.push({ id: s.id, title: s.title, composer: s.composer, builtin: false });
  } catch (err) {
    console.info('读取本地曲库失败', err);
  }
  return items;
}

export async function loadScoreFile(id: string): Promise<ScoreFile> {
  if (id.startsWith('builtin:')) {
    const entry = (await loadBuiltins()).find((b) => `builtin:${b.id}` === id);
    if (!entry) throw new Error('曲库里没有这首曲子');
    const res = await fetch(`${BASE}scores/${entry.file}`);
    if (!res.ok) throw new Error(`谱子文件读取失败（${res.status}）`);
    return { name: entry.file, data: await res.arrayBuffer() };
  }
  const stored = await withStore<StoredScore | undefined>('readonly', (s) => s.get(id));
  if (!stored) throw new Error('这首曲子已经不在本地曲库里了');
  return { name: stored.name, data: stored.data };
}

export async function saveImported(title: string, composer: string, file: ScoreFile): Promise<string> {
  const id = `local:${Date.now().toString(36)}`;
  const record: StoredScore = { id, title, composer, name: file.name, data: file.data, added: Date.now() };
  await withStore('readwrite', (s) => s.put(record));
  return id;
}

export async function removeImported(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}
