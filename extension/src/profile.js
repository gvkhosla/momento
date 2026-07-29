chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "momento-detect-profile") return;
  const profileLink = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
  const href = profileLink?.getAttribute("href") || "";
  const screenName = href.match(/^\/([^/?#]+)$/)?.[1] || null;
  sendResponse({ screenName });
});
