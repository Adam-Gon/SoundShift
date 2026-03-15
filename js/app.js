/**
 * app.js
 * SoundShift — main application controller.
 */

'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  files:      [],
  converting: false,
};

let _nextId = 0;

// ── DOM references ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dropzone       = $('dropzone');
const fileInput      = $('fileInput');
const queue          = $('queue');
const convertBtn     = $('convertBtn');
const downloadAllBtn = $('downloadAllBtn');
const fmtSelect      = $('fmtSelect');
const fmtNotice      = $('fmtNotice');
const qSelect        = $('qSelect');
const statFiles      = $('statFiles');
const statConverted  = $('statConverted');
const statSize       = $('statSize');
const statsBar       = $('statsBar');
const toast          = $('toast');
const toastIcon      = $('toastIcon');
const toastMsg       = $('toastMsg');

// ── Helpers ──────────────────────────────────────────────────────────────────

function getExt(name) {
  return (name.split('.').pop() || '???').toUpperCase().slice(0, 5);
}

function fmtSize(bytes) {
  if (bytes < 1024)        return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function totalQueueSize() {
  return state.files.reduce((acc, f) => acc + f.file.size, 0);
}

/**
 * Sanitize a string for safe insertion into HTML attributes and text.
 * Prevents XSS from malicious filenames.
 */
function sanitize(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Toast ────────────────────────────────────────────────────────────────────
let _toastTimer = null;

function showToast(msg, type = 'success') {
  toastIcon.textContent = type === 'success' ? '✓' : '✗';
  toastMsg.textContent  = msg;
  toast.className       = `show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.className = ''; }, 3800);
}

// ── Stats ────────────────────────────────────────────────────────────────────
function updateStats() {
  const total     = state.files.length;
  const doneCount = state.files.filter(f => f.status === 'done').length;

  statFiles.textContent     = total;
  statConverted.textContent = doneCount;
  statSize.textContent      = fmtSize(totalQueueSize());

  statsBar.classList.toggle('visible', total > 0);
  downloadAllBtn.classList.toggle('visible', doneCount > 0);
  convertBtn.disabled = total === 0 || state.converting;
}

// ── Icons ────────────────────────────────────────────────────────────────────
const ICONS = {
  download: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  remove:   `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

// ── Render queue ─────────────────────────────────────────────────────────────
function renderQueue() {
  queue.innerHTML = '';

  for (const item of state.files) {
    const card = document.createElement('div');
    card.className = `file-card ${item.status}`;
    card.id        = `card-${item.id}`;
    card.setAttribute('role', 'listitem');

    const dotClass  = item.status === 'active' ? 'spinning' : item.status;
    const safeName  = sanitize(item.file.name);
    const safeOut   = sanitize(item.outName || '');
    const safeMeta  = sanitize(item.statusText);
    const dlBtn     = item.status === 'done'
      ? `<button class="btn-icon download" onclick="App.downloadItem(${item.id})" title="Baixar" aria-label="Baixar ${safeOut}">${ICONS.download}</button>`
      : '';

    card.innerHTML = `
      <div class="file-ext" aria-hidden="true">${getExt(item.file.name)}</div>
      <div class="file-info">
        <div class="file-name" title="${safeName}">${safeName}</div>
        <div class="file-meta">${fmtSize(item.file.size)} · ${safeMeta}</div>
        <div class="file-progress-bar" role="progressbar" aria-valuenow="${item.progress}" aria-valuemin="0" aria-valuemax="100">
          <div class="file-progress-fill" id="prog-${item.id}" style="width:${item.progress}%"></div>
        </div>
      </div>
      <div class="file-actions">
        <div class="status-dot ${dotClass}" aria-hidden="true"></div>
        ${dlBtn}
        <button class="btn-icon remove" onclick="App.removeItem(${item.id})" title="Remover" aria-label="Remover ${safeName}">${ICONS.remove}</button>
      </div>
    `;

    queue.appendChild(card);
  }
}

// ── File management ──────────────────────────────────────────────────────────
const ACCEPTED_EXTENSIONS = /\.(mp3|wav|ogg|flac|aac|m4a|opus|webm|wma|aiff|au)$/i;
const MAX_FILE_MB          = 300;

function addFiles(files) {
  let added      = 0;
  let duplicates = [];
  let invalid    = 0;
  let tooBig     = [];

  for (const file of files) {
    // Validate format
    if (!file.type.startsWith('audio/') && !ACCEPTED_EXTENSIONS.test(file.name)) {
      invalid++;
      continue;
    }

    // Validate size
    if (file.size > MAX_FILE_BYTES) {
      tooBig.push(`"${file.name}" (${(file.size / 1024 / 1024).toFixed(0)} MB)`);
      continue;
    }

    // Detect duplicates by name + size
    const exists = state.files.some(f => f.file.name === file.name && f.file.size === file.size);
    if (exists) {
      duplicates.push(file.name);
      continue;
    }

    state.files.push({
      id:         _nextId++,
      file,
      status:     'pending',
      statusText: 'Aguardando',
      progress:   0,
      url:        null,
      outName:    null,
    });
    added++;
  }

  // Specific feedback for each rejection reason
  if (tooBig.length > 0) {
    showToast(`Arquivo muito grande (máx. ${MAX_FILE_MB} MB): ${tooBig[0]}`, 'error');
  } else if (duplicates.length > 0) {
    const label = duplicates.length === 1
      ? `"${duplicates[0]}" já está na fila.`
      : `${duplicates.length} arquivos já estão na fila: ${duplicates.slice(0, 2).map(n => `"${n}"`).join(', ')}${duplicates.length > 2 ? '…' : ''}.`;
    showToast(label, 'error');
  } else if (invalid > 0 && added === 0) {
    showToast('Formato não suportado. Envie arquivos de áudio.', 'error');
  }

  if (added > 0) {
    renderQueue();
    updateStats();
  }
}

// ── Public actions ───────────────────────────────────────────────────────────
window.App = {
  removeItem(id) {
    const idx = state.files.findIndex(f => f.id === id);
    if (idx < 0) return;
    const item = state.files[idx];
    if (item.url) URL.revokeObjectURL(item.url);
    state.files.splice(idx, 1);
    renderQueue();
    updateStats();
  },

  downloadItem(id) {
    const item = state.files.find(f => f.id === id);
    if (!item?.url) return;
    triggerDownload(item.url, item.outName);
  },
};

function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Conversion ───────────────────────────────────────────────────────────────
function startProgressTick(item) {
  return setInterval(() => {
    if (item.progress < 82) {
      item.progress += Math.random() * 8 + 2;
      const bar = document.getElementById(`prog-${item.id}`);
      if (bar) bar.style.width = `${Math.min(item.progress, 82)}%`;
    }
  }, 300);
}

function outputExtension(fmt) {
  return { aac: 'm4a', opus: 'opus', ogg: 'ogg', flac: 'flac', wav: 'wav', mp3: 'mp3', aiff: 'aiff' }[fmt] || fmt;
}

async function convertAll() {
  if (state.converting) return;

  state.converting    = true;
  convertBtn.disabled = true;

  const fmt     = fmtSelect.value;
  const bitrate = qSelect.value;

  // Snapshot IDs to convert — avoids processing files removed mid-conversion
  const pendingIds = state.files
    .filter(f => f.status !== 'done')
    .map(f => f.id);

  const SLOW_FORMATS = new Set(['ogg', 'flac', 'aac', 'opus']);

  for (const id of pendingIds) {
    // Re-look up the item — skip if it was removed from the queue while we were converting
    const item = state.files.find(f => f.id === id);
    if (!item) continue;

    item.status     = 'active';
    item.statusText = SLOW_FORMATS.has(fmt)
      ? 'Convertendo em tempo real — pode demorar a duração do áudio'
      : 'Convertendo…';
    item.progress   = 5;
    renderQueue();

    const tick = startProgressTick(item);

    try {
      const blob = await SoundShiftEncoder.convertAudioFile(item.file, fmt, bitrate);
      clearInterval(tick);

      // Item may have been removed while awaiting — check again
      if (!state.files.find(f => f.id === id)) {
        URL.revokeObjectURL(URL.createObjectURL(blob)); // free immediately
        continue;
      }

      if (item.url) URL.revokeObjectURL(item.url);

      item.url        = URL.createObjectURL(blob);
      item.outName    = item.file.name.replace(/\.[^.]+$/, '') + '.' + outputExtension(fmt);
      item.status     = 'done';
      item.statusText = `Concluído · ${fmtSize(blob.size)}`;
      item.progress   = 100;

    } catch (err) {
      clearInterval(tick);
      console.error('[SoundShift] Conversion error:', err);

      // Item may have been removed — skip update if gone
      if (!state.files.find(f => f.id === id)) continue;

      item.status     = 'error';
      item.statusText = `Erro: ${err.message}`;
      item.progress   = 0;
    }

    renderQueue();
    updateStats();
  }

  state.converting    = false;
  convertBtn.disabled = false;

  const doneCount = state.files.filter(f => f.status === 'done').length;
  const errCount  = state.files.filter(f => f.status === 'error').length;

  if (doneCount > 0) showToast(`${doneCount} arquivo(s) convertido(s) com sucesso!`, 'success');
  if (errCount  > 0) showToast(`${errCount} arquivo(s) com erro na conversão.`, 'error');
}

function downloadAll() {
  state.files
    .filter(f => f.status === 'done')
    .forEach(item => triggerDownload(item.url, item.outName));
}

// ── Events ───────────────────────────────────────────────────────────────────
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', e => { addFiles(e.target.files); fileInput.value = ''; });
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', e => {
  if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('drag-over');
});
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('drag-over');
  addFiles(e.dataTransfer.files);
});
convertBtn.addEventListener('click', convertAll);
downloadAllBtn.addEventListener('click', downloadAll);

const SLOW_FORMATS = new Set(['ogg', 'flac', 'aac', 'opus']);
fmtSelect.addEventListener('change', () => {
  fmtNotice.hidden = !SLOW_FORMATS.has(fmtSelect.value);
});

// ── Boot ─────────────────────────────────────────────────────────────────────
updateStats();
console.info('%cSoundShift 🎵 loaded', 'color:#22c55e;font-weight:bold;font-size:14px');
