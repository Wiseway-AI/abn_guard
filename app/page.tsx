"use client";

import { ChangeEvent, DragEvent, FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { classifyAbnRoles, type AbnRoleCandidate } from "./abn-role";
import { accountFileKey, accountStorageKey } from "./account-scope";
import { bankDetailsKey, bankDetailsMatch, extractBankDetails, formatBsb, type BankDetails } from "./bank-details";
import { pdfTextRows } from "./pdf-text";
import { millisecondsUntilTodayRefresh, todayReviewDayKey, todayReviewDayLabel } from "./today-day";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize(options: { client_id: string; callback(response: { credential?: string }): void; ux_mode: "popup" }): void;
          renderButton(element: HTMLElement, options: Record<string, string | number>): void;
        };
      };
    };
  }
}

type Tab = "verify" | "today" | "register" | "changes" | "settings";
type Source = "official" | "demo" | "pending";
type RegisterFilter = "all" | "attention" | "active" | "cancelled" | "gst-registered" | "gst-not-registered";
type BillingPlan = "free" | "starter";
type MonitoringSchedule = "weekly" | "manual";
type MonitoringTrigger = "scheduled" | "manual";

type OfficialHistoryRange = {
  value: string;
  from: string;
  to: string;
};

type OfficialAbnHistory = {
  entityNames: OfficialHistoryRange[];
  abnStatuses: OfficialHistoryRange[];
  gstRegistrations: OfficialHistoryRange[];
  locations: OfficialHistoryRange[];
  entityType: string;
  recordLastUpdated: string;
  retrievedAt: string;
};

type AbnRecord = {
  abn: string;
  entityName: string;
  status: "Active" | "Cancelled" | "Unknown";
  statusFrom: string;
  gstRegistered: boolean | null;
  gstFrom: string;
  entityType: string;
  state: string;
  postcode: string;
  lastChecked: string;
  source: Source;
  note?: string;
  officialHistory?: OfficialAbnHistory;
  bankDetails?: BankDetails;
};

type Account = {
  id: string;
  companyName: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  setupComplete: boolean;
  ownAbn: string;
  companyRecord?: AbnRecord;
  authProvider?: "local" | "managed" | "google" | "email";
  workspaceId?: string;
  picture?: string;
  plan?: BillingPlan;
  planName?: string;
  subscriptionStatus?: string;
  abnLimit?: number;
};

function isCloudAccount(account?: Account | null) {
  return account?.authProvider === "google" || account?.authProvider === "email";
}

type CloudWorkspaceState = {
  account?: Partial<Account>;
  register?: AbnRecord[];
  changes?: ChangeLog[];
  history?: AbnHistoryEntry[];
  today?: TodayReview[];
  schedule?: string;
  lastRefresh?: string;
};

type ContractDocument = {
  id: string;
  name: string;
  url: string;
  text: string;
  abns: string[];
  abnRoles: AbnRoleCandidate[];
  selectedPayeeAbns: string[];
  payeeSelection: "automatic" | "manual" | "unresolved";
  uploadedAt: string;
};

type BankDetailsCandidate = {
  details: BankDetails;
  fileNames: string[];
};

type DetectedEntity = {
  abn: string;
  contractName: string;
  fileIds: string[];
  fileNames: string[];
  context: string;
  uploadedAt: string;
  bankDetailCandidates: BankDetailsCandidate[];
};

type ContractCheck = {
  id: string;
  batchId: string;
  fileName: string;
  fileIds: string[];
  uploadedAt: string;
  checkedAt: string;
  abn: string;
  contractName: string;
  contractLocation?: string;
  contractGst: boolean | null;
  contractStatus: "Active" | "Cancelled" | null;
  official: AbnRecord;
  issues: string[];
  reviewed: boolean;
  fileBankDetails?: BankDetails;
  fileBankDetailCandidates?: BankDetailsCandidate[];
  selectedBankDetailKey?: string;
  savedBankDetails?: BankDetails;
  bankDetailStatus: "not-found" | "first-seen" | "match" | "mismatch" | "multiple";
};

type TodayFileRef = {
  id: string;
  name: string;
};

type TodayReview = {
  id: string;
  sourceCheckId: string;
  batchId: string;
  fileName: string;
  uploadedAt: string;
  completedAt: string;
  verifiedAt?: string;
  status: "double-check" | "verified";
  issues: string[];
  official: AbnRecord;
  files?: TodayFileRef[];
};

type ChangeLog = {
  id: string;
  abn: string;
  entityName: string;
  changedAt: string;
  description: string;
  severity: "high" | "medium" | "low";
  trigger?: MonitoringTrigger;
};

type AbnHistoryEntry = {
  id: string;
  abn: string;
  recordedAt: string;
  event: "Company ABN saved" | "Added to register" | "Imported from file" | "Register update" | "Bank details updated" | "Bank details removed";
  entityName: string;
  status: AbnRecord["status"];
  gstRegistered: boolean | null;
  state: string;
  postcode: string;
  source: Source;
  bankDetails?: BankDetails;
};

const STORAGE = {
  accounts: "abn-guard-accounts-v1",
  session: "abn-guard-session-v1",
};

const FILE_DATABASE = "abn-guard-files-v1";
const FILE_STORE = "original-files";

function openFileDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(FILE_DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(FILE_STORE)) request.result.createObjectStore(FILE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeOriginalFile(accountId: string, id: string, file: File) {
  const database = await openFileDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(FILE_STORE, "readwrite");
    transaction.objectStore(FILE_STORE).put(file, accountFileKey(accountId, id));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function loadOriginalFile(accountId: string, id: string) {
  const database = await openFileDatabase();
  const read = (key: string) => new Promise<Blob | undefined>((resolve, reject) => {
    const request = database.transaction(FILE_STORE, "readonly").objectStore(FILE_STORE).get(key);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error);
  });
  const file = await read(accountFileKey(accountId, id)) ?? await read(id);
  database.close();
  return file;
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function isValidAbn(value: string) {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const nums = digits.split("").map(Number);
  nums[0] -= 1;
  return nums.reduce((sum, digit, i) => sum + digit * weights[i], 0) % 89 === 0;
}

function formatAbn(abn: string) {
  const digits = onlyDigits(abn);
  return digits.length === 11
    ? `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
    : abn;
}

function normalizeName(value: string) {
  return value.toUpperCase().replace(/&/g, " AND ").replace(/[^A-Z0-9]/g, "");
}

function canonicalCompanyName(value: string) {
  const ignored = new Set([
    "PTY", "LTD", "LIMITED", "PROPRIETARY", "INC", "INCORPORATED", "CORP", "CORPORATION",
    "CO", "COMPANY", "AUSTRALIA", "AUSTRALIAN",
  ]);
  return value
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !ignored.has(token))
    .join("");
}

function editDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function compareCompanyNames(left: string, right: string): "exact" | "close" | "mismatch" {
  if (normalizeName(left) === normalizeName(right)) return "exact";
  const leftCore = canonicalCompanyName(left);
  const rightCore = canonicalCompanyName(right);
  if (!leftCore || !rightCore) return "mismatch";
  if (leftCore === rightCore) return "close";
  const longest = Math.max(leftCore.length, rightCore.length);
  const similarity = 1 - editDistance(leftCore, rightCore) / longest;
  return longest >= 8 && similarity >= 0.92 ? "close" : "mismatch";
}

function normalizeLocation(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function dateTime(value?: string) {
  if (!value) return "Not yet updated";
  return new Intl.DateTimeFormat("en-AU", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function extractAbns(text: string) {
  const matches = text.match(/(?<!\d)(?:\d[\s.-]?){10}\d(?!\d)/g) ?? [];
  return [...new Set(matches.map(onlyDigits))].filter(isValidAbn);
}

function contextForAbn(text: string, abn: string) {
  const compact = formatAbn(abn);
  const candidates = [abn, compact, compact.replaceAll(" ", "-")];
  const occurrenceIndices = candidates.flatMap((candidate) => {
    const indices: number[] = [];
    let fromIndex = 0;
    while (fromIndex < text.length) {
      const foundAt = text.indexOf(candidate, fromIndex);
      if (foundAt < 0) break;
      indices.push(foundAt);
      fromIndex = foundAt + candidate.length;
    }
    return indices;
  });
  const index = occurrenceIndices.length ? Math.max(...occurrenceIndices) : -1;
  if (index < 0) return text.slice(0, 900);
  return text.slice(Math.max(0, index - 450), Math.min(text.length, index + 350));
}

function expectedNameInContext(context: string, expectedName: string) {
  if (!expectedName) return "";
  const tokens = expectedName.match(/[A-Za-z0-9]+|&/g) ?? [];
  if (!tokens.length) return "";
  const parts = tokens.map((token) => {
    const upper = token.toUpperCase();
    if (upper === "&" || upper === "AND") return "(?:&|AND)";
    if (upper === "LTD" || upper === "LIMITED") return "(?:LTD|LIMITED)";
    if (upper === "PTY" || upper === "PROPRIETARY") return "(?:PTY|PROPRIETARY)";
    return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  const match = context.match(new RegExp(parts.join("[\\s\\u00a0.,'’()/-]*"), "i"));
  return match?.[0].replace(/\s+/g, " ").trim() ?? "";
}

function isLikelyEntityNameLine(line: string) {
  const value = line.trim();
  if (value.length < 3 || value.length > 120 || !/[A-Za-z]{3}/.test(value)) return false;
  if (/(?:https?:\/\/|www\.|@|\.(?:com|net|org|gov|edu)(?:\.au)?\b)/i.test(value)) return false;
  if (/\b(?:tax invoice|invoice|licen[cs]e|created date|due date|folio|reference|account no|account name|bsb|phone|telephone|email|website)\b/i.test(value)) return false;
  if (/^(?:ABN|ACN|GST)\s*[:：]?/i.test(value)) return false;
  if (/\b(?:NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s*,?\s*\d{4}\b/i.test(value)) return false;
  if (/^\(?[wmp]\)?\s*\d/i.test(value)) return false;
  return true;
}

function claimsFromContext(context: string, expectedName = "") {
  const lines = context.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const abnLine = lines.findIndex((line) => /ABN/i.test(line));
  const nearby = lines.slice(Math.max(0, abnLine - 2), Math.min(lines.length, abnLine + 3));
  const labelledName = context.match(
    /(?:primary supplier|subcontractor|contractor|supplier name|supplier|vendor|entity|company)\s*[:：-]?\s*([A-Za-z0-9&.,'() -]{3,100}?)(?=\s+(?:ABN|ACN|GST|address|phone|invoice)\b)/i,
  )?.[1];
  const beforeAbn = context.split(/\bABN\b/i)[0] ?? "";
  const companyNames = [...beforeAbn.matchAll(/([A-Z][A-Za-z0-9&.,'()-]*(?:[ \t]+[A-Za-z0-9&.,'()-]+){0,8}[ \t]+(?:Pty[ \t]+Ltd|Limited|Ltd|Incorporated|Inc|Corporation|Corp)(?:[ \t]*\(Australia\))?)/gi)];
  const companyName = companyNames.at(-1)?.[1];
  const nameLine = nearby
    .filter((line) => !/^ABN\s*[:：]/i.test(line))
    .find((line) => isLikelyEntityNameLine(line) && !/GST|状态|status|合同|payment/i.test(line));
  const fallbackName = nameLine?.replace(/^(primary supplier|subcontractor|contractor|supplier name|supplier|主要供应商|供应商名称|供应商|分包方|实体名称|entity)\s*[:：]\s*/i, "").trim();
  const expectedMatch = expectedNameInContext(context, expectedName);
  const contractName = (expectedMatch || labelledName || companyName || fallbackName || "").trim();
  const locationMatches = [...context.matchAll(/\b(NSW|VIC|QLD|WA|SA|TAS|ACT|NT)\s*,?\s*(\d{4})\b/gi)];
  const abnIndex = Math.max(0, context.search(/\bABN\b/i));
  const nearestLocation = locationMatches.sort((a, b) => Math.abs((a.index ?? 0) - abnIndex) - Math.abs((b.index ?? 0) - abnIndex))[0];
  const contractLocation = nearestLocation ? `${nearestLocation[1].toUpperCase()} ${nearestLocation[2]}` : "";
  const hasNotGst = /未注册\s*GST|not\s+(currently\s+)?registered\s+for\s+GST/i.test(context);
  const hasGst = /已注册\s*GST|GST\s*(registered|registration)|registered\s+for\s+GST/i.test(context);
  const cancelled = /ABN\s*状态.{0,12}(cancelled|注销)|status.{0,12}cancelled/i.test(context);
  const active = /ABN\s*状态.{0,12}(active|有效)|status.{0,12}active/i.test(context);
  return {
    contractName,
    contractLocation,
    contractGst: hasNotGst ? false : hasGst ? true : null,
    contractStatus: cancelled ? ("Cancelled" as const) : active ? ("Active" as const) : null,
  };
}

function compareRecord(previous: AbnRecord, current: AbnRecord, trigger: MonitoringTrigger): ChangeLog[] {
  const changes: ChangeLog[] = [];
  const add = (description: string, severity: ChangeLog["severity"]) =>
    changes.push({
      id: crypto.randomUUID(),
      abn: current.abn,
      entityName: current.entityName,
      changedAt: new Date().toISOString(),
      description,
      severity,
      trigger,
    });
  if (previous.status !== current.status) add(`ABN status changed from ${previous.status} to ${current.status}`, "high");
  if (previous.gstRegistered !== current.gstRegistered)
    add(`GST status changed from ${previous.gstRegistered ? "Registered" : "Not registered"} to ${current.gstRegistered ? "Registered" : "Not registered"}`, "high");
  if (previous.entityName && previous.entityName !== current.entityName)
    add(`Entity name changed from “${previous.entityName}” to “${current.entityName}”`, "medium");
  if (`${previous.state} ${previous.postcode}` !== `${current.state} ${current.postcode}`)
    add(`Main business location changed to ${current.state} ${current.postcode}`, "low");
  if (previous.officialHistory && current.officialHistory) {
    const changedSections = [
      ["entity name", previous.officialHistory.entityNames, current.officialHistory.entityNames],
      ["ABN status", previous.officialHistory.abnStatuses, current.officialHistory.abnStatuses],
      ["GST", previous.officialHistory.gstRegistrations, current.officialHistory.gstRegistrations],
      ["location", previous.officialHistory.locations, current.officialHistory.locations],
    ].filter(([, before, after]) => JSON.stringify(before) !== JSON.stringify(after)).map(([label]) => label);
    if (changedSections.length) add(`Official history updated: ${changedSections.join(", ")}`, "low");
  }
  return changes;
}

async function readContract(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(pdfTextRows(content.items.filter((item) => "str" in item) as { str: string; transform: number[] }[]));
    }
    return pages.join("\n");
  }
  if (extension === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return result.value;
  }
  return file.text();
}

async function lookupAbn(abn: string): Promise<AbnRecord> {
  const response = await fetch("/api/abn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ abn }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "ABN lookup failed");
  return result as AbnRecord;
}

function OfficialHistorySection({ title, rows, empty }: { title: string; rows: OfficialHistoryRange[]; empty: string }) {
  return <section className="abr-history-section">
    <div className="abr-history-heading"><h4>{title}</h4><span>From</span><span>To</span></div>
    {rows.length ? rows.map((row, index) => <div className="abr-history-line" key={`${title}-${row.value}-${row.from}-${row.to}-${index}`}><b>{row.value}</b><span>{row.from || "—"}</span><span>{row.to || "(current)"}</span></div>) : <div className="abr-history-empty">{empty}</div>}
  </section>;
}

function BankDetailsFields({ details, empty = "No bank details saved" }: { details?: BankDetails; empty?: string }) {
  if (!details) return <p className="bank-empty">{empty}</p>;
  return <dl className="bank-detail-grid">
    {details.accountName && <div><dt>Account name</dt><dd>{details.accountName}</dd></div>}
    {details.bankName && <div><dt>Bank name</dt><dd>{details.bankName}</dd></div>}
    {details.bsb && <div><dt>BSB</dt><dd>{formatBsb(details.bsb)}</dd></div>}
    {details.accountNumber && <div><dt>Account number</dt><dd>{details.accountNumber}</dd></div>}
  </dl>;
}

function BankVerification({ check, onSelectCandidate }: { check: ContractCheck; onSelectCandidate: (candidateKey: string) => void }) {
  if (check.bankDetailStatus === "not-found") return null;
  if (check.bankDetailStatus === "match" && check.fileBankDetails) {
    return <div className="bank-match-summary"><span>BANK</span><div><b>Bank details match</b><small>BSB {formatBsb(check.fileBankDetails.bsb)} · Account {check.fileBankDetails.accountNumber}</small></div><em>Match</em></div>;
  }

  const candidates = check.fileBankDetailCandidates ?? [];
  const isMultiple = check.bankDetailStatus === "multiple";
  return <div className={`bank-verification ${check.bankDetailStatus}`}>
    <div className="bank-verification-head"><div><span>BANK</span><b>{isMultiple ? "Multiple bank accounts found" : check.bankDetailStatus === "first-seen" ? "Confirm new bank details" : "Bank details changed"}</b></div><em>{isMultiple ? `${candidates.length} accounts` : check.bankDetailStatus === "first-seen" ? "First record" : "Mismatch"}</em></div>
    {isMultiple ? <div className="bank-candidate-list">{candidates.map((candidate) => {
      const candidateKey = bankDetailsKey(candidate.details);
      const selected = check.selectedBankDetailKey === candidateKey;
      return <section className={selected ? "selected" : ""} key={candidateKey}>
        <div className="bank-candidate-heading"><div><h4>{candidate.fileNames.join(", ")}</h4><span>Uploaded file</span></div><label className={selected ? "bank-candidate-select selected" : "bank-candidate-select"}><input type="radio" name={`bank-account-${check.id}`} checked={selected} onChange={() => onSelectCandidate(candidateKey)} /><span>{selected ? "Selected" : "Use this account"}</span></label></div>
        <BankDetailsFields details={candidate.details} />
      </section>;
    })}</div> : check.bankDetailStatus === "first-seen" ? <section className="bank-single-panel"><BankDetailsFields details={check.fileBankDetails} /></section> : <div className="bank-comparison">
      <section className="bank-panel"><h4>Uploaded file</h4><BankDetailsFields details={check.fileBankDetails} empty="No bank details found" /></section>
      <section className="bank-panel"><h4>Saved record</h4><BankDetailsFields details={check.savedBankDetails} /></section>
    </div>}
    <p className={check.bankDetailStatus === "first-seen" ? "bank-confirmation" : check.selectedBankDetailKey ? "bank-confirmation" : "bank-confirmation danger"}>{isMultiple ? check.selectedBankDetailKey ? "The selected account will be saved to Records after you tick Reviewed and complete this batch." : "Choose the correct payment account before completing this batch. Only the selected account will be saved to Records." : check.bankDetailStatus === "first-seen" ? "Confirm the BSB and account number against the original file, then tick Reviewed." : "Confirm this payment-detail change before ticking Reviewed. Approval will replace the saved account."}</p>
  </div>;
}

function bankSelectionMissing(check: ContractCheck) {
  return check.bankDetailStatus === "multiple" && !check.selectedBankDetailKey;
}

function checkIsVerified(check: ContractCheck) {
  return !bankSelectionMissing(check) && (check.issues.length === 0 || check.reviewed);
}

function isEntityNameIssue(issue: string) {
  return issue === "Company name was not found in the file" || /^File name “.*” does not match the registered entity name$/.test(issue);
}

function isBankDetailIssue(issue: string) {
  return issue === "Multiple different bank details were found across the uploaded files for this ABN."
    || issue === "First bank details found for this ABN. Confirm the BSB and account number before saving."
    || issue === "Bank details do not match the details saved in Records. Confirm before replacing the saved bank details.";
}

function TodaySection({ title, subtitle, items, onVerify, onOpenFile }: { title: string; subtitle: string; items: TodayReview[]; onVerify?: (id: string) => void; onOpenFile: (file: TodayFileRef) => void }) {
  return <section className="panel today-section">
    <div className="today-section-heading">
      <div><h2>{title}</h2><p>{subtitle}</p></div>
      <span>{items.length}</span>
    </div>
    {!items.length ? <div className="today-empty">No items in this section.</div> : <div className="table-wrap today-table"><table>
      <thead><tr><th>File</th><th>Name / ABN</th><th>ABN status</th><th>GST status</th><th>Uploaded</th><th>Issues</th><th>Review</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.id}>
        <td>{item.files?.length ? <div className="today-file-links">{item.files.map((file) => <button type="button" key={file.id} onClick={() => onOpenFile(file)} title={`Open ${file.name}`}>{file.name}</button>)}</div> : <b>{item.fileName || "—"}</b>}</td>
        <td><b>{item.official.entityName || "Name unavailable"}</b><small>{formatAbn(item.official.abn)}</small></td>
        <td><span className={item.official.status === "Active" ? "status-dot active" : item.official.status === "Cancelled" ? "status-dot cancelled" : "status-dot"}>{item.official.status}</span><small>{item.official.statusFrom || "—"}</small></td>
        <td><b className={item.official.gstRegistered === false ? "gst-status not-registered" : "gst-status"}>{item.official.gstRegistered === null ? "Pending" : item.official.gstRegistered ? "Registered" : "Not registered"}</b><small>{item.official.gstFrom || "—"}</small></td>
        <td><span>{dateTime(item.uploadedAt)}</span></td>
        <td><span className={item.issues.length && item.status === "double-check" ? "today-issues open" : "today-issues"}>{item.issues.length ? item.status === "verified" ? `${item.issues.length} reviewed` : `${item.issues.length} issue${item.issues.length === 1 ? "" : "s"}` : "None"}</span>{item.issues[0] && <small title={item.issues.join(" · ")}>{item.issues[0]}</small>}</td>
        <td>{onVerify ? <button className="today-verify" type="button" onClick={() => onVerify(item.id)}>Verify</button> : <span className="today-verified">✓ Verified</span>}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

export default function Home() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "register">("register");
  const [authCompany, setAuthCompany] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [authStage, setAuthStage] = useState<"credentials" | "verify">("credentials");
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [contactWebsite, setContactWebsite] = useState("");
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const [contactError, setContactError] = useState("");
  const [setupAbn, setSetupAbn] = useState("");
  const [setupRecord, setSetupRecord] = useState<AbnRecord | null>(null);
  const [setupError, setSetupError] = useState("");

  const [tab, setTab] = useState<Tab>("verify");
  const [documents, setDocuments] = useState<ContractDocument[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [checks, setChecks] = useState<ContractCheck[]>([]);
  const [todayReviews, setTodayReviews] = useState<TodayReview[]>([]);
  const [todayDayKey, setTodayDayKey] = useState("");
  const [expandedTodayDays, setExpandedTodayDays] = useState<string[]>([]);
  const [register, setRegister] = useState<AbnRecord[]>([]);
  const [changes, setChanges] = useState<ChangeLog[]>([]);
  const [history, setHistory] = useState<AbnHistoryEntry[]>([]);
  const [expandedAbns, setExpandedAbns] = useState<string[]>([]);
  const [loadingHistoryAbns, setLoadingHistoryAbns] = useState<string[]>([]);
  const [apiConfigured, setApiConfigured] = useState(false);
  const [schedule, setSchedule] = useState<MonitoringSchedule>("weekly");
  const [lastRefresh, setLastRefresh] = useState("");
  const [query, setQuery] = useState("");
  const [registerFilter, setRegisterFilter] = useState<RegisterFilter>("all");
  const [newAbn, setNewAbn] = useState("");
  const [activeCheckIndex, setActiveCheckIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [editingBankRecord, setEditingBankRecord] = useState<AbnRecord | null>(null);
  const [bankDraft, setBankDraft] = useState<BankDetails>({ accountName: "", bankName: "", bsb: "", accountNumber: "" });
  const [bankEditError, setBankEditError] = useState("");
  const [editingCheckNameId, setEditingCheckNameId] = useState<string | null>(null);
  const [checkNameDraft, setCheckNameDraft] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [cloudWorkspaceReady, setCloudWorkspaceReady] = useState(false);
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleSigningIn, setGoogleSigningIn] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const storedAccounts = JSON.parse(localStorage.getItem(STORAGE.accounts) ?? "[]") as Account[];
      setAccounts(storedAccounts);
      try {
        const sessionResponse = await fetch("/api/auth/session");
        const session = await sessionResponse.json() as {
          authenticated?: boolean;
          googleConfigured?: boolean;
          googleClientId?: string;
          user?: { id: string; email: string; name: string; picture: string; authProvider?: "google" | "email" };
          workspace?: { id: string; name: string; plan: BillingPlan; planName: string; subscriptionStatus: string; abnLimit: number };
        };
        if (cancelled) return;
        setGoogleConfigured(Boolean(session.googleConfigured));
        setGoogleClientId(session.googleClientId ?? "");
        if (session.authenticated && session.user && session.workspace) {
          const workspaceResponse = await fetch("/api/workspace");
          const workspaceResult = await workspaceResponse.json() as { state?: CloudWorkspaceState };
          const savedAccount = workspaceResult.state?.account ?? {};
          const account: Account = {
            id: `cloud-${session.user.id}`,
            companyName: savedAccount.companyName || session.workspace.name || session.user.name,
            email: session.user.email,
            passwordHash: "server-authenticated",
            createdAt: savedAccount.createdAt || new Date().toISOString(),
            setupComplete: Boolean(savedAccount.setupComplete),
            ownAbn: savedAccount.ownAbn || "",
            companyRecord: savedAccount.companyRecord,
            authProvider: session.user.authProvider === "email" ? "email" : "google",
            workspaceId: session.workspace.id,
            picture: session.user.picture,
            plan: session.workspace.plan,
            planName: session.workspace.planName,
            subscriptionStatus: session.workspace.subscriptionStatus,
            abnLimit: session.workspace.abnLimit,
          };
          setCurrentAccount(account);
          setRegister(workspaceResult.state?.register ?? []);
          setChanges((workspaceResult.state?.changes ?? []).filter((change) => Boolean(change.trigger)));
          setHistory(workspaceResult.state?.history ?? []);
          setTodayReviews(workspaceResult.state?.today ?? []);
          setSchedule(workspaceResult.state?.schedule === "manual" ? "manual" : "weekly");
          setLastRefresh(workspaceResult.state?.lastRefresh ?? "");
          setDocuments([]);
          setChecks([]);
          setCloudWorkspaceReady(true);
        } else {
          const sessionId = localStorage.getItem(STORAGE.session);
          const active = storedAccounts.find((account) => account.id === sessionId) ?? null;
          setCurrentAccount(active);
          if (active) loadAccountData(active.id);
        }
      } catch {
        const sessionId = localStorage.getItem(STORAGE.session);
        const active = storedAccounts.find((account) => account.id === sessionId) ?? null;
        setCurrentAccount(active);
        if (active) loadAccountData(active.id);
      } finally {
        if (!cancelled) setHydrated(true);
      }
      fetch("/api/abn", { cache: "no-store" }).then((response) => response.json()).then((result) => setApiConfigured(Boolean(result.configured))).catch(() => setApiConfigured(false));
    }
    void hydrate();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!showAuth || authStage !== "credentials" || !googleConfigured || !googleClientId) return;
    let cancelled = false;
    const scriptId = "google-identity-services";

    const renderGoogleButton = () => {
      if (cancelled || !googleButtonRef.current || !window.google?.accounts?.id) return;
      googleButtonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response: { credential?: string }) => {
          if (!response.credential) {
            setAuthError("Google did not return a sign-in credential. Please try again.");
            return;
          }
          setGoogleSigningIn(true);
          setAuthError("");
          try {
            const signInResponse = await fetch("/api/auth/google/credential", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: response.credential }),
            });
            const result = await signInResponse.json() as { error?: string };
            if (!signInResponse.ok) throw new Error(result.error || "Google sign-in failed.");
            window.location.assign("/");
          } catch (error) {
            setGoogleSigningIn(false);
            setAuthError(error instanceof Error ? error.message : "Google sign-in failed.");
          }
        },
        ux_mode: "popup",
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: authMode === "register" ? "signup_with" : "signin_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: Math.min(400, Math.max(240, googleButtonRef.current.clientWidth)),
      });
    };

    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (window.google?.accounts?.id) renderGoogleButton();
    else if (existing) existing.addEventListener("load", renderGoogleButton, { once: true });
    else {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", renderGoogleButton, { once: true });
      script.addEventListener("error", () => setAuthError("Google sign-in could not be loaded. Please refresh and try again."), { once: true });
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      existing?.removeEventListener("load", renderGoogleButton);
    };
  }, [authMode, authStage, googleClientId, googleConfigured, showAuth]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleAuthError = params.get("auth_error");
    if (!googleAuthError) return;
    setAuthMode("signin");
    setAuthError(googleAuthError);
    setShowAuth(true);
    params.delete("auth_error");
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
  }, []);

  useEffect(() => {
    if (!hydrated || !currentAccount || isCloudAccount(currentAccount)) return;
    localStorage.setItem(accountStorageKey(currentAccount.id, "register"), JSON.stringify(register));
  }, [register, currentAccount, hydrated]);
  useEffect(() => {
    if (!hydrated || !currentAccount || isCloudAccount(currentAccount)) return;
    localStorage.setItem(accountStorageKey(currentAccount.id, "changes"), JSON.stringify(changes));
  }, [changes, currentAccount, hydrated]);
  useEffect(() => {
    if (!hydrated || !currentAccount || isCloudAccount(currentAccount)) return;
    localStorage.setItem(accountStorageKey(currentAccount.id, "history"), JSON.stringify(history));
  }, [history, currentAccount, hydrated]);
  useEffect(() => {
    if (!hydrated || !currentAccount || isCloudAccount(currentAccount)) return;
    localStorage.setItem(accountStorageKey(currentAccount.id, "today"), JSON.stringify(todayReviews));
  }, [todayReviews, currentAccount, hydrated]);

  useEffect(() => {
    if (!hydrated || !cloudWorkspaceReady || !isCloudAccount(currentAccount)) return;
    const timer = window.setTimeout(async () => {
      const response = await fetch("/api/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: { account: currentAccount, register, changes, history, today: todayReviews, schedule, lastRefresh } }),
      });
      const result = await response.json() as { error?: string; workspace?: { plan: BillingPlan; planName: string; subscriptionStatus: string; abnLimit: number } };
      if (!response.ok) {
        setNotice(result.error || "Your workspace could not be saved.");
        return;
      }
      if (result.workspace) setCurrentAccount((account) => account ? { ...account, ...result.workspace } : account);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [changes, cloudWorkspaceReady, currentAccount?.companyName, currentAccount?.companyRecord, currentAccount?.ownAbn, currentAccount?.setupComplete, history, hydrated, lastRefresh, register, schedule, todayReviews]);

  useEffect(() => {
    if (!cloudWorkspaceReady || !isCloudAccount(currentAccount)) return;
    const pendingPlan = localStorage.getItem("abn-guard-pending-plan");
    if (pendingPlan !== "starter") return;
    localStorage.removeItem("abn-guard-pending-plan");
    void startCheckout(pendingPlan);
  }, [cloudWorkspaceReady, currentAccount?.authProvider]);

  useEffect(() => {
    if (!cloudWorkspaceReady || !isCloudAccount(currentAccount)) return;
    const params = new URLSearchParams(window.location.search);
    const billingResult = params.get("billing");
    const checkoutSessionId = params.get("session_id");
    if (billingResult !== "success" && billingResult !== "cancelled") return;
    params.delete("billing");
    params.delete("session_id");
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
    if (billingResult === "cancelled") {
      setNotice("Stripe Checkout was cancelled. Your current plan has not changed.");
      return;
    }
    if (!checkoutSessionId) {
      setNotice("Stripe returned without a Checkout session. Your subscription will update when the webhook arrives.");
      return;
    }
    setBillingBusy(true);
    void fetch("/api/billing/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkoutSessionId }),
    }).then(async (response) => {
      const result = await response.json() as { error?: string; workspace?: { plan: BillingPlan; planName: string; subscriptionStatus: string; abnLimit: number } };
      if (!response.ok || !result.workspace) throw new Error(result.error || "Stripe subscription could not be confirmed.");
      setCurrentAccount((account) => account ? { ...account, ...result.workspace } : account);
      setNotice(`Starter is active. This workspace can now save up to ${result.workspace.abnLimit} ABN / bank-detail records.`);
    }).catch((error) => {
      setNotice(error instanceof Error ? error.message : "Stripe subscription could not be confirmed.");
    }).finally(() => setBillingBusy(false));
  }, [cloudWorkspaceReady, currentAccount?.authProvider]);

  useEffect(() => {
    const resetStripeNavigation = () => setBillingBusy(false);
    window.addEventListener("pageshow", resetStripeNavigation);
    return () => window.removeEventListener("pageshow", resetStripeNavigation);
  }, []);

  useEffect(() => {
    let refreshTimer = 0;
    const startReviewDay = () => {
      const activeDay = todayReviewDayKey();
      setTodayDayKey(activeDay);
      setExpandedTodayDays([activeDay]);
      refreshTimer = window.setTimeout(startReviewDay, millisecondsUntilTodayRefresh() + 250);
    };
    startReviewDay();
    return () => window.clearTimeout(refreshTimer);
  }, [currentAccount?.id]);

  useEffect(() => {
    if (!hydrated || !currentAccount?.setupComplete || schedule === "manual" || !register.length) return;
    const interval = 7 * 24 * 60 * 60 * 1000;
    const runIfDue = () => {
      const last = lastRefresh ? new Date(lastRefresh).getTime() : 0;
      if (!busy && Date.now() - last >= interval) void refreshAll("scheduled");
    };
    const firstRun = window.setTimeout(runIfDue, 1800);
    const timer = window.setInterval(runIfDue, 60 * 60 * 1000);
    return () => {
      window.clearTimeout(firstRun);
      window.clearInterval(timer);
    };
  }, [schedule, lastRefresh, register, apiConfigured, busy, hydrated, currentAccount]);

  function loadAccountData(accountId: string) {
    setRegister(JSON.parse(localStorage.getItem(accountStorageKey(accountId, "register")) ?? "[]"));
    localStorage.removeItem(accountStorageKey(accountId, "checks"));
    setChecks([]);
    setTodayReviews(JSON.parse(localStorage.getItem(accountStorageKey(accountId, "today")) ?? "[]"));
    setChanges((JSON.parse(localStorage.getItem(accountStorageKey(accountId, "changes")) ?? "[]") as ChangeLog[]).filter((change) => Boolean(change.trigger)));
    setHistory(JSON.parse(localStorage.getItem(accountStorageKey(accountId, "history")) ?? "[]"));
    setExpandedAbns([]);
    setLoadingHistoryAbns([]);
    setSchedule(localStorage.getItem(accountStorageKey(accountId, "schedule")) === "manual" ? "manual" : "weekly");
    setLastRefresh(localStorage.getItem(accountStorageKey(accountId, "lastRefresh")) ?? "");
    setDocuments([]);
  }

  const detectedEntities = useMemo(() => {
    const map = new Map<string, DetectedEntity>();
    documents.forEach((document) => {
      const documentBankDetails = extractBankDetails(document.text);
      document.abns.forEach((abn) => {
        const context = contextForAbn(document.text, abn);
        const name = claimsFromContext(context).contractName;
        const existing = map.get(abn);
        const bankDetailCandidates = new Map((existing?.bankDetailCandidates ?? []).map((candidate) => [bankDetailsKey(candidate.details), candidate]));
        if (documentBankDetails && document.selectedPayeeAbns.includes(abn)) {
          const key = bankDetailsKey(documentBankDetails);
          const previousCandidate = bankDetailCandidates.get(key);
          bankDetailCandidates.set(key, {
            details: documentBankDetails,
            fileNames: [...new Set([...(previousCandidate?.fileNames ?? []), document.name])],
          });
        }
        map.set(abn, {
          abn,
          contractName: existing?.contractName || name,
          fileIds: [...new Set([...(existing?.fileIds ?? []), document.id])],
          fileNames: [...new Set([...(existing?.fileNames ?? []), document.name])],
          context: existing?.context || context,
          uploadedAt: existing?.uploadedAt || document.uploadedAt,
          bankDetailCandidates: [...bankDetailCandidates.values()],
        });
      });
    });
    return [...map.values()];
  }, [documents]);

  const filteredRegister = useMemo(() => {
    const term = query.trim().toLowerCase();
    return register.filter((item) => {
      const matchesSearch = !term || `${item.abn} ${formatAbn(item.abn)} ${item.entityName} ${item.state}`.toLowerCase().includes(term);
      if (!matchesSearch) return false;
      if (registerFilter === "attention") return item.status !== "Active" || item.gstRegistered !== true;
      if (registerFilter === "active") return item.status === "Active";
      if (registerFilter === "cancelled") return item.status === "Cancelled";
      if (registerFilter === "gst-registered") return item.gstRegistered === true;
      if (registerFilter === "gst-not-registered") return item.gstRegistered === false;
      return true;
    });
  }, [query, register, registerFilter]);

  const latestChecks = useMemo(() => {
    const batchId = checks[0]?.batchId;
    return batchId ? checks.filter((check) => check.batchId === batchId) : [];
  }, [checks]);
  const todayDayGroups = useMemo(() => {
    const grouped = new Map<string, TodayReview[]>();
    todayReviews.forEach((item) => {
      const day = todayReviewDayKey(item.completedAt || item.uploadedAt);
      grouped.set(day, [...(grouped.get(day) ?? []), item]);
    });
    if (todayDayKey && !grouped.has(todayDayKey)) grouped.set(todayDayKey, []);
    return [...grouped.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([day, items]) => ({ day, items }));
  }, [todayDayKey, todayReviews]);
  const currentTodayItems = useMemo(() => todayReviews.filter((item) => todayReviewDayKey(item.completedAt || item.uploadedAt) === todayDayKey), [todayDayKey, todayReviews]);
  const doubleCheckItems = useMemo(() => currentTodayItems.filter((item) => item.status === "double-check"), [currentTodayItems]);
  const verifiedTodayItems = useMemo(() => currentTodayItems.filter((item) => item.status === "verified"), [currentTodayItems]);
  const issueCount = latestChecks.filter((check) => isCheckSelectedPayee(check) && !checkIsVerified(check)).length;

  useEffect(() => {
    setActiveCheckIndex((current) => Math.min(current, Math.max(latestChecks.length - 1, 0)));
  }, [latestChecks.length]);

  function addHistoryEntries(records: AbnRecord[], event: AbnHistoryEntry["event"]) {
    const entries = records.map((record) => ({
      id: crypto.randomUUID(),
      abn: record.abn,
      recordedAt: record.lastChecked || new Date().toISOString(),
      event,
      entityName: record.entityName,
      status: record.status,
      gstRegistered: record.gstRegistered,
      state: record.state,
      postcode: record.postcode,
      source: record.source,
      bankDetails: record.bankDetails,
    }));
    setHistory((previous) => [...entries, ...previous].slice(0, 500));
  }

  function openBankEditor(record: AbnRecord) {
    setEditingBankRecord(record);
    setBankDraft(record.bankDetails ?? { accountName: "", bankName: "", bsb: "", accountNumber: "" });
    setBankEditError("");
  }

  function closeBankEditor() {
    setEditingBankRecord(null);
    setBankEditError("");
  }

  function saveBankDetails(event: FormEvent) {
    event.preventDefault();
    if (!editingBankRecord) return;
    const bsb = onlyDigits(bankDraft.bsb);
    const accountNumber = onlyDigits(bankDraft.accountNumber);
    if (bsb.length !== 6) {
      setBankEditError("Enter a valid 6-digit BSB.");
      return;
    }
    if (accountNumber.length < 4 || accountNumber.length > 16) {
      setBankEditError("Enter an account number between 4 and 16 digits.");
      return;
    }
    const updated: AbnRecord = {
      ...editingBankRecord,
      bankDetails: {
        accountName: bankDraft.accountName.trim(),
        bankName: bankDraft.bankName.trim(),
        bsb,
        accountNumber,
      },
    };
    setRegister((records) => records.map((record) => record.abn === updated.abn ? updated : record));
    addHistoryEntries([{ ...updated, lastChecked: new Date().toISOString() }], "Bank details updated");
    setNotice(`Bank details updated for ${updated.entityName}.`);
    closeBankEditor();
  }

  function removeBankDetails() {
    if (!editingBankRecord?.bankDetails) return;
    if (!window.confirm(`Remove the saved bank details for ${editingBankRecord.entityName}?`)) return;
    const updated = { ...editingBankRecord, bankDetails: undefined };
    setRegister((records) => records.map((record) => record.abn === updated.abn ? updated : record));
    addHistoryEntries([{ ...updated, lastChecked: new Date().toISOString() }], "Bank details removed");
    setNotice(`Bank details removed for ${updated.entityName}.`);
    closeBankEditor();
  }

  async function toggleAbnHistory(abn: string) {
    if (expandedAbns.includes(abn)) {
      setExpandedAbns((previous) => previous.filter((item) => item !== abn));
      return;
    }
    setExpandedAbns((previous) => [...previous, abn]);
    const previous = register.find((item) => item.abn === abn);
    if (!previous || previous.officialHistory || !apiConfigured || loadingHistoryAbns.includes(abn)) return;
    setLoadingHistoryAbns((items) => [...items, abn]);
    try {
      const current = { ...(await lookupAbn(abn)), bankDetails: previous.bankDetails };
      setRegister((records) => records.map((record) => record.abn === abn ? current : record));
      addHistoryEntries([current], "Register update");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load official ABN history");
    } finally {
      setLoadingHistoryAbns((items) => items.filter((item) => item !== abn));
    }
  }

  function persistAccounts(next: Account[]) {
    setAccounts(next);
    localStorage.setItem(STORAGE.accounts, JSON.stringify(next.filter((account) => !isCloudAccount(account))));
  }

  function startGoogleSignIn() {
    setAuthMode("register");
    setShowAuth(true);
    if (!googleConfigured) {
      setAuthError("Google sign-in is being activated. Please try again shortly.");
      return;
    }
    setAuthError("");
  }

  function chooseLandingPlan(plan: BillingPlan) {
    if (plan !== "free") localStorage.setItem("abn-guard-pending-plan", plan);
    startGoogleSignIn();
  }

  async function startCheckout(plan: Exclude<BillingPlan, "free">) {
    if (!currentAccount || !isCloudAccount(currentAccount)) {
      setShowAuth(true);
      setAuthMode("signin");
      setAuthError("Sign in to choose a paid plan.");
      return;
    }
    setBillingBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }), signal: controller.signal });
      const result = await response.json() as { url?: string; error?: string };
      if (response.status === 401) {
        setShowAuth(true);
        setAuthMode("signin");
        setAuthError("Your session has expired. Sign in again, then choose Starter.");
      }
      if (!response.ok || !result.url) throw new Error(result.error || "Checkout could not be started.");
      window.clearTimeout(timeout);
      window.location.href = result.url;
    } catch (error) {
      window.clearTimeout(timeout);
      const message = error instanceof DOMException && error.name === "AbortError" ? "Stripe is taking longer than expected. Please try again." : error instanceof Error ? error.message : "Checkout could not be started.";
      setNotice(message);
      setBillingBusy(false);
    }
  }

  async function openBillingPortal() {
    setBillingBusy(true);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || "Billing portal could not be opened.");
      window.location.href = result.url;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Billing portal could not be opened.");
      setBillingBusy(false);
    }
  }

  function availableAbnSlots() {
    if (!isCloudAccount(currentAccount)) return Number.POSITIVE_INFINITY;
    return Math.max(0, (currentAccount.abnLimit ?? 30) - register.length);
  }

  function quotaMessage() {
    const planName = currentAccount?.planName || "Free";
    const limit = currentAccount?.abnLimit ?? 30;
    return `${planName} includes up to ${limit} ABN / bank-detail records. Upgrade your plan to add more.`;
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setAuthError("");
    setAuthNotice("");
    const email = authEmail.trim().toLowerCase();
    if (authMode === "signin" && !email.includes("@")) {
      if (!authPassword) {
        setAuthError("Enter your password.");
        return;
      }
      try {
        const response = await fetch("/api/account-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: email, password: authPassword }),
        });
        const result = await response.json() as { authenticated?: boolean; error?: string; account?: { id: string; username: string; companyName: string; setupComplete: boolean } };
        if (!response.ok || !result.authenticated) {
          setAuthError(result.error || "Sign-in failed.");
          return;
        }
        if (!result.account) {
          setAuthError("This account is not available.");
          return;
        }
        const existingAccount = accounts.find((account) => account.id === result.account?.id);
        const managedAccount: Account = {
          ...existingAccount,
          id: result.account.id,
          companyName: existingAccount?.companyName || result.account.companyName,
          email: result.account.username,
          passwordHash: "server-managed",
          createdAt: existingAccount?.createdAt || new Date().toISOString(),
          setupComplete: existingAccount?.setupComplete ?? result.account.setupComplete,
          ownAbn: existingAccount?.ownAbn || "",
        };
        const nextAccounts = [...accounts.filter((account) => account.id !== managedAccount.id), managedAccount];
        persistAccounts(nextAccounts);
        localStorage.setItem(STORAGE.session, managedAccount.id);
        setCurrentAccount(managedAccount);
        loadAccountData(managedAccount.id);
        setAuthPassword("");
      } catch {
        setAuthError("Sign-in is temporarily unavailable.");
      }
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email) || authPassword.length < 8) {
      setAuthError("Enter a valid email and a password of at least 8 characters.");
      return;
    }
    if (authMode === "register" && authCompany.trim().length < 2) {
      setAuthError("Enter your company name.");
      return;
    }
    setAuthSubmitting(true);
    try {
      const endpoint = authMode === "register" ? "/api/auth/email/register" : "/api/auth/email/signin";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: authCompany.trim(), email, password: authPassword }),
      });
      const result = await response.json() as { authenticated?: boolean; verificationRequired?: boolean; error?: string };
      if (!response.ok) throw new Error(result.error || (authMode === "register" ? "Registration could not be started." : "Sign-in failed."));
      if (authMode === "register" && result.verificationRequired) {
        setAuthStage("verify");
        setAuthCode("");
        return;
      }
      window.location.assign("/");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication is temporarily unavailable.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function verifyEmailRegistration(event: FormEvent) {
    event.preventDefault();
    setAuthError("");
    setAuthNotice("");
    const code = authCode.replace(/\D/g, "").slice(0, 6);
    if (code.length !== 6) {
      setAuthError("Enter the 6-digit code from your email.");
      return;
    }
    setAuthSubmitting(true);
    try {
      const response = await fetch("/api/auth/email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail.trim().toLowerCase(), code }),
      });
      const result = await response.json() as { authenticated?: boolean; error?: string };
      if (!response.ok || !result.authenticated) throw new Error(result.error || "Email verification failed.");
      window.location.assign("/");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Email verification failed.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function resendVerificationCode() {
    setAuthError("");
    setAuthNotice("");
    setAuthSubmitting(true);
    try {
      const response = await fetch("/api/auth/email/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: authCompany.trim(), email: authEmail.trim().toLowerCase(), password: authPassword }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "A new code could not be sent.");
      setAuthCode("");
      setAuthNotice("A new verification code has been sent.");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "A new code could not be sent.");
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function submitContact(event: FormEvent) {
    event.preventDefault();
    setContactError("");
    const companyName = authCompany.trim();
    const email = authEmail.trim().toLowerCase();
    if (!companyName) {
      setContactError("Enter your company name.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setContactError("Enter a valid work email.");
      return;
    }
    setContactSubmitting(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName, email, website: contactWebsite }),
      });
      const result = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !result.ok) {
        const fallbackResponse = await fetch("https://formsubmit.co/ajax/percival@wiseway.ai", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            company: companyName,
            email,
            _replyto: email,
            _subject: `ABN Guard free trial request — ${companyName}`,
            _template: "table",
            _captcha: "false",
            _url: window.location.href,
            source: "ABN Guard landing page",
            submitted_at: new Date().toISOString(),
          }),
        });
        const fallbackResult = await fallbackResponse.json() as { success?: boolean | string; message?: string };
        const delivered = fallbackResult.success === true || fallbackResult.success === "true";
        if (!fallbackResponse.ok || !delivered) {
          const awaitingActivation = fallbackResult.message?.toLowerCase().includes("activation");
          throw new Error(awaitingActivation
            ? "The contact form is being activated. Please try again in a few minutes."
            : fallbackResult.message || result.error || "Your request could not be sent.");
        }
      }
      setContactSubmitted(true);
    } catch (error) {
      setContactError(error instanceof Error ? error.message : "Your request could not be sent. Please try again.");
    } finally {
      setContactSubmitting(false);
    }
  }

  function signOut() {
    if (isCloudAccount(currentAccount)) void fetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem(STORAGE.session);
    setCurrentAccount(null);
    setRegister([]);
    setChecks([]);
    setChanges([]);
    setHistory([]);
    setExpandedAbns([]);
    setLoadingHistoryAbns([]);
    setDocuments([]);
    setCloudWorkspaceReady(false);
    setAuthPassword("");
    setAuthCode("");
    setAuthNotice("");
    setAuthStage("credentials");
    setAuthMode("signin");
  }

  async function searchSetupAbn() {
    const abn = onlyDigits(setupAbn);
    setSetupError("");
    setSetupRecord(null);
    if (!isValidAbn(abn)) {
      setSetupError("Enter a valid 11-digit ABN.");
      return;
    }
    setBusy(true);
    try {
      setSetupRecord(await lookupAbn(abn));
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : "ABN lookup failed");
    } finally {
      setBusy(false);
    }
  }

  function completeSetup() {
    if (!currentAccount || !setupRecord) return;
    const updated: Account = {
      ...currentAccount,
      companyName: setupRecord.source === "pending" ? currentAccount.companyName : setupRecord.entityName,
      ownAbn: setupRecord.abn,
      companyRecord: setupRecord,
      setupComplete: true,
    };
    persistAccounts(accounts.map((account) => account.id === updated.id ? updated : account));
    setCurrentAccount(updated);
    setRegister([setupRecord]);
    addHistoryEntries([setupRecord], "Company ABN saved");
    setNotice("Company setup complete. Your ABN has been saved to the register.");
  }

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    setIsParsing(true);
    setNotice("");
    const parsed: ContractDocument[] = [];
    let failed = 0;
    for (const file of files) {
      try {
        const text = await readContract(file);
        const id = crypto.randomUUID();
        const abns = extractAbns(text);
        const roleAnalysis = classifyAbnRoles(text, abns, currentAccount?.ownAbn);
        let abnRoles = roleAnalysis.candidates;
        let selectedPayeeAbns = roleAnalysis.selectedPayeeAbns;
        const abnEntityNames: Record<string, string> = {};
        if (abns.length > 1) {
          const officialResults = await Promise.allSettled(abns.map((abn) => lookupAbn(abn)));
          officialResults.forEach((result, index) => {
            if (result.status === "fulfilled" && result.value.entityName) abnEntityNames[abns[index]] = result.value.entityName;
          });
          const accountName = extractBankDetails(text)?.accountName ?? "";
          const accountMatches = accountName
            ? abns.filter((abn) => abnEntityNames[abn] && compareCompanyNames(accountName, abnEntityNames[abn]) !== "mismatch")
            : [];
          if (accountMatches.length === 1) {
            selectedPayeeAbns = accountMatches;
            abnRoles = abnRoles.map((candidate) => candidate.abn === accountMatches[0]
              ? { ...candidate, role: "payee", confidence: Math.max(candidate.confidence, 0.94), reasons: [...candidate.reasons, "Bank account name matches the ABN Lookup entity"] }
              : candidate);
          }
        }
        await storeOriginalFile(currentAccount.id, id, file);
        parsed.push({
          id,
          name: file.name,
          url: URL.createObjectURL(file),
          text,
          abns,
          abnRoles,
          selectedPayeeAbns,
          payeeSelection: selectedPayeeAbns.length === 1 ? "automatic" : "unresolved",
          uploadedAt: new Date().toISOString(),
        });
      } catch {
        failed += 1;
      }
    }
    setDocuments((previous) => [...previous, ...parsed]);
    setIsParsing(false);
    const found = parsed.reduce((sum, item) => sum + item.abns.length, 0);
    setNotice(`Added ${parsed.length} contract${parsed.length === 1 ? "" : "s"} and detected ${found} valid ABN${found === 1 ? "" : "s"}${failed ? `. ${failed} file${failed === 1 ? "" : "s"} could not be read.` : "."}`);
  }

  function isCheckSelectedPayee(check: ContractCheck) {
    return documents.some((document) => check.fileIds.includes(document.id) && document.selectedPayeeAbns.includes(check.abn));
  }

  function bankVerificationForDocuments(abn: string, sourceDocuments: ContractDocument[], official: AbnRecord) {
    const savedBankDetails = register.find((record) => record.abn === abn)?.bankDetails;
    const candidates = new Map<string, BankDetailsCandidate>();
    sourceDocuments.forEach((document) => {
      const details = extractBankDetails(document.text);
      if (!details) return;
      const key = bankDetailsKey(details);
      const previous = candidates.get(key);
      candidates.set(key, { details, fileNames: [...new Set([...(previous?.fileNames ?? []), document.name])] });
    });
    const bankDetailCandidates = [...candidates.values()];
    const fileBankDetails = bankDetailCandidates[0]?.details;
    const multipleBankDetails = bankDetailCandidates.length > 1;
    const bankDetailStatus: ContractCheck["bankDetailStatus"] = !fileBankDetails
      ? "not-found"
      : multipleBankDetails
        ? "multiple"
        : !savedBankDetails
          ? "first-seen"
          : bankDetailsMatch(fileBankDetails, savedBankDetails)
            ? "match"
            : "mismatch";
    const bankIssues: string[] = [];
    if (multipleBankDetails) bankIssues.push("Multiple different bank details were found across the uploaded files for this ABN.");
    else if (bankDetailStatus === "first-seen") bankIssues.push("First bank details found for this ABN. Confirm the BSB and account number before saving.");
    else if (bankDetailStatus === "mismatch") bankIssues.push("Bank details do not match the details saved in Records. Confirm before replacing the saved bank details.");
    return {
      fileBankDetails,
      fileBankDetailCandidates: bankDetailCandidates,
      savedBankDetails,
      bankDetailStatus,
      bankIssues,
      official: { ...official, bankDetails: multipleBankDetails ? savedBankDetails : fileBankDetails ?? savedBankDetails },
    };
  }

  function selectPayeeFromResult(check: ContractCheck) {
    const affectedFileIds = new Set(check.fileIds);
    const nextDocuments = documents.map((document) => affectedFileIds.has(document.id) && document.abns.includes(check.abn) ? {
      ...document,
      selectedPayeeAbns: [check.abn],
      payeeSelection: "manual" as const,
    } : document);
    setDocuments(nextDocuments);
    setChecks((previous) => previous.map((item) => {
      const selectedSourceDocuments = nextDocuments.filter((document) => item.fileIds.includes(document.id) && document.selectedPayeeAbns.includes(item.abn));
      const issuesWithoutBank = item.issues.filter((issue) => !isBankDetailIssue(issue));
      if (!selectedSourceDocuments.length) {
        const savedBankDetails = register.find((record) => record.abn === item.abn)?.bankDetails;
        return {
          ...item,
          issues: issuesWithoutBank,
          reviewed: false,
          fileBankDetails: undefined,
          fileBankDetailCandidates: [],
          savedBankDetails,
          bankDetailStatus: "not-found",
          official: { ...item.official, bankDetails: savedBankDetails },
        };
      }
      const bank = bankVerificationForDocuments(item.abn, selectedSourceDocuments, item.official);
      const { bankIssues, ...bankVerification } = bank;
      return { ...item, ...bankVerification, issues: [...issuesWithoutBank, ...bankIssues], reviewed: false };
    }));
    setNotice(`${check.official.entityName || formatAbn(check.abn)} selected as the payee. Bank details will only be linked to this ABN.`);
  }

  async function verifyContracts() {
    if (!detectedEntities.length) {
      setNotice("No valid 11-digit ABN was found in the uploaded contracts.");
      return;
    }
    setBusy(true);
    setNotice(`Verifying ${detectedEntities.length} ABN${detectedEntities.length === 1 ? "" : "s"}…`);
    const batchId = crypto.randomUUID();
    const nextChecks: ContractCheck[] = [];
    for (const detected of detectedEntities) {
      try {
        const official = await lookupAbn(detected.abn);
        const savedBankDetails = register.find((record) => record.abn === detected.abn)?.bankDetails;
        const fileBankDetails = detected.bankDetailCandidates[0]?.details;
        const multipleBankDetails = detected.bankDetailCandidates.length > 1;
        const bankDetailStatus: ContractCheck["bankDetailStatus"] = !fileBankDetails
          ? "not-found"
          : multipleBankDetails
            ? "multiple"
            : !savedBankDetails
              ? "first-seen"
              : bankDetailsMatch(fileBankDetails, savedBankDetails)
                ? "match"
                : "mismatch";
        const extractedClaims = claimsFromContext(detected.context);
        const claims = { ...extractedClaims, contractName: detected.contractName };
        const issues: string[] = [];
        const officialLocation = [official.state, official.postcode].filter(Boolean).join(" ");
        if (!claims.contractName) issues.push("Company name was not found in the file");
        else if (official.entityName && compareCompanyNames(claims.contractName, official.entityName) === "mismatch")
          issues.push(`File name “${claims.contractName}” does not match the registered entity name`);
        if (claims.contractLocation && (!officialLocation || normalizeLocation(claims.contractLocation) !== normalizeLocation(officialLocation)))
          issues.push(`File location ${claims.contractLocation} does not match the ABN Lookup location ${officialLocation || "unavailable"}`);
        if (multipleBankDetails) issues.push("Multiple different bank details were found across the uploaded files for this ABN.");
        else if (bankDetailStatus === "first-seen") issues.push("First bank details found for this ABN. Confirm the BSB and account number before saving.");
        else if (bankDetailStatus === "mismatch") issues.push("Bank details do not match the details saved in Records. Confirm before replacing the saved bank details.");
        if (official.source === "pending") issues.push("Official API is not connected. Add a GUID and verify again.");
        const recordToSave = { ...official, bankDetails: multipleBankDetails ? savedBankDetails : fileBankDetails ?? savedBankDetails };
        nextChecks.push({
          id: crypto.randomUUID(),
          batchId,
          fileName: detected.fileNames.join(", "),
          fileIds: detected.fileIds,
          uploadedAt: detected.uploadedAt,
          checkedAt: new Date().toISOString(),
          abn: detected.abn,
          official: recordToSave,
          issues,
          reviewed: false,
          fileBankDetails,
          fileBankDetailCandidates: detected.bankDetailCandidates,
          savedBankDetails,
          bankDetailStatus,
          ...claims,
        });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Lookup failed");
      }
    }
    setChecks((previous) => [...nextChecks, ...previous].slice(0, 100));
    setActiveCheckIndex(0);
    setBusy(false);
    setNotice(`Verification complete: ${nextChecks.length} ABN${nextChecks.length === 1 ? "" : "s"}. Review the suggested payee before completing this batch.`);
  }

  function clearVerificationResults() {
    setChecks([]);
    setActiveCheckIndex(0);
    if (currentAccount) localStorage.removeItem(accountStorageKey(currentAccount.id, "checks"));
    setNotice("Verification results cleared.");
  }

  function setCheckReviewed(checkId: string, reviewed: boolean) {
    setChecks((previous) => previous.map((check) => check.id === checkId && !bankSelectionMissing(check) ? { ...check, reviewed } : check));
  }

  function selectCheckBankDetails(checkId: string, candidateKey: string) {
    let selectedAccount = "";
    setChecks((previous) => previous.map((check) => {
      if (check.id !== checkId) return check;
      const candidate = check.fileBankDetailCandidates?.find((item) => bankDetailsKey(item.details) === candidateKey);
      if (!candidate) return check;
      selectedAccount = `${formatBsb(candidate.details.bsb)} · ${candidate.details.accountNumber || "Account number unavailable"}`;
      return {
        ...check,
        selectedBankDetailKey: candidateKey,
        fileBankDetails: candidate.details,
        official: { ...check.official, bankDetails: candidate.details },
        reviewed: false,
      };
    }));
    if (selectedAccount) setNotice(`Bank account ${selectedAccount} selected. Confirm it against the source file, then tick Reviewed.`);
  }

  function startEditingCheckName(check: ContractCheck) {
    setEditingCheckNameId(check.id);
    setCheckNameDraft(check.contractName);
  }

  function saveCheckName(checkId: string) {
    const nextName = checkNameDraft.trim();
    setChecks((previous) => previous.map((check) => {
      if (check.id !== checkId) return check;
      const issues = check.issues.filter((issue) => !isEntityNameIssue(issue));
      if (!nextName) issues.unshift("Company name was not found in the file");
      else if (check.official.entityName && compareCompanyNames(nextName, check.official.entityName) === "mismatch")
        issues.unshift(`File name “${nextName}” does not match the registered entity name`);
      return { ...check, contractName: nextName, issues, reviewed: false };
    }));
    setEditingCheckNameId(null);
    setCheckNameDraft("");
  }

  function cancelEditingCheckName() {
    setEditingCheckNameId(null);
    setCheckNameDraft("");
  }

  function recordsWithinQuota(items: AbnRecord[]) {
    const existing = new Set(register.map((item) => item.abn));
    let slots = availableAbnSlots();
    return items.filter((item) => {
      if (existing.has(item.abn)) return true;
      if (slots <= 0) return false;
      existing.add(item.abn);
      slots -= 1;
      return true;
    });
  }

  function addVerifiedRecords(items: AbnRecord[]) {
    const accepted = recordsWithinQuota(items);
    if (!accepted.length) {
      if (items.length) setNotice(quotaMessage());
      return;
    }
    setRegister((previous) => {
      const map = new Map(previous.map((item) => [item.abn, item]));
      accepted.forEach((item) => map.set(item.abn, item));
      return [...map.values()];
    });
    addHistoryEntries(accepted, "Added to register");
  }

  function completeVerificationBatch() {
    if (!latestChecks.length) return;
    const payeeChecks = latestChecks.filter(isCheckSelectedPayee);
    if (!payeeChecks.length) {
      setNotice("Select at least one payee ABN before completing this batch.");
      return;
    }
    const missingBankSelections = payeeChecks.filter(bankSelectionMissing);
    if (missingBankSelections.length) {
      setActiveCheckIndex(Math.max(0, latestChecks.findIndex((check) => check.id === missingBankSelections[0].id)));
      setNotice(`Choose the bank account to save for ${missingBankSelections[0].official.entityName || formatAbn(missingBankSelections[0].abn)} before completing this batch.`);
      return;
    }
    const completedAt = new Date().toISOString();
    const completed: TodayReview[] = payeeChecks.map((check) => ({
      id: crypto.randomUUID(),
      sourceCheckId: check.id,
      batchId: check.batchId,
      fileName: check.fileName || "—",
      uploadedAt: check.uploadedAt || check.checkedAt,
      completedAt,
      verifiedAt: checkIsVerified(check) ? completedAt : undefined,
      status: checkIsVerified(check) ? "verified" : "double-check",
      issues: check.issues,
      official: check.official,
      files: check.fileIds.map((fileId) => documents.find((document) => document.id === fileId)).filter((document): document is ContractDocument => Boolean(document)).map((document) => ({ id: document.id, name: document.name })),
    }));
    const eligibleVerifiedRecords = payeeChecks.filter(checkIsVerified).map((check) => check.official);
    const verifiedRecords = recordsWithinQuota(eligibleVerifiedRecords);
    setTodayReviews((previous) => [...completed, ...previous].slice(0, 500));
    addVerifiedRecords(verifiedRecords);
    documents.forEach((document) => URL.revokeObjectURL(document.url));
    setDocuments([]);
    setChecks([]);
    setActiveCheckIndex(0);
    setEditingCheckNameId(null);
    setCheckNameDraft("");
    if (fileRef.current) fileRef.current.value = "";
    const doubleChecks = completed.filter((item) => item.status === "double-check").length;
    const quotaSkipped = eligibleVerifiedRecords.length - verifiedRecords.length;
    setNotice(quotaSkipped ? `Batch completed, but ${quotaSkipped} verified ABN${quotaSkipped === 1 ? " was" : "s were"} not saved. ${quotaMessage()}` : `Batch completed and Check is ready for new files: ${verifiedRecords.length} verified record${verifiedRecords.length === 1 ? "" : "s"} saved${doubleChecks ? `, ${doubleChecks} sent to Review for double check` : ""}.`);
  }

  function verifyTodayReview(reviewId: string) {
    const review = todayReviews.find((item) => item.id === reviewId);
    if (!review || review.status === "verified") return;
    if (!register.some((item) => item.abn === review.official.abn) && availableAbnSlots() <= 0) {
      setNotice(quotaMessage());
      return;
    }
    const verifiedAt = new Date().toISOString();
    setTodayReviews((previous) => previous.map((item) => item.id === reviewId ? { ...item, status: "verified", verifiedAt } : item));
    addVerifiedRecords([review.official]);
    setNotice(`${review.official.entityName || formatAbn(review.official.abn)} verified and added to Records.`);
  }

  function toggleTodayDay(day: string) {
    setExpandedTodayDays((previous) => previous.includes(day) ? previous.filter((item) => item !== day) : [...previous, day]);
  }

  async function openTodayFile(file: TodayFileRef) {
    const preview = window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    try {
      const original = await loadOriginalFile(currentAccount.id, file.id);
      if (!original) throw new Error("Original file is unavailable");
      const url = URL.createObjectURL(original);
      if (preview) preview.location.href = url;
      else {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      preview?.close();
      setNotice(`The original file “${file.name}” is no longer available in this browser.`);
    }
  }

  function navigateTo(nextTab: Tab) {
    setNotice("");
    setTab(nextTab);
  }

  async function refreshAll(trigger: MonitoringTrigger) {
    if (!register.length || !currentAccount) return;
    setBusy(true);
    setNotice(`Updating ${register.length} record${register.length === 1 ? "" : "s"}…`);
    const refreshed: AbnRecord[] = [];
    const checkedRecords: AbnRecord[] = [];
    const logs: ChangeLog[] = [];
    for (let index = 0; index < register.length; index += 1) {
      const previous = register[index];
      try {
        const current = { ...(await lookupAbn(previous.abn)), bankDetails: previous.bankDetails };
        if (previous.source === "official" && current.source === "official") {
          logs.push(...compareRecord(previous, current, trigger));
        }
        refreshed.push(current);
        checkedRecords.push(current);
      } catch {
        refreshed.push(previous);
      }
    }
    const refreshedAt = new Date().toISOString();
    setRegister(refreshed);
    addHistoryEntries(checkedRecords, "Register update");
    setChanges((previous) => [...logs, ...previous].slice(0, 200));
    setLastRefresh(refreshedAt);
    localStorage.setItem(accountStorageKey(currentAccount.id, "lastRefresh"), refreshedAt);
    setBusy(false);
    setNotice(logs.length ? `Update complete. ${logs.length} change${logs.length === 1 ? "" : "s"} found.` : "Update complete. No changes found.");
  }

  async function addAbn() {
    const abn = onlyDigits(newAbn);
    if (!isValidAbn(abn)) {
      setNotice("Enter a valid 11-digit ABN.");
      return;
    }
    if (!register.some((item) => item.abn === abn) && availableAbnSlots() <= 0) {
      setNotice(quotaMessage());
      return;
    }
    setBusy(true);
    try {
      const result = await lookupAbn(abn);
      setRegister((previous) => [result, ...previous.filter((item) => item.abn !== abn)]);
      addHistoryEntries([result], "Added to register");
      setNewAbn("");
      setNotice(`${formatAbn(abn)} was added to the register`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add this ABN");
    } finally {
      setBusy(false);
    }
  }

  async function importList(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      const imported = rows.map((row) => {
        const rawAbn = row.ABN ?? row.abn ?? row["ABN号码"] ?? Object.values(row)[0];
        const abn = onlyDigits(String(rawAbn ?? ""));
        if (!isValidAbn(abn)) return null;
        const bankDetails = {
          bankName: String(row["Bank name"] ?? row["Bank Name"] ?? "").trim(),
          accountName: String(row["Account name"] ?? row["Account Name"] ?? "").trim(),
          bsb: onlyDigits(String(row.BSB ?? row.bsb ?? "")),
          accountNumber: onlyDigits(String(row["Account number"] ?? row["Account Number"] ?? row["Account no"] ?? "")),
        };
        return {
          abn,
          entityName: String(row["Entity name"] ?? row["Entity Name"] ?? row["实体名称"] ?? "Pending update"),
          status: "Unknown",
          statusFrom: "",
          gstRegistered: null,
          gstFrom: "",
          entityType: "",
          state: String(row.State ?? row["州"] ?? ""),
          postcode: String(row.Postcode ?? row["邮编"] ?? ""),
          lastChecked: "",
          source: "pending" as const,
          bankDetails: bankDetails.bsb || bankDetails.accountNumber ? bankDetails : undefined,
        } satisfies AbnRecord;
      }).filter((item): item is AbnRecord => Boolean(item));
      const accepted = recordsWithinQuota(imported);
      setRegister((previous) => {
        const map = new Map(previous.map((item) => [item.abn, item]));
        accepted.forEach((item) => map.set(item.abn, item));
        return [...map.values()];
      });
      addHistoryEntries(accepted, "Imported from file");
      const skipped = imported.length - accepted.length;
      setNotice(skipped ? `Imported ${accepted.length} ABNs. ${skipped} could not be added because this workspace reached its plan limit.` : `Imported ${accepted.length} valid ABN${accepted.length === 1 ? "" : "s"} from ${file.name}`);
    } catch {
      setNotice("Import failed. Use an XLSX, XLS or CSV file with ABN in the first column.");
    } finally {
      event.target.value = "";
    }
  }

  async function exportList() {
    const XLSX = await import("xlsx");
    const rows = register.map((item) => ({
      ABN: formatAbn(item.abn),
      "Entity name": item.entityName,
      "ABN status": item.status,
      "ABN status from": item.statusFrom,
      "GST registered": item.gstRegistered === null ? "Unknown" : item.gstRegistered ? "Yes" : "No",
      "GST from": item.gstFrom,
      "Entity type": item.entityType,
      State: item.state,
      Postcode: item.postcode,
      "Bank name": item.bankDetails?.bankName ?? "",
      "Account name": item.bankDetails?.accountName ?? "",
      BSB: item.bankDetails ? formatBsb(item.bankDetails.bsb) : "",
      "Account number": item.bankDetails?.accountNumber ?? "",
      "Last checked": item.lastChecked,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "ABN Register");
    XLSX.writeFile(workbook, `ABN-register-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function saveSettings() {
    if (!currentAccount) return;
    localStorage.setItem(accountStorageKey(currentAccount.id, "schedule"), schedule);
    setNotice("Update settings saved.");
  }

  if (!hydrated) return <div className="app-loading">Loading ABN Guard…</div>;

  if (!currentAccount) {
    const openAuth = (mode: "signin" | "register") => {
      setAuthMode(mode);
      setAuthStage("credentials");
      setAuthCode("");
      setAuthError("");
      setAuthNotice("");
      setContactError("");
      setContactSubmitted(false);
      setContactWebsite("");
      setShowAuth(true);
    };

    return (
      <main className="landing-shell">
        <nav className="landing-nav" aria-label="Main navigation">
          <a className="landing-brand" href="#top" aria-label="ABN Guard home"><span>A</span><strong>ABN Guard</strong></a>
          <div className="landing-nav-links"><a href="#product">Product</a><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><a href="#security">Security</a></div>
          <div className="landing-nav-actions"><button className="landing-signin" type="button" onClick={() => openAuth("signin")}>Sign in</button><button className="landing-nav-cta" type="button" onClick={() => openAuth("register")}>Join now <span>↗</span></button></div>
        </nav>

        <section className="landing-hero" id="top">
          <div className="landing-hero-copy">
            <div className="landing-kicker"><span>✓</span> Australian supplier verification</div>
            <h1>Know who you’re paying.<br /><em>Before money moves.</em></h1>
            <p>Turn contracts and invoices into trusted supplier records. Check ABNs, GST status and bank details in one clear workflow.</p>
            <div className="landing-hero-actions"><button type="button" className="landing-primary" onClick={() => openAuth("register")}>Check suppliers free <span>→</span></button><a href="#product" className="landing-secondary"><span>▶</span> See how it works</a></div>
            <div className="landing-trust"><span><b>✓</b> No credit card</span><span><b>✓</b> Set up in minutes</span><span><b>✓</b> Australian data</span></div>
          </div>

          <div className="landing-product-shot" aria-label="ABN Guard verification dashboard preview">
            <div className="shot-window">
              <div className="shot-top"><div className="shot-logo"><span>A</span><b>ABN Guard</b></div><div className="shot-date">12 AUG 2026</div><div className="shot-user">PP</div></div>
              <div className="shot-layout">
                <aside className="shot-side"><div className="shot-nav active"><span>⌕</span>Check</div><div className="shot-nav"><span>✓</span>Review <b>3</b></div><div className="shot-nav"><span>▤</span>Records</div><div className="shot-nav"><span>!</span>Alerts</div><small>WORKSPACE</small><div className="shot-company"><span>AC</span><p><b>Acme Co.</b><em>Finance team</em></p></div></aside>
                <div className="shot-main"><div className="shot-heading"><div><span>SUPPLIER VERIFICATION</span><h2>Check a supplier</h2></div><i>ABR connected</i></div><div className="shot-stats"><div><small>CHECKS TODAY</small><b>24</b><em>↑ 18%</em></div><div><small>VERIFIED</small><b>21</b><em>87.5%</em></div><div className="attention"><small>NEEDS REVIEW</small><b>3</b><em>Action needed</em></div></div><div className="shot-verify"><section><span className="shot-step">1</span><h3>Add contract</h3><div className="shot-drop"><span>↥</span><b>Drop documents here</b><small>PDF, DOCX or TXT</small></div><button>Verify supplier <span>→</span></button></section><section><div className="shot-result-title"><div><span className="shot-step">2</span><h3>Verification result</h3></div><i>PASS</i></div><div className="shot-entity"><span>AC</span><div><small>REGISTERED ENTITY</small><b>ACME SUPPLIES PTY LTD</b><em>ABN 53 004 085 616</em></div><i>✓</i></div><div className="shot-check-row"><span>ABN status</span><b>● Active</b></div><div className="shot-check-row"><span>GST registration</span><b>✓ Registered</b></div><div className="shot-check-row"><span>Bank details</span><b>✓ Match</b></div></section></div></div>
              </div>
            </div>
            <div className="shot-float-card"><span>✓</span><div><b>Supplier verified</b><small>All details match the official record</small></div></div>
            <div className="shot-float-status"><span>ABN</span><div><small>STATUS</small><b>Active</b></div></div>
          </div>
        </section>

        <section className="landing-proof"><p>One workspace for every supplier check</p><div><span>ABN LOOKUP</span><i /><span>GST STATUS</span><i /><span>BANK DETAILS</span><i /><span>CHANGE MONITORING</span></div></section>

        <section className="landing-section" id="product">
          <div className="landing-section-heading"><p className="landing-label">THE SAFER WAY TO PAY</p><h2>Catch the details that<br />cost businesses money.</h2><p>ABN Guard brings supplier verification into one calm, repeatable workflow—so your team can move fast without taking shortcuts.</p></div>
          <div className="landing-feature-grid">
            <article className="landing-feature large"><div className="feature-copy"><span className="feature-icon">⌕</span><h3>Read the documents.<br />Find the supplier.</h3><p>Upload contracts, invoices or engagement letters. ABN Guard extracts supplier identities and payment details in seconds.</p><a href="#how-it-works">Explore document checks <span>→</span></a></div><div className="feature-visual document-visual"><div className="doc-paper"><small>TAX INVOICE</small><h4>Northbank Electrical</h4><div className="doc-line long"/><div className="doc-line"/><div className="doc-highlight">ABN&nbsp;&nbsp; 53 004 085 616 <span>✓</span></div><div className="doc-line medium"/><div className="doc-highlight bank">BSB&nbsp;&nbsp; 062-000&nbsp;&nbsp;&nbsp; Account&nbsp;&nbsp; 1045 8792 <span>✓</span></div></div></div></article>
            <article className="landing-feature dark"><div className="feature-copy"><span className="feature-icon">◎</span><h3>Compare against the source of truth.</h3><p>See the contract beside the official ABN Lookup record. Status, GST and entity details are clear at a glance.</p></div><div className="compare-mini"><div><small>DOCUMENT</small><b>Northbank Electrical</b><span>53 004 085 616</span></div><i>✓</i><div><small>ABN LOOKUP</small><b>NORTHBANK ELECTRICAL PTY LTD</b><span>Active · GST registered</span></div></div></article>
            <article className="landing-feature mint"><div className="feature-copy"><span className="feature-icon">↻</span><h3>Know when something changes.</h3><p>Maintain one clean supplier register and review changes to ABN, GST, entity or bank details over time.</p></div><div className="alert-mini"><div><span>NB</span><p><b>Northbank Electrical</b><small>ABN 53 004 085 616</small></p><i>Verified</i></div><div><span>SF</span><p><b>Southside Fabrication</b><small>GST status changed</small></p><i className="warn">Review</i></div><div><span>MC</span><p><b>Metro Civil Group</b><small>Bank details updated</small></p><i className="warn">Review</i></div></div></article>
          </div>
        </section>

        <section className="landing-steps" id="how-it-works">
          <div><p className="landing-label">HOW IT WORKS</p><h2>From document to decision<br />in three simple steps.</h2></div>
          <ol><li><span>01</span><div><h3>Upload your documents</h3><p>Add multiple PDF, DOCX or TXT files at once. They are read directly inside your workspace.</p></div></li><li><span>02</span><div><h3>Review the comparison</h3><p>ABN Guard matches supplier claims against official registration records and your saved bank details.</p></div></li><li><span>03</span><div><h3>Save a verified record</h3><p>Resolve any flagged differences, then add the supplier to a register your team can trust.</p></div></li></ol>
        </section>

        <section className="landing-pricing" id="pricing">
          <div className="landing-pricing-heading"><p className="landing-label">SIMPLE MONTHLY PRICING</p><h2>Start free. Grow when<br />your register does.</h2><p>Every plan includes document checks, ABN and GST verification, bank-detail comparison and change monitoring.</p></div>
          <div className="pricing-grid">
            <article><p>Free trial</p><h3><span>A$</span>0<small>/month</small></h3><b>Up to 30 ABN / bank-detail records</b><ul><li>Google or email sign-in</li><li>Supplier verification</li><li>ABN register and alerts</li></ul><button type="button" onClick={() => chooseLandingPlan("free")}>Join now <span>→</span></button></article>
            <article className="popular"><em>Most popular</em><p>Starter</p><h3><span>A$</span>9.90<small>/month</small></h3><b>Up to 500 ABN / bank-detail records</b><ul><li>Everything in Free trial</li><li>Larger supplier register</li><li>Stripe subscription management</li></ul><button type="button" onClick={() => chooseLandingPlan("starter")}>Choose Starter <span>→</span></button></article>
          </div>
          <small>Prices are in Australian dollars. Cancel or change plan through the secure Stripe billing portal.</small>
        </section>

        <section className="landing-security" id="security"><div className="security-orbit"><div className="security-ring one"/><div className="security-ring two"/><div className="security-lock">✓</div><span className="security-chip chip-one">LOCAL<br />WORKSPACE</span><span className="security-chip chip-two">OFFICIAL<br />ABN DATA</span><span className="security-chip chip-three">TEAM<br />CONTROL</span></div><div className="security-copy"><p className="landing-label">BUILT FOR TRUST</p><h2>Your supplier data stays<br />under your control.</h2><p>ABN Guard is designed for sensitive finance workflows. Company workspaces are separate, credentials stay server-side and uploaded files remain in your browser.</p><div><span><b>01</b>Local document processing</span><span><b>02</b>Server-side ABN credentials</span><span><b>03</b>Separate company workspaces</span></div></div></section>

        <section className="landing-final"><p className="landing-label">START WITH YOUR NEXT SUPPLIER</p><h2>A clearer check.<br /><em>A safer payment.</em></h2><p>Give your finance team one dependable place to verify every supplier before money moves.</p><button type="button" className="landing-primary light" onClick={() => openAuth("register")}>Join now — it’s free <span>→</span></button><small>No credit card required · Set up in minutes</small></section>

        <footer className="landing-footer"><a className="landing-brand" href="#top"><span>A</span><strong>ABN Guard</strong></a><p>Supplier verification for Australian finance teams.</p><div><a href="#product">Product</a><a href="#pricing">Pricing</a><a href="#security">Security</a><button type="button" onClick={() => openAuth("signin")}>Sign in</button></div><small>© {new Date().getFullYear()} ABN Guard</small></footer>

        {showAuth && <div className="auth-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAuth(false); }}>
          <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button className="auth-modal-close" type="button" aria-label="Close" onClick={() => setShowAuth(false)}>×</button>
            <div className="auth-modal-brand"><span>A</span><strong>ABN Guard</strong></div>
            <div className="auth-form">
              {authStage === "verify" ? <>
                <p className="eyebrow">EMAIL VERIFICATION</p>
                <h2 id="auth-title">Check your inbox</h2>
                <p>We sent a 6-digit verification code to <b>{authEmail.trim().toLowerCase()}</b>. Enter it below to create your workspace.</p>
                <form className="email-auth-form verification-form" onSubmit={(event) => void verifyEmailRegistration(event)}>
                  <label>Verification code<input className="verification-code-input" inputMode="numeric" autoComplete="one-time-code" value={authCode} onChange={(event) => setAuthCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" autoFocus /></label>
                  <button className="primary-button" type="submit" disabled={authSubmitting}>{authSubmitting ? "Verifying…" : "Verify email & continue"}<span>→</span></button>
                </form>
                {authError && <div className="auth-error">{authError}</div>}
                {authNotice && <div className="auth-notice">{authNotice}</div>}
                <div className="verification-actions"><button type="button" disabled={authSubmitting} onClick={() => void resendVerificationCode()}>Resend code</button><button type="button" onClick={() => { setAuthStage("credentials"); setAuthCode(""); setAuthError(""); setAuthNotice(""); }}>Change email</button></div>
              </> : <>
                <p className="eyebrow">{authMode === "register" ? "CREATE YOUR WORKSPACE" : "WELCOME BACK"}</p>
                <h2 id="auth-title">{authMode === "register" ? "Start checking suppliers for free" : "Sign in to ABN Guard"}</h2>
                <p>{authMode === "register" ? "Create your company workspace with Google or your work email." : "Continue with Google or sign in using your email and password."}</p>
                {authMode === "register" && <div className="auth-plan-summary"><span>Free trial</span><b>Up to 30 ABN / bank-detail records</b><small>No credit card required</small></div>}
                {googleConfigured ? <div className={googleSigningIn ? "google-auth-button-host busy" : "google-auth-button-host"} ref={googleButtonRef}>{googleSigningIn && <span>Signing you in…</span>}</div> : <button className="google-auth-button" type="button" disabled><span className="google-mark">G</span>{authMode === "register" ? "Join with Google" : "Sign in with Google"}</button>}
                <div className="auth-divider"><span>or use email</span></div>
                <form className="email-auth-form" onSubmit={(event) => void submitAuth(event)}>
                  {authMode === "register" && <label>Company name<input type="text" value={authCompany} onChange={(event) => setAuthCompany(event.target.value)} placeholder="Example Pty Ltd" autoComplete="organization" /></label>}
                  <label>{authMode === "signin" ? "Email or beta username" : "Work email"}<input type={authMode === "signin" ? "text" : "email"} value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder={authMode === "signin" ? "you@company.com" : "you@company.com"} autoComplete="username" /></label>
                  <label>Password<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder={authMode === "register" ? "At least 8 characters" : "Your password"} autoComplete={authMode === "register" ? "new-password" : "current-password"} /></label>
                  <button className="primary-button email-auth-submit" type="submit" disabled={authSubmitting}>{authSubmitting ? authMode === "register" ? "Sending code…" : "Signing in…" : authMode === "register" ? "Create account with email" : "Sign in"}<span>→</span></button>
                </form>
                {authError && <div className="auth-error">{authError}</div>}
                <div className="auth-switch">{authMode === "register" ? "Already have an account?" : "New to ABN Guard?"}<button type="button" onClick={() => { setAuthMode(authMode === "register" ? "signin" : "register"); setAuthStage("credentials"); setAuthError(""); setAuthNotice(""); }}>{authMode === "register" ? "Sign in" : "Join now"}</button></div>
              </>}
            </div>
          </section>
        </div>}
      </main>
    );
  }

  if (!currentAccount.setupComplete) {
    return (
      <main className="setup-shell">
        <header className="setup-header"><div className="auth-brand"><span className="brand-mark">A</span><strong>ABN Guard</strong></div><button className="ghost-button" onClick={signOut}>Sign out</button></header>
        <section className="setup-card panel">
          <div className="setup-progress"><span className="done">✓</span><i /><span className="active">2</span></div>
          <p className="eyebrow">Company setup · Step 2 of 2</p>
          <h1>Connect your company ABN</h1>
          <p>We’ll search ABN Lookup, confirm your registered details and save the company ABN to your workspace.</p>
          <label className="setup-label">Australian Business Number<div><input value={setupAbn} onChange={(event) => setSetupAbn(event.target.value)} placeholder="e.g. 53 004 085 616" onKeyDown={(event) => event.key === "Enter" && void searchSetupAbn()} /><button className="primary-small" onClick={() => void searchSetupAbn()} disabled={busy}>{busy ? "Searching…" : "Search ABN"}</button></div></label>
          {setupError && <div className="auth-error">{setupError}</div>}
          {setupRecord && (
            <div className="setup-result">
              <div><span className={setupRecord.status === "Active" ? "status-dot active" : "status-dot cancelled"}>{setupRecord.status}</span><small>{setupRecord.source === "official" ? "Official ABN Lookup" : setupRecord.source === "demo" ? "Demo snapshot" : "Pending official connection"}</small></div>
              <h3>{setupRecord.entityName}</h3><code>{formatAbn(setupRecord.abn)}</code>
              <div className="setup-facts"><span><small>GST</small><b>{setupRecord.gstRegistered === null ? "Pending" : setupRecord.gstRegistered ? "Registered" : "Not registered"}</b></span><span><small>Entity type</small><b>{setupRecord.entityType || "Pending"}</b></span><span><small>Location</small><b>{setupRecord.state ? `${setupRecord.state} ${setupRecord.postcode}` : "Pending"}</b></span></div>
              {setupRecord.source === "pending" && <p className="setup-warning">Your GUID is not connected yet. You can continue now and refresh this record when the GUID arrives.</p>}
            </div>
          )}
          <button className="primary-button" disabled={!setupRecord} onClick={completeSetup}>Save company & open workspace<span>→</span></button>
        </section>
      </main>
    );
  }

  const nav = [
    { id: "verify" as const, icon: "C", label: "Check", hint: "Extract & compare" },
    { id: "today" as const, icon: "R", label: "Review", hint: `${doubleCheckItems.length} to review` },
    { id: "register" as const, icon: "R", label: "Records", hint: `${register.length} records` },
    { id: "changes" as const, icon: "A", label: "Alerts", hint: `${changes.length} changes` },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">A</span><div><strong>ABN Guard</strong><small>Supplier verification</small></div></div>
        <nav><p className="nav-title">Workspace</p>{nav.map((item) => <button key={item.id} className={tab === item.id ? "nav-item active" : "nav-item"} onClick={() => navigateTo(item.id)}><span>{item.icon}</span><div><b>{item.label}</b><small>{item.hint}</small></div></button>)}</nav>
        <div className="sidebar-bottom">
          {isCloudAccount(currentAccount) && <div className="sidebar-plan"><div><b>{currentAccount.planName || "Free"}</b><span>{register.length} / {currentAccount.abnLimit ?? 30} records</span></div><i><span style={{ width: `${Math.min(100, register.length / (currentAccount.abnLimit ?? 30) * 100)}%` }} /></i><button type="button" disabled={billingBusy} onClick={() => void (currentAccount.plan === "starter" ? openBillingPortal() : startCheckout("starter"))}>{billingBusy ? "Opening Stripe…" : currentAccount.plan === "starter" ? "Manage plan" : "Upgrade now"}</button></div>}
          <button className={tab === "settings" ? "nav-item active" : "nav-item"} onClick={() => navigateTo("settings")}><span>⚙</span><div><b>Connection</b><small>{apiConfigured ? "Official API" : "Demo mode"}</small></div></button>
          <div className="account-card">{currentAccount.picture ? <img src={currentAccount.picture} alt="" referrerPolicy="no-referrer" /> : <span>{currentAccount.companyName.slice(0, 2).toUpperCase()}</span>}<div><b>{currentAccount.companyName}</b><small>{currentAccount.email}</small></div><button onClick={signOut} aria-label="Sign out">↗</button></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><p className="eyebrow">{tab === "verify" ? "Contract due diligence" : tab === "today" ? "Review workspace" : tab === "register" ? "Supplier master data" : tab === "changes" ? "Ongoing monitoring" : "Data connection"}</p><h1>{tab === "verify" ? "Verify ABNs in contracts" : tab === "today" ? "Review" : tab === "register" ? "Records" : tab === "changes" ? "Alerts" : "Connection & update settings"}</h1></div></header>
        {notice && <div className="notice"><span>i</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {tab === "verify" && <div className="page-content verify-page">
          <div className="stats-row"><article><span>Saved records</span><strong>{register.length}{isCloudAccount(currentAccount) && <em> / {currentAccount.abnLimit ?? 30}</em>}</strong><small>{isCloudAccount(currentAccount) ? `${currentAccount.planName || "Free"} plan` : currentAccount.companyName}</small></article><article><span>Contract checks</span><strong>{checks.length}</strong><small>Recent results</small></article><article className="warn-stat"><span>Needs attention</span><strong>{issueCount}</strong><small>Discrepancies or risks</small></article><article><span>Last update</span><strong className="date-stat">{lastRefresh ? dateTime(lastRefresh) : "Not run"}</strong><small>{schedule === "weekly" ? "Weekly check" : "Manual check"}</small></article></div>
          <div className="verify-grid">
            <article className="panel contract-panel">
              <div className="panel-heading"><div><span className="step">1</span><h2>Add contracts</h2></div><small>Multiple files supported</small></div>
              <div className={isDragging ? "dropzone dragging" : "dropzone"} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setIsDragging(false); void handleFiles(Array.from(event.dataTransfer.files)); }} onClick={() => fileRef.current?.click()}>
                <span className="upload-icon">↥</span><strong>{isParsing ? "Reading contracts…" : "Drop contracts here, or click to browse"}</strong><small>Upload multiple PDF, DOCX or TXT files · processed in this browser</small>
                <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.text" onChange={(event) => { void handleFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} hidden />
              </div>
              <div className="file-recognition-summary"><span>Files recognised</span><strong>{documents.filter((document) => document.abns.length > 0).length} / {documents.length}</strong></div>
              <button className="primary-button" disabled={busy || isParsing || !detectedEntities.length} onClick={() => void verifyContracts()}>{busy ? "Verifying…" : `Verify ${detectedEntities.length} ABN${detectedEntities.length === 1 ? "" : "s"}`}<span>→</span></button>
            </article>

            <article className="panel results-panel">
              <div className="panel-heading"><div><span className="step">2</span><h2>Verification results</h2></div>{latestChecks.length ? <div className="result-navigation" aria-label="Verification result navigation"><span>{activeCheckIndex + 1} / {latestChecks.length}</span><button type="button" aria-label="Previous verification result" title="Previous result" disabled={activeCheckIndex === 0} onClick={() => setActiveCheckIndex((current) => Math.max(0, current - 1))}>←</button><button type="button" aria-label="Next verification result" title="Next result" disabled={activeCheckIndex === latestChecks.length - 1} onClick={() => setActiveCheckIndex((current) => Math.min(latestChecks.length - 1, current + 1))}>→</button><button type="button" className="result-clear" aria-label="Clear all verification results" title="Clear all results" onClick={clearVerificationResults}>Clear</button><button type="button" className="result-complete" aria-label="Complete this verification batch" title="Save verified records and send this batch to Review" onClick={completeVerificationBatch}>Complete</button></div> : <small>File vs ABN Lookup</small>}</div>
              {!latestChecks.length ? <div className="empty-state"><span>✓</span><h3>Ready to verify</h3><p>Upload one or more contracts to compare the entity name, ABN and location.</p></div> : <div className="check-list">{latestChecks.slice(activeCheckIndex, activeCheckIndex + 1).map((check) => {
                const safeContractName = check.contractName && check.contractName.length <= 120 ? check.contractName : "Not found in file";
                const sourceLabel = check.official.source === "official" ? "Official ABN Lookup service" : check.official.source === "demo" ? "Built-in demo snapshot" : "Pending official lookup";
                const officialLocation = [check.official.state, check.official.postcode].filter(Boolean).join(" ");
                const sourceDocuments = documents.filter((document) => check.fileIds?.includes(document.id));
                const isSelectedPayee = isCheckSelectedPayee(check);
                const roleCandidate = sourceDocuments.flatMap((document) => document.abnRoles).filter((candidate) => candidate.abn === check.abn).sort((left, right) => right.confidence - left.confidence)[0];
                const manuallySelected = isSelectedPayee && sourceDocuments.some((document) => document.selectedPayeeAbns.includes(check.abn) && document.payeeSelection === "manual");
                const roleLabel = isSelectedPayee ? manuallySelected ? "Selected payee" : "Suggested payee" : roleCandidate?.role === "payer" ? "Customer / ignored" : "Not selected";
                const nameComparison = safeContractName === "Not found in file" || !check.official.entityName ? null : compareCompanyNames(safeContractName, check.official.entityName);
                const abnMatch = onlyDigits(check.abn) === onlyDigits(check.official.abn);
                const locationMatch = !check.contractLocation ? null : Boolean(officialLocation) && normalizeLocation(check.contractLocation) === normalizeLocation(officialLocation);
                const isVerified = checkIsVerified(check);
                return <div className={isSelectedPayee && !isVerified ? "check-card alert" : "check-card"} key={check.id}>
                  <div className="check-card-top"><div><small>{formatAbn(check.abn)}</small><h3>{check.official.entityName || "Entity pending lookup"}</h3>{roleCandidate && <p className="role-confidence">{manuallySelected ? "Manually selected in Verification results" : `${roleCandidate.reasons[0]} · ${Math.round(roleCandidate.confidence * 100)}% confidence`}</p>}</div><div className="check-result-actions"><span className={isSelectedPayee ? "payee-role-pill selected" : roleCandidate?.role === "payer" ? "payee-role-pill ignored" : "payee-role-pill"}>{roleLabel}</span>{!isSelectedPayee ? <button type="button" className="select-payee-result" onClick={() => selectPayeeFromResult(check)}>Use as payee</button> : <><span className={isVerified ? "result-pill ok" : "result-pill issue"}>{isVerified ? "Verified" : `${check.issues.length} issue${check.issues.length === 1 ? "" : "s"}`}</span>{check.issues.length > 0 && <label className={check.reviewed ? "review-check checked" : bankSelectionMissing(check) ? "review-check disabled" : "review-check"}><input type="checkbox" checked={check.reviewed} disabled={bankSelectionMissing(check)} onChange={(event) => setCheckReviewed(check.id, event.target.checked)} /><span>{bankSelectionMissing(check) ? "Select bank account first" : "Reviewed"}</span></label>}</>}</div></div>
                  <div className="verification-compare">
                    <section className="evidence-panel file-evidence">
                      <div className="evidence-title"><span>FILE</span><div><b>Details from file</b><small className="file-source-links">{sourceDocuments.length ? sourceDocuments.map((document, index) => <Fragment key={document.id}>{index > 0 && <span>, </span>}<a href={document.url} target="_blank" rel="noreferrer" title={`Open ${document.name}`}>{document.name}</a></Fragment>) : check.fileName}</small></div></div>
                      <dl>
                        <div><dt>Entity name</dt><dd className="file-entity-value">{editingCheckNameId === check.id ? <form className="entity-name-editor" onSubmit={(event) => { event.preventDefault(); saveCheckName(check.id); }}><input autoFocus value={checkNameDraft} onChange={(event) => setCheckNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") cancelEditingCheckName(); }} aria-label="Detected entity name" /><button type="submit" aria-label="Save detected entity name">Save</button><button type="button" onClick={cancelEditingCheckName} aria-label="Cancel entity name edit">Cancel</button></form> : <><span>{safeContractName}</span><button type="button" onClick={() => startEditingCheckName(check)}>Edit</button></>}</dd></div>
                        <div><dt>ABN</dt><dd>{formatAbn(check.abn)}</dd></div>
                        <div><dt>Location</dt><dd>{check.contractLocation || "Not found in file"}</dd></div>
                      </dl>
                    </section>
                    <section className="evidence-panel lookup-evidence">
                      <div className="evidence-title"><span>✓</span><div><b>ABN Lookup</b><small>{sourceLabel}</small></div></div>
                      <dl>
                        <div><dt>Registered entity</dt><dd className="compare-value"><span>{check.official.entityName || "Unavailable"}</span><em className={nameComparison === "mismatch" ? "mismatch" : nameComparison ? "match" : "not-compared"}>{nameComparison === "exact" ? "Match" : nameComparison === "close" ? "Close match" : nameComparison === "mismatch" ? "Mismatch" : "Not compared"}</em></dd></div>
                        <div><dt>ABN</dt><dd className="compare-value"><span>{formatAbn(check.official.abn)}</span><em className={abnMatch ? "match" : "mismatch"}>{abnMatch ? "Match" : "Mismatch"}</em></dd></div>
                        <div><dt>Main location</dt><dd className="compare-value"><span>{officialLocation || "Unavailable"}</span><em className={locationMatch === true ? "match" : locationMatch === false ? "mismatch" : "not-compared"}>{locationMatch === true ? "Match" : locationMatch === false ? "Mismatch" : "Not compared"}</em></dd></div>
                      </dl>
                    </section>
                  </div>
                  {isSelectedPayee && <BankVerification check={check} onSelectCandidate={(candidateKey) => selectCheckBankDetails(check.id, candidateKey)} />}
                  <div className="registration-facts">
                    <div className={check.official.gstRegistered === null ? "registration-fact" : check.official.gstRegistered ? "registration-fact gst-active" : "registration-fact gst-inactive"}><span>GST</span><div><small>GST registration</small><b>{check.official.gstRegistered === null ? "Pending lookup" : check.official.gstRegistered ? "Registered" : "Not registered"}</b>{check.official.gstFrom && <p>From {check.official.gstFrom}</p>}</div></div>
                    <div className="registration-fact abn-date"><span>ABN</span><div><small>{check.official.status === "Active" ? "ABN registration date" : "ABN status effective date"}</small><b>{check.official.statusFrom || "Unavailable"}</b></div></div>
                  </div>
                </div>;
              })}</div>}
            </article>
          </div>
        </div>}

        {tab === "today" && <div className="page-content today-page">
          <div className="today-summary">
            <article className="panel"><span className="today-summary-icon attention">!</span><div><small>Double check</small><strong>{doubleCheckItems.length}</strong><p>Items still waiting for a decision</p></div></article>
            <article className="panel"><span className="today-summary-icon verified">✓</span><div><small>Verified</small><strong>{verifiedTodayItems.length}</strong><p>Approved and saved to Records</p></div></article>
          </div>
          <div className="today-day-list">{todayDayGroups.map(({ day, items }) => {
            const isCurrent = day === todayDayKey;
            const isExpanded = expandedTodayDays.includes(day);
            const dayDoubleChecks = items.filter((item) => item.status === "double-check");
            const dayVerified = items.filter((item) => item.status === "verified");
            return <section className={isCurrent ? "panel today-day current" : "panel today-day"} key={day}>
              <button className="today-day-toggle" type="button" aria-expanded={isExpanded} aria-controls={`today-day-${day}`} onClick={() => toggleTodayDay(day)}>
                <div className="today-day-title"><span>{isCurrent ? "Current day" : "Daily archive"}</span><h2>{todayReviewDayLabel(day, isCurrent)}</h2><p>{isCurrent ? "New activity since 8:00 am · refreshes daily at 8:00 am" : `${items.length} completed check${items.length === 1 ? "" : "s"}`}</p></div>
                <div className="today-day-counts"><span className={dayDoubleChecks.length ? "attention" : ""}><b>{dayDoubleChecks.length}</b> Double check</span><span><b>{dayVerified.length}</b> Verified</span><i aria-hidden="true">⌄</i></div>
              </button>
              {isExpanded && <div className="today-day-content" id={`today-day-${day}`}>
                <TodaySection title="Double check" subtitle="Review unresolved mismatches before adding them to Records." items={dayDoubleChecks} onVerify={verifyTodayReview} onOpenFile={(file) => void openTodayFile(file)} />
                <TodaySection title="Verified" subtitle="Completed checks that are already recorded in your supplier records." items={dayVerified} onOpenFile={(file) => void openTodayFile(file)} />
              </div>}
            </section>;
          })}</div>
        </div>}

        {tab === "register" && <div className="page-content">
          <div className="table-toolbar"><div className="table-filters"><div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ABN, entity name or state" /></div><select className="filter-select" aria-label="Filter ABN Register" value={registerFilter} onChange={(event) => setRegisterFilter(event.target.value as RegisterFilter)}><option value="all">All records</option><option value="attention">Needs attention</option><option value="active">Active ABNs</option><option value="cancelled">Cancelled ABNs</option><option value="gst-registered">GST registered</option><option value="gst-not-registered">GST not registered</option></select></div><div className="toolbar-actions"><input value={newAbn} onChange={(event) => setNewAbn(event.target.value)} placeholder="Enter ABN" onKeyDown={(event) => event.key === "Enter" && void addAbn()} /><button className="secondary-button" onClick={() => void addAbn()} disabled={busy || availableAbnSlots() <= 0}>+ Add</button><button className="secondary-button" onClick={() => importRef.current?.click()} disabled={availableAbnSlots() <= 0}>Import Excel</button><input ref={importRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => void importList(event)} /><button className="secondary-button" onClick={() => void exportList()}>Export Excel</button><button className="primary-small" onClick={() => void refreshAll("manual")} disabled={busy}>↻ {busy ? "Updating" : "Update now"}</button></div></div>
          <div className="table-meta"><span>Showing {filteredRegister.length} of {register.length} records · {register.filter((item) => item.status === "Active").length} Active</span><span>Last bulk update: {dateTime(lastRefresh)}</span></div>
          <div className="table-wrap records-table-wrap"><table className="records-table"><thead><tr><th>ABN / Entity name</th><th>ABN status</th><th>GST</th><th>Entity type</th><th>Main location</th><th>Bank details</th><th>Last checked</th><th aria-label="Actions" /></tr></thead><tbody>{filteredRegister.map((item) => {
            const isExpanded = expandedAbns.includes(item.abn);
            const isHistoryLoading = loadingHistoryAbns.includes(item.abn);
            const nameHistory = item.officialHistory?.entityNames?.length ? item.officialHistory.entityNames : item.entityName ? [{ value: item.entityName, from: item.statusFrom, to: "" }] : [];
            const statusHistory = item.officialHistory?.abnStatuses?.length ? item.officialHistory.abnStatuses : item.status !== "Unknown" ? [{ value: item.status, from: item.statusFrom, to: "" }] : [];
            const gstHistory = item.officialHistory?.gstRegistrations?.length ? item.officialHistory.gstRegistrations : item.gstRegistered ? [{ value: "Registered", from: item.gstFrom, to: "" }] : [];
            const locationHistory = item.officialHistory?.locations?.length ? item.officialHistory.locations : item.state ? [{ value: `${item.state} ${item.postcode}`.trim(), from: "", to: "" }] : [];
            const itemHistory = history.filter((entry) => entry.abn === item.abn);
            const latestRegisterUpdate = itemHistory
              .filter((entry) => entry.event === "Register update")
              .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
              .slice(0, 1);
            const visibleHistory = [
              ...itemHistory.filter((entry) => entry.event !== "Register update"),
              ...latestRegisterUpdate,
            ];
            const activity: { id: string; at: string; title: string; detail: string; kind: "snapshot" | "check" | "change" }[] = [
              ...visibleHistory.map((entry) => ({ id: entry.id, at: entry.recordedAt, title: entry.event, detail: `${entry.entityName || "Entity name unavailable"} · ${entry.status} · GST ${entry.gstRegistered === null ? "pending" : entry.gstRegistered ? "registered" : "not registered"}${entry.state ? ` · ${entry.state} ${entry.postcode}` : ""}${entry.bankDetails ? " · Bank details saved" : ""}`, kind: "snapshot" as const })),
              ...checks.filter((check) => check.abn === item.abn).map((check) => ({ id: check.id, at: check.checkedAt, title: "Contract verification", detail: `${check.fileName} · ${check.issues.length ? `${check.issues.length} issue${check.issues.length === 1 ? "" : "s"} found` : "No discrepancies found"}`, kind: "check" as const })),
              ...changes.filter((change) => change.abn === item.abn).map((change) => ({ id: change.id, at: change.changedAt, title: "Recorded change", detail: change.description, kind: "change" as const })),
            ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
            if (!activity.length && item.lastChecked) activity.push({ id: `current-${item.abn}`, at: item.lastChecked, title: "Latest saved snapshot", detail: `${item.status} · GST ${item.gstRegistered === null ? "pending" : item.gstRegistered ? "registered" : "not registered"}`, kind: "snapshot" });
            return <Fragment key={item.abn}>
              <tr className={isExpanded ? "register-row expanded" : "register-row"}>
                <td><b>{item.entityName}</b><small>{formatAbn(item.abn)}{item.abn === currentAccount.ownAbn ? " · Your company" : ""}</small></td>
                <td><span className={item.status === "Active" ? "status-dot active" : item.status === "Cancelled" ? "status-dot cancelled" : "status-dot"}>{item.status}</span><small>{item.statusFrom || "Pending update"}</small></td>
                <td><b className={item.gstRegistered === false ? "gst-status not-registered" : "gst-status"}>{item.gstRegistered === null ? "Pending" : item.gstRegistered ? "Registered" : "Not registered"}</b><small>{item.gstFrom || "—"}</small></td>
                <td><span>{item.entityType || "—"}</span></td>
                <td><b>{item.state || "—"}</b><small>{item.postcode || ""}</small></td>
                <td className="record-bank-cell"><div><b>{item.bankDetails?.accountName || item.bankDetails?.bankName || "—"}</b>{item.bankDetails && <small>BSB {formatBsb(item.bankDetails.bsb)} · Account {item.bankDetails.accountNumber}</small>}</div><button type="button" className="bank-edit-button" onClick={() => openBankEditor(item)}>{item.bankDetails ? "Edit" : "Add"}</button></td>
                <td><span>{dateTime(item.lastChecked)}</span><small>{item.source === "official" ? "Official service" : item.source === "demo" ? "Demo snapshot" : "Pending"}</small></td>
                <td><div className="row-actions"><button className={`${isExpanded ? "history-toggle open" : "history-toggle"}${isHistoryLoading ? " loading" : ""}`} aria-expanded={isExpanded} aria-busy={isHistoryLoading} aria-controls={`history-${item.abn}`} aria-label={isExpanded ? `Collapse details for ${item.entityName}` : `Expand details for ${item.entityName}`} title={isExpanded ? "Collapse details" : "Expand details"} onClick={() => void toggleAbnHistory(item.abn)}><i aria-hidden="true" /></button><button className="row-action" disabled={item.abn === currentAccount.ownAbn} aria-label={`Remove ${item.entityName}`} title={item.abn === currentAccount.ownAbn ? "Your company cannot be removed" : "Remove ABN"} onClick={() => { if (window.confirm(`Remove ${item.entityName} (${formatAbn(item.abn)}) from the ABN Register?`)) setRegister((previous) => previous.filter((record) => record.abn !== item.abn)); }}>×</button></div></td>
              </tr>
              {isExpanded && <tr className="history-row" id={`history-${item.abn}`}><td colSpan={8}>
                <div className="history-panel">
                  <div className="history-panel-head"><div><h3>ABN details & history</h3><p>Official ABN Lookup history, plus changes recorded by this workspace.</p></div><span>{activity.length} workspace event{activity.length === 1 ? "" : "s"}</span></div>
                  <div className="history-layout">
                    <section className="official-history-card">
                      {isHistoryLoading && <div className="official-history-loading">Loading full historical details from ABN Lookup…</div>}
                      <OfficialHistorySection title="Entity name" rows={nameHistory} empty="No entity name history available" />
                      <OfficialHistorySection title="ABN status" rows={statusHistory} empty="No ABN status history available" />
                      <div className="abr-entity-type"><span>Entity type</span><b>{item.officialHistory?.entityType || item.entityType || "Unavailable"}</b></div>
                      <OfficialHistorySection title="Goods & Services Tax (GST)" rows={gstHistory} empty="No current or historical GST registrations" />
                      <OfficialHistorySection title="Main business location" rows={locationHistory} empty="No location history available" />
                      {item.bankDetails && <section className="record-bank-details"><div><h4>Saved bank details</h4><button type="button" onClick={() => openBankEditor(item)}>Edit</button></div><BankDetailsFields details={item.bankDetails} /></section>}
                      <div className="abr-history-meta"><span>ABN last updated: {item.officialHistory?.recordLastUpdated || "Unavailable"}</span><span>Record retrieved: {item.officialHistory?.retrievedAt ? dateTime(item.officialHistory.retrievedAt) : dateTime(item.lastChecked)}</span></div>
                    </section>
                    <section className="history-activity"><h4>Updates recorded by this workspace</h4>{!activity.length ? <div className="history-empty">No monitoring activity has been recorded yet.</div> : <div className="activity-list">{activity.slice(0, 10).map((entry) => <div className={`activity-item ${entry.kind}`} key={`${entry.kind}-${entry.id}`}><span /><div><div><b>{entry.title}</b><time>{dateTime(entry.at)}</time></div><p>{entry.detail}</p></div></div>)}</div>}</section>
                  </div>
                </div>
              </td></tr>}
            </Fragment>;
          })}</tbody></table></div>
        </div>}

        {tab === "changes" && <div className="page-content changes-layout"><section className="change-summary panel"><p className="eyebrow">Monitoring status</p><h2>Stay on top of critical changes</h2><p>Changes to ABN status, GST registration, entity name or main location are recorded only when a weekly check is due or you run a check now.</p><div className="schedule-card"><span>↻</span><div><b>{schedule === "weekly" ? "Weekly automatic check" : "Manual checks"}</b><small>{schedule === "weekly" ? "Runs when the workspace is open and the weekly check is due" : "Runs only when you click the button below"}</small></div></div><button className="primary-button" onClick={() => void refreshAll("manual")} disabled={busy}>{busy ? "Updating…" : "Check all ABNs now"}<span>→</span></button></section><section className="timeline panel"><div className="panel-heading"><div><span className="step">3</span><h2>Change timeline</h2></div><small>{changes.length} items</small></div>{!changes.length ? <div className="empty-state compact"><span>◌</span><h3>No changes found yet</h3><p>Changes found by weekly or manual checks will appear here.</p></div> : changes.map((item) => <div className="timeline-item" key={item.id}><span className={`severity ${item.severity}`} /><div><div><b>{item.entityName}</b><small>{formatAbn(item.abn)}</small></div><p>{item.description}</p><time>{dateTime(item.changedAt)}</time></div></div>)}</section></div>}

        {tab === "settings" && <div className="page-content settings-grid"><article className="panel settings-card"><div className="setting-icon">CO</div><h2>Company workspace</h2><p>This local workspace belongs to {currentAccount.companyName}. Supplier records and contract checks are separated from other accounts on this device.</p><div className="company-setting"><b>{currentAccount.companyName}</b><span>{formatAbn(currentAccount.ownAbn)}</span><small>{currentAccount.email}</small></div></article><article className="panel settings-card"><div className="setting-icon">API</div><h2>ABN Lookup connection</h2><p>The Authentication GUID is read from the server environment and is never sent to the browser.</p><div className={apiConfigured ? "connection-status connected" : "connection-status"}><span>{apiConfigured ? "✓" : "!"}</span><div><b>{apiConfigured ? "Official service connected" : "Environment variable not detected"}</b><small>{apiConfigured ? "ABN_LOOKUP_GUID is configured on the server" : "Add ABN_LOOKUP_GUID to .env.local and restart the local server"}</small></div></div></article><article className="panel settings-card"><div className="setting-icon">↻</div><h2>Register update frequency</h2><p>Choose a weekly check while the workspace is open, or run monitoring only when requested.</p><div className="radio-group">{([{ id: "weekly", label: "Weekly", note: "Every 7 days" }, { id: "manual", label: "Manual", note: "Only when clicked" }] as const).map((item) => <button key={item.id} className={schedule === item.id ? "radio-option selected" : "radio-option"} onClick={() => setSchedule(item.id)}><span>{schedule === item.id ? "●" : "○"}</span><div><b>{item.label}</b><small>{item.note}</small></div></button>)}</div></article><div className="settings-footer"><button className="primary-button" onClick={saveSettings}>Save settings<span>✓</span></button><small>Last bulk update: {dateTime(lastRefresh)}</small></div></div>}
      </section>
      {editingBankRecord && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeBankEditor(); }}>
        <section className="bank-editor" role="dialog" aria-modal="true" aria-labelledby="bank-editor-title">
          <div className="bank-editor-head"><div><span>BANK</span><div><h2 id="bank-editor-title">{editingBankRecord.bankDetails ? "Edit bank details" : "Add bank details"}</h2><p>{editingBankRecord.entityName} · {formatAbn(editingBankRecord.abn)}</p></div></div><button type="button" aria-label="Close bank details editor" onClick={closeBankEditor}>×</button></div>
          <form onSubmit={saveBankDetails}>
            <div className="bank-editor-grid">
              <label>Account name<input autoFocus value={bankDraft.accountName} onChange={(event) => setBankDraft((draft) => ({ ...draft, accountName: event.target.value }))} placeholder="Account holder name" /></label>
              <label>Bank name<input value={bankDraft.bankName} onChange={(event) => setBankDraft((draft) => ({ ...draft, bankName: event.target.value }))} placeholder="Optional" /></label>
              <label>BSB<input inputMode="numeric" value={bankDraft.bsb} onChange={(event) => setBankDraft((draft) => ({ ...draft, bsb: event.target.value }))} placeholder="123-456" /></label>
              <label>Account number<input inputMode="numeric" value={bankDraft.accountNumber} onChange={(event) => setBankDraft((draft) => ({ ...draft, accountNumber: event.target.value }))} placeholder="Account number" /></label>
            </div>
            {bankEditError && <p className="bank-editor-error">{bankEditError}</p>}
            <div className="bank-editor-actions">{editingBankRecord.bankDetails && <button type="button" className="bank-remove-button" onClick={removeBankDetails}>Remove details</button>}<button type="button" className="secondary-button" onClick={closeBankEditor}>Cancel</button><button type="submit" className="primary-small">Save changes</button></div>
          </form>
        </section>
      </div>}
    </main>
  );
}
