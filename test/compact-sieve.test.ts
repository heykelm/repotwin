import { describe, expect, it } from 'vitest';
import {
  sieveCommandOutput,
  extractFailuresFromOutput,
  stripAnsi,
  estimateTokens
} from '../src/verification/compact-sieve.js';

describe('Compact Sieve - Noise reduction & Token preservation', () => {
  it('strips ANSI escape codes cleanly', () => {
    const ansiText = '\u001b[31mFAIL\u001b[39m \u001b[2mtest/auth.test.ts\u001b[22m';
    expect(stripAnsi(ansiText)).toBe('FAIL test/auth.test.ts');
  });

  it('estimates tokens proportionally to character length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefghij')).toBe(3);
  });

  it('compacts realistic successful test runs into a single summary line', () => {
    const rawSuccessOutput = `
      RUN  v1.4.0 /Users/project
      ✓ test/auth.test.ts (4 tests) 12ms
      ✓ test/billing.test.ts (8 tests) 45ms
      ✓ test/user.test.ts (15 tests) 89ms
      ✓ test/api.test.ts (20 tests) 110ms

      Test Files  4 passed (4)
           Tests  47 passed (47)
        Start at  22:15:00
        Duration  1.24s (transform 85ms, setup 0ms, collect 120ms, tests 256ms)
      
      [DeprecationWarning: Buffer() is deprecated due to security...]
      [DeprecationWarning: punycode is deprecated...]
    `;

    const result = sieveCommandOutput(rawSuccessOutput, 'test', 'passed');

    expect(result.status).toBe('passed');
    expect(result.compactOutput).toContain('PASS');
    expect(result.compactOutput).toContain('47 passed');
    expect(result.metrics.savingsPercent).toBeGreaterThan(50);
    expect(result.failures).toHaveLength(0);
  });

  it('surgically extracts Jest/Vitest failure, file, line, and diff while stripping node_modules', () => {
    const rawFailureOutput = `
      RUN  v1.4.0 /Users/project
      ✓ test/auth.test.ts (4 tests) 12ms
      ❯ test/billing.test.ts > Billing Suite > should apply discount (42ms)
        AssertionError: expected 'DISCOUNT_20' to deeply equal 'DISCOUNT_10'
          at Object.<anonymous> (/Users/project/test/billing.test.ts:42:18)
          at file:///Users/project/node_modules/@vitest/runner/dist/index.js:146:14
          at file:///Users/project/node_modules/@vitest/runner/dist/index.js:533:11
          at processTicksAndRejections (node:internal/process/task_queues:95:5)
          at node:internal/modules/cjs/loader:1234:10

      - expected: DISCOUNT_10
      + received: DISCOUNT_20

      Test Files  1 failed | 1 passed (2)
           Tests  1 failed | 4 passed (5)
        Duration  1.42s
    `;

    const result = sieveCommandOutput(rawFailureOutput, 'test', 'failed');

    expect(result.status).toBe('failed');
    expect(result.failures).toHaveLength(1);
    const failure = result.failures[0];
    expect(failure.file).toBe('/Users/project/test/billing.test.ts');
    expect(failure.line).toBe(42);
    expect(failure.message).toContain('expected \'DISCOUNT_20\' to deeply equal \'DISCOUNT_10\'');
    expect(result.compactOutput).toContain('test/billing.test.ts:42');
    expect(result.compactOutput).not.toContain('node_modules');
    expect(result.compactOutput).not.toContain('processTicksAndRejections');
    expect(result.metrics.savingsPercent).toBeGreaterThan(40);
  });

  it('surgically extracts Pytest failure details', () => {
    const rawPytestOutput = `
============================= test session starts ==============================
platform darwin -- Python 3.11.4, pytest-7.4.0, pluggy-1.2.0
rootdir: /Users/project
collected 3 items

tests/test_auth.py .                                                     [ 33%]
tests/test_api.py F                                                      [ 66%]
tests/test_db.py .                                                       [100%]

=================================== FAILURES ===================================
_________________________________ test_get_user ________________________________

    def test_get_user():
>       assert response.status_code == 200
E       AssertionError: assert 404 == 200
E        +  where 404 = <Response [404]>.status_code

tests/test_api.py:28: AssertionError
=========================== short test summary info ============================
FAILED tests/test_api.py::test_get_user - AssertionError: assert 404 == 200
========================= 1 failed, 2 passed in 0.45s ==========================
    `;

    const result = sieveCommandOutput(rawPytestOutput, 'test', 'failed');

    expect(result.status).toBe('failed');
    expect(result.failures.length).toBeGreaterThanOrEqual(1);
    const failure = result.failures.find(f => f.testName === 'test_get_user');
    expect(failure).toBeDefined();
    expect(failure?.file).toBe('tests/test_api.py');
    expect(result.compactOutput).toContain('tests/test_api.py');
    expect(result.compactOutput).toContain('test_get_user');
  });

  it('surgically extracts Go test failures without losing assertion or location', () => {
    const rawGoOutput = `
=== RUN   TestPrice
--- FAIL: TestPrice (0.00s)
    price_test.go:42: expected 100, got 200
FAIL
FAIL\tgithub.com/my/pkg\t0.005s
FAIL
`;
    const result = sieveCommandOutput(rawGoOutput, 'test', 'failed');
    expect(result.status).toBe('failed');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].testName).toBe('TestPrice');
    expect(result.failures[0].file).toBe('price_test.go');
    expect(result.failures[0].line).toBe(42);
    expect(result.failures[0].message).toBe('expected 100, got 200');
    expect(result.compactOutput).toContain('price_test.go:42');
    expect(result.compactOutput).toContain('expected 100, got 200');
  });

  it('captures Jest multiline object diffs without dropping expected/received values', () => {
    const rawJestDiffOutput = `
FAIL test/billing.test.ts
  ● Billing Suite > should calculate price

    expect(received).toEqual(expected)

    - Expected  - 1
    + Received  + 1

      Object {
    -   "price": 100,
    +   "price": 200,
      }

      at Object.<anonymous> (test/billing.test.ts:42:18)

Test Files: 1 failed, 1 total
Tests:      1 failed, 1 total
`;
    const result = sieveCommandOutput(rawJestDiffOutput, 'test', 'failed');
    expect(result.status).toBe('failed');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].file).toBe('test/billing.test.ts');
    expect(result.failures[0].line).toBe(42);
    expect(result.compactOutput).toContain('"price": 100');
    expect(result.compactOutput).toContain('"price": 200');
    expect(result.compactOutput).toContain('test/billing.test.ts:42');
  });

  it('handles empty or unrecognized output without crashing', () => {
    const result = sieveCommandOutput('', 'test', 'failed');
    expect(result.status).toBe('failed');
    expect(result.compactOutput).toContain('FAILED');
    expect(result.metrics.rawCharacters).toBe(0);
  });
});

