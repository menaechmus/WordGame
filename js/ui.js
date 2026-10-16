// Everything the player sees and touches. The rules live in game.js and
// rules.js; this file draws the current game object and turns taps, drags
// and keys into actions.

import { TILES, VALUES, BLANK, isBlank, shuffle } from './tiles.js';
import { SIZE, SQUARES, CENTER, PREMIUMS, row, col, squareName } from './board.js';
import { isWord } from './dictionary.js';
import { evaluatePlay } from './rules.js';
import { newGame, play, exchange, pass, arrange, canExchange, noteHint } from './game.js';
import { setupInput } from './input.js';
import { startThinker, ask } from './thinker.js';
import { countPlay } from './animate.js';
import { playSound, setMuted, unlockSound } from './sound.js';
import { LEVELS, emptyStats, loadStats, recordGame } from './stats.js';

// Shown in the About box. Bump both with every release: a browser still
// running a cached copy of this file then shows the old number.
const VERSION = '1.0.0';
const RELEASED = '16 October 2026';

const AI_DELAY = 800; // the computer takes at least this long over a move
const SETTINGS_KEY = 'wordgame.settings';
const GAME_KEY = 'wordgame.game';
const STATS_KEY = 'wordgame.stats';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LABELS = { TW: '3W', DW: '2W', TL: '3L', DL: '2L' };
const PREMIUM_NAMES = { TW: 'triple word', DW: 'double word', TL: 'triple letter', DL: 'double letter' };
const DOUBLE_TAP_MS = 320;

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
  const settings = { mode: 'ai', difficulty: 'medium', players: 2, names: ['', '', '', ''], hints: true, lookup: true, sound: true };
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
const stats = loadStats(load(STATS_KEY));
let resetArmed = false;
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
let aiTimer = 0;
let thinking = 0; // the computer's question in flight; 0 when there is none
let questions = 0;
let shownHints = []; // the plays listed in the hints box
let counting = null; // while a play is counted out: { held, text, run }
let skipClick = false; // the tap that skipped a count should do nothing else
let drawn = new Set(); // tiles just drawn onto the rack, to slide in
let cursor = null; // the keyboard's typing cursor: { index, across }
let typed = []; // squares filled by typing, newest last, for Backspace
let lastTap = { index: -1, time: 0 }; // for telling a double-tap on the board

setMuted(!settings.sound);

// The word list arrives from the worker, which also does the computer's
// thinking.
startThinker((loaded, error) => {
  if (loaded) dict = loaded;
  else wordsFailed = Boolean(error);
  document.body.dataset.words = loaded ? 'ready' : 'failed'; // for the test driver
  if (game) render();
  if (!$('lookup').hidden) drawLookup();
});

const valid = word => isWord(dict, word);

// ---- Who is who ---------------------------------------------------------

const nameOf = seat => game.players[seat].name;
const isAi = seat => game.players[seat].ai;

// The seat whose rack is at the bottom of the screen: against the computer
// always the person, between people whoever's turn it is.
const viewer = () => (game.mode === 'ai' ? 0 : game.turn);

// People sharing one screen keep their tiles hidden until their owner asks.
const covered = () => game.mode !== 'ai' && game.phase === 'play' && revealedTo !== game.turn;
const canAct = () => game.phase === 'play' && !isAi(game.turn) && !covered() && !counting;

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
function drawScores() {
  const scores = counting ? counting.held : game.players.map(player => player.score);
  $('scores').innerHTML = game.players
    .map((player, seat) => {
      const active = game.phase === 'play' && seat === game.turn;
      return `<div class="chip seat${seat}${active ? ' active' : ''}"><i></i><span class="name">${escapeHtml(player.name)}</span><b>${scores[seat]}</b></div>`;
    })
    .join('');
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
  $('btn-hint').hidden = !settings.hints;
  $('btn-hint').disabled = !acting;
  $('btn-lookup').hidden = !settings.lookup;
}

