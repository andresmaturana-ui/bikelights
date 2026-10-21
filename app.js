'use strict';

/* =========================================================
   Señalizador: luces de giro y freno para ciclistas por voz
   ========================================================= */

const STORAGE_KEY = 'senalizador.settings.v1';
const OFF = 0.08; // intensidad de una luz "apagada": se ve la silueta, pero tenue

// ---------- Ritmos ----------

const IDLE_PATTERNS = {
  lento:   { label: 'Intermitente lento',  fn: (t) => (t % 1000 < 500 ? 0.6 : 0.12) },
  rapido:  { label: 'Intermitente rápido', fn: (t) => (t % 400 < 200 ? 0.6 : 0.12) },
  doble:   { label: 'Doble destello',      fn: (t) => { const p = t % 1200; return p < 100 || (p >= 220 && p < 320) ? 0.7 : 0.12; } },
  pulso:   { label: 'Pulso suave',         fn: (t) => 0.15 + 0.45 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 1600)) },
  fijo:    { label: 'Fija',                fn: () => 0.55 },
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
};

const DEFAULT_SETTINGS = {
  commands: Object.fromEntries(Object.entries(ACTIONS).map(([k, a]) => [k, a.defaults])),
  lang: 'es-CL',
  vibrate: true,
  turnSeconds: 10,
  turnPattern: 'secuencial',
  brakeSeconds: 5,
  brakeRampSeconds: 1,
  idlePattern: 'lento',
  gpsCancel: true,
  layout: 'auto',
  riderName: '',
  emergencyMessage: 'EMERGENCIA: {nombre} puede haber tenido un accidente en bicicleta y necesita ayuda.',
  contacts: [],
  publicEmergency: '131',
  callDelaySeconds: 3,
};

let settings = loadSettings();

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
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
    case 'rhythm': {
      const keys = Object.keys(IDLE_PATTERNS);
      settings.idlePattern = keys[(keys.indexOf(settings.idlePattern) + 1) % keys.length];
      saveSettings();
      showHeard(`Ritmo: ${IDLE_PATTERNS[settings.idlePattern].label}`);
      break;
    }
  }
  if (source === 'voz') buzz();
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
    rect.setAttribute('x', (x + 0.6).toFixed(2));
    rect.setAttribute('y', '0');
    rect.setAttribute('width', (width - 1.2).toFixed(2));
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
let brakeShown = OFF;
let lastFrame = performance.now();

// Los LED encienden rápido y se apagan con una cola suave
function smooth(current, target, dt) {
  const tau = target > current ? 25 : 90;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function paintTurn(light, valueAt, dt) {
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
  if (state.brake && now < state.brake.until) {
    const ramp = settings.brakeRampSeconds * 1000;
    const t = now - state.brake.start;
    brake = ramp > 0 ? Math.min(1, 0.4 + 0.6 * (t / ramp)) : 1;
  } else if (state.welcome) {
    const t = now - state.welcome.start;
    brake = t < 900 ? t / 900 : 1;
  } else {
    state.brake = null;
    brake = idleFn(now);
  }

  paintTurn(turnLights.left, left, dt);
  paintTurn(turnLights.right, right, dt);
  brakeShown = smooth(brakeShown, brake, dt);
  lights.brake.style.setProperty('--i', brakeShown.toFixed(3));
  lights.brake.classList.toggle('on', brakeShown > 0.5);
  requestAnimationFrame(render);
}

function applyLayout() {
  document.body.classList.remove('layout-auto', 'layout-horizontal', 'layout-vertical');
  document.body.classList.add(`layout-${settings.layout}`);
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

async function startRide() {
  riding = true;
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
    else if (el.type === 'number') next[el.name] = Number(el.value) || DEFAULT_SETTINGS[el.name];
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
if ('contacts' in navigator && 'ContactsManager' in window) {
  const pick = $('#btn-pick-contact');
  pick.classList.remove('hidden');
  pick.addEventListener('click', async () => {
    try {
      const chosen = await navigator.contacts.select(['name', 'tel'], { multiple: true });
      const list = $('#contacts');
      // Reemplaza filas vacías por los contactos elegidos
      for (const row of [...list.querySelectorAll('.contact')]) {
        if (!row.querySelector('.c-phone').value.trim()) row.remove();
      }
      for (const c of chosen) {
        if (c.tel?.length) list.append(contactRow({ name: c.name?.[0] || '', phone: c.tel[0] }));
      }
    } catch { /* cancelado */ }
  });
}

/* =========================================================
   Arranque
   ========================================================= */

applyLayout();
renderSupport();
requestAnimationFrame(render);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
