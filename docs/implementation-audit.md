# Implementation Audit: RepoTwin RFC-002 Baseline

**Date:** 2026-10-25  
**Version:** 1.0  
**Status:** Completed  
**Repository:** RepoTwin (`v0.1.4`)  
**Target Specification:** `RFC-002: Evidence-Based Agent Efficiency Engineering`

---

## 1. Executive Summary & Existing State

The current RepoTwin codebase (`v0.1.4`) is a Node.js/TypeScript tool primarily built around repository diagnostic scanning, candidate twin generation via Git worktrees, instruction auditing, verification token handshakes, a local Vite/React Studio UI, and an MCP server.

### Existing Strengths & Reusable Modules
1. **Isolated Worktree Engine (`src/twin/worktree-manager.ts`)**:
   - Mature, tested implementation of Git worktree isolation.
   - Preserves user changes, avoids touching the main worktree, handles submodules and robust directory cleanup.
   - **Directly reusable** for Twin Manager in RFC-002.
2. **Deterministic Source State Verification (`src/verification/source-state.ts`, `command-runner.ts`)**:
   - Binds verifications to commit SHA, index, untracked files, and HEAD state.
   - Sandboxed execution with timeout, output capture, and exit code accounting.
   - **Directly reusable** for task validation commands in experiments.
3. **Instruction Scanners & Subproject Topology (`src/analyzer/`)**:
   - Multi-stack detection (Node.js, Flutter, Python, Go, Rust).
   - Rules scanning (`.cursor/rules`, `CLAUDE.md`, `AGENTS.md`, etc.).
   - Classification of paths, aliases, SQL tables, and false positives.
   - **Reusable as the static inspection foundation** for Component A (Repository Inspector).

---

## 2. Component-by-Component Audit

| RFC-002 Component | Current Repo Status | Gap Analysis & Action Plan |
| :--- | :--- | :--- |
| **Component A: Repository Inspector** | **Partial** (`src/analyzer/*`) | Currently scans subprojects, rules, and false positives. Needs to output the normalized `RepositorySnapshot` contract with Git fingerprint and instruction inventory. |
| **Component B: Context Waste Analyzer** | **Partial / Missing** | Exists as heuristic `instruction-consistency.ts` & `instruction-audit.ts`. Missing: explicit separation of `heuristic` vs `observed` evidence, observed repeat-file reads from traces, and token waste disclaimer. |
| **Component C: Twin Manager** | **Complete & Reusable** (`src/twin/*`) | Worktree isolation already works cleanly. Needs integration with RFC-002 patch lifecycle and baseline/candidate experiment metadata. |
| **Component D: Experiment Runner & Adapters** | **Missing** | Needs `src/experiments/`: task specification schemas, mock adapter (100% deterministic, zero spend), telemetry normalizer, and adapter contracts. |
| **Component E: Comparator & Statistical Reporting** | **Missing** | Needs `src/metrics/`: paired trial comparison, median/distribution metrics, failure handling (tokens per successful task), and JSON/Markdown report generators. |
| **Trace Contracts & Ingestion** | **Missing** | Needs `src/traces/`: normalized `AgentRun`, `TokenUsage`, `Finding` with provenance flags, and parsers for trace files. |

---

## 3. Data Schema Gap Analysis

RFC-002 introduces a formal data contract with strict provenance:
```ts
type EvidenceKind = 'observed' | 'derived' | 'heuristic';
type FindingStatus = 'confirmed' | 'suspected' | 'false_positive' | 'unverifiable';
type TokenUsage = { ... source: 'provider' | 'adapter' | 'estimate' | 'unavailable' };
type AgentRun = { ... status: 'success' | 'failure' | 'timeout' ... };
```
These must be centralized in `src/types/contracts.ts` without breaking existing `RawFinding` and `ProcessedFinding` interfaces used by the current Studio and MCP servers.

---

## 4. Phase-by-Phase Implementation Plan

- [x] **Phase 0 — Baseline Audit & Architecture Mapping** (`docs/implementation-audit.md`).
- [ ] **Phase 1 — Data Contracts & Trace Ingestor (`src/types/contracts.ts`, `src/traces/`)**:
  - Implement and test schemas for `AgentRun`, `TokenUsage`, `Finding`, `RepositorySnapshot`.
  - Ingestion logic for agent traces with privacy masking and validation.
- [ ] **Phase 2 — Context Waste Analyzer (`src/analysis/context-waste.ts`)**:
  - Dual modes: `static` (heuristics) and `observed` (traces).
  - Explicit provenance tagging (`observed` vs `heuristic`).
- [ ] **Phase 3 — Twin Manager RFC-002 Bridge (`src/twin/`)**:
  - Pair baseline and candidate worktrees at identical commit base.
  - Patch application with hash verification and allowlist enforcement.
- [ ] **Phase 4 — Benchmark / Experiment Engine (`src/experiments/`)**:
  - Task specification loader (`suite.yaml` format).
  - Deterministic Mock Adapter for CI/zero-cost validation.
  - Execution runner with timeouts, budgets, and validation check execution.
- [ ] **Phase 5 — Metrics Comparator & Reports (`src/metrics/`, `src/reports/`)**:
  - Primary KPI: tokens per *successful* task.
  - Variance, median, net-benefit / break-even calculation.
  - Markdown and JSON report generators.
- [ ] **Phase 6 — CLI Integration & Regression Verification**:
  - Wire new commands (`audit`, `trace`, `benchmark`, `compare`, `report`) into `src/index.ts`.
  - Maintain 100% backward-compatibility for existing commands (`ui`, `mcp`, `verify`, `twin`).
  - Verify complete Vitest test suite passes with zero regressions.
