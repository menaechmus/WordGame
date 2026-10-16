// Whether the tiles laid this turn make a legal play, and what it scores.
// Only the board is needed, not the whole game, so the page (for the score
// shown while tiles are being placed), the game, the computer and the tests
// all share this one judgement.

import { SIZE, CENTER, row, col, LETTER_MULT, WORD_MULT, playName } from './board.js';
import { VALUES, RACK_SIZE, isBlank } from './tiles.js';

export const BINGO = 50;

// The squares of the word that runs through `index`, across or down.
// `letterAt` reads a square and returns a falsy value when it is empty.
export function wordCells(letterAt, index, across) {
  const step = across ? 1 : SIZE;
  const atStart = i => (across ? col(i) === 0 : i < SIZE);
  const atEnd = i => (across ? col(i) === SIZE - 1 : i >= SIZE * (SIZE - 1));
  let i = index;
  while (!atStart(i) && letterAt(i - step)) i -= step;
  const cells = [i];
  while (!atEnd(i) && letterAt(i + step)) cells.push((i += step));
  return cells;
}

// A letter scores its face value and a blank nothing. Premium squares only
// count under tiles laid this turn: a letter premium multiplies that letter,
// a word premium the whole word. Each letter's part is kept for the
// animation that counts the play out.
function scoreWord(cells, fresh, tileAt) {
  let sum = 0;
  let wordMult = 1;
  const letters = cells.map(index => {
    const tile = tileAt(index);
    const isNew = fresh.has(index);
    const blank = isBlank(tile.id);
    const value = blank ? 0 : VALUES[tile.letter];
    const mult = isNew ? LETTER_MULT[index] : 1;
    if (isNew) wordMult *= WORD_MULT[index];
    sum += value * mult;
    return { index, letter: tile.letter, blank, value, mult, fresh: isNew };
  });
  const text = letters.map(item => item.letter).join('');
  return { text, cells, letters, sum, wordMult, score: sum * wordMult };
}

// `placements` are the tiles laid this turn, as { index, id, letter }, where
// `letter` is the one shown (for a blank, the letter chosen for it). `isWord`
// checks a word in capitals; without it only the placement is judged.
//
// The result: { ok, error, invalid, words, across, name, score, bingo }.
// `words` starts with the main word, then any words made across it. When
// only the words are wrong, they and the score are still filled in, so the
// page can show what the play would be worth.
export function evaluatePlay(board, placements, isWord = null) {
  const result = { ok: false, error: '', invalid: [], words: [], across: true, name: '', score: 0, bingo: false };
  const fail = error => Object.assign(result, { error });

  if (!placements.length) return fail('Place some tiles first.');
  const fresh = new Map();
  for (const tile of placements) {
    if (board[tile.index] || fresh.has(tile.index)) return fail('That square is already taken.');
    fresh.set(tile.index, tile);
  }
  const tileAt = i => fresh.get(i) ?? board[i];
  const letterAt = i => tileAt(i)?.letter;

  const rows = new Set(placements.map(tile => row(tile.index)));
  const cols = new Set(placements.map(tile => col(tile.index)));
  if (rows.size > 1 && cols.size > 1) return fail('Tiles must go in one row or one column.');

  const first = !board.some(Boolean);
  if (first && !fresh.has(CENTER)) return fail('The first word must cover the centre star.');

  // A single tile runs whichever way it makes a word, across if both.
  const start = placements[0].index;
  const across =
    placements.length > 1
      ? rows.size === 1
      : wordCells(letterAt, start, true).length > 1 || wordCells(letterAt, start, false).length === 1;

  const main = wordCells(letterAt, start, across);
  if (placements.some(tile => !main.includes(tile.index))) return fail('Leave no gaps between your tiles.');
  if (main.length < 2) {
    return fail(first ? 'The first word needs at least two letters.' : 'Your word must join the tiles already on the board.');
  }

  const words = [scoreWord(main, fresh, tileAt)];
  for (const tile of placements) {
    const cross = wordCells(letterAt, tile.index, !across);
    if (cross.length > 1) words.push(scoreWord(cross, fresh, tileAt));
  }
  if (!first && words.length === 1 && main.length === placements.length) {
    return fail('Your word must join the tiles already on the board.');
  }

  const bingo = placements.length === RACK_SIZE;
  Object.assign(result, {
    words,
    across,
    name: playName(main[0], across),
    bingo,
    score: words.reduce((sum, word) => sum + word.score, 0) + (bingo ? BINGO : 0),
  });
  if (isWord) result.invalid = [...new Set(words.map(word => word.text).filter(text => !isWord(text)))];
  if (result.invalid.length) {
    const list = result.invalid.join(', ');
    return fail(result.invalid.length > 1 ? `Not in the word list: ${list}.` : `${list} is not in the word list.`);
  }
  result.ok = true;
  return result;
}
