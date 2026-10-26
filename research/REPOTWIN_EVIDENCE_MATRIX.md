# RepoTwin v2 Evidence Matrix: Scientific Problems vs. Implementation Reality

**Date:** October 2026  
**Version:** 2.0 (Post RFC-002 Implementation)  
**Methodological Standard:** Falsifiable, evidence-backed claims only. Planned features are explicitly distinguished from operational code.

---

## 1. Traceability Matrix

| Problem Identified in Research | Scientific Reference | RepoTwin Module (Source Code) | Implementation Status | Empirical Evidence Available |
| :--- | :--- | :--- | :--- | :--- |
| **Context Pollution & Duplicate Instruction Drift**<br>Agents receive contradictory rules or bloated guidelines, pushing instructions into middle-context blind spots. | *Lost in the Middle* (Liu et al., 2024)<br>*NoLiMa* (Fuchs et al., 2025) | `src/analysis/inspector.ts`<br>`src/analyzer/rules-scanner.ts`<br>`src/analyzer/instruction-consistency.ts` | **Operational** | Flags rules >50KB, duplicate base filenames across scopes, and contradictory instructions. Classifies findings as `evidenceKind: 'heuristic'` without claiming token savings. |
| **Repeated File Reads & Navigation Churn**<br>Agents repeatedly re-read the same files and make 20+ tool calls before locating targets. | *SWE-bench* (Jimenez et al., 2024)<br>*NoLiMa* (Fuchs et al., 2025) | `src/analysis/context-waste.ts`<br>`src/traces/trace-parser.ts` | **Operational** (Observed mode) | Parses normalized `AgentRun` traces. Flags files read ≥4 times across runs (`observed/repeated-file-reads`) and tool call churn >40 calls with exact `supportingRunIds`. |
| **Accidental Main Branch Corruption & Non-Isolated Experiments**<br>Modifying repository configs in-place invalidates comparisons and risks developer workspace state. | Methodological Control Standards (RFC-002 §8) | `src/twin/experiment-twins.ts`<br>`src/twin/worktree-manager.ts` | **Operational** | Creates dual isolated Git worktrees (`baseline` and `candidate`) at the exact same base commit in `~/.cache/repotwin/twins`. Candidate patch enforced via allowlist. Verified by `test/experiment-twins.test.ts`. |
| **Stochastic Non-Determinism & Single-Run Fallacy**<br>LLM temperature and sampling make single-run benchmarks untrustworthy. | Benchmark Reliability Standards (RFC-002 §9) | `src/experiments/runner.ts`<br>`src/experiments/adapters/mock-adapter.ts` | **Operational** | Executes multi-trial counterbalanced experiments (alternating trial order between baseline and candidate). Computes trial distributions and medians in `src/metrics/comparator.ts`. |
| **Correctness Trade-off (False "Savings")**<br>Reducing tokens by terminating early or producing non-compiling code is a regression, not an optimization. | *SlopCodeBench* (SCBench, 2025)<br>SWE-bench Verification Protocol | `src/metrics/comparator.ts`<br>`src/verification/command-runner.ts` | **Operational** | Primary KPI strictly defined as: **Tokens per successfully completed task** (`tokensPerSuccessfulTask`). Tasks failing validation checks (`npm test`) are barred from contributing to token reduction figures. |
| **First-Party Headless Provider Telemetry**<br>Capturing machine-readable token counts directly from closed agent binaries (Cursor, Claude Code CLI). | Provider Telemetry Contracts (RFC-002 §9) | `src/traces/trace-parser.ts`<br>`src/experiments/adapters/` | **Partial / In Progress** | Trace parser handles standardized `AgentRun` JSON with secret redaction (`sk-ant-*`, `sk-*`, `Bearer`). Zero-spend `MockAgentAdapter` is operational for CI. Direct headless CLI adapters for Cursor/Claude Code are exploratory. |
| **Long-Term Repository Complexity Evolution**<br>Tracking structural degradation across commits over months. | *SlopCodeBench* (SCBench, 2025)<br>RFC-002 Component F | `src/report/charts.ts` (Evolution Chart)<br>`~/.repotwin/registry.json` | **Partial** | Evolution chart plots historical certification scores and check pass rates from `registry.json`. Continuous commit-by-commit multi-agent regression benchmarking is deferred to P1. |

---

## 2. Deep Dive: Operational vs. Heuristic Boundaries

A core mandate of RepoTwin RFC-002 is epistemological honesty in reporting.

### 2.1. Static Mode (`src/analysis/context-waste.ts`)
* **When active:** When no agent telemetry traces are provided (`repotwin audit .`).
* **Contract:** All findings are strictly tagged `evidenceKind: 'heuristic'`.
* **Constraint:** The system **never** estimates token savings from static files alone. Prompts like *"This will save you 15,000 tokens"* are forbidden because prompt caching, model temperature, and task nature determine actual consumption.

### 2.2. Observed Mode (`src/traces/`)
* **When active:** When one or more `AgentRun` records are imported (`repotwin audit . --trace trace.json` or via benchmark execution).
* **Contract:** Findings are tagged `evidenceKind: 'observed'` and linked directly to run hashes (`supportingRunIds`).
* **Metrics Derived:**
  * Files read repeatedly within a single task or across sequential runs.
  * Excessive exploratory tool calls (>40 calls before completion).
  * Task validation outcomes verified via exit codes.

---

## 3. Experimental Reality & What Is Currently Proven

### 3.1. What Is Empirically Proven Today:
1. **Isolated Twin Sandbox:** Integration tests (`test/experiment-twins.test.ts`) prove that candidate patches can be applied to candidate worktrees without touching the developer's working directory or tracked files.
2. **Deterministic Benchmark Scaffolding:** `test/experiment-runner.test.ts` proves that counterbalanced multi-trial suites correctly isolate variance, execute validation commands, and aggregate median token consumption.
3. **Regression Detection:** `test/metrics-comparator.test.ts` proves that if an optimization lowers tokens but drops success rate by >15%, RepoTwin officially renders a **REGRESSION** verdict rather than a false positive improvement.

### 3.2. What Is NOT Yet Claimed:
1. **No Universal "X% Savings" Promise:** RepoTwin does not claim that adding an `AGENTS.md` file guarantees a 20% or 30% reduction on arbitrary codebases. Any savings are treated as an experimental hypothesis subject to reproducible verification.
2. **Provider Telemetry Standardization:** Because Cursor and closed tools do not offer uniform headless telemetry APIs, automated token accounting depends on supported trace imports or instrumented adapters.
