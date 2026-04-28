import type { Browser, Page } from "playwright";

let browser: Browser | null = null;
let page: Page | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  // Dynamic import to avoid bundling playwright in the web app
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
  return browser;
}

async function getPage(): Promise<Page> {
  const b = await getBrowser();
  if (page && !page.isClosed()) return page;
  page = await b.newPage();
  return page;
}

export async function captureUrl(
  url: string,
  options?: {
    width?: number;
    height?: number;
    outputPath: string;
  },
): Promise<{ width: number; height: number }> {
  const p = await getPage();
  const width = options?.width ?? 1280;
  const height = options?.height ?? 720;
  await p.setViewportSize({ width, height });
  await p.goto(url, { waitUntil: "networkidle", timeout: 15000 });
  await p.screenshot({ path: options?.outputPath, fullPage: false });
  return { width, height };
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}
