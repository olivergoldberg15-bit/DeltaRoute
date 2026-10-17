# Verification and historical measurements

The public test suite uses local fixtures and fake provider processes. It does not sign in, contact a model, consume a subscription allowance, or use paid APIs. Historical live measurements are separately labeled below; their raw account artifacts are deliberately excluded from this repository.

Local public-distribution verification on October 17, 2026 passed **195/195 core tests**, **3/3 MCP client fixtures**, **5/5 installer policy fixtures**, and **10/10 Windows fault scenarios**. The full core suite passed from a clean Git clone, including both path-case regressions. Setup, repeated setup preservation, local MCP discovery and the doctor also passed without provider calls or global host changes. See [verification.json](verification.json) for the exact scope; [hosted Windows/Linux CI passed for the v1.5.0 release](https://github.com/olivergoldberg15-bit/DeltaRoute/actions/runs/39061477502).

## Run the offline tests

From the repository root, with Node.js 22 or newer and Git installed:

```sh
npm test
node --test benchmarks/mcp-client.test.mjs
```

The core suite exercises routing, native counter parsing, source validation, media-cache behavior, workflow scope and checkpoint gates, coordinator quota waiting, termination checks, concurrent state updates, and MCP stdio. It needs no provider installation or `config.json`. Subprocess checks use an isolated runtime with disabled fixture workers. Bundled skills are hash-checked; unlicensed optional upstream skills are not required for a clean checkout to pass.

With Python 3.11 or newer:

```sh
python benchmarks/installer-policy-tests.py
```

These policy fixtures use explicit temporary configuration paths and fake homes. They check existing-server conflicts, narrowing an allowed tool surface, preservation of explicit denies, and opt-in managed-head permissions. They never edit the real user configuration.

On Windows, with Git and the .NET Framework C# compiler available:

```sh
node benchmarks/provider-fallback-process-tests.mjs
```

This compiles fake local CLI executables and runs ten actual router/process/Git scenarios: expired login, outage, quota, clean fallback worktrees, cancellation, hung authentication, model timeout with partial counters, all workers exhausted, workflow dependency review, and scope drift. No real provider executable is called. The test exits with a clear skip on other platforms; this does not validate Linux process-tree termination. The C# compiler is resolved under the current Windows installation directory.

Each run writes only a sanitized aggregate to `windows-fault-results.json`: scenario names, pass/fail, elapsed time and totals. Detailed fixture files stay in the operating system's temporary directory and are removed by default. Use `--keep-fixtures` for local debugging, or pass a scenario-name substring to run one case. Do not publish temporary diagnostics without reviewing them.

Fixtures normally use the OS temporary directory. If a host sandbox restricts that directory, set `DELTAROUTE_TEST_TMP` to a writable scratch directory. For example, in PowerShell:

```powershell
$env:DELTAROUTE_TEST_TMP = Join-Path $PWD 'work/test-fixtures'
New-Item -ItemType Directory -Force $env:DELTAROUTE_TEST_TMP | Out-Null
npm test
```

GitHub Actions is configured for core tests on Windows and Linux with Node 22 and 24, plus Windows subprocess faults and Python installer policy fixtures. The workflow uploads only the sanitized fault aggregate. The released v1.5.0 commit passed all five hosted jobs; the workflow badge shows subsequent branch status.

## Historical token and latency observations

Measured October 17, 2026 on one Windows subscription setup. These small, nonrandomized fixtures are observations, not current provider pricing, promised savings, or a cross-model quality ranking. Machine-readable aggregates are in [historical-measurements.json](historical-measurements.json). Account data, local paths, prompts, full answers, raw CLI logs and session identifiers are withheld.

| Fixture | Observed result | Interpretation |
|---|---|---|
| Matched synthetic log-count task | 89,908 → 9,489 Claude input tokens; both answers correct | 89.4% lower logical input on this task |
| Local output filtering | 201,109 → 368 bytes | 99.82% lower returned payload; bytes are not tokens |
| Same-session continuation | 89,906 of 92,791 input tokens cached: 96.9% | One session continuation |
| Fresh-session repeat | 2,256 of 89,908 input tokens cached: 2.5% | One new-session repeat |
| Tiny code-review task | 8,955 direct vs 151,109 routed coordinator input tokens | Worker usage is additional; tiny tasks should usually stay local |

Claude logical input includes fresh input, cache writes and cache reads. Cached reads remain input and may have different quota or billing treatment. These numbers do not establish a reduction in a fixed subscription invoice, monthly account savings, or extra chats per month.

One historical representative check per provider reported:

| Worker | Logical input | Cached subset | Output | Elapsed |
|---|---:|---:|---:|---:|
| Codex | 94,924 | 82,304 | 546 | 48.3 s |
| Gemini | 11,977 | 0 | 841 | 14.3 s |
| Cursor | 26,151 | 5,248 | 544 | 110.7 s |
| Grok through Cursor | 26,345 | 5,248 | 336 | 141.7 s |

These were different native CLI transports and startup conditions, so elapsed time is not a controlled model speed comparison. The Grok row received a research sign-up gate before the source-validation fix; it is not evidence of successful research or native live X access. Browser token counters were unavailable and remain unknown.

A later single managed-head integration fixture completed in **40.252 seconds**. Its Codex head reported 141,922 input tokens, including 122,496 cached reads, and 644 output tokens. Its Gemini worker separately reported 18,806 input tokens, zero cached reads, and 142 output tokens. It completed one read-only marker/checkpoint task while leaving the original checkout unchanged. This establishes the integration path worked on that fixture; it does not measure heavy-coding throughput, long-project drift, or general cost savings.

## What the evidence does not establish

- Fake-provider fault tests exercise orchestration and process control; they do not reproduce every real provider outage or account policy.
- The suite validates mechanics around a saved plan. Semantic correctness, creative quality, and adherence to the user's intent still need coordinator review and actual artifact checks.
- Renderer skills do not install a renderer or prove photorealism. Video-frame tests do not establish full continuous playback or unavailable audio.
- Historical gains are task-specific. No universal quality percentage, monthly cash-saving percentage, or guarantee of never failing is claimed.
