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

## Pendiente — investigación de usuarios (oct 2026) 🔎
Lo que la gente más valora o reclama de CapCut y que aún NO tenemos. Prioridad: A = muy pedido, B = útil, C = opcional.

| # | Prioridad | Feature | Por qué | Cómo (idea técnica) |
|---|---|---|---|---|
| 12 | A | **Edición por transcripción**: borrar texto = borrar ese tramo del video | Citado como el mayor ahorro de tiempo en videos hablados | Reusar palabras con tiempos de Whisper; panel de texto; borrar → `splitAtPlayhead` + delete + ripple |
| 13 | A | **Quitar muletillas y pausas** ("eh", "este", "um", silencios) | Era gratis en CapCut y lo pasaron a Pro; muy reclamado | Sobre #12: lista de muletillas por idioma + umbral de silencio con picos de audio |
| 14 | A | **Subtítulos dinámicos**: animación por palabra (pop, rebote), palabras clave en color, emojis automáticos | También pasó a Pro; muy usado en TikTok/Reels | Más presets en `drawText` por unidad; palabras clave por longitud/mayúsculas; emojis con un diccionario simple |
| 15 | A | **Aislar voz / quitar música** (separar voz de fondo) | Pasó a Pro; muy pedido | Modelo ONNX tipo Demucs/MDX en worker (como Whisper) → 2 WAV (voz / instrumental) |
| 16 | A | **Mejorar voz** (IA: voz de estudio) | Muy valorado junto con reducción de ruido | Modelo de mejora de voz ONNX, o cadena ffmpeg `arnndn` + EQ + compresor como versión ligera |
| 17 | A | **Exportaciones largas confiables** (1 h+) | Queja recurrente: CapCut falla a mitad de exportaciones largas | Prueba E2E con un video de 60 min; vigilar memoria (bitmaps/decoders); reanudar si falla |
| 18 | A | **Corrección de color pro**: HSL por color, curvas, ruedas lift/gamma/gain | La gente lo ve como hueco frente a VN/LumaFusion; CapCut PC lo tiene | Compositor WebGL (#7) con shader de curvas/LUT; UI de curvas y ruedas |
| 19 | B | **Bajar música automáticamente cuando hay voz** (ducking) | Estándar en editores pro; ahorra mucho trabajo manual | Detección de voz con picos/Whisper → automatización de volumen; en export con `sidechaincompress` de ffmpeg |
| 20 | B | **Buscar y reemplazar en subtítulos** + vocabulario propio (marcas, nombres) | Queja: los subtítulos automáticos fallan con marcas y acentos | Reemplazo en lote sobre clips con `caption`; lista de términos guardada |
| 21 | B | **Detectar escenas** (dividir el video en cada cambio de plano) | Útil para reeditar material ya editado | `ffmpeg -vf scdet` → cortes automáticos |
| 22 | B | **Presets por plataforma** al exportar (TikTok, Reels, Shorts, YouTube) + subtítulos quemados o SRT aparte | Flujo rápido que esperan los creadores | Presets de resolución/fps/bitrate en `ExportDialog` |
| 23 | B | **Kit de marca**: colores, fuentes, logos y estilos de texto favoritos guardados | Pasó a Pro en CapCut | JSON en `userData`; panel "Mis estilos" |
| 24 | B | **Velocidad hasta 100×** (hoy tope 10×) | CapCut PC llega a 100× en algunas versiones | Ampliar slider; `atempo` ya encadena; preview hasta 16× (tope de Chromium) y saltos por encima |
| 25 | B | **Biblioteca local de sonidos y música libres** (CC0) | Las apps pierden pistas cuando caducan licencias; la gente quiere música sin riesgo | Paquete CC0 opcional descargable; nunca música con copyright |
| 26 | C | **Video largo → clips cortos automáticos** (momentos destacados) | Promocionado por CapCut (AutoCut) | Heurística local: transcripción + energía de audio + escenas; un LLM opcional queda para después |
| 27 | C | **Retoque facial / belleza** y **mejorar resolución con IA** | Existe en la app móvil; en PC sin confirmar | Modelos ONNX pesados; dejar para el final |

Fuentes: [eesel.ai — alternativas a CapCut 2026](https://www.eesel.ai/en/blog/capcut-alternatives), [Unstar — comparativa de apps 2026](https://unstar.app/blog/capcut-inshot-vn-splice-lumafusion-video-editing-apps-ranked-2026), [Primal Video — herramientas IA de CapCut](https://primalvideo.com/guides/capcut-ai-tools/), [FilmCrux — CapCut en escritorio](https://www.filmcrux.com/blog/video-editing-capcut), [Filmora — reseña CapCut PC](https://filmora.wondershare.it/video-editor-review/capcut-for-pc.html), [CapCut — editor PC](https://www.capcut.com/resource/pc-professional-video-editor), [reseña CapCut AI 2026](https://marcandrews.com/?p=3178), [Adobe Community — pedidos de usuarios comparando con CapCut](https://community.adobe.com/t5/premiere-rush-discussions/add-auto-captions-in-premier-rush-same-as-capcut/m-p/14848208).

**Ventajas que ya tenemos y que la gente reclama a CapCut:** todo gratis, sin marca de agua, sin cuenta, sin nube, sin términos que cedan derechos sobre tu contenido, sin riesgo de que la app desaparezca de una tienda y subtítulos funcionando sin internet.

**Orden sugerido:** 12 → 13 → 14 (mismo motor de transcripción), luego 2 (curvas de velocidad), 15–16 (audio IA), 17 (estabilidad), 7 + 18 (WebGL + color pro), resto.

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
