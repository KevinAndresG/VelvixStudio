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
**Transcripción (v1.1):** panel "Transcripción" (`TranscriptPanel.jsx` + `transcript.js`): borrar palabras corta ese tramo en todas las pistas con ripple; muletillas (eh, um, este…) y pausas detectadas por RMS del audio mezclado (umbral dB + pausa mínima) con lista previa marcable; subtítulos dinámicos (`wordAnim` pop/rebote/deslizar/aparecer sincronizado con cada palabra, `keyword` color en palabras clave, emojis automáticos, 5 presets nuevos ✦); buscar y reemplazar; vocabulario propio (difuso + «mal = Bien») aplicado tras transcribir; traducción local opus-mt en el worker de Whisper (pivote por inglés, ~80 MB por par).
**Velocidad y keyframes (v1.2):** curvas de velocidad (`clip.curve`, puntos lineales normalizados por su media: `clip.speed` = velocidad media, la duración no cambia) con 5 presets (montaje, héroe, bala, destello entrada/salida) + editor de curva; `sourceTime`/`srcOffset`/`speedAt` en `model.js` mueven preview, export y audio (export: tramos de velocidad constante estirados por separado con contexto y unidos con crossfade); dividir y recortar bordes conservan el mapeo exacto (`subClip`); velocidad hasta 100× (sobre 16× el preview busca cuadro a cuadro). Keyframes genéricos por clave (`x`, `volume`, `filter.contrast`, `mask.feather`…: `propAt`, `groupAt`, `setProp`) para filtros, volumen (export: expresión de ganancia en ffmpeg) y máscara; easing por keyframe (Suave, Lineal, Acelerar, Frenar, Rebote o cubic-bezier propio) con editor de curva en el inspector.
**Audio con IA (v1.3):** `audioai.js` + worker de Whisper. **Aislar voz / quitar música** con MDX-Net (UVR Voc_FT ONNX, ~67 MB, descargado una vez por `main.cjs` a `%APPDATA%/Velvix Studio/models`): STFT/iSTFT propios (`engine/fft.js` FFT mixto 2·3·4·5 para n_fft 7680, `engine/mdx.js` igual que UVR), WebGPU con respaldo WASM; genera WAV de voz y de música (caché por archivo) y los pone en pistas nuevas (aislar voz / quitar voz / separar en 2 pistas). **Mejorar voz** (`audioFx.enhance`): pasa-altos, RNNoise `arnndn` (modelo `cb.rnnn` descargado), EQ y compresor. **Ducking automático** (`clip.duck` en dB): export con `sidechaincompress` por clip, preview con envolvente de voz desde los picos (`duckEnvelope`/`duckGain` en `sources.js`). **Detección de ritmo**: flujo espectral + autocorrelación + seguimiento de beats por programación dinámica → marcadores verdes; **cortar al compás** acorta los clips de la pista principal para que terminen en un beat (cada 1/2/4). **Voz neuronal offline**: MMS-TTS (VITS, transformers.js) en es/en/pt/fr/de.
**Timeline, proyectos y exportación robusta (v1.4):** **exportación reanudable**: el H.264 de WebCodecs va a un archivo temporal en la caché (`exp-<hash>.h264`) con un punto de control en cada keyframe (cada 2 s, `exp-<hash>.json`); si algo falla se reintenta solo hasta 3 veces desde el último punto con decoder y encoder nuevos, y si se rinde el diálogo ofrece **Reanudar** (también tras reiniciar la app; el hash identifica proyecto + ajustes). El audio se mezcla y se une al final (`-c:v copy`). `e2e/long.cjs` exporta 60 min vigilando memoria. **Presets por plataforma** (TikTok, Reels, Shorts, YouTube; avisa y cambia el formato del proyecto si no coincide), **subtítulos** quemados / SRT aparte / ambos, **exportar un rango** (todo, clips seleccionados o desde–hasta; el audio usa `atrim` del rango). **Selección por caja** (arrastrar en zona vacía; Shift/Ctrl suma; clic busca), **reordenar pistas** arrastrando la cabecera (visuales entre visuales, audio entre audio). **Paquete portable** `.velvix` (magic + JSON + archivos seguidos: medios, proxies, miniaturas, WAV de efectos) exportar/importar desde el inicio o arrastrándolo. **Versiones**: copia al abrir y cada 5 min de edición (30 por proyecto, `projects/backups/<id>`), restaurar desde el inicio. **Recuperación**: `session.json` marca el proyecto abierto; si sigue al arrancar (o el renderer se cae y se recarga) el inicio ofrece recuperarlo. **Kit de marca** (pestaña Marca, `brand.json` + logos copiados a `brand/`): colores, fuentes y estilos de texto que se aplican al texto seleccionado y logos que se agregan como marca de agua.
**Instalador:** NSIS x64, elegir carpeta, accesos directos; escaneado con Windows Defender sin amenazas.

