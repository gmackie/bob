import { getInitialDirectoryPath } from '../src/utils/initialDir';

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  clear(): void { this.store.clear(); }
  getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
  key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
  get length(): number { return this.store.size; }
  removeItem(key: string): void { this.store.delete(key); }
  setItem(key: string, value: string): void { this.store.set(key, value); }
}

async function run() {
  // Case 1: last directory present
  const storage1 = new MemoryStorage();
  storage1.setItem('bob:lastDirectory', '/path/last');
  const r1 = await getInitialDirectoryPath(storage1 as unknown as Storage);
  if (r1 !== '/path/last') {
    console.error('Case 1 failed', r1);
    process.exit(1);
  }

  // Case 2: no last, fetch returns home
  const storage2 = new MemoryStorage();
  // @ts-ignore override global fetch
  global.fetch = async () => new Response(JSON.stringify({ path: '/home/user' }), { status: 200 });
  const r2 = await getInitialDirectoryPath(storage2 as unknown as Storage);
  if (r2 !== '/home/user') {
    console.error('Case 2 failed', r2);
    process.exit(1);
  }

  // Case 3: fetch fails, fallback to '/'
  const storage3 = new MemoryStorage();
  // @ts-ignore mock failing fetch
  global.fetch = async () => new Response('err', { status: 500 });
  const r3 = await getInitialDirectoryPath(storage3 as unknown as Storage);
  if (r3 !== '/') {
    console.error('Case 3 failed', r3);
    process.exit(1);
  }

  console.log('frontend initialDir tests passed');
}

run();

