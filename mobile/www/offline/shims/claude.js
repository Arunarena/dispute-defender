// Offline there is no Claude, so the engine uses its scripted agent.
export const MODEL = null;
export const claudeConfigured = () => false;
export async function claudeJSON() {
  throw new Error("Claude isn't available in the offline demo.");
}
