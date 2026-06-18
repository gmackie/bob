import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("gmacko", {
  platform: process.platform,
  isDesktop: true,
  capture: {
    close: () => ipcRenderer.send("capture:close"),
    submit: (text: string) => ipcRenderer.send("capture:submit", text),
  },
});
