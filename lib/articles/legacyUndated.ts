/** Four published legacy records have no date in the canonical source export. Never fabricate one. */
const undated = [
  { craftId: 'cf8e0bcd-9e25-c8b1-d5f3-1d48a22b1933', sourceId: '89CE3997-5594-4D09-A37C-0BA7FAE59EDA', slug: 'introducing-the-swsgov-digital-service' },
  { craftId: '80a65712-efe6-9540-3fca-973c3b33a9e2', sourceId: 'F6560B58-2E44-46B2-9FC3-49B2EBCD9E1C', slug: 'government-launches-all-new-swsgov' },
  { craftId: '9fbff837-d2a4-b544-97a2-d793d6b78ba9', sourceId: '17374447-4c21-43f9-9ed6-b3ff4e608b66', slug: 'sws-2026-election-results-absurdists-secure-majority-amidst-shifting-political-landscape' },
  { craftId: '6e683dda-3010-4aa3-a1a5-92aced861315', sourceId: '3fa9138d-7369-7954-7af1-60266aca2c22', slug: 'absurdist-administration-misses-key-glasgow-design-meetup-opportunity' },
];
export function isLegacyUndatedArticle(slug: string, sourceId: string) {
  return undated.some(record => record.slug === slug && (record.sourceId === sourceId || record.craftId === sourceId));
}
