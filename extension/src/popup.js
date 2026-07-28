const SERVER = "http://127.0.0.1:4177";
const syncButton = document.querySelector("#sync");
const openButton = document.querySelector("#open-app");
const log = document.querySelector("#log");
const status = document.querySelector("#status");

syncButton.addEventListener("click", startSync);
openButton.addEventListener("click", () => chrome.tabs.create({ url: SERVER }));
refreshHealth();

async function refreshHealth() {
  try {
    const response = await fetch(`${SERVER}/api/health`);
    if (!response.ok) throw new Error();
    const data = await response.json();
    status.className = "online";
    status.lastElementChild.textContent = "Archive ready";
    document.querySelector("#bookmark-count").textContent = `${format(data.counts?.bookmark)} saved`;
    document.querySelector("#heart-count").textContent = `${format(data.counts?.heart)} saved`;
    syncButton.disabled = false;
    openButton.disabled = false;
    log.className = "";
    log.textContent = `${format(data.total)} unique memories in your archive.`;
  } catch {
    status.className = "offline";
    status.lastElementChild.textContent = "Archive offline";
    syncButton.disabled = true;
    openButton.disabled = true;
    log.className = "err";
    log.textContent = "In a terminal, run:\n  momento serve";
  }
}

function startSync() {
  const sources = [];
  if (document.querySelector("#bookmarks").checked) sources.push("bookmark");
  if (document.querySelector("#hearts").checked) sources.push("heart");
  if (sources.length === 0) {
    log.className = "err";
    log.textContent = "Choose Bookmarks, Hearts, or both.";
    return;
  }

  syncButton.disabled = true;
  log.className = "";
  log.textContent = "Starting sync…";
  const port = chrome.runtime.connect({ name: "sync" });

  port.onMessage.addListener((message) => {
    if (message.type === "progress") {
      log.className = "";
      log.textContent = message.text;
    }
    if (message.type === "done") {
      log.className = "ok";
      log.textContent = `Done. ${format(message.inserted)} new · ${format(message.updated)} refreshed.`;
      syncButton.disabled = false;
      refreshHealth();
    }
    if (message.type === "error") {
      log.className = "err";
      log.textContent = message.text;
      syncButton.disabled = false;
    }
  });
  port.onDisconnect.addListener(() => {
    syncButton.disabled = false;
  });
  port.postMessage({ type: "start", sources });
}

function format(value = 0) {
  return new Intl.NumberFormat("en", { notation: value > 9999 ? "compact" : "standard" }).format(value);
}
