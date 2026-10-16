// Every legal play for a rack, for the computer and for hints. This is the
// method of Appel and Jacobson ("The World's Fastest Scrabble Program",
// 1988). Plays are built outwards from anchors, the empty squares next to
// tiles already down, walking the word trie as letters are added so that
// only real words are ever followed. Before that, each empty square with
// tiles above or below it is limited to the letters that make a word up and
// down through it.
//
// The search runs along the rows, then along the rows of the board turned
// on its side, which are its columns. The premium squares are the same
// either way round.

import { TILES, VALUES, RACK_SIZE, isBlank } from './tiles.js';
import { SIZE, CENTER, SQUARES, LETTER_MULT, WORD_MULT, playName } from './board.js';
import { BINGO } from './rules.js';

const ALL = (1 << 26) - 1;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const POINTS = [...LETTERS].map(letter => VALUES[letter]);

// Each play: { tiles: [{ index, letter, blank }], word, score, across, name,
// bingo }. `word` is the main word; `tiles` run along it in order.
export function generateMoves(dict, board, rack) {
  const { letter, child, sibling, mask, end } = dict;
  const step = (node, c) => {
    if (!((mask[node] >>> c) & 1)) return -1;
    let next = child[node];
    while (letter[next] !== c) next = sibling[next];
    return next;
  };

  const counts = new Int8Array(26);
  let blanks = 0;
  for (const id of rack) {
    if (isBlank(id)) blanks++;
    else counts[TILES[id].charCodeAt(0) - 65]++;
  }
  const first = !board.some(Boolean);
  const moves = [];
  const singles = new Set(); // one-tile plays are found both ways round

  for (const across of [true, false]) {
    // Square v of this view (row by row) is square orig[v] of the board.
    const orig = new Int16Array(SQUARES);
    const code = new Int8Array(SQUARES).fill(-1); // letter on the square, -1 if empty
    const value = new Int8Array(SQUARES);
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = r * SIZE + c;
        const o = across ? v : c * SIZE + r;
        orig[v] = o;
        const tile = board[o];
        if (tile) {
          code[v] = tile.letter.charCodeAt(0) - 65;
          value[v] = isBlank(tile.id) ? 0 : VALUES[tile.letter];
        }
      }
    }
    const filled = v => code[v] >= 0;

    // For each empty square, the letters that may go there given the tiles
    // above and below, and those tiles' points (-1 when there are none).
    const allowed = new Int32Array(SQUARES);
    const crossPoints = new Int16Array(SQUARES);
    for (let v = 0; v < SQUARES; v++) {
      if (filled(v)) continue;
      let top = v;
      while (top >= SIZE && filled(top - SIZE)) top -= SIZE;
      let bottom = v;
      while (bottom < SQUARES - SIZE && filled(bottom + SIZE)) bottom += SIZE;
      if (top === v && bottom === v) {
        allowed[v] = ALL;
        crossPoints[v] = -1;
        continue;
      }
      let points = 0;
      let node = 0;
      for (let u = top; u < v; u += SIZE) {
        points += value[u];
        if (node >= 0) node = step(node, code[u]);
      }
      for (let u = v + SIZE; u <= bottom; u += SIZE) points += value[u];
      let ok = 0;
      if (node >= 0) {
        for (let next = child[node]; next; next = sibling[next]) {
          let n = next;
          for (let u = v + SIZE; u <= bottom && n >= 0; u += SIZE) n = step(n, code[u]);
          if (n >= 0 && end[n]) ok |= 1 << letter[next];
        }
      }
      allowed[v] = ok;
      crossPoints[v] = points;
    }

    // Anchors: empty squares beside a tile, or the centre of an empty board.
    const anchor = new Uint8Array(SQUARES);
    if (first) anchor[CENTER] = 1;
    else {
      for (let v = 0; v < SQUARES; v++) {
        if (filled(v)) continue;
        const c = v % SIZE;
        if ((c > 0 && filled(v - 1)) || (c < SIZE - 1 && filled(v + 1)) || (v >= SIZE && filled(v - SIZE)) || (v < SQUARES - SIZE && filled(v + SIZE))) {
          anchor[v] = 1;
        }
      }
    }

    // The tiles laid so far in the play being built, by square.
    const laid = new Int8Array(SQUARES).fill(-1);
    const laidBlank = new Uint8Array(SQUARES);
    const left = []; // the left part, as { c, blank }, leftmost first
    let row = 0;
    let anchorCol = 0;

    function record(wordStart, wordEnd) {
      const tiles = [];
      let sum = 0;
      let wordMult = 1;
      let cross = 0;
      let word = '';
      for (let x = wordStart; x <= wordEnd; x++) {
        const v = row * SIZE + x;
        if (filled(v)) {
          sum += value[v];
          word += LETTERS[code[v]];
          continue;
        }
        const c = laid[v];
        const blank = laidBlank[v] === 1;
        const o = orig[v];
        const points = blank ? 0 : POINTS[c];
        sum += points * LETTER_MULT[o];
        wordMult *= WORD_MULT[o];
        if (crossPoints[v] >= 0) cross += (crossPoints[v] + points * LETTER_MULT[o]) * WORD_MULT[o];
        word += LETTERS[c];
        tiles.push({ index: o, letter: LETTERS[c], blank });
      }
      if (tiles.length === 1) {
        const key = `${tiles[0].index}${tiles[0].letter}${tiles[0].blank}`;
        if (singles.has(key)) return;
        singles.add(key);
      }
      const bingo = tiles.length === RACK_SIZE;
      moves.push({
        tiles,
        word,
        score: sum * wordMult + cross + (bingo ? BINGO : 0),
        across,
        name: playName(orig[row * SIZE + wordStart], across),
        bingo,
      });
    }

    // Carries the word on to the right from column c, laying rack tiles on
    // empty squares and reading the ones already there.
    function extend(node, c, wordStart) {
      const v = row * SIZE + c;
      if (c === SIZE || !filled(v)) {
        if (c > anchorCol && end[node]) record(wordStart, c - 1);
        if (c === SIZE) return;
        const ok = allowed[v];
        for (let next = child[node]; next; next = sibling[next]) {
          const l = letter[next];
          if (!((ok >>> l) & 1)) continue;
          laid[v] = l;
          if (counts[l]) {
            counts[l]--;
            extend(next, c + 1, wordStart);
            counts[l]++;
          }
          if (blanks) {
            blanks--;
            laidBlank[v] = 1;
            extend(next, c + 1, wordStart);
            laidBlank[v] = 0;
            blanks++;
          }
          laid[v] = -1;
        }
      } else {
        const next = step(node, code[v]);
        if (next >= 0) extend(next, c + 1, wordStart);
      }
    }

    // Builds every left part of up to `limit` tiles in front of the anchor,
    // trying each with the rest of the word to the right. The squares it
    // uses touch no tiles, so any letter may go on them.
    function leftPart(node, limit) {
      const start = anchorCol - left.length;
      left.forEach((tile, i) => {
        laid[row * SIZE + start + i] = tile.c;
        laidBlank[row * SIZE + start + i] = tile.blank ? 1 : 0;
      });
      extend(node, anchorCol, start);
      left.forEach((_, i) => {
        laid[row * SIZE + start + i] = -1;
        laidBlank[row * SIZE + start + i] = 0;
      });
      if (!limit) return;
      for (let next = child[node]; next; next = sibling[next]) {
        const l = letter[next];
        if (counts[l]) {
          counts[l]--;
          left.push({ c: l, blank: false });
          leftPart(next, limit - 1);
          left.pop();
          counts[l]++;
        }
        if (blanks) {
          blanks--;
          left.push({ c: l, blank: true });
          leftPart(next, limit - 1);
          left.pop();
          blanks++;
        }
      }
    }

    for (row = 0; row < SIZE; row++) {
      for (let c = 0; c < SIZE; c++) {
        const v = row * SIZE + c;
        if (!anchor[v]) continue;
        anchorCol = c;
        if (c > 0 && filled(v - 1)) {
          // The tiles to the left already start the word.
          let start = c - 1;
          while (start > 0 && filled(row * SIZE + start - 1)) start--;
          let node = 0;
          for (let x = start; x < c && node >= 0; x++) node = step(node, code[row * SIZE + x]);
          if (node >= 0) extend(node, c, start);
        } else {
          // Room in front: empty squares back to the board's edge or the
          // previous anchor, whose own search covers anything further left.
          let limit = 0;
          for (let x = c - 1; x >= 0 && !anchor[row * SIZE + x] && !filled(row * SIZE + x); x--) limit++;
          leftPart(0, Math.min(limit, rack.length - 1));
        }
      }
    }
  }
  return moves;
}

// The tiles from `rack` for a play: a blank where the play has a blank,
// otherwise a tile of that letter. Gives { index, id, letter } as game.play
// takes them.
export function placementsFor(move, rack) {
  const free = [...rack];
  return move.tiles.map(({ index, letter, blank }) => {
    const i = free.findIndex(id => (blank ? isBlank(id) : TILES[id] === letter));
    if (i < 0) throw new Error(`No ${blank ? 'blank' : letter} on the rack`);
    return { index, id: free.splice(i, 1)[0], letter };
  });
}
