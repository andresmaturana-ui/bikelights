'use strict';

/* =========================================================
   Señalizador: luces de giro y freno para ciclistas por voz
   ========================================================= */

const STORAGE_KEY = 'senalizador.settings.v1';
const SETTINGS_VERSION = 2;
const OFF = 0.08; // intensidad de una luz "apagada": se ve la silueta, pero tenue

// ---------- Ritmos ----------

const IDLE_PATTERNS = {
  lento:   { label: 'Intermitente lento',  fn: (t) => (t % 1000 < 500 ? 0.85 : 0.35) },
  rapido:  { label: 'Intermitente rápido', fn: (t) => (t % 400 < 200 ? 0.85 : 0.35) },
  doble:   { label: 'Doble destello',      fn: (t) => { const p = t % 1200; return p < 100 || (p >= 220 && p < 320) ? 1 : 0.35; } },
  pulso:   { label: 'Pulso suave',         fn: (t) => 0.35 + 0.5 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 1600)) },
  fijo:    { label: 'Fija',                fn: () => 0.8 },
  apagado: { label: 'Apagada',             fn: () => OFF },
};

// Los intermitentes se dibujan como franjas de LED. Cada patrón recibe el tiempo,
// el índice de la franja (0 = la más cercana al centro, n - 1 = la punta) y el total.
const SEGMENTS = 7;

// Secuencial como en Mazda/Audi: las franjas se encienden una tras otra hacia afuera y se apagan juntas
const sequential = (period, sweep, hold) => (t, k, n) => {
  const p = t % period;
  return p >= (k * sweep) / (n - 1) && p < sweep + hold ? 1 : OFF;
};

const TURN_PATTERNS = {
  secuencial: { label: 'Secuencial LED (tipo Mazda/Audi)', fn: sequential(760, 300, 200) },
  secuencialRapido: { label: 'Secuencial rápido', fn: sequential(480, 180, 120) },
  cometa:  { label: 'Cometa (una luz que corre hacia afuera)', fn: (t, k, n) => {
    const d = ((t % 640) / 640) * (n + 3) - k;
    return d >= 0 && d < 3 ? Math.max(OFF, 1 - d / 3) : OFF;
  } },
  normal:  { label: 'Clásico (todo junto)',  fn: (t) => (t % 660 < 360 ? 1 : OFF) },
  rapido:  { label: 'Clásico rápido',        fn: (t) => (t % 320 < 170 ? 1 : OFF) },
  doble:   { label: 'Doble destello',        fn: (t) => { const p = t % 900; return p < 120 || (p >= 240 && p < 360) ? 1 : OFF; } },
};

// Al comenzar el recorrido: animación de bienvenida, como los autos al desbloquearse
const WELCOME_MS = 1600;

// ---------- Comandos ----------

const ACTIONS = {
  left:   { label: 'Girar a la izquierda', defaults: 'izquierda' },
  right:  { label: 'Girar a la derecha',   defaults: 'derecha' },
  brake:  { label: 'Frenando',             defaults: 'frenando, freno, frena' },
  hazard: { label: 'Luces de peligro (ambos lados)', defaults: 'peligro, balizas' },
  stop:   { label: 'Apagar señales',       defaults: 'apagar, cancelar, listo' },
  rhythm: { label: 'Cambiar ritmo de la luz roja', defaults: 'cambiar ritmo, ritmo' },
  sound:  { label: 'Prender o apagar el sonido', defaults: 'sonido' },
};

const DEFAULT_SETTINGS = {
  commands: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, a.defaults])),
  lang: 'es-CL',
  vibrate: true,
  sound: true,
  volume: 0.6,
  turnSeconds: 10,
  turnPattern: 'secuencial',
  brakeSeconds: 4,
  brakeRampSeconds: 1,
  brakeEffect: 'anillos',
  idlePattern: 'lento',
  gpsCancel: true,
  layout: 'auto',
  display: 'una',
  riderName: '',
  emergencyMessage: 'EMERGENCIA: {nombre} puede haber tenido un accidente en bicicleta y necesita ayuda.',
  contacts: [],
  publicEmergency: '131',
  callDelaySeconds: 3,
  onboarded: false,
  version: SETTINGS_VERSION,
};

let settings = loadSettings();

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // v2: el freno pasa a durar 4 s con pulsos; se descartan los valores guardados de antes
    if ((saved.version || 1) < 2) {
      delete saved.brakeSeconds;
      delete saved.brakeEffect;
    }
    saved.version = SETTINGS_VERSION;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      commands: { ...DEFAULT_SETTINGS.commands, ...(saved.commands || {}) },
      contacts: Array.isArray(saved.contacts) ? saved.contacts : [],
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* modo privado */ }
}

// ---------- Utilidades ----------

const $ = (sel) => document.querySelector(sel);

function icon(name, cls = 'ic') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

function phrasesFor(action) {
  return (settings.commands[action] || '')
    .split(',')
    .map(normalize)
    .filter(Boolean);
}

let toastTimer;
function showHeard(text, ms = 3000) {
  const el = $('#heard');
  el.textContent = text;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { el.textContent = ''; }, ms);
}

function buzz(pattern = 60) {
  if (settings.vibrate && navigator.vibrate) navigator.vibrate(pattern);
}

