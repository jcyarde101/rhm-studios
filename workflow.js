const steps=[...document.querySelectorAll('.step')];
const panels=[...document.querySelectorAll('.stage')];
function showStep(number){steps.forEach(s=>s.classList.toggle('active',s.dataset.step===String(number)));panels.forEach(p=>p.classList.toggle('active',p.dataset.panel===String(number)));if(Number(number)===3)void ensureShortDescription();window.scrollTo({top:0,behavior:'smooth'})}
steps.forEach(step=>step.addEventListener('click',()=>showStep(step.dataset.step)));
document.querySelectorAll('.chip').forEach(chip=>chip.addEventListener('click',()=>{document.querySelectorAll('.chip').forEach(c=>c.classList.remove('selected'));chip.classList.add('selected')}));
document.querySelectorAll('.style-options').forEach(group=>group.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{group.querySelectorAll('button').forEach(b=>b.classList.remove('selected'));button.classList.add('selected')})));
document.querySelectorAll('.transcript p').forEach(p=>p.addEventListener('click',()=>{document.querySelectorAll('.transcript p').forEach(x=>x.classList.remove('selected'));p.classList.add('selected');document.querySelector('.timeline>span').textContent=p.dataset.time}));
document.getElementById('polishRange')?.addEventListener('input',e=>document.getElementById('polishValue').textContent=e.target.value+'%');
const toast=document.getElementById('toast');
function notify(title='Stage approved',message='Your choices are saved. Preparing the next review.'){toast.querySelector('strong').textContent=title;toast.querySelector('small').textContent=message;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),3000)}
document.querySelectorAll('.approve-mini').forEach(button=>button.addEventListener('click',()=>{button.textContent=button.classList.toggle('chosen')?'✓ Approved':'✓';notify('Edit choice saved','This decision will be used in the full render.')}));
document.querySelectorAll('.preview-button').forEach(button=>button.addEventListener('click',()=>notify('Preview prepared','This prototype will play the rendered segment when the processing backend is connected.')));
const writingApproved=new Set();let currentWriting='description';let currentShortDescription=null;let shortDescriptionLoading=false;

function setDescriptionLoading(message='Preparing the title, foundational Scripture, and short description.') {
  document.getElementById('shortDescriptionView').hidden=false;
  document.getElementById('descriptionLoading').hidden=false;
  document.getElementById('descriptionLoading').querySelector('p').textContent=message;
  document.getElementById('descriptionDraft').hidden=true;
  document.getElementById('descriptionError').hidden=true;
  document.getElementById('approveWriting').disabled=true;
}

function renderShortDescription(draft) {
  if (!draft) return;
  currentShortDescription=draft;
  document.getElementById('descriptionLoading').hidden=true;
  document.getElementById('descriptionError').hidden=true;
  document.getElementById('descriptionDraft').hidden=false;
  document.getElementById('descriptionTitle').textContent=draft.title||'';
  document.getElementById('descriptionScripture').textContent=draft.foundationalScripture||'';
  const paragraphs=document.getElementById('descriptionParagraphs');paragraphs.innerHTML='';
  (draft.paragraphs||[]).slice(0,2).forEach(copy=>{const paragraph=document.createElement('p');paragraph.textContent=copy;paragraphs.append(paragraph)});
  const approved=Boolean(draft.approved);
  if(approved)writingApproved.add('description');else writingApproved.delete('description');
  document.getElementById('writingApprovalStatus').textContent=approved?'Approved and saved':'Not yet approved';
  document.getElementById('approveWriting').textContent=approved?'✓ Description approved':'✓ Approve description';
  document.getElementById('approveWriting').disabled=approved;
  document.getElementById('writingCount').textContent=`${approved?1:0} of 1`;
  document.getElementById('continueFromDescription').disabled=!approved;
  document.getElementById('writingDraftBadge').textContent=approved?'DESCRIPTION APPROVED':'READY FOR REVIEW';
}

