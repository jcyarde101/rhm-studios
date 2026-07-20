const deeLauncher = document.getElementById('deeLauncher');
const deePanel = document.getElementById('deePanel');
const deeConversation = document.getElementById('deeConversation');
const deeInput = document.getElementById('deeInput');
const deeSend = document.getElementById('deeSend');
const deeMic = document.getElementById('deeMic');
const deeVoice = document.getElementById('deeVoice');
const deeError = document.getElementById('deeError');
const deeAudio = document.getElementById('deeAudio');
const deeNotes = document.getElementById('deeNotes');
const deeNotesList = document.getElementById('deeNotesList');
const deeNoteCount = document.getElementById('deeNoteCount');
const deeProjectId = new URLSearchParams(window.location.search).get('project');
const deeHistory = [];
let deeVoices = [];
let deeVoiceReady = false;
let deeBusy = false;
let deeRecorder = null;
let deeRecordingChunks = [];
let deeAudioUrl = null;

async function deeRequest(url, options = {}) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    window.location.href = '/signin';
    throw new Error('Your session expired. Please sign in again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || 'Dee could not complete that request.');
  }
  return response;
}

function setDeeBusy(value) {
  deeBusy = value;
  deeSend.disabled = value;
  deeMic.disabled = value && !deeRecorder;
}

function addDeeMessage(role, text, extraClass = '', sources = []) {
  const message = document.createElement('div');
  message.className = `dee-message ${role} ${extraClass}`.trim();
  const avatar = document.createElement('span');
  avatar.textContent = role === 'user' ? 'You' : 'D';
  const copy = document.createElement('p');
  copy.textContent = text;
  message.append(avatar, copy);
  if (role === 'assistant' && Array.isArray(sources) && sources.length) {
    const sourceList = document.createElement('div');
    sourceList.className = 'dee-message-sources';
    const label = document.createElement('strong');
    label.textContent = 'Current-event sources';
    sourceList.append(label);
    sources.forEach(source => {
      try {
        const url = new URL(source.url);
        if (!['http:', 'https:'].includes(url.protocol)) return;
        const link = document.createElement('a');
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = source.title || url.hostname;
        sourceList.append(link);
      } catch {}
    });
    if (sourceList.children.length > 1) message.append(sourceList);
  }
  deeConversation.append(message);
  deeConversation.scrollTop = deeConversation.scrollHeight;
  return message;
}

function renderDeeNotes(notes = []) {
  if (!deeNotesList) return;
  deeNoteCount.textContent = String(notes.length);
  deeNotesList.innerHTML = '';
  if (!notes.length) {
    deeNotesList.innerHTML = '<div class="dee-notes-empty"><strong>No notes yet</strong><p>Durable insights, Scripture connections, and coaching questions will appear here for your review.</p></div>';
    return;
  }
  notes.forEach(note => {
    const card = document.createElement('article');
    card.className = `dee-note ${note.approved ? 'approved' : 'suggested'}`;
    const heading = document.createElement('div');
    const category = document.createElement('span');
    category.textContent = `${note.category || 'insight'} · ${note.approved ? 'kept' : 'review'}`;
    const title = document.createElement('strong');
    title.textContent = note.title;
    heading.append(category, title);
    const content = document.createElement('p');
    content.textContent = note.content;
    const scriptures = document.createElement('small');
    scriptures.textContent = note.scriptures?.length ? `Scriptures: ${note.scriptures.join(', ')}` : '';
    const actions = document.createElement('div');
    if (!note.approved) {
      const keep = document.createElement('button');
      keep.type = 'button';
      keep.textContent = 'Keep note';
      keep.addEventListener('click', async () => {
        keep.disabled = true;
        try {
          await deeRequest(`/api/dee/notes/${encodeURIComponent(note.id)}/approve`, { method: 'PATCH' });
          await loadDeeMemory(false);
        } catch (error) { deeError.textContent = error.message; keep.disabled = false; }
      });
      actions.append(keep);
    }
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      if (!window.confirm('Remove this Dee note? This cannot be undone.')) return;
      remove.disabled = true;
      try {
        await deeRequest(`/api/dee/notes/${encodeURIComponent(note.id)}`, { method: 'DELETE' });
        await loadDeeMemory(false);
      } catch (error) { deeError.textContent = error.message; remove.disabled = false; }
    });
    actions.append(remove);
    card.append(heading, content);
    if (scriptures.textContent) card.append(scriptures);
    card.append(actions);
    deeNotesList.append(card);
  });
}

