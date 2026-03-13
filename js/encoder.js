/**
 * encoder.js
 * Audio encoding utilities for SoundShift.
 *
 * Handles:
 *  - WAV encoding (pure JS, works everywhere)
 *  - MP3 encoding (via lamejs, loaded from CDN in index.html)
 *  - OGG / FLAC / AAC / OPUS (via browser MediaRecorder API)
 */

'use strict';

// ── Shared AudioContext (created once) ──────────────────────────────────────
const AudioCtx = new (window.AudioContext || window.webkitAudioContext)();

/**
 * Decode an audio File into an AudioBuffer.
 * @param {File} file
 * @returns {Promise<AudioBuffer>}
 */
async function decodeAudioFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  return AudioCtx.decodeAudioData(arrayBuffer);
}

/**
 * Encode an AudioBuffer as a PCM WAV Blob.
 * @param {AudioBuffer} audioBuf
 * @returns {Blob}
 */
function encodeWAV(audioBuf) {
  const numChannels = audioBuf.numberOfChannels;
  const sampleRate  = audioBuf.sampleRate;
  const numSamples  = audioBuf.length * numChannels;
  const buffer      = new ArrayBuffer(44 + numSamples * 2);
  const view        = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4,  36 + numSamples * 2, true);
  writeString(8,  'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16,           true);  // PCM chunk size
  view.setUint16(20, 1,            true);  // PCM format
  view.setUint16(22, numChannels,  true);
  view.setUint32(24, sampleRate,   true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16,           true);  // 16-bit
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < audioBuf.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, audioBuf.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Encode an AudioBuffer as MP3 using lamejs.
 * lamejs must already be loaded (script tag in index.html).
 * @param {AudioBuffer} audioBuf
 * @param {number}      kbps  - target bitrate in kbps (e.g. 128, 192, 320)
 * @returns {Blob}
 */
function encodeMP3(audioBuf, kbps = 128) {
  if (!window.lamejs) throw new Error('lamejs não está disponível.');

  const channels = Math.min(audioBuf.numberOfChannels, 2);
  const encoder  = new lamejs.Mp3Encoder(channels, audioBuf.sampleRate, kbps);

  /** Convert Float32Array → Int16Array */
  function float32ToInt16(f32) {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32767));
    }
    return i16;
  }

  const leftI16  = float32ToInt16(audioBuf.getChannelData(0));
  const rightI16 = channels === 2 ? float32ToInt16(audioBuf.getChannelData(1)) : leftI16;

  const BLOCK = 1152; // lamejs required block size
  const chunks = [];

  for (let i = 0; i < leftI16.length; i += BLOCK) {
    const lChunk = leftI16.subarray(i, i + BLOCK);
    const rChunk = rightI16.subarray(i, i + BLOCK);
    const buf = channels === 2
      ? encoder.encodeBuffer(lChunk, rChunk)
      : encoder.encodeBuffer(lChunk);
    if (buf.length > 0) chunks.push(buf);
  }

  const end = encoder.flush();
  if (end.length > 0) chunks.push(end);

  return new Blob(chunks, { type: 'audio/mpeg' });
}

/**
 * Encode an AudioBuffer using the browser's MediaRecorder API.
 * Used for OGG, FLAC, AAC, OPUS.
 *
 * Notes:
 *  - Available codecs vary by browser (Chrome, Firefox, Safari differ).
 *  - Falls back to audio/webm if the preferred MIME type is not supported.
 *
 * @param {AudioBuffer} audioBuf
 * @param {string}      targetFmt  - 'ogg' | 'flac' | 'aac' | 'opus'
 * @returns {Promise<Blob>}
 */
function encodeViaMediaRecorder(audioBuf, targetFmt) {
  // Build WAV as intermediate source
  const wavBlob = encodeWAV(audioBuf);
  const wavUrl  = URL.createObjectURL(wavBlob);

  // MIME type preference lists per format
  const mimePreferences = {
    ogg:  ['audio/ogg;codecs=vorbis', 'audio/ogg', 'audio/webm;codecs=opus', 'audio/webm'],
    flac: ['audio/flac', 'audio/ogg;codecs=flac', 'audio/ogg', 'audio/webm'],
    aac:  ['audio/aac', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/webm'],
    opus: ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'],
  };

  let mimeType = 'audio/webm';
  for (const mime of (mimePreferences[targetFmt] || [])) {
    if (MediaRecorder.isTypeSupported(mime)) { mimeType = mime; break; }
  }

  return new Promise((resolve, reject) => {
    const audio    = new Audio(wavUrl);
    const source   = AudioCtx.createMediaElementSource(audio);
    const dest     = AudioCtx.createMediaStreamDestination();
    source.connect(dest);

    const recorder = new MediaRecorder(dest.stream, { mimeType });
    const chunks   = [];

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop  = () => { URL.revokeObjectURL(wavUrl); resolve(new Blob(chunks, { type: mimeType })); };
    recorder.onerror = e => { URL.revokeObjectURL(wavUrl); reject(new Error('MediaRecorder error: ' + e.message)); };

    audio.onended = () => recorder.stop();
    audio.onerror = ()  => reject(new Error('Erro ao reproduzir áudio intermediário.'));

    recorder.start();
    audio.play().catch(reject);
  });
}

/**
 * Main conversion entry point.
 * Decides which encoder to use based on the target format.
 *
 * @param {File}   file       - input audio file
 * @param {string} targetFmt  - 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac' | 'opus'
 * @param {string} bitrate    - e.g. '192k' (used for MP3)
 * @returns {Promise<Blob>}
 */
async function convertAudioFile(file, targetFmt, bitrate) {
  const audioBuf = await decodeAudioFile(file);
  const kbps     = parseInt(bitrate, 10) || 128;

  switch (targetFmt) {
    case 'wav':
      return encodeWAV(audioBuf);

    case 'mp3':
      return encodeMP3(audioBuf, kbps);

    case 'ogg':
    case 'flac':
    case 'aac':
    case 'opus':
      return encodeViaMediaRecorder(audioBuf, targetFmt);

    default:
      throw new Error(`Formato não suportado: ${targetFmt}`);
  }
}

/**
 * Draw the waveform of an audio file onto a <canvas>.
 * @param {File}            file
 * @param {HTMLCanvasElement} canvas
 */
async function drawWaveform(file, canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = canvas.offsetWidth  * dpr;
  canvas.height = canvas.offsetHeight * dpr;
  ctx.scale(dpr, dpr);

  const audioBuf = await decodeAudioFile(file);
  const data     = audioBuf.getChannelData(0);
  const W        = canvas.offsetWidth;
  const H        = canvas.offsetHeight;
  const step     = Math.ceil(data.length / W);

  ctx.clearRect(0, 0, W, H);

  const gradient = ctx.createLinearGradient(0, 0, W, 0);
  gradient.addColorStop(0, '#22c55e');
  gradient.addColorStop(1, '#4ade80');

  ctx.strokeStyle = gradient;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();

  for (let x = 0; x < W; x++) {
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const v = data[x * step + j] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ctx.moveTo(x, ((1 + min) / 2) * H);
    ctx.lineTo(x, ((1 + max) / 2) * H);
  }

  ctx.stroke();
}

// ── Exported interface (accessible globally) ────────────────────────────────
window.SoundShiftEncoder = {
  convertAudioFile,
  drawWaveform,
};
