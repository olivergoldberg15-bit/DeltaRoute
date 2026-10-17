# Specialist library: 31 bundled, six optional

Read only the entries needed for the active task. Six Remotion entries are optional and absent from the public checkout; see `__DELTAROUTE_ROOT__/THIRD_PARTY_NOTICES.md` before downloading them. Runtime routing selects only present, hash-verified entry points. Bodies remain in the central library; scripts are not executed by installation or selection.

## blender/animation

Game-ready animation in Blender including walk/run/idle cycles, combat, mechanical animation, camera animation, constraints, Graph Editor, and NLA workflows via MCP.

Path: `__DELTAROUTE_ROOT__/skill-library/blender/animation/SKILL.md`

Source: https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52/.claude/skills/animation

## blender/asset-optimization

Validates and optimizes Blender assets for polycount, topology, UV efficiency, material count, naming, collections, and game-ready performance. Use before export on all production assets via MCP.

Path: `__DELTAROUTE_ROOT__/skill-library/blender/asset-optimization/SKILL.md`

Source: https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52/.claude/skills/asset-optimization

## blender/blender-director

Use when starting any Blender asset task, planning a production pipeline, coordinating multiple disciplines, or matching a reference photo/concept art. Invoke for game-ready assets, hard surface, environment, character, creature, export, or any multi-skill Blender workflow.

Path: `__DELTAROUTE_ROOT__/skill-library/blender/blender-director/SKILL.md`

Source: https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52/.claude/skills/blender-director

## blender/camera-cinematography

Cinematic camera work in Blender including framing, lenses, composition, camera animation, and shot language beyond basic rendering setup via MCP.

Path: `__DELTAROUTE_ROOT__/skill-library/blender/camera-cinematography/SKILL.md`

Source: https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52/.claude/skills/camera-cinematography

## blender/lighting

Cinematic and game lighting in Blender including three-point lighting, HDRI, horror lighting, volumetrics, rim lighting, and mood-driven illumination. Use for look development and scene atmosphere via MCP.

Path: `__DELTAROUTE_ROOT__/skill-library/blender/lighting/SKILL.md`

Source: https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52/.claude/skills/lighting

## blender/lookdev

Look development loop for Blender assets combining materials, lighting, camera, and screenshot comparison until shading reads correctly via MCP.

Path: `__DELTAROUTE_ROOT__/skill-library/blender/lookdev/SKILL.md`

Source: https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52/.claude/skills/lookdev

## blender/materials

Blender PBR and stylized material creation for metal, wood, concrete, fabric, glass, dirt, rust, and procedural shaders. Use for look development, material reuse, and production shading in Blender via MCP.

Path: `__DELTAROUTE_ROOT__/skill-library/blender/materials/SKILL.md`

Source: https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52/.claude/skills/materials

## blender/qa-review

Production QA gate for Blender assets using viewport screenshots, validation checklists, naming audits, and ship/no-ship verdicts via MCP.

Path: `__DELTAROUTE_ROOT__/skill-library/blender/qa-review/SKILL.md`

Source: https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52/.claude/skills/qa-review

## blender/realistic-style

Photorealistic AAA art direction for Blender including photogrammetry cleanup, real-world scale, high-poly workflows, PBR accuracy, and scan optimization. Use for cinematic and AAA game realism.

Path: `__DELTAROUTE_ROOT__/skill-library/blender/realistic-style/SKILL.md`

Source: https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52/.claude/skills/realistic-style

## blender/rendering

Blender rendering with Cycles and Eevee including sampling, denoising, camera setup, render passes, color management, and render optimization. Use for final output and look validation via MCP.

Path: `__DELTAROUTE_ROOT__/skill-library/blender/rendering/SKILL.md`

Source: https://github.com/arjun988/blender-skills/tree/8f778d2405a214b508d4c7d80742be8e43acdd52/.claude/skills/rendering

## context/advanced-evaluation

This skill should be used for advanced LLM evaluation: LLM-as-judge systems, direct scoring, pairwise comparison, rubric calibration, evaluator bias mitigation, confidence scoring, and automated quality assessment.

Path: `__DELTAROUTE_ROOT__/skill-library/context/advanced-evaluation/SKILL.md`

Source: https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/9ff0c99108b36d3b886defd825d8ac1f47dba374/skills/advanced-evaluation

## context/context-compression

This skill should be used when long-running agent sessions need context compression, structured summarization, compaction, token-per-task optimization, or durable handoff summaries that preserve decisions, files, risks, and next actions.

Path: `__DELTAROUTE_ROOT__/skill-library/context/context-compression/SKILL.md`

Source: https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/9ff0c99108b36d3b886defd825d8ac1f47dba374/skills/context-compression

## context/context-degradation

This skill should be used for diagnosing and mitigating context degradation: lost-in-middle failures, context poisoning, context clash, context confusion, attention-pattern issues, and agent performance degradation caused by accumulated or conflicting context.