/* =========================================================
   Estado de las luces y animación
   ========================================================= */

const state = {
  turn: null,    // { side: 'left'|'right', start, until, baseBearing }
  hazard: null,  // { start }
  brake: null,   // { start, until }
  welcome: null, // { start }
};

const lights = {
  left: $('#light-left'),
  right: $('#light-right'),
  brake: $('#light-brake'),
};

function doAction(action, source = 'voz') {
  const now = performance.now();
  switch (action) {
    case 'left':
    case 'right':
      state.hazard = null;
      // Repetir el comando reinicia los 10 s; se conserva el rumbo inicial si ya se estaba girando a ese lado
      state.turn = {
        side: action,
        start: now,
        until: now + settings.turnSeconds * 1000,
        baseBearing: state.turn?.side === action ? state.turn.baseBearing : freshBearing(),
      };
      break;
    case 'brake':
      state.brake = { start: now, until: now + settings.brakeSeconds * 1000 };
      brakeSound();
      break;
    case 'hazard':
      state.turn = null;
      state.hazard = state.hazard ? null : { start: now };
      break;
    case 'stop':
      state.turn = null;
      state.hazard = null;
      state.brake = null;
      break;
    case 'sound':
      settings.sound = !settings.sound;
      saveSettings();
      showHeard(settings.sound ? 'Sonido encendido' : 'Sonido apagado');
      if (settings.sound) beep(1200, 0.08);
      break;
    case 'rhythm': {
      const keys = Object.keys(IDLE_PATTERNS);
      settings.idlePattern = keys[(keys.indexOf(settings.idlePattern) + 1) % keys.length];
      saveSettings();
      showHeard(`Ritmo: ${IDLE_PATTERNS[settings.idlePattern].label}`);
      break;
    }
  }
  if (source === 'voz') buzz();
  document.dispatchEvent(new CustomEvent('signal', { detail: action }));
}

// Franjas de cada triángulo y su intensidad mostrada (suavizada como un LED real)
function buildSegments(svg, side) {
  const group = svg.querySelector('.segs');
  const width = 92 / SEGMENTS;
  const rects = [];
  for (let k = 0; k < SEGMENTS; k++) {
    // k = 0 es la franja junto al cuadrado; la última es la punta del triángulo
    const x = side === 'left' ? 96 - (k + 1) * width : 4 + k * width;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', (x + 0.4).toFixed(2));
    rect.setAttribute('y', '0');
    rect.setAttribute('width', (width - 0.8).toFixed(2));
    rect.setAttribute('height', '100');
    group.append(rect);
    rects.push(rect);
  }
  return { svg, rects, shown: new Array(SEGMENTS).fill(OFF) };
}

const turnLights = {
  left: buildSegments(lights.left, 'left'),
  right: buildSegments(lights.right, 'right'),
};

// El cuadrado de freno son anillos concéntricos; k = 0 es el centro
const RINGS = 5;
function buildRings(svg) {
  const group = svg.querySelector('.segs');
  const step = 46 / RINGS;
  const rects = [];
  const square = (h) => `M${50 - h},${50 - h}H${50 + h}V${50 + h}H${50 - h}Z`;
  for (let k = 0; k < RINGS; k++) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const outer = (k + 1) * step;
    const inner = k * step + 0.8;
    path.setAttribute('d', k === 0 ? square(outer) : square(outer) + square(inner));
    path.setAttribute('fill-rule', 'evenodd');
    group.append(path);
    rects.push(path);
  }
  return { svg, rects, shown: new Array(RINGS).fill(OFF) };
}
const brakeLight = buildRings(lights.brake);

// Efecto de freno: los anillos se encienden del centro hacia afuera mientras la intensidad sube
// Pulso de freno: los anillos se encienden del centro hacia afuera, bajan y vuelven a empezar
const BRAKE_PULSE_MS = 650;
const BRAKE_EFFECTS = {
  anillos: { label: 'Anillos que pulsan del centro hacia afuera (tipo Mazda)', fn: (t, k, level) => {
    const p = t % BRAKE_PULSE_MS;
    return p >= k * 60 && p < 520 ? level : 0.4 * level;
  } },
  anillosUnaVez: { label: 'Anillos una sola vez', fn: (t, k, level) => (t >= k * 60 ? level : OFF) },
  clasico: { label: 'Clásico (todo junto)', fn: (t, k, level) => level },
};
let lastFrame = performance.now();

