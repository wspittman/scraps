chrome.runtime.onInstalled.addListener(async () => {
  await chrome.scripting.registerContentScripts([
    {
      id: "math-random-hook",
      matches: ["https://orteil.dashnet.org/cookieclicker/"],
      js: ["inpage.js"],
      runAt: "document_start",
      world: "MAIN", // <-- runs in page world
    },
    {
      id: "gold-hook",
      matches: ["https://orteil.dashnet.org/cookieclicker/"],
      js: ["inject.js"],
      world: "MAIN", // <-- runs in page world
    },
  ]);
});
