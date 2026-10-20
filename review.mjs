/**
 * Review pipeline helpers. The log self-check is a cheap first pass over a worker's own answer
 * and log tails before Review scores anything. It catches obvious misses only; Review still
 * scores the result 0-100 against the approved plan, and 80 is the bar.
 */
export const PASS_SCORE = 80;

const ADMITS_INCOMPLETE = /\b(?:could not|couldn't|unable to|was not able to|did not|didn't) (?:complete|finish|implement|run|build|make|verify)\b|\bBLOCKER\b|\bnot (?:yet )?implemented\b/i;
const PLACEHOLDER = /\bTODO\b|\bFIXME\b|\bplaceholder\b/i;
// Logs often contain an early failure the worker later fixed, so log hits are warnings for Review to weigh.
const LOG_PATTERNS = [
  ['traceback', /Traceback \(most recent call last\)/g],
  ['crash', /Segmentation fault|segfault|core dumped|fatal error/gi],
  ['test_failure', /\b\d+ (?:failed|failing)\b|\bFAILED\b|^not ok \d+/gm],
  ['js_error', /\b(?:SyntaxError|ReferenceError|TypeError|RangeError):/g],
  ['npm_error', /npm ERR!/g],
  ['permission', /permission denied|access is denied|EACCES|EPERM/gi],
  ['missing', /ENOENT|No such file or directory|command not found|is not recognized as an internal or external command/gi],
];

const excerpt = (text, index) => text.slice(Math.max(0, index - 60), index + 140).replace(/\s+/g, ' ').trim();

export function selfCheckLogs({answer = '', stdout = '', stderr = ''} = {}) {
  const findings = [];
  const said = String(answer);
  if (!said.trim()) findings.push({severity: 'blocking', kind: 'empty_answer', detail: 'The worker returned no answer.'});
  const admits = said.match(ADMITS_INCOMPLETE);
  if (admits) findings.push({severity: 'blocking', kind: 'admitted_incomplete', detail: excerpt(said, admits.index)});
  const placeholder = said.match(PLACEHOLDER);
  if (placeholder) findings.push({severity: 'warning', kind: 'placeholder', detail: excerpt(said, placeholder.index)});
  const logs = String(stderr).slice(-20000) + '\n' + String(stdout).slice(-40000);
  for (const [kind, pattern] of LOG_PATTERNS) {
    const hits = [...logs.matchAll(pattern)];
    if (hits.length) findings.push({severity: 'warning', kind, count: hits.length, detail: excerpt(logs, hits.at(-1).index)});
  }
  return {
    passed: !findings.some(f => f.severity === 'blocking'),
    findings: findings.slice(0, 8),
    scope: 'Pattern scan of the worker answer and log tails. Catches obvious misses only; not a correctness proof.',
  };
}