// Los LED encienden rápido y se apagan con una cola suave
function smooth(current, target, dt) {
  const tau = target > current ? 25 : 90;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function paintSegments(light, valueAt, dt) {
  let max = 0;
  light.rects.forEach((rect, k) => {
    const v = smooth(light.shown[k], valueAt(k), dt);
    light.shown[k] = v;
    rect.style.opacity = v.toFixed(3);
    max = Math.max(max, v);
  });
  light.svg.classList.toggle('on', max > 0.5);
}

function render(now) {
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  const turnFn = (TURN_PATTERNS[settings.turnPattern] || TURN_PATTERNS.secuencial).fn;
  const idleFn = (IDLE_PATTERNS[settings.idlePattern] || IDLE_PATTERNS.lento).fn;
  const off = () => OFF;

  // Intermitentes
  let left = off;
  let right = off;
  if (state.turn && now >= state.turn.until) state.turn = null;
  if (state.welcome && now - state.welcome.start >= WELCOME_MS) state.welcome = null;
  if (state.welcome) {
    const t = now - state.welcome.start;
    left = right = (k) => TURN_PATTERNS.secuencial.fn(t, k, SEGMENTS);
  } else if (state.hazard) {
    left = right = (k) => turnFn(now - state.hazard.start, k, SEGMENTS);
  } else if (state.turn) {
    const turn = state.turn;
    const fn = (k) => turnFn(now - turn.start, k, SEGMENTS);
    if (turn.side === 'left') left = fn; else right = fn;
  }

  // Freno: sube de 40 % a 100 % y se mantiene; al terminar vuelve al ritmo de reposo
  let brake;
  const brakeFn = (BRAKE_EFFECTS[settings.brakeEffect] || BRAKE_EFFECTS.anillos).fn;
  if (state.brake && now < state.brake.until) {
    const ramp = settings.brakeRampSeconds * 1000;
    const t = now - state.brake.start;
    const level = ramp > 0 ? Math.min(1, 0.4 + 0.6 * (t / ramp)) : 1;
    brake = (k) => brakeFn(t, k, level);
  } else if (state.welcome) {
    const t = now - state.welcome.start;
    brake = (k) => BRAKE_EFFECTS.anillosUnaVez.fn(t / 2, k, Math.min(1, t / 900));
  } else {
    state.brake = null;
    const v = idleFn(now);
    brake = () => v;
  }

  // Tic al encender el intermitente y tac al apagarlo, como en un auto
  const blinking = state.hazard || state.turn;
  const turnOn = blinking && !state.welcome ? (state.hazard ? left(0) : (state.turn.side === 'left' ? left(0) : right(0))) > 0.5 : false;
  if (turnOn !== lastTurnOn) {
    if (blinking && !state.welcome) turnOn ? tick() : tock();
    lastTurnOn = turnOn;
  }

  showOnly(currentSignal(now));
  paintSegments(turnLights.left, left, dt);
  paintSegments(turnLights.right, right, dt);
  paintSegments(brakeLight, brake, dt);
  requestAnimationFrame(render);
}

/* ---------- Sonido ---------- */

let audioCtx = null;
let lastTurnOn = false;

function ensureAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

// Tono corto con caída rápida; freqEnd permite un barrido de frecuencia
function beep(freq, duration, freqEnd = freq, type = 'square', level = 1) {
  if (!settings.sound) return;
  const ctx = ensureAudio();
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.4 * level * settings.volume, t + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

const tick = () => beep(2400, 0.025, 1800);
const tock = () => beep(1500, 0.03, 1000, 'square', 0.7);
function brakeSound() {
  beep(950, 0.18, 650, 'sawtooth');
  setTimeout(() => beep(950, 0.18, 650, 'sawtooth'), 220);
}

// En modo "una señal a la vez" se muestra solo la más reciente: el cuadrado por defecto,
// la flecha mientras se gira y el cuadrado otra vez si se frena después
function currentSignal(now) {
  if (state.welcome) return 'brake';
  const brakeActive = state.brake && now < state.brake.until;
  const turning = state.hazard || state.turn;
  if (!turning) return 'brake';
  if (brakeActive && state.brake.start > turning.start) return 'brake';
  return state.hazard ? 'hazard' : state.turn.side;
}

let shownSignal = null;
function showOnly(signal) {
  if (signal === shownSignal) return;
  shownSignal = signal;
  document.body.dataset.show = signal;
}

function applyLayout() {
  document.body.classList.remove('layout-auto', 'layout-horizontal', 'layout-vertical', 'display-una', 'display-tres');
  document.body.classList.add(`layout-${settings.layout}`, `display-${settings.display}`);
}

/* =========================================================
   Reconocimiento de voz
   ========================================================= */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let wantListening = false;
let firedPerResult = new Map(); // índice del resultado -> cuántos comandos ya se ejecutaron
let lastFired = {};             // acción -> momento, para evitar duplicados
let restartDelay = 250;

function findCommands(text) {
  const padded = ` ${normalize(text)} `;
  const hits = [];
  for (const action of Object.keys(ACTIONS)) {
    for (const phrase of phrasesFor(action)) {
      const needle = ` ${phrase} `;
      let i = padded.indexOf(needle);
      while (i !== -1) {
        hits.push({ action, pos: i, len: needle.length });
        i = padded.indexOf(needle, i + 1);
      }
    }
  }
  // Ordena por posición y descarta coincidencias que se solapan (p. ej. "ritmo" dentro de "cambiar ritmo")
  hits.sort((a, b) => a.pos - b.pos || b.len - a.len);
  const result = [];
  let end = -1;
  for (const h of hits) {
    if (h.pos >= end) { result.push(h.action); end = h.pos + h.len - 1; }
  }
  return result;
}

function setMicState(text, cls = '') {
  const el = $('#mic-state');
  el.querySelector('.mic-text').textContent = text;
  el.className = `pill ${cls}`;
}

function startListening() {
  wantListening = true;
  if (!SpeechRecognition) {
    setMicState('Voz no disponible', 'error');
    return;
  }
  if (recognition) return;

  recognition = new SpeechRecognition();
  recognition.lang = settings.lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  firedPerResult = new Map();

  recognition.onstart = () => {
    setMicState('Escuchando', 'listening');
    restartDelay = 250;
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      const actions = findCommands(transcript);
      const done = firedPerResult.get(i) || 0;
      for (const action of actions.slice(done)) {
        const now = performance.now();
        if (now - (lastFired[action] || 0) > 1200) {
          lastFired[action] = now;
          doAction(action, 'voz');
          showHeard(`«${transcript.trim()}»: ${ACTIONS[action].label}`);
        }
      }
      if (actions.length > done) firedPerResult.set(i, actions.length);
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      wantListening = false;
      setMicState('Sin permiso de micrófono', 'error');
    } else if (event.error === 'network') {
      setMicState('Voz sin conexión', 'error');
      restartDelay = Math.min(restartDelay * 2, 5000);
    }
  };

  recognition.onend = () => {
    recognition = null;
    if (wantListening && document.visibilityState === 'visible') {
      setTimeout(() => { if (wantListening) startListening(); }, restartDelay);
    } else if (!wantListening && !$('#mic-state').classList.contains('error')) {
      setMicState('Micrófono apagado');
    }
  };

  try {
    recognition.start();
  } catch {
    recognition = null;
  }
}

function restartListening() {
  if (recognition) {
    recognition.onend = null;
    try { recognition.abort(); } catch { /* ya detenido */ }
    recognition = null;
  }
  if (wantListening) startListening();
}

/* =========================================================
   GPS: rumbo para detectar que el giro terminó + ubicación para SOS
   ========================================================= */

let watchId = null;
let lastPosition = null;   // GeolocationPosition más reciente
let bearing = null;        // rumbo en grados (0 = norte)
let bearingAt = 0;
let anchor = null;         // punto desde el que se calcula el rumbo

const TURN_DONE_DEGREES = 55;

function startGps() {
  if (!('geolocation' in navigator) || watchId !== null) return;
  watchId = navigator.geolocation.watchPosition(onPosition, () => {}, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 30000,
  });
}

