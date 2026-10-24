export type Severity = 'error' | 'warning' | 'info';

export type RefClassification =
  | 'EXISTS_ROOT'
  | 'EXISTS_RULE_SCOPE'
  | 'EXISTS_SUBPROJECT'
  | 'EXISTS_SINGLE_MATCH'
  | 'SQL_DATABASE_ENTITY'
  | 'PATH_ALIAS'
  | 'PATTERN_OR_I18N'
  | 'IGNORED_FILE'
  | 'MISSING_SAFETY'
  | 'MISSING_VERIFICATION'
  | 'RULE_DRIFT'
  | 'GENUINE_STALE_PATH'
  | 'UNKNOWN';

export interface RawFinding {
  line?: number;
  severity: Severity;
  rule: string;
  message: string;
  file: string;
  fix: string;
}

export interface ProcessedFinding {
  raw: RawFinding;
  targetRef?: string;
  classification: RefClassification;
  isFalsePositive: boolean;
  confidence: number; // 0.0 to 1.0
  explanation: string;
  suggestedAction?: string;
  resolvedPath?: string;
}

export interface SubprojectInfo {
  name: string;
  relPath: string;
  absPath: string;
  kind: 'node' | 'flutter' | 'python' | 'go' | 'rust' | 'unknown';
  isSubmodule: boolean;
  testScript?: string;
  buildScript?: string;
  lintScript?: string;
}

export interface RuleMeta {
  file: string;
  globs?: string[];
  alwaysApply?: boolean;
  description?: string;
}

export interface AnalysisReport {
  repoPath: string;
  subprojects: SubprojectInfo[];
  rules: RuleMeta[];
  totalRawFindings: number;
  falsePositivesCount: number;
  truePositivesCount: number;
  infoCount: number;
  findings: ProcessedFinding[];
}
