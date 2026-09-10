import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "works.earendil.momento";

export function launchAgentPath() {
  return join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
}

export function writeLaunchAgent({ home, port = 4177, nodePath, cliPath }) {
  const agents = join(homedir(), "Library", "LaunchAgents");
  mkdirSync(agents, { recursive: true });
  const program = resolve(cliPath || fileURLToPath(new URL("./cli.js", import.meta.url)));
  const binary = nodePath || process.execPath;
  const logs = join(home, "logs");
  mkdirSync(logs, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(binary)}</string>
    <string>${escapeXml(program)}</string>
    <string>serve</string>
    <string>--home</string>
    <string>${escapeXml(home)}</string>
    <string>--port</string>
    <string>${port}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(home)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${escapeXml(process.env.PATH || "/usr/bin:/bin:/opt/homebrew/bin")}</string>
    <key>HOME</key>
    <string>${escapeXml(homedir())}</string>
    ${envXml("MOMENTO_HOME", home)}
    ${envXml("MOMENTO_EMAIL", process.env.MOMENTO_EMAIL)}
    ${envXml("MOMENTO_FROM_EMAIL", process.env.MOMENTO_FROM_EMAIL)}
    ${envXml("RESEND_API_KEY", process.env.RESEND_API_KEY)}
    ${envXml("MOMENTO_MODEL", process.env.MOMENTO_MODEL)}
    ${envXml("MOMENTO_QMD_BIN", process.env.MOMENTO_QMD_BIN)}
    ${envXml("MOMENTO_QMD_COLLECTION", process.env.MOMENTO_QMD_COLLECTION)}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(join(logs, "serve.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(join(logs, "serve.err.log"))}</string>
</dict>
</plist>
`;
  const dest = launchAgentPath();
  writeFileSync(dest, plist, "utf8");
  return dest;
}

export function launchAgentInstalled() {
  return existsSync(launchAgentPath());
}

function envXml(key, value) {
  if (!value) return "";
  return `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
