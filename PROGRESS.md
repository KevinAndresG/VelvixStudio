# Velvix Studio — progreso

Editor de video de escritorio (Electron + React + FFmpeg + WebCodecs + Whisper). Sin cuenta, 100 % local.

## Comandos
- `npm run dev` — desarrollo con recarga (Vite + Electron)
- `npm start` — compila y abre
- `npm run dist` — genera `release/Velvix-Studio-Setup-<versión>.exe`

## Arquitectura
| Archivo | Rol |
|---|---|
| `electron/main.cjs` | Ventana, servidor de medios en loopback (Range/seek), proyectos en `%APPDATA%/Velvix Studio/projects`, ffprobe/ffmpeg (miniaturas, waveforms, proxies, inversión, efectos de voz, TTS, mezcla de audio, exportación) |
| `src/engine/model.js` | Modelo de datos, keyframes, catálogos (filtros, animaciones, transiciones, efectos, estilos de texto) |
| `src/engine/render.js` | Compositor canvas único: lo usa la vista previa **y** la exportación (resultado idéntico) |
| `src/engine/sources.js` | Pool de `<video>/<audio>` para preview (WebAudio, volumen >100 %) + `ExportPool` |
| `src/engine/decoder.js` | Decodificación secuencial WebCodecs + mp4box (frame-exacto, ~380 fps) |
| `src/editor/*` | UI: panel de medios, preview con manipulación directa, timeline, inspector, exportación, subtítulos |

## Hecho (fase 1) ✅ — verificado con pruebas E2E automáticas
**Proyectos:** inicio sin cuenta, crear con formato (16:9, 9:16, 1:1, 4:5, 4:3, 3:4, 21:9, 2:1), abrir/continuar, renombrar, duplicar, eliminar, buscar, miniatura, autoguardado atómico, arrastrar archivos a la pantalla de inicio crea proyecto, revincular archivos movidos.
**Medios:** importar video/audio/imagen (diálogo o arrastrar), proxies automáticos para códecs no soportados (MPEG-4, ProRes, GIF…), filmstrip y waveform en timeline.
**Timeline:** multipista (video, superposición, texto, efectos, audio), pista principal magnética, ajuste a bordes/cursor/marcadores, arrastrar entre pistas, recortar bordes, dividir, duplicar, copiar/cortar/pegar, eliminar, deshacer/rehacer (100 pasos), marcadores, zoom (Ctrl+rueda), silenciar/ocultar/bloquear pistas, menú contextual, altura redimensionable, atajos de teclado.
**Video:** posición/escala/rotación/opacidad con keyframes (easing), voltear, rotar 90°, ajustar/llenar/estirar, recortar, modos de fusión (17), máscaras (círculo, rectángulo, lineal, espejo, corazón, estrella; difuminado, invertir), croma con cuentagotas y de-spill, fondo del lienzo (negro/color/desenfoque), congelar fotograma, invertir reproducción, velocidad 0.1×–10× conservando el tono.
**Filtros y ajustes:** 28 filtros con intensidad + exposición, brillo, contraste, saturación, temperatura, matiz, tono, desvanecer, nitidez, viñeta, grano, desenfoque; por clip o como capa global; "aplicar a todos".
**Animaciones:** 16 de entrada/salida + 9 combos en bucle; por letra, por palabra, máquina de escribir y ola para texto.
**Transiciones:** 21 (disolver, fundidos, deslizar, empujar, barridos, círculo, diamante, zoom, giro, desenfoque, glitch, sacudida, partir…), duración ajustable, "aplicar a todos los cortes".
**Efectos de video:** 26 (temblor, glitch, RGB, VHS, película antigua, fuga de luz, barras cine, espejo, caleidoscopio, pixelado, lluvia, nieve, destellos, duotono, neón…) con intensidad.
**Texto:** fuentes del sistema, tamaño, color, negrita/cursiva/subrayado/mayúsculas, alineación, espaciado, interlineado, contorno, sombra, fondo, brillo neón, degradado, 16 plantillas, stickers (60+ emojis), edición en lote.
**Audio:** volumen hasta 300 %, fundidos, silenciar, **separar audio del video**, cambiador de voz (11 voces), tono ±12 semitonos, reducción de ruido, normalizar, graves/agudos, grabar voz en off, texto a voz (voces de Windows, offline).
**Subtítulos automáticos:** Whisper local (WebGPU/WASM), 12 idiomas, 3 modelos, tiempos por palabra, resaltado karaoke, re-estilizar todos, importar/exportar SRT.
**Exportación:** MP4 H.264 (codificación GPU vía WebCodecs, ~50 fps a 1080p), WebM VP9, GIF, MP3, WAV; 480p–4K; 24–60 fps; 3 calidades; progreso, ETA, cancelar; guardar fotograma como PNG.
**Instalador:** NSIS x64, elegir carpeta, accesos directos; escaneado con Windows Defender sin amenazas.

