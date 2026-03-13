/**
 * app.js
 * SoundShift — main application controller.
 *
 * Responsibilities:
 *  - File queue state management
 *  - Drag & drop / file input handling
 *  - UI rendering (file cards, stats, toasts)
 *  - Orchestrating conversions via SoundShiftEncoder
 */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  files:      [],   // Array of FileItem objects
  converting: false,
};

let _nextId = 0;

/**
 * @typedef {Object} FileItem
 * @property {number}  id
 * @property {File}    file
 * @property {'pending'|'active'|'done'|'error'} status
 * @property {string}  statusText
 * @property {number}  progress    - 0–100
 * @property {Blob|null}   blob
 * @property {string|null} url     - object URL for download
 * @property {string|null} outName - filename for download
 */

// ── DOM references ──────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const dropzone      = $('dropzone');
const fileInput     = $('fileInput');
const queue         = $('queue');
const convertBtn    = $('convertBtn');
const downloadAllBtn= $('downloadAllBtn');
const fmtSelect     = $('fmtSelect');
const qSelect       = $('qSelect');
const statFiles     = $('statFiles');
const statConverted = $('statConverted');
const statSize      = $('statSize');
const statsBar      = $('statsBar');
const vizSection    = $('vizSection');
const waveCanvas    = $('waveCanvas');
const toast         = $('toast');
const toastIcon     = $('toastIcon');
const toastMsg      = $('toastMsg');

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Return the uppercased extension of a filename (max 5 chars). */
function getExt(name) {
  return (name.split('.').pop() || '???').toUpperCase().slice(0, 5);
}

