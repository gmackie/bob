import { clearAppConfigCache, getAppConfig } from '../src/config/app.config.ts';

async function run() {
  // Reset cached config between runs
  clearAppConfigCache();

  // Simulate fetch failing so the client falls back to defaults
  // @ts-ignore override global fetch
  global.fetch = async () => {
    throw new Error('network down');
  };

  const config = await getAppConfig();

  if (config.enableGithubAuth !== false) {
    console.error('Expected enableGithubAuth to default to false when config load fails');
    process.exit(1);
  }

  console.log('frontend app-config tests passed');
}

run();
