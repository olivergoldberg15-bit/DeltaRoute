export function tokenCost(model, usage, now = new Date()) {
  const prices = model.pricesFrom && now.toISOString().slice(0, 10) >= model.pricesFrom.date ? model.pricesFrom : model;
  return ((usage.input || 0) * prices.input + (usage.output || 0) * prices.output) / 1e6;
}
export function usageOf(data) {
  const u = data.usage || data.usageMetadata || {};
  return {input: u.input_tokens ?? u.promptTokenCount ?? 0, output: u.output_tokens ?? u.candidatesTokenCount ?? 0};
}