## Pendiente (siguientes fases) ⏳
1. **Firma de código**: sin certificado, Windows SmartScreen avisa en la primera ejecución ("Más información → Ejecutar de todas formas"). Requiere comprar un certificado (OV/EV).
2. **Curvas de velocidad** (rampas tipo montaje, bullet, héroe).
3. **Keyframes** para filtros, volumen y máscara (hoy solo transformación).
4. **Quitar fondo con IA** sin pantalla verde (modelo de segmentación) y **auto-reencuadre** 16:9 → 9:16.
5. **Detección de ritmo** para cortar al compás; **auto-cortar silencios**.
6. **Estabilización** (ffmpeg vidstab) y **seguimiento de movimiento** para texto/stickers.
7. **LUTs .cube** y compositor WebGL (mejor rendimiento en 4K con muchos efectos).
8. Plantillas de proyecto, stickers animados (GIF/Lottie), texto curvo/3D, estilos por palabra.
9. Traducción de subtítulos, más voces TTS neuronales offline.
10. Selección por caja en timeline, reordenar pistas, exportar rango, paquetes de proyecto portables (.velvix), copias de seguridad por versión.
11. Interfaz en inglés (i18n), actualizaciones automáticas.

## Pruebas E2E (correr tras cada cambio)
- `npx vite build` y luego `node e2e/full.cjs` → todas las features + exportación real a `e2e/out.mp4` (verificar con ffprobe: 330 frames, 11.0 s video y audio).
- `node e2e/cap.cjs` → subtítulos automáticos. `node e2e/smoke.cjs` → capturas rápidas.
- `PKG=1 node e2e/full.cjs` → lo mismo contra la app empaquetada (`npm run dist` antes).
- Medios de prueba en `e2e/media/`.

## Lecciones técnicas (no repetir estos errores)
- **Seek de `<video>` no funciona con `protocol.handle` de Electron** (seekable=[0,0]). Por eso los medios se sirven por HTTP en 127.0.0.1 con token (`mediaBase`).
- **`canvas.toBlob` tarda ~1 s/frame** con el loop del preview activo (corre como tarea idle). No usarlo para exportar.
- **Exportación**: WebCodecs `VideoDecoder` + mp4box (lectura por Range, saltando mdat) → render canvas → `VideoEncoder` H.264 annexb → ffmpeg `-c:v copy`. Fallback: seek de `<video>` + RGBA crudo por IPC (37 ms/frame por 8 MB).
- **Decoder por hardware se bloquea** si se retienen VideoFrames: copiar a `ImageBitmap` y cerrar el frame al instante.
- **Normalizar cts** al mínimo (edit list / B-frames) o el export sale desfasado 2 frames respecto al preview.
- **No usar `-shortest`** con video copiado (genpts): corta el audio a 1 s. El audio ya se recorta con `atrim`.
- `ffmpeg` muerto durante export → `export:frame` resuelve false (antes esperaba `drain` para siempre).
- `useStore(selector)` debe devolver referencias estables (nada de `.filter()` dentro del selector).
- El preview se pausa durante la exportación (`state.exporting`).
- Protocolo `app://` necesita MIME `.mjs` → `text/javascript` (lo pide onnxruntime para Whisper).

## Notas
- La primera vez que se usan subtítulos se descarga el modelo de voz (75–500 MB). Después funciona sin internet.
- FFmpeg incluido es build GPL (ffmpeg-static): uso personal OK; para vender la app revisar licencias o usar build LGPL.
- `window.__velvix` expone store/acciones para las pruebas E2E.
