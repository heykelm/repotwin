import { describe, it, expect } from 'vitest';
import { normalizeAgentTrace } from '../src/traces/trace-parser.js';
import { redactSensitiveText, sanitizeObject } from '../src/traces/redactor.js';

describe('Trace Ingestion and Redactor (RFC-002)', () => {
  it('redacts API keys and bearer tokens from sensitive text', () => {
    const raw = 'Calling Anthropic with key sk-ant-api03-1234567890abcdef1234567890 and Bearer eyJhbGciOiJIUzI1NiJ9.testToken';
    const redacted = redactSensitiveText(raw);
    expect(redacted).not.toContain('sk-ant-api03-1234567890abcdef1234567890');
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(redacted).toContain('[REDACTED_ANTHROPIC_KEY]');
    expect(redacted).toContain('Bearer [REDACTED_BEARER_TOKEN]');
  });

  it('sanitizes objects with password/secret fields', () => {
    const obj = {
      user: 'alice',
      apiKey: 'sk-123456789012345678901234',
      nested: {
        token: 'ghp_123456789012345678901234567890123456'
      }
    };
    const sanitized = sanitizeObject(obj);
    expect(sanitized.apiKey).toBe('[REDACTED]');
    expect(sanitized.nested.token).toBe('[REDACTED]');
  });

  it('marks missing token usage as unavailable without inventing zero or estimates', () => {
    const trace = normalizeAgentTrace({
      runId: 'test-run-1',
      taskId: 'task-a',
      status: 'success'
    });

    expect(trace.tokens.source).toBe('unavailable');
    expect(trace.tokens.total).toBeUndefined();
    expect(trace.traceCompleteness).toBe('partial');
  });

  it('preserves provider token provenance and calculates total when explicit', () => {
    const trace = normalizeAgentTrace({
      runId: 'test-run-2',
      taskId: 'task-b',
      status: 'success',
      tokens: {
        input: 1200,
        output: 300,
        cachedInput: 800,
        source: 'provider'
      },
      validation: {
        commands: ['npm test'],
        passed: true
      }
    });

    expect(trace.tokens.source).toBe('provider');
    expect(trace.tokens.total).toBe(1500);
    expect(trace.tokens.cachedInput).toBe(800);
    expect(trace.status).toBe('success');
    expect(trace.traceCompleteness).toBe('complete');
  });
});
