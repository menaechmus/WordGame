// The page's side of worker.js: questions go to the worker, and answers come
// back as promises. If the worker cannot start, the page answers them itself
// with the same code (answers.js), which gives the same answers but can make
// the page stall for a moment.

import { answer } from './answers.js';

let worker = null;
const waiting = new Map();
let nextId = 1;

function thinkHere() {
  worker?.terminate();
  worker = null;
  for (const job of waiting.values()) answer(job.request).then(job.resolve, job.reject);
  waiting.clear();
}

export function startThinker() {
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
    return;
  }
  worker.onmessage = ({ data }) => {
    const job = waiting.get(data.id);
    if (!job) return;
    waiting.delete(data.id);
    if ('error' in data) job.reject(new Error(data.error));
    else job.resolve(data.result);
  };
  worker.onerror = thinkHere;
}

// request: { type: 'words', list } for a word list's trie, or { type:
// 'move' | 'hints' | 'find', list, ... } as think() in ai.js takes them.
export function ask(request) {
  if (!worker) return answer(request);
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { request, resolve, reject });
    worker.postMessage({ id, request });
  });
}
