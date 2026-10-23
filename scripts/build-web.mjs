// Copia la app web a www/ para empaquetarla en las apps de iPhone y Android (Capacitor).
// En la app se agrega el runtime de Capacitor, que da acceso a la voz nativa.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const FILES = ['index.html', 'app.js', 'styles.css', 'manifest.webmanifest', 'icons', 'fonts', 'img'];

rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`, { recursive: true });
cpSync('node_modules/@capacitor/core/dist/capacitor.js', 'www/capacitor.js');

const html = readFileSync('www/index.html', 'utf8');
const tag = '<script src="app.js"></script>';
if (!html.includes(tag)) throw new Error(`No se encontró ${tag} en index.html`);
writeFileSync('www/index.html', html.replace(tag, `<script src="capacitor.js"></script>\n  ${tag}`));
