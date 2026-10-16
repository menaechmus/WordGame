// The page's side of worker.js: questions for the computer go to the
// worker, and answers come back as promises. If the worker cannot start,
// the page loads the word lists and does the thinking itself, which gives
// the same answers but can make the page stall for a moment.

import { loadDictionary, WORD_LISTS } from './dictionary.js';
import { think } from './ai.js';

let worker = null;
let here = null; // the word lists, as promises, once thinking on the page
let onWords = () => {};
const waiting = new Map();
let nextId = 1;

async function answerHere({ request, resolve, reject }) {
  try {
    if (request.type === 'move' && request.level !== 'hard') here.common ??= loadDictionary(WORD_LISTS.common);
    resolve(think(request, { full: await here.full, common: here.common && (await here.common) }));
  } catch (error) {
    reject(error);
  }
}

function thinkHere() {
  if (here) return;
  worker?.terminate();
  worker = null;
  here = { full: loadDictionary(WORD_LISTS.full), common: null };
  here.full.then(
    dict => onWords(dict),
    error => onWords(null, error),
  );
  for (const job of waiting.values()) answerHere(job);
  waiting.clear();
}

// `handler(dict, error)` is called once with the full word list, or with
// the reason it could not be loaded.
export function startThinker(handler) {
  onWords = handler;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch {
    thinkHere();
    return;
  }
  worker.onmessage = ({ data }) => {
    if (data.type === 'words') {
      if (data.dict) onWords(data.dict);
      else thinkHere();
      return;
    }
    const job = waiting.get(data.id);
    if (!job) return;
    waiting.delete(data.id);
    if ('error' in data) job.reject(new Error(data.error));
    else job.resolve(data.result);
  };
  worker.onerror = () => thinkHere();
}

// request: { type: 'move', board, rack, bag, level } or { type: 'hints', board, rack }.
export function ask(request) {
  return new Promise((resolve, reject) => {
    const job = { request, resolve, reject };
    if (!worker) {
      answerHere(job);
      return;
    }
    const id = nextId++;
    waiting.set(id, job);
    worker.postMessage({ id, request });
  });
}
