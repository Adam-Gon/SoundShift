/**
 * encoder.js
 * Audio encoding utilities for SoundShift.
 *
 * Handles:
 *  - WAV  — pure JS, works everywhere
 *  - AIFF — pure JS, big-endian PCM (Apple/Mac format)
 *  - MP3  — via lamejs (CDN)
 *  - OGG / FLAC / AAC / OPUS — AudioBufferSourceNode + MediaRecorder
 */

'use strict';

// ── File size limit: 300 MB ──────────────────────────────────────────────────
const MAX_FILE_BYTES = 300 * 1024 * 1024;

// ── Shared AudioContext ──────────────────────────────────────────────────────
const AudioCtx = new (window.AudioContext || window.webkitAudioContext)();

/** Resume AudioContext if suspended (browsers pause it until a user gesture). */
async function resumeCtx() {
  if (AudioCtx.state === 'suspended') await AudioCtx.resume();
}

/**
 * Decode an audio File into an AudioBuffer.
 * @param {File} file
 * @returns {Promise<AudioBuffer>}
 */
async function decodeAudioFile(file) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`Arquivo muito grande (máx. 300 MB). Este arquivo tem ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
  }
  await resumeCtx();
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
  view.setUint32(4,  36 + numSamples * 2,          true);
  writeString(8,  'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16,                            true);
  view.setUint16(20, 1,                             true);
  view.setUint16(22, numChannels,                   true);
  view.setUint32(24, sampleRate,                    true);
  view.setUint32(28, sampleRate * numChannels * 2,  true);
  view.setUint16(32, numChannels * 2,               true);
  view.setUint16(34, 16,                            true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2,                true);

  let offset = 44;
  for (let i = 0; i < audioBuf.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, audioBuf.getChannelData(ch)[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Encode an AudioBuffer as an AIFF Blob.
 *
 * AIFF uses big-endian byte order (opposite of WAV).
 * Structure: FORM chunk > COMM chunk > SSND chunk.
 *
 * @param {AudioBuffer} audioBuf
 * @returns {Blob}
 */
function encodeAIFF(audioBuf) {
  const numChannels = audioBuf.numberOfChannels;
  const numFrames   = audioBuf.length;
  const sampleRate  = audioBuf.sampleRate;
  const bitDepth    = 16;
  const blockSize   = numChannels * (bitDepth / 8);
  const dataBytes   = numFrames * blockSize;

  // COMM chunk size = 26, SSND chunk size = 8 + dataBytes
  // FORM size = 4 (AIFF) + 8+26 (COMM) + 8+8+dataBytes (SSND)
  const formSize = 4 + (8 + 26) + (8 + 8 + dataBytes);
  const buffer   = new ArrayBuffer(8 + formSize);
  const view     = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /**
   * Write an 80-bit IEEE 754 extended (big-endian) for AIFF COMM sampleRate.
   * This is the format AIFF requires for sample rate storage.
   */
  function writeExtended(offset, value) {
    let exp = 0;
    let mant = value;
    if (mant > 0) {
      exp = Math.floor(Math.log2(mant));
      mant = mant / Math.pow(2, exp - 31);
      exp += 16383;
    }
    view.setUint16(offset,     exp,                     false);
    view.setUint32(offset + 2, Math.floor(mant),        false);
    view.setUint32(offset + 6, 0,                       false);
  }

  let off = 0;

  // FORM chunk
  writeString(off, 'FORM'); off += 4;
  view.setUint32(off, formSize, false); off += 4;
  writeString(off, 'AIFF'); off += 4;

  // COMM chunk
  writeString(off, 'COMM'); off += 4;
  view.setUint32(off, 26, false); off += 4;        // chunk size
  view.setInt16(off, numChannels, false); off += 2; // numChannels
  view.setUint32(off, numFrames, false); off += 4;  // numSampleFrames
  view.setInt16(off, bitDepth, false); off += 2;    // sampleSize
  writeExtended(off, sampleRate); off += 10;        // sampleRate (80-bit extended)

  // SSND chunk
  writeString(off, 'SSND'); off += 4;
  view.setUint32(off, 8 + dataBytes, false); off += 4; // chunk size
  view.setUint32(off, 0, false); off += 4;             // offset (always 0)
  view.setUint32(off, 0, false); off += 4;             // blockSize (always 0)

  // PCM samples — big-endian, interleaved
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, audioBuf.getChannelData(ch)[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, false); // big-endian
      off += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/aiff' });
}


 * @param {AudioBuffer} audioBuf
 * @param {number}      kbps
 * @returns {Blob}
 */
function encodeMP3(audioBuf, kbps = 128) {
  if (!window.lamejs) throw new Error('Biblioteca MP3 (lamejs) não carregou. Verifique sua conexão.');

  const channels = Math.min(audioBuf.numberOfChannels, 2);
  const encoder  = new lamejs.Mp3Encoder(channels, audioBuf.sampleRate, kbps);

  function float32ToInt16(f32) {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32767));
    }
    return i16;
  }

  const leftI16  = float32ToInt16(audioBuf.getChannelData(0));
  const rightI16 = channels === 2 ? float32ToInt16(audioBuf.getChannelData(1)) : leftI16;
  const BLOCK    = 1152;
  const chunks   = [];

  for (let i = 0; i < leftI16.length; i += BLOCK) {
    const lChunk = leftI16.subarray(i, i + BLOCK);
    const rChunk = rightI16.subarray(i, i + BLOCK);
    const buf    = channels === 2
      ? encoder.encodeBuffer(lChunk, rChunk)
      : encoder.encodeBuffer(lChunk);
    if (buf.length > 0) chunks.push(buf);
  }

  const end = encoder.flush();
  if (end.length > 0) chunks.push(end);

  return new Blob(chunks, { type: 'audio/mpeg' });
}

/**
 * Encode via MediaRecorder using AudioBufferSourceNode.
 *
 * AudioBufferSourceNode.onended fires reliably when the buffer finishes.
 * We also resume the AudioContext mid-recording if the tab was backgrounded.
 *
 * @param {AudioBuffer} audioBuf
 * @param {string}      targetFmt
 * @returns {Promise<Blob>}
 */
function encodeViaMediaRecorder(audioBuf, targetFmt) {
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
    const streamDest = AudioCtx.createMediaStreamDestination();
    const source     = AudioCtx.createBufferSource();
    source.buffer    = audioBuf;
    source.connect(streamDest);

    const recorder = new MediaRecorder(streamDest.stream, { mimeType });
    const chunks   = [];
    let   settled  = false;

    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      resolve(new Blob(chunks, { type: mimeType }));
    }

    function fail(msg) {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      reject(new Error(msg));
    }

    // Safety timeout — stops recorder if onended never fires
    const safetyTimer = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, (audioBuf.duration + 5) * 1000);

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop  = () => finish();
    recorder.onerror = e => fail('Erro no MediaRecorder: ' + (e.error?.message || 'desconhecido'));

    // Resume AudioContext if it was suspended (e.g. tab went to background)
    source.onended = () => {
      resumeCtx().finally(() => {
        if (recorder.state === 'recording') recorder.stop();
      });
    };

    recorder.start(100);
    source.start(0);
  });
}

/**
 * Main conversion entry point.
 * @param {File}   file
 * @param {string} targetFmt - 'mp3' | 'wav' | 'ogg' | 'flac' | 'aac' | 'opus'
 * @param {string} bitrate   - e.g. '192k'
 * @returns {Promise<Blob>}
 */
async function convertAudioFile(file, targetFmt, bitrate) {
  const audioBuf = await decodeAudioFile(file);
  const kbps     = parseInt(bitrate, 10) || 128;

  switch (targetFmt) {
    case 'wav':  return encodeWAV(audioBuf);
    case 'aiff': return encodeAIFF(audioBuf);
    case 'mp3':  return encodeMP3(audioBuf, kbps);
    case 'ogg':
    case 'flac':
    case 'aac':
    case 'opus': return encodeViaMediaRecorder(audioBuf, targetFmt);
    default:     throw new Error(`Formato não suportado: ${targetFmt}`);
  }
}

// ── Exported interface ───────────────────────────────────────────────────────
window.SoundShiftEncoder = { convertAudioFile };
