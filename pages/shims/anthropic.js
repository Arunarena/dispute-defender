// The static demo has no API key, so the server uses its scripted agent and never calls Claude.
export default class Anthropic {
  constructor() {
    throw new Error("Claude isn't available in the static demo.");
  }
}
export const betaZodOutputFormat = (schema) => ({ type: "json_schema", schema });
export const betaZodTool = (tool) => tool;
