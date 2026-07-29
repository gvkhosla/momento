export function transformItem(raw, source, { savedAt } = {}) {
  const tweet = unwrap(raw);
  if (!tweet) return null;

  const legacy = tweet.legacy ?? {};
  const userResult = tweet.core?.user_results?.result;
  const userLegacy = userResult?.legacy ?? {};
  const userCore = userResult?.core ?? {};
  const screenName = userCore.screen_name ?? userLegacy.screen_name ?? null;
  const displayName = userCore.name ?? userLegacy.name ?? screenName;
  const avatarUrl = userResult?.avatar?.image_url ?? userLegacy.profile_image_url_https ?? null;
  const userId = userResult?.rest_id ?? legacy.user_id_str;
  const tweetId = tweet.rest_id ?? legacy.id_str;
  if (!userId || !tweetId) return null;

  const noteText = tweet.note_tweet?.note_tweet_results?.result?.text;
  const text = noteText ?? legacy.full_text ?? legacy.text ?? "";
  const entities = legacy.entities ?? {};
  const media = (legacy.extended_entities?.media ?? []).map((entry, index) => ({
    id: entry.id_str ?? `${tweetId}-m${index}`,
    kind: kindFor(entry.type),
    url: entry.media_url_https ?? entry.media_url,
    altText: entry.ext_alt_text ?? null,
    videoUrl: pickBestVideoVariant(entry.video_info?.variants),
  }));
  const links = (entities.urls ?? []).map((entry) => ({
    url: entry.url,
    expandedUrl: entry.expanded_url,
    title: null,
  }));
  const now = new Date().toISOString();
  const sourceSavedAt = savedAt || now;

  return {
    id: tweetId,
    author: {
      id: userId,
      handle: screenName ?? "unknown",
      displayName: displayName ?? "Unknown",
      avatarUrl,
      verified: Boolean(userLegacy.verified || userResult?.is_blue_verified),
    },
    text,
    postedAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : now,
    savedAt: sourceSavedAt,
    source,
    ...(source === "heart"
      ? { likedAt: sourceSavedAt }
      : { bookmarkedAt: sourceSavedAt }),
    url: `https://x.com/${screenName ?? "i/web"}/status/${tweetId}`,
    media,
    links,
  };
}

function unwrap(result) {
  if (!result) return null;
  if (result.__typename === "TweetWithVisibilityResults") return result.tweet ?? null;
  if (result.__typename === "TweetTombstone") return null;
  return result;
}

function kindFor(type) {
  if (type === "video") return "video";
  if (type === "animated_gif") return "animated_gif";
  return "photo";
}

function pickBestVideoVariant(variants) {
  const mp4s = (variants || []).filter((entry) => entry.content_type === "video/mp4");
  if (mp4s.length === 0) return null;
  return mp4s.reduce((a, b) => ((a.bitrate ?? 0) > (b.bitrate ?? 0) ? a : b)).url;
}
