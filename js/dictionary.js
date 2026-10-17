// The word list, packed into a trie of typed arrays. A trie can be walked a
// letter at a time, which the move generator needs, and typed arrays hold the
// 168,000 words in about 5 MB and pass to and from the worker in one piece.
//
// Node 0 is the root. For each node, `letter` is its letter (0-25 for A-Z),
// `child` its first child and `sibling` its next sibling, children running in
// alphabetical order. 0 means none, since the root is nobody's child. Bit n of
// `mask` is set when the node has a child for letter n, and `end` is 1 when a
// word ends there.

// The board is 15 squares across, and a single letter is not a word.
const WORD = /^[a-z]{2,15}$/i;

// Letter codes: 'A' or 'a' is 0. Setting bit 5 lower-cases an ASCII letter.
export const code = (word, i) => (word.charCodeAt(i) | 32) - 97;

// Each text holds one word per line; lines that are not words are skipped.
export function buildDictionary(...texts) {
  let capacity = 1 << 16;
  let letter = new Uint8Array(capacity);
  let child = new Int32Array(capacity);
  let sibling = new Int32Array(capacity);
  let mask = new Uint32Array(capacity);
  let end = new Uint8Array(capacity);
  let nodes = 1;
  let size = 0;

  const grow = (Type, old) => {
    const array = new Type(capacity);
    array.set(old);
    return array;
  };

  for (const text of texts) {
    for (const line of text.split('\n')) {
      const word = line.trim();
      if (!WORD.test(word)) continue;
      let node = 0;
      for (let i = 0; i < word.length; i++) {
        const c = code(word, i);
        let before = 0;
        let next = child[node];
        while (next && letter[next] < c) {
          before = next;
          next = sibling[next];
        }
        if (!next || letter[next] !== c) {
          if (nodes === capacity) {
            capacity *= 2;
            [letter, child, sibling, mask, end] = [
              grow(Uint8Array, letter), grow(Int32Array, child), grow(Int32Array, sibling),
              grow(Uint32Array, mask), grow(Uint8Array, end),
            ];
          }
          const fresh = nodes++;
          letter[fresh] = c;
          sibling[fresh] = next;
          if (before) sibling[before] = fresh;
          else child[node] = fresh;
          mask[node] |= 1 << c;
          next = fresh;
        }
        node = next;
      }
      if (!end[node]) {
        end[node] = 1;
        size++;
      }
    }
  }

  return {
    size,
    nodes,
    letter: letter.slice(0, nodes),
    child: child.slice(0, nodes),
    sibling: sibling.slice(0, nodes),
    mask: mask.slice(0, nodes),
    end: end.slice(0, nodes),
  };
}

// The child of `node` for letter code `c`, or 0 if there is none.
export function childOf(dict, node, c) {
  if (!(dict.mask[node] & (1 << c))) return 0;
  let next = dict.child[node];
  while (dict.letter[next] !== c) next = dict.sibling[next];
  return next;
}

export function isWord(dict, word) {
  if (!WORD.test(word)) return false;
  let node = 0;
  for (let i = 0; i < word.length && node >= 0; i++) {
    node = childOf(dict, node, code(word, i)) || -1;
  }
  return node > 0 && dict.end[node] === 1;
}

// The word lists a game can be played with, each made of files in words/.
// ENABLE and YAWL are in the public domain and Wordnik's list is under the
// MIT licence (words/LICENSE-wordnik.txt). added.txt is the game's own short
// list of newer words that some of them lack, such as OK and ZEN.
export const WORD_LISTS = {
  enable: { name: 'ENABLE', files: ['enable.txt'] },
  'enable+added': { name: 'ENABLE + added', files: ['enable.txt', 'added.txt'] },
  yawl: { name: 'YAWL', files: ['yawl.txt'] },
  'yawl+added': { name: 'YAWL + added', files: ['yawl.txt', 'added.txt'] },
  wordnik: { name: 'Wordnik', files: ['wordnik.txt'] },
  'wordnik+added': { name: 'Wordnik + added', files: ['wordnik.txt', 'added.txt'] },
};
export const DEFAULT_LIST = 'wordnik+added';

// The everyday vocabulary of the easier computer players, for any list;
// loadCommon() narrows it to the list in use.
const COMMON = 'common.txt';

async function fetchText(file) {
  const response = await fetch(new URL(`../words/${file}`, import.meta.url));
  if (!response.ok) throw new Error(`Could not load the word list ${file} (${response.status})`);
  return response.text();
}

export async function loadDictionary(files) {
  return buildDictionary(...(await Promise.all(files.map(fetchText))));
}

// One of WORD_LISTS, by its key.
export const loadWords = key => loadDictionary(WORD_LISTS[key].files);

// The everyday words that `dict` allows, so an easier computer player never
// plays a word the list in use would refuse.
export async function loadCommon(dict) {
  const text = await fetchText(COMMON);
  return buildDictionary(text.split('\n').filter(word => isWord(dict, word.trim())).join('\n'));
}