function render() {
  const result = pending.length ? evaluatePlay(game.board, pending, settings.lookup && dict ? valid : null) : null;
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

  // A game won on a play is announced once the play has been counted.
  $('gameover').hidden = game.phase !== 'over' || !resultsShown || Boolean(counting);
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
      const kind = entry.mode === 'ai' ? capital(entry.difficulty || 'medium') : 'People';
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
// nothing in the game and says why. The computer's moves are added to what
// was said before (`append`), so a person's own play is still there to read.
function commit(action, append = false) {
  const held = game.players.map(player => player.score);
  try {
    action();
  } catch (error) {
    notice = error.message;
    render();
    return;
  }
  pending = [];
  typed = [];
  cursor = null;
  selected = null;
  notice = '';
  resultsShown = true;
  messages = append ? [...messages, ...describe(game.events)] : describe(game.events);
  store(GAME_KEY, game.phase === 'over' ? null : game);
  if (game.phase === 'over') {
    recordGame(stats, game);
    store(STATS_KEY, stats);
  }

  // New tiles slide onto the rack of whoever is looking at it.
  const refilled = game.events.find(event => event.drawn?.length);
  drawn = refilled && refilled.player === viewer() && !covered() && !reducedMotion() ? new Set(refilled.drawn) : new Set();
  if (game.events.some(event => event.type === 'exchange')) playSound('swap');
  if (drawn.size) playSound('draw', 0.15);

  const played = game.events.find(event => event.type === 'play');
  // What this action says waits for the count, which tells the total itself.
  const said = describe(game.events).length;
  if (played && !reducedMotion()) counting = { held, text: played.result.words[0].text, skipped: false, said };
  render();
  if (played) showSquares(played.result.words[0].cells); // a zoomed board shows the play
  drawn = new Set();
  if (counting) countOut(played);
  else afterTurn(played);
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
    dropped: isAi(played.player),
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

function afterTurn(played) {
  if (game.phase === 'over') {
    const won = game.mode !== 'ai' || game.winners.includes(0);
    playSound(won ? 'win' : 'lose', played ? 0.2 : 0);
  }
  scheduleAi();
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
  ask({ type: 'move', board: game.board, rack: game.players[seat].rack, bag: game.bag.length, level: game.difficulty }).then(
    answered,
    () => answered({ type: 'pass' }),
  );
}

function stopAi() {
  clearTimeout(aiTimer);
  thinking = 0;
}

// Hints: the best plays for the rack, from the worker. Asking counts as
// using a hint, once the answer is shown.
async function onHint() {
  if (!canAct() || !settings.hints) return;
  const [asked, seat] = [game, game.turn];
  $('hints-text').textContent = 'Looking for plays…';
  $('hints-list').innerHTML = '';
  $('hints').hidden = false;
  try {
    shownHints = await ask({ type: 'hints', board: game.board, rack: game.players[seat].rack });
  } catch {
    $('hints-text').textContent = 'No hints just now. Try again in a moment.';
    return;
  }
  if ($('hints').hidden || game !== asked || game.turn !== seat) return;
  noteHint(game, seat);
  store(GAME_KEY, game);
  if (!shownHints.length) {
    $('hints-text').textContent = canExchange(game) ? 'No play fits these tiles. Try swapping some.' : 'No play fits these tiles, so this turn is a pass.';
    return;
  }
  $('hints-text').textContent = 'Tap one to lay it on the board.';
  $('hints-list').innerHTML = shownHints
    .map((hint, i) => `<li><button class="hint" data-hint="${i}"><b>${hint.word}</b><span>${hint.name}</span><span>${hint.score}</span></button></li>`)
    .join('');
}

function useHint(i) {
  const hint = shownHints[i];
  $('hints').hidden = true;
  if (!hint || !canAct()) return;
  pending = hint.tiles.map(tile => ({ ...tile }));
  selected = null;
  notice = '';
  render();
}

function openLookup() {
  $('lookup-word').value = '';
  drawLookup();
  $('lookup').hidden = false;
  $('lookup-word').focus();
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

function placeTile(id, index) {
  if (!canAct() || !isFree(index)) return;
  const moving = pending.find(tile => tile.id === id);
  pending = pending.filter(tile => tile.id !== id);
  const letter = moving?.letter ?? TILES[id];
  pending.push({ index, id, letter });
  selected = null;
  notice = '';
  playSound('place');
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
  if (game.phase === 'play') store(GAME_KEY, game);
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
  const tiles = pending;
  commit(() => play(game, game.turn, tiles, valid));
}

function tapRack(id) {
  if (!canAct()) return;
  selected = selected === id ? null : id;
  notice = '';
  render();
}

// A tap on a square: lays the tile picked from the rack, or takes back a tile
// laid this turn. With nothing picked, a double-tap of a finger zooms the
// board, and a click of a mouse puts the typing cursor there (a second click
// turns it to type downwards).
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
  if (tile) {
    if (isBlank(tile.id)) openPicker(index);
    else returnTile(index);
  } else if (selected !== null && isFree(index)) {
    placeTile(selected, index);
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
// or a blank standing for it when there is none (or Shift is held). The
// cursor then moves on past any tiles already down.
function typeLetter(letter, wantBlank) {
  if (!cursor || !canAct() || !isFree(cursor.index)) return;
  const showing = rackTiles(viewer());
  const id = (wantBlank ? undefined : showing.find(tile => TILES[tile] === letter)) ?? showing.find(isBlank);
  if (id === undefined) {
    notice = `There is no ${letter} on your rack.`;
    render();
    return;
  }
  pending.push({ index: cursor.index, id, letter });
  typed.push(cursor.index);
  selected = null;
  notice = '';
  playSound('place');
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

function onPass() {
  if (!canAct() || pending.length) return;
  confirmFirst('Pass?', 'Your turn ends and you score nothing.', 'Pass', () => commit(() => pass(game, game.turn)));
}

const DIALOGS = ['picker', 'swap', 'confirm', 'hints', 'lookup', 'moves', 'stats', 'rules', 'about'];
const dialogOpen = () => DIALOGS.some(id => !$(id).hidden);

// ---- Screens ------------------------------------------------------------

const input = setupInput({
  board: $('board'),
  rack: $('rack'),
  frame: $('board-frame'),
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
  stopAi();
  skipCount();
  counting = null;
  cursor = null;
  for (const group of document.querySelectorAll('.choice')) {
    for (const button of group.children) {
      button.setAttribute('aria-pressed', parseValue(button.dataset.value) === settings[group.dataset.setting]);
    }
  }
  const people = settings.mode !== 'ai';
  $('row-difficulty').hidden = people;
  $('row-players').hidden = !people;
  $('row-names').hidden = !people;
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
  store(GAME_KEY, game);
  render();
  scheduleAi();
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
$('btn-hint').addEventListener('click', onHint);
$('btn-lookup').addEventListener('click', openLookup);
$('btn-reveal').addEventListener('click', reveal);

$('hints-list').addEventListener('click', event => {
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
  commit(() => exchange(game, game.turn, ids));
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
  if (action === 'again') start();
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
      skipClick = Boolean(counting);
      if (!skipClick) return;
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
    if (!$('picker').hidden) closePicker();
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
