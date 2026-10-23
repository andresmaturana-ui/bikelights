# Señalizador para ciclistas

PWA que convierte el teléfono en una luz trasera de señalización: triángulos naranjos para girar a la izquierda o a la derecha y un cuadrado rojo central para frenar, controlados por voz.

| Horizontal | Vertical |
| --- | --- |
| ◀ ■ ▶ | ▶ arriba, ■ al centro, ◀ abajo |

Por defecto se muestra **una señal grande a la vez**: el rectángulo rojo ocupa toda la pantalla y, al girar, cambia por la flecha grande (en peligro, las dos flechas). Las figuras ocupan toda la pantalla y el botón SOS es un círculo al centro. Mientras se pedalea los controles se esconden y el SOS queda atenuado; un toque en la pantalla los muestra. En Ajustes se puede volver a mostrar las tres figuras juntas.

La disposición cambia sola según cómo esté montado el teléfono (o se fija en Ajustes).

## Guía inicial

La primera vez que se abre, la app guía paso a paso con figuras simples: permisos de micrófono y ubicación, prueba de voz (la figura se enciende al reconocer la palabra), contacto de emergencia, montaje del teléfono e instalación. Se puede repetir desde Ajustes.

## Comandos de voz (se pueden cambiar en Ajustes)

| Di… | Qué pasa |
| --- | --- |
| **izquierda** | El triángulo izquierdo parpadea durante 10 s. Si el GPS detecta que ya giraste, se apaga antes. |
| **derecha** | Lo mismo con el triángulo derecho. |
| **frenando** / freno / frena | Un cuadrado chico en el centro crece hasta llenar la pantalla, una y otra vez (tipo Mazda), mientras la intensidad sube de 40 % a 100 %. A los 4 s vuelve a su ritmo intermitente. |
| **peligro** / balizas | Ambos triángulos parpadean (como las balizas de un auto) hasta que digas «apagar» o «peligro» otra vez. |
| **apagar** / cancelar / listo | Apaga todas las señales. |
| **terminé recorrido** | Apaga las señales, el micrófono y el GPS, y muestra «¡Qué bueno que llegaste bien!». También con el botón de bandera. |
| **sonido** | Prende o apaga el sonido (tic-tac al señalizar, un pitido por cada pulso de freno). |
| **cambiar ritmo** | Cambia el ritmo de la luz roja en reposo (lento, rápido, doble destello, pulso, fija, apagada). |

Los intermitentes son **secuenciales tipo LED** (como Mazda o Audi): las franjas se encienden una tras otra hacia afuera y se apagan juntas, con encendido y apagado suaves. En Ajustes también hay modo cometa, clásico y doble destello. Al tocar «Comenzar» hay una animación de bienvenida, como los autos al desbloquearse.

Cada comando reemplaza al anterior: si frenas mientras giras, se apaga el intermitente y su sonido, y al revés.

Cada acción acepta varias palabras o frases separadas por comas; no importan mayúsculas ni tildes. También hay botones en pantalla como respaldo.

En Ajustes se configuran además la duración del intermitente y del freno, la subida de intensidad del freno, el ritmo del intermitente y el idioma/acento del reconocimiento.

## Botón SOS

Cualquier persona puede **mantener presionado un segundo el círculo SOS del centro y soltar**. Si solo lo toca, aparece un mensaje que explica qué hacer:

1. Se abre WhatsApp con un mensaje para el primer contacto de emergencia, con un enlace de Google Maps a la ubicación del ciclista.
2. Al volver a la app, tras una cuenta regresiva (3 s por defecto) se intenta llamar a ese contacto.
3. La pantalla de emergencia muestra las coordenadas y botones para llamar a cada contacto y al número de emergencias (131 por defecto).

Los contactos se cargan en Ajustes. En Chrome para Android hay un botón «Elegir de la agenda».

## Limitaciones del navegador

Estas son restricciones de las plataformas, no de la app:

- **WhatsApp no se puede enviar solo.** Una web solo puede abrir WhatsApp con el mensaje escrito; alguien tiene que tocar *Enviar*. Enviarlo sin interacción requiere la API de WhatsApp Business y un servidor.
- **La llamada puede requerir un toque.** Los navegadores pueden bloquear abrir `tel:` sin un gesto del usuario; por eso siempre quedan los botones de llamada visibles.
- **No se puede leer la agenda ni los contactos de emergencia del teléfono.** Los contactos se configuran dentro de la app (en Android se pueden elegir desde la agenda).
- **Voz continua:** funciona mejor en **Chrome para Android**. El reconocimiento se reinicia cada pocos segundos de silencio (en algunos teléfonos suena un pitido) y usa internet. En **iPhone** (Safari) el reconocimiento continuo es inestable, se corta seguido y puede no estar disponible al abrir la app desde la pantalla de inicio.
- **Música y llamadas en iPhone:** iOS pausa Spotify mientras el micrófono está activo, y no hay forma de evitarlo desde una web. Por eso el ajuste «Micrófono» tiene tres modos. «Siempre escuchando» es el modo por defecto. «Al tocar la pantalla» escucha 5 s y suelta el micrófono. «Apagado» deja solo los botones o un control Bluetooth, y la música nunca se corta. Los sonidos de la app usan la sesión de audio «ambient», que se mezcla con la música, y el audio se reactiva al volver de una llamada. La solución completa, voz siempre activa sin cortar la música, requiere empaquetar la app como app nativa de iOS.
- **Control Bluetooth:** cualquier control de manubrio que funcione como teclado o presentador sirve. Las teclas son: flecha izquierda o Re Pág para izquierda, flecha derecha o Av Pág para derecha, flecha abajo, espacio o Enter para frenar, flecha arriba para peligro y Esc para apagar.
- **Música de fondo (Android):** en Android la música normalmente sigue sonando mientras se escucha, aunque algunos teléfonos bajan el volumen al activar el micrófono. En iPhone activar el micrófono suele pausar o cambiar el audio. Con audífonos Bluetooth, el sistema puede pasar al micrófono del audífono y bajar la calidad del sonido.
- **Pantalla encendida:** se usa la Wake Lock API (Chrome Android, Safari iOS 16.4+). Si no está disponible, desactiva el bloqueo automático del teléfono. La web no puede subir el brillo: súbelo manualmente.
- **Sonido:** se genera en la app y se mezcla con la música en Android. En iPhone respeta el interruptor de silencio y puede bajar el volumen de la música mientras suena.
- **La app debe quedar en primer plano.** Si cambias de app o bloqueas la pantalla, el micrófono y las luces se detienen.
- **Detección de giro por GPS:** compara el rumbo antes y después de girar (55° o más). Con mala señal o a muy baja velocidad puede no detectarlo; entonces el intermitente dura el tiempo configurado.

