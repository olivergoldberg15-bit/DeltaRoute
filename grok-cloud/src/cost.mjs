export function tokenCost(model, usage, now = new Date()) {
  const prices = model.pricesFrom && now.toISOString().slice(0, 10) >= model.pricesFrom.date ? model.pricesFrom : model;
  return ((usage.input || 0) * prices.input + (usage.output || 0) * prices.output) / 1e6;
}
// Unreported tool usage is charged at the spec's estimate so the spend cap never under-counts.
export function toolCost(prices, toolUsage = {}, tools = []) {
  const used = type => tools.some(t => t.type === type);
  const xPosts = toolUsage.x_search ?? (used('x_search') ? prices.assumedXSearchPosts : 0);
  const webCalls = toolUsage.web_search ?? (used('web_search') ? prices.assumedWebSearchCalls : 0);
  return Number(xPosts || 0) * prices.xSearchPost + Number(webCalls || 0) * prices.webSearchCall;
}
export function usageOf(data) {
  const u = data.usage || data.usageMetadata || {};
  return {input: u.input_tokens ?? u.promptTokenCount ?? 0, output: u.output_tokens ?? u.candidatesTokenCount ?? 0};
}
