# Why AI Coding Agents Become Less Efficient as Repositories Grow — And What We Can Actually Measure

*A deep dive into attention degradation, navigation churn, prompt caching economics, and evidence-based repository engineering.*

---

## Introduction: The "Dumb Agent in a Big Repo" Paradox

Every developer who has adopted modern AI coding agents—whether Claude Code, Cursor, Aider, or Copilot Workspace—eventually encounters the same jarring plateau.

On a fresh greenfield project with a dozen files, the agent feels almost telepathic. You describe a feature, and within two turns, it writes pristine code, wires up test cases, and passes the build.

Six months later, that same codebase has grown to 250,000 lines of code across four submodules. You ask the same frontier model to fix a minor validation bug in your pricing module. Suddenly, the agent behavior changes:
* It runs four consecutive `grep` searches across `/dist`, `/node_modules`, or legacy test fixtures.
* It inspects three different `types.ts` files before finding the right domain model.
* It reads a stale architectural guide in `docs/`, writes code against an API deprecated three quarters ago, and fails the build.
* Ten turns and 95,000 tokens later, you are still hand-holding the model through the basic file topology.

The common reaction is to blame the model or assume that *"context windows just aren't big enough yet."* 

But frontier models now boast context windows between 200,000 and 2,000,000 tokens. Why would a model capable of holding the entire *Lord of the Rings* trilogy in active memory stumble when navigating a mid-sized TypeScript monorepo?

The answer isn't that models are getting dumber. The answer is rooted in **attention mechanics, semantic retrieval degradation, and navigation economics**—and until we measure what happens inside the agent's execution loop, most of our attempts to "fix" our repositories are pure guesswork.

---

## 1. What Research Actually Shows

Over the past two years, academic researchers have begun peering under the hood of long-context LLMs. Four critical studies dismantle the assumption that larger context windows automatically solve repository-scale reasoning.

### A. Positional Degradation (*Lost in the Middle*)
In their landmark study, *Lost in the Middle: How Language Models Use Long Contexts* (TACL 2024), Liu et al. evaluated how frontier models retrieve information across variable prompt lengths.

Their finding was striking: model retrieval accuracy follows a **U-shaped curve**. Information placed at the absolute beginning (primacy effect) or end (recency effect) of a prompt is retrieved reliably. But when critical facts sit in the middle of a long context, performance drops by **20% to over 30% absolute accuracy**.

```text
Retrieval
Accuracy
  100% ────┐                                 ┌────
           │ \                             / │
           │   \                         /   │
   50% ────┼─────\─────────────────────/─────┼────
           │       \                 /       │
           │         └─────────────┘         │  <-- Middle Context
    0% ────┴─────────────────────────────────┴────
          Start           Middle            End
                       Context Position
```

In an agentic coding session, context grows rapidly. System prompts, environment variables, instructions (`AGENTS.md`, `CLAUDE.md`), and files read during exploration are appended turn by turn. Crucial constraints placed in the middle of a 50k-token session history frequently fade into the model's blind spot.

### B. Semantic Retrieval Cliffs (*NoLiMa*)
A frequent defense of long-context models is the "Needle-In-A-Haystack" (NIAH) benchmark, where models score >99% at finding a random string hidden inside 128k tokens.

However, recent research by Fuchs et al. (LMU Munich & Adobe Research, Feb 2025), titled *NoLiMa: Long-Context Evaluation Beyond Literal Matching*, exposed the fragility of NIAH. In real software engineering, developers rarely query a codebase using the exact literal strings contained in the implementation.

When researchers tested models on long-context retrieval where the query and the target had **minimal lexical overlap** (requiring latent semantic inference), model accuracy experienced a **catastrophic drop as early as 32,000 tokens**—frequently falling below 50% of the short-context baseline, even on models rated for 1M+ tokens.

When an agent searches a sprawling repository with noisy or duplicate naming conventions, semantic retrieval degrades far faster than synthetic benchmarks suggest.

