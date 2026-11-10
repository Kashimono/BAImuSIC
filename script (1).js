W/* =====================================================================
   BEATBOX OS - script.js
   =====================================================================
   SECTIONS
     1. Track data            the 8 songs (edit this to add or change songs)
     2. Small helpers         tiny functions used everywhere
     3. Deck state            what each deck is doing right now
     4. Audio engine          makes real sound with the Web Audio API
     5. Deck controls         Load, Play/Pause, Cue, Volume, Pitch, Crossfader
     6. Track list + search   builds the right-hand list, filters it
     7. Screen drawing loop   timers, platter spin, waveform, level meters
     8. Start-up

   HOW THE SOUND WORKS
     There are no audio files. Each track is a short pattern (kick, snare,
     hi-hat, bass, melody) that the browser plays live using oscillators.
     A track's tempo comes from its "bpm". The Pitch slider speeds it up or
     slows it down by up to 8%.

   HOW THE CONTROLS ARE CONNECTED
     Play   -> togglePlay(d)  -> startDeck(d) / pauseDeck(d)
     Cue    -> cueDeck(d)     -> stops the deck and goes back to 0:00
     Volume + Crossfader -> applyGains() -> final loudness of each deck
     Pitch  -> deck.pitch     -> read by the scheduler for the next beat
   ===================================================================== */
'use strict';


/* =====================================================================
   1. TRACK DATA
   To add a song, copy one line and change the values.
     bpm   tempo in beats per minute      len    length in seconds
     root  bass note (MIDI number, 48 = C3)
     k / s / h / b / a  patterns of 16 steps ("x" = play, "." = rest) for
                        kick, snare, hi-hat, bass and melody
     bw / aw  wave shape for the bass / melody ('sine','triangle','square','sawtooth')
   ===================================================================== */
const TRACKS = [
  { id:'t1', title:'Midnight Circuit', artist:'Neon Static',  genre:'House',      bpm:124, key:'8A',  len:222, energy:72, root:57,
    k:'x...x...x...x...', s:'....x.......x...', h:'..x...x...x...x.', b:'x..x..x...x.x...', a:'x.x.x.x.x.x.x.x.', bw:'sawtooth', aw:'square' },
  { id:'t2', title:'Low Tide',         artist:'Soft Circuit', genre:'Lo-fi',      bpm:90,  key:'5A',  len:198, energy:35, root:52,
    k:'x.....x..x......', s:'....x.......x...', h:'x.x.x.x.x.x.x.x.', b:'x.....x.x.......', a:'x...x...x...x...', bw:'sine',     aw:'triangle' },
  { id:'t3', title:'Overclock',        artist:'Tera Vox',     genre:'Techno',     bpm:128, key:'9A',  len:245, energy:90, root:48,
    k:'x...x...x...x...', s:'....x.......x...', h:'x.x.x.x.x.x.x.x.', b:'.xx..xx..xx..xx.', a:'x..x..x.x..x..x.', bw:'sawtooth', aw:'square' },
  { id:'t4', title:'Paper Lanterns',   artist:'Mika Aoi',     genre:'Pop',        bpm:110, key:'3B',  len:214, energy:58, root:62,
    k:'x.......x.x.....', s:'....x.......x...', h:'..x...x...x...x.', b:'x.....x.x.......', a:'x.x.x.x.x.x.x.x.', bw:'sine',     aw:'triangle' },
  { id:'t5', title:'Redshift',         artist:'Tera Vox',     genre:'Drum & Bass',bpm:140, key:'4A',  len:260, energy:95, root:53,
    k:'x.........x.....', s:'....x.......x...', h:'x.x.x.x.x.x.x.x.', b:'x.......x.x.....', a:'x.x...x.x.x...x.', bw:'sine',     aw:'square' },
  { id:'t6', title:'Harbor Lights',    artist:'Dela Rosa',    genre:'House',      bpm:122, key:'10A', len:231, energy:66, root:55,
    k:'x...x...x...x...', s:'....x.......x...', h:'..x...x...x...x.', b:'x.x...x.x.x.....', a:'..x...x...x...x.', bw:'sawtooth', aw:'triangle' },
  { id:'t7', title:'Static Bloom',     artist:'Neon Static',  genre:'Techno',     bpm:126, key:'8A',  len:207, energy:80, root:50,
    k:'x...x...x...x...', s:'....x.......x...', h:'x.x.x.x.x.x.x.x.', b:'x.x.x.x.x.x.x.x.', a:'x..x..x...x.x...', bw:'sawtooth', aw:'square' },
  { id:'t8', title:'Velvet Hours',     artist:'Soft Circuit', genre:'Deep House', bpm:118, key:'6B',  len:240, energy:54, root:51,
    k:'x...x...x...x...', s:'................', h:'..x...x...x...x.', b:'x..x..x...x.....', a:'x...x.x...x.x...', bw:'sine',     aw:'triangle' }
];


