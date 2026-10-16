// The hundred tiles: how many of each letter and what each is worth. Every
// tile has a number, 0-99, so it can be followed from the bag to a rack to
// the board; TILES says which letter each number is.

export const BLANK = '?';
export const RACK_SIZE = 7;

// Letter, how many, points.
const SET = [
  ['A', 9, 1], ['B', 2, 3], ['C', 2, 3], ['D', 4, 2], ['E', 12, 1], ['F', 2, 4], ['G', 3, 2],
  ['H', 2, 4], ['I', 9, 1], ['J', 1, 8], ['K', 1, 5], ['L', 4, 1], ['M', 2, 3], ['N', 6, 1],
  ['O', 8, 1], ['P', 2, 3], ['Q', 1, 10], ['R', 6, 1], ['S', 4, 1], ['T', 6, 1], ['U', 4, 1],
  ['V', 2, 4], ['W', 2, 4], ['X', 1, 8], ['Y', 2, 4], ['Z', 1, 10], [BLANK, 2, 0],
];

export const VALUES = Object.fromEntries(SET.map(([letter, , value]) => [letter, value]));
export const COUNTS = Object.fromEntries(SET.map(([letter, count]) => [letter, count]));
export const TILES = SET.flatMap(([letter, count]) => Array(count).fill(letter));

export const isBlank = id => TILES[id] === BLANK;

// A blank is worth nothing, whatever letter it stands for.
export const tileValue = id => VALUES[TILES[id]];
export const rackValue = rack => rack.reduce((sum, id) => sum + tileValue(id), 0);

// Fisher-Yates, in place. Tests pass a seeded `random`.
export function shuffle(items, random = Math.random) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export const newBag = (random = Math.random) => shuffle(TILES.map((_, id) => id), random);
