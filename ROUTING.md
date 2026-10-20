<!-- subscription-worker-router:start -->
## DeltaRoute (Δ)

DeltaRoute hands bounded work to the user's other subscriptions (Codex, Gemini, Perplexity) so it does not spend the Claude limit. Claude is Chief: it plans, reviews and integrates. Delegate big chunks that can be checked with a test; keep small tasks and visual back-and-forth here.

- Roles go to the best available model: `model_registry` with action `roles`.
- Multi-step work runs as an Operation Plan: `create_workflow`, show the user the plan, `approve_plan` with their words, then `run_subagent` and `run_step`. Review scores each step 0-100 (80 passes; lower goes back with notes), then `simulated_review`, then `final_review` and the user's approval. Share the dashboard path.
- On `needs_coordinator`, finish the step here from the saved artifacts.
- No paid API fallback, permission bypass, publishing or recursive delegation. All browsing uses gstack.

Full rules: the `deltaroute` skill.
<!-- subscription-worker-router:end -->