function showDescriptionError(message) {
  document.getElementById('descriptionLoading').hidden=true;
  document.getElementById('descriptionDraft').hidden=true;
  document.getElementById('descriptionError').hidden=false;
  document.getElementById('descriptionErrorCopy').textContent=message;
  document.getElementById('approveWriting').disabled=true;
}

async function ensureShortDescription(guidance='') {
  if(currentWriting!=='description'||shortDescriptionLoading||!workspaceProjectId)return false;
  if(currentShortDescription&&!guidance){renderShortDescription(currentShortDescription);return true}
  shortDescriptionLoading=true;setDescriptionLoading(guidance?'Rewriting the description from your transcript and guidance.':undefined);
  try{
    const result=await workspaceRequest(`/api/projects/${encodeURIComponent(workspaceProjectId)}/writing/short-description`,{method:'POST',body:JSON.stringify({guidance})});
    renderShortDescription(result.draft);return true;
  }catch(error){showDescriptionError(error.message);return false}finally{shortDescriptionLoading=false}
}

function switchWritingTab(kind) {
  currentWriting=kind;
  document.querySelectorAll('[data-writing]').forEach(tab=>tab.classList.toggle('active',tab.dataset.writing===kind));
  document.getElementById('shortDescriptionView').hidden=false;
  document.getElementById('requestWritingChanges').hidden=false;
  document.getElementById('writingChangePanel').hidden=true;
  document.querySelector('.writing-approval').hidden=false;
  document.getElementById('writingNotesTitle').textContent='Built from your transcript';
  void ensureShortDescription();
}

document.querySelectorAll('[data-writing]').forEach(tab=>tab.addEventListener('click',()=>switchWritingTab(tab.dataset.writing)));
document.getElementById('requestWritingChanges')?.addEventListener('click',()=>{const panel=document.getElementById('writingChangePanel');panel.hidden=!panel.hidden;if(!panel.hidden)document.getElementById('writingGuidance').focus()});
document.getElementById('regenerateDescription')?.addEventListener('click',async event=>{const guidance=document.getElementById('writingGuidance').value.trim();if(!guidance)return notify('Tell AI what to change','Speak or type the correction before regenerating.');event.currentTarget.disabled=true;const succeeded=await ensureShortDescription(guidance);event.currentTarget.disabled=false;if(succeeded)document.getElementById('writingChangePanel').hidden=true});
document.getElementById('retryDescription')?.addEventListener('click',()=>ensureShortDescription());
document.getElementById('approveWriting')?.addEventListener('click',async event=>{if(currentWriting!=='description'||!currentShortDescription)return;const button=event.currentTarget;button.disabled=true;button.textContent='Saving approval...';try{const result=await workspaceRequest(`/api/projects/${encodeURIComponent(workspaceProjectId)}/writing/short-description/approve`,{method:'POST'});renderShortDescription(result.draft);notify('Description approved','Your transcript-based video description is saved and ready to use.')}catch(error){button.disabled=false;button.textContent='✓ Approve description';notify('Approval needs attention',error.message)}});
document.getElementById('previewAll')?.addEventListener('click',()=>notify('Preview not available','A real edited-video render has not been submitted yet.'));
document.getElementById('finalizeButton')?.addEventListener('click',()=>showStep(4));
document.getElementById('reviewFinalDescription')?.addEventListener('click',()=>showStep(3));
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

function fillVisualList(id, values, emptyText) {
  const list = document.getElementById(id);
  list.innerHTML = '';
  (Array.isArray(values) && values.length ? values : [emptyText]).forEach(value => {
    const item = document.createElement('li');
    item.textContent = value;
    list.append(item);
  });
}

