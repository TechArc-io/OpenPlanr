import { describe, expect, it } from 'vitest';
import type { LinearMappingTableRow } from '../src/models/types.js';
import { formatLinearMappingTable } from '../src/services/linear-mapping-service.js';

describe('formatLinearMappingTable', () => {
  it('renders column headers and rows', () => {
    const rows: LinearMappingTableRow[] = [
      {
        kind: 'epic',
        openPlanrId: 'EPIC-001',
        linearIdentifier: 'my-proj',
        linearUrl: 'https://linear.app/p/1',
        lastKnownState: '—',
      },
      {
        kind: 'feature',
        openPlanrId: 'FEAT-001',
        linearIdentifier: 'ENG-12',
        linearUrl: 'https://linear.app/i/1',
        lastKnownState: 'in-progress',
        note: 'stale-id (value looks like a workflow state id; re-run `planr linear push`)',
      },
    ];
    const out = formatLinearMappingTable(rows);
    expect(out).toContain('EPIC-001');
    expect(out).toContain('FEAT-001');
    expect(out).toContain('OpenPlanr id');
    expect(out).toContain('stale-id');
  });
});
