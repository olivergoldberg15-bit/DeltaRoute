/** Local policy only. No network calls, credential changes, or challenge solving. */
export function accountKey(provider) {
  return provider === 'grok' || provider === 'cursor' ? 'cursor' : provider;
}

const DEFAULT_COOLDOWNS = Object.freeze({
  auth: 30 * 60_000,
  challenge: 30 * 60_000,
  quota: 15 * 60_000,
  outage: 60_000,
  timeout: 30_000,
  capability: 0,
  source_incomplete: 0,
});

/** Honor relative retry hints, within a caller-configurable ceiling. */
export function failureCooldownMs(kind, error = '', overrides = {}) {
  const configured = overrides[kind];
  const base = Number.isFinite(configured) && configured >= 0
    ? configured : DEFAULT_COOLDOWNS[kind] || 0;
  if (!['quota', 'outage', 'timeout'].includes(kind)) return base;
  const text = String(error || '');
  const header = text.match(/retry-after\s*:\s*(\d+(?:\.\d+)?)(?:\s*(milliseconds?|ms|seconds?|s|minutes?|m|hours?|h))?\b/i);
  const relative = header || text.match(/(?:retry|try again|resets?)\s+(?:in|after)\s+(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|s|minutes?|m|hours?|h)\b/i);
  if (!relative) return base;
  const value = Number(relative[1]);
  const unit = (relative[2] || 'seconds').toLowerCase();
  const multiplier = /^(milliseconds?|ms)$/.test(unit) ? 1
    : /^(minutes?|m)$/.test(unit) ? 60_000
      : /^(hours?|h)$/.test(unit) ? 3_600_000 : 1000;
  const ceiling = Number.isFinite(overrides.maxMs) && overrides.maxMs >= 0
    ? overrides.maxMs : 24 * 60 * 60_000;
  return Math.min(ceiling, Math.max(base, value * multiplier));
}

/** retryable/fallbackEligible permit another provider, never a challenge bypass. */
export function classifyFailure(error, cooldowns = {}) {
  const text = typeof error === 'string' ? error : String(error?.message || error || '');
  let kind = 'unknown';
  // These are request constraints, not a reason to try a more permissive worker.
  if (/\bcancell?ed\b|\bcancellation\b|abort(?:ed)? by (?:the )?user/i.test(text)) kind = 'cancelled';
  else if (/\bsafety\b|\bcontent policy\b|\bpolicy (?:violation|restriction|denied)\b|\brefus(?:al|ed)\b|permission denied|access denied to (?:file|directory|path)|sandbox|outside (?:the )?(?:workspace|allowed)|destructive (?:operation|command)|clean Git checkout|commit or stash/i.test(text)) kind = 'safety';
  else if (/\b(?:invalid|malformed|missing|required) (?:task|cwd|mode|argument|parameter|request|directory|path)\b|cwd must|task must contain|invalid mode|research browser workers only|recursive delegation|no enabled installed worker|provider is (?:disabled|not enabled)|queue full/i.test(text)) kind = 'input';
  else if (/cloudflare|captcha|browser challenge|human verification|verify (?:that )?you (?:are|are a) human|blocked by x\.ai|access denied.*(?:x\.ai|grok)|cf[-_]ray|challenge[- ]platform/i.test(text)) kind = 'challenge';
  else if (/sign[ -]?(?:in|up)|log[ -]?in|log[ -]?out|logged out|not logged in|unauthenticated|authentication (?:required|failed|expired)|(?:expired|invalid|revoked) (?:session|login|credential|access token|refresh token)|(?:session|credentials?) (?:has |have )?expired|\b401\b|(?:HTTP|status|error)\s*403\b|403 Forbidden|requires .{0,50}(?:account|browser) login|run .{0,50}\blogin\b/i.test(text)) kind = 'auth';
  else if (/\bquota\b|rate[ -]?limit|too many requests|\b429\b|usage limit|hard limit|allowance (?:exhausted|reached|used)|free allowance|(?:insufficient|exhausted|out of) credits|credit balance|subscription limit|usage exhausted|budget limit|not enough credits|limit.{0,30}reset/i.test(text)) kind = 'quota';
  else if (/\btime[ -]?out\b|\btimed out\b|exceeded (?:the )?(?:time|deadline)|deadline exceeded|ETIMEDOUT|worker exceeded time limit/i.test(text)) kind = 'timeout';
  else if (/primary sources? missing|no original sources?|source(?:s| packet)? (?:is |are )?(?:incomplete|missing)|(?:missing|insufficient|no) citations|citation validation failed/i.test(text)) kind = 'source_incomplete';
  else if (/model.{0,50}(?:not found|unavailable|not available|not supported|unsupported|not enabled|does not exist)|(?:unknown|unsupported|invalid) model|started read-only despite a code assignment|unsupported (?:capability|feature)|does not support.{0,30}(?:model|feature|capability)|model_not_found|provider returned an empty answer|changed no files|expected files are missing|spawn .{0,100}ENOENT/i.test(text)) kind = 'capability';
  else if (/\b50[0234]\b|service unavailable|bad gateway|gateway error|internal server error|provider outage|temporarily unavailable|overloaded|connection (?:refused|reset|closed|failed)|network (?:error|unreachable|failed)|fetch failed|ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ENOTFOUND|stream disconnected|no such host|worker process exited unexpectedly/i.test(text)) kind = 'outage';
  const fallbackEligible = Object.hasOwn(DEFAULT_COOLDOWNS, kind);
  return {
    kind,
    retryable: fallbackEligible,
    fallbackEligible,
    blockAccount: ['auth', 'challenge', 'quota', 'outage'].includes(kind),
    cooldownMs: fallbackEligible ? failureCooldownMs(kind, text, cooldowns) : 0,
  };
}

