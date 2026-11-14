# BeatBox OS

BeatBox OS is a small, browser-based two-deck DJ mixer demo. It has a home screen, a searchable track list, two virtual decks, and a crossfader. The included tracks are generated live with the Web Audio API; the project does not include recorded audio files.

## Features

- Two independent decks with play/pause and cue controls
- Eight built-in electronic music patterns with tempo, key, genre, and energy metadata
- Per-deck volume and pitch controls (up to 8% faster or slower)
- Equal-power crossfader, level meters, elapsed/remaining time, animated platters, and waveforms
- Track search by title, artist, or genre
- Responsive layout for desktop and smaller screens

## Run locally

This is a static site and has no build step or package dependencies. It can be served with any static web server. For example, from the project directory run:

```sh
python -m http.server 8000
```

Then open <http://localhost:8000> in a modern browser.

### Fix the JavaScript filename before using the mixer

In the current checkout, `index.html` loads `script.js`, but the tracked JavaScript file is named `script (1).js`. The mixer controls and track list will not initialize until those names match. Either rename `script (1).js` to `script.js`, or change the script tag at the bottom of `index.html` to:

```html
<script src="script (1).js"></script>
```

After that, click **Play** on a deck to let the browser initialize audio. If the browser blocks sound, check its site audio settings.

## Using the mixer

1. Open **DJ Set** from the navigation rail or the home screen.
2. Expand a track in the list and choose **Load to A** or **Load to B**.
3. Press **Play** on a loaded deck. **Cue** stops playback and returns that deck to the beginning.
4. Adjust each deck's volume and pitch, then move the crossfader toward A or B to blend the decks.
5. Use the search field to filter tracks by title, artist, or genre.

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure, navigation, mixer controls, and icon definitions |
| `style.css` | Layout, colors, responsive rules, and animations |
| `script (1).js` | Track data, synthesized audio, deck controls, search, and display updates |

## Track data

The built-in library is defined by the `TRACKS` array near the top of `script (1).js`. Each track includes metadata and 16-step patterns for kick, snare, hi-hat, bass, and melody. To add a track, add an object following the existing entries and provide a unique `id`, track metadata, and patterns.

## Notes

- Audio is synthesized in the browser from oscillators and noise; there are no imported songs, uploads, or external audio assets.
- The library and deck state are in memory and reset when the page reloads.
- Google Fonts are requested by the page; system fonts are used if they are unavailable.
