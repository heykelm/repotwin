export type EvidenceKind = 'observed' | 'derived' | 'heuristic';
export type FindingStatus = 'confirmed' | 'suspected' | 'false_positive' | 'unverifiable';

export type TokenUsageSource = 'provider' | 'adapter' | 'estimate' | 'unavailable';

export interface TokenUsage {
  input?: number;
  output?: number;
  cachedInput?: number;
  reasoning?: number;
  total?: number;
  source: TokenUsageSource;
  semantics?: string; // documents overlap/subset rules per provider
}

export type RunStatus = 'success' | 'failure' | 'timeout' | 'budget_exceeded' | 'invalid';
export type TraceCompleteness = 'complete' | 'partial' | 'unknown';

export interface AgentRun {
  schemaVersion: string;
  runId: string;
  taskId: string;
  repositoryFingerprint: string;
  commitSha: string;
  variant: 'baseline' | 'candidate';
  agentName: string;
  modelId: string;
  adapterVersion: string;
  startedAt: string;
  endedAt?: string;
  status: RunStatus;
  tokens: TokenUsage;
  durationMs?: number;
  toolCalls?: number;
  filesRead?: string[];
  validation: {
    commands: string[];
    passed: boolean;
    details?: string[];
  };
  traceCompleteness: TraceCompleteness;
  artifacts: {
    tracePath?: string;
    diffPath?: string;
    logPath?: string;
  };
}

export interface Finding {
  id: string;
  ruleId: string;
  severity: 'info' | 'low' | 'medium' | 'high';
  evidenceKind: EvidenceKind;
  status: FindingStatus;
  summary: string;
  locations: Array<{ path: string; line?: number }>;
  supportingRunIds?: string[];
  explanation: string;
  suggestedAction?: string;
}

export interface RepositorySnapshot {
  schemaVersion: string;
  repoPath: string;
  commitSha: string;
  branch: string;
  isDirty: boolean;
  fingerprint: string;
  scannedAt: string;
  subprojects: Array<{
    name: string;
    relPath: string;
    kind: string;
    testScript?: string;
  }>;
  instructionFiles: Array<{
    path: string;
    sizeBytes: number;
    linesCount: number;
  }>;
  findings: Finding[];
}

export interface TaskDefinition {
  schemaVersion: string;
  id: string;
  description: string;
  baseCommit?: string;
  agent?: {
    adapter?: string;
    model?: string;
    config?: string;
  };
  limits?: {
    maxWallTimeSeconds?: number;
    maxTokens?: number;
    maxEstimatedCostUsd?: number;
    maxToolCalls?: number;
  };
  validation: {
    commands: string[];
    required: boolean;
  };
  expected?: {
    changedPaths?: string[];
  };
}

export interface ExperimentSuite {
  schemaVersion: string;
  suiteId: string;
  description?: string;
  tasks: TaskDefinition[];
}
