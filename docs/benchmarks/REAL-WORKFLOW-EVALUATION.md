# Exploratory agent workflow evaluation

Three historical backend debugging tasks were evaluated with a coding agent. Source repositories, prompts, transcripts and fixtures are private and are not distributed here. Each task used independent validation against a selected test suite and additional checks; it was not a complete application or security evaluation.

| Task | Comparison | Observed input + output token difference |
| --- | --- | --- |
| Unread-message state | Experimental summary and context vs usual terminal | −15.9% |
| Notification email preference | Experimental summary and context vs usual terminal | −13.1% |
| Guest notification link | Summary only vs usual terminal | +32.9% |
| Guest notification link | Summary + experimental selector vs usual terminal | +38.8% |

These are single observations per arm with different agent actions and uncontrolled cache. The third selector was tuned on that same task before the run; it was not a blind evaluation. All reported task corrections passed the selected checks. These results neither establish a general effect nor measure subscription quota or monetary savings. Input counts include cached input; output includes reasoning where reported. Comparing costs requires accounting for the provider, cache behavior, tool calls, retries, and full task quality.

The experiments used shell adapters, not the published MCP verification workflow. The selector is not included in RepoTwin. The practical lessons are to preserve diagnostics, make additional logs available on demand, measure complete tasks, and avoid assuming that smaller test output leads to fewer tokens overall.