/* =====================================================================
   2. SMALL HELPERS
   ===================================================================== */
const $  = (sel, root = document) => root.querySelector(sel);        // find one element
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]; // find many
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const byId  = id => TRACKS.find(t => t.id === id);

// 125 seconds -> "2:05"
const fmt = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

// Escape text before putting it into HTML (stops "<" in a title from breaking the page)
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Turn a string into a number 0-359. Used to give each track its own cover color.
const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

// Color the "filled" part of a slider. The CSS reads the --p variable.
const paintRange = el => el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min) * 100) + '%');
document.addEventListener('input', e => { if (e.target.matches('input[type=range]')) paintRange(e.target); });


/* =====================================================================
   3. DECK STATE
   One object per deck. Everything about a deck is stored here.
     track    the loaded track (or null)
     playing  true while it is playing
     step     how many 16th-note steps have been played (this is the playhead)
     pos      the playhead in seconds of the song (step * seconds per step)
     pitch    -8 to +8 (percent)
     vol      0 to 100
     angle    current rotation of the platter in degrees
     level    smoothed loudness 0 to 1 (for the level meter)
   ===================================================================== */
const deck = {
  A: { track:null, playing:false, step:0, pos:0, pitch:0, vol:80, angle:0, level:0, nextTime:0, timer:0, out:null, an:null },
  B: { track:null, playing:false, step:0, pos:0, pitch:0, vol:80, angle:0, level:0, nextTime:0, timer:0, out:null, an:null }
};
const DECKS = ['A', 'B'];

// Playback speed multiplier: pitch +8 -> 1.08
const rate   = d => 1 + deck[d].pitch / 100;
// BPM you actually hear (track BPM changed by the pitch slider)
const effBpm = d => deck[d].track ? deck[d].track.bpm * rate(d) : 0;
// Length of one 16th-note step, in seconds, for the track's ORIGINAL tempo
const stepLen = t => 60 / t.bpm / 4;


/* =====================================================================
   4. AUDIO ENGINE (Web Audio API)
   Signal path for each deck:
      notes -> deck.out (volume x crossfader) -> deck.an (meter) -> master -> speakers
   The audio context can only start after a click, so we create it the
   first time the user presses Play (ensureAudio).
   ===================================================================== */
let ctx = null, master = null, noiseBuf = null;

function ensureAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // master: a compressor stops loud peaks from clipping, then the master volume
  const comp = ctx.createDynamicsCompressor();
  master = ctx.createGain();
  master.gain.value = 0.9;
  comp.connect(master);
  master.connect(ctx.destination);

  // one gain (volume) + one analyser (for the level meter) per deck
  DECKS.forEach(d => {
    deck[d].out = ctx.createGain();
    deck[d].an  = ctx.createAnalyser();
    deck[d].an.fftSize = 256;
    deck[d].out.connect(deck[d].an);
    deck[d].an.connect(comp);
  });

  // a second of random noise, reused for snare and hi-hat sounds
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  applyGains();
}

/* Final loudness of each deck = its volume slider x the crossfader.
   Equal-power crossfade: in the middle both decks are at about 71%. */
function applyGains() {
  if (!ctx) return;
  const x = $('#xfade').value / 100;
  const cross = { A: Math.cos(x * Math.PI / 2), B: Math.sin(x * Math.PI / 2) };
  DECKS.forEach(d => deck[d].out.gain.setTargetAtTime((deck[d].vol / 100) * cross[d], ctx.currentTime, 0.015));
}

