<!-- subscription-worker-router:start -->
## DeltaRoute (Δ)

Claude does most of the work. DeltaRoute hands off only what another model is clearly better at, judged by a registry that a weekly benchmark check keeps current: live research to Perplexity, Grok and Muse; images and video to Nano Banana Pro, ChatGPT, Grok Imagine, Seedance or Veo with `generate_media`; code only when a worker leads Claude on benchmarks. `recommend_route` says who; auto delegation of work Claude keeps is refused.

- Workers share a team board and can ask any AI for help. Grok monitors check running workers and a cheap Gemini Flash pass screens rendered stills, so don't poll or re-check running work: review once at the end from the monitor notes, the stills and the patch.
- Creative phases: a light plan (`create_workflow` with `workflow.mode: "light"` and the user's go-ahead) and `revise_plan` for edits. Big builds: a full Operation Plan, scored review (80 passes), simulated review, then final review and the user's approval.
- Code comes back as a patch: `apply_patch`, then commit, then `checkpoint` with `integrated_from` so only that step is audited.
- No paid API fallback, credential use or publishing. Workers reach other AIs only through the board. All browsing uses gstack.

Full rules: the `deltaroute` skill.
<!-- subscription-worker-router:end -->
