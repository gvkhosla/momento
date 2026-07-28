export function toMarkdown(item) {
  const fm = {
    id: String(item.id),
    url: item.url || "",
    author: item.author?.handle ? `@${item.author.handle.replace(/^@/, "")}` : "",
    author_name: item.author?.displayName || "",
    date: item.postedAt || "",
    saved_at: item.savedAt || "",
    sources: item.sources || [],
    liked_at: item.likedAt || "",
    bookmarked_at: item.bookmarkedAt || "",
    shared_at: item.sharedAt || "",
  };

  const yaml = Object.entries(fm)
    .filter(([, value]) => value !== "" && value != null)
    .map(([key, value]) => `${key}: ${yamlScalar(value)}`)
    .join("\n");

  const text = String(item.text || "").trim();
  const media = (item.media || [])
    .filter((entry) => entry?.url)
    .map((entry) => {
      if (entry.kind === "video" || entry.kind === "animated_gif") {
        return entry.videoUrl
          ? `[video](${entry.videoUrl})`
          : `![media](${entry.url})`;
      }
      return `![${entry.altText || "image"}](${entry.url})`;
    })
    .join("\n\n");

  const links = (item.links || [])
    .filter((entry) => entry?.expandedUrl || entry?.url)
    .map(
      (entry) =>
        `- [${entry.title || entry.expandedUrl || entry.url}](${entry.expandedUrl || entry.url})`,
    )
    .join("\n");

  const parts = [text];
  if (media) parts.push(media);
  if (links) parts.push(`## Links\n\n${links}`);

  return `---\n${yaml}\n---\n\n${parts.filter(Boolean).join("\n\n")}\n`;
}

export function slugName(item) {
  const handle = (item.author?.handle || "unknown")
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 32);
  const date = String(item.postedAt || item.savedAt || "").slice(0, 10) || "undated";
  return `${date}-${handle}-${item.id}`;
}

function yamlScalar(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => JSON.stringify(String(entry))).join(", ")}]`;
  }
  const string = String(value);
  if (
    /^[@-]/.test(string) ||
    /[:#{}[\],&*?|>!%@`]/.test(string) ||
    string.includes("\n")
  ) {
    return JSON.stringify(string);
  }
  return string;
}
