/**
 * Claude API wrapper.
 *
 * We use the Anthropic SDK and expose two helpers: a non-streaming JSON
 * call (for deterministic structured output) and a streaming variant we
 * pipe through to the browser via SSE so the UI can render sections as
 * they arrive.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error('ANTHROPIC_API_KEY is not configured on the server.');
    err.status = 500;
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

/**
 * Extract the first valid JSON object from a response string.
 * Claude normally complies with the "JSON only" instruction but we
 * defensively strip accidental markdown fences just in case.
 */
export function extractJson(raw) {
  if (!raw) throw new Error('Empty response from Claude');
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('No JSON object found in Claude response');
  }
  return JSON.parse(text.slice(start, end + 1));
}

export async function callClaudeJson({ system, user, maxTokens = 4096 }) {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }]
  });
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return { raw: text, json: extractJson(text), usage: response.usage };
}

export async function streamClaude({ system, user, maxTokens = 4096, onText, onDone, onError }) {
  try {
    const anthropic = getClient();
    const stream = await anthropic.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }]
    });
    stream.on('text', (delta) => onText?.(delta));
    stream.on('error', (err) => onError?.(err));
    const final = await stream.finalMessage();
    onDone?.(final);
  } catch (err) {
    onError?.(err);
  }
}
