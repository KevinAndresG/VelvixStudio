// Frame-exact sequential video decoding with WebCodecs, used by export.
// Seeking a <video> per frame costs 35–110 ms; decoding forward costs a few ms.
import MP4Box from 'mp4box';
import { mediaUrl } from './model.js';

async function fetchRange(url, start, end) {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
  return r.arrayBuffer();
}

// Parses only the boxes needed (moov), jumping over mdat via Range requests.
async function parseMp4(url) {
  const file = MP4Box.createFile();
  let info = null, error = null;
  file.onReady = (i) => { info = i; };
  file.onError = (e) => { error = e; };
  let pos = 0, guard = 0;
  while (!info && !error && guard++ < 200) {
    const buf = await fetchRange(url, pos, pos + (1 << 20));
    if (!buf.byteLength) break;
    buf.fileStart = pos;
    const next = file.appendBuffer(buf);
    pos = next != null && next > pos ? next : pos + buf.byteLength;
  }
  if (!info) throw new Error(error || 'moov not found');
  const track = info.videoTracks[0];
  if (!track) throw new Error('no video track');
  const trak = file.getTrackById(track.id);
  let description;
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const ds = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
      box.write(ds);
      description = new Uint8Array(ds.buffer, 8); // strip box header
      break;
    }
  }
  const m = track.matrix || [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824];
  const rotation = (Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI) + 360) % 360;
  // Shift so the first presented frame is t=0, matching <video> (edit list / B-frame delay).
  const minCts = Math.min(...trak.samples.map((s) => s.cts / s.timescale));
  const samples = trak.samples.map((s) => ({ offset: s.offset, size: s.size, cts: Math.round((s.cts / s.timescale - minCts) * 1e6), dur: (s.duration / s.timescale) * 1e6, sync: s.is_sync }));
  return {
    config: { codec: track.codec, codedWidth: track.video.width, codedHeight: track.video.height, description, hardwareAcceleration: 'prefer-hardware' },
    samples, rotation,
  };
}

export class FrameReader {
  static async open(path) {
    const url = mediaUrl(path);
    const meta = await parseMp4(url);
    const sup = await VideoDecoder.isConfigSupported(meta.config).catch(() => ({ supported: false }));
    if (!sup.supported) {
      meta.config.hardwareAcceleration = 'no-preference';
      const s2 = await VideoDecoder.isConfigSupported(meta.config).catch(() => ({ supported: false }));
      if (!s2.supported) throw new Error('codec not supported: ' + meta.config.codec);
    }
    return new FrameReader(url, meta);
  }

  constructor(url, meta) {
    this.url = url; this.meta = meta;
    this.frames = []; // decoded, sorted by timestamp
    this.next = 0; // next sample index to feed (decode order)
    this.error = null;
    this.frameDur = meta.samples.length > 1 ? meta.samples[1].dur || 33333 : 33333;
    this.lastCts = Math.max(...meta.samples.map((s) => s.cts));
    this._make();
  }

  _make() {
    if (this.dec && this.dec.state !== 'closed') this.dec.close();
    this.pending = new Set();
    const gen = (this.gen = (this.gen || 0) + 1);
    this.dec = new VideoDecoder({
      // Copy to an ImageBitmap and release the hardware frame at once; holding VideoFrames starves the decoder pool.
      output: (f) => {
        const ts = f.timestamp;
        const p = createImageBitmap(f).then((bmp) => {
          f.close();
          if (gen !== this.gen) return bmp.close();
          const a = this.frames; let i = a.length;
          while (i > 0 && a[i - 1].timestamp > ts) i--;
          a.splice(i, 0, { timestamp: ts, bmp });
        }, () => f.close()).finally(() => this.pending.delete(p));
        this.pending.add(p);
      },
      error: (e) => { this.error = e; },
    });
    this.dec.configure(this.meta.config);
    this.flushed = false;
  }

  _reset(targetUs) {
    for (const f of this.frames) f.bmp.close();
    this.frames = [];
    this._make();
    // Start from the last keyframe at or before the target (by presentation time).
    const s = this.meta.samples;
    let k = 0;
    for (let i = 0; i < s.length; i++) if (s[i].sync && s[i].cts <= targetUs + 1) k = i;
    this.next = k;
  }

  async _feed(count) {
    const s = this.meta.samples, end = Math.min(s.length, this.next + count);
    if (this.next >= end) {
      if (!this.flushed) { this.flushed = true; await this.dec.flush().catch(() => {}); }
      return false;
    }
    const batch = s.slice(this.next, end);
    const lo = Math.min(...batch.map((x) => x.offset)), hi = Math.max(...batch.map((x) => x.offset + x.size));
    const buf = await fetchRange(this.url, lo, hi);
    for (const x of batch) {
      this.dec.decode(new EncodedVideoChunk({ type: x.sync ? 'key' : 'delta', timestamp: x.cts, duration: x.dur, data: new Uint8Array(buf, x.offset - lo, x.size) }));
    }
    this.next = end;
    // Let the decoder catch up (bounded wait, never blocks forever).
    for (let i = 0; i < 200 && this.dec.decodeQueueSize > 4; i++) await new Promise((r) => { this.dec.addEventListener('dequeue', r, { once: true }); setTimeout(r, 5); });
    return true;
  }

  // Returns { timestamp, bmp } shown at `t` seconds (the reader owns the bitmap).
  async frameAt(t) {
    if (this.error) throw this.error;
    const target = t * 1e6, half = this.frameDur / 2;
    const first = this.frames[0];
    const behind = first && target < first.timestamp - half;
    const nextCts = this.next < this.meta.samples.length ? this.meta.samples[this.next].cts : Infinity;
    const farAhead = target > nextCts + 2e6 && !(this.frames.length && this.frames[this.frames.length - 1].timestamp >= target - half);
    if (!first && this.next === 0 && target > 0) this._reset(target);
    else if (behind || farAhead) this._reset(target);
    for (let guard = 0; guard < 2000; guard++) {
      if (this.error) throw this.error;
      if (this.pending.size) await Promise.all([...this.pending]);
      const a = this.frames;
      // Have a frame at/after the target, or the stream is exhausted?
      const after = a.findIndex((f) => f.timestamp > target + half);
      const done = this.flushed && this.dec.decodeQueueSize === 0;
      if (after > 0 || (done && a.length) || (after === 0 && a.length)) {
        let idx = after > 0 ? after - 1 : after === 0 ? 0 : a.length - 1;
        // Keep the chosen frame, drop older ones.
        for (let i = 0; i < idx; i++) a[i].bmp.close();
        a.splice(0, idx);
        return a[0];
      }
      const fed = await this._feed(4);
      if (!fed && this.flushed) {
        await new Promise((r) => setTimeout(r, 0));
        if (!a.length && this.dec.decodeQueueSize === 0) return null;
      } else if (fed) await new Promise((r) => setTimeout(r, 0));
    }
    return this.frames[0] || null;
  }

  close() {
    this.gen++;
    for (const f of this.frames) f.bmp.close();
    this.frames = [];
    if (this.dec.state !== 'closed') this.dec.close();
  }
}
