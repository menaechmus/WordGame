// The computer's choice of move at four levels, and the plays offered as
// hints. Every level chooses among the legal plays that moves.js finds; the
// lower levels are given only everyday words, and choose less carefully.

import { TILES, BLANK, VALUES, RACK_SIZE } from './tiles.js';
import { generateMoves, placementsFor } from './moves.js';
import { findWords } from './finder.js';

// Roughly what a tile kept on the rack is worth towards the next turn, in
// points: a blank or an S makes a good play next time likelier, a Q or a V
// less likely.
const KEEP = {
  [BLANK]: 25, S: 8, X: 3.5, Z: 3, E: 3, R: 1.5, A: 1, H: 1, C: 0.5, D: 0.5, L: 0.5, M: 0.5, N: 0.5, T: 0.5,
  I: -0.5, K: -0.5, P: -0.5, Y: -0.5, O: -1, G: -1.5, J: -1.5, B: -2, F: -2, U: -3, W: -3, V: -5, Q: -7,
};
const VOWELS = new Set([...'AEIOU']);

// What the tiles left after a play are worth: each tile's own value, less
// something for doubles and for too many vowels or too many consonants.
export function leaveValue(letters) {
  let value = 0;
  let vowels = 0;
  let consonants = 0;
  const seen = {};
  for (const letter of letters) {
    value += KEEP[letter];
    seen[letter] = (seen[letter] ?? 0) + 1;
    if (seen[letter] > 1 && letter !== BLANK) value -= VOWELS.has(letter) ? 4 : 3;
    if (VOWELS.has(letter)) vowels++;
    else if (letter !== BLANK) consonants++;
  }
  value -= 3 * Math.max(0, Math.abs(vowels - consonants) - 1);
  if (seen.Q && !seen.U && !seen[BLANK]) value -= 4;
  return value;
}

// The rack's letters less those a play lays (a blank in the play is a blank
// from the rack).
function leaveOf(letters, move) {
  const left = [...letters];
  for (const tile of move.tiles) left.splice(left.indexOf(tile.blank ? BLANK : tile.letter), 1);
  return left;
}

// The tiles worth keeping when swapping: of every set the rack could keep,
// the one with the best leave.
function bestKeep(letters) {
  let best = [];
  let bestValue = -Infinity;
  for (let set = 0; set < 1 << letters.length; set++) {
    const keep = letters.filter((_, i) => (set >> i) & 1);
    if (keep.length === letters.length) continue;
    const value = leaveValue(keep);
    if (value > bestValue) [best, bestValue] = [keep, value];
  }
  return { keep: best, value: bestValue };
}

const swapAllBut = (rack, keep) => {
  const kept = [...keep];
  return rack.filter(id => {
    const i = kept.indexOf(TILES[id]);
    if (i < 0) return true;
    kept.splice(i, 1);
    return false;
  });
};

const pointsLeft = letters => letters.reduce((sum, letter) => sum + VALUES[letter], 0);

// Guru: the most points now plus the value of what is left. With the bag
// empty the leave is only a debt, and going out is worth a good deal. When
// nothing scores well and the bag allows, a swap for a better rack.
function guru(moves, letters, bag) {
  let best = null;
  let bestValue = -Infinity;
  for (const move of moves) {
    const leave = leaveOf(letters, move);
    let value = move.score;
    if (bag >= RACK_SIZE) value += leaveValue(leave);
    else if (bag > 0) value += leaveValue(leave) / 2;
    else value += leave.length ? -2 * pointsLeft(leave) : 12;
    if (value > bestValue) [best, bestValue] = [move, value];
  }
  if (bag >= RACK_SIZE) {
    const swap = bestKeep(letters);
    if (swap.value - 4 > bestValue) return { swap: swap.keep };
  }
  return best;
}

// The lower levels pick by score alone and never think about what is left
// on the rack.

// Hard: any one of the few best-scoring plays.
function hard(moves, letters, bag, random) {
  moves.sort((a, b) => b.score - a.score);
  return moves[Math.floor(random() * Math.min(HARD_TOP, moves.length))];
}

// Medium and Easy keep to words no longer than `len` when they can, and pick
// at random between two points in those plays ranked by score: `from` 0.75
// and `to` 1 mean somewhere in the top quarter.
function between(moves, random, len, from, to) {
  const short = moves.filter(move => move.word.length <= len);
  const pool = (short.length ? short : moves).sort((a, b) => a.score - b.score);
  return pool[Math.min(pool.length - 1, Math.floor(pool.length * (from + random() * (to - from))))];
}

const medium = (moves, letters, bag, random) => between(moves, random, MEDIUM_LEN, MEDIUM_FROM, 1);
const easy = (moves, letters, bag, random) => between(moves, random, EASY_LEN, EASY_FROM, EASY_TO);

const HARD_TOP = 6;
const MEDIUM_LEN = 7;
const MEDIUM_FROM = 0.7;
const EASY_LEN = 5;
const EASY_FROM = 0.35;
const EASY_TO = 0.75;

const LEVELS = { easy, medium, hard, guru };

// The levels that know every word in the list; the others keep to everyday words.
export const FULL_LEVELS = new Set(['hard', 'guru']);

// The computer's turn: { type: 'play', tiles } with tiles as game.play takes
// them, { type: 'exchange', ids } or { type: 'pass' }.
export function chooseMove(moves, rack, bag, level, random = Math.random) {
  const letters = rack.map(id => TILES[id]);
  let choice = moves.length ? LEVELS[level](moves, letters, bag, random) : null;
  if (!choice && bag >= RACK_SIZE) choice = { swap: bestKeep(letters).keep };
  if (!choice) return { type: 'pass' };
  if (choice.swap) return { type: 'exchange', ids: swapAllBut(rack, choice.swap) };
  return { type: 'play', tiles: placementsFor(choice, rack), word: choice.word, score: choice.score };
}

// Every playable word, each at its best-scoring place, best first (and A to
// Z among equals), for the Hint button.
export function rankPlays(moves, rack) {
  const byWord = new Map();
  for (const move of moves) {
    const known = byWord.get(move.word);
    if (!known || move.score > known.score) byWord.set(move.word, move);
  }
  return [...byWord.values()]
    .sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : 1))
    .map(move => ({ word: move.word, name: move.name, score: move.score, tiles: placementsFor(move, rack) }));
}

export const topHints = (moves, rack, count = 5) => rankPlays(moves, rack).slice(0, count);

// Answers one request from the page, given the word lists: { full, common }.
// Easy and Medium only know everyday words; Hard, Guru, hints and the word
// finder know them all. request: { type: 'move', board, rack, bag, level },
// { type: 'hints', board, rack } or { type: 'find', filters }.
export function think(request, words, random = Math.random) {
  const { type, board, rack, bag, level } = request;
  if (type === 'hints') return rankPlays(generateMoves(words.full, board, rack), rack);
  if (type === 'find') return findWords(words.full, request.filters);
  const dict = FULL_LEVELS.has(level) ? words.full : words.common;
  return chooseMove(generateMoves(dict, board, rack), rack, bag, level, random);
}
