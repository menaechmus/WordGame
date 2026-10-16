// Turns, racks, the bag, exchanges, passes and the end of the game. No DOM
// here: the game is one plain object that survives JSON.stringify, changed
// only through the exported actions. Each action leaves a list of what
// happened in game.events.

import { TILES, RACK_SIZE, isBlank, newBag, shuffle, rackValue } from './tiles.js';
import { emptyBoard } from './board.js';
import { evaluatePlay } from './rules.js';

function check(ok, message) {
  if (!ok) throw new Error(message);
}

// Each player draws a tile and the one nearest the start of the alphabet
// goes first; a blank beats every letter. Players who tie draw again. The
// tiles go back in the bag afterwards, so each round draws from a fresh one.
function drawForFirst(count, random) {
  const rank = id => (isBlank(id) ? '' : TILES[id]); // '' sorts before 'A'
  let seats = [...Array(count).keys()];
  const rounds = [];
  while (seats.length > 1) {
    const bag = newBag(random);
    const round = seats.map((player, i) => ({ player, id: bag[i] }));
    rounds.push(round);
    const best = round.map(draw => rank(draw.id)).sort()[0];
    seats = round.filter(draw => rank(draw.id) === best).map(draw => draw.player);
  }
  return { first: seats[0], rounds };
}

// Tops a rack back up to seven, as far as the bag allows.
function refill(game, player) {
  const rack = game.players[player].rack;
  const drawn = game.bag.splice(Math.max(0, game.bag.length - (RACK_SIZE - rack.length)));
  rack.push(...drawn);
  return drawn;
}

// `players` is a list of { name, ai }. Tests pass a seeded `random`.
export function newGame({ mode = 'ai', difficulty = 'medium', players }, random = Math.random) {
  check(players.length >= 2 && players.length <= 4, 'A game needs two to four players');
  const { first, rounds } = drawForFirst(players.length, random);
  const game = {
    v: 1,
    mode,
    difficulty,
    players: players.map(({ name, ai = false }) => ({ name, ai, rack: [], score: 0, hints: 0 })),
    board: emptyBoard(),
    bag: newBag(random),
    turn: first,
    first,
    moves: [],
    scoreless: 0, // turns in a row without a point
    phase: 'play',
    ending: null,
    winners: [],
    events: [{ type: 'start', first, rounds }],
  };
  // Racks are filled in turn order, starting with whoever goes first.
  for (let k = 0; k < players.length; k++) refill(game, (first + k) % players.length);
  return game;
}

export const canExchange = game => game.bag.length >= RACK_SIZE;

function checkTurn(game, player) {
  check(game.phase === 'play' && game.turn === player, "Not this player's turn");
}

function checkTiles(game, player, ids) {
  const rack = game.players[player].rack;
  check(ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => rack.includes(id)), 'Those tiles are not on the rack');
}

function nextTurn(game) {
  game.turn = (game.turn + 1) % game.players.length;
}

// Three full rounds without a point end the game: six turns in a row
// between two players.
function scoreless(game) {
  game.scoreless++;
  if (game.scoreless >= 3 * game.players.length) finish(game, null);
  else nextTurn(game);
}

// The game ends when a player uses their last tile with the bag empty
// (`out` is that player), or after too many scoreless turns (`out` is null).
// Everyone loses the value of the tiles left on their rack, and a player
// who went out gains all of it.
function finish(game, out) {
  game.phase = 'over';
  const left = game.players.map(player => rackValue(player.rack));
  const adjustments = left.map(points => -points);
  if (out !== null) adjustments[out] = left.reduce((sum, points) => sum + points, 0);
  game.players.forEach((player, i) => {
    player.score += adjustments[i];
  });
  const best = Math.max(...game.players.map(player => player.score));
  game.winners = game.players.flatMap((player, i) => (player.score === best ? [i] : []));
  game.ending = { out, adjustments };
  game.events.push({ type: 'end', out, adjustments });
}

// `placements` are { index, id, letter } for each tile laid, `letter` being
// the letter chosen for a blank. `isWord` decides what is a word.
export function play(game, player, placements, isWord) {
  checkTurn(game, player);
  const ids = placements.map(tile => tile.id);
  checkTiles(game, player, ids);
  for (const { id, letter } of placements) {
    check(isBlank(id) ? /^[A-Z]$/.test(letter) : letter === TILES[id], 'Every blank needs a letter');
  }
  const result = evaluatePlay(game.board, placements, isWord);
  check(result.ok, result.error);

  game.events = [];
  const me = game.players[player];
  for (const { index, id, letter } of placements) game.board[index] = { id, letter };
  me.rack = me.rack.filter(id => !ids.includes(id));
  me.score += result.score;
  const drawn = refill(game, player);
  game.moves.push({
    player,
    type: 'play',
    name: result.name,
    word: result.words[0].text,
    words: result.words.map(word => ({ text: word.text, score: word.score })),
    tiles: placements.map(tile => tile.index),
    score: result.score,
    bingo: result.bingo,
  });
  game.events.push({ type: 'play', player, result, drawn });

  if (!me.rack.length) {
    finish(game, player);
  } else if (result.score) {
    game.scoreless = 0;
    nextTurn(game);
  } else {
    scoreless(game); // only blanks, laid on plain squares
  }
}

// Swaps tiles with the bag, which needs at least seven in it. The new tiles
// are drawn before the old ones go back.
export function exchange(game, player, ids, random = Math.random) {
  checkTurn(game, player);
  check(canExchange(game), 'The bag needs at least seven tiles to exchange');
  checkTiles(game, player, ids);
  game.events = [];
  const me = game.players[player];
  me.rack = me.rack.filter(id => !ids.includes(id));
  const drawn = refill(game, player);
  game.bag.push(...ids);
  shuffle(game.bag, random);
  game.moves.push({ player, type: 'exchange', count: ids.length });
  game.events.push({ type: 'exchange', player, count: ids.length, drawn });
  scoreless(game);
}

export function pass(game, player) {
  checkTurn(game, player);
  game.events = [{ type: 'pass', player }];
  game.moves.push({ player, type: 'pass' });
  scoreless(game);
}

// Puts a rack in the order its owner chose. Allowed at any time, even
// while someone else is thinking.
export function arrange(game, player, order) {
  const rack = game.players[player].rack;
  check(order.length === rack.length && new Set(order).size === order.length && order.every(id => rack.includes(id)), 'Not the same tiles');
  game.players[player].rack = [...order];
}

export function noteHint(game, player) {
  game.players[player].hints++;
}