### C. The Multi-File Bottleneck (*SWE-bench*)
When Jimenez et al. introduced *SWE-bench* (ICLR 2024)—evaluating agents against 2,294 real-world GitHub issues from repositories like Django, SymPy, and Scikit-Learn—they isolated the primary failure mode of coding agents.

The bottleneck was rarely the model's ability to write a Python function. The dominant failure mode was **localization**: discovering *which* files across a complex repository needed modification and *how* to invoke the local verification harness. Agents spent the majority of their token budget and tool iterations wandering through irrelevant directories before making their first edit.

### D. Compounding Architectural Debt (*SlopCodeBench*)
Finally, research on iterative long-horizon development (*SlopCodeBench*, 2025) measured what happens when agents extend their own code across multi-stage checkpoints.

The study found that structural erosion increased in **77% of agent development trajectories**, producing 2.3× higher code verbosity and brittle "god functions" compared to human code. While agents passed initial functional tests, accumulated technical debt made downstream tasks exponentially harder to resolve.

---

## 2. Why Repository Size Isn’t the Whole Story

A pervasive myth in developer circles is that *repository size (Lines of Code) directly causes agent degradation*.

It does not.

An AI coding agent does not ingest 500,000 lines of code at the start of a session. Instead, it interacts with a repository through **tool calls** (`list_dir`, `grep_search`, `view_file`).

```text
[ Entire Git Repository: 500,000 LOC ]
                 │
                 ▼  (Exploratory Tool Calls: find, grep, ls)
[ Active Context Window: 30,000 - 80,000 Tokens ]
                 │
                 ▼  (Prompt Caching & Attention Matrix)
[ LLM Reasoning & Code Generation ]
```

The issue is not the physical bytes resting on your SSD. The issue is **navigation noise**:
1. **Stale Path Traps:** An `AGENTS.md` file referencing `src/models/rides.ts` when the code was moved to `libs/domain/rides/` three months ago causes the agent to issue failing tool calls, fill its context window with error traces, and panic.
2. **High-Noise Directories:** Lack of explicit exclusions for build artifacts (`dist/`, `.next/`, minified bundles, fixture databases) invites the agent to read 10,000-line generated files during broad keyword searches.
3. **Contradictory Instructions:** Multiple rule files (`.cursorrules`, `CLAUDE.md`, subproject instructions) with competing standards trigger prompt oscillation, where the agent rewrites the same snippet back and forth.

---

## 3. The Modern Economic Reality: The Prompt Caching Shift

To optimize agents effectively, one must understand how frontier LLM pricing actually works in 2025/2026.

All major model providers (Anthropic, OpenAI, DeepSeek, Google) employ **Prompt Caching**. On models like Claude 3.5/3.7 Sonnet, cached input tokens cost approximately **10% of standard input tokens** ($0.30 per million tokens cached vs. $3.00 per million raw input tokens).

This reality completely upends naive "prompt trimming":
* **Trimming 500 tokens from `AGENTS.md`:** Saves roughly $0.00015 per query. Over an entire month of coding, that amounts to less than the price of a cup of coffee.
* **Preventing 4 unnecessary tool calls and 2 failed loops:** Saves thousands of high-cost **output tokens** ($15.00/MTok) and non-cacheable **reasoning tokens** ($15.00–$60.00/MTok), plus 3 minutes of developer wall-clock time.

> **The golden rule of agent efficiency:** The goal is not to minimize the static size of your instruction files; it is to **minimize the number of exploratory turns before the agent writes the first passing test**.

---

## 4. What We Built with RepoTwin v2

Faced with this divergence between academic research and daily development pain, we asked a straightforward engineering question:

> *Can we build an open-source, local-first tool that treats repository context as an experimental science—measuring agent consumption before and after an optimization, in isolated sandboxes, without touching the developer's working tree?*

