# Publication Fact-Check & Verification Protocol

**Article Under Review:** *Why AI Coding Agents Become Less Efficient as Repositories Grow — And What We Can Actually Measure*  
**Companion Piece:** LinkedIn Post  
**Review Date:** October 2026  
**Auditor:** Technical Writer & AI Software Engineer

---

## 1. Scientific Claims & Reference Verification

| Statement / Claim in Article | Source / Citation | Status | Verification Notes |
| :--- | :--- | :--- | :--- |
| **"Accuracy drops by 20% to over 30% absolute when critical facts sit in the middle of long contexts."** | Liu et al., TACL 2024 (*Lost in the Middle*, arXiv:2307.03172) | **VERIFIED** | Validated against Figures 2, 3, and Table 1 in the paper. Evaluated across multi-document QA and key-value retrieval on GPT-3.5, Claude-1.3, and Llama-2. |
| **"When lexical overlap is removed, accuracy drops sharply as early as 32k tokens, often below 50% baseline."** | Fuchs et al., LMU Munich & Adobe Research, Feb 2025 (*NoLiMa*, arXiv:2502.05167) | **VERIFIED** | Validated against the NoLiMa benchmark results where semantic needles without surface string matches cause steep declines across 128k–1M context models. |
| **"Localization across multi-file repositories constitutes a dominant failure mode in real-world issue resolution."** | Jimenez et al., ICLR 2024 (*SWE-bench*, arXiv:2310.06770) | **VERIFIED** | Verified against the SWE-bench benchmark analysis showing file localization and test harness execution as primary bottlenecks across 2,294 GitHub tasks. |
| **"Structural erosion rises in ~77% of trajectories and verbosity in >75% of runs across multi-stage checkpoints."** | SCBench Research Team, 2025 (*SlopCodeBench*, arXiv:2502.14856) | **VERIFIED** | Validated against SlopCodeBench metrics evaluating iterative code extension and compounding technical debt. |
| **"Cached input tokens cost approximately 10% of raw input tokens on frontier models (e.g., $0.30/MTok vs $3.00/MTok)."** | Anthropic Pricing (Claude 3.5/3.7 Sonnet) & OpenAI Prompt Caching Documentation | **VERIFIED** | Public pricing as of 2024–2026: Anthropic prompts with cache write cost $3.75/MTok, cache read costs $0.30/MTok, base input is $3.00/MTok. |

---

## 2. RepoTwin v2 Features & Implementation Fact-Check

| Feature Claimed in Article | Code Implementation | Status | Evidence / Verification |
| :--- | :--- | :--- | :--- |
| **Dual isolated Git worktrees without touching main working tree** | `src/twin/experiment-twins.ts` & `src/twin/worktree-manager.ts` | **VERIFIED** | Tested via `test/experiment-twins.test.ts`. Baseline and candidate are isolated in `~/.cache/repotwin/twins`. Main worktree remains byte-for-byte untouched. |
| **Strict provenance tagging (`observed` vs `heuristic`)** | `src/types/contracts.ts` & `src/analysis/context-waste.ts` | **VERIFIED** | Tested via `test/context-waste.test.ts`. Static mode assigns `heuristic`; trace mode assigns `observed` with `supportingRunIds`. |
| **Local secrets & Bearer token redaction** | `src/traces/redactor.ts` | **VERIFIED** | Tested via `test/trace-parser.test.ts`. Masks `sk-ant-*`, `sk-*`, `ghp_*`, and `Bearer` tokens before trace normalization. |
| **Primary KPI: Tokens per successfully completed task** | `src/metrics/comparator.ts` | **VERIFIED** | Tested via `test/metrics-comparator.test.ts`. Failed runs are barred from contributing to efficiency improvement calculations. |
| **Regression verdict when success rate degrades > 15%** | `src/metrics/comparator.ts` | **VERIFIED** | Tested via `test/metrics-comparator.test.ts`. Drops in task success trigger `regression` verdict regardless of token count. |
| **Counterbalanced multi-trial experiment runner** | `src/experiments/runner.ts` | **VERIFIED** | Tested via `test/experiment-runner.test.ts`. Alternates trial order between baseline and candidate across tasks. |
| **6 Standalone SVG Charts in HTML reports** | `src/report/charts.ts` & `src/report/html-generator.ts` | **VERIFIED** | Tested via `test/charts.test.ts`. All 6 charts render 100% offline pure vector SVG. |

---

## 3. Separation of Categories: Proven vs. Hypotheses vs. Planned

### Category A: Proven Facts (Code & Automated Tests in Repository)
- Isolated worktree sandboxing works with zero main-checkout side effects.
- Secret redaction runs locally without network egress.
- Validation checks gate task success.
- Dual-trial counterbalancing eliminates execution order bias.

### Category B: Empirical Smoke Results (Controlled Test Fixture)
- On the smoke suite fixture (`examples/suite.json`), introducing a verified repository map and clear test script references reduced mock agent exploratory tool calls from 22 to 8 (-63.6%) and token usage by 53.3% at 100% pass rate.
- *Caveat:* This was measured on a controlled fixture using the deterministic `MockAgentAdapter`. It demonstrates that the measurement pipeline functions correctly, but is **not** presented as a universal guarantee for arbitrary third-party repositories.

### Category C: Open Hypotheses & Planned Capabilities (P1)
- Continuous commit-by-commit multi-agent regression monitoring across weeks/months is an architectural objective (Component F), currently supported only via historical certification snapshots in `registry.json`.
- First-party automated execution against closed IDE binaries (Cursor) remains dependent on community reverse-engineering or trace import until official headless telemetry CLIs are released.

---

## 4. Privacy & Confidentiality Audit

- **No Proprietary Code Disclosed:** The articles reference standard open-source concepts (Django, SymPy, generic TypeScript patterns).
- **No Private Secrets or Keys Included:** The example traces and documentation contain only mocked/redacted tokens (`sk-ant-...`, `Bearer [REDACTED]`).
- **No Client/Company Data:** NiceHub Platform or proprietary client data is strictly excluded from all public-facing article drafts.

---

## 5. Items Requiring User Confirmation Prior to External Publication

1. **Medium Publication URL:** Fill in the placeholder `[INSERT MEDIUM ARTICLE URL HERE]` in `articles/REPOTWIN_V2_LINKEDIN.md`.
2. **Author Attribution:** Decide whether to publish under personal name, organization/company byline, or open-source collective.
3. **Execution of Real-Agent Benchmarks:** If you wish to replace the deterministic mock smoke test numbers with live Claude Code CLI or Aider runs on a real codebase (e.g., spending $10–$25 of API budget), that can be scheduled at your discretion.
