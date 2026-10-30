// Shared Claude helpers: one client, plus a structured-output call.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
export const claudeConfigured = () =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client;
export const getClient = () => (client ??= new Anthropic());

// If a safety classifier declines a request, the API retries on a fallback model.
export const FALLBACK_PARAMS = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

// One Claude call that returns an object matching `schema` (a Zod schema).
export async function claudeJSON({ system, content, schema, effort = "low", maxTokens = 8000 }) {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    ...FALLBACK_PARAMS,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (!response.parsed_output) throw new Error("The model did not return valid structured output.");
  return response.parsed_output;
}
