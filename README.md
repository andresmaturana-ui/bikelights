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
| **sonido** | Prende o apaga el sonido (tic-tac al señalizar, pitido al frenar). |
| **cambiar ritmo** | Cambia el ritmo de la luz roja en reposo (lento, rápido, doble destello, pulso, fija, apagada). |

Los intermitentes son **secuenciales tipo LED** (como Mazda o Audi): las franjas se encienden una tras otra hacia afuera y se apagan juntas, con encendido y apagado suaves. En Ajustes también hay modo cometa, clásico y doble destello. Al tocar «Comenzar» hay una animación de bienvenida, como los autos al desbloquearse.

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
- **Música de fondo:** en Android la música normalmente sigue sonando mientras se escucha, aunque algunos teléfonos bajan el volumen al activar el micrófono. En iPhone activar el micrófono suele pausar o cambiar el audio. Con audífonos Bluetooth, el sistema puede pasar al micrófono del audífono y bajar la calidad del sonido.
- **Pantalla encendida:** se usa la Wake Lock API (Chrome Android, Safari iOS 16.4+). Si no está disponible, desactiva el bloqueo automático del teléfono. La web no puede subir el brillo: súbelo manualmente.
- **Sonido:** se genera en la app y se mezcla con la música en Android. En iPhone respeta el interruptor de silencio y puede bajar el volumen de la música mientras suena.
- **La app debe quedar en primer plano.** Si cambias de app o bloqueas la pantalla, el micrófono y las luces se detienen.
- **Detección de giro por GPS:** compara el rumbo antes y después de girar (55° o más). Con mala señal o a muy baja velocidad puede no detectarlo; entonces el intermitente dura el tiempo configurado.

## Uso y publicación

Es HTML, CSS y JavaScript sin dependencias ni compilación. Necesita HTTPS (micrófono, GPS y Wake Lock).

- **Probar en local:** `npx http-server .` y abrir `http://localhost:8080` (localhost cuenta como seguro).
- **Publicar:** el workflow `.github/workflows/pages.yml` publica en GitHub Pages en cada push a `main`. Hay que activarlo una vez en *Settings → Pages → Source: GitHub Actions*.
- **Instalar:** abrir la URL en el teléfono y elegir «Agregar a la pantalla de inicio».
