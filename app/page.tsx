"use client";

import { ChangeEvent, DragEvent, FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";

type Tab = "verify" | "register" | "changes" | "settings";
type Source = "official" | "demo" | "pending";
type RegisterFilter = "all" | "attention" | "active" | "cancelled" | "gst-registered" | "gst-not-registered";

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
};

type ContractDocument = {
  id: string;
  name: string;
  url: string;
  text: string;
  abns: string[];
};

type DetectedEntity = {
  abn: string;
  contractName: string;
  fileIds: string[];
  fileNames: string[];
  context: string;
};

type ContractCheck = {
  id: string;
  fileName: string;
  fileIds: string[];
  checkedAt: string;
  abn: string;
  contractName: string;
  contractLocation?: string;
  contractGst: boolean | null;
  contractStatus: "Active" | "Cancelled" | null;
  official: AbnRecord;
  issues: string[];
};

type ChangeLog = {
  id: string;
  abn: string;
  entityName: string;
  changedAt: string;
  description: string;
  severity: "high" | "medium" | "low";
};

type AbnHistoryEntry = {
  id: string;
  abn: string;
  recordedAt: string;
  event: "Company ABN saved" | "Added to register" | "Imported from file" | "Register update";
  entityName: string;
  status: AbnRecord["status"];
  gstRegistered: boolean | null;
  state: string;
  postcode: string;
  source: Source;
};

const STORAGE = {
  accounts: "abn-guard-accounts-v1",
  session: "abn-guard-session-v1",
};

