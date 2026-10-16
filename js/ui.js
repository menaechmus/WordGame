// Everything the player sees and touches. The rules live in game.js and
// rules.js; this file draws the current game object and turns taps, drags
// and keys into actions.

import { TILES, VALUES, BLANK, isBlank, shuffle } from './tiles.js';
import { CENTER, PREMIUMS } from './board.js';
import { isWord, loadDictionary, WORD_LISTS } from './dictionary.js';
import { evaluatePlay } from './rules.js';
import { newGame, play, exchange, pass, arrange, canExchange } from './game.js';
import { setupInput } from './input.js';

// Shown in the About box. Bump both with every release: a browser still
// running a cached copy of this file then shows the old number.
const VERSION = '0.1.0';
const RELEASED = '15 October 2026';

const SETTINGS_KEY = 'wordgame.settings';
const GAME_KEY = 'wordgame.game';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LABELS = { TW: '3W', DW: '2W', TL: '3L', DL: '2L' };

const $ = id => document.getElementById(id);

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be switched off (private browsing); the game still plays.
  }
}

// Menu buttons carry their value as text: "true", "3", "hard".
function parseValue(text) {
  if (text === 'true' || text === 'false') return text === 'true';
  return /^\d+$/.test(text) ? Number(text) : text;
}

// Saved settings are only accepted if the menu offers that value.
function loadSettings() {
  const settings = { mode: 'local', difficulty: 'medium', players: 2, names: ['', '', '', ''], lookup: true };
  const saved = load(SETTINGS_KEY);
  for (const group of document.querySelectorAll('.choice')) {
    const key = group.dataset.setting;
    const offered = [...group.children].map(button => parseValue(button.dataset.value));
    if (offered.includes(saved?.[key])) settings[key] = saved[key];
  }
  if (Array.isArray(saved?.names)) {
    settings.names = settings.names.map((name, i) => (typeof saved.names[i] === 'string' ? saved.names[i].slice(0, 12) : name));
  }
  return settings;
}

// Player names are typed in, so they are escaped before going into the page.
const escapeHtml = text => text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const listText = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const settings = loadSettings();
let dict = null; // the word list, once it has loaded
let wordsFailed = false;
let game = null;
let pending = []; // tiles laid this turn: { index, id, letter }
let selected = null; // the rack tile picked up by a tap
let revealedTo = null; // between people: the seat whose tiles are showing
let messages = []; // what the last action did, in words
let notice = ''; // why the last press of Play was refused
let picking = null; // the square of a blank waiting for its letter
let swapping = new Set(); // tiles chosen in the swap dialog
let confirmed = null; // what the confirm dialog's button does
let resultsShown = true; // the game-over box, until put aside to look at the board

loadDictionary(WORD_LISTS.full).then(
  loaded => {
    dict = loaded;
    if (game) render();
  },
  () => {
    wordsFailed = true;
    if (game) render();
  },
);

const valid = word => isWord(dict, word);

// ---- Who is who ---------------------------------------------------------

const nameOf = seat => game.players[seat].name;
const isAi = seat => game.players[seat].ai;

// The seat whose rack is at the bottom of the screen: against the computer
// always the person, between people whoever's turn it is.
const viewer = () => (game.mode === 'ai' ? 0 : game.turn);

// People sharing one screen keep their tiles hidden until their owner asks.
const covered = () => game.mode !== 'ai' && game.phase === 'play' && revealedTo !== game.turn;
const canAct = () => game.phase === 'play' && !isAi(game.turn) && !covered();

// ---- Drawing ------------------------------------------------------------

function buildBoard() {
  $('board').innerHTML = PREMIUMS.map((kind, i) => {
    const classes = ['cell', kind.toLowerCase(), i === CENTER && 'star'].filter(Boolean).join(' ');
    const label = i === CENTER ? '★' : (LABELS[kind] ?? '');
    return `<div class="${classes}" data-index="${i}"><span class="label">${label}</span></div>`;
  }).join('');
}

// `letter` is the letter shown, which for a blank is the one chosen for it
// (or BLANK while it has none).
function tileHtml(id, letter, { tag = 'span', classes = '', attrs = '' } = {}) {
  const blank = isBlank(id);
  const face = letter === BLANK ? '' : letter;
  const value = blank ? '' : `<small>${VALUES[letter]}</small>`;
  const label = blank ? (face ? `blank, as ${face}` : 'blank') : `${letter}, ${VALUES[letter]}`;
  const names = ['tile', blank && 'blank', classes].filter(Boolean).join(' ');
  return `<${tag} class="${names}" data-id="${id}" aria-label="${label}"${attrs}>${face}${value}</${tag}>`;
}

