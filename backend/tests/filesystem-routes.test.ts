import express from 'express';
import os from 'os';
import http from 'http';
import { createFilesystemRoutes } from '../src/routes/filesystem.js';

async function run() {
  const app = express();
  app.use('/api/filesystem', createFilesystemRoutes());

  const server = http.createServer(app);

  // Listen on ephemeral port
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    console.error('Failed to get server address');
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${address.port}/api/filesystem`;

  try {
    // Test /home
    const resHome = await fetch(`${baseUrl}/home`);
    if (!resHome.ok) throw new Error(`/home status ${resHome.status}`);
    const json: any = await resHome.json();
    const expectedHome = os.homedir();
    if (!json || json.path !== expectedHome) {
      console.error('Expected home path mismatch', { expectedHome, got: json });
      process.exit(1);
    }

    // Test /browse on home
    const resBrowse = await fetch(`${baseUrl}/browse?path=${encodeURIComponent(expectedHome)}`);
    if (!resBrowse.ok) throw new Error(`/browse status ${resBrowse.status}`);
    const browseJson: any = await resBrowse.json();
    if (!browseJson || browseJson.currentPath !== expectedHome) {
      console.error('Browse currentPath mismatch', { expectedHome, got: browseJson });
      process.exit(1);
    }

    console.log('backend filesystem routes tests passed');
  } catch (err) {
    console.error('backend filesystem routes tests failed:', err);
    process.exit(1);
  } finally {
    server.close();
  }
}

run();

