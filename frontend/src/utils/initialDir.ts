export async function getInitialDirectoryPath(storage: Storage = localStorage): Promise<string> {
  try {
    const last = storage.getItem('bob:lastDirectory');
    if (last) return last;
  } catch (_) {
    // ignore storage errors
  }

  try {
    const resp = await fetch('/api/filesystem/home');
    if (resp.ok) {
      const json: any = await resp.json();
      if (json?.path) return json.path as string;
    }
  } catch (_) {
    // ignore fetch errors
  }

  return '/';
}

