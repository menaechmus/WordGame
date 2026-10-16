# Word Game

A crossword tile game for the browser: a 15 × 15 board with premium squares, 100 letter tiles and a rack of seven. Pass one device between two to four people. Works with touch, mouse and keyboard, on phones and desktops.

It is a static page: plain HTML, CSS and JavaScript modules, with no build step and no dependencies.

This is a work in progress. Next to come: the computer opponent, hints and word lookup, scoring animations, sound, and statistics.

## Play

- Tap a tile on your rack and then a square, or drag the tile there. Tap a tile you have laid to take it back, or drag it somewhere else. **Recall** takes them all back.
- Drag tiles along the rack to arrange them, or press **Shuffle**.
- A blank asks which letter it should be. Tap it again on the board to change its mind.
- The **Play** button shows what the tiles laid so far would score.
- **Swap** trades tiles with the bag, while it still holds seven. **Pass** ends the turn without a score.
- Between people, each player's tiles stay face down until their owner presses the button to show them, so the device can be passed round.
- **Word check** on the menu marks words that are not in the list as you lay them. With it off, a word is only checked when you press Play.
- Keyboard: `Enter` plays, `Escape` takes your tiles back.
- The **i** button on the menu shows which version is running.

The game in progress and your settings are kept in the browser's `localStorage`, so they stay on that device and browser and disappear if its site data is cleared.

## Word list

A word is valid if it is in `words/enable.txt` or `words/added.txt`.

- `words/enable.txt` is the ENABLE word list (public domain), keeping the words of 2 to 15 letters. It came from <https://norvig.com/ngrams/enable1.txt>.
- `words/added.txt` holds newer words that ENABLE lacks: QI, ZA, KI, OI, FE, OK, EW and some plurals. Add a word there, one per line in lower case, to make it playable.
- `words/common.txt` is the everyday vocabulary that the Easy and Medium computer players will keep to. It is the words of `2of12full.txt` from Alan Beale's 12dicts lists (public domain; Alt12Dicts edition from <https://github.com/en-wl/wordlist>) that are valid here, together with their regular plurals, verb forms and comparisons that are valid too. Thanks to Alan Beale and Kevin Atkinson for the 12dicts lists.

## Run locally

Browsers will not load JavaScript modules from `file://`, so serve the folder:

```
python -m http.server 8000
```

Then open <http://localhost:8000/>. The tests run in the browser at <http://localhost:8000/tests.html>.

## Deploy to GitHub Pages

In the repository go to **Settings → Pages**, choose **Deploy from a branch**, and select `main` and `/ (root)`. The game is served at <https://menaechmus.github.io/WordGame/>.

## Releasing

Before pushing a change, raise `VERSION` and `RELEASED` at the top of `js/ui.js`. The About box shows them, which makes it easy to tell when a browser is still running a cached copy of an earlier release.

## Layout

| File | What it holds |
|---|---|
| `index.html`, `css/style.css` | The page and its styles |
| `js/tiles.js` | The hundred tiles: letters, counts, values and the bag |
| `js/board.js` | The board and its premium squares |
| `js/dictionary.js` | The word list as a compact trie, and word lookups |
| `js/rules.js` | Whether a play is legal, and what it scores |
| `js/game.js` | Turns, racks, exchanges, passes and the end of the game, as a plain game object and the actions that change it |
| `js/input.js` | Tapping and dragging tiles, for mouse, touch and pen |
| `js/ui.js` | Drawing, the menu and dialogs, turns and storage |
| `words/` | The word lists |
| `tests.html` | Tests for the tiles, board, word lists, rules and game |
