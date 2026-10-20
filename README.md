# Word Game

A crossword tile game for the browser: a 15 × 15 board with premium squares, 100 letter tiles and a rack of seven. Play against the computer (easy, medium, hard or guru), pass one device between two to four people, or play on your own phones over Wi-Fi. Works with touch, mouse and keyboard, on phones and desktops.

It is a static page: plain HTML, CSS and JavaScript modules, with no build step. Its one library, PeerJS, is kept in `js/vendor/` and loaded only for Wi-Fi games.

## Play

- Tap a tile on your rack and then a square, or drag the tile there. Tap a tile you have laid to take it back, or drag it somewhere else. Lay a tile on one you laid this turn and the two swap: the old one goes back to the rack, or to the square the new one came from. **Recall** takes them all back.
- Drag tiles along the rack to arrange them, or press **Shuffle**.
- A blank asks which letter it should be. Tap it again on the board to change its mind.
- The **Play** button shows what the tiles laid so far would score.
- Each play is counted out on the board: every tile pops as its points are added, a tile on a 2L or 3L square jumps, a word on a 2W or 3W square jumps as a whole, and a play using all seven tiles sets the word bouncing. Tap anywhere to skip the count. Devices set to reduce motion skip it always.
- **Swap** trades tiles with the bag, while it still holds seven. **Pass** ends the turn without a score.
- Against the computer, Easy and Medium keep to everyday words and seldom take the best play. Hard knows every word in the list and plays one of its best scores. Guru also thinks about the tiles it keeps, and swaps when its rack is poor.
- Between people, each player's tiles stay face down until their owner presses the button to show them, so the device can be passed round.
- **Wi-Fi** on the menu lets two to four people play on their own phones (see [Wi-Fi games](#wi-fi-games)). Each types their name. One taps **Host a game**, and a four-letter code appears. The others tap **Join a game** and type it, or open the link that **Share link** sends. The host can also add computer players, and taps **Start** when everyone is in.
- **Hint** lists the five best plays for your tiles, and **Show all** lists every play, best first or A to Z; tap one to lay it on the board. Hints can be switched off on the menu.
- **Word check** on the menu marks words that are not in the list as you lay them. With it off, a word is only checked when you press Play.
- **Words** (the magnifier in a game, while word check is on, or the button on the menu) checks whether a word is in the list, with a link to its meaning, and finds words: by how they start or end, letters they contain, a pattern with `?` for any letter (`C?T`), or the letters they are made from in any order, `?` again standing for any letter (`RETAIN?`). The fields combine, and the results scroll, sorted A to Z, longest first or by points. Its third tab lists every two- and three-letter word, and the **2 & 3 letters** button in a game opens it straight away.
- The small number on each score is how many tiles that player holds. Once the bag is empty these turn gold: they show who could go out, and how soon.
- On a phone, **Zoom** (or a double-tap on an empty square) enlarges the board; drag the board to look around it.
- **Moves**, under the messages, lists every turn of the game so far with each player's running total.
- **Statistics** on the menu shows your record against each computer level, results between people by name, best plays and games, totals, and the last twenty games.
- A win by a person is celebrated with fireworks, confetti and a brass fanfare (the same as Cribbage's) before the results appear. Tap to skip to them.
- The speaker button mutes and unmutes sound effects, as does **Sound** on the menu.
- Keyboard: click a square and type the word; click the square again to type downwards. Shift and a letter lays a blank as that letter. The arrow keys move the cursor, `Backspace` takes back the last letter, `Enter` plays and `Escape` takes your tiles back.
- The **i** button on the menu shows which version is running.

Settings, the game in progress and your statistics are kept in the browser's `localStorage`, so they stay on that device and browser and disappear if its site data is cleared.

## Wi-Fi games

Each person plays on their own phone, and one phone, the host's, keeps the game. It deals the tiles, checks every move and keeps the score. The other phones send it their moves, and it sends each of them the game as that player may see it: their own tiles, but only how many the others hold.

- A browser cannot run a server or find other devices on a network by itself. So, for a few seconds at the start, a free public service, the [PeerJS](https://peerjs.com) cloud server, passes the connection details between the phones. After that the phones are linked directly (WebRTC), and moves go straight across the Wi-Fi. This needs the internet at the start. Everyone has it anyway, because the game itself loads from the web.
- On a Wi-Fi network that keeps devices apart (guest and hotel networks often do), PeerJS's free relay carries the moves instead. If the PeerJS service is down, Wi-Fi games cannot start, but the other modes are not affected.
- The host can add computer players in the lobby: **Add the computer** seats one at the level tapped (Easy, Medium, Hard or Guru), named after that level, and **×** takes it out again. They play from the host's phone, count towards the four players, and keep playing while the host looks at the menu. Statistics leave them out of "Between people".
- The host's word list, Hints and Word check apply to everyone in that game. Sound is set on each phone.
- Screens stay on during a Wi-Fi game, because a phone that goes to sleep drops out.
- A phone that drops out (it slept, switched apps, reloaded, or lost the Wi-Fi) reconnects by itself and takes back its seat. While it is gone, its score is dimmed on the other phones. On its turn, the host's **Pass** passes for it, so the game need not wait.
- If the host's page reloads, it reopens the same game under the same code, and the other phones come back by themselves.
- When it becomes your turn, your phone chimes, and buzzes if it can.
- At the end each phone records the game in its own **Statistics**. Everyone's result goes under "Between people". Records and totals count only the plays made on that phone. Only the host can start another game.
- Up to four players, as in any game. A phone running an older copy of the game is asked to reload.
- PeerJS 1.5.5 (MIT licence, see `js/vendor/LICENSE-peerjs.txt`) is the unchanged `peerjs.min.js` from <https://github.com/peers/peerjs>.

## Word lists

**Word list** on the menu chooses which words are valid. Each list is freely licensed, and each can have the game's few added words or not. A game keeps the list it started with; changing the menu affects new games only.

| Choice | Files | Words |
|---|---|---|
| ENABLE | `words/enable.txt` | 168,548 |
| ENABLE + added | `words/enable.txt`, `words/added.txt` | 168,560 |
| YAWL | `words/yawl.txt` | 257,150 |
| YAWL + added | `words/yawl.txt`, `words/added.txt` | 257,155 |
| Wordnik | `words/wordnik.txt` | 194,152 |
| **Wordnik + added** (the first choice) | `words/wordnik.txt`, `words/added.txt` | 194,154 |

- **ENABLE** (public domain) is the older, smaller list, from <https://norvig.com/ngrams/enable1.txt>. It lacks words that became official in the last twenty years, such as CIG and QI.
- **Wordnik** (MIT licence; see `words/LICENSE-wordnik.txt`) comes closest to the official lists, from <https://github.com/wordnik/wordlist> (`wordlist-20210729.txt`).
- **YAWL** (public domain) is the biggest, with many rare words, from <https://github.com/elasticdog/yawl> (`yawl-0.3.2.03/word.list`).
- All three keep only words of 2 to 15 letters, the width of the board.
- `words/added.txt` holds newer words that some lists lack: QI, ZA, KI, OI, FE, OK, EW, ZEN and some plurals. Add a word there, one per line in lower case, to make it playable with the "+ added" lists.
- `words/common.txt` is the everyday vocabulary that the Easy and Medium computer players keep to. The game narrows it to the list in use, so they never play a word that list refuses. It is the words of `2of12full.txt` from Alan Beale's 12dicts lists (public domain; Alt12Dicts edition from <https://github.com/en-wl/wordlist>) that are in any of the lists, together with their regular plurals, verb forms and comparisons. Thanks to Alan Beale and Kevin Atkinson for the 12dicts lists.

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
| `js/dictionary.js` | The word lists to choose from, each as a compact trie, and word lookups |
| `js/rules.js` | Whether a play is legal, and what it scores |
| `js/game.js` | Turns, racks, exchanges, passes and the end of the game, as a plain game object and the actions that change it |
| `js/moves.js` | Every legal play for a rack (the Appel–Jacobson method) |
| `js/ai.js` | The computer's four levels, and hints |
| `js/finder.js` | The word finder |
| `js/worker.js`, `js/thinker.js`, `js/answers.js` | The computer's thinking and the word lists, in a background worker; the page's side of it; and the answers both give |
| `js/stats.js` | Lifetime statistics |
| `js/net.js` | Connections between phones for a Wi-Fi game: a room under a four-letter code, and links that carry messages (through PeerJS, or between the tabs of one browser for testing) |
| `js/wifi.js` | A Wi-Fi game between phones: seats, what each phone may see, and the messages between the host and the others |
| `js/vendor/` | PeerJS, and its licence |
| `js/input.js` | Tapping and dragging tiles, for mouse, touch and pen |
| `js/animate.js` | The count of each play on the board |
| `js/sound.js` | Sound effects, generated with the Web Audio API (no audio files) |
| `js/fanfare.js` | The fanfare for a win: a generated brass ensemble with timpani |
| `js/celebrate.js` | Fireworks and confetti for a won game |
| `js/ui.js` | Drawing, the menu and dialogs, turns, zoom, typing and storage |
| `words/` | The word lists |
| `tests.html` | Tests for the tiles, board, word lists, rules, game, move finding, the computer, hints, the word finder, statistics, Wi-Fi games, the celebration and sound |