/* ---- Sound makers. Each one plays a single sound at time t ---- */

// A pitched note (bass or melody). midi = note number, dur = seconds.
function tone(d, t, midi, dur, type, vol, cutoff) {
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);   // MIDI number -> Hz
  let node = osc;
  if (cutoff) {                                                 // low-pass filter softens harsh waves
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = cutoff;
    osc.connect(f); node = f;
  }
  node.connect(g); g.connect(deck[d].out);
  g.gain.setValueAtTime(0, t);                                  // quick fade in, fade out = no clicks
  g.gain.linearRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.start(t); osc.stop(t + dur + 0.05);
}

// A short burst of noise (snare / hi-hat). hp = high-pass cutoff in Hz.
function noise(d, t, dur, hp, vol) {
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(deck[d].out);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
}

// Kick drum: a sine wave that drops quickly in pitch
function kick(d, t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  g.gain.setValueAtTime(0.85, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
  o.connect(g); g.connect(deck[d].out);
  o.start(t); o.stop(t + 0.4);
}

/* Which notes to use. Chords follow a 4-bar loop in a minor scale.
   SCALE = semitone offsets of the natural minor scale. */
const SCALE = [0, 2, 3, 5, 7, 8, 10];
const PROG  = [0, 5, 3, 4];                                     // chord root for bars 1,2,3,4
const degToMidi = (root, deg) => root + 12 * Math.floor(deg / 7) + SCALE[((deg % 7) + 7) % 7];

/* Play everything that happens on ONE 16th-note step.
   stepIndex counts up from 0; 16 steps = one bar. */
function playStep(d, stepIndex, t) {
  const T = deck[d].track, s = stepIndex % 16, bar = Math.floor(stepIndex / 16);
  const chordRoot = PROG[bar % 4];
  const chord = [chordRoot, chordRoot + 2, chordRoot + 4];      // three chord tones

  if (T.k[s] === 'x') kick(d, t);
  if (T.s[s] === 'x') { noise(d, t, 0.16, 1500, 0.28); tone(d, t, 55, 0.06, 'triangle', 0.14); }
  if (T.h[s] === 'x') noise(d, t, 0.04, 7000, 0.07);
  if (T.b[s] === 'x') tone(d, t, degToMidi(T.root, chordRoot) - 12, stepLen(T) * 1.8, T.bw, 0.17, 700);
  if (T.a[s] === 'x') tone(d, t, degToMidi(T.root, chord[(s >> 1) % 3]) + 12, stepLen(T) * 1.4, T.aw, 0.05, 2600);
}

/* The scheduler. Runs every 30 ms and queues every step that falls in the
   next 0.15 seconds. Because the step length is recalculated each time, moving
   the Pitch slider changes the tempo immediately. */
function schedule(d) {
  const st = deck[d], T = st.track;
  while (st.nextTime < ctx.currentTime + 0.15) {
    playStep(d, st.step, st.nextTime);
    st.nextTime += stepLen(T) / rate(d);   // faster pitch = shorter steps
    st.step++;
    st.pos = st.step * stepLen(T);
    if (st.pos >= T.len) { cueDeck(d); return; }   // reached the end of the song
  }
}


/* =====================================================================
   5. DECK CONTROLS
   ===================================================================== */

// Update the text/icon inside a deck's Play button
function renderPlayBtn(d) {
  const st = deck[d], b = $('#play-' + d);
  b.disabled = !st.track;
  b.classList.toggle('on', st.playing);
  b.innerHTML = `<svg class="ic s"><use href="#i-${st.playing ? 'pause' : 'play'}"/></svg>${st.playing ? 'Pause' : 'Play'}`;
}

// Update title, artist, BPM and slider outputs for a deck
function renderDeckInfo(d) {
  const st = deck[d], T = st.track;
  $('#t-' + d).textContent   = T ? T.title : 'No track';
  $('#a-' + d).textContent   = T ? `${T.artist} · ${T.key} · ${T.genre}` : 'Load a track from the list';
  $('#bpm-' + d).textContent = T ? effBpm(d).toFixed(1) : '--';
  $('#po-' + d).textContent  = (st.pitch >= 0 ? '+' : '') + st.pitch.toFixed(1) + '%';
  renderPlayBtn(d);
  updateChips();
}

// Top-bar chips say "Playing" or "Stopped"
function updateChips() {
  DECKS.forEach(d => {
    const el = $('#chip' + d), st = deck[d];
    el.textContent = !st.track ? 'Empty' : st.playing ? 'Playing' : 'Stopped';
    el.classList.toggle('on', st.playing);
  });
}

// LOAD: put a track on a deck (this stops whatever was playing there)
function loadTrack(d, id) {
  pauseDeck(d);
  const st = deck[d];
  st.track = byId(id); st.step = 0; st.pos = 0; st.pitch = 0;
  $('#pit-' + d).value = 0; paintRange($('#pit-' + d));
  st.bars = makeBars(id);                  // waveform shape for this track
  renderDeckInfo(d);
  renderList();                            // so the "A"/"B" tags update
}

// PLAY
function startDeck(d) {
  const st = deck[d];
  if (!st.track) return;
  ensureAudio();
  st.playing = true;
  st.nextTime = ctx.currentTime + 0.06;
  clearInterval(st.timer);
  st.timer = setInterval(() => schedule(d), 30);
  schedule(d);
  renderDeckInfo(d);
}

// PAUSE (keeps the playhead where it is)
function pauseDeck(d) {
  const st = deck[d];
  st.playing = false;
  clearInterval(st.timer);
  renderDeckInfo(d);
}

function togglePlay(d) { deck[d].playing ? pauseDeck(d) : startDeck(d); }

// CUE: stop and jump back to the start (0:00)
function cueDeck(d) {
  pauseDeck(d);
  deck[d].step = 0; deck[d].pos = 0;
}

// Wire up the buttons and sliders for both decks
DECKS.forEach(d => {
  $('#play-' + d).addEventListener('click', () => togglePlay(d));
  $('#cue-' + d).addEventListener('click', () => cueDeck(d));

  $('#vol-' + d).addEventListener('input', e => {
    deck[d].vol = +e.target.value;
    $('#vo-' + d).textContent = e.target.value;
    applyGains();
  });

  // The pitch slider goes -80..80, which is -8.0%..+8.0%
  $('#pit-' + d).addEventListener('input', e => {
    deck[d].pitch = e.target.value / 10;
    renderDeckInfo(d);
  });
});
$('#xfade').addEventListener('input', applyGains);


/* =====================================================================
   6. TRACK LIST + SEARCH
   renderList() rebuilds the right-hand list. It uses the search box text
   to decide which tracks to show.
   ===================================================================== */
let openId = 't1';                         // which row is expanded

function renderList() {
  const q = $('#gsearch').value.trim().toLowerCase();
  const list = TRACKS.filter(t => !q || (t.title + ' ' + t.artist + ' ' + t.genre).toLowerCase().includes(q));
  $('#count').textContent = `${list.length} of ${TRACKS.length} tracks`;
  // If the open row was filtered out, open the first result instead
  if (list.length && !list.some(t => t.id === openId)) openId = list[0].id;

  $('#tlist').innerHTML = list.length ? list.map(t => {
    // small "A" / "B" tags show which deck has this track
    const tags = DECKS.map(d => deck[d].track && deck[d].track.id === t.id ? `<span class="loaded ${d.toLowerCase()}">${d}</span>` : '').join('');
    return `<details class="tr" data-id="${t.id}"${t.id === openId ? ' open' : ''}>
      <summary class="tr-h">
        <span class="cover" style="--h:${hue(t.title)}">${esc(t.title[0])}</span>
        <span style="min-width:0"><b>${esc(t.title)}${tags}</b><small>${esc(t.artist)} · ${esc(t.genre)}</small></span>
        <span class="bpmv">${t.bpm} BPM</span>
      </summary>
      <div class="tr-d">
        <div class="facts"><div>Key<b>${t.key}</b></div><div>Length<b>${fmt(t.len)}</b></div><div>Tempo<b>${t.bpm} BPM</b></div></div>
        <div class="energy"><span>Energy</span><div class="track"><i class="fill" style="width:${t.energy}%"></i></div><span>${t.energy}%</span></div>
        <div class="tr-btns">
          <button class="btn" type="button" data-load="A:${t.id}">Load to A</button>
          <button class="btn" type="button" data-load="B:${t.id}">Load to B</button>
        </div>
      </div>
    </details>`;
  }).join('') : `<div class="empty">No track matches “${esc($('#gsearch').value)}”. Try a different name or genre.</div>`;
}

// One listener for the whole list (event delegation)
$('#tlist').addEventListener('click', e => {
  const load = e.target.closest('[data-load]');
  if (load) { const [d, id] = load.dataset.load.split(':'); loadTrack(d, id); return; }
});
// Remember which row is open, and keep only one open at a time
$('#tlist').addEventListener('toggle', e => {
  if (!e.target.open) return;
  openId = e.target.dataset.id;
  $$('#tlist details').forEach(el => { if (el !== e.target) el.open = false; });
}, true);

// Typing in the top search box filters the list (and jumps to the DJ screen)
$('#gsearch').addEventListener('input', () => {
  if (location.hash !== '#v-dj') location.hash = '#v-dj';
  renderList();
});


/* =====================================================================
   7. SCREEN DRAWING LOOP
   Runs about 60 times per second. It updates things that move:
   timers, platter rotation, waveform and level meters.
   ===================================================================== */

// A fake-but-consistent waveform shape for a track (same track = same shape)
function makeBars(id) {
  let seed = hue(id) + 7;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  return Array.from({ length: 110 }, (_, i) => clamp(0.25 + 0.5 * Math.abs(Math.sin(i / 9)) + rand() * 0.35, 0.12, 1));
}

function drawWave(d) {
  const cv = $('#w-' + d);
  if (!cv.offsetParent) return;                       // screen not visible, skip
  const dpr = Math.min(window.devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d'), st = deck[d];
  g.clearRect(0, 0, w, h);

  if (!st.track) {                                    // empty deck: a flat line
    g.fillStyle = 'rgba(255,255,255,.12)';
    g.fillRect(0, h / 2 - dpr, w, 2 * dpr);
    return;
  }
  const bars = st.bars, n = bars.length, gap = w / n, prog = st.pos / st.track.len;
  const color = d === 'A' ? '241,238,154' : '127,182,255';   // yellow / blue
  bars.forEach((v, i) => {
    const bh = Math.max(3 * dpr, v * h * 0.92);
    g.fillStyle = (i / n <= prog) ? `rgba(${color},.95)` : 'rgba(255,255,255,.2)';   // played part is colored
    g.fillRect(i * gap + gap * 0.18, (h - bh) / 2, gap * 0.64, bh);
  });
  g.fillStyle = '#fff';                               // playhead line
  g.fillRect(prog * w - dpr, 0, 2 * dpr, h);
}

let lastFrame = performance.now();
const buf = new Uint8Array(256);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  DECKS.forEach(d => {
    const st = deck[d];

    // Platter: 33 1/3 rpm = 200 degrees per second, scaled by pitch
    if (st.playing) st.angle = (st.angle + dt * 200 * rate(d)) % 360;
    $('#p-' + d).style.transform = `rotate(${st.angle}deg)`;

    // Timers
    const len = st.track ? st.track.len : 0;
    $('#cur-' + d).textContent = fmt(st.pos);
    $('#rem-' + d).textContent = '-' + fmt(len - st.pos);

    // Level meter: measure the real loudness (RMS) from the analyser
    let target = 0;
    if (ctx && st.playing) {
      st.an.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      target = clamp(Math.sqrt(sum / buf.length) * 3.2, 0, 1);
    }
    st.level += (target - st.level) * 0.35;           // smooth so it does not flicker
    const pct = Math.round(st.level * 100);
    $('#bar' + d).style.width = pct + '%';
    $('#lv' + d).textContent = pct + '%';

    drawWave(d);
  });
}


/* =====================================================================
   8. START-UP
   ===================================================================== */
['xfade', 'vol-A', 'vol-B', 'pit-A', 'pit-B'].forEach(id => paintRange($('#' + id)));   // color the sliders
$('#chipLib').textContent = TRACKS.length + ' tracks';

// Start with two songs already loaded so the screen is not empty
loadTrack('A', 't1');
loadTrack('B', 't3');
requestAnimationFrame(frame);
