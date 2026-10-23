import path from 'node:path';
import {
  RawFinding,
  ProcessedFinding,
  RuleMeta,
  SubprojectInfo
} from '../types/index.js';

export interface DisambiguationContext {
  fileSet: Set<string>;
  rules: Map<string, RuleMeta>;
  subprojects: SubprojectInfo[];
  knownTables?: Set<string>;
}

/**
 * Extracts the target path or reference string enclosed in quotes from the raw message.
 */
export function extractTargetRef(message: string): string | undefined {
  const match = message.match(/"([^"]+)"/);
  return match ? match[1] : undefined;
}

/**
 * Diagnoses and classifies raw findings into true positives vs false positives.
 */
export function disambiguateFinding(
  raw: RawFinding,
  ctx: DisambiguationContext
): ProcessedFinding {
  const targetRef = extractTargetRef(raw.message);

  // 1. Stale path reference classification
  if (raw.rule === 'stale-path-reference' && targetRef) {
    return classifyPathReference(raw, targetRef, ctx);
  }

  // 2. Missing test command / verification section
  if (raw.rule === 'missing-test-command' || raw.rule === 'missing-verification-section') {
    const hasSubprojectTests = ctx.subprojects.some(s => !!s.testScript);
    return {
      raw,
      targetRef,
      classification: 'MISSING_VERIFICATION',
      isFalsePositive: false,
      confidence: 0.85,
      explanation: hasSubprojectTests
        ? `No root test command, but test scripts exist in subprojects: ${ctx.subprojects.filter(s => s.testScript).map(s => `${s.name} (${s.testScript})`).join(', ')}.`
        : 'No test scripts found in root or subprojects.',
      suggestedAction: 'Document submodule test commands or add root verification script.'
    };
  }

  // 3. Missing safety boundaries
  if (raw.rule === 'missing-safety-section') {
    return {
      raw,
      targetRef,
      classification: 'MISSING_SAFETY',
      isFalsePositive: false,
      confidence: 0.9,
      explanation: 'Instruction document lacks explicit safety constraints (e.g. secret handling, production commands).',
      suggestedAction: 'Add a standard Safety Boundaries section to the central AGENTS.md.'
    };
  }

  // 4. Rule duplication / drift
  if (raw.rule === 'drift-prone-agent-doc') {
    return {
      raw,
      targetRef,
      classification: 'RULE_DRIFT',
      isFalsePositive: false,
      confidence: 0.8,
      explanation: 'Guidance duplicated across multiple agent configuration files.',
      suggestedAction: 'Consolidate into AGENTS.md and point other files to it.'
    };
  }

  // Default fallback
  return {
    raw,
    targetRef,
    classification: 'UNKNOWN',
    isFalsePositive: false,
    confidence: 0.5,
    explanation: raw.message
  };
}

