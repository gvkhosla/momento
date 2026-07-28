export function transformLike(raw) {
  const tweet = unwrap(raw);
  if (!tweet) return null;

  const legacy = tweet.legacy ?? {};
  const userResult = tweet.core?.user_results?.result;
  const userLegacy = userResult?.legacy ?? {};
  const userCore = userResult?.core ?? {};
  const screenName = userCore.screen_name ?? userLegacy.screen_name ?? null;
  const displayName = userCore.name ?? userLegacy.name ?? screenName;
  const avatarUrl =
    userResult?.avatar?.image_url ?? userLegacy.profile_image_url_https ?? null;
  const userId = userResult?.rest_id ?? legacy.user_id_str;
  if (!userId) return null;

  const tweetId = tweet.rest_id ?? legacy.id_str;
  if (!tweetId) return null;

  const noteText = tweet.note_tweet?.note_tweet_results?.result?.text;
  const text = noteText ?? legacy.full_text ?? legacy.text ?? "";

  const entities = legacy.entities ?? {};
  const mediaList = (legacy.extended_entities?.media ?? []).map((m, i) => ({
    id: m.id_str ?? `${tweetId}-m${i}`,
    kind: kindFor(m.type),
    url: m.media_url_https ?? m.media_url,
    altText: m.ext_alt_text ?? null,
    videoUrl: pickBestVideoVariant(m.video_info?.variants),
  }));

  const links = (entities.urls ?? []).map((u) => ({
    url: u.url,
    expandedUrl: u.expanded_url,
    title: null,
  }));

  return {
    id: tweetId,
    author: {
      id: userId,
      handle: screenName ?? "unknown",
      displayName: displayName ?? "Unknown",
      avatarUrl,
    },
    text,
    postedAt: legacy.created_at
      ? new Date(legacy.created_at).toISOString()
      : null,
    liked_at: new Date().toISOString(),
    url: `https://x.com/${screenName ?? "i/web"}/status/${tweetId}`,
    media: mediaList,
    links,
  };
}

function unwrap(result) {
  if (!result) return null;
  if (result.__typename === "TweetWithVisibilityResults") {
    return result.tweet ?? null;
  }
  if (result.__typename === "TweetTombstone") return null;
  return result;
}

function kindFor(t) {
  if (t === "video") return "video";
  if (t === "animated_gif") return "animated_gif";
  return "photo";
}

function pickBestVideoVariant(variants) {
  if (!variants?.length) return null;
  const mp4s = variants.filter((v) => v.content_type === "video/mp4");
  if (mp4s.length === 0) return null;
  return mp4s.reduce((a, b) => ((a.bitrate ?? 0) > (b.bitrate ?? 0) ? a : b))
    .url;
}