const CODING = new Set(['implementation', 'quick_coding', 'iteration', 'debugging', 'tests', 'review', 'large_context', 'frontend']);
const CLI = new Set(['codex', 'gemini', 'cursor']);
const PROVIDERS = new Set(['codex', 'gemini', 'cursor', 'perplexity', 'grok', 'higgsfield']);
// Image jobs: Nano Banana Pro on the user's Higgsfield credits first, Codex's built-in image tool as the no-credit backup.
const IMAGE = new Set(['higgsfield', 'codex']);
const ORDERS = Object.freeze({
  image: ['higgsfield', 'codex'],
  video_analysis: ['codex'],
  implementation: ['codex', 'gemini', 'cursor'],
  quick_coding: ['gemini', 'codex', 'cursor'],
  iteration: ['gemini', 'codex', 'cursor'],
  debugging: ['codex', 'gemini', 'cursor'],
  tests: ['codex', 'gemini', 'cursor'],
  review: ['codex', 'gemini', 'cursor'],
  large_context: ['gemini', 'codex', 'cursor'],
  frontend: ['cursor', 'codex', 'gemini'],
  summarization: ['gemini', 'codex', 'cursor'],
  research: ['perplexity', 'codex', 'gemini', 'cursor', 'grok'],
  social_research: ['grok', 'perplexity', 'codex', 'gemini', 'cursor'],
});

/** Research CLI candidates require a separately collected, validated source packet. */
export function candidateProviders({requested = 'auto', category = 'implementation', mode = 'read-only', workers = [], blockedAccounts = [], attempted = []} = {}) {
  if (!['read-only', 'code', 'artifacts'].includes(mode)) return [];
  if ((mode === 'artifacts') !== (category === 'image')) return [];
  if (requested === 'claude' || (requested === 'auto' && ['simple', 'planning', 'creative'].includes(category))) return [];
  const definitions = Array.isArray(workers) ? workers
    : Object.entries(workers || {}).map(([name, value]) => ({...value, name}));
  const blocked = new Set([...blockedAccounts].map(value => accountKey(typeof value === 'string' ? value : value?.account || value?.provider)));
  const previous = new Set([...attempted].map(value => typeof value === 'string' ? value : value?.provider));
  const order = [...new Set([...(requested !== 'auto' ? [requested] : []), ...(ORDERS[category] || ORDERS.implementation)])];
  return order.filter(name => {
    const worker = definitions.find(value => value.name === name);
    if (!worker?.enabled || worker.installed === false || worker.availableNow === false) return false;
    if (previous.has(name) || blocked.has(accountKey(name))) return false;
    if(category==='video_analysis'&&name!=='codex')return false;
    // Credits are spent only on image jobs, never as a fallback for anything else.
    if (category === 'image' ? !IMAGE.has(name) || worker.capabilities?.image === false : name === 'higgsfield') return false;
    if ((mode === 'code' || CODING.has(category)) && !CLI.has(name)) return false;
    return PROVIDERS.has(name);
  });
}