/** Human-readable file size. */
function fmtSize(bytes) {
  if (bytes < 1024)              return bytes + ' B';
  if (bytes < 1024 * 1024)      return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

/** Sum of all file sizes in the queue. */
function totalQueueSize() {
  return state.files.reduce((acc, item) => acc + item.file.size, 0);
}

// ── Toast ───────────────────────────────────────────────────────────────────
let _toastTimer = null;

/**
 * @param {string} msg
 * @param {'success'|'error'} type
 */
function showToast(msg, type = 'success') {
  toastIcon.textContent = type === 'success' ? '✓' : '✗';
  toastMsg.textContent  = msg;
  toast.className       = `show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.className = ''; }, 3500);
}

// ── Stats & controls ────────────────────────────────────────────────────────
function updateStats() {
  const total    = state.files.length;
  const doneCount = state.files.filter(f => f.status === 'done').length;

  statFiles.textContent     = total;
  statConverted.textContent = doneCount;
  statSize.textContent      = fmtSize(totalQueueSize());

  statsBar.classList.toggle('visible', total > 0);
  downloadAllBtn.classList.toggle('visible', doneCount > 0);
  convertBtn.disabled = total === 0 || state.converting;
}

// ── Rendering ───────────────────────────────────────────────────────────────

/** Build the SVG icon markup for download / remove buttons. */
const ICONS = {
  download: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  remove:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

/** Render the entire file queue from state. */
function renderQueue() {
  queue.innerHTML = '';

  for (const item of state.files) {
    const card = document.createElement('div');
    card.className  = `file-card ${item.status}`;
    card.id         = `card-${item.id}`;
    card.setAttribute('role', 'listitem');

    const dotClass = item.status === 'active' ? 'spinning' : item.status;
    const dlBtn    = item.status === 'done'
      ? `<button class="btn-icon download" onclick="App.downloadItem(${item.id})" title="Baixar" aria-label="Baixar ${item.outName}">${ICONS.download}</button>`
      : '';

    card.innerHTML = `
      <div class="file-ext" aria-hidden="true">${getExt(item.file.name)}</div>
      <div class="file-info">
        <div class="file-name" title="${item.file.name}">${item.file.name}</div>
        <div class="file-meta">${fmtSize(item.file.size)} · ${item.statusText}</div>
        <div class="file-progress-bar" role="progressbar" aria-valuenow="${item.progress}" aria-valuemin="0" aria-valuemax="100">
          <div class="file-progress-fill" id="prog-${item.id}" style="width:${item.progress}%"></div>
        </div>
      </div>
      <div class="file-actions">
        <div class="status-dot ${dotClass}" aria-hidden="true"></div>
        ${dlBtn}
        <button class="btn-icon remove" onclick="App.removeItem(${item.id})" title="Remover" aria-label="Remover ${item.file.name}">${ICONS.remove}</button>
      </div>
    `;

    queue.appendChild(card);
  }
}

// ── File management ─────────────────────────────────────────────────────────

const ACCEPTED_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|m4a|opus|webm|wma|aiff|au)$/i;

/**
 * Add files to the queue (deduplicates by name+size).
 * @param {FileList|File[]} files
 */
function addFiles(files) {
  let added = 0;

  for (const file of files) {
    // Accept audio/* MIME or known audio extensions
    if (!file.type.startsWith('audio/') && !ACCEPTED_EXTENSIONS.test(file.name)) continue;

    // Deduplicate
    const exists = state.files.some(f => f.file.name === file.name && f.file.size === file.size);
    if (exists) continue;

    /** @type {FileItem} */
    const item = {
      id:         _nextId++,
      file,
      status:     'pending',
      statusText: 'Aguardando',
      progress:   0,
      blob:       null,
      url:        null,
      outName:    null,
    };

    state.files.push(item);
    added++;
  }

  if (added === 0) {
    showToast('Nenhum arquivo de áudio válido encontrado.', 'error');
    return;
  }

  renderQueue();
  updateStats();

  // Draw waveform for the latest file
  const latest = state.files[state.files.length - 1];
  SoundShiftEncoder.drawWaveform(latest.file, waveCanvas)
    .then(() => vizSection.classList.add('visible'))
    .catch(() => {/* silently ignore waveform errors */});
}

// ── Public actions (bound to onclick in HTML) ───────────────────────────────
window.App = {
  removeItem(id) {
    const idx = state.files.findIndex(f => f.id === id);
    if (idx < 0) return;
    const item = state.files[idx];
    if (item.url) URL.revokeObjectURL(item.url);
    state.files.splice(idx, 1);
    renderQueue();
    updateStats();

    if (state.files.length === 0) {
      vizSection.classList.remove('visible');
    }
  },

  downloadItem(id) {
    const item = state.files.find(f => f.id === id);
    if (!item?.url) return;
    triggerDownload(item.url, item.outName);
  },
};

/** Create a temporary <a> and trigger download. */
function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Conversion ───────────────────────────────────────────────────────────────

/** Simulate smooth progress fill during encoding. */
function startProgressTick(item) {
  return setInterval(() => {
    if (item.progress < 82) {
      item.progress += Math.random() * 9 + 3;
      const bar = document.getElementById(`prog-${item.id}`);
      if (bar) bar.style.width = `${Math.min(item.progress, 82)}%`;
    }
  }, 250);
}

/** Determine the output filename extension for a given format. */
function outputExtension(fmt) {
  const map = { aac: 'm4a', opus: 'opus', ogg: 'ogg', flac: 'flac', wav: 'wav', mp3: 'mp3' };
  return map[fmt] || fmt;
}

/** Convert all pending files sequentially. */
async function convertAll() {
  if (state.converting) return;

  state.converting = true;
  convertBtn.disabled = true;

  const fmt    = fmtSelect.value;
  const bitrate = qSelect.value;
  const pending = state.files.filter(f => f.status !== 'done');

  for (const item of pending) {
    // Mark as active
    item.status     = 'active';
    item.statusText = 'Convertendo…';
    item.progress   = 5;
    renderQueue();

    const tick = startProgressTick(item);

    try {
      const blob = await SoundShiftEncoder.convertAudioFile(item.file, fmt, bitrate);
      clearInterval(tick);

      // Free previous URL if re-converting
      if (item.url) URL.revokeObjectURL(item.url);

      item.blob      = blob;
      item.url       = URL.createObjectURL(blob);
      item.outName   = item.file.name.replace(/\.[^.]+$/, '') + '.' + outputExtension(fmt);
      item.status    = 'done';
      item.statusText = `Concluído · ${fmtSize(blob.size)}`;
      item.progress  = 100;

    } catch (err) {
      clearInterval(tick);
      console.error('[SoundShift] Conversion error:', err);
      item.status     = 'error';
      item.statusText = `Erro: ${err.message}`;
      item.progress   = 0;
    }

    renderQueue();
    updateStats();
  }

  state.converting = false;
  convertBtn.disabled = false;

  const doneCount = state.files.filter(f => f.status === 'done').length;
  const errCount  = state.files.filter(f => f.status === 'error').length;

  if (doneCount > 0) {
    showToast(`${doneCount} arquivo(s) convertido(s) com sucesso!`, 'success');
  }
  if (errCount > 0) {
    showToast(`${errCount} arquivo(s) com erro.`, 'error');
  }
}

/** Download all successfully converted files. */
function downloadAll() {
  const done = state.files.filter(f => f.status === 'done');
  if (!done.length) return;
  done.forEach(item => triggerDownload(item.url, item.outName));
}

// ── Event wiring ─────────────────────────────────────────────────────────────
dropzone.addEventListener('click', () => fileInput.click());

dropzone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

fileInput.addEventListener('change', e => {
  addFiles(e.target.files);
  fileInput.value = ''; // reset so same file can be re-added after removal
});

dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('drag-over');
});

dropzone.addEventListener('dragleave', e => {
  if (!dropzone.contains(e.relatedTarget)) {
    dropzone.classList.remove('drag-over');
  }
});

dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  addFiles(e.dataTransfer.files);
});

convertBtn.addEventListener('click', convertAll);
downloadAllBtn.addEventListener('click', downloadAll);

// Redraw waveform on window resize (canvas pixel density)
window.addEventListener('resize', () => {
  const lastFile = state.files[state.files.length - 1];
  if (lastFile) {
    SoundShiftEncoder.drawWaveform(lastFile.file, waveCanvas).catch(() => {});
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
updateStats();
console.info('%cSoundShift 🎵 loaded', 'color:#22c55e;font-weight:bold;font-size:14px');
