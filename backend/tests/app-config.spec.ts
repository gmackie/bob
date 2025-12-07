import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('appConfig.enableGithubAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to false when USE_GITHUB_AUTH is not set', async () => {
    delete process.env.USE_GITHUB_AUTH;
    delete process.env.ENABLE_GITHUB_AUTH;

    const { appConfig } = await import('../src/config/app.config');

    expect(appConfig.enableGithubAuth).toBe(false);
  });

  it('enables GitHub auth only when USE_GITHUB_AUTH is true', async () => {
    process.env.USE_GITHUB_AUTH = 'true';

    const { appConfig } = await import('../src/config/app.config');

    expect(appConfig.enableGithubAuth).toBe(true);
  });

  it('remains disabled when USE_GITHUB_AUTH is false', async () => {
    process.env.USE_GITHUB_AUTH = 'false';

    const { appConfig } = await import('../src/config/app.config');

    expect(appConfig.enableGithubAuth).toBe(false);
  });

  it('ignores legacy ENABLE_GITHUB_AUTH when USE_GITHUB_AUTH is unset', async () => {
    delete process.env.USE_GITHUB_AUTH;
    process.env.ENABLE_GITHUB_AUTH = 'true';

    const { appConfig } = await import('../src/config/app.config');

    expect(appConfig.enableGithubAuth).toBe(false);
  });
});
