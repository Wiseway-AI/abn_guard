export const demoCertificate = {
  id: "AG-RAY-84F2-2026",
  companyName: "RAYSTECH GROUP PTY LTD",
  abn: "34 629 134 667",
  abnStatus: "Active",
  gstStatus: "Registered",
  accountName: "RAYSTECH GROUP PTY LTD",
  bsb: "084-129",
  accountNumber: "979409137",
  invoiceReference: "INV-MEL016",
  location: "QLD 4106",
  confirmedAt: "12 Aug 2026, 10:42 am AEST",
  expiresAt: "12 Nov 2026",
  level: "Supplier confirmed",
} as const;

export function normalisePaymentValue(value: string) {
  return value.replace(/\D/g, "");
}

export function accountEnding(accountNumber: string) {
  return normalisePaymentValue(accountNumber).slice(-4);
}