Path: `__DELTAROUTE_ROOT__/skill-library/context/context-degradation/SKILL.md`

Source: https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/9ff0c99108b36d3b886defd825d8ac1f47dba374/skills/context-degradation

## context/context-fundamentals

This skill should be used to explain or reason about the foundational concepts of context engineering: what context is, the anatomy of a context window, how attention mechanics work, the U-shaped attention curve, why context quality matters more than quantity, and the mental models needed to interpret every other context-engineering decision. Use this for conceptual explanation, onboarding, and background reading. Route operational work to the specialized skills: debugging attention failures goes to context-degradation, token-efficiency work goes to context-optimization, conversation summarization goes to context-compression, and project-shape decisions go to project-development.

Path: `__DELTAROUTE_ROOT__/skill-library/context/context-fundamentals/SKILL.md`

Source: https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/9ff0c99108b36d3b886defd825d8ac1f47dba374/skills/context-fundamentals

## context/context-optimization

This skill should be used for improving context efficiency: context budgeting, observation masking, prefix or KV-cache strategy, partitioning, token-cost reduction, retrieval scoping, and extending effective context capacity without lowering answer quality.

Path: `__DELTAROUTE_ROOT__/skill-library/context/context-optimization/SKILL.md`

Source: https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/9ff0c99108b36d3b886defd825d8ac1f47dba374/skills/context-optimization

## context/evaluation

This skill should be used when building agent evaluation systems: deterministic checks, regression suites, multi-dimensional rubrics, quality gates, production monitoring, baseline comparison, and outcome measurement for agent pipelines.

Path: `__DELTAROUTE_ROOT__/skill-library/context/evaluation/SKILL.md`

Source: https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/9ff0c99108b36d3b886defd825d8ac1f47dba374/skills/evaluation

## context/filesystem-context

This skill should be used when agent work needs file-backed context: durable scratchpads, tool-output offloading, just-in-time discovery, cross-agent handoff files, filesystem memory, or cleanup policies for context stored outside the prompt.

Path: `__DELTAROUTE_ROOT__/skill-library/context/filesystem-context/SKILL.md`

Source: https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/9ff0c99108b36d3b886defd825d8ac1f47dba374/skills/filesystem-context

## creative/algorithmic-art

Creating algorithmic art using p5.js with seeded randomness and interactive parameter exploration. Use this when users request creating art using code, generative art, algorithmic art, flow fields, or particle systems. Create original algorithmic art rather than copying existing artists' work to avoid copyright violations.

Path: `__DELTAROUTE_ROOT__/skill-library/creative/algorithmic-art/SKILL.md`

Source: https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/algorithmic-art

## creative/frontend-design

Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Helps with aesthetic direction, typography, and making choices that don't read as templated defaults.

Path: `__DELTAROUTE_ROOT__/skill-library/creative/frontend-design/SKILL.md`

Source: https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design

## media/watch

Watch a video (URL or local path). Downloads with yt-dlp, extracts auto-scaled frames with ffmpeg, pulls the transcript from captions (or local WhisperX / cloud Whisper fallback), and hands the result to the agent so it can answer questions about what's in the video. With a Gemini API key, Google's agentic video model watches the full video instead.

Path: `__DELTAROUTE_ROOT__/skill-library/media/watch/SKILL.md`

Source: https://github.com/bradautomates/claude-video/tree/main/skills/watch

## remotion/remotion-best-practices

Optional upstream collection; not bundled. The path below exists only after an explicit authorized local download.

Router for all Remotion skills

Path: `__DELTAROUTE_ROOT__/skill-library/remotion/remotion-best-practices/SKILL.md`

Source: https://github.com/remotion-dev/skills/tree/1441a11e95db35443bd76bb318386c0d3ca00053/skills/remotion-best-practices

## remotion/remotion-captions

Optional upstream collection; not bundled. The path below exists only after an explicit authorized local download.

Transcribing, displaying and animating captions

Path: `__DELTAROUTE_ROOT__/skill-library/remotion/remotion-captions/SKILL.md`

Source: https://github.com/remotion-dev/skills/tree/1441a11e95db35443bd76bb318386c0d3ca00053/skills/remotion-captions

## remotion/remotion-interactivity

Optional upstream collection; not bundled. The path below exists only after an explicit authorized local download.

Structure Remotion markup for interactivity

Path: `__DELTAROUTE_ROOT__/skill-library/remotion/remotion-interactivity/SKILL.md`

Source: https://github.com/remotion-dev/skills/tree/1441a11e95db35443bd76bb318386c0d3ca00053/skills/remotion-interactivity

## remotion/remotion-markup

Optional upstream collection; not bundled. The path below exists only after an explicit authorized local download.

Content, animation and effects best practices

Path: `__DELTAROUTE_ROOT__/skill-library/remotion/remotion-markup/SKILL.md`

