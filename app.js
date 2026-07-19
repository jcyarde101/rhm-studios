const icons = {
  home: '<path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  library: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 3v18M12 7h5M12 11h5"/>',
  clips: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5z"/><path d="M8 7h8"/>',
  sparkle: '<path d="m12 3 1.4 4.1L17.5 9l-4.1 1.9L12 15l-1.4-4.1L6.5 9l4.1-1.9zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z"/>',
  moon: '<path d="M20 15.5A9 9 0 0 1 8.5 4 9 9 0 1 0 20 15.5z"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14"/>',
  writing: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>'
};

function renderIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(element => {
    const name = element.dataset.icon;
    element.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ''}</svg>`;
  });
}

const modal = document.getElementById('uploadModal');
const fileInput = document.getElementById('fileInput');
const startProjectButton = document.getElementById('startProject');
const projectList = document.getElementById('library');
const titleInput = modal.querySelector('.modal-fields label:nth-child(1) input');
const scriptureInput = modal.querySelector('.modal-fields label:nth-child(2) input');
const modalFields = modal.querySelector('.modal-fields');
const dateLabel = document.createElement('label');
dateLabel.innerHTML = 'Recording date<input id="recordingDate" type="date">';
modalFields.append(dateLabel);
const recordingDateInput = dateLabel.querySelector('input');
recordingDateInput.value = new Date().toISOString().slice(0, 10);
titleInput.id = 'projectTitle';
scriptureInput.id = 'projectScripture';
titleInput.maxLength = 200;
scriptureInput.maxLength = 200;
fileInput.accept = 'video/mp4,video/quicktime,video/webm,video/x-m4v';
modal.querySelector('.dropzone small').textContent = 'MP4, MOV, M4V, or WebM - current limit 50 MB';
startProjectButton.textContent = 'Upload & create project';

const formError = document.createElement('div');
formError.id = 'uploadFormError';
formError.className = 'form-error';
formError.setAttribute('role', 'alert');
modalFields.after(formError);

const uploadQueue = document.createElement('section');
uploadQueue.className = 'upload-queue';
uploadQueue.id = 'uploadQueue';
uploadQueue.hidden = true;
uploadQueue.setAttribute('aria-live', 'polite');
uploadQueue.innerHTML = `
  <div class="upload-queue-icon"><span data-icon="upload"></span></div>
  <div class="upload-queue-main">
    <div class="upload-queue-heading"><div><small id="uploadPhase">PREPARING SECURE UPLOAD</small><strong id="uploadTitle">Your devotional</strong></div><b id="uploadPercent">0%</b></div>
    <div class="upload-progress"><i id="uploadProgressBar"></i></div>
    <p id="uploadMessage">Creating the project and secure storage path.</p>
  </div>
  <button class="text-button" id="cancelUpload" type="button">Cancel</button>`;
document.querySelector('.studio-card').after(uploadQueue);

const uploadPhase = uploadQueue.querySelector('#uploadPhase');
const uploadTitle = uploadQueue.querySelector('#uploadTitle');
const uploadPercent = uploadQueue.querySelector('#uploadPercent');
const uploadProgressBar = uploadQueue.querySelector('#uploadProgressBar');
const uploadMessage = uploadQueue.querySelector('#uploadMessage');
const cancelUploadButton = uploadQueue.querySelector('#cancelUpload');
let activeUpload = null;
let activeProjectId = null;
let maxUploadBytes = 50 * 1024 * 1024;

renderIcons();

function openModal() {
  formError.textContent = '';
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return 'Created recently';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (response.status === 401) {
    window.location.href = '/signin';
    throw new Error('Your session expired. Please sign in again.');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'The request could not be completed.');
  return data;
}

function showToast(title, message, isError = false) {
  const toast = document.getElementById('toast');
  toast.classList.toggle('error-toast', isError);
  toast.querySelector('strong').textContent = title;
  toast.querySelector('small').textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 6000);
}

function setUploadStatus({ phase, title, percent, message, state = 'active' }) {
  uploadQueue.hidden = false;
  uploadQueue.dataset.state = state;
  uploadPhase.textContent = phase;
  uploadTitle.textContent = title;
  uploadPercent.textContent = `${Math.round(percent)}%`;
  uploadProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  uploadMessage.textContent = message;
  cancelUploadButton.hidden = state !== 'active';
}

function statusDetails(status) {
  const details = {
    draft: ['UPLOAD STARTED', 'Waiting for the video upload to finish.'],
    uploaded: ['READY FOR TRANSCRIPTION', 'Video secured. Transcription is the next controlled step.'],
    processing: ['PROCESSING', 'A processing stage is currently running.'],
    review: ['REVIEW NEEDED', 'Your input is required before anything continues.'],
    approved: ['APPROVED', 'Approved and ready for the next step.'],
    published: ['PUBLISHED', 'This project has been published.'],
    failed: ['UPLOAD FAILED', 'The upload did not finish. Please start a new upload.']
  };
  return details[status] || [String(status || 'DRAFT').toUpperCase(), 'Project created.'];
}

function renderProjects(payload) {
  const projects = payload.projects || [];
  document.getElementById('projectCount').textContent = payload.counts?.projects ?? projects.length;
  document.getElementById('clipCount').textContent = payload.counts?.clips ?? 0;
  const summary = document.getElementById('projectSummary') || document.querySelector('.section-heading p');
  if (summary) summary.textContent = projects.length ? `${projects.length} project${projects.length === 1 ? '' : 's'} in your private studio.` : 'No uploads yet. Your first project will appear here.';

  if (!projects.length) {
    projectList.innerHTML = `<article class="empty-projects"><img src="assets/rhm-logo.png" alt=""><div><h3>No video projects yet</h3><p>Choose a test video under ${Math.round(maxUploadBytes / 1024 / 1024)} MB. You will see live progress and a clear confirmation.</p></div><button class="primary-button" type="button" data-upload-first>Upload first video</button></article>`;
    return;
  }

  projectList.innerHTML = projects.map(project => {
    const [label, description] = statusDetails(project.status);
    const source = (project.media_assets || []).find(asset => asset.kind === 'source_video');
    const size = source?.size_bytes ? formatBytes(source.size_bytes) : 'Upload pending';
    const videoDone = ['uploaded', 'processing', 'review', 'approved', 'published'].includes(project.status);
    return `<article class="project-card">
      <div class="video-thumb"><img src="assets/morning-devotional.png" alt="Video project"><img class="media-watermark" src="assets/rhm-logo.png" alt="RHM Studios watermark"><span>${escapeHtml(size)}</span></div>
      <div class="project-info">
        <div class="project-top"><div><span class="review-pill status-${escapeHtml(project.status)}">${escapeHtml(label)}</span><h3>${escapeHtml(project.title)}</h3><p>${escapeHtml(project.primary_scripture || 'Scripture not added')} &middot; ${escapeHtml(formatDate(project.created_at))}</p></div></div>
        <div class="project-state-copy">${escapeHtml(description)}</div>
        <div class="pipeline">
          <div class="pipeline-step ${videoDone ? 'done' : ''}"><span>${videoDone ? '&check;' : '1'}</span><p><strong>Video</strong><small>${videoDone ? 'Secured' : 'Uploading'}</small></p></div>
          <i></i><div class="pipeline-step"><span>2</span><p><strong>Transcript</strong><small>${videoDone ? 'Queued' : 'Waiting'}</small></p></div>
          <i></i><div class="pipeline-step"><span>3</span><p><strong>Review</strong><small>Waiting</small></p></div>
        </div>
        <div class="project-actions"><button class="primary-button" type="button" data-review-project="${escapeHtml(project.id)}" ${videoDone ? '' : 'disabled'}>Open workspace</button></div>
      </div>
    </article>`;
  }).join('');
}

async function loadProjects() {
  projectList.innerHTML = '<article class="empty-projects loading-projects"><div><h3>Loading your private projects...</h3><p>Checking Supabase for the latest upload status.</p></div></article>';
  try {
    const payload = await apiRequest('/api/projects');
    maxUploadBytes = payload.maxUploadBytes || maxUploadBytes;
    modal.querySelector('.dropzone small').textContent = `MP4, MOV, M4V, or WebM - current limit ${Math.round(maxUploadBytes / 1024 / 1024)} MB`;
    renderProjects(payload);
  } catch (error) {
    projectList.innerHTML = `<article class="empty-projects error-projects"><div><h3>Projects could not be loaded</h3><p>${escapeHtml(error.message)}</p></div><button class="secondary-button" type="button" data-retry-projects>Try again</button></article>`;
  }
}

function readVideoDuration(file) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      URL.revokeObjectURL(objectUrl);
      video.remove();
      resolve(Number.isFinite(value) ? Math.round(value) : null);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(null);
    video.src = objectUrl;
    window.setTimeout(() => finish(null), 5000);
  });
}

async function markUploadFailed(projectId) {
  if (!projectId) return;
  await fetch(`/api/projects/${encodeURIComponent(projectId)}/upload-failed`, { method: 'POST' }).catch(() => {});
}

function uploadToSignedUrl(file, signedUrl, title) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    activeUpload = request;
    request.open('PUT', signedUrl);
    request.setRequestHeader('x-upsert', 'false');
    request.upload.addEventListener('progress', event => {
      if (!event.lengthComputable) return;
      const percent = (event.loaded / event.total) * 100;
      setUploadStatus({ phase: 'UPLOADING TO PRIVATE STORAGE', title, percent, message: `${formatBytes(event.loaded)} of ${formatBytes(event.total)} uploaded. Keep this tab open.` });
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) return resolve();
      let message = 'Supabase could not accept the video.';
      try { message = JSON.parse(request.responseText)?.message || message; } catch {}
      reject(new Error(message));
    });
    request.addEventListener('error', () => reject(new Error('The connection was interrupted during upload.')));
    request.addEventListener('abort', () => reject(new DOMException('Upload cancelled', 'AbortError')));
    const body = new FormData();
    body.append('cacheControl', '3600');
    body.append('', file);
    request.send(body);
  });
}

async function startUpload() {
  const file = fileInput.files?.[0];
  const title = titleInput.value.trim();
  formError.textContent = '';
  if (!file) return void (formError.textContent = 'Choose a video file first.');
  if (!title) return void (formError.textContent = 'Enter a working title.');
  if (file.size > maxUploadBytes) return void (formError.textContent = `This file is ${formatBytes(file.size)}. Your current Supabase limit is ${Math.round(maxUploadBytes / 1024 / 1024)} MB.`);
  startProjectButton.disabled = true;
  startProjectButton.textContent = 'Creating secure project...';
  setUploadStatus({ phase: 'PREPARING SECURE UPLOAD', title, percent: 1, message: 'Creating the database record and private storage path.' });
  try {
    const durationPromise = readVideoDuration(file);
    const created = await apiRequest('/api/projects', {
      method: 'POST',
      body: JSON.stringify({
        title,
        scripture: scriptureInput.value.trim(),
        recordingDate: recordingDateInput.value,
        file: { name: file.name, type: file.type || 'application/octet-stream', size: file.size }
      })
    });
    activeProjectId = created.project.id;
    closeModal();
    setUploadStatus({ phase: 'UPLOADING TO PRIVATE STORAGE', title, percent: 2, message: `${formatBytes(file.size)} selected. Keep this tab open while it uploads.` });
    await uploadToSignedUrl(file, created.upload.signedUrl, title);
    setUploadStatus({ phase: 'FINALIZING PROJECT', title, percent: 100, message: 'The video arrived. Verifying the file and populating your workspace.' });
    const durationSeconds = await durationPromise;
    const completed = await apiRequest(`/api/projects/${encodeURIComponent(created.project.id)}/complete-upload`, {
      method: 'POST',
      body: JSON.stringify({ assetId: created.upload.assetId, durationSeconds })
    });
    activeUpload = null;
    activeProjectId = null;
    setUploadStatus({ phase: 'UPLOAD COMPLETE', title, percent: 100, message: completed.message, state: 'complete' });
    showToast('Video uploaded', 'Your project is now visible and ready for the transcription step.');
    await loadProjects();
    fileInput.value = '';
  } catch (error) {
    if (activeProjectId) await markUploadFailed(activeProjectId);
    activeUpload = null;
    activeProjectId = null;
    if (error?.name === 'AbortError') return;
    setUploadStatus({ phase: 'UPLOAD COULD NOT START', title, percent: 0, message: error.message, state: 'error' });
    formError.textContent = error.message;
    showToast('Upload could not start', error.message, true);
  } finally {
    startProjectButton.disabled = false;
    startProjectButton.textContent = 'Upload & create project';
  }
}

['newUpload', 'chooseVideo'].forEach(id => document.getElementById(id)?.addEventListener('click', openModal));
modal.querySelector('.modal-close').addEventListener('click', closeModal);
modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
fileInput.addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  const dropzone = modal.querySelector('.dropzone');
  dropzone.querySelector('strong').textContent = file.name;
  dropzone.querySelector('span').textContent = `${formatBytes(file.size)} selected`;
  formError.textContent = file.size > maxUploadBytes ? `This file exceeds the current ${Math.round(maxUploadBytes / 1024 / 1024)} MB limit.` : '';
});
startProjectButton.addEventListener('click', startUpload);

cancelUploadButton.addEventListener('click', async () => {
  if (!activeUpload) return;
  activeUpload.abort();
  await markUploadFailed(activeProjectId);
  activeUpload = null;
  activeProjectId = null;
  setUploadStatus({ phase: 'UPLOAD CANCELLED', title: uploadTitle.textContent, percent: 0, message: 'The upload was cancelled. No processing was started.', state: 'error' });
  await loadProjects();
});

projectList.addEventListener('click', event => {
  if (event.target.closest('[data-upload-first]')) openModal();
  if (event.target.closest('[data-retry-projects]')) loadProjects();
  const reviewButton = event.target.closest('[data-review-project]');
  if (reviewButton) window.location.href = `workflow.html?project=${encodeURIComponent(reviewButton.dataset.reviewProject)}`;
});

document.getElementById('themeToggle').addEventListener('click', () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('hm-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
});
if (localStorage.getItem('hm-theme') === 'dark') document.body.classList.add('dark');

document.getElementById('importButton').addEventListener('click', () => showToast('StreamYard connection', 'Direct StreamYard import will be connected after the upload workflow is proven.'));
window.addEventListener('beforeunload', event => {
  if (!activeUpload) return;
  event.preventDefault();
  event.returnValue = '';
});

loadProjects();
