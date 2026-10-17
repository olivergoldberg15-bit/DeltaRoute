# Third-party skill provenance and licenses

DeltaRoute's original router and setup code use the repository's root license. Third-party skill instructions and their supporting files retain the licenses and attribution below. No upstream project endorses DeltaRoute. A skill file is guidance; it does not install Blender, Remotion, yt-dlp, FFmpeg, a model, an account subscription, or a rendering service.

The public checkout bundles **31 skills** from six upstream projects. Its catalog also lists **six optional Remotion skills** whose content is not redistributed. `skills-manifest.json` records each exact commit, file SHA-256, upstream Git blob, license classification, distribution status, and the local watch adapter modification. Scripts, hooks, dependency installers, and model calls are never executed by the skill installer.

| Family | Selected skills | Upstream and pinned revision | License and retained notice |
| --- | ---: | --- | --- |
| Blender | 10 | [arjun988/blender-skills](https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52) | MIT; original [LICENSE](skill-library/blender/LICENSE), copyright 2026 blender-skills contributors. Shared references are retained. |
| Context engineering | 7 | [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/9ff0c99108b36d3b886defd825d8ac1f47dba374) | MIT; original [LICENSE](skill-library/context/LICENSE), copyright 2025 Context Engineering Agent Skills Contributors. |
| Creative | 2 | [anthropics/skills](https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44) | Apache-2.0; original [algorithmic-art license](skill-library/creative/algorithmic-art/LICENSE.txt), [frontend-design license](skill-library/creative/frontend-design/LICENSE.txt), and upstream [THIRD_PARTY_NOTICES.md](skill-library/creative/THIRD_PARTY_NOTICES.md), retained without edits. The upstream notices cover a wider product; their inclusion does not mean those binaries or dependencies are bundled here. |
| Video viewing | 1 | [bradautomates/claude-video](https://github.com/bradautomates/claude-video/tree/03ceb42f7fa2c4439aca01752118044baabffb8f/skills/watch), skill version 0.3.2 | MIT; original [LICENSE](skill-library/media/LICENSE), copyright 2026 Bradley Bonanno. The upstream entry point matches the manifest hash. `watch/scripts/download.py` carries a prominent DeltaRoute modification notice and is recorded separately in `localPatches`. |
| Three.js | 10 | [CloudAI-X/threejs-skills](https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823) | Upstream explicitly declares MIT in its README. There is no standalone upstream LICENSE file at this revision. The complete original [UPSTREAM_README.md](skill-library/threejs/UPSTREAM_README.md), including that grant, is retained. |
| Verification | 1 | [obra/superpowers](https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3) | MIT; original [LICENSE](skill-library/verification/LICENSE), copyright 2025 Jesse Vincent. Only the selected verification skill is included; its parent orchestration system and hooks are not installed. |
| Remotion, optional | 6 | [remotion-dev/skills](https://github.com/remotion-dev/skills/tree/1441a11e95db35443bd76bb318386c0d3ca00053) | `NOASSERTION`: the pinned recursive tree, README, and package.json contain no license declaration. These instructions and references are **not bundled**. Remotion software and commercial rendering have their own terms, independent of this catalog. |

Inspect the catalog and verify the public bundle without network access:

```sh
node install-skills.mjs --list
node install-skills.mjs --verify
```

Licensed skills are already present in this checkout; normal setup does not download optional skills. For a local use for which you have the necessary rights, an explicit Remotion source download is available:

```sh
node install-skills.mjs --family remotion --acknowledge-unlicensed --dry-run
node install-skills.mjs --family remotion --acknowledge-unlicensed
node install-skills.mjs --verify
```

The acknowledgment records a deliberate command choice; it does not grant a copyright license, imply permission for redistribution, or make Remotion services free. Optional downloaded content must not be included in a public DeltaRoute release without an appropriate upstream license or permission. See `.gitignore` for the optional directory exclusion.

The downloader uses only `raw.githubusercontent.com` URLs containing the exact 40-character commit, checks pinned byte lengths and SHA-256 values before committing each file, preserves existing edits, and writes skill entry points after reference downloads. It does not invoke Git hooks, a shell, npm, Python, a browser, or an upstream script. `--all` still requires the same explicit acknowledgment before any optional unlicensed download. A failed/interrupted download can be resumed with the same command; altered local files require manual review.

The watch adapter's changes isolate per-run downloads, bound caption retrieval, validate local/URL input handling, and pass `--ignore-config` to yt-dlp. No captions, private videos, browser cookies, credentials, generated media, or account state are included in this package. Runtime downloading, frame inspection and optional transcription remain separate actions governed by the user's permissions and tool availability.

Maintainers can re-audit a prepared local library with `node scripts/package-skills.mjs --source <library-root>`. This explicit maintenance command reads GitHub metadata through `gh`, verifies upstream Git blobs, retains original notices and writes the public manifest; it does not execute skill code.