function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingBetween(a, b) {
  const toRad = Math.PI / 180;
  const y = Math.sin((b.longitude - a.longitude) * toRad) * Math.cos(b.latitude * toRad);
  const x = Math.cos(a.latitude * toRad) * Math.sin(b.latitude * toRad) -
    Math.sin(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.cos((b.longitude - a.longitude) * toRad);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function angleDiff(to, from) {
  return ((to - from + 540) % 360) - 180; // -180..180, negativo = giro a la izquierda
}

function freshBearing() {
  return bearing !== null && performance.now() - bearingAt < 8000 ? bearing : null;
}

function onPosition(pos) {
  lastPosition = pos;
  const c = pos.coords;
  if (c.accuracy > 30) return;

  let newBearing = null;
  if (c.heading !== null && !Number.isNaN(c.heading) && (c.speed || 0) > 1.5) {
    newBearing = c.heading;
  } else if (anchor && distanceMeters(anchor, c) >= 8) {
    newBearing = bearingBetween(anchor, c);
  }
  if (!anchor || newBearing !== null) anchor = { latitude: c.latitude, longitude: c.longitude };
  if (newBearing === null) return;

  bearing = newBearing;
  bearingAt = performance.now();

  const turn = state.turn;
  if (!settings.gpsCancel || !turn) return;
  if (turn.baseBearing === null) {
    turn.baseBearing = bearing;
    return;
  }
  const delta = angleDiff(bearing, turn.baseBearing);
  const done = turn.side === 'left' ? delta <= -TURN_DONE_DEGREES : delta >= TURN_DONE_DEGREES;
  if (done) {
    turn.until = Math.min(turn.until, performance.now() + 1000);
    showHeard('Giro detectado por GPS');
  }
}

/* =========================================================
   Pantalla siempre encendida
   ========================================================= */

let wakeLock = null;
let riding = false;

async function keepScreenOn() {
  if (!('wakeLock' in navigator) || wakeLock) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (riding) {
    keepScreenOn();
    if (wantListening && !recognition) startListening();
  }
  if (emergency.awaitingReturn) scheduleEmergencyCall();
});

/* =========================================================
   Inicio
   ========================================================= */

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function renderSupport() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const items = [
    [!!SpeechRecognition, 'Reconocimiento de voz', 'Este navegador no reconoce voz: usa los botones o prueba Chrome en Android.'],
    ['wakeLock' in navigator, 'Pantalla siempre encendida', 'No se puede impedir que la pantalla se apague: desactiva el bloqueo automático en los ajustes del teléfono.'],
    ['geolocation' in navigator, 'GPS', 'Sin GPS: no hay ubicación para el SOS ni detección de giro.'],
  ];
  const list = $('#support');
  list.innerHTML = '';
  for (const [ok, name, warning] of items) {
    const li = document.createElement('li');
    li.innerHTML = icon(ok ? 'check' : 'alert', 'ic-sm');
    li.append(ok ? name : warning);
    if (!ok) li.className = 'warn';
    list.append(li);
  }
  if (isIOS) {
    const li = document.createElement('li');
    li.className = 'warn';
    li.innerHTML = icon('alert', 'ic-sm');
    li.append('En iPhone el reconocimiento de voz se corta con frecuencia y puede pausar la música.');
    list.append(li);
  }
  if (!settings.contacts.length) {
    const li = document.createElement('li');
    li.className = 'warn';
    li.innerHTML = icon('alert', 'ic-sm');
    li.append('Agrega al menos un contacto de emergencia en Ajustes.');
    list.append(li);
  }
  const words = (a) => phrasesFor(a)[0] || '—';
  $('#start-commands').textContent =
    `Di «${words('left')}», «${words('right')}» o «${words('brake')}». Puedes cambiar las palabras en Ajustes.`;
}

