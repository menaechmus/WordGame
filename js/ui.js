// Everything the player sees and touches. The rules live in game.js and
// rules.js; this file draws the current game object and turns taps, drags
// and keys into actions.

import { TILES, VALUES, BLANK, isBlank, shuffle } from './tiles.js';
import { SIZE, SQUARES, CENTER, PREMIUMS, row, col, squareName } from './board.js';
import { isWord, WORD_LISTS, DEFAULT_LIST } from './dictionary.js';
import { evaluatePlay } from './rules.js';
import { newGame, play, exchange, pass, arrange, canExchange, noteHint } from './game.js';
import { openRoom, joinRoom, cleanCode, CODE_LENGTH } from './net.js';
import { createHost, createGuest, cleanName, keepOrder, sameState, deniedText, MAX_PLAYERS, NAME_LENGTH } from './wifi.js';
import { setupInput } from './input.js';
import { startThinker, ask } from './thinker.js';
import { countPlay } from './animate.js';
import { startParty } from './celebrate.js';
import { playSound, setMuted, unlockSound } from './sound.js';
import { LEVELS, emptyStats, loadStats, recordGame } from './stats.js';

// Shown in the About box. Bump both with every release: a browser still
// running a cached copy of this file then shows the old number.
const VERSION = '1.5.0';
const RELEASED = '20 October 2026';

const AI_DELAY = 800; // the computer takes at least this long over a move
const CHEER_MS = 3500; // fireworks and confetti before the game-over box appears
const SETTINGS_KEY = 'wordgame.settings';
const GAME_KEY = 'wordgame.game';
const STATS_KEY = 'wordgame.stats';
const RECORDED_KEY = 'wordgame.recorded'; // the last Wi-Fi game in this phone's statistics
const WIFI_KEY = 'wordgame.wifi'; // per tab: this tab's part in a Wi-Fi game, for a reload
const TOKEN_KEY = 'wordgame.token'; // per tab: how the host knows this tab again
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LABELS = { TW: '3W', DW: '2W', TL: '3L', DL: '2L' };
const PREMIUM_NAMES = { TW: 'triple word', DW: 'double word', TL: 'triple letter', DL: 'double letter' };
const DOUBLE_TAP_MS = 320;
const HINTS_BEST = 5; // plays in the hints box until all are asked for
const HINTS_PAGE = 100; // then drawn this many at a time
const FIND_PAGE = 200; // words found, drawn this many at a time
const FIND_DELAY = 150; // the finder waits this long after typing stops

const $ = id => document.getElementById(id);

// ?store=NAME keeps this page's storage under keys of its own, so that the
// test driver's two frames can be two phones. `tab` storage (sessionStorage)
// lasts as long as the tab, through reloads.
const STORE = new URLSearchParams(location.search).get('store');
const keyed = key => (STORE ? `${key}:${STORE}` : key);

function load(key, tab = false) {
  try {
    return JSON.parse((tab ? sessionStorage : localStorage).getItem(keyed(key)));
  } catch {
    return null;
  }
}

