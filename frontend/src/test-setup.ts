import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock fetch globally with smart response based on URL
global.fetch = vi.fn((url: string) => {
  const urlStr = url.toString();
  let responseData: any = {};

  // Return appropriate data structures based on endpoint
  if (urlStr.includes('/instances')) {
    responseData = [];
  } else if (urlStr.includes('/agents')) {
    responseData = [];
  } else if (urlStr.includes('/repositories')) {
    responseData = [];
  } else if (urlStr.includes('/git/') && urlStr.includes('/files')) {
    responseData = { files: [] };
  } else if (urlStr.includes('/git/') && urlStr.includes('/status')) {
    responseData = { files: [], branch: 'main', ahead: 0, behind: 0 };
  } else if (urlStr.includes('/system-status')) {
    responseData = {
      claudeCliAvailable: true,
      claudeCliVersion: '1.0.0',
      ghCliAvailable: true,
      ghCliVersion: '2.0.0',
      ghAuthStatus: { authenticated: true, user: 'testuser' }
    };
  }

  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => responseData,
    text: async () => JSON.stringify(responseData),
    headers: new Headers(),
  } as Response);
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

global.localStorage = localStorageMock as any;

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
