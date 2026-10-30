import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Scenario inputs chosen for a model, not measured fixtures or provider usage.
const TEST_PROFILES = [
  { name: 'Tiny (10 lines)', lines: 10, rawBytes: 850, noisePercent: 0.30 },
  { name: 'Small (40 lines)', lines: 40, rawBytes: 3200, noisePercent: 0.65 },
  { name: 'Medium (120 lines - typical Jest)', lines: 120, rawBytes: 9800, noisePercent: 0.85 },
  { name: 'Large (350 lines - noisy suite)', lines: 350, rawBytes: 28500, noisePercent: 0.94 },
  { name: 'Heavy (800 lines - capped monorepo)', lines: 800, rawBytes: 65535, noisePercent: 0.97 },
];

// Helper: Calculate JSON envelope overhead
const JSON_BASE_OVERHEAD = 450; // Candidate metadata, timestamps, flags
const SURGICAL_EXTRACT_SIZE = 380; // Test name, file:line, diff, assertion message

function computeTurnPayload(profile, strategy, drilldownCalled = false) {
  const { rawBytes, noisePercent } = profile;
  const usefulDiagnosticBytes = Math.round(rawBytes * (1 - noisePercent));
  const compactSummaryBytes = Math.min(SURGICAL_EXTRACT_SIZE, usefulDiagnosticBytes);

  switch (strategy) {
    case 'raw':
      // v0.2.0: JSON envelope + raw error text (capped at 2000 in v0.2, or full in baseline)
      return JSON_BASE_OVERHEAD + Math.min(rawBytes, 2000);

    case 'raw_uncapped':
      return JSON_BASE_OVERHEAD + rawBytes;

    case 'dual_current':
      // Current v0.3.0: JSON envelope + compact summary + full rawOutput
      return JSON_BASE_OVERHEAD + compactSummaryBytes + rawBytes + 120; // +120 for JSON keys

    case 'pure_compact':
      // Sieve only (no raw duplicate)
      return JSON_BASE_OVERHEAD + compactSummaryBytes;

    case 'two_tier':
      // Two-Tier: Summary + Log handle
      const baseTier1 = JSON_BASE_OVERHEAD + compactSummaryBytes + 40; // log handle
      if (drilldownCalled) {
        // Agent requests tail/lines
        const drilldownPayload = 300 + Math.min(rawBytes, 4000);
        return baseTier1 + drilldownPayload;
      }
      return baseTier1;

    default:
      throw new Error(`Unknown strategy ${strategy}`);
  }
}

// Compute cumulative context across N turns
// In multi-turn assistant loops, context compounds as sum_{i=1}^N (prompt_fixed + sum_{j=1}^i turn_payload_j)
function computeCumulativeContext(turns, profile, strategy, promptBase = 4000, drilldownRate = 0.25) {
  let activeContextHistory = promptBase;
  let totalBilledTokens = 0;

  for (let turn = 1; turn <= turns; turn++) {
    const drilldown = drilldownRate > 0 && (turn % Math.round(1 / drilldownRate) === 0);
    const turnBytes = computeTurnPayload(profile, strategy, drilldown);
    const turnTokens = Math.ceil(turnBytes / 4);

    activeContextHistory += turnTokens + 250; // +250 for agent response diff
    totalBilledTokens += activeContextHistory;
  }

  return {
    finalActiveContext: activeContextHistory,
    totalBilledAcrossTurns: totalBilledTokens
  };
}

console.log('=== SIMULATION 1: Modeled Single-Turn Payload by Log Profile ===');
console.log('| Profile | Raw (v0.2 Capped 2k) | Dual (Current v0.3) | Pure Compact | Two-Tier (No Fetch) | Two-Tier (With Fetch) |');
console.log('| :--- | :---: | :---: | :---: | :---: | :---: |');

for (const profile of TEST_PROFILES) {
  const raw = computeTurnPayload(profile, 'raw');
  const dual = computeTurnPayload(profile, 'dual_current');
  const pure = computeTurnPayload(profile, 'pure_compact');
  const twoTierNo = computeTurnPayload(profile, 'two_tier', false);
  const twoTierYes = computeTurnPayload(profile, 'two_tier', true);

  console.log(`| ${profile.name} | ${raw} B | ${dual} B (${((dual - raw) / raw * 100).toFixed(1)}%) | ${pure} B (${((pure - raw) / raw * 100).toFixed(1)}%) | ${twoTierNo} B (${((twoTierNo - raw) / raw * 100).toFixed(1)}%) | ${twoTierYes} B |`);
}

console.log('\n=== SIMULATION 2: Modeled Multi-Turn Context (Medium Profile, 4 Turns) ===');
console.log('Profile: 120 lines (~9.8 KB raw test output), 4 debug turns, Base prompt: 4,000 tokens\n');
console.log('| Strategy | Turn 1 | Turn 2 | Turn 3 | Turn 4 | Modeled Cumulative Context | Delta vs Raw |');
console.log('| :--- | :---: | :---: | :---: | :---: | :---: | :---: |');

const medProfile = TEST_PROFILES[2];
for (const strat of ['raw', 'raw_uncapped', 'dual_current', 'pure_compact', 'two_tier']) {
  const t1 = computeCumulativeContext(1, medProfile, strat, 4000, 0.25).finalActiveContext;
  const t2 = computeCumulativeContext(2, medProfile, strat, 4000, 0.25).finalActiveContext;
  const t3 = computeCumulativeContext(3, medProfile, strat, 4000, 0.25).finalActiveContext;
  const t4 = computeCumulativeContext(4, medProfile, strat, 4000, 0.25);

  const rawTotal = computeCumulativeContext(4, medProfile, 'raw', 4000, 0.25).totalBilledAcrossTurns;
  const delta = ((t4.totalBilledAcrossTurns - rawTotal) / rawTotal * 100).toFixed(1);

  console.log(`| ${strat} | ${t1} tks | ${t2} tks | ${t3} tks | ${t4.finalActiveContext} tks | ${t4.totalBilledAcrossTurns} tks | ${delta > 0 ? '+' : ''}${delta}% |`);
}

console.log('\n=== SIMULATION 3: Modeled Crossover Under Fixed Assumptions ===');
console.log('Checking sampled raw output sizes under the chosen constants; this is not a measured universal threshold.\n');

for (let sizeBytes = 200; sizeBytes <= 8000; sizeBytes += 400) {
  const p = { name: `${sizeBytes} B`, lines: Math.round(sizeBytes / 80), rawBytes: sizeBytes, noisePercent: 0.75 };
  const raw = computeTurnPayload(p, 'raw');
  const dual = computeTurnPayload(p, 'dual_current');
  const pure = computeTurnPayload(p, 'pure_compact');
  const twoTier = computeTurnPayload(p, 'two_tier', false);

  const pureSaves = pure < raw;
  const twoTierSaves = twoTier < raw;

  if (sizeBytes === 200 || sizeBytes === 600 || sizeBytes === 1000 || sizeBytes === 1800 || sizeBytes === 2600 || sizeBytes === 5000) {
    console.log(`- At ${sizeBytes} B raw output: Raw=${raw} B | Dual=${dual} B | PureCompact=${pure} B (Save? ${pureSaves}) | TwoTier=${twoTier} B (Save? ${twoTierSaves})`);
  }
}

