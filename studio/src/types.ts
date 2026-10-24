export type WorkflowStep = 'idle' | 'created' | 'failed' | 'verified' | 'applied';
export type WorkflowStage = 'diagnostic' | 'proposal' | 'verification' | 'application';

export interface ValidationCommand {
  id: string;
  project: string;
  relPath: string;
  kind: 'install' | 'test' | 'lint' | 'build';
  executable: string;
  args: string[];
  display: string;
}

export interface ValidationResult extends ValidationCommand {
  status: 'passed' | 'failed' | 'timed-out' | 'unavailable' | 'running';
  exitCode?: number | null;
  durationMs?: number;
  output?: string;
  outputTruncated?: boolean;
}

export interface Finding {
  line?: number;
  severity: string;
  rule: string;
  message: string;
  file: string;
  fix?: string;
}

export interface Subproject {
  name: string;
  relPath: string;
  kind: string;
  isSubmodule: boolean;
  testScript?: string;
  lintScript?: string;
  buildScript?: string;
}

export interface StudioPayload {
  ok: true;
  sessionToken: string;
  repo: { name: string; path: string; branch: string; commit: string; port: number; analyzedAt: string };
  analysis: {
    subprojects: Subproject[];
    falsePositives: Array<{ classification: string; targetRef?: string; explanation: string; raw: Finding }>;
    trueIssues: Array<{ classification: string; explanation: string; raw: Finding }>;
    scores: { evaluated: boolean; rawScore: number; rawGrade: string; correctedScore: number; correctedGrade: string };
    recipe: { agentsMdContent: string; agentReadyJsonContent: string };
    instructionAudit: {
      findings: Finding[];
      scores: { correctedScore: number; correctedGrade: string };
      consistency: { files: Array<{ path?: string }>; findings: Finding[]; limits?: Record<string, unknown> };
    };
    metrics: { currentInstructionTokens: number; proposedInstructionTokens: number };
  };
  state: {
    step: WorkflowStep;
    twinPath: string;
    validationPlan: ValidationCommand[];
    scriptBodies: Record<string, string>;
    consentToken: string;
    commandResults: ValidationResult[];
    diff: string;
    verification?: { score: number; grade: string; resolved: number; introduced: number; passed: boolean; durationMs: number };
    appliedSnapshot?: any;
  };
}

export interface VerificationResult {
  passed: boolean;
  canApply: boolean;
  noRegression: boolean;
  before: { scores: { correctedScore: number } };
  after: { scores: { correctedScore: number; correctedGrade: string }; findings: Finding[] };
  introduced: Finding[];
  resolved: Finding[];
  commandResults: ValidationResult[];
  commandsPassed: boolean;
  candidateIntact: boolean;
  cleanedArtifacts: string[];
  cleanupError?: string;
  testsExecuted: boolean;
}
