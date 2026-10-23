import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseAgentReport } from '../src/analyzer/report-parser.js';

const paths: string[] = [];

function fixture(content: string): string {
  const target = path.join(os.tmpdir(), `repotwin-report-${Date.now()}-${paths.length}.json`);
  fs.writeFileSync(target, content);
  paths.push(target);
  return target;
}

afterEach(() => {
  for (const target of paths.splice(0)) fs.rmSync(target, { force: true });
});

describe('report parser', () => {
  it('rejects malformed JSON rather than silently treating it as markdown', () => {
    expect(() => parseAgentReport(fixture('{"findings": "not-an-array"}'))).toThrow('Invalid JSON report');
  });

  it('validates a JSON finding', () => {
    const result = parseAgentReport(fixture('[{"severity":"warning","rule":"test","message":"m","file":"f","fix":"x"}]'));
    expect(result).toHaveLength(1);
    expect(result[0]?.rule).toBe('test');
  });
});