// Tiles out on the board this turn are not on the rack.
function rackTiles(seat) {
  const laid = new Set(pending.map(tile => tile.id));
  return game.players[seat].rack.filter(id => !laid.has(id));
}

function drawScores() {
  $('scores').innerHTML = game.players
    .map((player, seat) => {
      const active = game.phase === 'play' && seat === game.turn;
      return `<div class="chip seat${seat}${active ? ' active' : ''}"><i></i><span class="name">${escapeHtml(player.name)}</span><b>${player.score}</b></div>`;
    })
    .join('');
  $('bag-count').textContent = game.bag.length;
}

// Each square is redrawn only when the tile on it changes, so a tile already
// on the board stays the same element from turn to turn.
function drawBoard(result) {
  const laid = new Map(pending.map(tile => [tile.index, tile]));
  const last = new Set(game.moves.findLast(move => move.type === 'play')?.tiles ?? []);
  const flagged = settings.lookup && dict && result?.invalid.length;
  const bad = new Set(flagged ? result.words.filter(word => result.invalid.includes(word.text)).flatMap(word => word.cells) : []);
  for (const cell of $('board').children) {
    const index = Number(cell.dataset.index);
    const tile = laid.get(index) ?? game.board[index];
    const key = tile ? `${tile.id}${tile.letter}` : '';
    if (cell.dataset.key !== key) {
      cell.dataset.key = key;
      cell.querySelector('.tile')?.remove();
      if (tile) cell.insertAdjacentHTML('beforeend', tileHtml(tile.id, tile.letter));
    }
    cell.classList.toggle('pending', laid.has(index));
    cell.classList.toggle('last', !laid.has(index) && last.has(index));
    cell.classList.toggle('bad', bad.has(index));
  }
}

function drawRack() {
  const seat = viewer();
  const hidden = covered() || isAi(seat);
  $('rack').innerHTML = rackTiles(seat)
    .map(id => (hidden ? '<span class="tile back"></span>' : tileHtml(id, TILES[id], { tag: 'button', classes: id === selected ? 'selected' : '' })))
    .join('');
}

function promptText(result) {
  if (game.phase === 'over') return ['', false];
  if (covered()) return [`Pass the device to ${nameOf(game.turn)}.`, false];
  if (isAi(game.turn)) return [`${nameOf(game.turn)} is thinking…`, false];
  if (notice) return [notice, true];
  if (!pending.length) {
    if (!game.board.some(Boolean)) return ['The first word must cover the centre star.', false];
    return [`${game.mode === 'ai' ? 'Your' : `${nameOf(game.turn)}, your`} turn. Tap a tile and then a square, or drag it.`, false];
  }
  if (!result.words.length) return [result.error, true];
  if (!dict) return [wordsFailed ? 'The word list did not load. Check the connection and reload.' : 'Loading the word list…', wordsFailed];
  if (settings.lookup && result.invalid.length) return [result.error, true];
  const bonus = result.bingo ? ', with 50 for using all seven' : '';
  return [`${listText(result.words.map(word => word.text))} for ${result.score}${bonus}.`, false];
}

function drawButtons(result) {
  const acting = canAct();
  const over = game.phase === 'over';
  const placed = pending.length > 0 && result.words.length > 0;
  const ready = placed && Boolean(dict) && !(settings.lookup && result.invalid.length);
  $('btn-play').textContent = over ? 'Results' : placed ? `Play ${result.score}` : 'Play';
  $('btn-play').disabled = over ? false : !(acting && ready);

  // One button: Shuffle while the rack is full, Recall once tiles are out.
  const recall = pending.length > 0;
  const shuffler = $('btn-shuffle');
  shuffler.dataset.mode = recall ? 'recall' : 'shuffle';
  shuffler.querySelector('span').textContent = recall ? 'Recall' : 'Shuffle';
  shuffler.disabled = recall ? !acting : over || covered() || isAi(viewer()) || rackTiles(viewer()).length < 2;
  $('btn-exchange').disabled = !acting || recall || !canExchange(game);
  $('btn-pass').disabled = !acting || recall;
}

