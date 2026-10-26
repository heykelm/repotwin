import fs from 'node:fs';
import { AgentRun, TokenUsage, RunStatus, TraceCompleteness } from '../types/contracts.js';
import { sanitizeObject } from './redactor.js';

export interface RawTraceInput {
  schemaVersion?: string;
  runId?: string;
  taskId?: string;
  repositoryFingerprint?: string;
  commitSha?: string;
  variant?: 'baseline' | 'candidate';
  agentName?: string;
  modelId?: string;
  adapterVersion?: string;
  startedAt?: string;
  endedAt?: string;
  status?: string;
  tokens?: Partial<TokenUsage>;
  durationMs?: number;
  toolCalls?: number;
  filesRead?: string[];
  validation?: {
    commands?: string[];
    passed?: boolean;
    details?: string[];
  };
  events?: Array<{
    type: string;
    timestamp?: string;
    tool?: string;
    path?: string;
    content?: string;
  }>;
}

export function normalizeAgentTrace(raw: RawTraceInput, traceFilePath?: string): AgentRun {
  const sanitized = sanitizeObject(raw);

  const runId = sanitized.runId || `run-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const taskId = sanitized.taskId || 'unnamed-task';
  const repositoryFingerprint = sanitized.repositoryFingerprint || 'unknown-repo';
  const commitSha = sanitized.commitSha || 'unknown-commit';
  const variant = sanitized.variant === 'candidate' ? 'candidate' : 'baseline';
  const agentName = sanitized.agentName || 'unknown-agent';
  const modelId = sanitized.modelId || 'unknown-model';
  const adapterVersion = sanitized.adapterVersion || '1.0.0';
  const startedAt = sanitized.startedAt || new Date().toISOString();
  const endedAt = sanitized.endedAt;

  // Status mapping
  let status: RunStatus = 'invalid';
  if (sanitized.status === 'success') status = 'success';
  else if (sanitized.status === 'failure') status = 'failure';
  else if (sanitized.status === 'timeout') status = 'timeout';
  else if (sanitized.status === 'budget_exceeded') status = 'budget_exceeded';
  else if (sanitized.validation?.passed === true) status = 'success';
  else if (sanitized.validation?.passed === false) status = 'failure';

  // Files read & tool calls from events if not provided explicitly
  let filesRead = Array.isArray(sanitized.filesRead) ? [...sanitized.filesRead] : [];
  let toolCalls = typeof sanitized.toolCalls === 'number' ? sanitized.toolCalls : 0;

  if (Array.isArray(sanitized.events)) {
    for (const ev of sanitized.events) {
      if (ev.tool) toolCalls++;
      if (ev.path && (ev.tool === 'read_file' || ev.tool === 'view_file' || ev.type === 'file_read')) {
        if (!filesRead.includes(ev.path)) filesRead.push(ev.path);
      }
    }
  }

  // Token usage normalization with strict provenance
  let tokens: TokenUsage;
  if (sanitized.tokens && typeof sanitized.tokens === 'object') {
    const rawTokens = sanitized.tokens;
    const hasTotal = typeof rawTokens.total === 'number' && !Number.isNaN(rawTokens.total);
    const hasInput = typeof rawTokens.input === 'number' && !Number.isNaN(rawTokens.input);
    const hasOutput = typeof rawTokens.output === 'number' && !Number.isNaN(rawTokens.output);

    let total = hasTotal ? rawTokens.total : undefined;
    // If total not provided, compute carefully only if both input & output exist
    if (total === undefined && hasInput && hasOutput) {
      total = (rawTokens.input || 0) + (rawTokens.output || 0) + (rawTokens.reasoning || 0);
    }

    tokens = {
      input: hasInput ? rawTokens.input : undefined,
      output: hasOutput ? rawTokens.output : undefined,
      cachedInput: typeof rawTokens.cachedInput === 'number' ? rawTokens.cachedInput : undefined,
      reasoning: typeof rawTokens.reasoning === 'number' ? rawTokens.reasoning : undefined,
      total,
      source: rawTokens.source || (total !== undefined ? 'adapter' : 'unavailable'),
      semantics: rawTokens.semantics
    };
  } else {
    tokens = {
      source: 'unavailable'
    };
  }

  // Trace completeness
  let traceCompleteness: TraceCompleteness = 'complete';
  if (tokens.source === 'unavailable' || !sanitized.validation) {
    traceCompleteness = 'partial';
  }

  return {
    schemaVersion: '1',
    runId,
    taskId,
    repositoryFingerprint,
    commitSha,
    variant,
    agentName,
    modelId,
    adapterVersion,
    startedAt,
    endedAt,
    status,
    tokens,
    durationMs: sanitized.durationMs,
    toolCalls,
    filesRead,
    validation: {
      commands: sanitized.validation?.commands || [],
      passed: Boolean(sanitized.validation?.passed),
      details: sanitized.validation?.details || []
    },
    traceCompleteness,
    artifacts: {
      tracePath: traceFilePath
    }
  };
}

export function importTraceFile(filePath: string): AgentRun {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Trace file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse trace JSON at ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return normalizeAgentTrace(parsed as RawTraceInput, filePath);
}