function store(key, value, tab = false) {
  try {
    const place = tab ? sessionStorage : localStorage;
    if (value === null) place.removeItem(keyed(key));
    else place.setItem(keyed(key), JSON.stringify(value));
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
  const settings = { mode: 'ai', difficulty: 'medium', players: 2, names: ['', '', '', ''], wifiName: '', hints: true, lookup: true, sound: true };
  const saved = load(SETTINGS_KEY);
  for (const group of document.querySelectorAll('.choice[data-setting]')) {
    const key = group.dataset.setting;
    const offered = [...group.children].map(button => parseValue(button.dataset.value));
    if (offered.includes(saved?.[key])) settings[key] = saved[key];
  }
  if (Array.isArray(saved?.names)) {
    settings.names = settings.names.map((name, i) => (typeof saved.names[i] === 'string' ? saved.names[i].slice(0, 12) : name));
  }
  if (typeof saved?.wifiName === 'string') settings.wifiName = saved.wifiName.slice(0, NAME_LENGTH);
  settings.wordList = Object.hasOwn(WORD_LISTS, saved?.wordList ?? '') ? saved.wordList : DEFAULT_LIST;
  return settings;
}

// Player names are typed in, so they are escaped before going into the page.
const escapeHtml = text => text.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const listText = items => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const settings = loadSettings();
const stats = loadStats(load(STATS_KEY));
let resetArmed = false;
let dict = null; // the word list in use, once it has loaded
let dictKey = null; // which one: the game's list in a game, the menu's on the menu
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
let aiTimer = 0;
let thinking = 0; // the computer's question in flight; 0 when there is none
let questions = 0;
let shownHints = []; // every play for the rack, best first, from the worker
let listedHints = []; // the plays in the hints box now, in its order
let hintsAll = false; // every play listed, rather than the best five
let hintsSort = 'score';
let hintsDrawn = 0; // how much of the whole list is drawn so far
let wordsTab = 'check'; // the Words box's tab, kept between openings
let found = { words: [], sorted: [], total: 0 }; // the word finder's answer
let findSort = 'az';
let findDrawn = 0;
let findAsked = 0; // the finder's latest question
let findTimer = 0;
let counting = null; // while a play is counted out: { held, text, run }
let skipClick = false; // the tap that skipped a count should do nothing else
let drawn = new Set(); // tiles just drawn onto the rack, to slide in
let celebrating = 0; // timer while a win is celebrated and the game-over box waits
let party = null; // the fireworks and confetti, which outlast the celebration a little
let cursor = null; // the keyboard's typing cursor: { index, across }
let typed = []; // squares filled by typing, newest last, for Backspace
let lastTap = { index: -1, time: 0 }; // for telling a double-tap on the board
// A Wi-Fi game (see the section of that name below).
let session = null; // this phone's part: { role: 'host', host, room, code, trouble } or { role: 'guest', guest, code, players }
let me = 0; // this phone's seat in it
let away = []; // seats whose phones are out of touch
let sent = false; // a guest's move is with the host, and not yet answered
let inbox = []; // moves and states that came while a play was counted out
let wifiBox = null; // what the Wi-Fi box shows: 'host', 'join' or 'ended'
let wifiNote = { text: '', warn: false }; // its status line
let waitingCode = ''; // a shared link's code, while the name is still to type

setMuted(!settings.sound);

// The word lists come from the worker, which also does the computer's
// thinking and keeps each list once loaded. The page holds the one in use:
// a game's own list during the game, the menu's choice on the menu.
startThinker();

function useWords(key) {
  if (dictKey === key) return;
  dictKey = key;
  dict = null;
  wordsFailed = false;
  delete document.body.dataset.words; // for the test driver
  ask({ type: 'words', list: key }).then(
    loaded => {
      if (dictKey !== key) return;
      dict = loaded;
      document.body.dataset.words = 'ready';
      wordsArrived();
    },
    () => {
      if (dictKey !== key) return;
      wordsFailed = true;
      document.body.dataset.words = 'failed';
      wordsArrived();
    },
  );
}

function wordsArrived() {
  if (game && !$('table').hidden) render();
  if (!$('lookup').hidden) showTab(wordsTab);
}

useWords(settings.wordList);

const valid = word => isWord(dict, word);

// ---- Who is who ---------------------------------------------------------

const nameOf = seat => game.players[seat].name;
const isAi = seat => game.players[seat].ai;
const wifiGame = () => game?.mode === 'net';
const isHost = () => wifiGame() && session?.role === 'host';
const isGuest = () => wifiGame() && session?.role === 'guest';

// In a Wi-Fi game each phone calls its own player "You".
const who = seat => (wifiGame() && seat === me ? 'You' : nameOf(seat));

// The seat whose rack is at the bottom of the screen: against the computer
// always the person, on Wi-Fi this phone's player, between people on one
// device whoever's turn it is.
const viewer = () => (game.mode === 'ai' ? 0 : wifiGame() ? me : game.turn);

// People sharing one screen keep their tiles hidden until their owner asks.
const covered = () => game.mode === 'local' && game.phase === 'play' && revealedTo !== game.turn;

// A guest whose link to the host has gone can only wait for it to come back.
const linkDown = () => isGuest() && !session.guest.connected;
const canAct = () =>
  game.phase === 'play' && !isAi(game.turn) && !covered() && !counting && (!wifiGame() || (game.turn === me && !sent && !linkDown()));

// Hints and Word check: in a Wi-Fi game the host's choice, for everyone;
// otherwise the menu's.
const rule = key => (wifiGame() && game.rules ? game.rules[key] : settings[key]);

// The host may pass for a player whose phone is out of touch on their turn.
const passingFor = () => isHost() && game.phase === 'play' && game.turn !== me && Boolean(away[game.turn]) && !counting;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Drawing ------------------------------------------------------------

function buildBoard() {
  $('board').innerHTML = PREMIUMS.map((kind, i) => {
    const classes = ['cell', kind.toLowerCase(), i === CENTER && 'star'].filter(Boolean).join(' ');
    const label = i === CENTER ? '★' : (LABELS[kind] ?? '');
    return `<div class="${classes}" data-index="${i}" role="img" aria-label="${squareLabel(i, null)}"><span class="label" aria-hidden="true">${label}</span></div>`;
  }).join('');
}

// What a screen reader says for a square: "H8, double word" or "H8, Q".
function squareLabel(index, tile) {
  if (tile) return `${squareName(index)}, ${tile.letter === BLANK ? 'blank' : tile.letter}${isBlank(tile.id) && tile.letter !== BLANK ? ' (blank)' : ''}`;
  const kind = PREMIUM_NAMES[PREMIUMS[index]];
  return `${squareName(index)}${index === CENTER ? ', centre star' : ''}${kind ? `, ${kind}` : ''}`;
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

// While a play is counted out, the scores wait at what they were before it.
// Each chip also shows how many tiles that player holds; once the bag is
// empty those counts turn gold, as they decide when to go out.
function drawScores() {
  const scores = counting ? counting.held : game.players.map(player => player.score);
  $('scores').innerHTML = game.players
    .map((player, seat) => {
      const active = game.phase === 'play' && seat === game.turn;
      const held = player.rack.length;
      const tiles = `<span class="held" title="${plural(held, 'tile')} on the rack"><span class="sr-only">holding </span>${held}<span class="sr-only"> ${held === 1 ? 'tile' : 'tiles'}</span></span>`;
      // A Wi-Fi player whose phone is out of touch is dimmed.
      const gone = wifiGame() && (Boolean(away[seat]) || (seat === 0 && linkDown()));
      const name = `${escapeHtml(player.name)}${gone ? '<span class="sr-only">, out of touch</span>' : ''}`;
      return `<div class="chip seat${seat}${active ? ' active' : ''}${gone ? ' away' : ''}"><i></i><span class="name">${name}</span><b>${scores[seat]}</b>${tiles}</div>`;
    })
    .join('');
  $('scores').classList.toggle('many', game.players.length > 2);
  $('scores').classList.toggle('endgame', game.bag.length === 0);
  $('bag-count').textContent = game.bag.length;
}

// After a count, the new scores tick up to their totals.
function countUp(from) {
  if (reducedMotion()) return;
  const began = performance.now();
  const chips = [...$('scores').querySelectorAll('.chip b')];
  const tick = now => {
    const t = Math.min(1, (now - began) / 450);
    game.players.forEach((player, seat) => {
      if (chips[seat]?.isConnected) chips[seat].textContent = Math.round(from[seat] + (player.score - from[seat]) * t);
    });
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Each square is redrawn only when the tile on it changes, so a tile already
// on the board stays the same element from turn to turn.
function drawBoard(result) {
  const laid = new Map(pending.map(tile => [tile.index, tile]));
  const last = new Set(game.moves.findLast(move => move.type === 'play')?.tiles ?? []);
  const flagged = rule('lookup') && dict && result?.invalid.length;
  const bad = new Set(flagged ? result.words.filter(word => result.invalid.includes(word.text)).flatMap(word => word.cells) : []);
  for (const cell of $('board').children) {
    const index = Number(cell.dataset.index);
    const tile = laid.get(index) ?? game.board[index];
    const key = tile ? `${tile.id}${tile.letter}` : '';
    if (cell.dataset.key !== key) {
      cell.dataset.key = key;
      cell.querySelector('.tile')?.remove();
      if (tile) cell.insertAdjacentHTML('beforeend', tileHtml(tile.id, tile.letter));
      cell.setAttribute('aria-label', squareLabel(index, tile));
    }
    cell.classList.toggle('pending', laid.has(index));
    cell.classList.toggle('last', !laid.has(index) && last.has(index));
    cell.classList.toggle('bad', bad.has(index));
    const here = cursor?.index === index && canAct();
    cell.classList.toggle('cursor', here);
    if (here) cell.dataset.dir = cursor.across ? 'across' : 'down';
  }
}

// Tiles just drawn from the bag slide in from below, one after another.
function drawRack() {
  const seat = viewer();
  const hidden = covered() || isAi(seat);
  let arriving = 0;
  $('rack').innerHTML = rackTiles(seat)
    .map(id => {
      if (hidden) return '<span class="tile back"></span>';
      const classes = [id === selected && 'selected', drawn.has(id) && 'drawn'].filter(Boolean).join(' ');
      return tileHtml(id, TILES[id], { tag: 'button', classes, attrs: drawn.has(id) ? ` style="--i: ${arriving++}"` : '' });
    })
    .join('');
}

function promptText(result) {
  if (counting) return [counting.text, false];
  if (game.phase === 'over') return ['', false];
  if (covered()) return [`Pass the device to ${nameOf(game.turn)}.`, false];
  if (isAi(game.turn)) return [`${nameOf(game.turn)} is thinking…`, false];
  if (wifiGame()) {
    const turn = nameOf(game.turn);
    if (linkDown()) return [`Lost touch with ${nameOf(0)}’s phone. Trying again…`, true];
    if (sent) return ['Sent. Waiting for the host…', false];
    if (isHost() && !session.room && game.turn !== me) {
      return session.trouble ? [`${session.trouble} Trying again…`, true] : ['Opening the game to the other phones…', false];
    }
    if (passingFor()) return [`${turn}’s phone is out of touch. Wait for it, or press Pass to pass for ${turn}.`, true];
    if (game.turn !== me) return [away[game.turn] ? `${turn}’s turn, but ${turn}’s phone is out of touch.` : `${turn}’s turn.`, false];
  }
  if (notice) return [notice, true];
  if (!pending.length) {
    if (!game.board.some(Boolean)) return ['The first word must cover the centre star.', false];
    return [`${game.mode === 'local' ? `${nameOf(game.turn)}, your` : 'Your'} turn. Tap a tile and then a square, or drag it.`, false];
  }
  if (!result.words.length) return [result.error, true];
  if (!dict) return [wordsFailed ? 'The word list did not load. Check the connection and reload.' : 'Loading the word list…', wordsFailed];
  if (rule('lookup') && result.invalid.length) return [result.error, true];
  const bonus = result.bingo ? ', with 50 for using all seven' : '';
  return [`${listText(result.words.map(word => word.text))} for ${result.score}${bonus}.`, false];
}

function drawButtons(result) {
  const acting = canAct();
  const over = game.phase === 'over';
  const placed = pending.length > 0 && result.words.length > 0;
  const ready = placed && Boolean(dict) && !(rule('lookup') && result.invalid.length);
  $('btn-play').textContent = over ? 'Results' : placed ? `Play ${result.score}` : 'Play';
  $('btn-play').disabled = over ? false : !(acting && ready);

  // One button: Shuffle while the rack is full, Recall once tiles are out.
  const recall = pending.length > 0;
  const shuffler = $('btn-shuffle');
  shuffler.dataset.mode = recall ? 'recall' : 'shuffle';
  shuffler.querySelector('span').textContent = recall ? 'Recall' : 'Shuffle';
  shuffler.disabled = recall ? !acting : over || covered() || isAi(viewer()) || rackTiles(viewer()).length < 2;
  $('btn-exchange').disabled = !acting || recall || !canExchange(game);
  $('btn-pass').disabled = passingFor() ? false : !acting || recall;
  $('btn-hint').hidden = !rule('hints');
  $('btn-hint').disabled = !acting;
  $('btn-lookup').hidden = !rule('lookup');
  $('btn-short').hidden = !rule('lookup');
  $('btn-sound').setAttribute('aria-pressed', settings.sound);
}

// The speaker button and the menu's Sound row are the same setting.
function toggleSound() {
  settings.sound = !settings.sound;
  store(SETTINGS_KEY, settings);
  setMuted(!settings.sound);
  unlockSound();
  playSound('place'); // heard only when sound has just come back on
  $('btn-sound').setAttribute('aria-pressed', settings.sound);
}

function render() {
  const result = pending.length ? evaluatePlay(game.board, pending, rule('lookup') && dict ? valid : null) : null;
  drawScores();
  drawBoard(result);
  drawRack();

  $('events').textContent = messages.slice(0, messages.length - (counting?.said ?? 0)).join(' ');
  const [prompt, warn] = promptText(result);
  $('prompt').textContent = prompt;
  $('prompt').classList.toggle('warn', warn);
  drawButtons(result);

  $('btn-moves').hidden = !game.moves.length;
  $('rack-cover').hidden = !covered();
  if (covered()) $('btn-reveal').textContent = `Show ${nameOf(game.turn)}’s tiles`;

  // A game won on a play is announced once the play has been counted, and a
  // person's win once it has been celebrated.
  $('gameover').hidden = game.phase !== 'over' || !resultsShown || Boolean(counting);
  $('gameover').classList.toggle('party', Boolean(celebrating));
  if (game.phase === 'over') $('gameover-body').innerHTML = gameOverHtml();
}

const bestPlay = seat =>
  game.moves.filter(move => move.type === 'play' && move.player === seat).reduce((best, move) => (best && best.score >= move.score ? best : move), null);

function gameOverHtml() {
  // "You" comes first in a tie: "You and Ann tie!"
  const names = game.winners.map(seat => escapeHtml(who(seat))).sort((a, b) => (b === 'You') - (a === 'You'));
  const title = names.length > 1 ? `${listText(names)} tie!` : names[0] === 'You' ? 'You win!' : `${names[0]} wins!`;
  const { out, adjustments } = game.ending;
  const how = out !== null ? `${escapeHtml(who(out))} went out.` : `${3 * game.players.length} turns in a row without a score.`;
  // Only the host of a Wi-Fi game can start the next one.
  const again = isGuest()
    ? `<p class="muted">Waiting for ${escapeHtml(nameOf(0))} to start another game.</p>`
    : '<button class="btn primary" data-do="again">Play again</button>';
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
    ${again}
    <div class="row">
      <button class="btn" data-do="stats">Statistics</button>
      <button class="btn" data-do="moves">Moves</button>
    </div>
    <div class="row">
      <button class="btn" data-do="board">See the board</button>
      <button class="btn" data-do="menu">Menu</button>
    </div>`;
}

const dot = seat => `<i class="dot seat${seat}"></i>`;
const signed = n => (n > 0 ? `+${n}` : `${n}`);

// Every turn so far, with each player's running total, and at the end what
// the tiles left on the racks cost or brought.
function movesHtml() {
  const totals = game.players.map(() => 0);
  const rows = game.moves.map(move => {
    let what;
    if (move.type === 'play') {
      totals[move.player] += move.score;
      const more = move.words.length > 1 ? ` <span class="muted">+${move.words.length - 1}</span>` : '';
      what = `${move.word}${more} <span class="muted">${move.name}</span>${move.bingo ? ' <span class="bingo-mark" title="All seven tiles">★</span>' : ''}`;
    } else {
      what = `<span class="muted">${move.type === 'exchange' ? `Swapped ${move.count}` : 'Passed'}</span>`;
    }
    return `<tr><th>${dot(move.player)}${escapeHtml(nameOf(move.player))}</th><td>${what}</td><td>${move.score ?? ''}</td><td class="muted">${totals[move.player]}</td></tr>`;
  });
  if (game.ending) {
    game.players.forEach((player, seat) => {
      rows.push(`<tr class="end"><th>${dot(seat)}${escapeHtml(player.name)}</th><td class="muted">Tiles left</td><td>${signed(game.ending.adjustments[seat])}</td><td><b>${player.score}</b></td></tr>`);
    });
  }
  if (!rows.length) return '<p class="muted">No moves yet.</p>';
  return `<table class="grid moves"><thead><tr><th></th><th>Play</th><th>Score</th><th>Total</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function showMoves() {
  $('moves-body').innerHTML = movesHtml();
  $('moves').hidden = false;
  $('moves-body').scrollTop = $('moves-body').scrollHeight;
}

const capital = text => text[0].toUpperCase() + text.slice(1);
const shortDate = date => (date ? new Date(`${date}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

function statsHtml() {
  const percent = (part, whole) => (whole ? `${Math.round((100 * part) / whole)}%` : '–');
  const average = (points, count) => (count ? Math.round(points / count) : '–');
  const levelRows = LEVELS.map(level => {
    const row = stats.ai[level];
    return `<tr><th>${capital(level)}</th><td>${row.games}</td><td>${row.wins}</td><td>${percent(row.wins, row.games)}</td><td>${average(row.points, row.games)}</td><td>${row.bestGame || '–'}</td></tr>`;
  }).join('');
  const most = key => LEVELS.reduce((best, level) => (stats.ai[level][key] > (best ? stats.ai[best][key] : 0) ? level : best), null);
  const streakLevel = most('bestStreak');
  const marginLevel = most('bestMargin');
  const streaks = LEVELS.filter(level => stats.ai[level].streak).map(level => `${capital(level)} ${stats.ai[level].streak}`);

  const { records, totals } = stats;
  const who = record => (record.name ? ` <span class="muted">${escapeHtml(record.name)}, ${shortDate(record.date)}</span>` : '');
  const facts = [
    ['Best play', records.bestPlay.score ? `${records.bestPlay.word} ${records.bestPlay.score}${who(records.bestPlay)}` : '–'],
    ['Best game', records.bestGame.score ? `${records.bestGame.score}${who(records.bestGame)}` : '–'],
    ['Longest word', records.longestWord.word ? `${records.longestWord.word}${who(records.longestWord)}` : '–'],
    ['Most all-seven plays in a game', records.mostBingos.count ? `${records.mostBingos.count}${who(records.mostBingos)}` : '–'],
    ['Winning streak now', streaks.length ? streaks.join(', ') : '–'],
    ['Longest winning streak', streakLevel ? `${stats.ai[streakLevel].bestStreak} <span class="muted">${capital(streakLevel)}</span>` : '–'],
    ['Biggest win', marginLevel ? `by ${stats.ai[marginLevel].bestMargin} <span class="muted">${capital(marginLevel)}</span>` : '–'],
    ['Games finished', totals.games],
    ['Points per play', average(totals.points, totals.plays)],
    ['Plays using all seven', totals.bingos],
    ['Hints used', totals.hints],
    ['Swaps', totals.swaps],
  ];
  const people = Object.values(stats.people).sort((a, b) => b.games - a.games);
  const peopleRows = people.map(person => `<tr><th>${escapeHtml(person.name)}</th><td>${person.games}</td><td>${person.wins}</td><td>${person.bestGame}</td></tr>`).join('');
  const recent = stats.recent
    .map(entry => {
      const players = entry.players.map((player, seat) => {
        const text = `${escapeHtml(player.name)} ${player.score}`;
        return entry.winners.includes(seat) ? `<b>${text}</b>` : text;
      });
      const kind = entry.mode === 'ai' ? capital(entry.difficulty || 'medium') : entry.mode === 'net' ? 'Wi-Fi' : 'People';
      return `<li><span class="muted">${shortDate(entry.date)}</span> ${players.join(', ')} <span class="muted">${kind}</span></li>`;
    })
    .join('');
  return `
    <h3>Against the computer</h3>
    <table class="grid">
      <thead><tr><th></th><th>Played</th><th>Won</th><th>Win&nbsp;%</th><th>Average</th><th>Best</th></tr></thead>
      <tbody>${levelRows}</tbody>
    </table>
    ${people.length ? `<h3>Between people</h3><table class="grid"><thead><tr><th></th><th>Played</th><th>Won</th><th>Best</th></tr></thead><tbody>${peopleRows}</tbody></table>` : ''}
    <h3>Records</h3>
    <dl class="facts">${facts.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('')}</dl>
    <h3>Recent games</h3>
    ${recent ? `<ol class="recent">${recent}</ol>` : '<p class="muted">No games finished yet.</p>'}
    <p class="muted">Finished games are saved in this browser, on this device.</p>`;
}

function showStats() {
  resetArmed = false;
  $('btn-reset').textContent = 'Reset statistics';
  $('stats-body').innerHTML = statsHtml();
  $('stats').hidden = false;
}

// ---- Words for what happened --------------------------------------------

function startText({ first, rounds }) {
  const drew = rounds
    .at(-1)
    .map(({ player, id }) => `${who(player)} drew ${isBlank(id) ? 'a blank' : TILES[id]}`)
    .join(', ');
  const goes = who(first) === 'You' ? 'You go first.' : `${who(first)} goes first.`;
  return `${drew}${rounds.length > 1 ? ' after a tie' : ''}. ${goes}`;
}

function playText({ player, result }) {
  const words = result.words.map(word => word.text);
  const named = words.length > 3 ? `${words[0]} and ${words.length - 1} more words` : listText(words);
  return `${who(player)} played ${named} for ${result.score}.${result.bingo ? ' All seven tiles!' : ''}`;
}

function describe(events) {
  return events.map(event => {
    if (event.type === 'start') return startText(event);
    if (event.type === 'play') return playText(event);
    if (event.type === 'exchange') return `${who(event.player)} swapped ${plural(event.count, 'tile')}.`;
    if (event.type === 'pass') return `${who(event.player)} passed.`;
    if (event.type === 'end' && event.out !== null) return `${who(event.out)} went out. Game over.`;
    return 'Game over.';
  });
}

// ---- Actions ------------------------------------------------------------

// Runs one game action, then everything that follows it (settle). A refused
// action changes nothing in the game and says why. The computer's moves are
// added to what was said before (`append`), so a person's own play is still
// there to read.
function commit(action, append = false) {
  const held = game.players.map(player => player.score);
  try {
    action();
  } catch (error) {
    notice = error.message;
    render();
    return;
  }
  settle(held, append);
}

// Everything that follows a change to the game, made here or, on a guest's
// phone in a Wi-Fi game, by the host: what it says, saving, statistics,
// sending it to the other phones, sounds, the count and the next turn.
// `held` are the scores from before it.
function settle(held, append = false) {
  pending = [];
  typed = [];
  cursor = null;
  selected = null;
  notice = '';
  resultsShown = true;
  messages = append ? [...messages, ...describe(game.events)] : describe(game.events);
  if (!isGuest()) store(GAME_KEY, game.phase === 'over' ? null : game);
  if (game.phase === 'over') record();
  if (isHost()) session.host.share(game);

  // New tiles slide onto the rack of whoever is looking at it.
  const refilled = game.events.find(event => event.drawn?.length);
  drawn = refilled && refilled.player === viewer() && !covered() && !reducedMotion() ? new Set(refilled.drawn) : new Set();
  if (game.events.some(event => event.type === 'exchange')) playSound('swap');
  if (drawn.size) playSound('draw', 0.15);

  const played = game.events.find(event => event.type === 'play');
  // What this action says waits for the count, which tells the total itself.
  const said = describe(game.events).length;
  if (played && !reducedMotion()) counting = { held, text: played.result.words[0].text, skipped: false, said };
  if (!counting) celebrate(); // before the redraw that shows the end
  render();
  if (played) showSquares(played.result.words[0].cells); // a zoomed board shows the play
  drawn = new Set();
  if (counting) countOut(played);
  else afterTurn(played);
}

// A finished game counts once in this phone's statistics, though the last
// state of a Wi-Fi game can reach a phone more than once.
function record() {
  if (wifiGame()) {
    if (load(RECORDED_KEY) === game.id) return;
    store(RECORDED_KEY, game.id);
  }
  recordGame(stats, game, undefined, wifiGame() ? me : null);
  store(STATS_KEY, stats);
}

// Saves the game in progress after its racks change. A guest's phone keeps
// no copy of a Wi-Fi game: the host has it.
function saveGame() {
  if (game.phase === 'play' && !isGuest()) store(GAME_KEY, game);
}

// Counts a play out on the board, with the running total in the prompt.
// The computer's tiles drop in first.
function countOut(played) {
  const finished = []; // words already counted, with their scores
  const show = text => {
    counting.text = [...finished, text].filter(Boolean).join(' · ');
    $('prompt').textContent = counting.text;
    $('prompt').classList.remove('warn');
  };
  const run = countPlay({
    board: $('board'),
    result: played.result,
    dropped: isAi(played.player) || (wifiGame() && played.player !== me),
    onStep: step => {
      if (step.kind === 'drop') playSound('place');
      else if (step.kind === 'letter') {
        playSound(step.premium ? 'bonus' : 'tick', 0, step.i);
        show(`${step.word} ${step.sum}`);
      } else if (step.kind === 'word') {
        playSound('word');
        show(`${step.word} ${step.sum} × ${step.mult} = ${step.score}`);
      } else if (step.kind === 'scored') {
        finished.push(`${step.word} ${step.score}`);
        show('');
      } else if (step.kind === 'bingo') {
        playSound('bingo');
        show('+50 for all seven!');
      }
    },
  });
  counting.run = run;
  run.done.then(() => {
    if (counting?.run !== run) return;
    const { held, skipped } = counting;
    counting = null;
    celebrate();
    render();
    if (!skipped) countUp(held);
    afterTurn(played);
  });
}

// Also called early, when a tap or a key skips the count: the score then
// lands at once.
function skipCount() {
  if (!counting) return;
  counting.skipped = true;
  counting.run?.skip();
}

// The fanfare for a person's win; a sadder sound when the computer wins
// alone, or on the losers' phones in a Wi-Fi game; nothing for a tie with
// the computer. In a Wi-Fi game a chime says it is this phone's turn. Then
// whatever came in during the count.
function afterTurn(played) {
  if (game.phase === 'over') {
    const lost = wifiGame() ? !personWon() : game.winners.length === 1 && isAi(game.winners[0]);
    if (personWon()) playSound('win', played ? 0.2 : 0);
    else if (lost) playSound('lose', played ? 0.2 : 0);
  } else if (wifiGame() && game.turn === me) {
    alertTurn();
  }
  scheduleAi();
  drainInbox();
}

// A game won by a person, or shared only between people. In a Wi-Fi game,
// one won (or shared) by this phone's player.
const personWon = () => (wifiGame() ? game.winners.includes(me) : game.winners.length > 0 && game.winners.every(seat => !isAi(seat)));

// A person's win is celebrated before the game-over box appears: fireworks
// and confetti, a pop for each firework, while the fanfare plays. A win for
// the computer goes straight to the box. Called just before the redraw that
// shows the end.
function celebrate() {
  if (game.phase !== 'over' || !personWon() || reducedMotion()) return;
  party = startParty($('party'), () => playSound('firework'));
  celebrating = setTimeout(() => endCelebration(), CHEER_MS);
}

// Shows the game-over box. Also called early, when a tap or key skips the
// celebration; then the fireworks stop too, instead of falling behind it.
function endCelebration(skipped = false) {
  if (!celebrating) return;
  clearTimeout(celebrating);
  celebrating = 0;
  if (skipped) stopParty();
  render();
}

function stopParty() {
  clearTimeout(celebrating);
  celebrating = 0;
  party?.stop();
  party = null;
}

// The computer's turn: its question goes to the worker at once, and the
// answer is played no sooner than AI_DELAY after, so a move never flashes
// past. Leaving the game drops the question.
function scheduleAi() {
  clearTimeout(aiTimer);
  thinking = 0;
  if (!game || game.phase !== 'play' || !isAi(game.turn)) return;
  const question = (thinking = ++questions);
  const seat = game.turn;
  const asked = performance.now();
  const answered = choice => {
    if (thinking !== question) return;
    aiTimer = setTimeout(() => {
      if (thinking !== question) return;
      thinking = 0;
      commit(() => {
        try {
          if (choice.type === 'play') play(game, seat, choice.tiles, valid);
          else if (choice.type === 'exchange') exchange(game, seat, choice.ids);
          else pass(game, seat);
        } catch {
          pass(game, seat); // never expected, but the game must go on
        }
      }, true);
    }, Math.max(0, AI_DELAY - (performance.now() - asked)));
  };
  ask({ type: 'move', list: dictKey, board: game.board, rack: game.players[seat].rack, bag: game.bag.length, level: game.difficulty }).then(
    answered,
    () => answered({ type: 'pass' }),
  );
}

function stopAi() {
  clearTimeout(aiTimer);
  thinking = 0;
}

// Hints: every play for the rack, best first, from the worker. The box shows
// the best five, and the rest on request. Asking counts as using a hint,
// once the answer is shown.
async function onHint() {
  if (!canAct() || !rule('hints')) return;
  const [asked, seat] = [game, game.turn];
  hintsAll = false;
  setPressed($('hints-sort'), 'sort', (hintsSort = 'score'));
  $('hints-title').textContent = 'Best plays';
  $('hints-text').textContent = 'Looking for plays…';
  $('hints-list').innerHTML = '';
  $('hints-list').classList.remove('all');
  $('hints-sort').hidden = true;
  $('btn-all-plays').hidden = true;
  $('hints').hidden = false;
  try {
    shownHints = await ask({ type: 'hints', list: dictKey, board: game.board, rack: game.players[seat].rack });
  } catch {
    $('hints-text').textContent = 'No hints just now. Try again in a moment.';
    return;
  }
  if ($('hints').hidden || game !== asked || game.turn !== seat) return;
  noteHint(game, seat);
  if (isGuest()) session.guest.send({ t: 'hint' });
  else saveGame();
  if (!shownHints.length) {
    $('hints-text').textContent = canExchange(game) ? 'No play fits these tiles. Try swapping some.' : 'No play fits these tiles, so this turn is a pass.';
    return;
  }
  $('hints-text').textContent = 'Tap one to lay it on the board.';
  drawHints();
}

const hintHtml = (hint, i) =>
  `<li><button class="hint" data-hint="${i}"><b>${hint.word}</b><span>${hint.name}</span><span>${hint.score}</span></button></li>`;

// The best five; or, once asked for, every play, a hundred at a time
// (`more` adds the next hundred).
function drawHints(more = false) {
  if (!hintsAll) {
    listedHints = shownHints.slice(0, HINTS_BEST);
    $('hints-list').innerHTML = listedHints.map(hintHtml).join('');
    $('btn-all-plays').hidden = shownHints.length <= HINTS_BEST;
    $('btn-all-plays').textContent = `Show all ${shownHints.length} plays`;
    return;
  }
  listedHints = hintsSort === 'az' ? [...shownHints].sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0)) : shownHints;
  hintsDrawn = more ? hintsDrawn + HINTS_PAGE : HINTS_PAGE;
  const rest = listedHints.length - hintsDrawn;
  $('hints-list').innerHTML =
    listedHints.slice(0, hintsDrawn).map(hintHtml).join('') +
    (rest > 0 ? `<li class="more"><button class="pill" data-more>Show ${Math.min(rest, HINTS_PAGE)} more</button></li>` : '');
  if (!more) $('hints-list').scrollTop = 0;
}

function showAllPlays() {
  hintsAll = true;
  $('hints-title').textContent = `All ${shownHints.length} plays`;
  $('btn-all-plays').hidden = true;
  $('hints-sort').hidden = false;
  $('hints-list').classList.add('all');
  drawHints();
}

function useHint(i) {
  const hint = listedHints[i];
  $('hints').hidden = true;
  if (!hint || !canAct()) return;
  pending = hint.tiles.map(tile => ({ ...tile }));
  selected = null;
  notice = '';
  render();
}

// One button pressed in a row of choices, by its data-<key> value.
function setPressed(group, key, value) {
  for (const button of group.children) button.setAttribute('aria-pressed', button.dataset[key] === value);
}

// ---- Words: check one, or find them ----------------------------------------

// A text box gets the keyboard only where there is a real keyboard; on a
// phone the screen keyboard would cover the box it was opened for.
const focusIfKeyboard = field => {
  if (matchMedia('(pointer: fine)').matches) field.focus();
};

// The Words box, on the tab last used or on `tab`, naming the list in use.
function openWords(tab = wordsTab) {
  $('words-list').textContent = `Word list: ${WORD_LISTS[dictKey].name}`;
  $('lookup').hidden = false;
  showTab(tab);
}

function showTab(tab) {
  wordsTab = tab;
  setPressed($('words-tabs'), 'tab', tab);
  for (const name of ['check', 'find', 'short']) $(`tab-${name}`).hidden = tab !== name;
  if (tab === 'check') {
    drawLookup();
    focusIfKeyboard($('lookup-word'));
  } else if (tab === 'find') {
    findNow();
    focusIfKeyboard($('tab-find').querySelector('[data-find]'));
  } else {
    drawShort();
  }
}

// Every two- and three-letter word in the list in use, for quick reference.
// Plain words, not links, so a stray tap opens nothing.
async function drawShort() {
  const list = dictKey;
  const sections = [['two', 2, 'Two letters'], ['three', 3, 'Three letters']];
  for (const [id] of sections) {
    $(`short-${id}`).textContent = '';
    $(`short-${id}-title`).textContent = 'Looking…';
  }
  let answers;
  try {
    answers = await Promise.all(sections.map(([, length]) => ask({ type: 'find', list, filters: { length } })));
  } catch {
    $('short-two-title').textContent = 'The word list is not ready. Try again in a moment.';
    $('short-three-title').textContent = '';
    return;
  }
  if (list !== dictKey) return;
  sections.forEach(([id, , title], i) => {
    $(`short-${id}-title`).textContent = `${title} (${answers[i].total.toLocaleString()})`;
    $(`short-${id}`).innerHTML = answers[i].words.map(word => `<span>${word}</span>`).join('');
  });
}

// Asks the worker for the words that fit, a moment after typing stops. An
// answer to an older question is dropped.
function findSoon() {
  clearTimeout(findTimer);
  findTimer = setTimeout(findNow, FIND_DELAY);
}

async function findNow() {
  clearTimeout(findTimer);
  const filters = Object.fromEntries([...document.querySelectorAll('[data-find]')].map(field => [field.dataset.find, field.value]));
  const asked = ++findAsked;
  $('find-count').textContent = 'Looking…';
  let answer;
  try {
    answer = await ask({ type: 'find', list: dictKey, filters });
  } catch {
    if (asked === findAsked) $('find-count').textContent = 'The word list is not ready. Try again in a moment.';
    return;
  }
  if (asked !== findAsked) return;
  found = answer;
  sortFound();
  drawFound();
}

const wordPoints = word => [...word].reduce((sum, letter) => sum + VALUES[letter], 0);

function sortFound() {
  const { words } = found;
  if (findSort === 'long') found.sorted = [...words].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  else if (findSort === 'points') {
    const points = new Map(words.map(word => [word, wordPoints(word)]));
    found.sorted = [...words].sort((a, b) => points.get(b) - points.get(a) || (a < b ? -1 : 1));
  } else found.sorted = words;
}

// The words found, two hundred at a time (`more` adds the next two hundred),
// each a link to its meaning, with what its letters are worth.
function drawFound(more = false) {
  const { sorted, total } = found;
  $('find-count').textContent = total ? `${total.toLocaleString()} word${total === 1 ? '' : 's'}` : 'No words fit.';
  findDrawn = more ? findDrawn + FIND_PAGE : FIND_PAGE;
  const rest = sorted.length - findDrawn;
  $('find-list').innerHTML =
    sorted
      .slice(0, findDrawn)
      .map(word => `<li><a href="https://en.wiktionary.org/wiki/${word.toLowerCase()}" target="_blank" rel="noopener">${word}</a><small>${wordPoints(word)}</small></li>`)
      .join('') + (rest > 0 ? `<li class="more"><button class="pill" data-more>Show ${Math.min(rest, FIND_PAGE)} more</button></li>` : '');
  if (!more) $('find-list').scrollTop = 0;
}

function drawLookup() {
  const word = $('lookup-word').value.toUpperCase().replace(/[^A-Z]/g, '');
  let text = 'Type a word to see if it can be played.';
  let known = null;
  if (word.length === 1) text = 'A word needs at least two letters.';
  else if (word && !dict) text = wordsFailed ? 'The word list did not load.' : 'Loading the word list…';
  else if (word) {
    known = isWord(dict, word);
    text = known ? `${word} is a word.` : `${word} is not in the word list.`;
  }
  $('lookup-result').textContent = text;
  $('lookup-result').className = `lookup-result${known === true ? ' good' : known === false ? ' bad' : ''}`;
  $('lookup-link').hidden = !known;
  if (known) $('lookup-link').href = `https://en.wiktionary.org/wiki/${word.toLowerCase()}`;
}

const isFree = index => !game.board[index] && !pending.some(tile => tile.index === index);

// Lays tile `id` on square `index`, from the rack or from another square. A
// tile laid this turn that is already there trades places with it: a tile
// from the rack sends it back to the rack, into the place the new one left,
// and a tile from another square sends it to that square. Tiles played in
// earlier turns stay where they are.
function placeTile(id, index) {
  if (!canAct() || game.board[index]) return;
  const moving = pending.find(tile => tile.id === id);
  if (moving?.index === index) return;
  const displaced = pending.find(tile => tile.index === index);
  pending = pending.filter(tile => tile !== moving && tile !== displaced);
  if (displaced) {
    if (moving) pending.push({ ...displaced, index: moving.index });
    else swapInRack(id, displaced.id);
  }
  const letter = moving?.letter ?? TILES[id];
  pending.push({ index, id, letter });
  selected = null;
  notice = '';
  playSound('place');
  if (letter === BLANK) openPicker(index);
  render();
}

// Swaps two tiles' places in the rack's order (which keeps tiles that are out
// on the board), so a tile coming back from the board shows where the other
// one left.
function swapInRack(a, b) {
  const seat = viewer();
  const order = [...game.players[seat].rack];
  const [i, j] = [order.indexOf(a), order.indexOf(b)];
  [order[i], order[j]] = [order[j], order[i]];
  arrange(game, seat, order);
  saveGame();
}

// Puts tile `id` at `position` among the tiles showing on the rack. Tiles
// still out on the board go to the end of the rack's order.
function moveInRack(id, position) {
  const seat = viewer();
  const showing = rackTiles(seat).filter(other => other !== id);
  showing.splice(position, 0, id);
  arrange(game, seat, [...showing, ...pending.map(tile => tile.id)]);
  saveGame();
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
  typed = [];
  selected = null;
  notice = '';
  render();
}

// The tiles slide from their old places to their new ones.
function shuffleRack() {
  const seat = viewer();
  const before = new Map([...$('rack').querySelectorAll('.tile[data-id]')].map(tile => [tile.dataset.id, tile.getBoundingClientRect().left]));
  arrange(game, seat, [...shuffle(rackTiles(seat)), ...pending.map(tile => tile.id)]);
  selected = null;
  saveGame();
  render();
  playSound('shuffle');
  if (reducedMotion()) return;
  for (const tile of $('rack').querySelectorAll('.tile[data-id]')) {
    const dx = before.get(tile.dataset.id) - tile.getBoundingClientRect().left;
    if (dx) tile.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 280, easing: 'ease-out' });
  }
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
  act({ t: 'play', tiles: pending.map(({ index, id, letter }) => ({ index, id, letter })) });
}

// A move by this phone's player: run here, or on a guest's phone in a Wi-Fi
// game sent to the host, whose answer comes back as the next state or as a
// refusal.
function act(move) {
  if (isGuest()) {
    notice = '';
    sent = session.guest.send(move);
    render();
    return;
  }
  const seat = game.turn;
  commit(() => {
    if (move.t === 'play') play(game, seat, move.tiles, valid);
    else if (move.t === 'swap') exchange(game, seat, move.ids);
    else pass(game, seat);
  });
}

function tapRack(id) {
  if (!canAct()) return;
  selected = selected === id ? null : id;
  notice = '';
  render();
}

// A tap on a square: lays the tile picked from the rack (trading places with
// a tile laid there this turn), or else takes back a tile laid this turn.
// With nothing picked, a double-tap of a finger zooms the board, and a click
// of a mouse puts the typing cursor there (a second click turns it to type
// downwards).
function tapCell(index, pointerType = 'mouse') {
  const now = performance.now();
  const doubled = pointerType === 'touch' && lastTap.index === index && now - lastTap.time < DOUBLE_TAP_MS;
  lastTap = doubled ? { index: -1, time: 0 } : { index, time: now };
  if (doubled && selected === null && isFree(index) && zoomOffered()) {
    toggleZoom(index);
    return;
  }
  if (!canAct()) return;
  const tile = pending.find(laid => laid.index === index);
  if (selected !== null && !game.board[index]) {
    placeTile(selected, index);
  } else if (tile) {
    if (isBlank(tile.id)) openPicker(index);
    else returnTile(index);
  } else if (pointerType !== 'touch' && isFree(index)) {
    cursor = { index, across: cursor?.index === index ? !cursor.across : true };
    render();
  }
}

// ---- Zoom -----------------------------------------------------------------

const zoomOffered = () => matchMedia('(max-width: 599px), (max-height: 540px)').matches;

// Zooms the board in or out. Zooming in centres the frame on `index`, or
// else on the tiles being laid, the last play or the centre star.
function toggleZoom(index = null) {
  const frame = $('board-frame');
  const zoomed = frame.classList.toggle('zoomed');
  $('btn-zoom').setAttribute('aria-pressed', zoomed);
  if (zoomed) showSquares([index ?? pending[0]?.index ?? game.moves.findLast(move => move.type === 'play')?.tiles[0] ?? CENTER]);
}

// Scrolls a zoomed board so the middle of `squares` is in the middle of the
// frame, as far as the board's edges allow.
function showSquares(squares) {
  const frame = $('board-frame');
  if (!frame.classList.contains('zoomed') || !squares.length) return;
  const rows = squares.map(row);
  const cols = squares.map(col);
  const middle = (list, size) => ((Math.min(...list) + Math.max(...list) + 1) / 2 / SIZE) * size;
  frame.scrollLeft = middle(cols, frame.scrollWidth) - frame.clientWidth / 2;
  frame.scrollTop = middle(rows, frame.scrollHeight) - frame.clientHeight / 2;
}

// ---- Typing ---------------------------------------------------------------

// Lays a tile for `letter` at the cursor: one of that letter from the rack,
// or a blank standing for it when there is none (or Shift is held). Typing
// over a tile laid this turn replaces it, and it goes back to the rack. The
// cursor then moves on past any tiles already down.
function typeLetter(letter, wantBlank) {
  if (!cursor || !canAct() || game.board[cursor.index]) return;
  const displaced = pending.find(tile => tile.index === cursor.index);
  if (displaced?.letter === letter && isBlank(displaced.id) === Boolean(wantBlank)) {
    moveCursorOn(); // the same letter typed again: nothing to change
    return;
  }
  const showing = rackTiles(viewer());
  const id = (wantBlank ? undefined : showing.find(tile => TILES[tile] === letter)) ?? showing.find(isBlank);
  if (id === undefined) {
    notice = `There is no ${letter} on your rack.`;
    render();
    return;
  }
  if (displaced) {
    pending = pending.filter(tile => tile !== displaced);
    swapInRack(id, displaced.id);
  }
  pending.push({ index: cursor.index, id, letter });
  if (!typed.includes(cursor.index)) typed.push(cursor.index);
  selected = null;
  notice = '';
  playSound('place');
  moveCursorOn();
}

// Moves the cursor past the squares with tiles on them, as far as the edge.
function moveCursorOn() {
  const step = cursor.across ? 1 : SIZE;
  const atEdge = i => (cursor.across ? col(i) === SIZE - 1 : i + SIZE >= SQUARES);
  let next = cursor.index;
  while (!isFree(next) && !atEdge(next)) next += step;
  cursor = { ...cursor, index: next };
  render();
  showSquares([cursor.index]);
}

// Backspace: takes back the last typed tile and puts the cursor there.
function untype() {
  const index = typed.pop();
  if (index === undefined || !canAct()) return;
  pending = pending.filter(tile => tile.index !== index);
  cursor = { ...cursor, index };
  notice = '';
  render();
}

function moveCursor(key) {
  const { index } = cursor;
  const moves = {
    ArrowLeft: [col(index) > 0 ? index - 1 : index, true],
    ArrowRight: [col(index) < SIZE - 1 ? index + 1 : index, true],
    ArrowUp: [index >= SIZE ? index - SIZE : index, false],
    ArrowDown: [index + SIZE < SQUARES ? index + SIZE : index, false],
  };
  const [next, across] = moves[key];
  cursor = { index: next, across };
  render();
  showSquares([next]);
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

function confirmFirst(title, text, button, action) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('btn-confirm').textContent = button;
  confirmed = action;
  $('confirm').hidden = false;
}

// On the host's phone, Pass also passes for a Wi-Fi player whose phone is
// out of touch on their turn.
function onPass() {
  if (passingFor()) {
    const seat = game.turn;
    const name = nameOf(seat);
    confirmFirst(`Pass for ${name}?`, `${name}’s turn ends with no score, as if ${name} had passed.`, 'Pass', () => {
      if (passingFor() && game.turn === seat) commit(() => pass(game, seat), true);
    });
    return;
  }
  if (!canAct() || pending.length) return;
  confirmFirst('Pass?', 'Your turn ends and you score nothing.', 'Pass', () => act({ t: 'pass' }));
}

// The Wi-Fi box is not among these: Escape and the menu leave it to its own
// buttons, which also end what it was doing.
const DIALOGS = ['picker', 'swap', 'confirm', 'hints', 'lookup', 'moves', 'stats', 'rules', 'about'];
const dialogOpen = () => DIALOGS.some(id => !$(id).hidden) || !$('wifi').hidden;

// ---- Wi-Fi games ------------------------------------------------------------

// Each person plays on their own phone. The host's phone keeps the real game
// and runs every move; the others send theirs and get back their own view
// of it (wifi.js), over direct links between the phones (net.js).

const liveWifi = () => Boolean(session) && wifiGame();

// Moves and states that arrive while a play is counted out wait until the
// count is over, as the computer does.
function whenIdle(task) {
  if (counting) inbox.push(task);
  else task();
}

function drainInbox() {
  while (inbox.length && !counting) inbox.shift()();
}

// This phone's turn: a chime, and a buzz where the phone can.
function alertTurn() {
  playSound('turn');
  try {
    navigator.vibrate?.(120);
  } catch {
    // no buzz, then
  }
}

// The screen stays on while this phone is in a Wi-Fi game, as a phone that
// sleeps drops out. The browser lets the lock go whenever the page is
// hidden, so it is asked for again each time the page comes back.
let wakeLock = null;
let askingLock = false;
async function keepAwake(on) {
  if (!on) {
    const lock = wakeLock;
    wakeLock = null;
    lock?.release().catch(() => {});
    return;
  }
  if (wakeLock || askingLock || document.visibilityState !== 'visible' || !navigator.wakeLock) return;
  askingLock = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (session) {
      wakeLock = lock;
      lock.addEventListener('release', () => {
        if (wakeLock === lock) wakeLock = null;
      });
    } else lock.release().catch(() => {});
  } catch {
    // Refused (on low battery, say): the game goes on without it.
  }
  askingLock = false;
}

document.addEventListener('visibilitychange', () => keepAwake(Boolean(session)));

// Hosting and joining need a name, which the others see.
function needName() {
  $('wifi-name').classList.add('want');
  $('wifi-name').focus();
}

// The host knows this tab again by its token, which lasts as long as the tab.
function wifiToken() {
  let token = load(TOKEN_KEY, true);
  if (typeof token !== 'string' || !token) {
    token = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    store(TOKEN_KEY, token, true);
  }
  return token;
}

// What this tab is doing in a Wi-Fi game, so that a reload goes back to it.
function storeWifi() {
  store(WIFI_KEY, session ? { role: session.role, code: session.code } : null, true);
}

// Ends this phone's part in the Wi-Fi game. The host's ends it for everyone;
// a guest gives up its seat, which the host keeps in case it comes back.
function endWifi() {
  if (!session) return;
  const ending = session;
  session = null;
  storeWifi();
  if (ending.role === 'host') {
    // The room outlasts the goodbye a moment: closing it hangs up at once.
    ending.host.close('ended');
    setTimeout(() => ending.room?.close(), 1000);
  } else {
    ending.guest.leave();
    if (wifiGame()) game = null;
  }
  away = [];
  sent = false;
  inbox = [];
  keepAwake(false);
}

// Runs `action` once this phone has left its Wi-Fi game, asking first while
// that game is being played.
function leaving(action) {
  const playing = liveWifi() && game.phase === 'play';
  if (!playing) {
    endWifi();
    action();
    return;
  }
  const hosting = session.role === 'host';
  confirmFirst(
    hosting ? 'End the Wi-Fi game?' : 'Leave the Wi-Fi game?',
    hosting ? 'The other phones will be told that it has ended.' : 'Your seat is kept: join again with the same name to take it back.',
    hosting ? 'End it' : 'Leave',
    () => {
      endWifi();
      action();
    },
  );
}

// Host a game: a room under a new code, and the box that shows the code and
// who has joined, where Start begins the game.
function hostGame() {
  const name = cleanName(settings.wifiName);
  if (!name) {
    needName();
    return;
  }
  leaving(() => {
    const host = createHost({ name, version: VERSION, onmove: hostMove, onchange: hostChanged });
    session = { role: 'host', host, room: null, code: '', trouble: '' };
    keepAwake(true);
    showWifi('host');
    reopen(session);
  });
}

// Opens the room for `attempt`, a host's session: under its code when it has
// one (a saved game), otherwise a new one. During a game a failure is tried
// again; in the box, Try again does that.
async function reopen(attempt) {
  try {
    const room = await openRoom({ code: attempt.code || null, onlink: link => attempt.host.attach(link) });
    if (session !== attempt) {
      room.close();
      return;
    }
    Object.assign(attempt, { room, code: room.code, trouble: '' });
    if (wifiGame() && game.net) game.net.code = room.code;
    storeWifi();
  } catch (error) {
    if (session !== attempt) return;
    attempt.trouble = error.message;
    if (wifiGame() && attempt.host.started) setTimeout(() => session === attempt && reopen(attempt), 5000);
  }
  drawWifi();
  if (game && !$('table').hidden) render();
}

// A Wi-Fi game saved on the host's phone: its code is opened again, and the
// other phones, which keep trying, come back by themselves.
function resumeHosting(saved) {
  const seats = saved.net?.seats ?? saved.players.map(player => ({ name: player.name, token: null }));
  const host = createHost({ name: saved.players[0].name, version: VERSION, seats, onmove: hostMove, onchange: hostChanged });
  session = { role: 'host', host, room: null, code: saved.net?.code ?? '', trouble: '' };
  me = 0;
  away = host.away();
  start(saved);
  storeWifi();
  reopen(session);
}

// Someone joined, came back or dropped out. The lobby shows it; in a game,
// every phone is sent the game again, so that the one that came back has it
// and the others' chips dim or light up.
function hostChanged() {
  if (session?.role !== 'host') return;
  if (wifiGame() && session.host.started) {
    away = session.host.away();
    game.net = { code: session.code, seats: session.host.saved() };
    saveGame();
    session.host.share(game);
    if (!$('table').hidden) render();
  }
  drawWifi();
}

// A guest's move, run here as the host's own are, after any count that is
// under way.
function hostMove(seat, move) {
  if (!isHost() || !session.host.started) return;
  if (move.t === 'hint') {
    noteHint(game, seat);
    saveGame();
    return;
  }
  const attempt = session;
  whenIdle(() => {
    if (session !== attempt || !wifiGame()) return;
    if (!dict) {
      session.host.refuse(seat, 'The host’s word list is still loading. Try again in a moment.');
      return;
    }
    const held = game.players.map(player => player.score);
    try {
      if (move.t === 'play') play(game, seat, move.tiles, valid);
      else if (move.t === 'swap') exchange(game, seat, move.ids);
      else pass(game, seat);
    } catch (error) {
      session.host.refuse(seat, error.message);
      return;
    }
    settle(held, true);
  });
}

// Start, in the host's box: a game for everyone in the lobby, with the host's
// word list, hints and word check.
function startWifiGame() {
  if (session?.role !== 'host' || !session.room || session.host.players().length < 2) return;
  const players = session.host.begin();
  const next = newGame({ mode: 'net', players, words: settings.wordList });
  next.rules = { hints: settings.hints, lookup: settings.lookup };
  next.net = { code: session.code, seats: session.host.saved() };
  me = 0;
  away = session.host.away();
  hideWifi();
  start(next);
}

// Play again, on the host's phone: back to the lobby with whoever is still
// there, which others may join as well.
function hostAgain() {
  session.host.reopen();
  showWifi('host');
}

// Join a game: the box asks for the code. A shared link brings its code,
// and then joins straight away.
function openJoin(code = '') {
  if (!cleanName(settings.wifiName)) {
    waitingCode = code;
    needName();
    return;
  }
  waitingCode = '';
  leaving(() => {
    showWifi('join');
    $('join-code').value = cleanCode(code);
    if (code) joinGame();
  });
}

async function joinGame() {
  if (session) return;
  const code = cleanCode($('join-code').value);
  if (code.length !== CODE_LENGTH) {
    wifiStatus(`A code has ${CODE_LENGTH} letters.`, true);
    return;
  }
  const guest = createGuest({
    name: cleanName(settings.wifiName),
    token: wifiToken(),
    version: VERSION,
    connect: () => joinRoom(code),
    onmessage: guestHeard,
    onlink: guestLink,
  });
  const attempt = { role: 'guest', guest, code, players: null };
  session = attempt;
  keepAwake(true);
  wifiStatus('');
  try {
    await guest.join();
  } catch (error) {
    if (session !== attempt) return;
    session = null;
    storeWifi(); // a reload no longer tries this game
    keepAwake(false);
    wifiStatus(error.message, true);
    return;
  }
  if (session === attempt) storeWifi();
}

// What the host sends a guest.
function guestHeard(message) {
  if (session?.role !== 'guest') return;
  if (message.t === 'lobby') {
    session.players = message.players;
    // After a game, its results stay on screen (with this phone's old seat)
    // until the host starts the next one.
    if (wifiGame()) return;
    me = message.seat;
    if (!wifiBox) showWifi('join');
    drawWifi();
  } else if (message.t === 'state') {
    const attempt = session;
    session.players = message.game.players.map((player, seat) => ({ name: player.name, here: !message.away[seat] }));
    whenIdle(() => session === attempt && guestState(message));
  } else if (message.t === 'refused') {
    sent = false;
    notice = message.message;
    if (game && !$('table').hidden) render();
  } else {
    // The host ended the game, or would not take this phone back.
    const owner = session.players?.[0]?.name ?? 'The host';
    endWifi();
    showMenu();
    showWifi('ended', message.t === 'closed' ? `${owner} ended the game.` : deniedText(message, VERSION));
  }
}

// The game as the host sends it. A new one starts here; the one already here
// moves on, with this phone's own order for its rack; one this phone has
// already only says who is there.
function guestState({ seat, game: next, away: gone }) {
  me = seat;
  away = gone;
  if (!wifiGame() || game.id !== next.id) {
    hideWifi();
    start(next);
    return;
  }
  if (sameState(game, next)) {
    if (!$('table').hidden) render();
    return;
  }
  const held = game.players.map(player => player.score);
  next.players[me].rack = keepOrder(next.players[me].rack, game.players[me].rack);
  const mover = next.moves.at(-1)?.player;
  game = next;
  sent = false;
  settle(held, mover !== me);
}

// The link to the host went, or came back. A move sent just before it went
// may never be answered: the next state will tell.
function guestLink(up) {
  if (!up) sent = false;
  if (game && !$('table').hidden) render();
  drawWifi();
}

// Resume on the menu: back to the Wi-Fi game this phone is in, or else the
// saved game, which for a Wi-Fi game's host opens its code again.
function resume() {
  if (liveWifi()) {
    useWords(game.words);
    $('menu').hidden = true;
    $('table').hidden = false;
    render();
    keepAwake(true);
    return;
  }
  const saved = load(GAME_KEY);
  if (saved?.mode === 'net') resumeHosting(saved);
  else start(saved);
}

// The address that opens this game's Join box, sent with the phone's own
// Share sheet, or else copied.
async function shareLink() {
  if (session?.role !== 'host' || !session.code) return;
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('join', session.code);
  const net = new URLSearchParams(location.search).get('net');
  if (net) url.searchParams.set('net', net);
  try {
    if (navigator.share) await navigator.share({ title: 'Word Game', text: `Join my Word Game: the code is ${session.code}.`, url: url.href });
    else {
      await navigator.clipboard.writeText(url.href);
      wifiStatus('Link copied. Paste it into a message to the others.');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') wifiStatus(url.href);
  }
}

// The Wi-Fi box: the host's code and lobby, a guest's join and wait, or why
// a Wi-Fi game ended.
function showWifi(kind, text = '') {
  wifiBox = kind;
  wifiNote = { text, warn: kind === 'ended' };
  $('wifi').hidden = false;
  drawWifi();
  if (kind === 'join' && !session) focusIfKeyboard($('join-code'));
}

function hideWifi() {
  wifiBox = null;
  $('wifi').hidden = true;
}

function wifiStatus(text, warn = false) {
  wifiNote = { text, warn };
  drawWifi();
}

// Cancel (or Leave) gives up the lobby and goes to the menu; after a Wi-Fi
// game has ended, OK goes there too.
function cancelWifi() {
  const ended = wifiBox === 'ended';
  hideWifi();
  if (!ended) endWifi();
  showMenu();
}

function drawWifi() {
  if (!wifiBox) return;
  const hosting = wifiBox === 'host' && session?.role === 'host';
  const guest = wifiBox === 'join' && session?.role === 'guest' ? session.guest : null;
  const players = hosting ? session.host.players() : guest ? session.players : null;
  const owner = players?.[0]?.name ?? 'the host';
  let title = 'Wi-Fi game';
  let text = '';
  let { text: status, warn } = wifiNote;
  let go = null;
  let cancel = 'Cancel';
  let listed = false;
  if (wifiBox === 'ended') {
    go = 'OK';
    cancel = null;
  } else if (wifiBox === 'host') {
    title = 'Host a game';
    if (hosting && session.room) {
      text = 'On the other phones, choose Wi-Fi, tap Join a game and enter:';
      listed = true;
      go = 'Start';
      if (!status) status = players.length < 2 ? 'Waiting for the others to join…' : players.length < MAX_PLAYERS ? 'Start when everyone is in.' : `${MAX_PLAYERS} players: the game is full.`;
    } else if (hosting && session.trouble) {
      [status, warn] = [session.trouble, true];
      go = 'Try again';
    } else if (hosting) text = 'Opening a game…';
  } else {
    title = 'Join a game';
    if (!guest) {
      text = 'Enter the code on the host’s screen.';
      go = 'Join';
    } else if (guest.connected && players) {
      text = `You are in ${owner}’s game.`;
      listed = true;
      cancel = 'Leave';
      if (!status) status = `Waiting for ${owner} to start…`;
    } else if (players) {
      text = `Lost touch with ${owner}’s phone. Trying again…`;
      listed = true;
      cancel = 'Leave';
    } else text = `Connecting to game ${session.code}…`;
  }
  $('wifi-title').textContent = title;
  $('wifi-text').textContent = text;
  $('wifi-text').hidden = !text;
  const code = hosting && session.room ? session.code : '';
  $('wifi-code').hidden = !code;
  $('wifi-code').innerHTML = [...code].map(letter => `<span class="tile">${letter}<small>${VALUES[letter]}</small></span>`).join('');
  $('wifi-code').setAttribute('aria-label', `Code ${[...code].join(' ')}`);
  $('btn-share').hidden = !code;
  $('join-code').hidden = !(wifiBox === 'join' && !guest);
  $('wifi-players').hidden = !listed;
  const mine = hosting ? 0 : me;
  $('wifi-players').innerHTML = listed
    ? players
        .map((player, seat) => `<li${player.here ? '' : ' class="away"'}>${dot(seat)}${escapeHtml(player.name)}${seat === mine ? ' <span class="muted">(you)</span>' : ''}</li>`)
        .join('')
    : '';
  $('wifi-status').textContent = status;
  $('wifi-status').classList.toggle('warn', warn);
  $('btn-wifi-go').hidden = !go;
  $('btn-wifi-go').textContent = go ?? '';
  $('btn-wifi-go').disabled = go === 'Start' && players.length < 2;
  $('btn-wifi-cancel').hidden = !cancel;
  $('btn-wifi-cancel').textContent = cancel ?? '';
}

// ---- Screens ------------------------------------------------------------

const input = setupInput({
  board: $('board'),
  rack: $('rack'),
  frame: $('board-frame'),
  handlers: {
    canDrag: from => (from === 'board' ? canAct() : !covered() && !isAi(viewer()) && game.phase === 'play'),
    // Any square without a tile from an earlier turn: an empty one, or one
    // with a tile laid this turn, which trades places with the one dropped.
    canDrop: target => target.kind === 'rack' || (canAct() && !game.board[target.index]),
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
  stopAi();
  skipCount();
  stopParty();
  counting = null;
  cursor = null;
  for (const group of document.querySelectorAll('.choice[data-setting]')) {
    for (const button of group.children) {
      button.setAttribute('aria-pressed', parseValue(button.dataset.value) === settings[group.dataset.setting]);
    }
  }
  const { mode } = settings;
  $('row-difficulty').hidden = mode !== 'ai';
  $('row-players').hidden = mode !== 'local';
  $('row-names').hidden = mode !== 'local';
  $('row-wifi-name').hidden = mode !== 'net';
  $('row-wifi').hidden = mode !== 'net';
  $('btn-new').hidden = mode === 'net';
  for (const field of document.querySelectorAll('[data-name]')) {
    const i = Number(field.dataset.name);
    field.hidden = i >= settings.players;
    field.value = settings.names[i];
  }
  $('wifi-name').value = settings.wifiName;
  $('word-list').value = settings.wordList;
  // A Wi-Fi game in progress keeps its list: the host checks moves with it.
  useWords(liveWifi() ? game.words : settings.wordList);

  // Resume goes back to a Wi-Fi game this phone is in, or else to the saved game.
  const scores = players => players.map(player => player.score).join('–');
  const saved = liveWifi() ? null : load(GAME_KEY);
  const canResume = liveWifi() || ((saved?.v === 1 || saved?.v === 2) && saved.phase === 'play');
  $('btn-resume').hidden = !canResume;
  if (liveWifi()) $('btn-resume').textContent = `Back to the Wi-Fi game (${scores(game.players)})`;
  else if (canResume) $('btn-resume').textContent = `Resume ${saved.mode === 'net' ? 'Wi-Fi game' : 'game'} (${scores(saved.players)})`;
  for (const id of ['btn-new', 'btn-host', 'btn-join']) $(id).classList.toggle('primary', !canResume);

  for (const id of ['table', 'gameover', ...DIALOGS]) $(id).hidden = true;
  $('menu').hidden = false;
  drainInbox();
}

// A game is played with the word list it was started with; one saved before
// there was a choice was played with ENABLE + added. A game against Hard
// saved before 1.4.0 carries on against the same player, now called Guru.
// A Wi-Fi game comes ready made, from the host's lobby or (on a guest's
// phone) from the host.
function start(saved = null) {
  game = saved ?? newGame({ mode: settings.mode === 'ai' ? 'ai' : 'local', difficulty: settings.difficulty, players: playersFor(), words: settings.wordList });
  if (!Object.hasOwn(WORD_LISTS, game.words ?? '')) game.words = 'enable+added';
  if (game.v === 1) Object.assign(game, { v: 2, difficulty: game.difficulty === 'hard' ? 'guru' : game.difficulty });
  if (!wifiGame()) {
    me = 0;
    away = [];
  }
  sent = false;
  inbox = [];
  useWords(game.words);
  stopParty();
  pending = [];
  typed = [];
  cursor = null;
  $('board-frame').classList.remove('zoomed');
  $('btn-zoom').setAttribute('aria-pressed', false);
  selected = null;
  notice = '';
  revealedTo = null;
  resultsShown = true;
  messages = describe(game.events);
  buildBoard();
  $('menu').hidden = true;
  $('table').hidden = false;
  if (!isGuest()) store(GAME_KEY, game);
  if (isHost()) session.host.share(game);
  render();
  scheduleAi();
  keepAwake(Boolean(session));
  if (wifiGame() && game.phase === 'play' && game.turn === me) alertTurn();
}

// ---- Wiring -------------------------------------------------------------

$('menu').addEventListener('click', event => {
  const button = event.target.closest('.choice button');
  if (!button) return;
  settings[button.parentElement.dataset.setting] = parseValue(button.dataset.value);
  store(SETTINGS_KEY, settings);
  setMuted(!settings.sound);
  showMenu();
});

$('row-names').addEventListener('input', event => {
  settings.names[Number(event.target.dataset.name)] = event.target.value.slice(0, 12);
  store(SETTINGS_KEY, settings);
});

$('wifi-name').addEventListener('input', event => {
  event.target.classList.remove('want');
  settings.wifiName = event.target.value.slice(0, NAME_LENGTH);
  store(SETTINGS_KEY, settings);
});

$('btn-new').addEventListener('click', () => leaving(() => start()));
$('btn-resume').addEventListener('click', resume);
$('btn-host').addEventListener('click', hostGame);
$('btn-join').addEventListener('click', () => openJoin(waitingCode));
$('btn-share').addEventListener('click', shareLink);
$('btn-wifi-cancel').addEventListener('click', cancelWifi);
$('btn-wifi-go').addEventListener('click', () => {
  if (wifiBox === 'ended') cancelWifi();
  else if (wifiBox === 'join') joinGame();
  else if (session?.role === 'host' && !session.room) {
    session.trouble = '';
    drawWifi();
    reopen(session);
  } else startWifiGame();
});
$('join-code').addEventListener('input', event => {
  event.target.value = cleanCode(event.target.value);
  if (wifiNote.warn) wifiStatus('');
});
$('join-code').addEventListener('keydown', event => {
  if (event.key === 'Enter') joinGame();
});
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
$('btn-hint').addEventListener('click', onHint);
$('btn-lookup').addEventListener('click', () => openWords());
$('btn-words').addEventListener('click', () => openWords());
$('btn-all-plays').addEventListener('click', showAllPlays);

$('hints-sort').addEventListener('click', event => {
  const button = event.target.closest('[data-sort]');
  if (!button) return;
  setPressed($('hints-sort'), 'sort', (hintsSort = button.dataset.sort));
  drawHints();
});

$('words-tabs').addEventListener('click', event => {
  const button = event.target.closest('[data-tab]');
  if (button) showTab(button.dataset.tab);
});

for (let length = 2; length <= 15; length++) $('tab-find').querySelector('select').add(new Option(`${length} letters`, length));
for (const field of document.querySelectorAll('[data-find]')) {
  field.addEventListener('input', findSoon);
  field.addEventListener('change', findSoon);
}

$('find-sort').addEventListener('click', event => {
  const button = event.target.closest('[data-sort]');
  if (!button) return;
  setPressed($('find-sort'), 'sort', (findSort = button.dataset.sort));
  sortFound();
  drawFound();
});

$('find-list').addEventListener('click', event => {
  if (event.target.closest('[data-more]')) drawFound(true);
});
$('btn-reveal').addEventListener('click', reveal);

$('hints-list').addEventListener('click', event => {
  if (event.target.closest('[data-more]')) {
    drawHints(true);
    return;
  }
  const button = event.target.closest('[data-hint]');
  if (button) useHint(Number(button.dataset.hint));
});
$('lookup-word').addEventListener('input', drawLookup);

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
  act({ t: 'swap', ids });
});

$('btn-confirm').addEventListener('click', () => {
  $('confirm').hidden = true;
  const action = confirmed;
  confirmed = null;
  action?.();
});

$('btn-stats').addEventListener('click', showStats);
$('btn-moves').addEventListener('click', showMoves);
$('btn-zoom').addEventListener('click', () => toggleZoom());
$('btn-short').addEventListener('click', () => openWords('short'));

for (const [key, { name }] of Object.entries(WORD_LISTS)) $('word-list').add(new Option(name, key));
$('word-list').addEventListener('change', event => {
  settings.wordList = event.target.value;
  store(SETTINGS_KEY, settings);
  if (!liveWifi()) useWords(settings.wordList); // loaded now, ready for the next game
});
$('btn-sound').addEventListener('click', toggleSound);

// The first press arms the button, the second erases.
$('btn-reset').addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    $('btn-reset').textContent = 'Tap again to erase';
    return;
  }
  Object.assign(stats, emptyStats());
  store(STATS_KEY, stats);
  showStats();
});

$('gameover').addEventListener('click', event => {
  const action = event.target.dataset.do;
  if (action === 'again') {
    if (isHost()) hostAgain();
    else if (wifiGame()) showMenu();
    else start();
  }
  else if (action === 'menu') showMenu();
  else if (action === 'stats') showStats();
  else if (action === 'moves') showMoves();
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

// Browsers only allow sound once the page has been tapped or typed at, so every
// tap and key wakes the audio. Either one also skips a count in progress,
// and then does nothing else: it must not also pick a tile or press a button.
for (const type of ['pointerdown', 'keydown']) {
  document.addEventListener(
    type,
    event => {
      unlockSound();
      skipClick = Boolean(counting) || Boolean(celebrating);
      if (!skipClick) return;
      endCelebration(true); // first, as a count that wins the game starts one
      skipCount();
      if (type === 'keydown') {
        event.stopPropagation();
        if (event.key === 'Enter' || event.key === ' ') event.preventDefault();
      }
    },
    true,
  );
}

// The click that follows a skipping tap is dropped before anything sees it.
document.addEventListener(
  'click',
  event => {
    if (!skipClick) return;
    skipClick = false;
    event.stopPropagation();
    event.preventDefault();
  },
  true,
);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!$('wifi').hidden) cancelWifi();
    else if (!$('picker').hidden) closePicker();
    else if (dialogOpen()) for (const id of DIALOGS) $(id).hidden = true;
    else if (game && !$('table').hidden) {
      cursor = null;
      recall();
    }
    return;
  }
  if (event.target.matches?.('input') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!game || $('table').hidden || dialogOpen() || !$('gameover').hidden) return;
  // With the typing cursor on the board, letters lay tiles.
  if (cursor && canAct()) {
    if (/^[a-z]$/i.test(event.key)) {
      event.preventDefault();
      typeLetter(event.key.toUpperCase(), event.shiftKey);
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      untype();
      return;
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      moveCursor(event.key);
      return;
    }
  }
  if (event.key === 'Enter' && event.target !== $('btn-menu')) {
    event.preventDefault(); // Enter always plays, whichever button has focus
    if (covered()) reveal();
    else onPlay();
  }
});

showMenu();

// A tab that was in a Wi-Fi game (reloaded, or brought back by the browser)
// goes straight back to it. A shared link opens the Join box with its code.
{
  const was = load(WIFI_KEY, true);
  const saved = load(GAME_KEY);
  const address = new URL(location.href);
  const code = cleanCode(address.searchParams.get('join') ?? '');
  if (address.searchParams.has('join')) {
    address.searchParams.delete('join');
    history.replaceState(null, '', address.href);
  }
  if (was?.role === 'host' && saved?.mode === 'net' && saved.phase === 'play') resumeHosting(saved);
  else if (was?.role === 'guest' && was.code) openJoin(was.code);
  else if (code) {
    settings.mode = 'net';
    store(SETTINGS_KEY, settings);
    showMenu();
    openJoin(code);
  }
}
