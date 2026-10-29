export function checkFormat(text, {author, allowLinks = false, language, expectedLanguage} = {}) {
  const reasons = [];
  if (typeof text !== 'string' || !text.trim()) return ['empty'];
  if ([...text].length >= 550) reasons.push('length');
  // Markdown syntax only: a bare # (#1, hashtags) or _ (handles) is plain text.
  if (/\*\*|__|`|^\s{0,3}#{1,6}\s|^\s*(?:[-+*•]|\d+[.)])\s|\[[^\]]*\]\([^)]*\)/m.test(text)) reasons.push('markdown');
  if (author && new RegExp(`@${author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) reasons.push('author_tag');
  if (!allowLinks && /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|org|net|io|co|ai|edu|gov)\b)/i.test(text)) reasons.push('links');
  // Self-reference only: a reply may discuss Grok or GPT, but never claim to be one.
  if (/\b(?:I(?:'m| am)|as)\s+(?:an?\s+)?@?(?:grok|claude|chatgpt|gpt[\w.-]*|gemini|AI(?:\s+(?:model|assistant))?|(?:large\s+)?language model)\b/i.test(text) || /\b(?:built|made|trained|created|developed|powered)\s+by\s+(?:xai|x\.ai|anthropic|openai|google)\b/i.test(text)) reasons.push('model_reference');
  if (language && expectedLanguage && language.toLowerCase().split('-')[0] !== expectedLanguage.toLowerCase().split('-')[0]) reasons.push('language');
  // Script mismatches are independently detectable; dialect/semantic fidelity
  // still require the judge (plain text has no reliable language metadata).
  if (expectedLanguage && /^(en|es|fr|de|pt|it)(-|$)/i.test(expectedLanguage) && /[\u0400-\u04ff\u4e00-\u9fff\u0600-\u06ff]/u.test(text)) reasons.push('language');
  return [...new Set(reasons)];
}
