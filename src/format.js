export function toMarkdown(like) {
  const fm = {
    id: String(like.id),
    url: like.url || "",
    author: like.author?.handle ? `@${like.author.handle.replace(/^@/, "")}` : "",
    author_name: like.author?.displayName || "",
    date: like.postedAt || "",
    liked_at: like.liked_at || like.likedAt || "",
  };

  const yaml = Object.entries(fm)
    .filter(([, v]) => v !== "" && v != null)
    .map(([k, v]) => `${k}: ${yamlScalar(v)}`)
    .join("\n");

  const text = (like.text || "").trim();
  const media = (like.media || [])
    .filter((m) => m?.url)
    .map((m) => {
      if (m.kind === "video" || m.kind === "animated_gif") {
        return m.videoUrl ? `[video](${m.videoUrl})` : `![media](${m.url})`;
      }
      return `![${m.altText || "image"}](${m.url})`;
    })
    .join("\n\n");

  const links = (like.links || [])
    .filter((l) => l?.expandedUrl || l?.url)
    .map((l) => `- [${l.title || l.expandedUrl || l.url}](${l.expandedUrl || l.url})`)
    .join("\n");

  const parts = [text];
  if (media) parts.push(media);
  if (links) parts.push("## Links\n\n" + links);

  return `---\n${yaml}\n---\n\n${parts.filter(Boolean).join("\n\n")}\n`;
}

export function slugName(like) {
  const handle = (like.author?.handle || "unknown")
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 32);
  const date = (like.postedAt || like.liked_at || "").slice(0, 10) || "undated";
  return `${date}-${handle}-${like.id}`;
}

function yamlScalar(v) {
  const s = String(v);
  if (/^[@-]/.test(s) || /[:#{}[\],&*?|>!%@`]/.test(s) || s.includes("\n")) {
    return JSON.stringify(s);
  }
  return s;
}
