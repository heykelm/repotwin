import { ExperimentSuite, AgentRun } from '../types/contracts.js';
import { AgentAdapter } from './adapters/adapter-interface.js';
import { createExperimentTwinPair, CandidatePatchInput } from '../twin/experiment-twins.js';
import { getGitInfo, computeRepositoryFingerprint } from '../analysis/inspector.js';

export interface ExperimentRunOptions {
  trialsPerTask?: number;
  candidatePatch?: CandidatePatchInput;
  baseCommit?: string;
  onProgress?: (run: AgentRun, current: number, total: number) => void;
}

export interface ExperimentRunResult {
  experimentId: string;
  suiteId: string;
  baseCommit: string;
  runs: AgentRun[];
}

export async function runExperimentSuite(
  repoPath: string,
  suite: ExperimentSuite,
  adapter: AgentAdapter,
  options: ExperimentRunOptions = {}
): Promise<ExperimentRunResult> {
  const trialsCount = options.trialsPerTask ?? 3;
  const gitInfo = getGitInfo(repoPath);
  const baseCommit = options.baseCommit || gitInfo.commitSha;
  const fingerprint = computeRepositoryFingerprint(repoPath, baseCommit);

  const allRuns: AgentRun[] = [];
  const totalExecutions = suite.tasks.length * trialsCount * 2;
  let executionIndex = 0;

  for (const task of suite.tasks) {
    // Create twin pair for this task
    const twins = createExperimentTwinPair(repoPath, task.baseCommit || baseCommit, options.candidatePatch);

    try {
      for (let trial = 0; trial < trialsCount; trial++) {
        // Counterbalance order: even trials run baseline first, odd trials run candidate first
        const variants: Array<'baseline' | 'candidate'> = trial % 2 === 0
          ? ['baseline', 'candidate']
          : ['candidate', 'baseline'];

        for (const variant of variants) {
          executionIndex++;
          const worktreePath = variant === 'baseline' ? twins.baselinePath : twins.candidatePath;

          const run = await adapter.executeTask({
            worktreePath,
            variant,
            task,
            experimentId: twins.experimentId,
            commitSha: baseCommit,
            fingerprint,
            trialIndex: trial
          });

          allRuns.push(run);
          options.onProgress?.(run, executionIndex, totalExecutions);
        }
      }
    } finally {
      twins.clean();
    }
  }

  return {
    experimentId: `suite-run-${Date.now()}`,
    suiteId: suite.suiteId,
    baseCommit,
    runs: allRuns
  };
}