function render() {
  const result = pending.length ? evaluatePlay(game.board, pending, settings.lookup && dict ? valid : null) : null;
  drawScores();
  drawBoard(result);
  drawRack();

  $('events').textContent = messages.join(' ');
  const [prompt, warn] = promptText(result);
  $('prompt').textContent = prompt;
  $('prompt').classList.toggle('warn', warn);
  drawButtons(result);

  $('rack-cover').hidden = !covered();
  if (covered()) $('btn-reveal').textContent = `Show ${nameOf(game.turn)}’s tiles`;

  $('gameover').hidden = game.phase !== 'over' || !resultsShown;
  if (game.phase === 'over') $('gameover-body').innerHTML = gameOverHtml();
}

const bestPlay = seat =>
  game.moves.filter(move => move.type === 'play' && move.player === seat).reduce((best, move) => (best && best.score >= move.score ? best : move), null);

function gameOverHtml() {
  const names = game.winners.map(seat => escapeHtml(nameOf(seat)));
  const title = names.length > 1 ? `${listText(names)} tie!` : names[0] === 'You' ? 'You win!' : `${names[0]} wins!`;
  const { out, adjustments } = game.ending;
  const how = out !== null ? `${escapeHtml(nameOf(out))} went out.` : `${3 * game.players.length} turns in a row without a score.`;
  const rows = game.players
    .map((player, seat) => {
      const best = bestPlay(seat);
      const left = adjustments[seat];
      return (
        `<tr><th>${escapeHtml(player.name)}${best ? `<div class="best">Best: ${best.word} ${best.score}</div>` : ''}</th>` +
        `<td>${left > 0 ? '+' : ''}${left}</td><td><b>${player.score}</b></td></tr>`
      );
    })
    .join('');
  return `
    <h2>${title}</h2>
    <p class="muted">${how}</p>
    <table class="grid">
      <thead><tr><th></th><th>Tiles left</th><th>Score</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <button class="btn primary" data-do="again">Play again</button>
    <div class="row">
      <button class="btn" data-do="board">See the board</button>
      <button class="btn" data-do="menu">Menu</button>
    </div>`;
}

// ---- Words for what happened --------------------------------------------

function startText({ first, rounds }) {
  const drew = rounds
    .at(-1)
    .map(({ player, id }) => `${nameOf(player)} drew ${isBlank(id) ? 'a blank' : TILES[id]}`)
    .join(', ');
  const goes = nameOf(first) === 'You' ? 'You go first.' : `${nameOf(first)} goes first.`;
  return `${drew}${rounds.length > 1 ? ' after a tie' : ''}. ${goes}`;
}

function playText({ player, result }) {
  const words = result.words.map(word => word.text);
  const named = words.length > 3 ? `${words[0]} and ${words.length - 1} more words` : listText(words);
  return `${nameOf(player)} played ${named} for ${result.score}.${result.bingo ? ' All seven tiles!' : ''}`;
}

function describe(events) {
  return events.map(event => {
    if (event.type === 'start') return startText(event);
    if (event.type === 'play') return playText(event);
    if (event.type === 'exchange') return `${nameOf(event.player)} swapped ${plural(event.count, 'tile')}.`;
    if (event.type === 'pass') return `${nameOf(event.player)} passed.`;
    if (event.type === 'end' && event.out !== null) return `${nameOf(event.out)} went out. Game over.`;
    return 'Game over.';
  });
}

// ---- Actions ------------------------------------------------------------

// Runs one game action, then saves and redraws. A refused action changes
// nothing in the game and says why.
function commit(action) {
  try {
    action();
  } catch (error) {
    notice = error.message;
    render();
    return;
  }
  pending = [];
  selected = null;
  notice = '';
  resultsShown = true;
  messages = describe(game.events);
  store(GAME_KEY, game.phase === 'over' ? null : game);
  render();
}

const isFree = index => !game.board[index] && !pending.some(tile => tile.index === index);

function placeTile(id, index) {
  if (!canAct() || !isFree(index)) return;
  const moving = pending.find(tile => tile.id === id);
  pending = pending.filter(tile => tile.id !== id);
  const letter = moving?.letter ?? TILES[id];
  pending.push({ index, id, letter });
  selected = null;
  notice = '';
  if (letter === BLANK) openPicker(index);
  render();
}

// Puts tile `id` at `position` among the tiles showing on the rack. Tiles
// still out on the board go to the end of the rack's order.
function moveInRack(id, position) {
  const seat = viewer();
  const showing = rackTiles(seat).filter(other => other !== id);
  showing.splice(position, 0, id);
  arrange(game, seat, [...showing, ...pending.map(tile => tile.id)]);
  if (game.phase === 'play') store(GAME_KEY, game);
}

