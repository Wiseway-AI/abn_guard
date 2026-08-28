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

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function candidateForAbn(abn: string, ownAbn: string): AbnRoleCandidate {
  if (abn === ownAbn) {
    return {
      abn,
      role: "payer",
      confidence: 1,
      reasons: ["Matches this workspace company ABN"],
    };
  }

  return {
    abn,
    role: "payee",
    confidence: 1,
    reasons: ["Detected in uploaded invoice"],
  };
}

export function classifyAbnRoles(_text: string, abns: string[], ownAbn = ""): AbnRoleAnalysis {
  const normalizedOwnAbn = onlyDigits(ownAbn);
  const candidates = [...new Set(abns.map(onlyDigits).filter(Boolean))].map((abn) => candidateForAbn(abn, normalizedOwnAbn));
  const selectedPayeeAbns = candidates.filter((candidate) => candidate.abn !== normalizedOwnAbn).map((candidate) => candidate.abn);

  return {
    candidates,
    selectedPayeeAbns,
    requiresReview: selectedPayeeAbns.length === 0,
  };
}

export function selectAbnsForVerification(abns: string[], _selectedPayeeAbns: string[], ownAbn = ""): AbnVerificationSelection {
  const uniqueAbns = [...new Set(abns.map(onlyDigits).filter(Boolean))];
  const normalizedOwnAbn = onlyDigits(ownAbn);
  const skippedOwnAbns = normalizedOwnAbn && uniqueAbns.includes(normalizedOwnAbn) ? [normalizedOwnAbn] : [];
  const counterpartyAbns = uniqueAbns.filter((abn) => abn !== normalizedOwnAbn);

  return {
    verificationAbns: counterpartyAbns,
    selectedPayeeAbns: counterpartyAbns,
    skippedOwnAbns,
    excludedNonPayeeAbns: [],
  };
}