function renderVisualAnalysis(visualAnalysis, job) {
  const panel = document.getElementById('visualAnalysisPanel');
  const progressPanel = document.getElementById('visualAnalysisProgress');
  const results = document.getElementById('visualAnalysisResults');
  const startButton = document.getElementById('startVisualAnalysis');
  if (visualAnalysis?.analysis) {
    const analysis = visualAnalysis.analysis;
    panel.dataset.state = 'ready';
    document.getElementById('visualAnalysisStatus').textContent = 'VISUAL REVIEW READY';
    progressPanel.hidden = true;
    results.hidden = false;
    document.getElementById('visualOverallSynopsis').textContent = analysis.overallVisualSynopsis || 'The sampled-frame review is ready.';
    document.getElementById('visualSamplingNote').textContent = `${visualAnalysis.sampled_frame_count || 0} representative frames reviewed · baseline interval ${visualAnalysis.sampling_interval_seconds || 0} seconds plus detected scene changes.`;
    fillVisualList('visualStrengths', analysis.presentationStrengths, 'No specific presentation strength was recorded.');
    fillVisualList('visualIssues', analysis.visualIssues, 'No visible issue was flagged in the sampled frames.');
    fillVisualList('visualElements', analysis.onScreenElements, 'No on-screen element was consistently detected.');
    const opportunities = document.getElementById('visualEditOpportunities');
    opportunities.innerHTML = '';
    (analysis.editOpportunities || []).forEach(opportunity => {
      const item = document.createElement('article');
      item.className = 'visual-opportunity';
      const time = document.createElement('b');
      time.textContent = opportunity.timestamp || 'Timestamp';
      const copy = document.createElement('p');
      copy.textContent = [opportunity.recommendation, opportunity.rationale].filter(Boolean).join(' — ');
      item.append(time, copy);
      opportunities.append(item);
    });
    return;
  }
  results.hidden = true;
  progressPanel.hidden = false;
  const status = job?.status || 'waiting';
  const progress = Math.max(0, Math.min(100, Number(job?.progress) || 0));
  panel.dataset.state = status === 'failed' ? 'failed' : 'working';
  document.getElementById('visualAnalysisStatus').textContent = status === 'running' ? 'ANALYZING FRAMES' : status === 'queued' ? 'QUEUED' : status === 'failed' ? 'NEEDS ATTENTION' : 'READY TO START';
  document.getElementById('visualAnalysisPercent').textContent = `${progress}%`;
  document.getElementById('visualAnalysisBar').style.width = `${progress}%`;
  const phase = progress < 18 ? 'Extracting representative frames and scene changes' : progress < 84 ? 'Reviewing timestamped frames with Dee' : 'Combining visual findings with the transcript';
  document.getElementById('visualAnalysisProgressTitle').textContent = status === 'running' ? phase : status === 'failed' ? 'Visual analysis paused' : status === 'queued' ? 'Visual analysis is queued' : 'Ready to analyze the video';
  document.getElementById('visualAnalysisProgressCopy').textContent = status === 'failed' ? (job.error_message || 'The frame review could not finish. Retry when ready.') : 'This runs in the background and does not need to play the video in real time.';
  startButton.hidden = status === 'queued' || status === 'running';
  startButton.textContent = status === 'failed' ? 'Retry visual analysis' : 'Start visual analysis';
}

