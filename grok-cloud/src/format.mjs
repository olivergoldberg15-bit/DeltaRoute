// X counts most Latin, Greek and Cyrillic characters as 1 and everything else (CJK, emoji) as 2; a link counts 23.
export function xLength(text) {
  const light = c => c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037);
  const links = String(text).match(/https?:\/\/\S+/g) || [];
  return links.length * 23 + [...String(text).replace(/https?:\/\/\S+/g, '')].reduce((n, ch) => n + (light(ch.codePointAt(0)) ? 1 : 2), 0);
}
// Real @grok replies run 150-500 characters (median ~330 in an Oct 2026 sample), which needs X Premium on the bot
// account. A standard account can post at most 280, so that is the limit unless X_PREMIUM=1.
export const replyLimit = (env = {}) => env.X_PREMIUM === '1' ? 549 : 280;
export function checkFormat(text, {author, allowLinks = false, language, expectedLanguage, maxLength = 549} = {}) {
  const reasons = [];
  if (typeof text !== 'string' || !text.trim()) return ['empty'];
  if (xLength(text) > maxLength) reasons.push('length');
  // Markdown syntax only: a bare # (#1, hashtags) or _ (handles) is plain text. Plain numbered lines are allowed:
  // @grok uses them for multi-part answers and X shows them as written.
  if (/\*\*|__|`|^\s{0,3}#{1,6}\s|^\s*[-+*•]\s|\[[^\]]*\]\([^)]*\)/m.test(text)) reasons.push('markdown');
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
