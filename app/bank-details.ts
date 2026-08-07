export type BankDetails = {
  accountName: string;
  bsb: string;
  accountNumber: string;
  bankName: string;
};

function cleanText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .split(/\s+(?=BSB\b|(?:ACCOUNT|A\/C)\s*(?:NO\.?|NUMBER|#)|BANK\s*NAME|ABN\b|REFERENCE\b|SWIFT\b|TOTAL\b|AMOUNT\b|PAYMENT\b|DOCUMENT\b|PRICES?\b|TERMS?\b)/i)[0]
    .replace(/^[\s:：#-]+|[\s,;|]+$/g, "")
    .trim();
}

function labelledText(text: string, label: RegExp) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const inline = lines[index].match(label);
    if (!inline) continue;
    const value = cleanText(inline[1] ?? "");
    if (value) return value;
    const nextLine = cleanText(lines[index + 1] ?? "");
    if (nextLine && !/^(?:BSB|account|a\/c|bank|ABN|GST|invoice|total|amount)\b/i.test(nextLine)) return nextLine;
  }
  return "";
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

function normalizedName(value: string) {
  return value.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function bankDetailsKey(details: BankDetails) {
  const bsb = digits(details.bsb);
  const accountNumber = digits(details.accountNumber);
  if (bsb || accountNumber) return `${bsb}|${accountNumber}`;
  return `${normalizedName(details.accountName)}|${normalizedName(details.bankName)}`;
}

export function bankDetailsMatch(left: BankDetails, right: BankDetails) {
  const coreComparisons = [
    left.bsb && right.bsb ? digits(left.bsb) === digits(right.bsb) : null,
    left.accountNumber && right.accountNumber ? digits(left.accountNumber) === digits(right.accountNumber) : null,
  ].filter((value): value is boolean => value !== null);
  if (coreComparisons.length) return coreComparisons.every(Boolean);
  return Boolean(left.accountName && right.accountName && normalizedName(left.accountName) === normalizedName(right.accountName));
}

export function extractBankDetails(text: string): BankDetails | null {
  const bsbMatch = text.match(/\bBSB(?:\s*(?:number|no\.?))?\s*[:：#-]?\s*(\d{3}[\s-]?\d{3})\b/i);
  const labelledAccountNumber = text.match(/\b(?:account|acct|acc|a\/c)\s*(?:number|no\.?|#)\s*[:：#-]?\s*([0-9][0-9 -]{3,20}[0-9])\b/i);
  const bareAccountNumber = text.match(/\b(?:account|acct|acc|a\/c)(?!\s*name\b)\s*[:：#-]?\s*([0-9][0-9 -]{3,20}[0-9])\b/i);
  const isBareAccountNearBsb = Boolean(bsbMatch && bareAccountNumber && Math.abs((bsbMatch.index ?? 0) - (bareAccountNumber.index ?? 0)) <= 300);
  const accountNumberMatch = labelledAccountNumber ?? (isBareAccountNearBsb ? bareAccountNumber : null);
  const accountName = labelledText(text, /^(?:.*?\b)?(?:account|acct|acc|a\/c)\s*name\s*[:：#-]?\s*(.*)$/i);
  const explicitBankName = labelledText(text, /^(?:.*?\b)?bank\s*name\s*[:：#-]?\s*(.*)$/i);
  const bareBankName = labelledText(text, /^bank\s+(?!details?\b)(.*)$/i);
  const bankName = explicitBankName || bareBankName;
  const bsb = digits(bsbMatch?.[1] ?? "");
  const accountNumber = digits(accountNumberMatch?.[1] ?? "");

  if (!bsb && !accountNumber) return null;
  return {
    accountName: accountName.slice(0, 100),
    bsb,
    accountNumber,
    bankName: bankName.slice(0, 100),
  };
}

export function formatBsb(value: string) {
  const valueDigits = digits(value);
  return valueDigits.length === 6 ? `${valueDigits.slice(0, 3)}-${valueDigits.slice(3)}` : value || "—";
}
