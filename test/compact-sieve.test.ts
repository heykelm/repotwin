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
  it('retains multiple Go assertions and Cargo assertion values', () => {
    const go = sieveCommandOutput(`--- FAIL: TestPrices (0.00s)
    price_test.go:42: expected 100, got 200
    price_test.go:43: expected EUR, got USD
FAIL`, 'test', 'failed');
    expect(go.compactOutput).toContain('expected 100, got 200');
    expect(go.compactOutput).toContain('expected EUR, got USD');
    const cargo = sieveCommandOutput(`test tests::price ... FAILED
thread 'tests::price' panicked at src/lib.rs:42:5:
assertion \`left == right\` failed
  left: 200
 right: 100
failures:
    tests::price`, 'test', 'failed');
    expect(cargo.compactOutput).toContain('received: 200');
    expect(cargo.compactOutput).toContain('expected: 100');
  });

  it('deduplicates node:test announcements and keeps the comparison in the summary', () => {
    const output = `✖ authorization rejects wrong status (0.6ms)
ℹ tests 1
ℹ fail 1

✖ failing tests:

test at suite.test.cjs:3:1
✖ authorization rejects wrong status (0.6ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  401 !== 200

      at TestContext.<anonymous> (suite.test.cjs:3:60) {
    generatedMessage: true,
    actual: 401,
    expected: 200,
    operator: 'strictEqual',
    diff: 'simple'
  }`;
    const result = sieveCommandOutput(output, 'test', 'failed');
    expect(result.failures).toHaveLength(1);
    expect(result.summary).toContain('1 failure');
    expect(result.compactOutput).toContain('401');
    expect(result.compactOutput).toContain('200');
    expect(result.failures[0]).toMatchObject({ expected: '200', received: '401' });
  });

  it('keeps the historical Jest URL mismatch once with complete operands', () => {
    // Reduced verbatim failure section from
    // docs/benchmarks/historical-link-comparison-2026-10-30/runs/summary/artifacts/1.raw.txt.
    const output = `  console.warn
    [FCM] FIREBASE_SERVICE_ACCOUNT not configured, push notifications disabled

FAIL __tests__/services/serviceRequestNotifications.test.js
  ✓ client outgoing messages never queue email notifications to client contact_email
  ✕ artisan incoming messages queue email notification to client contact_email (2 ms)

  ● artisan incoming messages queue email notification to client contact_email

    expect(received).toBe(expected) // Object.is equality

    Expected: "https://services.nicehub.app/demande/secret-token-42"
    Received: "https://services.nicehub.app/intervention/42"

      at Object.<anonymous> (__tests__/services/serviceRequestNotifications.test.js:157:38)

PASS __tests__/services/serviceRequestRules.test.js
Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 20 passed, 21 total`;
    const result = sieveCommandOutput(output, 'test', 'failed');
    expect(result.failures).toHaveLength(1);
    expect(result.summary).toContain('1 failure');
    expect(result.failures[0]).toMatchObject({
      testName: 'artisan incoming messages queue email notification to client contact_email',
      file: '__tests__/services/serviceRequestNotifications.test.js',
      line: 157,
      expected: '"https://services.nicehub.app/demande/secret-token-42"',
      received: '"https://services.nicehub.app/intervention/42"'
    });
    expect(result.compactOutput).toContain('https://services.nicehub.app/demande/secret-token-42');
    expect(result.compactOutput).toContain('https://services.nicehub.app/intervention/42');
    expect(result.compactOutput).not.toContain('FIREBASE_SERVICE_ACCOUNT');
  });

  it('keeps distinct Jest failures even when two files use the same test title', () => {
    const output = `FAIL test/orders.test.js
  ✕ saves expected value (2 ms)
  ✕ reports denied access (1 ms)

  ● saves expected value
    Expected: "ORDER_EXPECTED"
    Received: "ORDER_ACTUAL"
      at Object.<anonymous> (test/orders.test.js:12:3)

  ● reports denied access
    Expected: 403
    Received: 200
      at Object.<anonymous> (test/orders.test.js:20:3)

FAIL test/invoices.test.js
  ✕ saves expected value (3 ms)
  ● saves expected value
    Expected: "INVOICE_EXPECTED"
    Received: "INVOICE_ACTUAL"
      at Object.<anonymous> (test/invoices.test.js:8:3)

Tests: 3 failed, 0 passed, 3 total`;
    const result = sieveCommandOutput(output, 'test', 'failed');
    expect(result.failures).toHaveLength(3);
    expect(result.failures.map(f => [f.file, f.testName, f.expected, f.received])).toEqual([
      ['test/orders.test.js', 'saves expected value', '"ORDER_EXPECTED"', '"ORDER_ACTUAL"'],
      ['test/orders.test.js', 'reports denied access', '403', '200'],
      ['test/invoices.test.js', 'saves expected value', '"INVOICE_EXPECTED"', '"INVOICE_ACTUAL"']
    ]);
    expect(result.summary).toContain('3 failures');
  });

  it('retains a bounded raw tail when a recognized test title has no usable diagnostic', () => {
    const output = `FAIL test/opaque.test.js
  ✕ opaque failure (1 ms)
  runner detail: remote worker stopped before assertion output
Tests: 1 failed, 0 passed, 1 total`;
    const result = sieveCommandOutput(output, 'test', 'failed');
    expect(result.failures).toHaveLength(1);
    expect(result.compactOutput).toContain('Diagnostic output:');
    expect(result.compactOutput).toContain('remote worker stopped before assertion output');
  });

});

