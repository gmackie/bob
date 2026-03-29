/* global chrome */

document.addEventListener("DOMContentLoaded", async () => {
  const config = await chrome.storage.sync.get(["bobUrl", "bobApiKey"]);
  document.getElementById("url").value = config.bobUrl || "";
  document.getElementById("key").value = config.bobApiKey || "";

  document.getElementById("save").addEventListener("click", async () => {
    await chrome.storage.sync.set({
      bobUrl: document.getElementById("url").value.replace(/\/$/, ""),
      bobApiKey: document.getElementById("key").value,
    });
    const saved = document.getElementById("saved");
    saved.style.display = "block";
    setTimeout(() => { saved.style.display = "none"; }, 2000);
  });
});