Source: https://github.com/remotion-dev/skills/tree/1441a11e95db35443bd76bb318386c0d3ca00053/skills/remotion-markup

## remotion/remotion-multimedia

Optional upstream collection; not bundled. The path below exists only after an explicit authorized local download.

Interacting with Mediabunny

Path: `__DELTAROUTE_ROOT__/skill-library/remotion/remotion-multimedia/SKILL.md`

Source: https://github.com/remotion-dev/skills/tree/1441a11e95db35443bd76bb318386c0d3ca00053/skills/remotion-multimedia

## remotion/remotion-render

Optional upstream collection; not bundled. The path below exists only after an explicit authorized local download.

Export a Remotion video

Path: `__DELTAROUTE_ROOT__/skill-library/remotion/remotion-render/SKILL.md`

Source: https://github.com/remotion-dev/skills/tree/1441a11e95db35443bd76bb318386c0d3ca00053/skills/remotion-render

## threejs/threejs-animation

Three.js animation - keyframe animation, skeletal animation, morph targets, animation mixing. Use when animating objects, playing GLTF animations, creating procedural motion, or blending animations.

Path: `__DELTAROUTE_ROOT__/skill-library/threejs/threejs-animation/SKILL.md`

Source: https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823/skills/threejs-animation

## threejs/threejs-fundamentals

Three.js scene setup, cameras, renderer, Object3D hierarchy, coordinate systems. Use when setting up 3D scenes, creating cameras, configuring renderers, managing object hierarchies, or working with transforms.

Path: `__DELTAROUTE_ROOT__/skill-library/threejs/threejs-fundamentals/SKILL.md`

Source: https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823/skills/threejs-fundamentals

## threejs/threejs-geometry

Three.js geometry creation - built-in shapes, BufferGeometry, custom geometry, instancing. Use when creating 3D shapes, working with vertices, building custom meshes, or optimizing with instanced rendering.

Path: `__DELTAROUTE_ROOT__/skill-library/threejs/threejs-geometry/SKILL.md`

Source: https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823/skills/threejs-geometry

## threejs/threejs-interaction

Three.js interaction - raycasting, controls, mouse/touch input, object selection. Use when handling user input, implementing click detection, adding camera controls, or creating interactive 3D experiences.

Path: `__DELTAROUTE_ROOT__/skill-library/threejs/threejs-interaction/SKILL.md`

Source: https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823/skills/threejs-interaction

## threejs/threejs-lighting

Three.js lighting - light types, shadows, environment lighting. Use when adding lights, configuring shadows, setting up IBL, or optimizing lighting performance.

Path: `__DELTAROUTE_ROOT__/skill-library/threejs/threejs-lighting/SKILL.md`

Source: https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823/skills/threejs-lighting

## threejs/threejs-loaders

Three.js asset loading - GLTF, textures, images, models, async patterns. Use when loading 3D models, textures, HDR environments, or managing loading progress.

Path: `__DELTAROUTE_ROOT__/skill-library/threejs/threejs-loaders/SKILL.md`

Source: https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823/skills/threejs-loaders

## threejs/threejs-materials

Three.js materials - PBR, basic, phong, shader materials, material properties. Use when styling meshes, working with textures, creating custom shaders, or optimizing material performance.

Path: `__DELTAROUTE_ROOT__/skill-library/threejs/threejs-materials/SKILL.md`

Source: https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823/skills/threejs-materials

## threejs/threejs-postprocessing

Three.js post-processing - EffectComposer, bloom, DOF, screen effects. Use when adding visual effects, color grading, blur, glow, or creating custom screen-space shaders.

Path: `__DELTAROUTE_ROOT__/skill-library/threejs/threejs-postprocessing/SKILL.md`

Source: https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823/skills/threejs-postprocessing

## threejs/threejs-shaders

Three.js shaders - GLSL, ShaderMaterial, uniforms, custom effects. Use when creating custom visual effects, modifying vertices, writing fragment shaders, or extending built-in materials.

Path: `__DELTAROUTE_ROOT__/skill-library/threejs/threejs-shaders/SKILL.md`

Source: https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823/skills/threejs-shaders

## threejs/threejs-textures

Three.js textures - texture types, UV mapping, environment maps, texture settings. Use when working with images, UV coordinates, cubemaps, HDR environments, or texture optimization.

Path: `__DELTAROUTE_ROOT__/skill-library/threejs/threejs-textures/SKILL.md`

Source: https://github.com/CloudAI-X/threejs-skills/tree/b1c623076c661fc9b03dac19292e825a5d106823/skills/threejs-textures

## verification/verification-before-completion

Use when about to claim work is complete, fixed, or passing, before committing or creating PRs - requires running verification commands and confirming output before making any success claims; evidence before assertions always

Path: `__DELTAROUTE_ROOT__/skill-library/verification/verification-before-completion/SKILL.md`

Source: https://github.com/obra/superpowers/tree/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/verification-before-completion
