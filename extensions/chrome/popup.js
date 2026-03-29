/* global chrome */

let bobUrl = "";
let bobApiKey = "";
let currentDomain = "";

async function loadConfig() {
  const config = await chrome.storage.sync.get(["bobUrl", "bobApiKey"]);
  bobUrl = config.bobUrl || "";
  bobApiKey = config.bobApiKey || "";
}

async function checkConnection() {
  const statusEl = document.getElementById("status");
  if (!bobUrl || !bobApiKey) {
    statusEl.className = "status err";
    document.getElementById("not-configured").style.display = "block";
    document.getElementById("main").style.display = "none";
    return false;
  }
  try {
    const res = await fetch(`${bobUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
    statusEl.className = res.ok ? "status ok" : "status err";
    document.getElementById("not-configured").style.display = "none";
    document.getElementById("main").style.display = "block";
    return res.ok;
  } catch {
    statusEl.className = "status err";
    document.getElementById("main").style.display = "block";
    return false;
  }
}

async function getCurrentDomain() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    try {
      const url = new URL(tab.url);
      return url.hostname;
    } catch { return ""; }
  }
  return "";
}

async function getCookiesForDomain(domain) {
  return chrome.cookies.getAll({ domain });
}

function formatCookie(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    expires: c.expirationDate ? Math.floor(c.expirationDate) : null,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite === "strict" ? "Strict" : c.sameSite === "lax" ? "Lax" : "None",
  };
}

async function sendCookies(domains) {
  const allCookies = [];
  for (const domain of domains) {
    const raw = await getCookiesForDomain(domain);
    allCookies.push(...raw.map(formatCookie));
  }

  const res = await fetch(`${bobUrl}/api/cookies/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bobApiKey}`,
    },
    body: JSON.stringify({ cookies: allCookies, source: "extension" }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

function showResult(msg, isError) {
  const el = document.getElementById("result");
  el.textContent = msg;
  el.className = `result ${isError ? "error" : "success"}`;
}

async function loadAllDomains() {
  const all = await chrome.cookies.getAll({});
  const domainCounts = {};
  for (const c of all) {
    const d = c.domain.replace(/^\./, "");
    domainCounts[d] = (domainCounts[d] || 0) + 1;
  }
  return Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => ({ domain, count }));
}

function renderDomainList(domains, filter) {
  const list = document.getElementById("domain-list");
  const filtered = filter
    ? domains.filter((d) => d.domain.includes(filter))
    : domains;

  list.innerHTML = "";
  for (const d of filtered) {
    const label = document.createElement("label");
    label.className = "domain-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = d.domain;
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(` ${d.domain} `));
    const span = document.createElement("span");
    span.style.color = "#737373";
    span.textContent = `(${d.count})`;
    label.appendChild(span);
    list.appendChild(label);
  }
}

// Init
(async () => {
  await loadConfig();
  await checkConnection();

  currentDomain = await getCurrentDomain();
  document.getElementById("domain-label").textContent = currentDomain || "this site";

  // Send current domain
  document.getElementById("send-btn").addEventListener("click", async () => {
    if (!currentDomain) return;
    const btn = document.getElementById("send-btn");
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      const result = await sendCookies([currentDomain]);
      showResult(`Sent ${result.imported} cookies for ${currentDomain}`, false);
    } catch (e) {
      showResult(e.message, true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `Send cookies for <strong>${currentDomain}</strong> to Bob`;
    }
  });

  // Advanced toggle
  let allDomains = [];
  document.getElementById("advanced-toggle").addEventListener("click", async () => {
    const picker = document.getElementById("domain-picker");
    const isOpen = picker.classList.toggle("open");
    if (isOpen && allDomains.length === 0) {
      allDomains = await loadAllDomains();
      renderDomainList(allDomains, "");
    }
  });

  // Search filter
  document.getElementById("domain-search").addEventListener("input", (e) => {
    renderDomainList(allDomains, e.target.value);
  });

  // Send selected
  document.getElementById("send-selected-btn").addEventListener("click", async () => {
    const checked = [...document.querySelectorAll("#domain-list input:checked")].map(
      (el) => el.value,
    );
    if (checked.length === 0) return;
    const btn = document.getElementById("send-selected-btn");
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      const result = await sendCookies(checked);
      showResult(`Sent ${result.imported} cookies for ${checked.length} domain(s)`, false);
    } catch (e) {
      showResult(e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = "Send selected domains";
    }
  });

  // Open options
  document.getElementById("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
})();
