import { describe, expect, it } from 'vitest';
import { renderSizeComparison, renderArchiveTimeline } from '../src/report/report-visuals.js';

describe('Report visuals backed by local evidence', () => {
  it('labels file-size bars as estimates and timeline entries as archives, without an efficiency score', () => {
    const size = renderSizeComparison(1206, 1246, 'fr');
    expect(size).toContain('~1');
    expect(size).toContain('pas la consommation d’une tâche');
    expect(renderSizeComparison(null, 1246, 'fr')).not.toContain('<svg');
    const timeline = renderArchiveTimeline([{ id: 'one', date: '2026-10-24T01:20:19Z', git: '<unsafe>' }], 'fr', 'Europe/Paris');
    expect(timeline).toContain('&lt;unsafe&gt;');
    expect(timeline).not.toContain('<unsafe>');
    expect(timeline).toContain('ne représente pas une courbe de gain');
    expect(timeline).not.toContain('100%');
  });
});
