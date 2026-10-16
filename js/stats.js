// Lifetime statistics. The page keeps this object in localStorage; nothing
// here touches storage, so it can be tested directly. Only finished games
// count, and only people's plays count towards the records and totals.

export const LEVELS = ['easy', 'medium', 'hard'];
export const RECENT = 20; // finished games kept in the list of recent ones

const levelRow = () => ({ games: 0, wins: 0, losses: 0, ties: 0, points: 0, bestGame: 0, streak: 0, bestStreak: 0, bestMargin: 0 });
const personRow = () => ({ name: '', games: 0, wins: 0, bestGame: 0 });
const recentRow = () => ({ date: '', mode: '', difficulty: '', players: [], winners: [] });

export function emptyStats() {
  return {
    ai: Object.fromEntries(LEVELS.map(level => [level, levelRow()])),
    people: {}, // by name, lower case: { name, games, wins, bestGame }
    totals: { games: 0, plays: 0, points: 0, bingos: 0, hints: 0, swaps: 0 },
    records: {
      bestPlay: { score: 0, word: '', name: '', date: '' },
      bestGame: { score: 0, name: '', date: '' },
      longestWord: { word: '', name: '', date: '' },
      mostBingos: { count: 0, name: '', date: '' },
    },
    recent: [], // newest first: { date, mode, difficulty, players: [{ name, score }], winners }
  };
}

// Pours saved data into the current shape, so a missing or damaged entry
// falls back to its starting value instead of breaking the page.
function fill(shape, saved) {
  if (typeof shape === 'string') return typeof saved === 'string' ? saved.slice(0, 40) : shape;
  if (typeof shape === 'number') return Number.isFinite(saved) ? saved : shape;
  if (Array.isArray(shape)) return shape.map((item, i) => fill(item, saved?.[i]));
  return Object.fromEntries(Object.entries(shape).map(([key, item]) => [key, fill(item, saved?.[key])]));
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function loadStats(saved) {
  const stats = fill(emptyStats(), saved);
  if (isObject(saved?.people)) {
    for (const [key, person] of Object.entries(saved.people).slice(0, 200)) {
      if (isObject(person)) stats.people[key.slice(0, 40)] = fill(personRow(), person);
    }
  }
  if (Array.isArray(saved?.recent)) {
    stats.recent = saved.recent
      .filter(game => isObject(game) && Array.isArray(game.players))
      .slice(0, RECENT)
      .map(game => ({
        ...fill(recentRow(), game),
        players: game.players.slice(0, 4).map(player => fill({ name: '', score: 0 }, player)),
        winners: (Array.isArray(game.winners) ? game.winners : []).filter(Number.isInteger).slice(0, 4),
      }));
  }
  return stats;
}

const today = () => new Date().toISOString().slice(0, 10);

export function recordGame(stats, game, date = today()) {
  const { players, winners } = game;
  const tie = winners.length > 1;
  const people = players.flatMap((player, seat) => (player.ai ? [] : [seat]));

  if (game.mode === 'ai') {
    const me = people[0];
    const them = players.findIndex(player => player.ai);
    const row = stats.ai[game.difficulty];
    const score = players[me].score;
    row.games++;
    row.points += score;
    row.bestGame = Math.max(row.bestGame, score);
    if (tie) {
      row.ties++;
      row.streak = 0;
    } else if (winners.includes(me)) {
      row.wins++;
      row.streak++;
      row.bestStreak = Math.max(row.bestStreak, row.streak);
      row.bestMargin = Math.max(row.bestMargin, score - players[them].score);
    } else {
      row.losses++;
      row.streak = 0;
    }
  } else {
    for (const seat of people) {
      const { name, score } = players[seat];
      const key = name.toLowerCase().slice(0, 40);
      const person = (stats.people[key] ??= { ...personRow(), name });
      person.name = name;
      person.games++;
      if (!tie && winners.includes(seat)) person.wins++;
      person.bestGame = Math.max(person.bestGame, score);
    }
  }

  const { totals, records } = stats;
  totals.games++;
  for (const seat of people) {
    const { name, score, hints } = players[seat];
    const moves = game.moves.filter(move => move.player === seat);
    const plays = moves.filter(move => move.type === 'play');
    const bingos = plays.filter(move => move.bingo).length;
    totals.plays += plays.length;
    totals.points += plays.reduce((sum, move) => sum + move.score, 0);
    totals.bingos += bingos;
    totals.hints += hints;
    totals.swaps += moves.filter(move => move.type === 'exchange').length;
    for (const move of plays) {
      if (move.score > records.bestPlay.score) records.bestPlay = { score: move.score, word: move.word, name, date };
      if (move.word.length > records.longestWord.word.length) records.longestWord = { word: move.word, name, date };
    }
    if (score > records.bestGame.score) records.bestGame = { score, name, date };
    if (bingos > records.mostBingos.count) records.mostBingos = { count: bingos, name, date };
  }

  stats.recent.unshift({
    date,
    mode: game.mode,
    difficulty: game.mode === 'ai' ? game.difficulty : '',
    players: players.map(({ name, score }) => ({ name, score })),
    winners: [...winners],
  });
  stats.recent.length = Math.min(stats.recent.length, RECENT);
}
