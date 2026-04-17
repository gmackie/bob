import { app, BrowserWindow } from "electron";

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1280, height: 800 });
  void win.loadURL("about:blank");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
