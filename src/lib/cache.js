// Trees kept on this machine (SPEC §5.1: reopening a page shows its tree at once; §4.6: nothing
// cached anywhere else). They live in chrome.storage.local beside the settings, one entry per
// page, keyed by its URL and the text the tree was built from, so a page whose text changed is
// a page without a tree. Past CACHE_CAP entries the least recently used are dropped.
//
// Storage is passed in (chrome.storage.local, or a stand-in in the tests), so this module
// imports in Node.

const PREFIX = 'tree:';
export const CACHE_CAP = 100;

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The storage key of a page's tree: a SHA-256 of its URL (without the #fragment, which names a
 * place on the same page) and of the text the model was sent (treePrompt(page).user).
 * @returns {Promise<string>} 'tree:<64 hex digits>'
 */
export async function treeKey(url, text) {
  const page = new URL(url);
  page.hash = '';
  return PREFIX + hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${page.href}\n${text}`)));
}

/**
 * The tree saved under key, marked as used now.
 * @param {chrome.storage.StorageArea} storage
 * @returns {Promise<{url: string, model: string, label: string, savedAt: number, usedAt: number,
 *   tree: object} | null>}
 */
export async function loadTree(storage, key) {
  const { [key]: entry } = await storage.get(key);
  if (!entry) return null;
  const used = { ...entry, usedAt: Date.now() };
  await storage.set({ [key]: used });
  return used;
}

/** Stores the entry under key, saved and used now, and drops the least recently used past `cap`. */
export async function saveTree(storage, key, entry, cap = CACHE_CAP) {
  const now = Date.now();
  await storage.set({ [key]: { ...entry, savedAt: now, usedAt: now } });
  const used = (e) => e.usedAt ?? e.savedAt;
  const trees = Object.entries(await storage.get(null))
    .filter(([k]) => k.startsWith(PREFIX))
    .sort(([ka, a], [kb, b]) => used(b) - used(a) || (ka === key ? -1 : kb === key ? 1 : 0));
  const oldest = trees.slice(cap).map(([k]) => k);
  if (oldest.length) await storage.remove(oldest);
}

export const dropTree = (storage, key) => storage.remove(key);