## Uso y publicación

Es HTML, CSS y JavaScript sin dependencias ni compilación. Necesita HTTPS (micrófono, GPS y Wake Lock).

- **Probar en local:** `npx http-server .` y abrir `http://localhost:8080` (localhost cuenta como seguro).
- **Publicar:** el workflow `.github/workflows/pages.yml` publica en GitHub Pages en cada push a `main`. Hay que activarlo una vez en *Settings → Pages → Source: GitHub Actions*.
- **Cloudflare Pages:** la app también se publica en https://bikeligts.pages.dev con cada push a `main` (proyecto `bikeligts` conectado al repo; build: `mkdir -p _site && cp -r index.html app.js styles.css sw.js manifest.webmanifest icons fonts img _site/`, salida `_site`). Cada PR recibe además una dirección de vista previa.
- **Instalar:** abrir la URL en el teléfono y elegir «Agregar a la pantalla de inicio».

## App de iPhone (Capacitor)

En Safari, el micrófono pausa la música. La app nativa usa el reconocimiento de voz de iOS con una sesión de audio que se mezcla con Spotify, retoma la escucha sola después de una llamada y mantiene la pantalla encendida. Usa el mismo código web: `scripts/build-web.mjs` lo copia a `www/` y le agrega el runtime de Capacitor. El código nativo está en `ios/App/App/VozPlugin.swift`.

- `npm ci && npm run ios:sync` prepara el proyecto `ios/`.
- Con un Mac, `npm run ios:open` lo abre en Xcode para instalarlo en el teléfono.
- Sin Mac, el workflow «App de iPhone» compila en GitHub Actions. En cada PR solo revisa que compile. Al lanzarlo a mano desde Actions, firma la app y la sube a TestFlight.

Para subir a TestFlight se necesita:

1. Una cuenta de Apple Developer (USD 99 al año).
2. Una app creada en App Store Connect con el bundle ID `cl.andresmaturana.senalizador`.
3. Una clave de API de App Store Connect con rol Admin (Usuarios y acceso > Integraciones).
4. Cuatro secretos en el repo (Settings > Secrets and variables > Actions):
   - `ASC_KEY_ID`: el ID de la clave.
   - `ASC_ISSUER_ID`: el Issuer ID.
   - `ASC_KEY_P8`: el contenido completo del archivo `.p8`.
   - `APPLE_TEAM_ID`: el Team ID, que aparece en developer.apple.com > Membership.

## App de Android (Capacitor)

En Android, el reconocimiento de voz de Chrome usa el servicio de Google, que suena con un pitido cada vez que el micrófono se reactiva (cada pocos segundos de silencio). La app de Android usa en su lugar [Vosk](https://alphacephei.com/vosk/), un reconocedor sin conexión: escucha continuo, sin pitidos y sin pausar la música. Solo busca las palabras de comando de Ajustes, así reconoce mejor y no confunde ruido con órdenes.

- **Código:** `android/` (Capacitor 8). El plugin de voz está en `android/app/src/main/java/cl/andresmaturana/senalizador/VozPlugin.java` y expone la misma interfaz que el de iPhone (`start`, `stop`, `keepAwake`).
- **Modelo de voz:** `vosk-model-small-es-0.42` (unos 40 MB). No está en el repo: el workflow lo descarga al compilar y lo pone en `android/app/src/main/assets/model-es`.
- **Compilar:** `.github/workflows/android.yml` compila el APK en cada PR (queda como artefacto) y, con cada cambio en `main`, lo sube a la versión [«android»](../../releases/tag/android) del repo.
- **Instalar sin tienda:** abre la versión «android» desde el teléfono (con tu sesión de GitHub), descarga `senalizador.apk` y ábrelo. Android pide permitir «instalar apps desconocidas» la primera vez. Las actualizaciones se instalan encima porque el APK siempre se firma con la misma llave (`android/app/sideload.keystore`, solo para instalación directa; Google Play usará su propia firma).
- **Local:** `npm run android:sync` y `npm run android:open` (Android Studio), con el modelo descargado en la carpeta de arriba.