async function loadDeeMemory(renderConversation = true) {
  if (!deeProjectId) return;
  try {
    const response = await deeRequest(`/api/dee/memory?projectId=${encodeURIComponent(deeProjectId)}`);
    const data = await response.json();
    renderDeeNotes(data.notes || []);
    if (renderConversation && data.messages?.length) {
      deeConversation.innerHTML = '';
      deeHistory.length = 0;
      data.messages.forEach(turn => {
        addDeeMessage(turn.role, turn.content, '', turn.metadata?.sources || []);
        deeHistory.push({ role: turn.role, content: turn.content });
      });
    }
  } catch (error) {
    deeError.textContent = `Dee's memory could not load: ${error.message}`;
  }
}

async function speakAsDee(text) {
  if (!deeVoiceReady || !deeVoice.value) return;
  const response = await deeRequest('/api/dee/speak', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceId: deeVoice.value })
  });
  const audioBlob = await response.blob();
  if (deeAudioUrl) URL.revokeObjectURL(deeAudioUrl);
  deeAudioUrl = URL.createObjectURL(audioBlob);
  deeAudio.src = deeAudioUrl;
  await deeAudio.play().catch(() => {});
}

async function askDee(message) {
  const question = String(message || '').trim();
  if (!question || deeBusy) return;
  deeError.textContent = '';
  const priorHistory = deeHistory.slice(-8);
  addDeeMessage('user', question);
  deeHistory.push({ role: 'user', content: question });
  deeInput.value = '';
  const thinking = addDeeMessage('assistant', 'Let me look at the project and transcript…', 'thinking');
  setDeeBusy(true);
  try {
    const response = await deeRequest('/api/dee/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: deeProjectId, message: question, history: priorHistory })
    });
    const data = await response.json();
    thinking.classList.remove('thinking');
    thinking.querySelector('p').textContent = data.reply;
    if (data.sources?.length) {
      data.sources.forEach(source => {
        try {
          const url = new URL(source.url);
          if (!['http:', 'https:'].includes(url.protocol)) return;
          let sourceList = thinking.querySelector('.dee-message-sources');
          if (!sourceList) {
            sourceList = document.createElement('div');
            sourceList.className = 'dee-message-sources';
            const label = document.createElement('strong');
            label.textContent = 'Current-event sources';
            sourceList.append(label);
            thinking.append(sourceList);
          }
          const link = document.createElement('a');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = source.title || url.hostname;
          sourceList.append(link);
        } catch {}
      });
    }
    deeHistory.push({ role: 'assistant', content: data.reply });
    if (data.note) await loadDeeMemory(false);
    await speakAsDee(data.reply).catch(error => { deeError.textContent = `Dee answered in text, but her voice could not play: ${error.message}`; });
  } catch (error) {
    thinking.remove();
    deeError.textContent = error.message;
  } finally {
    setDeeBusy(false);
  }
}

async function loadDee() {
  try {
    const statusResponse = await deeRequest('/api/dee/status');
    const status = await statusResponse.json();
    deeVoiceReady = status.voiceReady;
    document.getElementById('deeStatus').textContent = status.voiceReady ? 'MINISTRY SOUNDING BOARD · VOICE READY' : 'MINISTRY SOUNDING BOARD · TEXT READY';
    if (!status.voiceReady) {
      deeVoice.innerHTML = '<option value="">Add ELEVENLABS_API_KEY in Render</option>';
      document.getElementById('previewDeeVoice').disabled = true;
      return;
    }
    const voicesResponse = await deeRequest('/api/dee/voices');
    const voiceData = await voicesResponse.json();
    deeVoices = voiceData.voices || [];
    deeVoice.innerHTML = '';
    deeVoices.forEach(voice => {
      const option = document.createElement('option');
      option.value = voice.id;
      const details = [voice.labels?.gender, voice.labels?.accent].filter(Boolean).join(', ');
      option.textContent = details ? `${voice.name} — ${details}` : voice.name;
      deeVoice.append(option);
    });
    const savedVoice = localStorage.getItem('rhm-dee-voice');
    const preferred = savedVoice || voiceData.defaultVoiceId;
    if (preferred && deeVoices.some(voice => voice.id === preferred)) deeVoice.value = preferred;
    else if (deeVoices.length) deeVoice.value = deeVoices[0].id;
  } catch (error) {
    deeError.textContent = error.message;
    deeVoice.innerHTML = '<option value="">Voice setup unavailable</option>';
  }
}

