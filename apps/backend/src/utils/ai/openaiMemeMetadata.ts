import fs from 'fs';
import { getOpenAIApiKey, openaiFetchJson } from './openaiClient.js';

type ChatCompletionResponse = {
  choices?: Array<{
    message?: { content?: string };
  }>;
};

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function normSpace(s: string): string {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function sanitizeTitle(raw: unknown): string | null {
  const t = normSpace(String(raw ?? ''));
  if (!t) return null;
  // Keep titles short and UI-friendly.
  const short = t.slice(0, 80);
  const low = short.toLowerCase();
  // Reject placeholders / non-informative titles.
  if (low === 'мем' || low === 'meme' || low === 'untitled' || low === 'без названия') return null;
  return short;
}

function sanitizeTags(raw: unknown, maxTags: number): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const v of arr) {
    const t = normSpace(String(v ?? '')).toLowerCase();
    if (!t) continue;
    // Prefer single-token tags usable in search; allow letters/digits/_/-
    const cleaned = t
      .replace(/^#+/, '')
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\-\u0400-\u04FF]+/g, '');
    if (cleaned === 'мем' || cleaned === 'meme') continue;
    if (cleaned.length < 2 || cleaned.length > 24) continue;
    if (!out.includes(cleaned)) out.push(cleaned);
    if (out.length >= maxTags) break;
  }
  return out;
}

function safeParseJson(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function generateMemeMetadataOpenAI(args: {
  titleHint?: string | null;
  transcript?: string | null;
  labels?: string[];
  framePaths?: string[];
  maxTags?: number;
  model?: string;
}): Promise<{
  title: string | null;
  tags: string[];
  description: string | null;
  model: string;
}> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY_not_set');

  const model = args.model || String(process.env.OPENAI_MEME_METADATA_MODEL || '').trim() || 'gpt-4o-mini';
  const maxTags = clampInt(parseInt(String(args.maxTags ?? process.env.AI_TAG_LIMIT ?? ''), 10), 1, 20, 8);
  const frames = Array.isArray(args.framePaths) ? args.framePaths.slice(0, 10) : [];

  const transcript = String(args.transcript || '').trim();
  const transcriptForPrompt = transcript ? transcript.slice(0, 8000) : '';
  const labels = Array.isArray(args.labels) ? args.labels.map((x) => String(x || '')).filter(Boolean).slice(0, 50) : [];

  const sys = [
    'Ты помогаешь генерировать метаданные для коротких видео-мемов (до 15 секунд).',
    'Верни СТРОГО JSON объект с ключами: title, tags, description.',
    '',
    'Требования:',
    '- title: короткое (до 60-80 символов), описывает СМЫСЛ мема и визуальный контекст, НЕ цитата из аудио.',
    "- Никогда не используй плейсхолдеры вроде 'Мем', 'Untitled', 'Без названия'.",
    '- tags: массив из 3-' + String(maxTags) + ' поисковых тегов (короткие, 1 слово или snake_case, без мусора, без полного текста речи).',
    '- description: подробное описание, можно 2-6 предложений; отдельно учти, что видно на экране и что сказано/происходит.',
    '',
    'Язык: русский. Теги: можно рус/англ, но коротко и поисково.',
  ].join('\n');

  const userText = [
    args.titleHint ? `Исходный title (хинт, может быть плохим): ${String(args.titleHint).slice(0, 120)}` : '',
    labels.length ? `Labels: ${labels.join(', ')}` : '',
    transcriptForPrompt ? `Транскрипт (обрезан):\n${transcriptForPrompt}` : 'Транскрипта нет или он пустой.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const content: any[] = [{ type: 'text', text: userText }];

  for (const fp of frames) {
    const buf = await fs.promises.readFile(fp);
    const b64 = buf.toString('base64');
    const mime = 'image/jpeg';
    content.push({
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${b64}` },
    });
  }

  const body = JSON.stringify({
    model,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content },
    ],
  });

  const data = await openaiFetchJson<ChatCompletionResponse>(
    '/v1/chat/completions',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
    { apiKey }
  );

  const raw = String(data?.choices?.[0]?.message?.content || '').trim();
  const json = safeParseJson(raw);
  if (!json || typeof json !== 'object') {
    throw new Error('openai_metadata_invalid_json');
  }

  const title = sanitizeTitle((json as any).title);
  const tags = sanitizeTags((json as any).tags, maxTags);
  const descriptionRaw = normSpace(String((json as any).description ?? ''));
  const description = descriptionRaw ? descriptionRaw.slice(0, 1500) : null;

  return { title, tags, description, model };
}