function renderRunwayDirectionPlan(plan) {
  if (!plan) return;
  document.getElementById('runwayDirectionTitle').textContent = plan.title || 'Approved Runway video direction';
  document.getElementById('runwayDirectionSummary').textContent = plan.approvalSynopsis || plan.summary || '';
  document.getElementById('runwayDirectionStatus').textContent = 'APPROVED · READY FOR PREVIEWS';
  document.getElementById('approveSavedRunwaySynopsis').hidden = true;
  document.getElementById('runwayEditorialIntent').textContent = plan.editorialIntent || '';
  document.getElementById('runwayGlobalTreatment').textContent = plan.globalTreatment || '';
  document.getElementById('runwayAudioBrand').textContent = [plan.audioDirection, plan.brandDirection].filter(Boolean).join(' ');
  const scenes = document.getElementById('runwayScenes');
  scenes.innerHTML = '';
  (plan.scenes || []).forEach(scene => {
    const article = document.createElement('article');
    article.className = 'runway-scene';
    const range = document.createElement('span');
    range.textContent = scene.sourceRange || 'Selected range';
    const details = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${scene.runwayTool || 'Runway'} · ${scene.purpose || 'Visual treatment'}`;
    const prompt = document.createElement('p');
    prompt.textContent = scene.prompt || '';
    const placement = document.createElement('small');
    placement.textContent = [scene.placement, scene.extraMotion ? `Extra motion: ${scene.extraMotion}` : ''].filter(Boolean).join(' · ');
    details.append(title, prompt, placement);
    article.append(range, details);
    scenes.append(article);
  });
  const checklist = document.getElementById('runwayReviewChecklist');
  checklist.innerHTML = '';
  (plan.reviewChecklist || []).forEach(item => {
    const entry = document.createElement('li');
    entry.textContent = item;
    checklist.append(entry);
  });
  document.getElementById('runwayDirectionContent').hidden = false;
  const badge = document.querySelector('[data-panel="2"] .ready-badge');
  if (badge) badge.textContent = 'RUNWAY BRIEF APPROVED';
  const step = document.querySelector('.step[data-step="2"]');
  if (step) { step.classList.add('complete'); step.querySelector('b').textContent = 'APPROVED'; }
  document.getElementById('continueFromDirection').disabled = false;
}
window.renderRunwayDirectionPlan = renderRunwayDirectionPlan;

function renderRunwayDirectionSynopsis(direction) {
  if (!direction?.synopsis) return;
  document.getElementById('runwayDirectionTitle').textContent = direction.title || 'Proposed video direction';
  document.getElementById('runwayDirectionSummary').textContent = direction.synopsis;
  document.getElementById('runwayDirectionStatus').textContent = 'SYNOPSIS · AWAITING APPROVAL';
  document.getElementById('approveSavedRunwaySynopsis').hidden = false;
}

function findProductionJob(jobs, types) {
  return (jobs || []).find(job => types.includes(job.job_type));
}

function productionJobState(job, label) {
  const progress = Math.max(0, Math.min(100, Number(job?.progress) || 0));
  if (!job) return { state: 'waiting', progress: 0, badge: 'NOT STARTED', title: `${label} has not started`, copy: 'No render job has been submitted.' };
  if (job.status === 'completed') return { state: 'ready', progress: 100, badge: 'READY', title: `${label} is complete`, copy: 'The render job reports completion and is ready for file verification.' };
  if (job.status === 'failed') return { state: 'failed', progress, badge: 'NEEDS ATTENTION', title: `${label} stopped`, copy: job.error_message || 'The render job did not finish.' };
  if (job.status === 'queued') return { state: 'queued', progress, badge: 'QUEUED', title: `${label} is queued`, copy: 'The render has been submitted and is waiting for processing capacity.' };
  return { state: 'running', progress, badge: `RENDERING ${progress}%`, title: `${label} is rendering`, copy: 'This page checks the real job status automatically. You may leave and return later.' };
}

function renderProductionStatus(data) {
  const jobs = data.jobs || [];
  const videoJob = findProductionJob(jobs, ['full_render', 'video_render', 'runway_render', 'render']);
  const video = productionJobState(videoJob, 'The edited full video');
  const sidebar = document.getElementById('productionStatusCard');
  sidebar.dataset.state = video.state;
  document.getElementById('productionStatusLabel').textContent = video.title;
  document.getElementById('productionStatusPercent').textContent = `${video.progress}%`;
  document.getElementById('productionStatusBar').style.width = `${video.progress}%`;
  document.getElementById('productionStatusCopy').textContent = videoJob ? video.copy : 'Your upload, transcript, analysis, and approved plans are safe. No edited video render has been submitted yet.';
  const panel = document.getElementById('finalRenderProgress');
  panel.dataset.state = video.state;
  document.getElementById('finalRenderPercent').textContent = `${video.progress}%`;
  document.getElementById('finalRenderBar').style.width = `${video.progress}%`;
  document.getElementById('finalRenderTitle').textContent = video.title;
  document.getElementById('finalRenderCopy').textContent = videoJob ? video.copy : 'Your upload, transcript, visual analysis, description, and approved direction are safe. A real Runway/render job still needs to be submitted.';
  document.getElementById('finalRenderBadge').textContent = video.badge;
  const videoStatus = document.getElementById('finalVideoStatus');
  videoStatus.textContent = video.badge;
  videoStatus.className = video.state === 'ready' ? '' : 'working';
  document.getElementById('finalVideoCopy').textContent = videoJob ? video.copy : 'The edit direction is approved, but the full-quality edited video has not been rendered.';
  const videoPreview = document.getElementById('finalVideoPreview');
  videoPreview.disabled = true;
  videoPreview.textContent = video.state === 'ready' ? 'File verification needed' : 'Preview unavailable';
  const descriptionApproved = Boolean(data.shortDescription?.approved);
  const descriptionStatus = document.getElementById('finalDescriptionStatus');
  descriptionStatus.textContent = descriptionApproved ? 'APPROVED' : 'AWAITING APPROVAL';
  descriptionStatus.className = descriptionApproved ? '' : 'working';
  document.getElementById('finalApprovalTitle').textContent = video.state === 'ready' ? 'The rendered master video needs final preview verification.' : 'Waiting for the actual full-video render.';
  document.getElementById('finalApprovalCopy').textContent = 'This button remains locked until the polished main video has a real reviewable file.';
  document.getElementById('approveFinalPackage').disabled = true;
  return { videoJob };
}

function setWorkflowStepState(number, approved) {
  const step = document.querySelector(`.step[data-step="${number}"]`);
  if (!step) return;
  step.classList.toggle('complete', approved);
  const label = step.querySelector('b');
  if (label) label.textContent = approved ? 'APPROVED' : 'REVIEW';
}

function renderProductionHandoff(data) {
  const messageApproved = data.messageStage?.status === 'approved';
  const directionApproved = data.videoDirectionStage?.status === 'approved' && Boolean(data.videoDirection);
  const descriptionApproved = Boolean(data.shortDescription?.approved);
  const ready = messageApproved && directionApproved && descriptionApproved;
  const review = data.messageReview || {};
  const direction = data.videoDirection || {};
  const description = data.shortDescription || {};

  setWorkflowStepState(1, messageApproved);
  setWorkflowStepState(2, directionApproved);
  setWorkflowStepState(3, descriptionApproved);
  document.getElementById('approveMessageReview').disabled = messageApproved || !data.messageReview;
  document.getElementById('approveMessageReview').textContent = messageApproved ? '✓ Message approved' : 'Approve & continue →';
  document.getElementById('continueFromDirection').disabled = !directionApproved;
  document.getElementById('continueFromDescription').disabled = !descriptionApproved;

  const handoff = document.getElementById('productionHandoff');
  handoff.dataset.ready = String(ready);
  document.getElementById('handoffReadiness').textContent = ready ? 'ALL 3 APPROVED' : 'APPROVAL NEEDED';
  const fill = (name, approved, title, copy, detail) => {
    const article = document.getElementById(`handoff${name}`);
    article.dataset.approved = String(approved);
    document.getElementById(`handoff${name}Status`).textContent = approved ? 'APPROVED' : 'NEEDS APPROVAL';
    document.getElementById(`handoff${name}Title`).textContent = title || 'Not ready yet';
    document.getElementById(`handoff${name}Copy`).textContent = copy || 'Return to this step to finish the review.';
    document.getElementById(name === 'Message' ? 'handoffScripture' : `handoff${name}Details`).textContent = detail || '';
  };
  fill('Message', messageApproved, review.centralMessage || 'Message review', review.overallSynopsis, data.project.primary_scripture ? `Foundational Scripture: ${data.project.primary_scripture}` : 'No foundational Scripture saved.');
  fill('Direction', directionApproved, direction.title || data.videoDirectionSynopsis?.title || 'Video direction', direction.approvalSynopsis || data.videoDirectionSynopsis?.synopsis, direction.scenes?.length ? `${direction.scenes.length} focused Runway/B-roll ranges · audio, Scripture graphics, and RHM branding included` : 'Approve Dee\'s synopsis to save the detailed production direction.');
  fill('Description', descriptionApproved, description.title || 'Video description', (description.paragraphs || []).join(' '), description.foundationalScripture ? `Foundational Scripture: ${description.foundationalScripture}` : 'Transcript-based posting copy.');

  const renderJob = findProductionJob(data.jobs || [], ['full_render', 'video_render', 'runway_render', 'render']);
  const canStart = false;
  const startButton = document.getElementById('startFullRender');
  startButton.disabled = !canStart;
  document.getElementById('renderStartTitle').textContent = renderJob ? 'The full video render has already been submitted.' : ready ? 'Your production handoff is approved and ready for the render connection.' : 'Finish the approvals marked above.';
  document.getElementById('renderStartCopy').textContent = renderJob ? 'Use the live status above to follow the job.' : ready ? 'The button will activate when the real Runway/FFmpeg worker is connected; it will not create a job that stays at 0%.' : 'Nothing will be submitted or charged until all three approvals are saved.';
  document.getElementById('renderStartBar').hidden = Boolean(renderJob);
  document.getElementById('finalApprovalBar').hidden = !renderJob;
  return ready;
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
  const visualJob = (data.jobs || []).find(item => item.job_type === 'visual_analysis');
  renderVisualAnalysis(data.visualAnalysis, visualJob);
  if (data.shortDescription) renderShortDescription(data.shortDescription);
  renderRunwayDirectionPlan(data.videoDirection);
  if (!data.videoDirection) renderRunwayDirectionSynopsis(data.videoDirectionSynopsis);
  renderProductionHandoff(data);
  const production = renderProductionStatus(data);
  const job = (data.jobs || []).find(item => item.job_type === 'transcription');
  if (data.messageReview) renderMessageReview(data.messageReview, data.userDirection);
  else renderProcessingState(job);
  const visualActive = !data.visualAnalysis && visualJob && ['queued', 'running'].includes(visualJob.status);
  const productionActive = Boolean(production.videoJob && ['queued', 'running'].includes(production.videoJob.status));
  const shouldPoll = (!data.messageReview && (!job || job.status === 'queued' || job.status === 'running')) || visualActive || productionActive;
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

document.getElementById('approveSavedRunwaySynopsis')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Saving detailed Runway direction...';
  try {
    const result = await workspaceRequest('/api/dee/video-direction/approve', {
      method: 'POST', body: JSON.stringify({ projectId: workspaceProjectId })
    });
    renderRunwayDirectionPlan(result.plan);
    notify('Video direction approved', 'The detailed Runway ranges and prompts are ready for preview planning.');
  } catch (error) {
    notify('Approval needs attention', error.message);
    button.disabled = false;
    button.textContent = 'Approve synopsis';
  }
});

document.getElementById('approveMessageReview')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Saving approval...';
  try {
    await workspaceRequest(`/api/projects/${encodeURIComponent(workspaceProjectId)}/message-review/approve`, { method: 'POST' });
    notify('Message approved', 'Your transcript review and message direction are saved.');
    await loadRealWorkspace();
    showStep(2);
  } catch (error) {
    notify('Approval needs attention', error.message);
    button.disabled = false;
    button.textContent = 'Approve & continue →';
  }
});

document.getElementById('continueFromDirection')?.addEventListener('click', () => showStep(3));
document.getElementById('continueFromDescription')?.addEventListener('click', () => showStep(4));
document.querySelectorAll('[data-return-step]').forEach(button => button.addEventListener('click', () => showStep(Number(button.dataset.returnStep))));
document.getElementById('startVisualAnalysis')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = 'Queuing visual analysis...';
  try {
    await workspaceRequest(`/api/projects/${encodeURIComponent(workspaceProjectId)}/visual-analysis`, { method: 'POST' });
    notify('Visual analysis queued', 'Dee will review representative frames and scene changes in the background.');
    await loadRealWorkspace();
  } catch (error) {
    notify('Visual analysis needs attention', error.message);
    button.disabled = false;
    button.textContent = 'Retry visual analysis';
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
