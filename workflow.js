const steps=[...document.querySelectorAll('.step')];
const panels=[...document.querySelectorAll('.stage')];
const approvals=new Set();
function showStep(number){steps.forEach(s=>s.classList.toggle('active',s.dataset.step===String(number)));panels.forEach(p=>p.classList.toggle('active',p.dataset.panel===String(number)));window.scrollTo({top:0,behavior:'smooth'})}
steps.forEach(step=>step.addEventListener('click',()=>showStep(step.dataset.step)));
document.querySelectorAll('.chip').forEach(chip=>chip.addEventListener('click',()=>{document.querySelectorAll('.chip').forEach(c=>c.classList.remove('selected'));chip.classList.add('selected')}));
document.querySelectorAll('.style-options').forEach(group=>group.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{group.querySelectorAll('button').forEach(b=>b.classList.remove('selected'));button.classList.add('selected')})));
document.querySelectorAll('.platforms button').forEach(button=>button.addEventListener('click',()=>button.classList.toggle('selected')));
document.querySelectorAll('.transcript p').forEach(p=>p.addEventListener('click',()=>{document.querySelectorAll('.transcript p').forEach(x=>x.classList.remove('selected'));p.classList.add('selected');document.querySelector('.timeline>span').textContent=p.dataset.time}));
document.getElementById('polishRange')?.addEventListener('input',e=>document.getElementById('polishValue').textContent=e.target.value+'%');
const toast=document.getElementById('toast');
function notify(title='Stage approved',message='Your choices are saved. Preparing the next review.'){toast.querySelector('strong').textContent=title;toast.querySelector('small').textContent=message;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),3000)}
document.querySelectorAll('[data-approve]').forEach(button=>button.addEventListener('click',()=>{const n=Number(button.dataset.approve);approvals.add(n);const step=steps.find(s=>Number(s.dataset.step)===n);step.classList.add('complete');step.querySelector('b').textContent='APPROVED';notify();showStep(Math.min(n+1,5))}));
document.querySelectorAll('.approve-mini').forEach(button=>button.addEventListener('click',()=>{button.textContent=button.classList.toggle('chosen')?'✓ Approved':'✓';notify('Edit choice saved','This decision will be used in the full render.')}));
document.querySelectorAll('.preview-button').forEach(button=>button.addEventListener('click',()=>notify('Preview prepared','This prototype will play the rendered segment when the processing backend is connected.')));
const writingDrafts={description:'<h2>Finding Peace in the Waiting</h2><p>Waiting on God is not wasted time. In the quiet space between prayer and answer, faith takes root and trust grows stronger.</p><p>Today’s message is an invitation to release the pressure of having every answer and rest in the promise of Isaiah 40:31: those who hope in the Lord will renew their strength.</p>',devotional:'<h2>Finding Peace in the Waiting</h2><p>There are seasons when our prayers seem to hang in the air. We have asked, believed, and watched—yet the answer has not arrived.</p><p>Isaiah 40:31 reminds us that waiting is not passive. Hope anchors the heart while God renews the strength we cannot manufacture ourselves. The waiting room can become holy ground when we stop measuring God’s faithfulness by our preferred timeline.</p><p>Today, release the need to understand every delay. Trust that unseen work is still work, and that God has not forgotten your name.</p>',prayer:'<h2>A Prayer for the Waiting</h2><p>Father, meet me in the space between my prayer and your answer. Quiet the fear that tells me I have been forgotten. Teach me to wait with active faith, to notice your presence, and to trust your timing.</p><p>Renew my strength as I place my hope in you. Give me peace for today and courage for the next faithful step. Amen.</p>',scriptures:'<h2>Scriptures in This Message</h2><p><strong>Isaiah 40:31</strong> — Those who hope in the Lord will renew their strength.</p><p><strong>Psalm 27:14</strong> — Wait for the Lord; be strong and take heart.</p><p><strong>Lamentations 3:25</strong> — The Lord is good to those whose hope is in him.</p>'};
const writingApproved=new Set();let currentWriting='description';
document.querySelectorAll('[data-writing]').forEach(tab=>tab.addEventListener('click',()=>{document.querySelectorAll('[data-writing]').forEach(t=>t.classList.remove('active'));tab.classList.add('active');currentWriting=tab.dataset.writing;document.getElementById('writingContent').innerHTML=writingDrafts[currentWriting];const approved=writingApproved.has(currentWriting);document.querySelector('.writing-approval span').textContent=approved?'Approved':'Not yet approved';document.getElementById('approveWriting').textContent=approved?'✓ Approved':'✓ Approve this draft'}));
document.getElementById('approveWriting')?.addEventListener('click',()=>{writingDrafts[currentWriting]=document.getElementById('writingContent').innerHTML;writingApproved.add(currentWriting);document.querySelector('.writing-approval span').textContent='Approved';document.getElementById('approveWriting').textContent='✓ Approved';document.getElementById('writingCount').textContent=`${writingApproved.size} of 4`;document.querySelector('[data-approve="3"]').disabled=writingApproved.size<4;notify('Writing approved',`${currentWriting[0].toUpperCase()+currentWriting.slice(1)} saved in your voice.`)});
const clips=[['Waiting is not wasted time','03:10–03:42','Strong hook · 32 sec'],['Hope renews your strength','08:38–09:16','Scripture · 38 sec'],['God has not forgotten you','14:02–14:35','Encouragement · 33 sec'],['Trust without every answer','10:20–10:48','Teaching · 28 sec'],['A prayer for the waiting','20:31–21:14','Prayer · 43 sec'],['The next faithful step','18:05–18:31','Practical · 26 sec']];
const clipList=document.getElementById('clipList');
clips.forEach((clip,i)=>{const item=document.createElement('label');item.className='clip-item'+(i===0?' active':'');item.innerHTML=`<input type="checkbox" ${i<3?'checked':''}><img src="assets/morning-devotional.png" alt=""><div><strong>${clip[0]}</strong><small>${clip[1]}</small><b>${clip[2]}</b></div>`;item.addEventListener('click',()=>{document.querySelectorAll('.clip-item').forEach(x=>x.classList.remove('active'));item.classList.add('active')});item.querySelector('input').addEventListener('change',()=>document.getElementById('selectedClips').textContent=document.querySelectorAll('.clip-item input:checked').length);clipList?.appendChild(item)});
document.getElementById('previewAll')?.addEventListener('click',()=>notify('Full preview queued','The lightweight preview will open when the backend renderer is connected.'));
document.getElementById('finalizeButton')?.addEventListener('click',()=>showStep(5));
document.getElementById('createImageDrafts')?.addEventListener('click',()=>{const prompt=document.getElementById('imagePrompt').value.trim();if(!prompt){notify('Add your direction','Describe the image you want before generating drafts.');return}notify('Image direction saved','GPT Image 2 generation will run here when the backend is connected.')});
document.getElementById('approveIntro')?.addEventListener('click',e=>{e.currentTarget.textContent='✓ Intro approved';notify('Intro approved','This intro will be included in the full edit unless you disable it.')});
document.getElementById('replaceIntro')?.addEventListener('click',()=>notify('Brand media library','Additional intros will appear here as you add them.'));
document.getElementById('approveOutro')?.addEventListener('click',e=>{e.currentTarget.textContent='✓ Outro approved';notify('Outro approved','This outro will be included in the full edit unless you disable it.')});
document.getElementById('replaceOutro')?.addEventListener('click',()=>notify('Brand media library','Additional outros will appear here as you add them.'));

