// The word finder: every word in the list that fits what is asked of it. It
// walks the word trie in alphabetical order and gives up on any branch that
// can no longer fit, so even a search of the whole list takes a moment.
//
// filters, all optional and all applied together:
//   starts    the letters a word begins with
//   ends      the letters it ends with
//   contains  letters it has somewhere, side by side
//   pattern   one letter per place, ? for any letter: C?T is CAT, COT, CUT
//   letters   what it is made from, in any order, each no more often than
//             given, ? for any letter: RETAIN? finds RETAINS and RATINE
//   length    how many letters it has (0 for any)

const NOT_LETTERS = /[^A-Z]/g;
const NOT_LETTERS_OR_WILD = /[^A-Z?]/g;

// Typed text, upper case, with anything else dropped (and ? kept where wanted).
export const onlyLetters = text => String(text ?? '').toUpperCase().replace(NOT_LETTERS, '');
export const lettersAndWild = text => String(text ?? '').toUpperCase().replace(NOT_LETTERS_OR_WILD, '');

// Returns { words, total }: up to `limit` words, A to Z, and how many fit.
export function findWords(dict, filters = {}, limit = Infinity) {
  const starts = onlyLetters(filters.starts);
  const ends = onlyLetters(filters.ends);
  const contains = onlyLetters(filters.contains);
  const pattern = lettersAndWild(filters.pattern);
  const letters = lettersAndWild(filters.letters);
  const length = Number(filters.length) || 0;
  const words = [];
  let total = 0;

  // A pattern fixes the length too, so it must agree with any length asked.
  if (pattern && length && pattern.length !== length) return { words, total };
  const exact = pattern.length || length;
  const longest = Math.min(15, exact || 15, letters ? letters.length : 15);
  if (exact > longest) return { words, total };

  const counts = new Int8Array(26);
  let wild = 0;
  for (const ch of letters) {
    if (ch === '?') wild++;
    else counts[ch.charCodeAt(0) - 65]++;
  }

  const { letter, child, sibling, end } = dict;
  const path = [];

  function visit(node, depth) {
    if (end[node] && depth >= Math.max(2, starts.length) && (!exact || depth === exact)) {
      const word = path.join('');
      if ((!ends || word.endsWith(ends)) && (!contains || word.includes(contains))) {
        total++;
        if (words.length < limit) words.push(word);
      }
    }
    if (depth === longest) return;
    for (let next = child[node]; next; next = sibling[next]) {
      const c = letter[next];
      const ch = String.fromCharCode(65 + c);
      if (depth < starts.length && ch !== starts[depth]) continue;
      if (depth < pattern.length && pattern[depth] !== '?' && ch !== pattern[depth]) continue;
      // From the letters given, a real one is used before a ?: a word that
      // could use the ? here can always use it for the real one later.
      let fromWild = false;
      if (letters) {
        if (counts[c]) counts[c]--;
        else if (wild) {
          wild--;
          fromWild = true;
        } else continue;
      }
      path.push(ch);
      visit(next, depth + 1);
      path.pop();
      if (letters) {
        if (fromWild) wild++;
        else counts[c]++;
      }
    }
  }

  visit(0, 0);
  return { words, total };
}