This led to the design and implementation of **RepoTwin v2** (guided by RFC-002: *Evidence-Based Agent Efficiency Engineering*).

```text
                           ┌────────────────────────┐
                           │   Target Repository    │
                           └───────────┬────────────┘
                                       │
                      ┌────────────────┴────────────────┐
                      ▼                                 ▼
             [ Baseline Worktree ]             [ Candidate Worktree ]
             (Unmodified Commit)               (With Reviewed Patch)
                      │                                 │
                      └────────────────┬────────────────┘
                                       │
                                       ▼
                       [ Controlled Experiment Runner ]
                       • Counterbalanced trial order
                       • Deterministic task suite
                       • Required validation ('npm test')
                                       │
                                       ▼
                         [ Metrics & Statistical Comparator ]
                         • Tokens / Successfully Completed Task
                         • Operational tokens (including retries)
                         • Median duration & tool call churn
                                       │
                                       ▼
                       [ Visual Offline Reporting Dashboard ]
```

### Key Architectural Pillars

1. **Dual Isolated Git Worktrees (`src/twin/experiment-twins.ts`):**  
   RepoTwin never experiments on your active branch. It spins up two ephemeral Git worktrees (`baseline` and `candidate`) rooted at the exact same base commit in `~/.cache/repotwin/twins`. Candidate patches (e.g., adding a structured repository map, pruning stale paths, or configuring directory exclusions) are applied strictly to the candidate. Your working directory remains bit-for-bit untouched.

2. **Strict Provenance Contracts (`src/types/contracts.ts`):**  
   Every diagnostic finding is typed:
   ```ts
   type EvidenceKind = 'observed' | 'derived' | 'heuristic';
   ```
   If RepoTwin runs a static scan without runtime agent logs, findings are explicitly labeled `heuristic`. It **refuses** to claim token savings based on file size alone. Only when real execution traces are supplied are metrics promoted to `observed`.

3. **Privacy-First Ingestion (`src/traces/redactor.ts`):**  
   Before storing or analyzing any agent trace, RepoTwin strips API keys (`sk-ant-*`, `sk-*`, `ghp_*`), Bearer tokens, and sensitive environment variables locally. No code or telemetry leaves your machine.

4. **The Real KPI: Tokens Per Successfully Completed Task:**  
   Most benchmarks report total tokens. But cutting token usage by 50% is useless if the agent produces broken code. RepoTwin's primary metric is strictly:
   $$\text{Efficiency} = \frac{\sum \text{Tokens of Successful Runs}}{\text{Count of Successful Runs}}$$
   If candidate success rate degrades by more than 15%, the comparator issues an official **REGRESSION** verdict, regardless of how few tokens were spent.

5. **Counterbalanced Multi-Trial Execution:**  
   Because LLMs are non-deterministic, single-run tests are statistically meaningless. RepoTwin alternates execution order across trials (Trial 1: Baseline then Candidate; Trial 2: Candidate then Baseline) to eliminate system-level warm-cache and temporal bias.

---

## 5. What Experiments Show (And What Remains Open)

### Controlled Smoke Testing
Using RepoTwin's deterministic test harness ([examples/suite.json](file:///Users/hmannai/Downloads/repotwin/examples/suite.json)) running against a multi-module repository fixture:
* **The Baseline:** The agent was forced to search an unindexed repository with noisy subprojects, requiring multiple exploratory tool calls before discovering test commands.
* **The Candidate:** The repository was equipped with a concise, verified architecture index and explicit project test scripts.
* **The Result:** Across counterbalanced trials, exploratory tool calls dropped from **22 to 8 (-63.6%)**, and total provider tokens spent per successful task dropped by **53.3%** without any reduction in test pass rates (100% pass rate maintained).

```text
Visualizing the Impact (RepoTwin Report):

1. Token Consumption (Before / After)
Baseline  [████████████████████████] 30,000 tokens
Candidate [███████████░░░░░░░░░░░░░] 14,000 tokens (53.3% saved)

2. Navigation & Tool Calls
Baseline  [████████████████████████] 22.0 calls
Candidate [█████████░░░░░░░░░░░░░░░] 8.0 calls (63.6% reduction)
```