const workspaceProjectId = new URLSearchParams(window.location.search).get('project');
let workspacePoll = null;
let directionInitialized = false;
let loadedScriptureKey = '';
let currentPrimaryScripture = '';
let planningInitialized = false;
let planningUpload = null;

async function workspaceRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (response.status === 401) {
    window.location.href = '/signin';
    throw new Error('Your session expired. Please sign in again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The workspace could not be updated.');
  return data;
}

function formatWorkspaceTime(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}` : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatPlanningBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function readPlanningVideoDuration(file) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      video.remove();
      resolve(Number.isFinite(value) ? Math.round(value) : null);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () => finish(video.duration);
    video.onerror = () => finish(null);
    video.src = url;
    window.setTimeout(() => finish(null), 5000);
  });
}

function setPlanningUploadProgress(percent, label, message) {
  document.getElementById('planningUploadProgress').hidden = false;
  document.getElementById('planningUploadPercent').textContent = `${Math.round(percent)}%`;
  document.getElementById('planningUploadBar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
  document.getElementById('planningUploadLabel').textContent = label;
  document.getElementById('planningUploadMessage').textContent = message;
}

function renderPlanningWorkspace(data) {
  document.body.classList.add('planning-mode');
  document.getElementById('planningWorkspace').hidden = false;
  const headerStatus = document.querySelector('.project-name small');
  if (headerStatus) headerStatus.textContent = 'Pre-recording research workspace';
  if (!planningInitialized) {
    const plan = data.plan || {};
    document.getElementById('planBigIdeaWorkspace').value = plan.big_idea || '';
    document.getElementById('planAudience').value = plan.intended_audience || '';
    document.getElementById('planOutcome').value = plan.desired_outcome || '';
    document.getElementById('planResearch').value = plan.research_notes || '';
    document.getElementById('planQuestions').value = plan.questions_to_explore || '';
    planningInitialized = true;
  }
  if (workspacePoll) {
    window.clearInterval(workspacePoll);
    workspacePoll = null;
  }
}

function leavePlanningMode() {
  document.body.classList.remove('planning-mode');
  document.getElementById('planningWorkspace').hidden = true;
}

function transcriptParagraphs(transcript) {
  const sections = String(transcript || '').split(/(?=\[\d{2}:\d{2}:\d{2}\]\s*)/).filter(Boolean);
  return sections.flatMap(section => {
    const match = section.match(/^\[(\d{2}):(\d{2}):(\d{2})\]\s*([\s\S]*)$/);
    const time = match ? `${match[1]}:${match[2]}:${match[3]}` : '00:00:00';
    const text = (match ? match[4] : section).trim();
    return text ? [{ time, text }] : [];
  });
}

function renderTranscript(transcript) {
  const transcriptElement = document.querySelector('.transcript');
  if (!transcriptElement) return;
  if (!transcript) {
    transcriptElement.innerHTML = '<p><time>--:--</time><span>Your real transcript will appear here as processing completes.</span></p>';
    return;
  }
  transcriptElement.innerHTML = '';
  transcriptParagraphs(transcript).forEach((section, index) => {
    const paragraph = document.createElement('p');
    paragraph.dataset.time = section.time;
    if (index === 0) paragraph.classList.add('selected');
    const time = document.createElement('time');
    time.textContent = section.time.replace(/^00:/, '');
    const copy = document.createElement('span');
    copy.textContent = section.text;
    paragraph.append(time, copy);
    transcriptElement.append(paragraph);
  });
}

function fillList(id, items, emptyMessage) {
  const list = document.getElementById(id);
  list.innerHTML = '';
  const values = Array.isArray(items) && items.length ? items : [emptyMessage];
  values.forEach(item => {
    const entry = document.createElement('li');
    entry.textContent = item;
    list.append(entry);
  });
}

function renderMessageReview(review, userDirection) {
  const panel = document.getElementById('messageReviewPanel');
  panel.dataset.state = 'ready';
  document.getElementById('messageReviewStatus').textContent = 'READY FOR YOUR REVIEW';
  document.getElementById('messageReviewLoading').hidden = true;
  document.getElementById('messageReviewError').hidden = true;
  document.getElementById('messageReviewContent').hidden = false;
  document.getElementById('overallSynopsis').textContent = review.overallSynopsis || 'No synopsis was returned.';
  document.getElementById('centralMessage').textContent = review.centralMessage || 'No central message was identified.';
  fillList('whatWorked', review.whatWorked, 'AI did not identify a specific strength yet.');
  fillList('needsClarity', review.needsClarity, 'AI did not flag anything as unclear.');
  fillList('possibleConcerns', review.possibleConcerns, 'AI did not flag a likely misunderstanding.');
  document.getElementById('suggestedEmphasis').textContent = review.suggestedEmphasis || 'Use your own direction below.';
  const scriptures = document.getElementById('scripturesDetected');
  scriptures.innerHTML = '';
  (review.scripturesDetected?.length ? review.scripturesDetected : ['None identified']).forEach(reference => {
    const tag = document.createElement('i');
    tag.textContent = reference;
    scriptures.append(tag);
  });
  if (!directionInitialized) {
    document.getElementById('aiCorrection').value = userDirection || '';
    document.getElementById('messageDirection').value = userDirection || review.suggestedEmphasis || '';
    directionInitialized = true;
  }
}

function parseScriptureEntry(value) {
  const raw = String(value || '').trim();
  const versionMatch = raw.match(/\b(NLTUK|NLT|NTV|KJV)\b/i);
  const version = versionMatch?.[1]?.toUpperCase() || 'NLT';
  const reference = raw.replace(/\b(NLTUK|NLT|NTV|KJV)\b/ig, '').replace(/[(),]+$/g, '').trim();
  return { reference, version };
}

async function renderPrimaryScripture(primaryScripture, force = false) {
  const referenceElement = document.getElementById('scriptureReference');
  const textElement = document.getElementById('scriptureText');
  const attributionElement = document.getElementById('scriptureAttribution');
  if (!referenceElement || !textElement || !attributionElement) return;
  const { reference, version } = parseScriptureEntry(primaryScripture);
  currentPrimaryScripture = String(primaryScripture || '');
  const key = `${reference}|${version}`;
  referenceElement.textContent = reference ? `${reference} · ${version}` : 'No reference entered';
  if (!reference) {
    textElement.textContent = 'Add a scripture reference when creating the project and include the translation, for example: Isaiah 40:31 NLT.';
    attributionElement.textContent = '';
    return;
  }
  if (!force && loadedScriptureKey === key) return;
  loadedScriptureKey = key;
  textElement.textContent = 'Loading the scripture text…';
  attributionElement.textContent = '';
  try {
    const data = await workspaceRequest(`/api/scripture?reference=${encodeURIComponent(reference)}&version=${encodeURIComponent(version)}`);
    textElement.textContent = data.text;
    attributionElement.textContent = data.attribution;
  } catch (error) {
    loadedScriptureKey = '';
    textElement.textContent = error.message;
  }
}

function renderProcessingState(job) {
  const panel = document.getElementById('messageReviewPanel');
  const progress = Math.max(0, Math.min(100, Number(job?.progress) || 0));
  panel.dataset.state = job?.status === 'failed' ? 'error' : 'loading';
  document.getElementById('messageReviewContent').hidden = true;
  document.getElementById('messageReviewLoading').hidden = job?.status === 'failed';
  document.getElementById('messageReviewError').hidden = job?.status !== 'failed';
  document.getElementById('messageReviewProgress').textContent = `${progress}%`;
  const status = job?.status || 'queued';
  document.getElementById('messageReviewStatus').textContent = status === 'running' ? 'TRANSCRIBING' : status === 'failed' ? 'NEEDS ATTENTION' : 'QUEUED';
  const phase = progress < 2 ? 'Starting the processing worker' : progress < 15 ? 'Downloading the private video and preparing its audio' : progress < 82 ? 'Transcribing the devotional in sections' : 'Creating your synopsis and message review';
  document.getElementById('messageReviewLoadingTitle').textContent = status === 'running' ? phase : 'Your transcript is in the processing queue';
  document.getElementById('messageReviewLoadingCopy').textContent = status === 'running' ? `The job is active at ${progress}%. Large recordings can remain in this stage while their audio is prepared. This page checks for updates automatically.` : 'Processing will begin automatically. You may leave this workspace and return later.';
  if (status === 'failed') document.getElementById('messageReviewErrorCopy').textContent = job.error_message || 'The transcript could not be completed. Retry when you are ready.';
  const sidebar = document.querySelector('.processing-card');
  sidebar?.querySelector('em') && (sidebar.querySelector('em').textContent = `${progress}%`);
  sidebar?.querySelector('.meter i')?.style.setProperty('width', `${progress}%`);
  const badge = document.querySelector('[data-panel="1"] .ready-badge');
  if (badge) badge.textContent = status === 'running' ? `TRANSCRIPT ${progress}%` : status === 'failed' ? 'PROCESSING PAUSED' : 'TRANSCRIPT QUEUED';
}

function attachRealVideo(videoUrl) {
  if (!videoUrl || document.getElementById('projectVideo')) return;
  const frame = document.querySelector('.player-card .video');
  const poster = frame?.querySelector(':scope > img:not(.rhm-watermark)');
  if (!frame || !poster) return;
  const video = document.createElement('video');
  video.id = 'projectVideo';
  video.controls = true;
  video.preload = 'metadata';
  video.src = videoUrl;
  poster.replaceWith(video);
  frame.querySelector('.play')?.remove();
  frame.querySelector('.scripture-preview')?.remove();
  const quality = frame.querySelector('.quality');
  if (quality) quality.textContent = 'PRIVATE SOURCE VIDEO';
}

function renderWorkspace(data) {
  document.title = `${data.project.title} · RHM Studios`;
  const headerTitle = document.querySelector('.project-name strong');
  if (headerTitle) headerTitle.textContent = data.project.title;
  if (data.planningMode) {
    renderPlanningWorkspace(data);
    return;
  }
  leavePlanningMode();
  const headerStatus = document.querySelector('.project-name small');
  if (headerStatus) headerStatus.textContent = data.project.status === 'review' ? 'AI message review ready' : 'Processing your private upload';
  attachRealVideo(data.videoUrl);
  renderTranscript(data.transcript);
  const duration = document.querySelector('.timeline > span:last-child');
  if (duration) duration.textContent = formatWorkspaceTime(data.project.duration_seconds);
  renderPrimaryScripture(data.project.primary_scripture);
  const job = (data.jobs || []).find(item => item.job_type === 'transcription');
  if (data.messageReview) renderMessageReview(data.messageReview, data.userDirection);
  else renderProcessingState(job);
  const shouldPoll = !data.messageReview && (!job || job.status === 'queued' || job.status === 'running');
  if (shouldPoll && !workspacePoll) workspacePoll = window.setInterval(loadRealWorkspace, 8000);
  if (!shouldPoll && workspacePoll) {
    window.clearInterval(workspacePoll);
    workspacePoll = null;
  }
}

async function loadRealWorkspace() {
  if (!workspaceProjectId) {
    document.getElementById('messageReviewLoading').hidden = true;
    document.getElementById('messageReviewError').hidden = false;
    document.getElementById('messageReviewErrorCopy').textContent = 'Open a video project from the RHM Studios home page.';
    return;
  }
  try {
    renderWorkspace(await workspaceRequest(`/api/projects/${encodeURIComponent(workspaceProjectId)}/workspace`));
  } catch (error) {
    document.getElementById('messageReviewLoading').hidden = true;
    document.getElementById('messageReviewError').hidden = false;
    document.getElementById('messageReviewErrorCopy').textContent = error.message;
  }
}

document.querySelector('.transcript')?.addEventListener('click', event => {
  const paragraph = event.target.closest('p[data-time]');
  if (!paragraph) return;
  document.querySelectorAll('.transcript p').forEach(item => item.classList.remove('selected'));
  paragraph.classList.add('selected');
  const parts = paragraph.dataset.time.split(':').map(Number);
  const seconds = parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  const video = document.getElementById('projectVideo');
  if (video && Number.isFinite(seconds)) video.currentTime = seconds;
  const currentTime = document.querySelector('.timeline > span:first-child');
  if (currentTime) currentTime.textContent = paragraph.dataset.time.replace(/^00:/, '');
});

function openTranscriptModal() {
  const modal = document.getElementById('transcriptModal');
  const body = document.getElementById('transcriptModalBody');
  const transcript = document.querySelector('.transcript');
  if (!modal || !body || !transcript) return;
  body.innerHTML = transcript.innerHTML;
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  document.getElementById('closeTranscriptModal')?.focus();
}

function closeTranscriptModal() {
  const modal = document.getElementById('transcriptModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = '';
}

const transcriptCard = document.querySelector('.transcript-card');
if (transcriptCard) {
  transcriptCard.id = 'transcriptCard';
  transcriptCard.title = 'Open the transcript in a larger reading window';
  const headerButton = transcriptCard.querySelector('.card-head button');
  if (headerButton) {
    headerButton.textContent = 'Expand ↗';
    headerButton.type = 'button';
    headerButton.addEventListener('click', openTranscriptModal);
  }
  const bottomButton = transcriptCard.querySelector(':scope > .outline-button');
  if (bottomButton) {
    bottomButton.textContent = 'Open full-size transcript';
    bottomButton.type = 'button';
    bottomButton.addEventListener('click', openTranscriptModal);
  }
  transcriptCard.querySelector('.card-head')?.addEventListener('dblclick', openTranscriptModal);
}
document.getElementById('closeTranscriptModal')?.addEventListener('click', closeTranscriptModal);
document.querySelector('.reading-modal-backdrop')?.addEventListener('click', closeTranscriptModal);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeTranscriptModal(); });
document.getElementById('reloadScripture')?.addEventListener('click', () => {
  renderPrimaryScripture(currentPrimaryScripture, true);
});

document.getElementById('refreshMessageReview')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const correction = document.getElementById('aiCorrection').value.trim();
  const error = document.getElementById('messageReviewFormError');
  error.textContent = '';
  if (!correction) return void (error.textContent = 'Tell AI what you intended before asking it to re-check the message.');
  button.disabled = true;
  button.textContent = 'Re-checking transcript...';
  try {
    const result = await workspaceRequest(`/api/projects/${encodeURIComponent(workspaceProjectId)}/message-review`, { method: 'POST', body: JSON.stringify({ userDirection: correction }) });
    directionInitialized = false;
    renderMessageReview(result.review, result.userDirection);
    notify('Message review updated', 'AI reread the transcript using your correction.');
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Save direction & re-check';
  }
});

document.getElementById('retryMessageProcessing')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await workspaceRequest(`/api/projects/${encodeURIComponent(workspaceProjectId)}/retry-processing`, { method: 'POST' });
    notify('Processing restarted', 'RHM Studios is preparing the transcript again.');
    await loadRealWorkspace();
  } catch (error) {
    document.getElementById('messageReviewErrorCopy').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById('savePlan')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const status = document.getElementById('planSaveStatus');
  button.disabled = true;
  status.textContent = 'Saving your research and message map...';
  try {
    const result = await workspaceRequest(`/api/projects/${encodeURIComponent(workspaceProjectId)}/plan`, {
      method: 'PUT',
      body: JSON.stringify({
        bigIdea: document.getElementById('planBigIdeaWorkspace').value.trim(),
        intendedAudience: document.getElementById('planAudience').value.trim(),
        desiredOutcome: document.getElementById('planOutcome').value.trim(),
        researchNotes: document.getElementById('planResearch').value.trim(),
        questionsToExplore: document.getElementById('planQuestions').value.trim()
      })
    });
    status.textContent = `Saved ${new Date(result.plan.updated_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Dee can use these notes now.`;
    notify('Planning notes saved', 'Your message map and research remain attached to this project.');
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.getElementById('planningVideoFile')?.addEventListener('change', event => {
  const file = event.target.files?.[0];
  const dropzone = event.target.closest('.planning-dropzone');
  const error = document.getElementById('planningUploadError');
  error.textContent = '';
  if (!file) return;
  dropzone.classList.add('has-file');
  dropzone.querySelector('strong').textContent = file.name;
  dropzone.querySelector('small').textContent = `${formatPlanningBytes(file.size)} selected`;
});

document.getElementById('attachPlanningVideo')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  const file = document.getElementById('planningVideoFile').files?.[0];
  const error = document.getElementById('planningUploadError');
  error.textContent = '';
  if (!file) return void (error.textContent = 'Choose the StreamYard recording first.');
  if (file.size > 50 * 1024 ** 3) return void (error.textContent = 'This recording is larger than the current 50 GB limit.');
  if (typeof tus === 'undefined') return void (error.textContent = 'The secure uploader did not load. Refresh the page and try again.');
  button.disabled = true;
  button.textContent = 'Preparing secure upload...';
  let assetId = null;
  try {
    const durationPromise = readPlanningVideoDuration(file);
    const prepared = await workspaceRequest(`/api/projects/${encodeURIComponent(workspaceProjectId)}/prepare-upload`, {
      method: 'POST',
      body: JSON.stringify({ file: { name: file.name, type: file.type || 'application/octet-stream', size: file.size } })
    });
    assetId = prepared.upload.assetId;
    setPlanningUploadProgress(1, 'Uploading to private storage', `${formatPlanningBytes(file.size)} selected. Interrupted transfers retry automatically.`);
    await new Promise((resolve, reject) => {
      planningUpload = new tus.Upload(file, {
        endpoint: prepared.upload.endpoint,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${prepared.upload.accessToken}` },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        chunkSize: prepared.upload.chunkSize,
        fingerprint(selectedFile) {
          return Promise.resolve(`rhm-plan-${prepared.upload.path}-${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`);
        },
        metadata: {
          bucketName: prepared.upload.bucket,
          objectName: prepared.upload.path,
          contentType: file.type || 'application/octet-stream',
          cacheControl: '3600'
        },
        onProgress(uploaded, total) {
          const percent = total ? uploaded / total * 100 : 0;
          setPlanningUploadProgress(percent, 'Uploading to private storage', `${formatPlanningBytes(uploaded)} of ${formatPlanningBytes(total)} uploaded.`);
        },
        onSuccess: resolve,
        onError(uploadError) {
          reject(new Error(uploadError?.originalResponse?.getBody?.() || uploadError?.message || 'The resumable upload failed.'));
        }
      });
      planningUpload.findPreviousUploads().then(previous => {
        if (previous.length) planningUpload.resumeFromPreviousUpload(previous[0]);
        planningUpload.start();
      }).catch(reject);
    });
    setPlanningUploadProgress(100, 'Finalizing your project', 'The video arrived. Starting transcription and message review.');
    const durationSeconds = await durationPromise;
    await workspaceRequest(`/api/projects/${encodeURIComponent(workspaceProjectId)}/complete-upload`, {
      method: 'POST',
      body: JSON.stringify({ assetId, durationSeconds })
    });
    planningUpload = null;
    notify('Recording attached', 'Your research is safe. Transcription and message review are beginning.');
    window.setTimeout(() => window.location.reload(), 700);
  } catch (uploadError) {
    planningUpload = null;
    if (assetId) await workspaceRequest(`/api/projects/${encodeURIComponent(workspaceProjectId)}/pending-upload/${encodeURIComponent(assetId)}`, { method: 'DELETE' }).catch(() => {});
    setPlanningUploadProgress(0, 'Upload needs attention', uploadError.message);
    error.textContent = uploadError.message;
    button.disabled = false;
    button.textContent = 'Attach video and begin processing';
  }
});

document.getElementById('openDeeFromPlan')?.addEventListener('click', () => document.getElementById('deeLauncher')?.click());

window.addEventListener('beforeunload', event => {
  if (!planningUpload) return;
  event.preventDefault();
  event.returnValue = '';
});

loadRealWorkspace();