## Plan por sesiones ⏳
Cada sesión agrupa features que comparten código, para hacerlas juntas con un solo prompt y luego limpiar el contexto (`/clear`).
Prioridad: **A** = muy pedido, **B** = útil, **C** = opcional. Los números (#) se mantienen para referencia.

**Reglas de toda sesión** (ya incluidas en el prompt): leer este archivo; correr `npx vite build && node e2e/full.cjs` antes y después; agregar una prueba E2E por cada feature nueva; marcar ✅ lo terminado aquí; subir versión menor con `npm version minor --no-git-tag-version` (1.0.0 → 1.1.0); commit; `npm run dist` y `PKG=1 node e2e/full.cjs`. El instalador nuevo se instala encima del anterior (mismo appId) y conserva los proyectos.

### Sesión 1 — Transcripción y subtítulos inteligentes ✅ (v1.1.0)
Base común: las palabras con tiempos que ya da Whisper (`src/editor/captions.js`).
- [x] ✅ #12 A — **Edición por transcripción**: panel de texto; borrar palabras = cortar ese tramo del timeline (con ripple).
- [x] ✅ #13 A — **Quitar muletillas y pausas** ("eh", "este", "um", silencios) en un clic, con vista previa de qué se borra. Umbral de silencio con los picos de audio.
- [x] ✅ #14 A — **Subtítulos dinámicos**: animación por palabra (pop, rebote, deslizar), palabras clave resaltadas en color, emojis automáticos. Nuevos presets.
- [x] ✅ #20 B — **Buscar y reemplazar** en todos los subtítulos + **vocabulario propio** (marcas y nombres) que se corrige solo tras transcribir.
- [x] ✅ #9a B — **Traducir subtítulos** (modelo ONNX local tipo opus-mt/NLLB, en el mismo worker que Whisper).

> Prompt: `Lee PROGRESS.md y haz la Sesión 1 completa siguiendo las reglas de toda sesión.`

### Sesión 2 — Velocidad y keyframes ✅ (v1.2.0)
Base común: el motor de keyframes de `model.js` (`kfValue`, `transformAt`) y el mapeo de tiempo de `sourceTime`.
- [x] ✅ #2 A — **Curvas de velocidad**: presets (montaje, héroe, bala, destello entrada/salida) + curva editable; preview, export y audio sincronizados.
- [x] ✅ #24 B — **Velocidad hasta 100×**.
- [x] ✅ #3 B — **Keyframes para filtros, volumen y máscara** (hoy solo transformación); editor de curvas de easing.

> Prompt: `Lee PROGRESS.md y haz la Sesión 2 completa siguiendo las reglas de toda sesión.`

### Sesión 3 — Audio con IA ✅ (v1.3.0)
Base común: modelos ONNX en worker (igual que Whisper) + cadena de audio de ffmpeg en `main.cjs`.
- [x] ✅ #15 A — **Aislar voz / quitar música** (MDX-Net ONNX → WAV de voz y WAV instrumental).
- [x] ✅ #16 A — **Mejorar voz** (versión ligera con `arnndn` + EQ + compresor).
- [x] ✅ #19 B — **Ducking automático**: bajar la música cuando hay voz (`sidechaincompress` en export, automatización de volumen en preview).
- [x] ✅ #5a B — **Detección de ritmo**: marcadores en cada beat + "cortar al compás".
- [x] ✅ #9b C — **Voces TTS neuronales offline** (MMS-TTS en lugar de Piper: Piper necesita el fonemizador espeak-ng, GPL y sin build JS en las dependencias).

> Prompt: `Lee PROGRESS.md y haz la Sesión 3 completa siguiendo las reglas de toda sesión.`

### Sesión 4 — Timeline, proyectos y exportación robusta ✅ (v1.4.0)
Base común: `Timeline.jsx`, `store.js`, `ExportDialog.jsx`, `main.cjs`.
- [x] ✅ #17 A — **Exportaciones largas confiables**: prueba E2E con video de 60 min; vigilar memoria (bitmaps, decoders); reintentar o reanudar si falla.
- [x] ✅ #22 B — **Presets por plataforma** (TikTok, Reels, Shorts, YouTube) + subtítulos quemados o SRT aparte + **exportar solo un rango**.
- [x] ✅ #10 B — **Selección por caja** en timeline, **reordenar pistas**, **paquete de proyecto portable** (.velvix con medios), **copias de seguridad por versión** y recuperación tras cierre inesperado.
- [x] ✅ #23 B — **Kit de marca**: colores, fuentes, logos y estilos de texto favoritos guardados.

> Prompt: `Lee PROGRESS.md y haz la Sesión 4 completa siguiendo las reglas de toda sesión.`

### Sesión 5 — Motor WebGL y color profesional
Base común: reemplazar los filtros CSS/canvas de `render.js` por shaders WebGL (mismo resultado en preview y export).
- [ ] #7 A — **Compositor WebGL** (mejor rendimiento en 4K y con muchos efectos) + **LUTs .cube**.
- [ ] #18 A — **Color pro**: HSL por color, curvas RGB, ruedas lift/gamma/gain, scopes (histograma / forma de onda).
- [ ] #27a C — **Retoque facial ligero** (suavizado de piel con filtro bilateral en shader; sin IA).

> Prompt: `Lee PROGRESS.md y haz la Sesión 5 completa siguiendo las reglas de toda sesión. Al terminar, revisa punto por punto cada requisito de esta sesión en la app real (también su integración con lo de sesiones anteriores), arregla lo que falle en un commit aparte y agrega pruebas E2E solo si de verdad hacen falta. Luego da un informe corto (qué hiciste, qué falló, qué arreglaste, versión y commits) y termina diciendo que está listo para /clear, así se limpia el contexto antes de la siguiente sesión.`

### Sesión 6 — IA visual y análisis de video
Base común: modelos ONNX de visión en worker + análisis con ffmpeg. Hacer después de las Sesiones 1 y 5 (usa transcripción y WebGL).
- [ ] #4 A — **Quitar fondo con IA** sin pantalla verde (segmentación de personas) + **auto-reencuadre** 16:9 → 9:16 siguiendo la cara.
- [ ] #6 B — **Estabilización** (ffmpeg vidstab) + **seguimiento de movimiento** para que texto/stickers sigan a un objeto.
- [ ] #21 B — **Detectar escenas** y dividir automáticamente (`ffmpeg scdet`).
- [ ] #26 C — **Video largo → clips cortos** (transcripción + energía de audio + escenas).
- [ ] #27b C — **Mejorar resolución con IA** (upscaling).

> Prompt: `Lee PROGRESS.md y haz la Sesión 6 completa siguiendo las reglas de toda sesión. Al terminar, revisa punto por punto cada requisito de esta sesión en la app real (también su integración con lo de sesiones anteriores), arregla lo que falle en un commit aparte y agrega pruebas E2E solo si de verdad hacen falta. Luego da un informe corto (qué hiciste, qué falló, qué arreglaste, versión y commits) y termina diciendo que está listo para /clear, así se limpia el contexto antes de la siguiente sesión.`

### Sesión 7 — Contenido creativo
Base común: catálogos de `model.js`, `drawText` en `render.js`, panel izquierdo.
- [ ] #8 B — **Plantillas de proyecto**, **stickers animados** (GIF/Lottie), **texto curvo y 3D**, **estilos distintos por palabra**.
- [ ] #25 B — **Biblioteca de música y efectos de sonido libres (CC0)**, descargable aparte; nunca música con copyright.

> Prompt: `Lee PROGRESS.md y haz la Sesión 7 completa siguiendo las reglas de toda sesión. Al terminar, revisa punto por punto cada requisito de esta sesión en la app real (también su integración con lo de sesiones anteriores), arregla lo que falle en un commit aparte y agrega pruebas E2E solo si de verdad hacen falta. Luego da un informe corto (qué hiciste, qué falló, qué arreglaste, versión y commits) y termina diciendo que está listo para /clear, así se limpia el contexto antes de la siguiente sesión.`

### Sesión 8 — Lanzamiento
Al final, cuando las features estén listas.
- [ ] #11 B — **Interfaz en inglés** (i18n, selector de idioma) + **actualizaciones automáticas** (electron-updater).
- [ ] Revisar la marca "Velvix Studio" en el registro de marcas (WIPO / oficina local) antes de publicar.
- [ ] Licencias: cambiar a build LGPL de ffmpeg si se va a vender; pantalla "Acerca de" con licencias de terceros. **Ojo:** las voces MMS-TTS (#9b) son CC-BY-NC 4.0 (no comercial): cambiarlas antes de vender (p. ej. Piper con voces de licencia libre). Revisar también la licencia de los modelos RNNoise (`cb.rnnn`) y UVR.
- [ ] #1 — **Firma de código** (requiere comprar certificado OV/EV; quita el aviso de SmartScreen). Es un trámite, no código.

> Prompt: `Lee PROGRESS.md y haz la Sesión 8 completa siguiendo las reglas de toda sesión. Al terminar, revisa punto por punto cada requisito de esta sesión en la app real (también su integración con lo de sesiones anteriores), arregla lo que falle en un commit aparte y agrega pruebas E2E solo si de verdad hacen falta. Luego da un informe corto (qué hiciste, qué falló, qué arreglaste, versión y commits) y termina diciendo que está listo para /clear, así se limpia el contexto antes de la siguiente sesión.`

**Orden recomendado:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. La Sesión 4 puede adelantarse si aparecen fallos de exportación.

### Contexto de la investigación de usuarios (oct 2026)
Muletillas, subtítulos dinámicos, aislar voz y la mayoría de herramientas IA eran gratis en CapCut y pasaron a Pro; es la queja principal. También fallan exportaciones largas en la versión de escritorio. La edición por transcripción es la función que más tiempo ahorra según varias guías. VN y LumaFusion destacan por corrección de color y keyframes.

**Ventajas que ya tenemos y que la gente reclama a CapCut:** todo gratis, sin marca de agua, sin cuenta, sin nube, sin términos que cedan derechos sobre tu contenido, sin riesgo de que la app desaparezca de una tienda, subtítulos sin internet.

Fuentes: [eesel.ai](https://www.eesel.ai/en/blog/capcut-alternatives), [Unstar](https://unstar.app/blog/capcut-inshot-vn-splice-lumafusion-video-editing-apps-ranked-2026), [Primal Video](https://primalvideo.com/guides/capcut-ai-tools/), [FilmCrux](https://www.filmcrux.com/blog/video-editing-capcut), [Filmora](https://filmora.wondershare.it/video-editor-review/capcut-for-pc.html), [CapCut PC](https://www.capcut.com/resource/pc-professional-video-editor), [reseña CapCut AI 2026](https://marcandrews.com/?p=3178), [Adobe Community](https://community.adobe.com/t5/premiere-rush-discussions/add-auto-captions-in-premier-rush-same-as-capcut/m-p/14848208).

## Pruebas E2E (correr tras cada cambio)
- `npx vite build` y luego `node e2e/full.cjs` → todas las features + exportación real a `e2e/out.mp4` (verificar con ffprobe: 330 frames, 11.0 s video y audio).
- `full.cjs` también verifica las Sesiones 1 y 2 (líneas `OK`/`FAIL`, sale con código 1 si algo falla) y exporta `out-cut.mp4`, `out-speed.mp4` (curvas + keyframes de volumen), `out-ramp.mp4` y `out-mask.mp4`. `media/ramp.mp4` lleva el número de cuadro en la luma (izquierda = n mod 20, derecha = n / 20, valor 12·k+8) y un chirp de 300 Hz + 60 Hz/s: el tono da el tiempo de origen del audio. La traducción descarga opus-mt la primera vez.
- La Sesión 3 genera audio de prueba en `e2e/gen/` (voz + música sintética, voz con ruido, clic a 120 BPM, base de 50 Hz) y exporta `out-duck.mp4`. Descarga una vez el modelo MDX (~67 MB), `cb.rnnn` y MMS-TTS español.
- La Sesión 4 exporta `out-ref/out-retry/out-resume.mp4` (ramp.mp4 con un fallo simulado vía `window.__velvixFail = { at, n }`: reintento automático y Reanudar; se comparan cuadro a cuadro), `out-range.mp4` + `out-range.srt` y `out-burn.mp4` (preset TikTok, rango 1–3 s, subtítulos aparte o quemados); prueba selección por caja y reordenar pistas con el ratón, kit de marca, paquete `.velvix`, versiones desde el inicio y recuperación tras `forcefullyCrashRenderer`.
- `node e2e/long.cjs` → #17: genera `e2e/gen/long60.mp4` (60 min) y lo exporta a 480p con un fallo a la mitad. Resultado (oct 2026): 108000 cuadros exactos, 60:00 de audio, 320 s (~337 fps), memoria total 0.9–1.1 GB sin crecer. `MIN=5` para una versión corta.
- `node e2e/verify4.cjs` → verificación de la Sesión 4 en la app real: mata la app con `taskkill` al 45 % de una exportación de 2 min y la reanuda (mismos cuadros y audio que una exportación entera), rango con curva + keyframes + subtítulos quemados contra el video completo, logo de marca en 16:9 y 9:16, deshacer/rehacer de reordenar pistas y de borrar una selección por caja, rotación de versiones y un paquete con rutas con espacios y acentos. Luego `PKG=1 node e2e/verify4.cjs pkg` abre ese paquete en la app empaquetada.
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
- `<span>` inline sin espacios entre sí no hacen salto de línea: usar `inline-block` (lista de palabras de la transcripción).
- Las palabras de los subtítulos guardan `text` además de `s/e`: el corte con ripple reconstruye el contenido desde ellas.
- `useStore(selector)` debe devolver referencias estables (nada de `.filter()` dentro del selector).
- El preview se pausa durante la exportación (`state.exporting`).
- Audio con curva: `atempo` pierde ~una ventana en los bordes de su entrada, así que estirar tramos cortos por separado deja huecos de silencio en cámara lenta. Cada tramo se estira con 0.25 s de contexto a cada lado, se corta a su largo exacto y se une con `acrossfade` de 10 ms. Un solo `atempo`/`rubberband` con `asendcmd` no sirve: su latencia aplica el tempo nuevo antes de tiempo y se desfasa hasta 0.6 s. (Los comandos de `asendcmd` apuntan al id después de `@`.)
- Preview por encima de 16×: buscar en cada animation frame nunca deja pintar un cuadro (canvas negro); se busca cada 50 ms y, mientras busca, se dibuja el último cuadro guardado.
- `<img>` sin `crossOrigin='anonymous'` ensucia el canvas y la exportación WebCodecs falla con "VideoFrames can't be created from tainted sources".
- El video exportado dura `ceil(duración·fps)/fps`: con duraciones no alineadas a cuadros difiere hasta 1 cuadro del timeline.
- Protocolo `app://` necesita MIME `.mjs` → `text/javascript` (lo pide onnxruntime para Whisper).

- **MDX-Net**: entrada `[1, 4, 3072, 256]` = (L real, L imag, R real, R imag) × bins × cuadros; STFT `center=True` con relleno por reflexión y ventana Hann periódica (como `torch.stft`), n_fft 7680, hop 1024; cada trozo descarta n_fft/2 por lado. n_fft no es potencia de 2: por eso la FFT de radix mixto.
- **Ducking**: `sidechaincompress` solo no baja lo suficiente (el habla tiene huecos y el compresor tiene rodilla); con `level_sc=16` el clip queda casi en silencio mientras hay voz y `mix` fija la profundidad (≈ los dB elegidos).
- Para medir la música bajo la voz en pruebas usar un pasa-banda: `voz.wav` tiene retumbe/DC bajo 70 Hz que contamina un pasa-bajos.
- `arnndn=m=...` con ruta de Windows exige escapar `:` y `\` en el filtergraph: se corre ffmpeg con `cwd` = carpeta de modelos y `m=cb.rnnn`.
- `SourcePool._park` podía recibir un id ya descartado como "el más viejo" en la misma pasada (pageerror con más de 10 clips de audio): se ignora.
- ffmpeg sube mono → estéreo a −3 dB (`aformat`), es normal en el export.
- Verificación Sesión 3 (app empaquetada con `--user-data-dir` vacío): MDX, `cb.rnnn`, MMS, opus-mt y Whisper se descargan bien sin dev. Separar 4 min de audio: ~73 s, ~1.5 GB en total entre procesos, estable durante todo el proceso (ponytail: todo el audio en memoria; para pistas de más de ~30 min habría que procesar por trozos). Se puede cancelar desde la barra de tareas (✕): se mata el worker y los modelos se recargan desde la caché del navegador.
- El TTS neuronal guarda el WAV por hash de idioma + texto: si repites el texto, se reutiliza sin correr el modelo.

- **Exportación reanudable**: los chunks del `VideoEncoder` llegan mientras se espera el IPC; hay que sacar el lote (`chunks = []`) **antes** del `await` o se pierden cuadros. Cada pasada de reintento fuerza keyframe en su primer cuadro y trunca el temporal al offset del último punto de control.
- Tras `forcefullyCrashRenderer` + `reload` el objeto `page` de Playwright queda "Target crashed": la prueba maneja la ventana recargada con `webContents.executeJavaScript` desde el main.
- En `String.replace` de JS el reemplazo interpreta `$$`, `$&`… (al insertar código con `page.$$eval` usar una función de reemplazo).

- La firma que identifica una exportación reanudable no debe incluir campos que cambian al reabrir (`media.missing`, miniaturas, nombre, fechas): con ellos, tras matar la app nunca aparecía Reanudar.
- Limpiar temporales con `fs.rm` puede fallar con EBUSY si otra ventana los tiene abiertos (Windows): ignorar el error.
- Borrar un proyecto importado borra también `imported/<id>` (antes sus medios quedaban en disco). Solo se guarda una exportación reanudable a la vez (una nueva borra los `exp-*` anteriores). Restaurar una versión pide confirmación y guarda la actual como versión.

## Notas
- La primera vez que se usan subtítulos se descarga el modelo de voz (75–500 MB). Después funciona sin internet.
- FFmpeg incluido es build GPL (ffmpeg-static): uso personal OK; para vender la app revisar licencias o usar build LGPL.
- `window.__velvix` expone store/acciones para las pruebas E2E.
