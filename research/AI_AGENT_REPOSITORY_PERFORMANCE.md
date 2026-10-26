# Scientific Synthesis: Why AI Coding Agents Struggle in Growing Codebases

**Author:** Technical Research & Architecture Team  
**Date:** October 2026  
**Status:** Verified Academic & Empirical Survey  
**Focus:** Context Retrieval, Navigation Churn, and Technical Debt Accumulation in LLM Coding Agents

---

## 1. Executive Summary

As software repositories grow, developers observe an unintuitive phenomenon: frontier Large Language Models (LLMs) with 128k to 2M token context windows often degrade in task completion speed, navigation efficiency, and code quality. 

This research synthesis reviews the theoretical and empirical literature underpinning this challenge. We examine why context degradation happens, distinguish between **repository size** and **active attention payload**, and analyze four seminal lines of scientific inquiry:
1. **Positional Attention Degradation** (*Lost in the Middle*, Liu et al., 2024)
2. **Semantic Retrieval Failure Beyond Keyword Matching** (*NoLiMa*, Fuchs et al., 2025)
3. **Multi-File Navigation & Grounding in Real Repositories** (*SWE-bench*, Jimenez et al., 2024)
4. **Long-Horizon Iterative Code Degradation** (*SlopCodeBench*, 2025)

---

## 2. Core Scientific Literature & Verified Findings

