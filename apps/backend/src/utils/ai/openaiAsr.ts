import fs from 'fs';
import path from 'path';
import { getOpenAIApiKey, openaiFetchJson } from './openaiClient.js';

type OpenAITranscriptionResponse = {
  text: string;
};

export async function transcribeAudioOpenAI(args: {
  audioFilePath: string;
  model?: string;
  language?: string;
}): Promise<{ transcript: string; model: string }> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY_not_set');

  const model = args.model || String(process.env.OPENAI_ASR_MODEL || '').trim() || 'gpt-4o-mini-transcribe';

  const ext = path.extname(args.audioFilePath).toLowerCase();
  const mimeType = ext === '.mp3' ? 'audio/mpeg' : ext === '.wav' ? 'audio/wav' : 'application/octet-stream';

  const form = new FormData();
  const buf = await fs.promises.readFile(args.audioFilePath);
  form.set('file', new Blob([buf], { type: mimeType }), path.basename(args.audioFilePath));
  form.set('model', model);
  if (args.language) form.set('language', args.language);

  const data = await openaiFetchJson<OpenAITranscriptionResponse>(
    '/v1/audio/transcriptions',
    { method: 'POST', body: form },
    { apiKey }
  );

  return { transcript: String(data?.text || ''), model };
}


