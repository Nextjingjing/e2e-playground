// OpenRouter access for the benchmark: the env that points `claude` at OpenRouter, and the key's
// running spend (the only exact cost figure; Claude Code's own estimate assumes Anthropic prices).

export function openrouterKey() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set (user environment variable)");
  return key;
}

export function claudeEnv({ effort = "medium", judgeModel = "anthropic/claude-haiku-5.5" } = {}) {
  return {
    ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
    ANTHROPIC_AUTH_TOKEN: openrouterKey(),
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: judgeModel,
    CLAUDE_CODE_EFFORT_LEVEL: effort,
    CLAUDE_CODE_ALWAYS_ENABLE_EFFORT: "1",
  };
}

// A dropped connection or a 5xx is retried: one failed lookup must not end a whole benchmark round.
export async function openrouterUsage({ fetchImpl = fetch, tries = 5, delayMs = 3000 } = {}) {
  for (let t = 1; ; t++) {
    try {
      const res = await fetchImpl("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${openrouterKey()}` } });
      if (!res.ok) throw new Error(`OpenRouter key lookup failed: HTTP ${res.status}`);
      return (await res.json()).data.usage;
    } catch (e) {
      if (t >= tries) throw e;
      await new Promise(r => setTimeout(r, delayMs * t));
    }
  }
}