function returnTile(index, position = null) {
  const tile = pending.find(laid => laid.index === index);
  if (!tile) return;
  pending = pending.filter(laid => laid !== tile);
  notice = '';
  if (position !== null) moveInRack(tile.id, position);
  render();
}

function recall() {
  pending = [];
  selected = null;
  notice = '';
  render();
}

function shuffleRack() {
  const seat = viewer();
  arrange(game, seat, [...shuffle(rackTiles(seat)), ...pending.map(tile => tile.id)]);
  selected = null;
  if (game.phase === 'play') store(GAME_KEY, game);
  render();
}

function onShuffle() {
  if (pending.length) recall();
  else shuffleRack();
}

function onPlay() {
  if (game.phase === 'over') {
    resultsShown = true;
    render();
    return;
  }
  if (!canAct() || !pending.length || !dict) return;
  const result = evaluatePlay(game.board, pending, valid);
  if (!result.ok) {
    notice = result.error;
    render();
    return;
  }
  const tiles = pending;
  commit(() => play(game, game.turn, tiles, valid));
}

function tapRack(id) {
  if (!canAct()) return;
  selected = selected === id ? null : id;
  notice = '';
  render();
}

function tapCell(index) {
  if (!canAct()) return;
  const tile = pending.find(laid => laid.index === index);
  if (tile) {
    if (isBlank(tile.id)) openPicker(index);
    else returnTile(index);
  } else if (selected !== null && isFree(index)) {
    placeTile(selected, index);
  }
}

function reveal() {
  revealedTo = game.turn;
  render();
}

// ---- Dialogs ------------------------------------------------------------

function openPicker(index) {
  picking = index;
  $('letters').innerHTML = [...LETTERS].map(letter => `<button class="tile blank" data-letter="${letter}">${letter}</button>`).join('');
  $('picker').hidden = false;
  $('letters').firstElementChild.focus({ preventScroll: true });
}

// Without a letter the blank goes back to the rack; a blank that already
// had one keeps it.
function closePicker(letter = null) {
  const tile = pending.find(laid => laid.index === picking);
  if (tile && letter) tile.letter = letter;
  else if (tile?.letter === BLANK) pending = pending.filter(laid => laid !== tile);
  picking = null;
  $('picker').hidden = true;
  render();
}

function drawSwap() {
  const rack = game.players[game.turn].rack;
  $('swap-tiles').innerHTML = rack
    .map(id => tileHtml(id, TILES[id], { tag: 'button', attrs: ` aria-pressed="${swapping.has(id)}"` }))
    .join('');
  $('btn-swap').textContent = swapping.size ? `Swap ${plural(swapping.size, 'tile')}` : 'Swap';
  $('btn-swap').disabled = !swapping.size;
}

function openSwap() {
  if (!canAct() || pending.length || !canExchange(game)) return;
  swapping = new Set();
  drawSwap();
  $('swap').hidden = false;
}

function ask(title, text, button, action) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('btn-confirm').textContent = button;
  confirmed = action;
  $('confirm').hidden = false;
}

function onPass() {
  if (!canAct() || pending.length) return;
  ask('Pass?', 'Your turn ends and you score nothing.', 'Pass', () => commit(() => pass(game, game.turn)));
}

const DIALOGS = ['picker', 'swap', 'confirm', 'rules', 'about'];
const dialogOpen = () => DIALOGS.some(id => !$(id).hidden);

// ---- Screens ------------------------------------------------------------

const input = setupInput({
  board: $('board'),
  rack: $('rack'),
  handlers: {
    canDrag: from => (from === 'board' ? canAct() : !covered() && !isAi(viewer()) && game.phase === 'play'),
    canDrop: (target, press) => {
      if (target.kind === 'rack') return true;
      return canAct() && (isFree(target.index) || target.index === press.index);
    },
    drop: (press, target) => {
      if (!target) return;
      if (target.kind === 'cell') {
        if (target.index !== press.index) placeTile(press.id, target.index);
      } else if (press.from === 'board') {
        returnTile(press.index, target.position);
      } else {
        moveInRack(press.id, target.position);
        render();
      }
    },
    tapRack,
    tapCell,
  },
});

