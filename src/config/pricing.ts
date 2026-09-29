// Gemini prices in USD per 1M tokens. Edit here — this is the only place prices live.
// Thinking tokens are billed at the output price. Image outputs are billed as output
// tokens too (~1,290 tokens per generated image). Check https://ai.google.dev/pricing
// and update when Google changes rates; existing ApiUsage rows keep the cost they
// were logged with.

export interface ModelPrice {
  /** Substring matched against the model id (first match in list order wins). */
  match: string;
  input: number;
  output: number;
}

export const PRICING: ModelPrice[] = [
  { match: "pro-tts", input: 1.0, output: 20.0 },
  { match: "tts", input: 0.5, output: 10.0 },
  { match: "image", input: 0.3, output: 30.0 },
  { match: "flash-lite", input: 0.1, output: 0.4 },
  { match: "pro", input: 1.25, output: 10.0 },
  { match: "flash", input: 0.3, output: 2.5 },
];

/** Used when no entry matches (kept on the expensive side so spend isn't under-reported). */
export const DEFAULT_PRICE = { input: 1.25, output: 10.0 };

export function priceFor(model: string) {
  const id = model.toLowerCase();
  return PRICING.find((p) => id.includes(p.match)) ?? DEFAULT_PRICE;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number, thinkingTokens: number) {
  const p = priceFor(model);
  return (inputTokens * p.input + (outputTokens + thinkingTokens) * p.output) / 1_000_000;
}
