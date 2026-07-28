const state = {
  q: "",
  source: "all",
  items: [],
  counts: { all: 0, bookmark: 0, heart: 0, shared: 0 },
  deferredPrompt: null,
};

const elements = {
  search: document.querySelector("#search"),
  form: document.querySelector("#search-form"),
  results: document.querySelector("#results"),
  resultCount: document.querySelector("#result-count"),
  resultsTitle: document.querySelector("#results-title"),
  empty: document.querySelector("#empty-state"),
  onboarding: document.querySelector("#onboarding-state"),
  status: document.querySelector("#sync-status"),
  dialog: document.querySelector("#capture-dialog"),
  captureForm: document.querySelector("#capture-form"),
  captureUrl: document.querySelector("#capture-url"),
  captureError: document.querySelector("#capture-error"),
  saveCapture: document.querySelector("#save-capture"),
  toast: document.querySelector("#toast"),
  install: document.querySelector("#install-app"),
};

const countTargets = {
  all: ["#count-all", "#archive-total"],
  bookmark: ["#count-bookmark", "#aside-bookmarks"],
  heart: ["#count-heart", "#aside-hearts"],
  shared: ["#count-shared", "#aside-shared"],
};

init();

async function init() {
  bindEvents();
  await loadArchive();

  const params = new URLSearchParams(location.search);
  if (params.get("captured") === "1") {
    showToast("Saved to Momento.");
    history.replaceState({}, "", "/");
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

function bindEvents() {
  let timer;
  elements.search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.q = elements.search.value.trim();
      loadItems();
    }, 160);
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    state.q = elements.search.value.trim();
    loadItems();
  });

  document.querySelectorAll(".source-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.source = button.dataset.source;
      document.querySelectorAll(".source-tab").forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle("is-active", active);
        tab.setAttribute("aria-pressed", String(active));
      });
      loadItems();
    });
  });

  document.querySelector("#open-capture").addEventListener("click", openCapture);
  document.querySelector("#onboarding-add").addEventListener("click", openCapture);
  document.querySelector("#close-capture").addEventListener("click", closeCapture);
  document.querySelector("#clear-search").addEventListener("click", () => {
    elements.search.value = "";
    state.q = "";
    loadItems();
    elements.search.focus();
  });
  document.querySelector("#paste-url").addEventListener("click", pasteUrl);
  elements.captureForm.addEventListener("submit", saveCapture);

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      elements.search.focus();
    }
    if (event.key === "/" && document.activeElement?.tagName !== "INPUT") {
      event.preventDefault();
      elements.search.focus();
    }
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredPrompt = event;
    elements.install.hidden = false;
  });
  elements.install.addEventListener("click", installApp);
}

async function loadArchive() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("offline");
    const data = await response.json();
    state.counts = data.counts || state.counts;
    setOnline(true, "Archive ready");
    updateCounts();
    await loadItems();
  } catch {
    setOnline(false, "Archive offline");
    elements.results.innerHTML = "";
    elements.onboarding.hidden = false;
  }
}

async function loadItems() {
  const params = new URLSearchParams({
    q: state.q,
    source: state.source,
    limit: "200",
  });
  elements.results.setAttribute("aria-busy", "true");

  try {
    const response = await fetch(`/api/items?${params}`);
    if (!response.ok) throw new Error("Could not load archive");
    const data = await response.json();
    state.items = data.results || [];
    state.counts = data.counts || state.counts;
    render();
    setOnline(true, "Archive ready");
  } catch {
    setOnline(false, "Archive offline");
    showToast("Momento could not reach your archive.");
  } finally {
    elements.results.removeAttribute("aria-busy");
  }
}

function render() {
  updateCounts();
  const hasArchive = state.counts.all > 0;
  const hasResults = state.items.length > 0;

  elements.results.innerHTML = state.items.map(memoryMarkup).join("");
  elements.empty.hidden = hasResults || !hasArchive;
  elements.onboarding.hidden = hasArchive;
  elements.resultsTitle.textContent = state.q ? "What surfaced" : "Recently remembered";
  elements.resultCount.textContent = hasResults
    ? `${state.items.length} ${state.items.length === 1 ? "memory" : "memories"}`
    : "";
}

