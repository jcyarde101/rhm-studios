(() => {
  const eligible = 'textarea:not(#deeInput), input:not([type]), input[type="text"], [contenteditable="true"]';
  let activeRecorder = null;

  function writeTranscription(target, text) {
    const copy = String(text || '').trim();
    if (!copy) return;
    if (target.matches('[contenteditable="true"]')) {
      target.focus();
      const selection = window.getSelection();
      if (selection?.rangeCount && target.contains(selection.anchorNode)) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(copy));
        range.collapse(false);
      } else {
        target.append(document.createTextNode(`${target.textContent?.trim() ? ' ' : ''}${copy}`));
      }
    } else {
      const spacer = target.value.trim() ? ' ' : '';
      target.value = `${target.value}${spacer}${copy}`;
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function startVoiceInput(target, button, status) {
    if (activeRecorder?.state === 'recording') {
      activeRecorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      status.textContent = 'Microphone recording is not supported in this browser.';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(value => MediaRecorder.isTypeSupported(value));
      const chunks = [];
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      activeRecorder = recorder;
      recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener('stop', async () => {
        stream.getTracks().forEach(track => track.stop());
        activeRecorder = null;
        button.classList.remove('recording');
        button.classList.add('transcribing');
        button.disabled = true;
        button.textContent = '…';
        status.textContent = 'Turning your speech into text…';
        try {
          const audio = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const response = await fetch('/api/dee/transcribe', { method: 'POST', headers: { 'Content-Type': audio.type || 'audio/webm' }, body: audio });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || 'The recording could not be transcribed.');
          writeTranscription(target, data.text);
          status.textContent = 'Speech added. You can edit it before saving.';
        } catch (error) {
          status.textContent = error.message;
        } finally {
          button.classList.remove('transcribing');
          button.disabled = false;
          button.textContent = '🎙';
        }
      });
      recorder.start();
      button.classList.add('recording');
      button.textContent = '■';
      status.textContent = 'Listening… click the red button when you are finished.';
    } catch (error) {
      status.textContent = error.name === 'NotAllowedError' ? 'Allow microphone access in your browser, then try again.' : 'The microphone could not start.';
    }
  }

  document.querySelectorAll(eligible).forEach(target => {
    if (target.closest('.voice-input-wrap')) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'voice-input-wrap';
    target.parentNode.insertBefore(wrapper, target);
    wrapper.append(target);
    const button = document.createElement('button');
    button.className = 'field-mic';
    button.type = 'button';
    button.textContent = '🎙';
    button.setAttribute('aria-label', 'Speak into this field');
    button.title = 'Speak instead of typing';
    const status = document.createElement('small');
    status.className = 'voice-input-status';
    status.setAttribute('aria-live', 'polite');
    wrapper.append(button, status);
    button.addEventListener('click', () => startVoiceInput(target, button, status));
  });
})();
