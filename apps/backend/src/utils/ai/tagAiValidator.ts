import { getOpenAIApiKey, openaiFetchJson } from './openaiClient.js';
import { normalizeTagName } from './tagMapping.js';

export interface TagValidationResult {
  isValid: boolean;
  isAlias: boolean;
  aliasOf?: string | null;
  category?: string | null;
  displayName?: string | null;
  confidence: number;
  reason?: string | null;
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

function clampFloat(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  return null;
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const num = parseFloat(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

export async function validateTagWithAI(rawTag: string, existingTags: string[]): Promise<TagValidationResult> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY_not_set');

  const model =
    String(process.env.OPENAI_TAG_VALIDATION_MODEL || '').trim() ||
    String(process.env.OPENAI_MEME_METADATA_MODEL || '').trim() ||
    'gpt-4o-mini';

  const tagForPrompt = String(rawTag || '').trim().slice(0, 60);
  const existing = existingTags.slice(0, 120).join(', ');

  const prompt = `
Ты эксперт по мем-культуре и интернет-трендам. Проанализируй тег для системы мемов.

Тег для анализа: "${tagForPrompt}"

Существующие canonical теги в системе:
${existing}

Категории тегов:
- mood: настроение (funny, sad, epic, cringe, wholesome, scary, hype)
- intent: цель отправки (troll, support, hurry, celebrate, fail, vibe, react)
- content_type: тип контента (music, sound_effect, dialogue, earrape, remix)
- source: источник (tiktok, youtube, movie, anime, game, stream)
- theme: тема (animals, cat, dog, food, sports, cars)
- meme_format: мем-формат (bruh, sigma, skibidi, ohio, bonk, rickroll)

Ответь строго в JSON формате:
{
  "isValid": true/false,
  "isAlias": true/false,
  "aliasOf": "existing_tag_name или null",
  "category": "mood|intent|content_type|source|theme|meme_format или null",
  "displayName": "Красивое название для UI",
  "confidence": 0.0-1.0,
  "reason": "краткое объяснение решения"
}

Правила:
- isValid=false если: мусор, опечатка, слишком специфично (имя пользователя, дата), бессмысленно
- isAlias=true если: это синоним/вариант/перевод существующего тега
- Для новых трендов (skibidi, ohio и т.д.) — isValid=true, category="meme_format"
- confidence < 0.8 если не уверен — тег пойдёт на ручную модерацию
`;

  const body = JSON.stringify({
    model,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: prompt }],
  });

  const data = await openaiFetchJson<ChatCompletionResponse>(
    '/v1/chat/completions',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
    { apiKey }
  );

  const raw = String(data?.choices?.[0]?.message?.content || '').trim();
  const parsed = safeParseJson(raw);
  if (!parsed) throw new Error('openai_tag_validation_invalid_json');

  const confidence = clampFloat(asNumber(parsed.confidence) ?? 0, 0, 1, 0);
  const aliasOfRaw = asString(parsed.aliasOf);
  const aliasOf = aliasOfRaw ? normalizeTagName(aliasOfRaw) : null;

  return {
    isValid: asBool(parsed.isValid),
    isAlias: asBool(parsed.isAlias),
    aliasOf,
    category: asString(parsed.category),
    displayName: asString(parsed.displayName),
    confidence,
    reason: asString(parsed.reason),
  };
}