function playersFor() {
  if (settings.mode === 'ai') return [{ name: 'You' }, { name: 'Computer', ai: true }];
  return settings.names.slice(0, settings.players).map((name, i) => ({ name: name.trim() || `Player ${i + 1}` }));
}

function showMenu() {
  input.cancel();
  for (const group of document.querySelectorAll('.choice')) {
    for (const button of group.children) {
      button.setAttribute('aria-pressed', parseValue(button.dataset.value) === settings[group.dataset.setting]);
    }
  }
  for (const field of document.querySelectorAll('[data-name]')) {
    const i = Number(field.dataset.name);
    field.hidden = i >= settings.players;
    field.value = settings.names[i];
  }

  const saved = load(GAME_KEY);
  const canResume = saved?.v === 1 && saved.phase === 'play';
  $('btn-resume').hidden = !canResume;
  if (canResume) $('btn-resume').textContent = `Resume game (${saved.players.map(player => player.score).join('–')})`;
  $('btn-new').classList.toggle('primary', !canResume);

  for (const id of ['table', 'gameover', ...DIALOGS]) $(id).hidden = true;
  $('menu').hidden = false;
}

function start(saved = null) {
  game = saved ?? newGame({ mode: settings.mode, difficulty: settings.difficulty, players: playersFor() });
  pending = [];
  selected = null;
  notice = '';
  revealedTo = null;
  resultsShown = true;
  messages = describe(game.events);
  buildBoard();
  $('menu').hidden = true;
  $('table').hidden = false;
  store(GAME_KEY, game);
  render();
}

// ---- Wiring -------------------------------------------------------------

$('menu').addEventListener('click', event => {
  const button = event.target.closest('.choice button');
  if (!button) return;
  settings[button.parentElement.dataset.setting] = parseValue(button.dataset.value);
  store(SETTINGS_KEY, settings);
  showMenu();
});

$('row-names').addEventListener('input', event => {
  settings.names[Number(event.target.dataset.name)] = event.target.value.slice(0, 12);
  store(SETTINGS_KEY, settings);
});

$('btn-new').addEventListener('click', () => start());
$('btn-resume').addEventListener('click', () => start(load(GAME_KEY)));
$('btn-rules').addEventListener('click', () => {
  $('rules').hidden = false;
});
$('about-version').textContent = `Version ${VERSION} · ${RELEASED}`;
$('btn-about').addEventListener('click', () => {
  $('about').hidden = false;
});

$('btn-menu').addEventListener('click', showMenu);
$('btn-play').addEventListener('click', onPlay);
$('btn-shuffle').addEventListener('click', onShuffle);
$('btn-exchange').addEventListener('click', openSwap);
$('btn-pass').addEventListener('click', onPass);
$('btn-reveal').addEventListener('click', reveal);

$('letters').addEventListener('click', event => {
  const button = event.target.closest('[data-letter]');
  if (button) closePicker(button.dataset.letter);
});
$('btn-unblank').addEventListener('click', () => {
  const tile = pending.find(laid => laid.index === picking);
  if (tile) tile.letter = BLANK;
  closePicker();
});

$('swap-tiles').addEventListener('click', event => {
  const button = event.target.closest('[data-id]');
  if (!button) return;
  const id = Number(button.dataset.id);
  if (swapping.has(id)) swapping.delete(id);
  else swapping.add(id);
  drawSwap();
});
$('btn-swap').addEventListener('click', () => {
  const ids = [...swapping];
  $('swap').hidden = true;
  commit(() => exchange(game, game.turn, ids));
});

$('btn-confirm').addEventListener('click', () => {
  $('confirm').hidden = true;
  const action = confirmed;
  confirmed = null;
  action?.();
});

$('gameover').addEventListener('click', event => {
  const action = event.target.dataset.do;
  if (action === 'again') start();
  else if (action === 'menu') showMenu();
  else if (action === 'board') {
    resultsShown = false;
    render();
  }
});

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => {
    button.closest('.overlay').hidden = true;
  });
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!$('picker').hidden) closePicker();
    else if (dialogOpen()) for (const id of DIALOGS) $(id).hidden = true;
    else if (game && !$('table').hidden && pending.length) recall();
    return;
  }
  if (event.target.matches('input') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!game || $('table').hidden || dialogOpen() || !$('gameover').hidden) return;
  if (event.key === 'Enter' && event.target !== $('btn-menu')) {
    event.preventDefault(); // Enter always plays, whichever button has focus
    if (covered()) reveal();
    else onPlay();
  }
});

showMenu();