// Mientras se pedalea los controles se esconden para dejar toda la pantalla a la señal.
// El botón SOS queda siempre visible; un toque en la pantalla muestra los controles.
let hudTimer = null;
function showHud() {
  document.body.classList.remove('hud-hidden');
  clearTimeout(hudTimer);
  if (riding) hudTimer = setTimeout(() => document.body.classList.add('hud-hidden'), 5000);
}
document.addEventListener('pointerdown', showHud);

async function startRide() {
  riding = true;
  ensureAudio();
  showHud();
  state.welcome = { start: performance.now() };
  $('#start').classList.add('hidden');
  try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch { /* opcional */ }
  keepScreenOn();
  startGps();
  startListening();
}

$('#btn-start').addEventListener('click', startRide);
$('#btn-start-settings').addEventListener('click', openSettings);
$('#btn-settings').addEventListener('click', openSettings);

for (const btn of document.querySelectorAll('.ctl')) {
  btn.addEventListener('click', () => doAction(btn.dataset.action, 'toque'));
}

/* =========================================================
   Emergencia
   ========================================================= */

const HOLD_MS = 1000;
const emergency = { awaitingReturn: false, countdown: null };

function digits(phone) {
  return (phone || '').replace(/\D/g, '');
}

function telHref(phone) {
  return `tel:${(phone || '').replace(/[^\d+*#]/g, '')}`;
}

function mapsLink(pos) {
  const { latitude, longitude } = pos.coords;
  return `https://maps.google.com/?q=${latitude.toFixed(6)},${longitude.toFixed(6)}`;
}

function emergencyText() {
  const name = settings.riderName.trim() || 'un ciclista';
  let text = settings.emergencyMessage.replaceAll('{nombre}', name);
  if (lastPosition) {
    const time = new Date(lastPosition.timestamp).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    text += `\nUbicación: ${mapsLink(lastPosition)} (±${Math.round(lastPosition.coords.accuracy)} m, ${time})`;
  } else {
    text += '\nUbicación no disponible.';
  }
  return text;
}

function whatsappUrl(contact) {
  return `https://wa.me/${digits(contact.phone)}?text=${encodeURIComponent(emergencyText())}`;
}

function renderEmergency() {
  const loc = $('#em-location');
  loc.textContent = lastPosition
    ? `${lastPosition.coords.latitude.toFixed(6)}, ${lastPosition.coords.longitude.toFixed(6)} (±${Math.round(lastPosition.coords.accuracy)} m)`
    : 'Buscando ubicación…';

  const primary = settings.contacts[0];
  $('#em-whatsapp').classList.toggle('hidden', !primary);
  if (primary) $('.em-wa-text').textContent = `Enviar WhatsApp a ${primary.name || primary.phone}`;

  const calls = $('#em-calls');
  calls.innerHTML = '';
  const addCall = (label, phone) => {
    const a = document.createElement('a');
    a.href = telHref(phone);
    a.className = 'primary call';
    a.innerHTML = icon('phone');
    a.append(label);
    a.addEventListener('click', cancelCountdown);
    calls.append(a);
  };
  for (const c of settings.contacts) addCall(`Llamar a ${c.name || c.phone}`, c.phone);
  if (settings.publicEmergency) addCall(`Emergencias ${settings.publicEmergency}`, settings.publicEmergency);
}

function sendWhatsapp() {
  const primary = settings.contacts[0];
  if (!primary) return;
  window.open(whatsappUrl(primary), '_blank', 'noopener');
  emergency.awaitingReturn = true;
  // Si WhatsApp no llegó a abrirse (la página sigue visible), igual se programa la llamada
  setTimeout(() => {
    if (emergency.awaitingReturn && document.visibilityState === 'visible') scheduleEmergencyCall();
  }, 4000);
}

function triggerEmergency() {
  startGps();
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition((p) => { lastPosition = p; renderEmergency(); }, () => {}, {
      enableHighAccuracy: true, maximumAge: 10000, timeout: 15000,
    });
  }
  renderEmergency();
  $('#emergency').classList.remove('hidden');
  buzz([200, 100, 200]);

  if (!settings.contacts.length) {
    $('#em-status').textContent = 'No hay contactos configurados. Llama a emergencias:';
    return;
  }
  // Se abre WhatsApp en el mismo gesto del usuario (los navegadores bloquean aperturas sin un toque)
  sendWhatsapp();
  $('#em-status').textContent = 'Se abrió WhatsApp con el mensaje: presiona Enviar y vuelve a esta app para llamar.';
}

