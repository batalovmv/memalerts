import { getOpenAIApiKey, openaiFetchJson } from './openaiClient.js';

type OpenAIModerationResponse = {
  results: Array<{
    flagged: boolean;
    categories: Record<string, boolean>;
    category_scores: Record<string, number>;
  }>;
  model?: string;
};

export async function moderateTextOpenAI(args: { text: string; model?: string }): Promise<{
  flagged: boolean;
  labels: string[];
  riskScore: number;
  model: string;
}> {
  const apiKey = getOpenAIApiKey();
  if (!apiKey) throw new Error('OPENAI_API_KEY_not_set');

  const model = args.model || String(process.env.OPENAI_MODERATION_MODEL || '').trim() || 'omni-moderation-latest';

  const body = JSON.stringify({ model, input: args.text || '' });
  const data = await openaiFetchJson<OpenAIModerationResponse>(
    '/v1/moderations',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    },
    { apiKey }
  );

  const r = data?.results?.[0];
  const flagged = !!r?.flagged;
  const categories = r?.categories || {};
  const scores = r?.category_scores || {};

  const labels = Object.entries(categories)
    .filter(([, v]) => !!v)
    .map(([k]) => `text:${k}`);

  const riskScore = Math.max(
    0,
    Math.min(1, Math.max(...Object.values(scores).map((n) => (typeof n === 'number' ? n : 0)), flagged ? 0.9 : 0))
  );

  return { flagged, labels, riskScore, model };
}
