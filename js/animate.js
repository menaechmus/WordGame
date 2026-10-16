// A play counted out on the board, letter by letter. Each tile pops as its
// points are added, with the points floating up from it. A tile on a letter
// premium jumps (twice on a triple), a word on a word premium jumps as a
// whole, and a play that uses all seven tiles sets the word bouncing.
//
// Nothing here changes the board: the tiles are already in place, and are
// only moved for a moment by the Web Animations API. So skipping is simply
// finishing every animation at once.

const PACE = 120; // milliseconds per letter, at most
const LONGEST = 3500; // a long play speeds up to finish in about this time

const pop = [{ transform: 'scale(1)' }, { transform: 'scale(1.2)', offset: 0.35 }, { transform: 'scale(1)' }];

// One hop up and back, `height` per cent of a tile.
const hop = height => [
  { transform: 'translateY(0)', easing: 'ease-out' },
  { transform: `translateY(-${height}%)`, offset: 0.45, easing: 'ease-in' },
  { transform: 'translateY(0)' },
];

// result: what rules.js said of the play. dropped: the tiles drop into place
// first, as the computer's do. onStep({ kind, ... }) hears each step as it
// happens: 'drop', 'letter', 'word', 'scored' (a word done) and 'bingo'.
// Returns { done, skip }: done settles when the count has finished.
export function countPlay({ board, result, dropped = false, onStep = () => {} }) {
  const animations = [];
  const labels = [];
  let skipped = false;
  let wake = null;

  const tileAt = index => board.querySelector(`.cell[data-index="${index}"] .tile`);
  const animate = (element, frames, options) => {
    if (element && !skipped) animations.push(element.animate(frames, options));
  };
  const wait = ms =>
    skipped
      ? Promise.resolve()
      : new Promise(resolve => {
          const timer = setTimeout(resolve, ms);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
  const step = info => {
    if (!skipped) onStep(info);
  };

  // Points rising from a square and fading.
  function float(index, text, kind = '') {
    if (skipped) return;
    const label = document.createElement('span');
    label.className = `float ${kind}`;
    label.textContent = text;
    board.querySelector(`.cell[data-index="${index}"]`).append(label);
    labels.push(label);
    animations.push(
      label.animate(
        [
          { opacity: 0, transform: 'translate(-50%, 40%)' },
          { opacity: 1, transform: 'translate(-50%, -10%)', offset: 0.2 },
          { opacity: 1, transform: 'translate(-50%, -50%)', offset: 0.7 },
          { opacity: 0, transform: 'translate(-50%, -90%)' },
        ],
        { duration: kind === 'bingo' ? 1400 : 800, easing: 'ease-out', fill: 'forwards' },
      ),
    );
  }

  const fresh = [...new Set(result.words.flatMap(word => word.letters.filter(letter => letter.fresh).map(letter => letter.index)))];
  const bonuses = result.words.flatMap(word => word.letters).filter(letter => letter.fresh && letter.mult > 1).length;
  const steps =
    result.words.reduce((sum, word) => sum + word.letters.length + 2 + (word.wordMult > 1 ? 6 : 0), 0) +
    bonuses * 3 + (result.bingo ? 10 : 0) + (dropped ? 3 : 0);
  const pace = Math.min(PACE, LONGEST / steps);

  async function run() {
    if (dropped) {
      fresh.forEach((index, i) => {
        animate(tileAt(index), [{ transform: 'translateY(-70%) scale(1.3)', opacity: 0 }, { opacity: 1, offset: 0.5 }, { transform: 'none', opacity: 1 }], {
          duration: 260,
          delay: i * 70,
          easing: 'ease-out',
          fill: 'backwards',
        });
      });
      step({ kind: 'drop' });
      await wait(260 + fresh.length * 70);
    }

    for (const word of result.words) {
      let sum = 0;
      for (const [i, letter] of word.letters.entries()) {
        const tile = tileAt(letter.index);
        const points = letter.value * letter.mult;
        const premium = letter.fresh && letter.mult > 1;
        sum += points;
        animate(tile, pop, { duration: pace * 2.2 });
        float(letter.index, `+${points}`, premium ? 'bonus' : '');
        step({ kind: 'letter', i, word: word.text, sum, premium });
        if (premium) {
          animate(tile, hop(letter.mult === 3 ? 60 : 45), { duration: pace * 2.6, delay: pace, iterations: letter.mult - 1 });
          await wait(pace * (1 + 2.6 * (letter.mult - 1)));
        }
        await wait(pace);
      }
      if (word.wordMult > 1) {
        const hops = word.wordMult === 2 ? 1 : word.wordMult < 9 ? 2 : 3;
        for (const index of word.cells) animate(tileAt(index), hop(55), { duration: pace * 3.2, iterations: hops });
        step({ kind: 'word', word: word.text, sum, mult: word.wordMult, score: word.score });
        await wait(pace * 3.2 * hops);
      }
      step({ kind: 'scored', word: word.text, score: word.score });
      await wait(pace * 2);
    }

    if (result.bingo) {
      const cells = result.words[0].cells;
      cells.forEach((index, i) => animate(tileAt(index), hop(85), { duration: pace * 3.4, delay: i * pace * 0.7, iterations: 2 }));
      float(cells[Math.floor(cells.length / 2)], '+50', 'bingo');
      step({ kind: 'bingo' });
      await wait(pace * 6.8 + cells.length * pace * 0.7);
    }
  }

  const done = run().then(() => {
    for (const animation of animations) animation.cancel();
    for (const label of labels) label.remove();
  });

  return {
    done,
    skip() {
      skipped = true;
      wake?.();
    },
  };
}
