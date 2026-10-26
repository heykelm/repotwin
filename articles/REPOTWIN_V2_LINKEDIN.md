# LinkedIn Post

Ever noticed how AI coding agents feel like senior engineers on small projects, but suddenly act like lost interns as soon as your repo gets big?

We often blame the model or assume the context window is too small. 
Yet frontier models now have 200k to 2M token windows. Context size isn't the real problem.

Look at the curve below (from the famous *Lost in the Middle* study):
LLMs recall information from the start and end of a prompt really well. But anything sitting in the middle? Accuracy drops by 20% to 30%+.

In large codebases, agents don't fail because they can't code. They fail because:
1. They wander through unindexed folders and build artifacts.
2. They drown in noise before finding the right files and test commands.
3. They burn 70% of their tokens just trying to figure out where things are.

Trimming a few words from your `AGENTS.md` won't change much. What really matters is stopping the agent from falling into endless search loops.

To tackle this, we built **RepoTwin** — a simple, open-source CLI that measures and optimizes how AI agents navigate your repository:
- Maps your project structure and test commands automatically.
- Tests everything in an isolated Git twin (zero risk for your code).
- Gives you an honest, clear audit report with a 1-click rollback.

You can test your own repo in seconds:
```bash
npx repotwin analyze --html
```

I wrote a full breakdown on attention mechanics, prompt caching economics, and practical repo hygiene:

👉 Read the full article on Medium: [INSERT MEDIUM URL]
⭐ Check out the open-source repo on GitHub: https://github.com/heykelm/repotwin

How is your team organizing repositories for Cursor, Claude Code, or Copilot? Curious to hear your thoughts!

#SoftwareEngineering #AIAgents #DeveloperProductivity #CodingAgents #OpenSource #DevOps

