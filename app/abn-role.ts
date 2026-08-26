export type AbnDocumentRole = "payee" | "payer" | "unknown";

export type AbnRoleCandidate = {
  abn: string;
  role: AbnDocumentRole;
  confidence: number;
  reasons: string[];
};

export type AbnRoleAnalysis = {
  candidates: AbnRoleCandidate[];
  selectedPayeeAbns: string[];
  requiresReview: boolean;
};

export type AbnVerificationSelection = {
  verificationAbns: string[];
  selectedPayeeAbns: string[];
  skippedOwnAbns: string[];
  excludedNonPayeeAbns: string[];
};

const payerLabels = [
  /\bbill\s+to\b/i,
  /\bcustomer\b/i,
  /\bbuyer\b/i,
  /\binvoice\s+to\b/i,
  /\bship\s+to\b/i,
  /\bsold\s+to\b/i,
  /\brecipient\b/i,
];

const payeeLabels = [
  /\bpayment\s+advice\b/i,
  /\bpayment\s+details?\b/i,
  /\bbank\s+details?\b/i,
  /\bremittance\b/i,
  /\bpay\s+to\b/i,
  /\baccount\s+name\b/i,
  /\bsupplier\b/i,
  /\bvendor\b/i,
  /\bissued\s+by\b/i,
];

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function occurrencesForAbn(text: string, abn: string) {
  return [...text.matchAll(/(?<!\d)(?:\d[\s.-]?){10}\d(?!\d)/g)]
    .filter((match) => onlyDigits(match[0]) === abn)
    .map((match) => match.index ?? 0);
}

function hasNearbyLabel(text: string, index: number, patterns: RegExp[], before = 500, after = 120) {
  const nearby = text.slice(Math.max(0, index - before), Math.min(text.length, index + after));
  return patterns.some((pattern) => pattern.test(nearby));
}

function candidateForAbn(text: string, abn: string, ownAbn: string): AbnRoleCandidate {
  let payerScore = 0;
  let payeeScore = 0;
  const reasons: string[] = [];
  const occurrences = occurrencesForAbn(text, abn);

  occurrences.forEach((index) => {
    const lineStart = text.lastIndexOf("\n", index) + 1;
    const lineEnd = text.indexOf("\n", index);
    const sameLine = text.slice(lineStart, lineEnd < 0 ? text.length : lineEnd);
    const nearby = text.slice(Math.max(0, index - 420), Math.min(text.length, index + 220));

    if (hasNearbyLabel(text, index, payerLabels)) {
      payerScore += 85;
      if (!reasons.includes("Located near customer or billing details")) reasons.push("Located near customer or billing details");
    }
    if (hasNearbyLabel(text, index, payeeLabels)) {
      payeeScore += 70;
      if (!reasons.includes("Located near payment or supplier details")) reasons.push("Located near payment or supplier details");
    }
    if (/\b(?:supplier|vendor|payee|issued\s+by)\b/i.test(sameLine)) {
      payeeScore += 60;
      if (!reasons.includes("Explicitly labelled as the supplier or payee")) reasons.push("Explicitly labelled as the supplier or payee");
    }
    if (/\b(?:Pty\s+Ltd|Limited|Ltd|Incorporated|Inc|Corporation|Corp)\b/i.test(sameLine)) {
      payeeScore += 35;
      if (!reasons.includes("Shown with a legal entity name")) reasons.push("Shown with a legal entity name");
    }
    if (/\bBSB\b|\baccount\s*(?:number|no\.?|name)\b/i.test(nearby)) {
      payeeScore += 35;
      if (!reasons.includes("Associated with bank details")) reasons.push("Associated with bank details");
    }
    if (index >= text.length * 0.7) payeeScore += 10;
  });

  if (abn === ownAbn) {
    payerScore += 200;
    reasons.unshift("Matches this workspace company ABN");
  }

  const difference = Math.abs(payeeScore - payerScore);
  const confidence = Math.min(0.99, Math.max(0.5, 0.5 + difference / 200));
  // Billing labels are a strong exclusion. A later payment section must be
  // materially stronger before it can override a nearby Bill To/Customer cue.
  if (payerScore >= 70 && payeeScore < payerScore + 50) return { abn, role: "payer", confidence, reasons };
  if (payeeScore >= 60 && payeeScore >= payerScore + 40) return { abn, role: "payee", confidence, reasons };
  return { abn, role: "unknown", confidence: Math.min(confidence, 0.69), reasons: reasons.length ? reasons : ["No clear payer or payee label found"] };
}

export function classifyAbnRoles(text: string, abns: string[], ownAbn = ""): AbnRoleAnalysis {
  const normalizedOwnAbn = onlyDigits(ownAbn);
  let candidates = [...new Set(abns.map(onlyDigits).filter(Boolean))].map((abn) => candidateForAbn(text, abn, normalizedOwnAbn));
  const clearPayees = candidates.filter((candidate) => candidate.role === "payee");
  const possiblePayees = candidates.filter((candidate) => candidate.role !== "payer");
  let selectedPayeeAbns: string[] = [];

  if (clearPayees.length === 1) selectedPayeeAbns = [clearPayees[0].abn];
  else if (clearPayees.length === 0 && possiblePayees.length === 1) {
    selectedPayeeAbns = [possiblePayees[0].abn];
    candidates = candidates.map((candidate) => candidate.abn === possiblePayees[0].abn
      ? { ...candidate, role: "payee" as const, confidence: Math.max(candidate.confidence, 0.72), reasons: [...candidate.reasons, "Only ABN not identified as a customer"] }
      : candidate);
  } else if (candidates.length === 1 && candidates[0].role !== "payer") {
    selectedPayeeAbns = [candidates[0].abn];
    candidates = [{ ...candidates[0], role: "payee", confidence: Math.max(candidates[0].confidence, 0.72) }];
  }

  return {
    candidates,
    selectedPayeeAbns,
    requiresReview: selectedPayeeAbns.length !== 1,
  };
}

export function selectAbnsForVerification(abns: string[], selectedPayeeAbns: string[], ownAbn = ""): AbnVerificationSelection {
  const uniqueAbns = [...new Set(abns.map(onlyDigits).filter(Boolean))];
  const normalizedOwnAbn = onlyDigits(ownAbn);
  const skippedOwnAbns = normalizedOwnAbn && uniqueAbns.includes(normalizedOwnAbn) ? [normalizedOwnAbn] : [];
  const counterpartyAbns = uniqueAbns.filter((abn) => abn !== normalizedOwnAbn);
  const explicitlySelected = [...new Set(selectedPayeeAbns.map(onlyDigits))]
    .filter((abn) => counterpartyAbns.includes(abn));
  const selected = explicitlySelected.length
    ? explicitlySelected
    : skippedOwnAbns.length && counterpartyAbns.length === 1
      ? [counterpartyAbns[0]]
      : [];
  const verificationAbns = selected.length ? selected : counterpartyAbns;

  return {
    verificationAbns,
    selectedPayeeAbns: selected,
    skippedOwnAbns,
    excludedNonPayeeAbns: counterpartyAbns.filter((abn) => !verificationAbns.includes(abn)),
  };
}
