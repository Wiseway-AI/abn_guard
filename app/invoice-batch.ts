export const MAX_INVOICE_BATCH_FILES = 10;

export function selectInvoiceBatchFiles<T>(existingCount: number, files: T[]) {
  const availableSlots = Math.max(0, MAX_INVOICE_BATCH_FILES - Math.max(0, existingCount));
  return {
    accepted: files.slice(0, availableSlots),
    rejectedCount: Math.max(0, files.length - availableSlots),
  };
}

export function filesWithoutAbn<T extends { abns: string[] }>(documents: T[]) {
  return documents.filter((document) => document.abns.length === 0);
}

export function groupVerificationChecksByFile<T extends { id: string; fileIds: string[] }>(checks: T[]) {
  const groups = new Map<string, T[]>();
  checks.forEach((check) => {
    const fileKey = check.fileIds[0] || `check:${check.id}`;
    groups.set(fileKey, [...(groups.get(fileKey) ?? []), check]);
  });
  return [...groups.values()];
}

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