function scheduleEmergencyCall() {
  emergency.awaitingReturn = false;
  const primary = settings.contacts[0];
  if (!primary || emergency.countdown) return;
  let left = Math.max(0, Number(settings.callDelaySeconds) || 0);
  const name = primary.name || primary.phone;
  const tick = () => {
    if (left <= 0) {
      emergency.countdown = null;
      $('#em-status').textContent = `Llamando a ${name}… Si no se abre la llamada, toca el botón.`;
      window.location.href = telHref(primary.phone);
      return;
    }
    $('#em-status').textContent = `Llamando a ${name} en ${left}…`;
    left -= 1;
    emergency.countdown = setTimeout(tick, 1000);
  };
  tick();
}

function cancelCountdown() {
  clearTimeout(emergency.countdown);
  emergency.countdown = null;
  emergency.awaitingReturn = false;
}

$('#em-whatsapp').addEventListener('click', () => {
  cancelCountdown();
  sendWhatsapp();
});

$('#em-close').addEventListener('click', () => {
  cancelCountdown();
  $('#emergency').classList.add('hidden');
});

// Botón SOS: hay que mantenerlo presionado para evitar activaciones accidentales.
// Se dispara al soltar, porque abrir WhatsApp requiere un gesto del usuario.
(() => {
  const btn = $('#btn-sos');
  btn.style.setProperty('--hold-ms', `${HOLD_MS}ms`);
  let timer = null;
  let armed = false;

  const reset = () => {
    clearTimeout(timer);
    timer = null;
    btn.classList.remove('holding');
  };

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    armed = false;
    btn.classList.add('holding');
    timer = setTimeout(() => {
      armed = true;
      buzz(100);
      btn.querySelector('small').textContent = 'suelta para enviar';
    }, HOLD_MS);
  });

  btn.addEventListener('pointerup', () => {
    const fire = armed;
    reset();
    armed = false;
    btn.querySelector('small').textContent = 'mantén presionado';
    if (fire) triggerEmergency();
    else showHeard('Mantén presionado SOS un segundo para pedir ayuda');
  });

  btn.addEventListener('pointercancel', () => { reset(); armed = false; });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
})();

/* =========================================================
   Ajustes
   ========================================================= */

const dialog = $('#settings');
const form = $('#settings-form');

function fillSelect(select, patterns) {
  select.innerHTML = '';
  for (const [key, p] of Object.entries(patterns)) select.add(new Option(p.label, key));
}
fillSelect($('#idle-pattern'), IDLE_PATTERNS);
fillSelect($('#turn-pattern'), TURN_PATTERNS);
fillSelect($('#brake-effect'), BRAKE_EFFECTS);

function contactRow(contact = { name: '', phone: '' }) {
  const row = document.createElement('div');
  row.className = 'contact';
  row.innerHTML = `
    <input type="text" placeholder="Nombre" class="c-name" autocomplete="off">
    <input type="tel" placeholder="+56 9 1234 5678" class="c-phone" autocomplete="off">
    <button type="button" aria-label="Quitar">${icon('close', 'ic-sm')}</button>`;
  row.querySelector('.c-name').value = contact.name;
  row.querySelector('.c-phone').value = contact.phone;
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}

function populateForm() {
  const cmd = $('#command-fields');
  cmd.innerHTML = '';
  for (const [key, a] of Object.entries(ACTIONS)) {
    const label = document.createElement('label');
    label.textContent = a.label;
    const input = document.createElement('input');
    input.type = 'text';
    input.name = `cmd-${key}`;
    input.value = settings.commands[key];
    input.autocapitalize = 'off';
    label.append(input);
    cmd.append(label);
  }

  for (const el of form.elements) {
    if (!el.name || el.name.startsWith('cmd-')) continue;
    if (el.type === 'checkbox') el.checked = !!settings[el.name];
    else if (el.name in settings) el.value = settings[el.name];
  }

  const contacts = $('#contacts');
  contacts.innerHTML = '';
  for (const c of settings.contacts) contacts.append(contactRow(c));
  if (!settings.contacts.length) contacts.append(contactRow());
}

function readForm() {
  const next = { ...settings, commands: { ...settings.commands } };
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.name.startsWith('cmd-')) next.commands[el.name.slice(4)] = el.value;
    else if (el.type === 'checkbox') next[el.name] = el.checked;
    else if (el.type === 'number' || el.type === 'range') next[el.name] = Number(el.value) || DEFAULT_SETTINGS[el.name];
    else next[el.name] = el.value;
  }
  next.contacts = [...document.querySelectorAll('#contacts .contact')]
    .map((row) => ({ name: row.querySelector('.c-name').value.trim(), phone: row.querySelector('.c-phone').value.trim() }))
    .filter((c) => digits(c.phone).length >= 6);
  return next;
}

function openSettings() {
  populateForm();
  dialog.showModal();
}

form.addEventListener('submit', () => {
  const next = readForm();
  const langChanged = next.lang !== settings.lang;
  settings = next;
  saveSettings();
  applyLayout();
  renderSupport();
  if (langChanged) restartListening();
});

$('#btn-add-contact').addEventListener('click', () => $('#contacts').append(contactRow()));

