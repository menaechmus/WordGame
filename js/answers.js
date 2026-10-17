// Answers the page's questions: a word list, the computer's move, hints and
// the word finder. Each word list is loaded the first time it is asked for
// and kept. This runs in the worker (worker.js), or on the page itself when a
// worker cannot start (thinker.js).

import { loadWords, loadCommon } from './dictionary.js';
import { think, FULL_LEVELS } from './ai.js';

const lists = new Map(); // list key -> promise of its trie
const everyday = new Map(); // list key -> promise of its everyday words

// A load that fails is forgotten, so the next question tries again.
function kept(cache, key, load) {
  if (!cache.has(key)) {
    cache.set(
      key,
      load().catch(error => {
        cache.delete(key);
        throw error;
      }),
    );
  }
  return cache.get(key);
}

const full = key => kept(lists, key, () => loadWords(key));
const common = key => kept(everyday, key, async () => loadCommon(await full(key)));

// request: { type: 'words', list }, or a question for think() with its list.
// Easy and Medium keep to everyday words; everything else knows them all.
export async function answer(request) {
  const { type, list, level } = request;
  if (type === 'words') return full(list);
  const easier = type === 'move' && !FULL_LEVELS.has(level);
  return think(request, { full: await full(list), common: easier ? await common(list) : null });
}
