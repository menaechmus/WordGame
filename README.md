# Word Game

A crossword tile game for the browser: a 15 × 15 board with premium squares, 100 letter tiles and a rack of seven. Play against the computer or pass one device between two to four people.

It is a static page: plain HTML, CSS and JavaScript modules, with no build step and no dependencies.

This is a work in progress. The rules, tiles, board and word lists are in place, with tests; the board you can play on comes next.

## Word list

A word is valid if it is in `words/enable.txt` or `words/added.txt`.

- `words/enable.txt` is the ENABLE word list (public domain), keeping the words of 2 to 15 letters. It came from <https://norvig.com/ngrams/enable1.txt>.
- `words/added.txt` holds newer words that ENABLE lacks: QI, ZA, KI, OI, FE, OK, EW and some plurals. Add a word there, one per line in lower case, to make it playable.
- `words/common.txt` is the everyday vocabulary that the Easy and Medium computer players keep to. It is the words of `2of12full.txt` from Alan Beale's 12dicts lists (public domain; Alt12Dicts edition from <https://github.com/en-wl/wordlist>) that are valid here, together with their regular plurals, verb forms and comparisons that are valid too. Thanks to Alan Beale and Kevin Atkinson for the 12dicts lists.

## Run locally

Browsers will not load JavaScript modules from `file://`, so serve the folder:

```
python -m http.server 8000
```

Then open <http://localhost:8000/>. The tests run in the browser at <http://localhost:8000/tests.html>.

## Layout

| File | What it holds |
|---|---|
| `js/tiles.js` | The hundred tiles: letters, counts, values and the bag |
| `js/board.js` | The board and its premium squares |
| `js/dictionary.js` | The word list as a compact trie, and word lookups |
| `js/rules.js` | Whether a play is legal, and what it scores |
| `js/game.js` | Turns, racks, exchanges, passes and the end of the game, as a plain game object and the actions that change it |
| `words/` | The word lists |
| `tests.html` | Tests for the tiles, board, word lists, rules and game |
