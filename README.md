# RepoTwin

RepoTwin analyses external agent reports against a repository and can create a
separate Git worktree containing a proposed instruction-file recipe.

## Safety model

- `analyze` is read-only unless `--html` is explicitly selected.
- `fix` previews changes by default. It writes only with `--apply`.
- `twin create` creates an isolated Git worktree. `twin clean` removes only
  clean worktrees created inside RepoTwin's managed cache directory.
- Repo paths are passed directly to Git without a shell.

## Usage

```bash
repotwin analyze /path/to/repo --from-report audit.json --json
repotwin fix /path/to/repo
repotwin fix /path/to/repo --apply
repotwin twin create /path/to/repo
repotwin twin clean /path/to/repo
```
