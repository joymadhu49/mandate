import { z } from 'zod';
import { config } from './config.js';
import { fundedAI } from './funded-ai.js';
import { AdmissionError } from './admission.js';
import { AICredentials } from './ai-credentials.js';

export const ModelId = z.string().trim().min(3).max(160).regex(/^[a-zA-Z0-9._:/-]+$/);
export const ApiKey = z.string().trim().min(20).max(512).regex(/^sk-or-[A-Za-z0-9_-]+$/);

export class AIError extends Error {
  constructor(message: string, public status: 400 | 401 | 429 | 502 | 503 = 502) { super(message); }
}

type Settings = { apiKey: string; model: string };
let session: Settings | undefined;
const credentials = new AICredentials(`${config.dbPath}.ai-credentials.json`);
export const aiSettings = (account?: string): Settings => (account ? credentials.get(account) : undefined) ?? session ?? { apiKey: config.openrouterKey, model: config.model };
export const setAISettings = (settings: Settings, account?: string) => { if (account) credentials.set(account, settings); else session = settings; };
export const resetAISettings = (account?: string) => { if (account) credentials.remove(account); else session = undefined; };
// In-app key setup is a development-backend feature (DEV_AI_SETTINGS=1, non-production) in either execution mode.
export const devAIEnabled = () => config.devAiSettings;
export const aiStatus = (account?: string) => ({
  configured: !!aiSettings(account).apiKey,
  model: aiSettings(account).model,
  source: account && credentials.get(account) ? 'saved' : session ? 'session' : config.openrouterKey ? 'environment' : 'none',
  developmentSettings: devAIEnabled(),
});

async function request(path: string, init?: RequestInit): Promise<unknown> {
  try {
    const response = await fetch(`https://openrouter.ai/api/v1${path}`, {
      ...init, signal: AbortSignal.timeout(30_000), redirect: 'manual',
    });
    if (!response.ok) {
      // Never forward provider bodies: they can echo prompts or credentials.
      if (response.status === 401 || response.status === 403) throw new AIError('OpenRouter rejected the API key. Check the key and its permissions.', 400);
      if (response.status === 402) throw new AIError('OpenRouter credits are exhausted. Add credits or use another key.', 400);
      if (response.status === 429) throw new AIError('OpenRouter is rate limited. Try again shortly.', 429);
      if (response.status === 400 || response.status === 404) throw new AIError('This model could not process the request. Select another structured-output model.', 400);
      throw new AIError('OpenRouter is unavailable. Try again shortly.');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof AIError) throw error;
    console.error('ai_transport_failed', { name: error instanceof Error ? error.name : 'unknown', timeout: error instanceof Error && /timeout|timed out|aborted/i.test(error.message) });
    throw new AIError('OpenRouter could not be reached or timed out. Try again.');
  }
}

const Model = z.object({
  id: ModelId, name: z.string(), supported_parameters: z.array(z.string()).optional(),
  pricing: z.object({ prompt: z.string(), completion: z.string() }),
});
let catalog: { expires: number; models: z.infer<typeof Model>[] } | undefined;
export async function listModels() {
  if (!catalog || catalog.expires < Date.now()) {
    const parsed = z.object({ data: z.array(z.unknown()) }).safeParse(await request('/models'));
    if (!parsed.success) throw new AIError('OpenRouter returned an invalid model catalog.');
    const models = parsed.data.data.flatMap((value) => {
      const model = Model.safeParse(value);
      return model.success && model.data.supported_parameters?.includes('structured_outputs') ? [model.data] : [];
    });
    catalog = { expires: Date.now() + 300_000, models };
  }
  return catalog.models;
}

export async function validateSettings(settings: Settings, owner?: string) {
  if (!settings.apiKey) throw new AIError('Enter your OpenRouter API key first.', 503);
  if (!(await listModels()).some((m) => m.id === settings.model)) {
    throw new AIError('Choose a model that supports structured JSON output.', 400);
  }
  // A real, bounded completion verifies both credentials and model access before activation.
  await completeJSON(settings, 'connection_check', {
    type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false,
  }, z.object({ ok: z.literal(true) }).strict(), 'Return JSON with ok set to true.', 'Test the connection.', 256, owner);
}

export async function completeJSON<T>(
  settings: Settings, name: string, schema: object, validator: z.ZodType<T>,
  system: string, user: string, maxTokens = 1200, owner?: string,
): Promise<T> {
  if (!settings.apiKey) throw new AIError('Connect OpenRouter in AI settings first.', 503);
  if (name === 'portfolio_decision' && !owner) throw new AIError('A verified account is required for a portfolio decision.', 400);
  const body = JSON.stringify({
    model: settings.model, temperature: 0.2, max_tokens: maxTokens,
    provider: { require_parameters: true },
    response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });
  let data: unknown;
  try {
    data = await fundedAI.run(owner, Buffer.byteLength(body, 'utf8') + maxTokens, () => request('/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${settings.apiKey}`, 'content-type': 'application/json', 'X-Title': 'Mandate agent' },
      body,
    }), name === 'agent_chat' ? 'chat' : 'evaluation');
  } catch (error) {
    if (error instanceof AdmissionError) throw new AIError(error.message, 429);
    throw error;
  }
  const envelope = z.object({ choices: z.array(z.object({
    finish_reason: z.literal('stop'), message: z.object({ content: z.string().max(20_000) }),
  })).min(1) }).safeParse(data);
  if (!envelope.success) throw new AIError('The model returned an incomplete response. Try again or change models.');
  try {
    return validator.parse(JSON.parse(envelope.data.choices[0].message.content));
  } catch {
    throw new AIError('The model returned an invalid response. No changes were applied.');
  }
}