$('#btn-reset').addEventListener('click', () => {
  const contacts = settings.contacts;
  settings = { ...structuredClone(DEFAULT_SETTINGS), contacts };
  populateForm();
});

// Selector de contactos (solo Chrome en Android): no lee la agenda, el usuario elige
const canPickContacts = 'contacts' in navigator && 'ContactsManager' in window;

async function pickContacts(multiple) {
  const chosen = await navigator.contacts.select(['name', 'tel'], { multiple });
  return chosen
    .filter((c) => c.tel?.length)
    .map((c) => ({ name: c.name?.[0] || '', phone: c.tel[0] }));
}

if (canPickContacts) {
  const pick = $('#btn-pick-contact');
  pick.classList.remove('hidden');
  pick.addEventListener('click', async () => {
    try {
      const chosen = await pickContacts(true);
      const list = $('#contacts');
      // Reemplaza filas vacías por los contactos elegidos
      for (const row of [...list.querySelectorAll('.contact')]) {
        if (!row.querySelector('.c-phone').value.trim()) row.remove();
      }
      for (const c of chosen) list.append(contactRow(c));
    } catch { /* cancelado */ }
  });
}


/* =========================================================
   Guía inicial
   ========================================================= */

// Ilustraciones con figuras básicas
const ART = {
  lights: `<svg viewBox="0 0 220 100">
    <polygon points="10,50 70,18 70,82" class="a-orange"/>
    <rect x="80" y="20" width="60" height="60" class="a-red"/>
    <polygon points="210,50 150,18 150,82" class="a-orange"/></svg>`,
  voice: `<svg viewBox="0 0 220 120">
    <circle cx="110" cy="60" r="54" class="a-ring a-pulse2"/>
    <circle cx="110" cy="60" r="36" class="a-ring a-pulse1"/>
    <circle cx="110" cy="60" r="18" class="a-orange"/></svg>`,
  location: `<svg viewBox="0 0 220 120">
    <circle cx="110" cy="60" r="54" class="a-ring"/>
    <circle cx="110" cy="60" r="32" class="a-ring"/>
    <circle cx="110" cy="60" r="12" class="a-red"/></svg>`,
  commands: `<svg viewBox="0 0 220 100">
    <polygon id="wz-left" points="10,50 70,18 70,82" class="a-orange a-dim"/>
    <rect id="wz-brake" x="80" y="20" width="60" height="60" class="a-red a-dim"/>
    <polygon id="wz-right" points="210,50 150,18 150,82" class="a-orange a-dim"/></svg>`,
  sos: `<svg viewBox="0 0 220 120">
    <circle cx="110" cy="60" r="56" class="a-red"/>
    <text x="110" y="72" text-anchor="middle" class="a-text">SOS</text></svg>`,
  mount: `<svg viewBox="0 0 220 120">
    <rect x="60" y="6" width="100" height="108" rx="12" class="a-ring"/>
    <polygon points="72,60 92,48 92,72" class="a-orange"/>
    <rect x="98" y="48" width="24" height="24" class="a-red"/>
    <polygon points="148,60 128,48 128,72" class="a-orange"/>
    <circle cx="190" cy="24" r="10" class="a-white"/>
    <g class="a-rays"><line x1="190" y1="4" x2="190" y2="8"/><line x1="190" y1="40" x2="190" y2="44"/>
    <line x1="170" y1="24" x2="174" y2="24"/><line x1="206" y1="24" x2="210" y2="24"/></g></svg>`,
  done: `<svg viewBox="0 0 220 120">
    <circle cx="110" cy="60" r="54" class="a-green"/>
    <polyline points="84,62 102,80 138,42" class="a-check"/></svg>`,
};

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

function okLine(text, ok = true) {
  return `<p class="wz-status ${ok ? 'ok' : 'bad'}">${icon(ok ? 'check' : 'alert', 'ic-sm')}<span>${text}</span></p>`;
}