function classifyPathReference(
  raw: RawFinding,
  targetRef: string,
  ctx: DisambiguationContext
): ProcessedFinding {
  const cleanRef = targetRef.trim();

  // Level 1: Exists directly from root
  if (ctx.fileSet.has(cleanRef) || ctx.fileSet.has(cleanRef.replace(/^\//, ''))) {
    return {
      raw,
      targetRef,
      classification: 'EXISTS_ROOT',
      isFalsePositive: true,
      confidence: 1.0,
      resolvedPath: cleanRef,
      explanation: `Path exists directly in the repository.`
    };
  }

  // Level 2: Rule Scope Relative (Frontmatter globs)
  const ruleMeta = ctx.rules.get(raw.file);
  if (ruleMeta?.globs && ruleMeta.globs.length > 0) {
    for (const glob of ruleMeta.globs) {
      // Extract base dir of glob: e.g. "backend/src/**/*" -> "backend"
      const baseDir = glob.split('/')[0];
      if (baseDir && !baseDir.includes('*')) {
        const candidate = `${baseDir}/${cleanRef}`.replace(/\/+/g, '/');
        if (ctx.fileSet.has(candidate)) {
          return {
            raw,
            targetRef,
            classification: 'EXISTS_RULE_SCOPE',
            isFalsePositive: true,
            confidence: 0.98,
            resolvedPath: candidate,
            explanation: `File exists at "${candidate}", correctly scoped by rule glob "${glob}".`
          };
        }
      }
    }
  }

  // Level 3: Exists in one of the discovered subprojects
  for (const sub of ctx.subprojects) {
    const candidate = `${sub.relPath}/${cleanRef}`.replace(/\/+/g, '/');
    if (ctx.fileSet.has(candidate)) {
      return {
        raw,
        targetRef,
        classification: 'EXISTS_SUBPROJECT',
        isFalsePositive: true,
        confidence: 0.95,
        resolvedPath: candidate,
        explanation: `File exists inside subproject "${sub.name}" at "${candidate}".`
      };
    }
  }

  // Level 4: Database column reference (table.column format)
  // Example: rides.price, rides.datetime
  const isDbColumnPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(cleanRef);
  const hasNoExtension = !path.extname(cleanRef) || cleanRef.endsWith('.price') || cleanRef.endsWith('.datetime');
  if (isDbColumnPattern && hasNoExtension && ctx.knownTables?.has(cleanRef.split('.')[0])) {
    const tableName = cleanRef.split('.')[0];
    return {
      raw,
      targetRef,
      classification: 'SQL_DATABASE_ENTITY',
      isFalsePositive: true,
      confidence: 0.95,
      explanation: `Database schema reference (${cleanRef}) mistakenly flagged as a missing file path.`
    };
  }

  // Level 5: Wildcards & i18n patterns (e.g. t.admin.*)
  if (cleanRef.includes('*')) {
    return {
      raw,
      targetRef,
      classification: 'PATTERN_OR_I18N',
      isFalsePositive: true,
      confidence: 0.95,
      explanation: `Pattern / wildcard key reference (${cleanRef}), not a file path.`
    };
  }

  // Level 6: Path aliases (e.g. @/components/entity)
  if (cleanRef.startsWith('@/') || cleanRef.startsWith('~/')) {
    const stripped = cleanRef.replace(/^[@~]\//, '');
    // Try resolving in subprojects (e.g. frontend/src/..., frontend/...)
    for (const sub of ctx.subprojects) {
      for (const prefix of ['', 'src/']) {
        const candidate = `${sub.relPath}/${prefix}${stripped}`.replace(/\/+/g, '/');
        // Check exact or with extensions .ts, .tsx, .js, .jsx
        for (const ext of ['', '.ts', '.tsx', '.js', '.jsx']) {
          const withExt = candidate + ext;
          if (ctx.fileSet.has(withExt)) {
            return {
              raw,
              targetRef,
              classification: 'PATH_ALIAS',
              isFalsePositive: true,
              confidence: 0.9,
              resolvedPath: withExt,
              explanation: `TypeScript alias resolved to "${withExt}".`
            };
          }
        }
      }
    }

    return {
      raw,
      targetRef,
      classification: 'UNKNOWN',
      isFalsePositive: false,
      confidence: 0.45,
      explanation: `Module alias (${cleanRef}) could not be resolved from project configuration.`,
      suggestedAction: 'Verify the alias in tsconfig/jsconfig or update the reference.'
    };
  }

  // Level 7: Environment / Gitignored files (.env)
  if (cleanRef === '.env' || cleanRef.startsWith('.env.')) {
    return {
      raw,
      targetRef,
      classification: 'IGNORED_FILE',
      isFalsePositive: true,
      confidence: 0.9,
      explanation: `Environment configuration file intentionally not committed into Git.`
    };
  }

  // Level 8: Basename match anywhere in the repo
  const basename = path.basename(cleanRef);
  if (basename.length > 3) {
    const matches: string[] = [];
    for (const file of ctx.fileSet) {
      if (path.basename(file) === basename) {
        matches.push(file);
      }
    }

    if (matches.length === 1) {
      return {
        raw,
        targetRef,
        classification: 'EXISTS_SINGLE_MATCH',
        isFalsePositive: true,
        confidence: 0.85,
        resolvedPath: matches[0],
        explanation: `File exists at "${matches[0]}" (referenced without full directory path).`,
        suggestedAction: `Update reference to use relative path "${matches[0]}".`
      };
    }
  }

  // Level 9: Truly stale path
  return {
    raw,
    targetRef,
    classification: 'GENUINE_STALE_PATH',
    isFalsePositive: false,
    confidence: 0.9,
    explanation: `Path does not exist in any root, subproject, or submodule.`,
    suggestedAction: `Remove or update broken reference.`
  };
}
