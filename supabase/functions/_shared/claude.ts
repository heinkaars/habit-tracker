/**
 * The Claude call, shared by both AI functions.
 *
 * The API key lives in `Deno.env` as a function secret and never leaves the
 * server. That is the reason these features are Edge Functions at all — an
 * `EXPO_PUBLIC_` key would be inlined into the app bundle and readable by
 * anyone who downloads it.
 */

import Anthropic from 'npm:@anthropic-ai/sdk@0.116.0';

/** Requested explicitly. Sonnet 5 is strong enough for this and much cheaper than Opus. */
const MODEL = 'claude-sonnet-5';

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) {
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set. Run: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...',
      );
    }
    client = new Anthropic({ apiKey });
  }

  return client;
}

export class RefusalError extends Error {}

type GenerateOptions = {
  system: string;
  input: unknown;
  schema: Record<string, unknown>;
  /**
   * `low` for the daily nudge — it is one judgement call over a dozen numbers.
   * `medium` for reflections, which weigh several habits against each other.
   * Sonnet 5 defaults to `high`, which is more deliberation than either needs.
   */
  effort: 'low' | 'medium' | 'high';
  maxTokens: number;
};

/**
 * Asks for a single JSON object matching `schema`.
 *
 * Structured outputs rather than "reply with JSON" in the prompt: the app
 * renders these fields into themed cards, so a stray prose preamble would mean
 * parsing model output at render time. The schema is static per function so it
 * stays inside the API's schema cache.
 */
export async function generateJson<T>({
  system,
  input,
  schema,
  effort,
  maxTokens,
}: GenerateOptions): Promise<T> {
  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: {
      effort,
      format: { type: 'json_schema', schema },
    },
    messages: [{ role: 'user', content: JSON.stringify(input) }],
  });

  // Check the stop reason before reading content: a refusal returns HTTP 200
  // with an empty content array, so indexing straight into it would throw a
  // confusing TypeError instead of the real cause.
  if (response.stop_reason === 'refusal') {
    throw new RefusalError('The model declined to respond to this data.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Response was truncated before it completed.');
  }

  const text = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text',
  )?.text;

  if (!text) throw new Error('No text block in the model response.');

  return JSON.parse(text) as T;
}
