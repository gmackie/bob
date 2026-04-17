import { app, BrowserWindow, globalShortcut, Tray, Menu, nativeImage } from "electron";
import path from "path";

const isDev = process.env.NODE_ENV !== "production";
const WEB_URL = isDev ? "http://localhost:3000" : `file://${path.join(__dirname, "../web/index.html")}`;

let mainWindow: BrowserWindow | null = null;
let captureWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#111113",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(WEB_URL);
  mainWindow.on("closed", () => { mainWindow = null; });
}

function createCaptureWindow() {
  if (captureWindow) {
    captureWindow.focus();
    return;
  }

  captureWindow = new BrowserWindow({
    width: 600,
    height: 400,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  captureWindow.loadURL(`${WEB_URL}/capture`);
  captureWindow.on("closed", () => { captureWindow = null; });
  captureWindow.on("blur", () => {
    captureWindow?.close();
  });
}

function createTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Gmacko");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Gmacko", click: () => createMainWindow() },
    { label: "Quick Capture", accelerator: "CmdOrCtrl+Shift+Space", click: () => createCaptureWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]));
}

app.whenReady().then(() => {
  createMainWindow();
  createTray();

  // System-wide hotkey for quick capture
  globalShortcut.register("CmdOrCtrl+Shift+Space", () => {
    createCaptureWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep running in tray on macOS
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!mainWindow) createMainWindow();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
