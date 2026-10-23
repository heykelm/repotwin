import { describe, it, expect } from 'vitest';
import { disambiguateFinding, extractTargetRef } from '../src/diagnostics/disambiguator.js';
import { RawFinding, RuleMeta, SubprojectInfo } from '../src/types/index.js';

describe('RepoTwin Disambiguator', () => {
  const dummyFileSet = new Set<string>([
    'backend/src/middleware/auth.js',
    'backend/src/services/payment.js',
    'frontend/lib/translations.ts',
    'migrations/073_b2b_providers_v1.sql'
  ]);

  const dummyRules = new Map<string, RuleMeta>([
    [
      '.cursor/rules/backend-api.mdc',
      {
        file: '.cursor/rules/backend-api.mdc',
        globs: ['backend/src/**/*']
      }
    ]
  ]);

  const dummySubprojects: SubprojectInfo[] = [
    {
      name: 'backend',
      relPath: 'backend',
      absPath: '/dummy/backend',
      kind: 'node',
      isSubmodule: true,
      testScript: 'npm test'
    },
    {
      name: 'frontend',
      relPath: 'frontend',
      absPath: '/dummy/frontend',
      kind: 'node',
      isSubmodule: true,
      testScript: 'npm run test'
    }
  ];

  const ctx = {
    fileSet: dummyFileSet,
    rules: dummyRules,
    subprojects: dummySubprojects,
    knownTables: new Set(['rides'])
  };

  it('extracts targetRef properly from agent-ready message', () => {
    const msg = '.cursor/rules/backend-api.mdc references missing path "src/middleware/auth.js".';
    expect(extractTargetRef(msg)).toBe('src/middleware/auth.js');
  });

  it('resolves rule scope relative paths as false positives (e.g. backend-api.mdc)', () => {
    const raw: RawFinding = {
      severity: 'warning',
      rule: 'stale-path-reference',
      message: '.cursor/rules/backend-api.mdc references missing path "src/middleware/auth.js".',
      file: '.cursor/rules/backend-api.mdc',
      fix: 'Update path'
    };

    const res = disambiguateFinding(raw, ctx);
    expect(res.isFalsePositive).toBe(true);
    expect(res.classification).toBe('EXISTS_RULE_SCOPE');
    expect(res.resolvedPath).toBe('backend/src/middleware/auth.js');
  });

  it('classifies SQL table.column references (rides.price) as false positives', () => {
    const raw: RawFinding = {
      severity: 'warning',
      rule: 'stale-path-reference',
      message: '.cursor/rules/b2b-koi.mdc references missing path "rides.price".',
      file: '.cursor/rules/b2b-koi.mdc',
      fix: 'Update path'
    };

    const res = disambiguateFinding(raw, ctx);
    expect(res.isFalsePositive).toBe(true);
    expect(res.classification).toBe('SQL_DATABASE_ENTITY');
  });

  it('classifies i18n wildcards (t.admin.*) as false positives', () => {
    const raw: RawFinding = {
      severity: 'warning',
      rule: 'stale-path-reference',
      message: '.cursor/rules/frontend-admin.mdc references missing path "t.admin.*".',
      file: '.cursor/rules/frontend-admin.mdc',
      fix: 'Update path'
    };

    const res = disambiguateFinding(raw, ctx);
    expect(res.isFalsePositive).toBe(true);
    expect(res.classification).toBe('PATTERN_OR_I18N');
  });

  it('classifies .env as an intentionally gitignored file', () => {
    const raw: RawFinding = {
      severity: 'warning',
      rule: 'stale-path-reference',
      message: '.cursor/rules/backend-db-ops.mdc references missing path ".env".',
      file: '.cursor/rules/backend-db-ops.mdc',
      fix: 'Update path'
    };

    const res = disambiguateFinding(raw, ctx);
    expect(res.isFalsePositive).toBe(true);
    expect(res.classification).toBe('IGNORED_FILE');
  });

  it('matches single basename anywhere in repo (migrations/073_b2b_providers_v1.sql)', () => {
    const raw: RawFinding = {
      severity: 'warning',
      rule: 'stale-path-reference',
      message: '.cursor/rules/backend-db-ops.mdc references missing path "073_b2b_providers_v1.sql".',
      file: '.cursor/rules/backend-db-ops.mdc',
      fix: 'Update path'
    };

    const res = disambiguateFinding(raw, ctx);
    expect(res.isFalsePositive).toBe(true);
    expect(res.classification).toBe('EXISTS_SINGLE_MATCH');
    expect(res.resolvedPath).toBe('migrations/073_b2b_providers_v1.sql');
  });

  it('keeps an unresolved alias as an issue instead of suppressing it', () => {
    const raw: RawFinding = {
      severity: 'warning',
      rule: 'stale-path-reference',
      message: '.cursor/rules/frontend-admin.mdc references missing path "@/missing/component".',
      file: '.cursor/rules/frontend-admin.mdc',
      fix: 'Update path'
    };

    const res = disambiguateFinding(raw, ctx);
    expect(res.isFalsePositive).toBe(false);
    expect(res.classification).toBe('UNKNOWN');
  });
});