const WIZARD_STEPS = [
  {
    art: ART.lights,
    title: 'Hola',
    text: 'Tu teléfono será la luz trasera de tu bici: giros y freno, con tu voz.',
  },
  {
    art: ART.voice,
    title: 'Micrófono',
    text: 'Para escuchar tus órdenes mientras pedaleas.',
    action: {
      label: 'Permitir micrófono',
      async run(body) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          body.innerHTML = okLine('Micrófono listo');
        } catch {
          body.innerHTML = okLine('Sin permiso. Puedes activarlo después en los ajustes del navegador.', false);
        }
      },
    },
  },
  {
    art: ART.location,
    title: 'Ubicación',
    text: 'Para enviar dónde estás en una emergencia y apagar el giro cuando ya doblaste.',
    action: {
      label: 'Permitir ubicación',
      run(body) {
        if (!('geolocation' in navigator)) {
          body.innerHTML = okLine('Este teléfono no tiene GPS disponible.', false);
          return;
        }
        body.innerHTML = '<p class="small">Buscando…</p>';
        navigator.geolocation.getCurrentPosition(
          (p) => { lastPosition = p; body.innerHTML = okLine('Ubicación lista'); },
          () => { body.innerHTML = okLine('Sin permiso de ubicación.', false); },
          { enableHighAccuracy: true, timeout: 20000 },
        );
      },
    },
  },
  {
    art: ART.commands,
    title: 'Prueba tu voz',
    text: '',
    enter(text) {
      const w = (a) => phrasesFor(a)[0] || '—';
      text.textContent = `Di «${w('left')}», «${w('brake')}» o «${w('right')}». La figura se enciende.`;
    },
    action: {
      label: 'Probar',
      run(body) {
        if (!SpeechRecognition) {
          body.innerHTML = okLine('Este navegador no reconoce voz. Usa los botones de la pantalla o Chrome en Android.', false);
          return;
        }
        startListening();
        body.innerHTML = '<p class="small">Escuchando… Puedes cambiar las palabras en Ajustes.</p>';
      },
    },
  },
  {
    art: ART.sos,
    title: 'Contacto de emergencia',
    text: 'Recibirá un WhatsApp con tu ubicación y luego una llamada.',
    enter(text, body) {
      const c = settings.contacts[0] || { name: '', phone: '' };
      body.innerHTML = `
        <input id="wz-name" type="text" placeholder="Nombre" autocomplete="off">
        <input id="wz-phone" type="tel" placeholder="+56 9 1234 5678" autocomplete="off">
        ${canPickContacts ? '<button id="wz-pick" type="button" class="secondary">Elegir de la agenda</button>' : ''}`;
      $('#wz-name').value = c.name;
      $('#wz-phone').value = c.phone;
      $('#wz-pick')?.addEventListener('click', async () => {
        try {
          const [picked] = await pickContacts(false);
          if (picked) { $('#wz-name').value = picked.name; $('#wz-phone').value = picked.phone; }
        } catch { /* cancelado */ }
      });
    },
    leave() {
      const phone = $('#wz-phone').value.trim();
      if (digits(phone).length < 6) return;
      const contact = { name: $('#wz-name').value.trim(), phone };
      settings.contacts = [contact, ...settings.contacts.slice(1)];
      saveSettings();
    },
  },
  {
    art: ART.mount,
    title: 'Monta el teléfono',
    text: 'Pantalla mirando hacia atrás y brillo al máximo.',
    enter(text, body) {
      if (isStandalone()) return;
      if (installPrompt) {
        body.innerHTML = '<button id="wz-install" type="button" class="secondary">Instalar en la pantalla de inicio</button>';
        $('#wz-install').addEventListener('click', async () => {
          installPrompt.prompt();
          await installPrompt.userChoice;
          installPrompt = null;
          body.innerHTML = okLine('Instalada');
        });
      } else if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
        body.innerHTML = '<p class="small">Para instalarla: botón Compartir y luego «Agregar a inicio».</p>';
      }
    },
  },
  {
    art: ART.done,
    title: 'Listo',
    text: 'Toca Comenzar cada vez que salgas a pedalear.',
    last: true,
  },
];

let wizardStep = 0;

function showWizardStep(i) {
  const prev = WIZARD_STEPS[wizardStep];
  if (i !== wizardStep) prev.leave?.();
  wizardStep = i;
  const step = WIZARD_STEPS[i];
  $('#wz-art').innerHTML = step.art;
  $('#wz-title').textContent = step.title;
  const text = $('#wz-text');
  text.textContent = step.text;
  const body = $('#wz-body');
  body.innerHTML = '';
  step.enter?.(text, body);
  if (step.action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'primary wz-action';
    btn.textContent = step.action.label;
    const result = document.createElement('div');
    btn.addEventListener('click', () => step.action.run(result));
    body.append(btn, result);
  }
  $('#wz-back').classList.toggle('hidden', i === 0);
  $('#wz-next').textContent = step.last ? 'Comenzar' : 'Siguiente';
  $('#wz-dots').innerHTML = WIZARD_STEPS
    .map((_, k) => `<span class="${k === i ? 'on' : k < i ? 'done' : ''}"></span>`)
    .join('');
}

function openWizard() {
  dialog.close();
  $('#start').classList.add('hidden');
  $('#wizard').classList.remove('hidden');
  wizardStep = 0;
  showWizardStep(0);
}

function finishWizard(start) {
  WIZARD_STEPS[wizardStep].leave?.();
  settings.onboarded = true;
  saveSettings();
  renderSupport();
  $('#wizard').classList.add('hidden');
  if (start) startRide();
  else $('#start').classList.remove('hidden');
}

$('#wz-next').addEventListener('click', () => {
  if (WIZARD_STEPS[wizardStep].last) finishWizard(true);
  else showWizardStep(wizardStep + 1);
});
$('#wz-back').addEventListener('click', () => showWizardStep(Math.max(0, wizardStep - 1)));
$('#wz-skip').addEventListener('click', () => finishWizard(false));
$('#btn-guide').addEventListener('click', openWizard);

// En el paso de prueba, la figura correspondiente se enciende al reconocer la palabra
document.addEventListener('signal', (e) => {
  const el = document.getElementById(`wz-${e.detail}`);
  if (!el) return;
  el.classList.remove('a-dim');
  el.classList.add('a-lit');
  setTimeout(() => { el.classList.add('a-dim'); el.classList.remove('a-lit'); }, 1500);
});

/* =========================================================
   Arranque
   ========================================================= */

applyLayout();
renderSupport();
if (!settings.onboarded) openWizard();
requestAnimationFrame(render);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