async function toggleDeeRecording() {
  if (deeRecorder?.state === 'recording') {
    deeRecorder.stop();
    return;
  }
  deeError.textContent = '';
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    deeError.textContent = 'This browser does not support microphone recording. You can still type to Dee.';
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const preferredType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    deeRecordingChunks = [];
    deeRecorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined);
    deeRecorder.addEventListener('dataavailable', event => { if (event.data.size) deeRecordingChunks.push(event.data); });
    deeRecorder.addEventListener('stop', async () => {
      stream.getTracks().forEach(track => track.stop());
      deeMic.classList.remove('recording');
      deeMic.querySelector('small').textContent = 'Talk';
      const audio = new Blob(deeRecordingChunks, { type: deeRecorder.mimeType || 'audio/webm' });
      deeRecorder = null;
      if (!audio.size) return;
      setDeeBusy(true);
      deeError.textContent = 'Dee is listening…';
      try {
        const response = await deeRequest('/api/dee/transcribe', { method: 'POST', headers: { 'Content-Type': audio.type || 'audio/webm' }, body: audio });
        const data = await response.json();
        deeError.textContent = '';
        setDeeBusy(false);
        await askDee(data.text);
      } catch (error) {
        deeError.textContent = error.message;
        setDeeBusy(false);
      }
    });
    deeRecorder.start();
    deeMic.classList.add('recording');
    deeMic.querySelector('small').textContent = 'Stop';
  } catch (error) {
    deeError.textContent = error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser, then try again.' : 'The microphone could not start.';
  }
}

deeLauncher?.addEventListener('click', () => {
  deePanel.classList.add('open');
  deePanel.setAttribute('aria-hidden', 'false');
  deeInput.focus();
});
document.getElementById('deeClose')?.addEventListener('click', () => {
  deePanel.classList.remove('open');
  deePanel.setAttribute('aria-hidden', 'true');
});
deeSend?.addEventListener('click', () => askDee(deeInput.value));
deeInput?.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    askDee(deeInput.value);
  }
});
deeMic?.addEventListener('click', toggleDeeRecording);
deeVoice?.addEventListener('change', () => localStorage.setItem('rhm-dee-voice', deeVoice.value));
document.getElementById('previewDeeVoice')?.addEventListener('click', async event => {
  const voice = deeVoices.find(item => item.id === deeVoice.value);
  if (!voice?.previewUrl) return void (deeError.textContent = 'This voice does not include a preview. Ask Dee a question to hear it.');
  event.currentTarget.disabled = true;
  deeAudio.src = voice.previewUrl;
  await deeAudio.play().catch(() => { deeError.textContent = 'The voice preview could not play.'; });
  event.currentTarget.disabled = false;
});
document.querySelectorAll('.dee-quick-prompts button').forEach(button => button.addEventListener('click', () => askDee(button.textContent)));
document.querySelectorAll('[data-dee-tab]').forEach(button => button.addEventListener('click', () => {
  const tabName = button.dataset.deeTab;
  document.querySelectorAll('[data-dee-tab]').forEach(item => item.classList.toggle('active', item === button));
  document.querySelectorAll('[data-dee-panel]').forEach(panel => {
    const active = panel.dataset.deePanel === tabName;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}));
window.addEventListener('beforeunload', () => { if (deeAudioUrl) URL.revokeObjectURL(deeAudioUrl); });

loadDee();
loadDeeMemory();
