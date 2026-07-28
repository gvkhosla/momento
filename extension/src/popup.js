const btn = document.getElementById("sync");
const log = document.getElementById("log");
const SERVER = "http://127.0.0.1:4177";

async function refreshHealth() {
  try {
    const res = await fetch(`${SERVER}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    log.className = "ok";
    log.textContent = `Server ok · ${data.total ?? 0} likes in vault`;
    btn.disabled = false;
  } catch {
    log.className = "err";
    log.textContent =
      "Server offline. In a terminal run:\n  momento serve";
    btn.disabled = true;
  }
}

btn.addEventListener("click", () => {
  btn.disabled = true;
  log.className = "";
  log.textContent = "Starting…";

  const port = chrome.runtime.connect({ name: "sync" });
  port.onMessage.addListener((msg) => {
    if (msg.type === "progress") {
      log.className = "";
      log.textContent = msg.text;
      return;
    }
    if (msg.type === "done") {
      log.className = "ok";
      log.textContent = `Done. Seen ${msg.seen}, ${msg.inserted} new, ${msg.updated} updated.\nTry: momento search "something"`;
      btn.disabled = false;
      return;
    }
    if (msg.type === "error") {
      log.className = "err";
      log.textContent = msg.text;
      btn.disabled = false;
    }
  });
  port.onDisconnect.addListener(() => {
    btn.disabled = false;
  });
  port.postMessage({ type: "start" });
});

refreshHealth();
