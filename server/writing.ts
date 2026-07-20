import { config } from './config.js';

export type ShortDescriptionDraft = {
  title: string;
  foundationalScripture: string;
  paragraphs: string[];
};

function responseText(body: any) {
  return body?.choices?.[0]?.message?.content;
}

export async function generateShortDescription(
  transcript: string,
  workingTitle: string,
  primaryScripture: string,
  guidance = ''
): Promise<ShortDescriptionDraft> {
  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured.');
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'foundationalScripture', 'paragraphs'],
    properties: {
      title: { type: 'string' },
      foundationalScripture: { type: 'string' },
      paragraphs: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string' } }
    }
  };
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.openaiApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_schema', json_schema: { name: 'rhm_short_video_description', strict: true, schema } },
      messages: [
        {
          role: 'system',
          content: 'You are the editorial writer for RHM Studios. Create a polished short description for a devotional video using only the supplied transcript and project facts. Preserve the speaker\'s actual message and voice. Return a concise title, a foundational Scripture reference (reference only, no invented quotation), and no more than two short paragraphs. Keep the combined paragraphs under 170 words. Do not add teaching points, claims, events, or promises that are not supported by the transcript. Do not write a full devotional or a prayer.'
        },
        {
          role: 'user',
          content: `Working title: ${workingTitle || 'Not supplied'}\nFoundational Scripture entered by creator: ${primaryScripture || 'Not supplied'}\nCreator revision guidance: ${guidance || 'None; stay faithful to the transcript.'}\n\nTranscript:\n${transcript.slice(0, 60000)}`
        }
      ]
    })
  });
  const body = await response.json().catch(() => ({})) as any;
  const content = responseText(body);
  if (!response.ok || !content) throw new Error(body?.error?.message || `Description generation failed (${response.status}).`);
  const draft = JSON.parse(content) as ShortDescriptionDraft;
  draft.paragraphs = (Array.isArray(draft.paragraphs) ? draft.paragraphs : []).map(value => String(value).trim()).filter(Boolean).slice(0, 2);
  if (!draft.title?.trim() || !draft.foundationalScripture?.trim() || !draft.paragraphs.length) throw new Error('The generated description was incomplete. Please try again.');
  return { title: draft.title.trim(), foundationalScripture: draft.foundationalScripture.trim(), paragraphs: draft.paragraphs };
}
