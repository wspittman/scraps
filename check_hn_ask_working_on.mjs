/**
 * Check for new "Ask HN: What are you working on?" posts by user david927.
 */
import fs from "node:fs";
import path from "node:path";

// State
const STATE_FILE = path.resolve("hn_ask_working_on_state.json");
const EMPTY_STATE = { lastId: null, lastHitAt: null };

// Time
const COOLDOWN_DAYS = 21;
const SEC_PER_DAY = 24 * 60 * 60;
const COOLDOWN_MS = COOLDOWN_DAYS * SEC_PER_DAY * 1000;
const ONE_DAY_SEC = Math.floor(Date.now() / 1000 - 1 * SEC_PER_DAY);

// Search
const AUTHOR = "david927";

// Use search_by_date so newest items come first.
const ALGOLIA_URL =
  "https://hn.algolia.com/api/v1/search_by_date?" +
  new URLSearchParams({
    tags: `story,ask_hn,author_${AUTHOR}`,
    query: "what are you working on",
    hitsPerPage: "1",
    numericFilters: "created_at_i>" + ONE_DAY_SEC,
    // Ask Algolia to search only in title if supported by this index.
    restrictSearchableAttributes: "title",
  }).toString();

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return EMPTY_STATE;
  }
}

async function request() {
  const res = await fetch(ALGOLIA_URL, {
    headers: { "User-Agent": "hn-ask-working-on-alert/1.0" },
  });

  if (!res.ok) {
    throw new Error(`Algolia request failed: ${res.status} ${res.statusText}`);
  }

  return await res.json();
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

async function main() {
  const state = loadState();

  if (Date.now() - state.lastHitAt < COOLDOWN_MS) {
    console.log(`Cooldown (${COOLDOWN_DAYS}d). Last hit ${state.lastHitAt}.`);
    return;
  }

  const data = await request();

  if (!data || !Array.isArray(data.hits) || !data.hits.length) {
    console.log("No hits found.");
    return;
  }

  const { title, objectID, created_at } = data.hits[0];

  if (!title || !objectID || state.lastId === objectID) {
    console.log("No new posts found.");
    return;
  }

  console.log("New post found!", {
    title,
    objectID,
    created_at,
    url: `https://news.ycombinator.com/item?id=${encodeURIComponent(objectID)}`,
  });

  // Save state first, then fail intentionally.
  saveState({ lastId: objectID, lastHitAt: Date.now() });
  console.log("State updated. Failing intentionally to trigger notification.");
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
