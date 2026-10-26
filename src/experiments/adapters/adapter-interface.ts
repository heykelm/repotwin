import { AgentRun, TaskDefinition } from '../../types/contracts.js';

export interface AgentAdapterContext {
  worktreePath: string;
  variant: 'baseline' | 'candidate';
  task: TaskDefinition;
  experimentId: string;
  commitSha: string;
  fingerprint: string;
  trialIndex: number;
}

export interface AgentAdapter {
  readonly name: string;
  readonly version: string;

  executeTask(context: AgentAdapterContext): Promise<AgentRun>;
}
