import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Resend } from "resend";
import { loadSettings } from "./config.js";

const DEFAULT_TO = "geetkhosla@gmail.com";
const DEFAULT_FROM = "Momento <onboarding@resend.dev>";
const PLACEHOLDER_KEY = "re_xxxxxxxxx";

export function mailReady(settings) {
  return Boolean((settings?.email || DEFAULT_TO) && resendApiKey());
}

export function resendApiKey() {
  const key = String(process.env.RESEND_API_KEY || "").trim();
  if (!key || key === PLACEHOLDER_KEY) return "";
  return key;
}

export async function sendBriefEmail(home, brief, options = {}) {
  const settings = options.settings || loadSettings(home);
  const to = settings.email || DEFAULT_TO;
  const apiKey = resendApiKey();
  if (!apiKey) {
    throw new Error("Set RESEND_API_KEY to your real Resend key. Replace re_xxxxxxxxx.");
  }

  const from = settings.fromEmail || process.env.MOMENTO_FROM_EMAIL || DEFAULT_FROM;
  const resend = options.resend || new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: [to],
    subject: `Momento · ${brief.headline}`,
    html: renderBriefEmail(brief),
    text: renderBriefText(brief),
  });
  if (error) {
    throw new Error(error.message || "Resend could not send the brief.");
  }
  return { id: data?.id || null, to };
}

export async function speakBrief(brief, dest) {
  const script = String(brief.podcastScript || "").trim();
  if (!script) throw new Error("No podcast script on this brief.");
  const aiff = dest.endsWith(".aiff") ? dest : join(tmpdir(), `momento-${brief.date}.aiff`);
  await run("say", ["-o", aiff, script]);
  if (dest.endsWith(".mp3") || dest.endsWith(".m4a")) {
    await run("ffmpeg", ["-y", "-i", aiff, dest]);
    return dest;
  }
  return aiff;
}

export function writeBriefAudioScript(brief, dest) {
  writeFileSync(dest, `${brief.podcastScript}\n`, "utf8");
  return dest;
}

export function renderBriefEmail(brief) {
  const insights = (brief.insights || [])
    .map((line) => `<li style="margin:0 0 10px;line-height:1.5">${escapeHtml(line)}</li>`)
    .join("");
  const recents = (brief.recents || [])
    .map(
      (item) => `<tr>
        <td style="padding:14px 0;border-top:1px solid #e8e4dc">
          <a href="${escapeAttr(item.url)}" style="color:#171716;text-decoration:none">
            <div style="font:600 15px/1.4 ui-sans-serif,system-ui">${escapeHtml(item.title)}</div>
            <div style="margin-top:4px;color:#706e68;font:13px/1.45 ui-sans-serif,system-ui">${escapeHtml(item.site || "")}</div>
            <div style="margin-top:6px;color:#4a4843;font:14px/1.55 ui-sans-serif,system-ui">${escapeHtml(item.excerpt || "")}</div>
          </a>
        </td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<body style="margin:0;background:#f4f0e8;color:#171716">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0e8">
    <tr>
      <td align="center" style="padding:28px 16px">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fffefa;border:1px solid #e8e4dc">
          <tr>
            <td style="padding:28px 28px 8px;font:700 13px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase">
              momento<span style="color:#0f766e">.</span> daily
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 0;font:600 28px/1.15 ui-serif,Georgia,serif">${escapeHtml(brief.headline)}</td>
          </tr>
          <tr>
            <td style="padding:10px 28px 0;color:#706e68;font:13px/1.4 ui-sans-serif,system-ui">${escapeHtml(brief.date)}</td>
          </tr>
          <tr>
            <td style="padding:18px 28px 8px;font:16px/1.6 ui-sans-serif,system-ui">${escapeHtml(brief.summary)}</td>
          </tr>
          <tr>
            <td style="padding:12px 28px 0">
              <ol style="margin:0;padding-left:18px;font:15px/1.55 ui-sans-serif,system-ui">${insights}</ol>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 8px;font:700 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:#706e68">New bookmarks</td>
          </tr>
          <tr>
            <td style="padding:0 28px 12px">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${recents || `<tr><td style="padding:8px 0;color:#706e68">None in this window. Momento reread the archive instead.</td></tr>`}</table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;color:#9c9991;font:12px/1.5 ui-sans-serif,system-ui">
              Generated locally from your X bookmarks. Reply if you want Momento quieter or louder tomorrow.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderBriefText(brief) {
  const insights = (brief.insights || []).map((line, index) => `${index + 1}. ${line}`).join("\n");
  const recents = (brief.recents || []).map((item) => `- ${item.title} (${item.url})`).join("\n");
  return `${brief.headline}\n${brief.date}\n\n${brief.summary}\n\n${insights}\n\nNew bookmarks\n${recents || "- None"}\n\nPodcast\n${brief.podcastScript}\n`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}`));
    });
  });
}