function updateCounts() {
  for (const [source, selectors] of Object.entries(countTargets)) {
    for (const selector of selectors) {
      const target = document.querySelector(selector);
      if (target) target.textContent = formatNumber(state.counts[source] || 0);
    }
  }
}

function memoryMarkup(item) {
  const avatar = item.author?.avatarUrl
    ? `<img class="memory-avatar" src="${escapeAttr(item.author.avatarUrl)}" alt="" loading="lazy" />`
    : `<div class="memory-avatar avatar-fallback" aria-hidden="true">${escapeHtml(initials(item.author?.displayName || item.author?.handle))}</div>`;
  const media = item.media?.find((entry) => entry.kind === "photo" && entry.url);
  const date = formatDate(item.postedAt);
  const sources = (item.sources || []).map(sourceMarkup).join("");
  const handle = item.author?.handle || "unknown";

  return `<article class="memory-item">
    ${avatar}
    <div class="memory-body">
      <div class="memory-meta">
        <span class="author-name">${escapeHtml(item.author?.displayName || handle)}</span>
        <span class="author-handle">@${escapeHtml(handle)}</span>
        <time class="memory-date" datetime="${escapeAttr(item.postedAt || "")}">${escapeHtml(date)}</time>
      </div>
      <p class="memory-text">${linkifyText(item.text)}</p>
      ${media ? `<img class="memory-media" src="${escapeAttr(media.url)}" alt="${escapeAttr(media.altText || "Tweet image")}" loading="lazy" />` : ""}
      <div class="memory-footer">
        <div class="source-list">${sources}</div>
        <a class="open-link" href="${escapeAttr(item.url)}" target="_blank" rel="noreferrer">Open on X</a>
      </div>
    </div>
  </article>`;
}

function sourceMarkup(source) {
  const labels = { bookmark: "Bookmarked", heart: "Hearted", shared: "Shared" };
  return `<span class="source-badge"><span class="source-mark ${source}-mark"></span>${labels[source] || escapeHtml(source)}</span>`;
}

function openCapture() {
  elements.captureError.textContent = "";
  elements.dialog.showModal();
  setTimeout(() => elements.captureUrl.focus(), 60);
}

function closeCapture() {
  if (elements.dialog.open) elements.dialog.close();
}

async function pasteUrl() {
  try {
    elements.captureUrl.value = await navigator.clipboard.readText();
    elements.captureUrl.focus();
  } catch {
    elements.captureError.textContent = "Clipboard access was blocked. Paste the link manually.";
  }
}

async function saveCapture(event) {
  event.preventDefault();
  const form = new FormData(elements.captureForm);
  const payload = { url: form.get("url"), source: form.get("source") };
  elements.captureError.textContent = "";
  elements.saveCapture.disabled = true;
  elements.saveCapture.textContent = "Writing it down…";

  try {
    const response = await fetch("/api/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save this link");
    elements.captureForm.reset();
    elements.dialog.close();
    showToast("Saved to Momento.");
    await loadArchive();
  } catch (error) {
    elements.captureError.textContent = error.message;
  } finally {
    elements.saveCapture.disabled = false;
    elements.saveCapture.textContent = "Save to Momento";
  }
}

async function installApp() {
  if (!state.deferredPrompt) return;
  state.deferredPrompt.prompt();
  await state.deferredPrompt.userChoice;
  state.deferredPrompt = null;
  elements.install.hidden = true;
}

function setOnline(online, label) {
  elements.status.classList.toggle("is-online", online);
  elements.status.classList.toggle("is-offline", !online);
  elements.status.lastChild.textContent = label;
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}

function linkifyText(value) {
  return escapeHtml(String(value || "")).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noreferrer">$1</a>',
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function initials(value = "") {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "M";
}

function formatDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en", { notation: value > 9999 ? "compact" : "standard" }).format(value);
}