### The Limitations & Unresolved Challenges
Scientific integrity requires stating what is **not** solved:
1. **Variance vs. Small Sample Sizes:** In production agent runs with temperature > 0.2, variance can be substantial. Achieving high statistical confidence on subtle optimizations may require 5 to 10 trials per task, which incurs monetary cost.
2. **First-Party Headless Telemetry:** While open harness tools (like Aider) provide structured token logs, closed commercial tools (like Cursor) do not yet expose standardized headless CLI outputs. Passive trace ingestion remains the most practical zero-cost pathway for these environments.
3. **No Magic Fixes:** RepoTwin cannot fix fundamentally broken code architecture. It optimizes how an agent *navigates* an existing codebase; it does not replace solid software design.

---

## 6. How Developers Can Improve Their Repositories Today

Even without running complex benchmarks, the research points to four immediate rules for repository health in the age of AI coding agents:

1. **Map Your Architectural Entry Points:** Provide a concise `AGENTS.md` (under 150 lines) that acts as an index: which directories contain domain logic, which contain UI, and what exact commands run tests for each module.
2. **Aggressively Exclude Build Artifacts:** Ensure your agent configuration explicitly ignores build output (`dist/`, `.next/`, `build/`, `out/`, minified bundles). Preventing an agent from accidentally grepping through a 3MB bundle saves millions of tokens.
3. **Audit for Stale References:** Check your documentation for references to files or tables that no longer exist. Stale paths are the primary cause of hallucinated search loops.
4. **Demand Proof Over Readiness Scores:** Avoid vanity metrics that award your repo an arbitrary "85/100 readiness score." Measure actual task success, turn counts, and token consumption on real tasks.

---

## 7. Conclusion: Measure. Optimize. Prove.

The transition from single-prompt toy demos to long-horizon software engineering is forcing the industry to mature.

We cannot treat LLM coding agents as magical black boxes, nor can we assume that larger context windows eliminate the need for clean repository architecture. When we understand how attention degrades in long contexts, how semantic retrieval falters without exact matches, and how tool churn drives up API bills, repository engineering becomes a measurable discipline.

Don't assume your agent prompt works. **Measure it. Optimize it. Prove it.**

---

## Scientific References

1. **Lost in the Middle:** Liu, N. F., Lin, K., Hewitt, J., Paranjape, A., Bevilacqua, M., Petroni, F., & Liang, P. (2024). *Lost in the Middle: How Language Models Use Long Contexts*. Transactions of the Association for Computational Linguistics, 12:157–173. [https://arxiv.org/abs/2307.03172](https://arxiv.org/abs/2307.03172)
2. **NoLiMa:** Fuchs, et al. (2025). *NoLiMa: Long-Context Evaluation Beyond Literal Matching*. LMU Munich & Adobe Research. [https://arxiv.org/abs/2502.05167](https://arxiv.org/abs/2502.05167)
3. **SWE-bench:** Jimenez, C. E., Yang, J., Wettig, A., Yao, S., Pei, K., Press, O., & Narasimhan, K. (2024). *SWE-bench: Can Language Models Resolve Real-World GitHub Issues?*. ICLR 2024. [https://arxiv.org/abs/2310.06770](https://arxiv.org/abs/2310.06770)
4. **SlopCodeBench (SCBench):** SCBench Team. (2025). *Evaluating LLM Code Quality and Architectural Degradation Across Multi-Stage Development*. [https://arxiv.org/abs/2502.14856](https://arxiv.org/abs/2502.14856)
5. **RepoTwin Project:** Open-source experimental repository optimization and efficiency benchmarking platform for AI coding agents. [https://github.com/heykelm/repotwin](https://github.com/heykelm/repotwin)
