// Sound effects, made on the spot with the Web Audio API so the game ships no
// audio files. Every effect is built from two ingredients: a burst of filtered
// noise (a tile set down, the bag shaken) and a short tone (a tick, a chime).
// The fanfare for a win is a brass ensemble of its own, in fanfare.js, the
// same as Cribbage's.

import { playFanfare } from './fanfare.js';

const noiseByContext = new WeakMap();

function noiseFor(context) {
  let buffer = noiseByContext.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    noiseByContext.set(context, buffer);
  }
  return buffer;
}

// Fades a gain node in fast and out by `at + length`.
function shape(level, at, length, gain) {
  level.gain.setValueAtTime(0.0001, at);
  level.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.004, length / 3));
  level.gain.exponentialRampToValueAtTime(0.0001, at + length);
}

// `sweep` slides the pitch over the burst: above 1 rises, below 1 falls.
function burst(context, at, { length, pitch, sweep = 1, gain }) {
  const source = context.createBufferSource();
  source.buffer = noiseFor(context);
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(pitch, at);
  filter.frequency.exponentialRampToValueAtTime(pitch * sweep, at + length);
  const level = context.createGain();
  shape(level, at, length, gain);
  source.connect(filter).connect(level).connect(context.destination);
  source.start(at, Math.random() * 0.5, length + 0.01);
}

function tone(context, at, { length, pitch, glide = 1, gain, wave = 'sine' }) {
  const oscillator = context.createOscillator();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(pitch, at);
  oscillator.frequency.exponentialRampToValueAtTime(pitch * glide, at + length);
  const level = context.createGain();
  shape(level, at, length, gain);
  oscillator.connect(level).connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + length + 0.01);
}

const EFFECTS = {
  // A tile set down on the board: a light knock on wood.
  place(context, at) {
    burst(context, at, { length: 0.04, pitch: 2600, sweep: 0.6, gain: 0.7 });
    tone(context, at, { length: 0.06, pitch: 190, glide: 0.5, gain: 0.25 });
  },

  // One letter counted while a play is scored. Each `step` sounds a semitone
  // higher than the last, so a long word climbs.
  tick(context, at, step = 0) {
    tone(context, at, { length: 0.08, pitch: 620 * 2 ** (Math.min(step, 14) / 12), gain: 0.2, wave: 'triangle' });
  },

  // A letter premium: a bright double ping.
  bonus(context, at) {
    tone(context, at, { length: 0.09, pitch: 1046, gain: 0.18, wave: 'triangle' });
    tone(context, at + 0.07, { length: 0.14, pitch: 1568, gain: 0.18, wave: 'triangle' });
  },

  // A word premium: a rising chord.
  word(context, at) {
    [523, 659, 784].forEach((pitch, i) => tone(context, at + i * 0.06, { length: 0.3, pitch, gain: 0.13, wave: 'triangle' }));
  },

  // All seven tiles used: a quick run up, and a shimmer over the top.
  bingo(context, at) {
    [523, 659, 784, 1046, 1318].forEach((pitch, i) => tone(context, at + i * 0.07, { length: 0.25, pitch, gain: 0.14, wave: 'triangle' }));
    for (let i = 0; i < 6; i++) burst(context, at + 0.3 + i * 0.05, { length: 0.03, pitch: 5000 + Math.random() * 2000, gain: 0.18 });
  },

  // New tiles slid onto the rack.
  draw(context, at) {
    burst(context, at, { length: 0.09, pitch: 1700, sweep: 1.6, gain: 0.55 });
  },

  // Tiles knocking together as the rack is shuffled.
  shuffle(context, at) {
    for (let i = 0; i < 6; i++) burst(context, at + i * 0.045 + Math.random() * 0.02, { length: 0.025, pitch: 2200 + Math.random() * 1800, sweep: 0.7, gain: 0.55 });
  },

  // Tiles dropped in the bag and the bag shaken.
  swap(context, at) {
    burst(context, at, { length: 0.22, pitch: 900, sweep: 1.4, gain: 0.5 });
    for (let i = 0; i < 5; i++) burst(context, at + 0.12 + i * 0.05, { length: 0.03, pitch: 2400 + Math.random() * 1500, sweep: 0.7, gain: 0.35 });
  },

  // About three seconds of brass and timpani, then the hall's ring.
  win(context, at) {
    playFanfare(context, at, noiseFor(context));
  },

  // A firework bursting: a soft thump and bang, then a scatter of crackles.
  firework(context, at) {
    tone(context, at, { length: 0.2, pitch: 110, glide: 0.45, gain: 0.25 });
    burst(context, at, { length: 0.16, pitch: 900, sweep: 0.4, gain: 0.4 });
    for (let i = 0; i < 7; i++) {
      burst(context, at + 0.12 + Math.random() * 0.4, { length: 0.012, pitch: 4000 + Math.random() * 2500, gain: 0.15 + Math.random() * 0.15 });
    }
  },

  // Your turn, in a Wi-Fi game: two soft notes, up a fourth.
  turn(context, at) {
    tone(context, at, { length: 0.16, pitch: 784, gain: 0.16, wave: 'triangle' });
    tone(context, at + 0.13, { length: 0.34, pitch: 1046, gain: 0.16, wave: 'triangle' });
  },

  lose(context, at) {
    [392, 330, 262].forEach((pitch, i) => tone(context, at + i * 0.14, { length: 0.32, pitch, gain: 0.2, wave: 'triangle' }));
  },
};

export const SOUNDS = Object.keys(EFFECTS);

// Schedules one effect on any audio context; the tests use an offline one.
export function renderSound(name, context, at = context.currentTime, step = 0) {
  EFFECTS[name](context, at, step);
}

let context = null;
let muted = false;
let waking = false;

export function setMuted(value) {
  muted = value;
}

// Browsers only let a page make sound after a tap or key press, so this is
// called from every one of those.
export function unlockSound() {
  if (muted || !window.AudioContext) return;
  context ??= new AudioContext();
  if (context.state === 'running' || waking) return;
  waking = true;
  context
    .resume()
    .catch(() => {})
    .then(() => {
      waking = false;
    });
}

export function playSound(name, delay = 0, step = 0) {
  // A suspended context would hoard sounds and play them all at once on waking.
  if (muted || !context || (context.state !== 'running' && !waking)) return;
  try {
    renderSound(name, context, context.currentTime + delay, step);
  } catch {
    // Sound is decoration: a browser that cannot make it must not stop the game.
  }
}
