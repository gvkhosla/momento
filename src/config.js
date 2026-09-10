import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SETTINGS_FILE = "settings.json";
const STATE_FILE = ".momento-state.json";

const DEFAULTS = {
  email: "geetkhosla@gmail.com",
  fromEmail: "Momento <onboarding@resend.dev>",
  briefHour: 7,
  briefMinute: 0,
  lookbackHours: 36,
  includePodcast: true,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
};

export function loadSettings(home) {
  const path = join(home, SETTINGS_FILE);
  const file = readJson(path);
  return {
    ...DEFAULTS,
    ...file,
    email: String(file.email || process.env.MOMENTO_EMAIL || DEFAULTS.email).trim(),
    fromEmail: String(file.fromEmail || process.env.MOMENTO_FROM_EMAIL || DEFAULTS.fromEmail).trim(),
    briefHour: clamp(Number(file.briefHour ?? process.env.MOMENTO_BRIEF_HOUR ?? DEFAULTS.briefHour), 0, 23),
    briefMinute: clamp(Number(file.briefMinute ?? DEFAULTS.briefMinute), 0, 59),
    lookbackHours: clamp(Number(file.lookbackHours ?? DEFAULTS.lookbackHours), 6, 168),
    includePodcast: file.includePodcast !== false,
    timezone: String(file.timezone || DEFAULTS.timezone),
  };
}

export function saveSettings(home, patch) {
  mkdirSync(home, { recursive: true });
  const current = loadSettings(home);
  const next = {
    ...current,
    ...Object.fromEntries(Object.entries(patch || {}).filter(([, value]) => value !== undefined)),
  };
  next.email = String(next.email || "").trim();
  next.fromEmail = String(next.fromEmail || "").trim();
  next.briefHour = clamp(Number(next.briefHour), 0, 23);
  next.briefMinute = clamp(Number(next.briefMinute), 0, 59);
  next.lookbackHours = clamp(Number(next.lookbackHours), 6, 168);
  next.includePodcast = next.includePodcast !== false;
  writeJson(join(home, SETTINGS_FILE), {
    email: next.email,
    fromEmail: next.fromEmail,
    briefHour: next.briefHour,
    briefMinute: next.briefMinute,
    lookbackHours: next.lookbackHours,
    includePodcast: next.includePodcast,
    timezone: next.timezone,
  });
  return next;
}

export function loadState(home) {
  return {
    lastBriefDate: null,
    lastBriefAt: null,
    lastEnrichAt: null,
    lastIndexAt: null,
    lastEmailAt: null,
    lastEmailStatus: null,
    ...readJson(join(home, STATE_FILE)),
  };
}

export function saveState(home, patch) {
  mkdirSync(home, { recursive: true });
  const next = { ...loadState(home), ...patch };
  writeJson(join(home, STATE_FILE), next);
  return next;
}

export function localDateKey(date = new Date(), timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || DEFAULTS.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export function localMinutes(date = new Date(), timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || DEFAULTS.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function readJson(path) {
  if (!existsSync(path)) return {};
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeJson(path, value) {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temp, path);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
