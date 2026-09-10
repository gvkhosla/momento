import { buildBrief } from "./brief.js";
import { loadSettings, loadState, localDateKey, localMinutes, saveState } from "./config.js";
import { enrichVault } from "./enrich.js";
import { sendBriefEmail } from "./mail.js";

const TICK_MS = 5 * 60_000;

export function startScheduler(home, options = {}) {
  const tick = async (reason) => {
    try {
      await runDueJobs(home, { ...options, reason });
    } catch (error) {
      console.error(`Momento scheduler: ${error?.message || error}`);
    }
  };
  const timer = setInterval(() => tick("interval"), options.intervalMs || TICK_MS);
  timer.unref?.();
  setTimeout(() => tick("startup"), options.startupDelayMs || 8_000).unref?.();
  return () => clearInterval(timer);
}

export async function runDueJobs(home, options = {}) {
  const settings = loadSettings(home);
  const now = options.now || new Date();
  const report = { enriched: null, brief: null, emailed: null };

  if (options.enrich !== false) {
    report.enriched = await enrichVault(home, {
      limit: options.enrichLimit || 12,
      concurrency: 2,
      index: options.index !== false,
    });
    saveState(home, { lastEnrichAt: now.toISOString() });
  }

  if (options.brief === false) return report;
  if (!shouldSendBrief(home, settings, now) && !options.force) return report;

  const brief = await buildBrief(home, {
    now,
    skipModel: options.skipModel,
    model: options.model,
  });
  report.brief = brief.date;
  saveState(home, { lastBriefDate: brief.date, lastBriefAt: now.toISOString() });

  if (options.email === false || !settings.email) return report;
  try {
    const sent = await sendBriefEmail(home, brief, { settings });
    report.emailed = sent.to;
    saveState(home, { lastEmailAt: now.toISOString(), lastEmailStatus: "sent" });
  } catch (error) {
    report.emailed = null;
    saveState(home, { lastEmailAt: now.toISOString(), lastEmailStatus: String(error?.message || error) });
    if (options.throwOnMail) throw error;
  }
  return report;
}

export function shouldSendBrief(home, settings, now = new Date()) {
  const state = loadState(home);
  const today = localDateKey(now, settings.timezone);
  if (state.lastBriefDate === today) return false;
  const target = Number(settings.briefHour) * 60 + Number(settings.briefMinute || 0);
  return localMinutes(now, settings.timezone) >= target;
}
