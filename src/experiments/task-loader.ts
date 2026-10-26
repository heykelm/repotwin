import fs from 'node:fs';
import path from 'node:path';
import { ExperimentSuite, TaskDefinition } from '../types/contracts.js';

export function loadTaskSuite(filePath: string): ExperimentSuite {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Suite file not found at: ${resolved}`);
  }

  const raw = fs.readFileSync(resolved, 'utf-8');
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    // If not valid JSON, try rudimentary JSON/YAML parsing or throw
    throw new Error(`Failed to parse suite file at ${resolved}. Please provide valid JSON suite file.`);
  }

  const suiteObj = parsed as Partial<ExperimentSuite>;
  if (!Array.isArray(suiteObj.tasks) || suiteObj.tasks.length === 0) {
    throw new Error(`Suite file at ${resolved} must contain a non-empty 'tasks' array.`);
  }

  const tasks: TaskDefinition[] = suiteObj.tasks.map((t, idx) => {
    if (!t.id) throw new Error(`Task at index ${idx} is missing required 'id'`);
    return {
      schemaVersion: '1',
      id: String(t.id),
      description: t.description ? String(t.description) : `Task ${t.id}`,
      baseCommit: t.baseCommit,
      agent: t.agent,
      limits: t.limits || {
        maxWallTimeSeconds: 600,
        maxTokens: 100000,
        maxToolCalls: 100
      },
      validation: {
        commands: Array.isArray(t.validation?.commands) ? t.validation.commands : ['npm test'],
        required: t.validation?.required !== false
      },
      expected: t.expected
    };
  });

  return {
    schemaVersion: '1',
    suiteId: suiteObj.suiteId || path.basename(filePath, path.extname(filePath)),
    description: suiteObj.description,
    tasks
  };
}
