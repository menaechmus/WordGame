// The computer's thinking, kept off the page's own thread so the page stays
// smooth while a play is searched for. Every question from the page (see
// thinker.js) is answered by answers.js, which also hands the page the word
// list it plays with, so the page need not build its own.

import { answer } from './answers.js';

onmessage = async ({ data }) => {
  const { id, request } = data;
  try {
    postMessage({ id, result: await answer(request) });
  } catch (error) {
    postMessage({ id, error: error.message });
  }
};
