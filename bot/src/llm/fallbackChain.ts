/**
 * Multi-provider LLM fallback chain.
 *
 * Order: Groq (llama-3.3-70b) → Gemini (gemini-2.0-flash) → OpenRouter → templates.
 * Each call is time-boxed to 7s. Failure moves to the next provider, never throws.
 * Template fallback guarantees a response with zero network availability.
 */

interface LlmProvider {
  name: string;
  isConfigured: () => boolean;
  generate: (system: string, user: string) => Promise<string>;
}

const TIMEOUT_MS = 7000;

const DRISHTI_SYSTEM = `You are Drishti Bot, the AI assistant for an office energy monitoring system called Drishti (দৃষ্টি).
You speak in a concise, friendly, professional tone — like a knowledgeable colleague, not a formal report.
You only discuss energy usage, device status, office alerts, and related topics.
Always ground your responses in the real data provided. Never make up numbers.
Keep responses short: 1–3 sentences unless the user needs a detailed breakdown.
Do not use markdown headers or bullet points in conversational replies.`;

async function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ── Groq ─────────────────────────────────────────────────────────────────────

const groqProvider: LlmProvider = {
  name: "groq/llama-3.3-70b",
  isConfigured: () => Boolean(process.env.GROQ_API_KEY),
  generate: async (system, user) => {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 300,
        temperature: 0.55,
        top_p: 0.9,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`groq ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("groq returned empty content");
    return text;
  },
};

// ── Gemini ───────────────────────────────────────────────────────────────────

const geminiProvider: LlmProvider = {
  name: "gemini/gemini-2.0-flash",
  isConfigured: () => Boolean(process.env.GEMINI_API_KEY),
  generate: async (system, user) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.55, topP: 0.9 },
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
          ],
        }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`gemini ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error("gemini returned empty content");
    return text;
  },
};

// ── OpenRouter ────────────────────────────────────────────────────────────────

const openRouterProvider: LlmProvider = {
  name: "openrouter/llama-3.1-8b",
  isConfigured: () => Boolean(process.env.OPENROUTER_API_KEY),
  generate: async (system, user) => {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://github.com/drishti-office",
        "X-Title": "Drishti Office Bot",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.1-8b-instruct:free",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 300,
        temperature: 0.55,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`openrouter ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("openrouter returned empty content");
    return text;
  },
};

const providers: LlmProvider[] = [groqProvider, geminiProvider, openRouterProvider];

export interface LlmResult {
  text: string;
  provider: string;
}

/**
 * Tries each configured provider in order with the shared Drishti system prompt.
 * Falls back to the template function if all providers fail or are unconfigured.
 */
export async function generateWithFallback(
  userPrompt: string,
  templateFallback: () => string,
  extraSystemContext?: string
): Promise<LlmResult> {
  const system = extraSystemContext
    ? `${DRISHTI_SYSTEM}\n\n${extraSystemContext}`
    : DRISHTI_SYSTEM;

  for (const provider of providers) {
    if (!provider.isConfigured()) continue;
    try {
      const text = await withTimeout(
        provider.generate(system, userPrompt),
        TIMEOUT_MS,
        provider.name
      );
      console.log(`[llm] ${provider.name} responded OK`);
      return { text, provider: provider.name };
    } catch (err) {
      console.warn(`[llm] ${provider.name} failed: ${(err as Error).message}`);
    }
  }

  // All providers failed — use deterministic template
  console.log("[llm] all providers failed — using template fallback");
  return { text: templateFallback(), provider: "template" };
}