function accountStorage(accountId: string, key: string) {
  return `abn-guard-account-${accountId}-${key}-v1`;
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

function compareRecord(previous: AbnRecord, current: AbnRecord): ChangeLog[] {
  const changes: ChangeLog[] = [];
  const add = (description: string, severity: ChangeLog["severity"]) =>
    changes.push({
      id: crypto.randomUUID(),
      abn: current.abn,
      entityName: current.entityName,
      changedAt: new Date().toISOString(),
      description,
      severity,
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

async function hashPassword(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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
      const positioned = content.items.flatMap((item) => {
        if (!("str" in item) || !item.str.trim()) return [];
        return [{ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }];
      }).sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);
      const rows: { y: number; items: { text: string; x: number }[] }[] = [];
      positioned.forEach((item) => {
        const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 2);
        if (row) row.items.push({ text: item.text, x: item.x });
        else rows.push({ y: item.y, items: [{ text: item.text, x: item.x }] });
      });
      pages.push(rows.sort((a, b) => b.y - a.y).map((row) => row.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ")).join("\n"));
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

export default function Home() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [currentAccount, setCurrentAccount] = useState<Account | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "register">("register");
  const [authCompany, setAuthCompany] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [setupAbn, setSetupAbn] = useState("");
  const [setupRecord, setSetupRecord] = useState<AbnRecord | null>(null);
  const [setupError, setSetupError] = useState("");

  const [tab, setTab] = useState<Tab>("verify");
  const [documents, setDocuments] = useState<ContractDocument[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [checks, setChecks] = useState<ContractCheck[]>([]);
  const [register, setRegister] = useState<AbnRecord[]>([]);
  const [changes, setChanges] = useState<ChangeLog[]>([]);
  const [history, setHistory] = useState<AbnHistoryEntry[]>([]);
  const [expandedAbns, setExpandedAbns] = useState<string[]>([]);
  const [loadingHistoryAbns, setLoadingHistoryAbns] = useState<string[]>([]);
  const [apiConfigured, setApiConfigured] = useState(false);
  const [schedule, setSchedule] = useState("daily");
  const [lastRefresh, setLastRefresh] = useState("");
  const [query, setQuery] = useState("");
  const [registerFilter, setRegisterFilter] = useState<RegisterFilter>("all");
  const [newAbn, setNewAbn] = useState("");
  const [activeCheckIndex, setActiveCheckIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const storedAccounts = JSON.parse(localStorage.getItem(STORAGE.accounts) ?? "[]") as Account[];
    const sessionId = localStorage.getItem(STORAGE.session);
    const active = storedAccounts.find((account) => account.id === sessionId) ?? null;
    setAccounts(storedAccounts);
    setCurrentAccount(active);
    if (active) loadAccountData(active.id);
    fetch("/api/abn").then((response) => response.json()).then((result) => setApiConfigured(Boolean(result.configured))).catch(() => setApiConfigured(false));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !currentAccount) return;
    localStorage.setItem(accountStorage(currentAccount.id, "register"), JSON.stringify(register));
  }, [register, currentAccount, hydrated]);
  useEffect(() => {
    if (!hydrated || !currentAccount) return;
    localStorage.setItem(accountStorage(currentAccount.id, "changes"), JSON.stringify(changes));
  }, [changes, currentAccount, hydrated]);
  useEffect(() => {
    if (!hydrated || !currentAccount) return;
    localStorage.setItem(accountStorage(currentAccount.id, "history"), JSON.stringify(history));
  }, [history, currentAccount, hydrated]);

  useEffect(() => {
    if (!hydrated || !currentAccount?.setupComplete || schedule === "manual" || !register.length) return;
    const interval = schedule === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const runIfDue = () => {
      const last = lastRefresh ? new Date(lastRefresh).getTime() : 0;
      if (!busy && Date.now() - last >= interval) void refreshAll(false);
    };
    const firstRun = window.setTimeout(runIfDue, 1800);
    const timer = window.setInterval(runIfDue, 60 * 60 * 1000);
    return () => {
      window.clearTimeout(firstRun);
      window.clearInterval(timer);
    };
  }, [schedule, lastRefresh, register, apiConfigured, busy, hydrated, currentAccount]);

  function loadAccountData(accountId: string) {
    setRegister(JSON.parse(localStorage.getItem(accountStorage(accountId, "register")) ?? "[]"));
    localStorage.removeItem(accountStorage(accountId, "checks"));
    setChecks([]);
    setChanges(JSON.parse(localStorage.getItem(accountStorage(accountId, "changes")) ?? "[]"));
    setHistory(JSON.parse(localStorage.getItem(accountStorage(accountId, "history")) ?? "[]"));
    setExpandedAbns([]);
    setLoadingHistoryAbns([]);
    setSchedule(localStorage.getItem(accountStorage(accountId, "schedule")) ?? "daily");
    setLastRefresh(localStorage.getItem(accountStorage(accountId, "lastRefresh")) ?? "");
    setDocuments([]);
  }

  const detectedEntities = useMemo(() => {
    const map = new Map<string, DetectedEntity>();
    documents.forEach((document) => {
      document.abns.forEach((abn) => {
        const context = contextForAbn(document.text, abn);
        const name = claimsFromContext(context).contractName;
        const existing = map.get(abn);
        map.set(abn, {
          abn,
          contractName: existing?.contractName || name,
          fileIds: [...new Set([...(existing?.fileIds ?? []), document.id])],
          fileNames: [...new Set([...(existing?.fileNames ?? []), document.name])],
          context: existing?.context || context,
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

  const latestChecks = useMemo(() => checks.slice(0, 12), [checks]);
  const issueCount = checks.filter((check) => check.issues.length > 0).length;

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
    }));
    setHistory((previous) => [...entries, ...previous].slice(0, 500));
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
      const current = await lookupAbn(abn);
      const logs = compareRecord(previous, current);
      setRegister((records) => records.map((record) => record.abn === abn ? current : record));
      if (logs.length) setChanges((items) => [...logs, ...items].slice(0, 200));
      addHistoryEntries([current], "Register update");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load official ABN history");
    } finally {
      setLoadingHistoryAbns((items) => items.filter((item) => item !== abn));
    }
  }

  function persistAccounts(next: Account[]) {
    setAccounts(next);
    localStorage.setItem(STORAGE.accounts, JSON.stringify(next));
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    setAuthError("");
    const email = authEmail.trim().toLowerCase();
    if (!email.includes("@") || authPassword.length < 6) {
      setAuthError("Enter a valid work email and a password of at least 6 characters.");
      return;
    }
    const passwordHash = await hashPassword(authPassword);
    if (authMode === "register") {
      if (!authCompany.trim()) {
        setAuthError("Enter your company name.");
        return;
      }
      if (accounts.some((account) => account.email === email)) {
        setAuthError("An account already exists for this email.");
        return;
      }
      const account: Account = {
        id: crypto.randomUUID(),
        companyName: authCompany.trim(),
        email,
        passwordHash,
        createdAt: new Date().toISOString(),
        setupComplete: false,
        ownAbn: "",
      };
      persistAccounts([...accounts, account]);
      localStorage.setItem(STORAGE.session, account.id);
      setCurrentAccount(account);
      setRegister([]);
      setChecks([]);
      setChanges([]);
      setHistory([]);
      return;
    }
    const account = accounts.find((item) => item.email === email && item.passwordHash === passwordHash);
    if (!account) {
      setAuthError("Email or password is incorrect.");
      return;
    }
    localStorage.setItem(STORAGE.session, account.id);
    setCurrentAccount(account);
    loadAccountData(account.id);
  }

  function signOut() {
    localStorage.removeItem(STORAGE.session);
    setCurrentAccount(null);
    setRegister([]);
    setChecks([]);
    setChanges([]);
    setHistory([]);
    setExpandedAbns([]);
    setLoadingHistoryAbns([]);
    setDocuments([]);
    setAuthPassword("");
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
        parsed.push({ id: crypto.randomUUID(), name: file.name, url: URL.createObjectURL(file), text, abns: extractAbns(text) });
      } catch {
        failed += 1;
      }
    }
    setDocuments((previous) => [...previous, ...parsed]);
    setIsParsing(false);
    const found = parsed.reduce((sum, item) => sum + item.abns.length, 0);
    setNotice(`Added ${parsed.length} contract${parsed.length === 1 ? "" : "s"} and detected ${found} valid ABN${found === 1 ? "" : "s"}${failed ? `. ${failed} file${failed === 1 ? "" : "s"} could not be read.` : "."}`);
  }

  async function verifyContracts() {
    if (!detectedEntities.length) {
      setNotice("No valid 11-digit ABN was found in the uploaded contracts.");
      return;
    }
    setBusy(true);
    setNotice(`Verifying ${detectedEntities.length} ABN${detectedEntities.length === 1 ? "" : "s"}…`);
    const nextChecks: ContractCheck[] = [];
    const nextRecords: AbnRecord[] = [];
    for (const detected of detectedEntities) {
      try {
        const official = await lookupAbn(detected.abn);
        const extractedClaims = claimsFromContext(detected.context);
        const claims = { ...extractedClaims, contractName: detected.contractName };
        const issues: string[] = [];
        const officialLocation = [official.state, official.postcode].filter(Boolean).join(" ");
        if (!claims.contractName) issues.push("Company name was not found in the file");
        else if (official.entityName && compareCompanyNames(claims.contractName, official.entityName) === "mismatch")
          issues.push(`File name “${claims.contractName}” does not match the registered entity name`);
        if (claims.contractLocation && (!officialLocation || normalizeLocation(claims.contractLocation) !== normalizeLocation(officialLocation)))
          issues.push(`File location ${claims.contractLocation} does not match the ABN Lookup location ${officialLocation || "unavailable"}`);
        if (official.source === "pending") issues.push("Official API is not connected. Add a GUID and verify again.");
        nextChecks.push({
          id: crypto.randomUUID(),
          fileName: detected.fileNames.join(", "),
          fileIds: detected.fileIds,
          checkedAt: new Date().toISOString(),
          abn: detected.abn,
          official,
          issues,
          ...claims,
        });
        nextRecords.push(official);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Lookup failed");
      }
    }
    setChecks((previous) => [...nextChecks, ...previous].slice(0, 100));
    setActiveCheckIndex(0);
    setRegister((previous) => {
      const map = new Map(previous.map((item) => [item.abn, item]));
      nextRecords.forEach((item) => map.set(item.abn, item));
      return [...map.values()];
    });
    setBusy(false);
    setNotice(`Verification complete: ${nextChecks.length} ABN${nextChecks.length === 1 ? "" : "s"}, ${nextChecks.filter((item) => item.issues.length).length} requiring attention`);
  }

  function clearVerificationResults() {
    setChecks([]);
    setActiveCheckIndex(0);
    if (currentAccount) localStorage.removeItem(accountStorage(currentAccount.id, "checks"));
    setNotice("Verification results cleared.");
  }

  async function refreshAll(simulate = false) {
    if (!register.length || !currentAccount) return;
    setBusy(true);
    setNotice(`Updating ${register.length} record${register.length === 1 ? "" : "s"}…`);
    const refreshed: AbnRecord[] = [];
    const checkedRecords: AbnRecord[] = [];
    const logs: ChangeLog[] = [];
    for (let index = 0; index < register.length; index += 1) {
      const previous = register[index];
      try {
        let current = await lookupAbn(previous.abn);
        if (simulate && index === 0) current = { ...current, gstRegistered: !current.gstRegistered, lastChecked: new Date().toISOString() };
        logs.push(...compareRecord(previous, current));
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
    localStorage.setItem(accountStorage(currentAccount.id, "lastRefresh"), refreshedAt);
    setBusy(false);
    setNotice(logs.length ? `Update complete. ${logs.length} change${logs.length === 1 ? "" : "s"} found.` : "Update complete. No changes found.");
  }

  async function addAbn() {
    const abn = onlyDigits(newAbn);
    if (!isValidAbn(abn)) {
      setNotice("Enter a valid 11-digit ABN.");
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
        } satisfies AbnRecord;
      }).filter((item): item is AbnRecord => Boolean(item));
      setRegister((previous) => {
        const map = new Map(previous.map((item) => [item.abn, item]));
        imported.forEach((item) => map.set(item.abn, item));
        return [...map.values()];
      });
      addHistoryEntries(imported, "Imported from file");
      setNotice(`Imported ${imported.length} valid ABN${imported.length === 1 ? "" : "s"} from ${file.name}`);
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
      "Last checked": item.lastChecked,
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "ABN Register");
    XLSX.writeFile(workbook, `ABN-register-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  function saveSettings() {
    if (!currentAccount) return;
    localStorage.setItem(accountStorage(currentAccount.id, "schedule"), schedule);
    setNotice("Update settings saved.");
  }

  if (!hydrated) return <div className="app-loading">Loading ABN Guard…</div>;

  if (!currentAccount) {
    return (
      <main className="auth-shell">
        <section className="auth-story">
          <div className="auth-brand"><span className="brand-mark">A</span><strong>ABN Guard</strong></div>
          <div className="auth-copy"><p className="eyebrow">Supplier due diligence</p><h1>Know who you are contracting with.</h1><p>Verify ABNs and GST status from contracts, maintain a supplier register, and monitor changes over time.</p></div>
          <div className="auth-points"><span>01</span><p><b>Contract intelligence</b><small>Extract ABNs from multiple PDF, DOCX and TXT files.</small></p><span>02</span><p><b>Ongoing monitoring</b><small>Keep each company workspace separate and up to date.</small></p></div>
          <small className="prototype-note">Local prototype · account data stays on this device</small>
        </section>
        <section className="auth-form-wrap">
          <form className="auth-form" onSubmit={(event) => void submitAuth(event)}>
            <p className="eyebrow">{authMode === "register" ? "Create workspace" : "Welcome back"}</p>
            <h2>{authMode === "register" ? "Register your company" : "Sign in to ABN Guard"}</h2>
            <p>{authMode === "register" ? "Set up a private company workspace on this device." : "Access your company’s saved ABNs and contract checks."}</p>
            {authMode === "register" && <label>Company name<input value={authCompany} onChange={(event) => setAuthCompany(event.target.value)} placeholder="Example Pty Ltd" autoComplete="organization" /></label>}
            <label>Work email<input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" /></label>
            <label>Password<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} placeholder="At least 6 characters" autoComplete={authMode === "register" ? "new-password" : "current-password"} /></label>
            {authError && <div className="auth-error">{authError}</div>}
            <button className="primary-button" type="submit">{authMode === "register" ? "Create company account" : "Sign in"}<span>→</span></button>
            <div className="auth-switch">{authMode === "register" ? "Already registered?" : "New to ABN Guard?"}<button type="button" onClick={() => { setAuthMode(authMode === "register" ? "signin" : "register"); setAuthError(""); }}>{authMode === "register" ? "Sign in" : "Create an account"}</button></div>
          </form>
        </section>
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
    { id: "verify" as const, icon: "01", label: "Contract check", hint: "Extract & compare" },
    { id: "register" as const, icon: "02", label: "ABN register", hint: `${register.length} records` },
    { id: "changes" as const, icon: "03", label: "Change alerts", hint: `${changes.length} changes` },
  ];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">A</span><div><strong>ABN Guard</strong><small>Supplier verification</small></div></div>
        <nav><p className="nav-title">Workspace</p>{nav.map((item) => <button key={item.id} className={tab === item.id ? "nav-item active" : "nav-item"} onClick={() => setTab(item.id)}><span>{item.icon}</span><div><b>{item.label}</b><small>{item.hint}</small></div></button>)}</nav>
        <div className="sidebar-bottom">
          <button className={tab === "settings" ? "nav-item active" : "nav-item"} onClick={() => setTab("settings")}><span>⚙</span><div><b>Connection</b><small>{apiConfigured ? "Official API" : "Demo mode"}</small></div></button>
          <div className="account-card"><span>{currentAccount.companyName.slice(0, 2).toUpperCase()}</span><div><b>{currentAccount.companyName}</b><small>{currentAccount.email}</small></div><button onClick={signOut} aria-label="Sign out">↗</button></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><p className="eyebrow">{tab === "verify" ? "Contract due diligence" : tab === "register" ? "Supplier master data" : tab === "changes" ? "Ongoing monitoring" : "Data connection"}</p><h1>{tab === "verify" ? "Verify ABNs in contracts" : tab === "register" ? "ABN register" : tab === "changes" ? "Changes & risk alerts" : "Connection & update settings"}</h1></div><div className="top-actions"><span className={apiConfigured ? "mode-pill live" : "mode-pill"}><i />{apiConfigured ? "Official data" : "Demo data"}</span><button className="ghost-button" onClick={() => setTab("settings")}>Settings</button></div></header>
        {notice && <div className="notice"><span>i</span>{notice}<button onClick={() => setNotice("")}>×</button></div>}

        {tab === "verify" && <div className="page-content verify-page">
          <div className="stats-row"><article><span>Saved ABNs</span><strong>{register.length}</strong><small>{currentAccount.companyName}</small></article><article><span>Contract checks</span><strong>{checks.length}</strong><small>Recent results</small></article><article className="warn-stat"><span>Needs attention</span><strong>{issueCount}</strong><small>Discrepancies or risks</small></article><article><span>Last update</span><strong className="date-stat">{lastRefresh ? dateTime(lastRefresh) : "Not run"}</strong><small>{schedule === "daily" ? "Daily check" : schedule === "weekly" ? "Weekly check" : "Manual check"}</small></article></div>
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
              <div className="panel-heading"><div><span className="step">2</span><h2>Verification results</h2></div>{latestChecks.length ? <div className="result-navigation" aria-label="Verification result navigation"><span>{activeCheckIndex + 1} / {latestChecks.length}</span><button type="button" aria-label="Previous verification result" title="Previous result" disabled={activeCheckIndex === 0} onClick={() => setActiveCheckIndex((current) => Math.max(0, current - 1))}>←</button><button type="button" aria-label="Next verification result" title="Next result" disabled={activeCheckIndex === latestChecks.length - 1} onClick={() => setActiveCheckIndex((current) => Math.min(latestChecks.length - 1, current + 1))}>→</button><button type="button" className="result-clear" aria-label="Clear all verification results" title="Clear all results" onClick={clearVerificationResults}>Clear</button></div> : <small>File vs ABN Lookup</small>}</div>
              {!latestChecks.length ? <div className="empty-state"><span>✓</span><h3>Ready to verify</h3><p>Upload one or more contracts to compare the entity name, ABN and location.</p></div> : <div className="check-list">{latestChecks.slice(activeCheckIndex, activeCheckIndex + 1).map((check) => {
                const safeContractName = check.contractName && check.contractName.length <= 120 ? check.contractName : "Not found in file";
                const sourceLabel = check.official.source === "official" ? "Official ABN Lookup service" : check.official.source === "demo" ? "Built-in demo snapshot" : "Pending official lookup";
                const officialLocation = [check.official.state, check.official.postcode].filter(Boolean).join(" ");
                const sourceDocuments = documents.filter((document) => check.fileIds?.includes(document.id));
                const nameComparison = safeContractName === "Not found in file" || !check.official.entityName ? null : compareCompanyNames(safeContractName, check.official.entityName);
                const abnMatch = onlyDigits(check.abn) === onlyDigits(check.official.abn);
                const locationMatch = !check.contractLocation ? null : Boolean(officialLocation) && normalizeLocation(check.contractLocation) === normalizeLocation(officialLocation);
                return <div className={check.issues.length ? "check-card alert" : "check-card"} key={check.id}>
                  <div className="check-card-top"><div><small>{formatAbn(check.abn)}</small><h3>{check.official.entityName || "Entity pending lookup"}</h3></div><span className={check.issues.length ? "result-pill issue" : "result-pill ok"}>{check.issues.length ? `${check.issues.length} issue${check.issues.length === 1 ? "" : "s"}` : "Verified"}</span></div>
                  <div className="verification-compare">
                    <section className="evidence-panel file-evidence">
                      <div className="evidence-title"><span>FILE</span><div><b>Details from file</b><small className="file-source-links">{sourceDocuments.length ? sourceDocuments.map((document, index) => <Fragment key={document.id}>{index > 0 && <span>, </span>}<a href={document.url} target="_blank" rel="noreferrer" title={`Open ${document.name}`}>{document.name}</a></Fragment>) : check.fileName}</small></div></div>
                      <dl>
                        <div><dt>Entity name</dt><dd>{safeContractName}</dd></div>
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
                  <div className="registration-facts">
                    <div className={check.official.gstRegistered === null ? "registration-fact" : check.official.gstRegistered ? "registration-fact gst-active" : "registration-fact gst-inactive"}><span>GST</span><div><small>GST registration</small><b>{check.official.gstRegistered === null ? "Pending lookup" : check.official.gstRegistered ? "Registered" : "Not registered"}</b><p>{check.official.gstFrom ? `Effective from ${check.official.gstFrom}` : "No current registration date"}</p></div></div>
                    <div className="registration-fact abn-date"><span>ABN</span><div><small>{check.official.status === "Active" ? "ABN registration date" : "ABN status effective date"}</small><b>{check.official.statusFrom || "Unavailable"}</b><p>{check.official.status === "Active" ? "Active ABN" : `Current status: ${check.official.status}`}</p></div></div>
                  </div>
                  <div className="source-line"><span>Checked against {sourceLabel}</span><time>{dateTime(check.checkedAt)}</time></div>
                </div>;
              })}</div>}
            </article>
          </div>
        </div>}

        {tab === "register" && <div className="page-content">
          <div className="table-toolbar"><div className="table-filters"><div className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ABN, entity name or state" /></div><select className="filter-select" aria-label="Filter ABN Register" value={registerFilter} onChange={(event) => setRegisterFilter(event.target.value as RegisterFilter)}><option value="all">All records</option><option value="attention">Needs attention</option><option value="active">Active ABNs</option><option value="cancelled">Cancelled ABNs</option><option value="gst-registered">GST registered</option><option value="gst-not-registered">GST not registered</option></select></div><div className="toolbar-actions"><input value={newAbn} onChange={(event) => setNewAbn(event.target.value)} placeholder="Enter ABN" onKeyDown={(event) => event.key === "Enter" && void addAbn()} /><button className="secondary-button" onClick={() => void addAbn()} disabled={busy}>+ Add</button><button className="secondary-button" onClick={() => importRef.current?.click()}>Import Excel</button><input ref={importRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(event) => void importList(event)} /><button className="secondary-button" onClick={() => void exportList()}>Export Excel</button><button className="primary-small" onClick={() => void refreshAll(false)} disabled={busy}>↻ {busy ? "Updating" : "Update now"}</button></div></div>
          <div className="table-meta"><span>Showing {filteredRegister.length} of {register.length} records · {register.filter((item) => item.status === "Active").length} Active</span><span>Last bulk update: {dateTime(lastRefresh)}</span></div>
          <div className="table-wrap"><table><thead><tr><th>ABN / Entity name</th><th>ABN status</th><th>GST</th><th>Entity type</th><th>Main location</th><th>Last checked</th><th aria-label="Actions" /></tr></thead><tbody>{filteredRegister.map((item) => {
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
              ...visibleHistory.map((entry) => ({ id: entry.id, at: entry.recordedAt, title: entry.event, detail: `${entry.entityName || "Entity name unavailable"} · ${entry.status} · GST ${entry.gstRegistered === null ? "pending" : entry.gstRegistered ? "registered" : "not registered"}${entry.state ? ` · ${entry.state} ${entry.postcode}` : ""}`, kind: "snapshot" as const })),
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
                <td><span>{dateTime(item.lastChecked)}</span><small>{item.source === "official" ? "Official service" : item.source === "demo" ? "Demo snapshot" : "Pending"}</small></td>
                <td><div className="row-actions"><button className={`${isExpanded ? "history-toggle open" : "history-toggle"}${isHistoryLoading ? " loading" : ""}`} aria-expanded={isExpanded} aria-busy={isHistoryLoading} aria-controls={`history-${item.abn}`} aria-label={isExpanded ? `Collapse details for ${item.entityName}` : `Expand details for ${item.entityName}`} title={isExpanded ? "Collapse details" : "Expand details"} onClick={() => void toggleAbnHistory(item.abn)}><i aria-hidden="true" /></button><button className="row-action" disabled={item.abn === currentAccount.ownAbn} aria-label={`Remove ${item.entityName}`} title={item.abn === currentAccount.ownAbn ? "Your company cannot be removed" : "Remove ABN"} onClick={() => { if (window.confirm(`Remove ${item.entityName} (${formatAbn(item.abn)}) from the ABN Register?`)) setRegister((previous) => previous.filter((record) => record.abn !== item.abn)); }}>×</button></div></td>
              </tr>
              {isExpanded && <tr className="history-row" id={`history-${item.abn}`}><td colSpan={7}>
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
                      <div className="abr-history-meta"><span>ABN last updated: {item.officialHistory?.recordLastUpdated || "Unavailable"}</span><span>Record retrieved: {item.officialHistory?.retrievedAt ? dateTime(item.officialHistory.retrievedAt) : dateTime(item.lastChecked)}</span></div>
                    </section>
                    <section className="history-activity"><h4>Updates recorded by this workspace</h4>{!activity.length ? <div className="history-empty">No monitoring activity has been recorded yet.</div> : <div className="activity-list">{activity.slice(0, 10).map((entry) => <div className={`activity-item ${entry.kind}`} key={`${entry.kind}-${entry.id}`}><span /><div><div><b>{entry.title}</b><time>{dateTime(entry.at)}</time></div><p>{entry.detail}</p></div></div>)}</div>}</section>
                  </div>
                </div>
              </td></tr>}
            </Fragment>;
          })}</tbody></table></div>
        </div>}

        {tab === "changes" && <div className="page-content changes-layout"><section className="change-summary panel"><p className="eyebrow">Monitoring status</p><h2>Stay on top of critical changes</h2><p>Changes to ABN status, GST registration, entity name or main location are recorded here.</p><div className="schedule-card"><span>↻</span><div><b>{schedule === "daily" ? "Daily automatic check" : schedule === "weekly" ? "Weekly automatic check" : "Manual checks"}</b><small>The local demo runs due tasks while the page is open</small></div></div><button className="primary-button" onClick={() => void refreshAll(false)} disabled={busy}>{busy ? "Updating…" : "Check all ABNs now"}<span>→</span></button>{!apiConfigured && <button className="demo-button" onClick={() => void refreshAll(true)} disabled={busy}>Simulate a GST change</button>}</section><section className="timeline panel"><div className="panel-heading"><div><span className="step">3</span><h2>Change timeline</h2></div><small>{changes.length} items</small></div>{!changes.length ? <div className="empty-state compact"><span>◌</span><h3>No changes found yet</h3><p>Run an update, or simulate a change in demo mode.</p></div> : changes.map((item) => <div className="timeline-item" key={item.id}><span className={`severity ${item.severity}`} /><div><div><b>{item.entityName}</b><small>{formatAbn(item.abn)}</small></div><p>{item.description}</p><time>{dateTime(item.changedAt)}</time></div></div>)}</section></div>}

        {tab === "settings" && <div className="page-content settings-grid"><article className="panel settings-card"><div className="setting-icon">CO</div><h2>Company workspace</h2><p>This local workspace belongs to {currentAccount.companyName}. Supplier records and contract checks are separated from other accounts on this device.</p><div className="company-setting"><b>{currentAccount.companyName}</b><span>{formatAbn(currentAccount.ownAbn)}</span><small>{currentAccount.email}</small></div></article><article className="panel settings-card"><div className="setting-icon">API</div><h2>ABN Lookup connection</h2><p>The Authentication GUID is read from the server environment and is never sent to the browser.</p><div className={apiConfigured ? "connection-status connected" : "connection-status"}><span>{apiConfigured ? "✓" : "!"}</span><div><b>{apiConfigured ? "Official service connected" : "Environment variable not detected"}</b><small>{apiConfigured ? "ABN_LOOKUP_GUID is configured on the server" : "Add ABN_LOOKUP_GUID to .env.local and restart the local server"}</small></div></div></article><article className="panel settings-card"><div className="setting-icon">↻</div><h2>Register update frequency</h2><p>A local webpage cannot run while it is closed. When opened, the app checks whether an update is due.</p><div className="radio-group">{[{ id: "daily", label: "Daily", note: "Every 24 hours" }, { id: "weekly", label: "Weekly", note: "Every 7 days" }, { id: "manual", label: "Manual", note: "Only when clicked" }].map((item) => <button key={item.id} className={schedule === item.id ? "radio-option selected" : "radio-option"} onClick={() => setSchedule(item.id)}><span>{schedule === item.id ? "●" : "○"}</span><div><b>{item.label}</b><small>{item.note}</small></div></button>)}</div></article><div className="settings-footer"><button className="primary-button" onClick={saveSettings}>Save settings<span>✓</span></button><small>Last bulk update: {dateTime(lastRefresh)}</small></div></div>}
      </section>
    </main>
  );
}
