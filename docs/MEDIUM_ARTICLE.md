# Why Your AI Coding Agent Burns Your $20/Month Subscription in 3 Days (And How to Fix It)

*How we built RepoTwin, an open-source engine using isolated Git Twins and MCP to eliminate phantom commands, stop failure loops, and preserve your AI quotas.*

---

If you are using **Cursor Pro**, **Claude Code**, **Gemini / Antigravity**, or **GitHub Copilot**, this scenario will sound painfully familiar:

You start your week with 500 fast requests. You prompt your agent to fix a bug in a monorepo. The agent writes some code, and then attempts to verify its work. 

Except:
1. It tries to run `npm test` in a backend service that actually runs `pytest` or `npm run test:e2e`.
2. The command fails.
3. The agent apologizes, tries `npm run test:unit`, fails again.
4. It hallucinates a custom shell script. It fails a third time.
5. Five messages and **25,000 context tokens later**, the agent finally figures out the right command.

Your fast requests quota drops. Your monthly subscription evaporates in a matter of days. And worse: **nothing useful was accomplished during those failed iterations.**

---

## The Hidden Culprit: Instruction Drift & Phantom Commands

AI coding agents do not possess magical clairvoyance. They rely strictly on the system prompts and local instruction files found in your repository: `AGENTS.md`, `.cursorrules`, `CLAUDE.md`, or `.claude/rules`.

In practice, repositories suffer from two fatal extremes:

1. **The Bloated Manifesto (Context Waste)**: The team copied 3,000+ tokens of boilerplate rules into `.cursorrules`. Every single user prompt injects this massive prompt preamble. Over 500 queries a month, you are literally paying hundreds of thousands of tokens just to re-send instructions the agent barely pays attention to.
2. **The Ghost Town (Underspecified & Outdated)**: The repository has only 5 lines of vague instructions. Subprojects lack explicit test commands. The agent is forced to guess, leading to **fatal multi-turn failure loops** where it tries 3 to 5 incorrect build commands before giving up.

Until now, developers had no empirical way to test whether their agent instructions actually matched reality.

**We built RepoTwin to solve this exact problem.**

---

## Meet RepoTwin: Empirical Instruction Alignment & Git Twins

[RepoTwin](https://github.com/heykelm/repotwin) is an open-source reliability and instruction-optimization engine for AI agents. 

Instead of guessing, RepoTwin acts as a compiler and verification pipeline for agent instructions:

```
[ Your Repository ]
        │
        ▼ (Audit & Diagnostic)
[ Instruction Inconsistencies & Phantom Commands Detected ]
        │
        ▼ (Git Worktree Isolation)
[ Isolated Git Twin: Verification Plan Execution ]
        │
        ▼ (Safety & Non-Regression Check)
[ 100/100 A Certified Recipe + Audit Certificate HTML ]
```

### 1. Isolated Git Twins (Zero Risk to Your Code)
Running unknown build scripts or installing packages directly in your active workspace is dangerous. 
RepoTwin creates an **ephemeral Git worktree (`Twin`)** in a separate cache directory. It shares your Git object store (taking zero extra clone time and minimal disk space) and tests all commands in complete isolation. Your working tree, uncommitted edits, and staged files are untouched.

### 2. Dual-Mode Token ROI (Saving Hard Dollars)
RepoTwin automatically detects your repository's state and calculates measurable ROI:

- **Context Compression Mode** *(for bloated repos)*: Compacts verbose rules down to concise, agent-native tables (e.g. from 3,200 tokens down to 600 tokens, a **75% prompt reduction**). On 900 queries/month, this pays for an entire Cursor Pro or Claude subscription.
- **Robustness & Zero-Hallucination Mode** *(for underspecified repos)*: Completes missing architecture maps and test scripts to guarantee a **100/100 A health score with 0 phantom commands**. The ROI here is measured in **avoided failure loops**—sparing ~50,000+ tokens of failed agent retries every month.

### 3. Agent-Native with MCP (Model Context Protocol)
RepoTwin is not just a CLI or Web UI—it is natively an **MCP Server**. With a single command:

```bash
repotwin setup-mcp
```

RepoTwin auto-configures **Cursor**, **Claude Desktop**, **Gemini / Antigravity**, and **Windsurf**. Your agents can now audit repositories, spawn isolated twins, and verify checks autonomously in background sessions!

---

## Real-World Case Study: From 76/100 C to 100/100 A

On a real production monorepo containing Node, Flutter, and Playwright E2E services:

- **Initial State**: Score of **76/100 (Grade C)** with 6 critical anomalies. The agent constantly hallucinated non-existent test commands on the Flutter and E2E subprojects.
- **RepoTwin Intervention**: Discovered all 6 subprojects, mapped real scripts, ran all 9 checks concurrently in an isolated Twin (100% passed in parallel).
- **Result**: Health score reached **100/100 (Grade A)**. 
- **Proof**: An immutable, bilingual **Optimization Certificate** (`.html` and `.json`) was generated with full test execution proof, and archived in the global registry.

Zero failed commands. Zero burned tokens.

---

## Get Started in 30 Seconds

RepoTwin is 100% open-source under the MIT license and runs on **macOS**, **Windows 10/11**, and **Linux** with an ultra-lightweight footprint (< 60 MB RAM).

```bash
# 1. Install globally
npm install -g repotwin

# 2. Launch the interactive Studio for any project
repotwin /path/to/your-repo

# 3. Plug into your favorite AI IDE
repotwin setup-mcp
```

The Web Studio is bilingual (**English** by default, with an instant **`[ EN | FR ]`** switch in the header).

---

## Conclusion & Links

Stop paying for your AI agent's trial-and-error mistakes. By giving your agents certified, empirically verified instructions, you save hundreds of dollars a year in token quotas while boosting your development velocity.

- ⭐ **Star the repo on GitHub**: [https://github.com/heykelm/repotwin](https://github.com/heykelm/repotwin)
- 🐞 **Report issues or suggest features**: We welcome PRs and feedback!

*Have you experienced AI agents getting stuck in infinite command loops? Let us know in the comments below!*
