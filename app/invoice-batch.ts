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
