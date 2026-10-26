# LinkedIn Post: Why AI Coding Agents Struggle as Repositories Grow

Why do frontier AI coding agents feel like senior engineers on small greenfield apps, but turn into lost interns on mature, 300k-line codebases?

Most developers assume the model is hitting a context window limit. But when frontier models boast 200k to 2M token windows, context size isn't the real bottleneck.

Recent academic research uncovers what is actually happening under the hood:

1. **The "Lost in the Middle" Effect (TACL 2024):** Language models retrieve information from the beginning and end of long contexts reliably, but their accuracy drops by 20% to 30%+ when critical instructions sit in the middle of a growing prompt.
2. **Semantic Retrieval Cliffs (NoLiMa, 2025):** The moment an agent has to find code without exact keyword matching, retrieval accuracy drops sharply beyond 32k tokens—even on models rated for massive contexts.
3. **The Search Budget Reality:** In multi-module repositories, agents don't fail at writing code. They spend 70% of their token budget and tool calls wandering through unindexed folders, stale paths, and minified build artifacts before writing their first line.

And with prompt caching now discounting input tokens by ~90%, shaving words off your `AGENTS.md` saves fractions of a cent. The real economic driver is preventing the agent from falling into 10-turn exploratory loops.

Over the past few weeks, we set out to tackle this with an experimental engineering approach: **RepoTwin v2**.

Instead of assigning arbitrary "readiness scores," RepoTwin spins up dual isolated Git worktrees (`baseline` vs `candidate`), runs controlled tasks, and measures what actually happens:
- Provider-reported tokens per *successfully completed* task
- Tool call churn and files explored
- Strict non-regression verification (if success rate drops, it's a regression, not an optimization)

If you're managing complex repositories with tools like Claude Code, Cursor, or Aider, we wrote a deep dive into the research, the attention mechanics, and how to measure repository efficiency with reproducible data.

Read the full technical analysis on Medium:
👉 [INSERT MEDIUM ARTICLE URL HERE]

#SoftwareEngineering #AIAgents #LLM #DeveloperProductivity #CodingAgents
