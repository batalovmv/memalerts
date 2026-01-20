import { http, HttpResponse } from 'msw';
import chatFixture from '../fixtures/openai/chat_completion.json';
import moderationFixture from '../fixtures/openai/moderation.json';
import transcriptionFixture from '../fixtures/openai/transcription.json';

export const openaiHandlers = [
  http.post('https://api.openai.com/v1/chat/completions', () => HttpResponse.json(chatFixture)),
  http.post('https://api.openai.com/v1/moderations', () => HttpResponse.json(moderationFixture)),
  http.post('https://api.openai.com/v1/audio/transcriptions', () => HttpResponse.json(transcriptionFixture)),
];
