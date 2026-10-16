// The computer's thinking, kept off the page's own thread so the page stays
// smooth while a play is searched for. It loads the word lists, hands the
// full one to the page so the page need not build its own, and answers the
// page's questions (see thinker.js).

import { loadDictionary, WORD_LISTS } from './dictionary.js';
import { think } from './ai.js';

const full = loadDictionary(WORD_LISTS.full);
let common = null; // loaded the first time an easier level needs it

full.then(
  dict => postMessage({ type: 'words', dict }),
  error => postMessage({ type: 'words', error: error.message }),
);

onmessage = async ({ data }) => {
  const { id, request } = data;
  try {
    const everyday = request.type === 'move' && request.level !== 'hard';
    if (everyday) common ??= loadDictionary(WORD_LISTS.common);
    const words = { full: await full, common: everyday ? await common : null };
    postMessage({ id, result: think(request, words) });
  } catch (error) {
    postMessage({ id, error: error.message });
  }
};