### 2.1. Positional Attention Degradation: *Lost in the Middle*
* **Citation:** Liu, N. F., Lin, K., Hewitt, J., Paranjape, A., Bevilacqua, M., Petroni, F., & Liang, P. (2024). *Lost in the Middle: How Language Models Use Long Contexts*. Transactions of the Association for Computational Linguistics (TACL), 12:157–173. [arXiv:2307.03172](https://arxiv.org/abs/2307.03172).
* **Experimental Setup:** Multi-document question answering (QA) and synthetic key-value retrieval across varied input context lengths (up to 30 documents / thousands of tokens) with systematically permuted positions of the relevant information. Evaluated models included GPT-3.5-Turbo, Claude-1.3, MPT-30B-Instruct, and Llama-2.
* **Key Verified Findings:**
  * Model retrieval accuracy follows a **U-shaped curve**: performance is highest when the target context is placed at the very beginning (primacy effect) or very end (recency effect) of the prompt.
  * When critical information is located in the middle of a long context, performance drops substantially—often by **20% to over 30% absolute accuracy** compared to beginning/end placement.
  * Crucially, increasing context window capacity does *not* mitigate this positional degradation; models with larger rated windows still exhibited severe middle-context blind spots.
* **Implications for AI Coding Agents:** In large repositories, instruction files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`) and retrieved code snippets are frequently concatenated into long system and conversation contexts. If crucial conventions or routing instructions end up in the middle of a 40k+ token context, agents routinely fail to retrieve or follow them.

---

### 2.2. Semantic Retrieval Failure: *NoLiMa (Needle in a Noisy Haystack)*
* **Citation:** Fuchs, et al. (LMU Munich & Adobe Research, Feb 2025). *NoLiMa: Long-Context Evaluation Beyond Literal Matching*. [arXiv:2502.05167](https://arxiv.org/abs/2502.05167).
* **Experimental Setup:** Extends the popular Needle-In-A-Haystack (NIAH) benchmark by systematically removing exact lexical overlap between query keywords and the needle text. Models must identify target information through latent semantic associations rather than surface-level string matching across contexts ranging from 4k to 1M+ tokens.
* **Key Verified Findings:**
  * While frontier LLMs (including GPT-4o and Claude 3.5 models) achieve nearly 100% on naive lexical NIAH tests, their performance drops precipitously on NoLiMa.
  * Performance degradation begins at relatively modest context sizes (**as early as 32k tokens**), often falling below **50% of short-context baseline accuracy**.
  * Advanced techniques like Chain-of-Thought (CoT) and extended reasoning reduce but do not eliminate this semantic retrieval cliff.
* **Implications for AI Coding Agents:** Real codebases rarely use identical wording between a developer's bug report and the internal implementation symbols. As the volume of context fed to an agent expands with irrelevant source files, the model's ability to locate conceptually related functions without exact keyword matches degrades dramatically.

---

### 2.3. Repository Navigation & Multi-File Grounding: *SWE-bench & SWE-bench Verified*
* **Citation:** Jimenez, C. E., Yang, J., Wettig, A., Yao, S., Pei, K., Press, O., & Narasimhan, K. (2024). *SWE-bench: Can Language Models Resolve Real-World GitHub Issues?*. ICLR 2024. [arXiv:2310.06770](https://arxiv.org/abs/2310.06770).
* **Experimental Setup:** 2,294 real-world software engineering issues collected from 12 popular open-source Python repositories (e.g., `django/django`, `sympy/sympy`, `scikit-learn/scikit-learn`), paired with unit test harnesses. Evaluated in end-to-end setups where agents must locate files, edit code, and produce patches validated by unit tests.
* **Key Verified Findings:**
  * Locating the relevant files across a sprawling directory tree constitutes a dominant failure mode. Unassisted LLMs frequently edit incorrect files or fail to identify where a bug manifests.
  * In SWE-bench Verified (500 human-validated samples), state-of-the-art multi-agent scaffolds achieve between 40% and 70% resolution rates, but spend **hundreds of thousands of tokens per task** primarily on exploratory tool calls (`grep`, `find`, `cat`).
* **Implications for AI Coding Agents:** Agent inefficiency is rarely caused by the LLM failing at basic syntax; it is caused by navigation churn. When an agent spends 15 turns scanning the wrong directories, context fills with dead ends, accelerating the retrieval degradation described in *Lost in the Middle* and *NoLiMa*.

---

### 2.4. Iterative Degradation & Technical Debt: *SlopCodeBench (SCBench)*
* **Citation:** SCBench Research Team (2025). *SlopCodeBench: Evaluating LLM Code Quality and Architectural Degradation Across Multi-Stage Development*. [arXiv:2502.14856](https://arxiv.org/abs/2502.14856).
* **Experimental Setup:** Multi-stage benchmark testing agents across 3 to 6 sequential development checkpoints. The agent must implement a feature, then iteratively extend *its own prior code* to satisfy new specifications without retaining earlier conversational context—passing forward only the repository worktree. Evaluates both functional correctness and code health metrics (Structural Erosion and Verbosity).
* **Key Verified Findings:**
  * **Systematic Structural Erosion:** Code health deteriorates over time: structural erosion increased in **~77% of agent trajectories**, while verbosity rose in **over 75%** of runs.
  * **The "Slop" Discrepancy:** Iteratively generated agent code exhibited **2.3× higher verbosity** and **2.0× higher structural erosion** compared to human open-source codebases, generating sprawling "god functions" and repetitive defensive boilerplate.
  * **Compounding Failures:** While agents frequently pass early checkpoints, accumulated structural debt causes downstream extensions to fail at exponentially higher rates. Plan-first system prompts reduced initial bloat by up to 30%, but failed to stop compounding long-horizon degradation.
* **Implications for AI Coding Agents:** An unmaintained or sprawling repository acts as an amplifier of agent slop. When agents read bloated, architecturally eroded files, their outputs mirror that verbosity, driving token costs up and maintainability down.

---

## 3. Dissecting the Myth: Repository Size vs. Active Context

A widespread industry misconception is that *repository size in Lines of Code (LOC) directly dictates agent accuracy*. Scientific examination reveals a more nuanced reality:

```text
[ Entire Git Repository (100k - 5M LOC) ]
                 │
                 ▼  (Selective exploration / tool calls)
[ Active Working Context Window (8k - 60k tokens) ]
                 │
                 ▼  (Attention mechanism & Prompt Caching)
[ Effective Attention & Reasoning (Lost in the Middle / NoLiMa zone) ]
```

### The Critical Distinctions:
1. **Total Repo LOC ≠ Context Window:** An agent does not hold 500,000 LOC in memory simultaneously. It issues search queries (`grep`, `glob`, `list_dir`) and loads file slices into a sliding context window.
2. **Where the Inefficiency Actually Lies:**
   * **The Search Budget (Tool Churn):** Large repositories with ambiguous folder structures, stale documentation references, or unindexed module exports force agents to make 20+ exploratory tool calls before their first edit.
   * **Context Pollution:** Every exploratory read of an irrelevant file (e.g., minified build artifacts, redundant documentation, duplicated test mocks) remains in the session history, pushing critical instructions into the "middle" where attention degrades.
   * **Prompt Caching Economics:** In modern providers (Anthropic Claude 3.5/3.7, OpenAI, Gemini), cached input tokens cost ~10% of raw input tokens. Reworking a 500-token prompt saves pennies; preventing an unnecessary 10-turn exploratory loop saves tens of thousands of high-cost output and reasoning tokens.

---

## 4. Key Takeaways for Repository Engineering

1. **Context hygiene directly impacts agent reasoning:** Pruning obsolete paths and contradictory instructions prevents the semantic dilution proven by *NoLiMa*.
2. **Navigation maps beat prompt stuffing:** A concise, verified architecture index reduces exploratory tool calls, keeping the context window small and out of the *Lost in the Middle* danger zone.
3. **Controlled experimentation is mandatory:** Because LLMs are stochastic and context-sensitive, claims of "token savings" must be empirically verified across multi-trial baselines and candidate worktrees.
