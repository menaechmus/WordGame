// The 15 by 15 board and its premium squares. Squares are numbered 0-224,
// row by row from the top left, so square 112 is the centre.

export const SIZE = 15;
export const CENTER = 112;
export const SQUARES = SIZE * SIZE;

// The top-left quarter of the board, centre row and column included. The
// whole board is this quarter reflected into the other three corners.
// T triple word, D double word, t triple letter, d double letter, * the centre
// star (a double word).
const QUARTER = [
  'T..d...T',
  '.D...t..',
  '..D...d.',
  'd..D...d',
  '....D...',
  '.t...t..',
  '..d...d.',
  'T..d...*',
];
const KINDS = { T: 'TW', D: 'DW', '*': 'DW', t: 'TL', d: 'DL', '.': '' };

export const row = index => Math.floor(index / SIZE);
export const col = index => index % SIZE;
export const at = (r, c) => r * SIZE + c;

const fold = n => Math.min(n, SIZE - 1 - n);

// 'TW', 'DW', 'TL', 'DL' or '' for every square.
export const PREMIUMS = Array.from({ length: SQUARES }, (_, i) => KINDS[QUARTER[fold(row(i))][fold(col(i))]]);
export const LETTER_MULT = PREMIUMS.map(kind => ({ TL: 3, DL: 2 })[kind] ?? 1);
export const WORD_MULT = PREMIUMS.map(kind => ({ TW: 3, DW: 2 })[kind] ?? 1);

const COLUMNS = 'ABCDEFGHIJKLMNO';

// Squares are named by column letter and row number, "H8" for the centre.
export const squareName = index => `${COLUMNS[col(index)]}${row(index) + 1}`;

// A play is named from its first square: row first when it runs across
// ("8D"), column first when it runs down ("D8").
export const playName = (index, across) =>
  across ? `${row(index) + 1}${COLUMNS[col(index)]}` : squareName(index);

export const emptyBoard = () => Array(SQUARES).fill(null);
