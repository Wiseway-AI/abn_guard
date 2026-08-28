export const VLM_MAX_PAGES = 4;
export const VLM_MAX_DOCUMENT_PAGES = 40;
export const VLM_MAX_IMAGE_EDGE = 1280;

export type VlmDocumentEntity = {
  abn: string;
  entityName: string;
  address: string;
  gstRegisteredClaim: boolean | null;
  page: number | null;
  confidence: number;
  evidence: string;
};

export type VlmBankDetails = {
  accountName: string;
  bsb: string;
  accountNumber: string;
  bankName: string;
  page: number | null;
  confidence: number;
};

export type VlmDocumentExtraction = {
  documentType: string;
  entities: VlmDocumentEntity[];
  bankDetails: VlmBankDetails | null;
  confidence: number;
  warnings: string[];
};

export type PdfTextAssessment = {
  needsVlm: boolean;
  reasons: string[];
  nonWhitespaceCharacters: number;
  validAbns: string[];
};

function digits(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).replace(/\D/g, "") : "";
}

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function confidence(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
}

function pageNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 999 ? parsed : null;
}

function booleanClaim(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (/^(true|yes|registered)$/i.test(value.trim())) return true;
    if (/^(false|no|not registered|unregistered)$/i.test(value.trim())) return false;
  }
  return null;
}

export function isValidAustralianAbn(value: string) {
  const abn = digits(value);
  if (!/^\d{11}$/.test(abn)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const total = abn.split("").reduce((sum, digit, index) => sum + (Number(digit) - (index === 0 ? 1 : 0)) * weights[index], 0);
  return total % 89 === 0;
}

export function assessPdfText(pageTexts: string[]): PdfTextAssessment {
  const combined = pageTexts.join("\n");
  const compact = combined.replace(/\s/g, "");
  const readable = combined.match(/[A-Za-z0-9]/g)?.length ?? 0;
  const candidates = combined.match(/(?<!\d)(?:\d[\s.-]?){10}\d(?!\d)/g) ?? [];
  const validAbns = [...new Set(candidates.map(digits).filter(isValidAustralianAbn))];
  const reasons: string[] = [];

  if (compact.length < 120) reasons.push("The PDF has little or no embedded text");
  if (compact.length && readable / compact.length < 0.35) reasons.push("The extracted text is mostly unreadable symbols");
  if (!validAbns.length) reasons.push("No checksum-valid ABN was found in the embedded text");

  return {
    needsVlm: reasons.length > 0,
    reasons,
    nonWhitespaceCharacters: compact.length,
    validAbns,
  };
}

export function selectVlmPageNumbers(totalPages: number, maximum = VLM_MAX_DOCUMENT_PAGES) {
  if (totalPages <= 0 || maximum <= 0) return [];
  return Array.from({ length: Math.min(totalPages, maximum) }, (_, index) => index + 1);
}

export function normalizeVlmExtraction(value: unknown): VlmDocumentExtraction {
  const outer = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const source = outer.extraction && typeof outer.extraction === "object" ? outer.extraction as Record<string, unknown> : outer;
  const rawEntities = Array.isArray(source.entities) ? source.entities : [];
  const seen = new Set<string>();
  const entities = rawEntities.flatMap((item): VlmDocumentEntity[] => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    const abn = digits(raw.abn);
    if (!isValidAustralianAbn(abn) || seen.has(abn)) return [];
    seen.add(abn);
    return [{
      abn,
      entityName: text(raw.entityName ?? raw.entity_name, 140),
      address: text(raw.address ?? raw.location, 240),
      gstRegisteredClaim: booleanClaim(raw.gstRegisteredClaim ?? raw.gst_registered_claim),
      page: pageNumber(raw.page),
      confidence: confidence(raw.confidence),
      evidence: text(raw.evidence, 240),
    }];
  });

  const rawBank = source.bankDetails && typeof source.bankDetails === "object"
    ? source.bankDetails as Record<string, unknown>
    : source.bank_details && typeof source.bank_details === "object"
      ? source.bank_details as Record<string, unknown>
      : null;
  const bsb = digits(rawBank?.bsb);
  const accountNumber = digits(rawBank?.accountNumber ?? rawBank?.account_number);
  const bankDetails = rawBank && ((bsb.length === 6) || (accountNumber.length >= 4 && accountNumber.length <= 20)) ? {
    accountName: text(rawBank.accountName ?? rawBank.account_name, 100),
    bsb: bsb.length === 6 ? bsb : "",
    accountNumber: accountNumber.length >= 4 && accountNumber.length <= 20 ? accountNumber : "",
    bankName: text(rawBank.bankName ?? rawBank.bank_name, 100),
    page: pageNumber(rawBank.page),
    confidence: confidence(rawBank.confidence),
  } satisfies VlmBankDetails : null;

  return {
    documentType: text(source.documentType ?? source.document_type, 60) || "unknown",
    entities,
    bankDetails,
    confidence: confidence(source.confidence),
    warnings: (Array.isArray(source.warnings) ? source.warnings : []).map((warning) => text(warning, 240)).filter(Boolean).slice(0, 10),
  };
}

export function vlmExtractionToText(extraction: VlmDocumentExtraction) {
  const entityText = extraction.entities.map((entity) => {
    const gst = entity.gstRegisteredClaim === null ? "" : entity.gstRegisteredClaim ? "GST Registered" : "Not registered for GST";
    return ["Invoice Entity", entity.entityName, `ABN: ${entity.abn}`, entity.address, gst].filter(Boolean).join("\n");
  }).join("\n\n");
  const bank = extraction.bankDetails?.confidence && extraction.bankDetails.confidence >= 0.7 ? extraction.bankDetails : null;
  const bankText = bank ? [
    "Payment Details",
    bank.accountName && `Account Name: ${bank.accountName}`,
    bank.bankName && `Bank Name: ${bank.bankName}`,
    bank.bsb && `BSB: ${bank.bsb}`,
    bank.accountNumber && `Account Number: ${bank.accountNumber}`,
  ].filter(Boolean).join("\n") : "";
  return [entityText, bankText].filter(Boolean).join("\n\n");
}

export function mergeVlmExtractions(extractions: VlmDocumentExtraction[]): VlmDocumentExtraction {
  const entities = new Map<string, VlmDocumentEntity>();
  extractions.flatMap((extraction) => extraction.entities).forEach((entity) => {
    const existing = entities.get(entity.abn);
    if (!existing) {
      entities.set(entity.abn, entity);
      return;
    }
    const preferred = entity.confidence > existing.confidence ? entity : existing;
    const alternative = preferred === entity ? existing : entity;
    entities.set(entity.abn, {
      ...preferred,
      entityName: preferred.entityName || alternative.entityName,
      address: preferred.address || alternative.address,
      evidence: preferred.evidence || alternative.evidence,
      page: preferred.page ?? alternative.page,
      confidence: Math.max(preferred.confidence, alternative.confidence),
    });
  });
  const bankDetails = extractions.map((extraction) => extraction.bankDetails).filter((details): details is VlmBankDetails => Boolean(details))
    .sort((left, right) => right.confidence - left.confidence)[0] ?? null;
  const confidenceValues = extractions.map((extraction) => extraction.confidence).filter((value) => value > 0);
  return {
    documentType: extractions.map((extraction) => extraction.documentType).find((type) => type && type !== "unknown") || "unknown",
    entities: [...entities.values()],
    bankDetails,
    confidence: confidenceValues.length ? Math.min(...confidenceValues) : 0,
    warnings: [...new Set(extractions.flatMap((extraction) => extraction.warnings))].slice(0, 10),
  };
}
