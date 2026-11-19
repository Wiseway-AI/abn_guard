"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

// Legacy (non-Clerk) sign-in: Google, verified email and managed beta accounts. The landing page is
// server-rendered; this island only hydrates the dialog and the pricing buttons that open it.

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

const WORKSPACE_PATH = "/app/check";
const OPEN_AUTH_EVENT = "abn-guard:open-auth";
const STORAGE = {
  accounts: "abn-guard-accounts-v1",
  session: "abn-guard-session-v1",
};

type BillingPlan = "free" | "starter";
type StoredAccount = {
  id: string;
  companyName?: string;
  email?: string;
  passwordHash?: string;
  createdAt?: string;
  setupComplete?: boolean;
  ownAbn?: string;
  authProvider?: string;
  unlimitedAbns?: boolean;
};

function storedAccounts(): StoredAccount[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE.accounts) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed as StoredAccount[] : [];
  } catch {
    return [];
  }
}

/** Pricing-card button: remembers a paid plan choice and opens the sign-up dialog. */
export function LandingPlanButton({ plan, children }: { plan: BillingPlan; children: React.ReactNode }) {
  return <button type="button" onClick={() => {
    if (plan !== "free") localStorage.setItem("abn-guard-pending-plan", plan);
    window.dispatchEvent(new CustomEvent(OPEN_AUTH_EVENT, { detail: { mode: "register" } }));
  }}>{children}</button>;
}

export function LegacyAuthDialog() {
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
  const [googleConfigured, setGoogleConfigured] = useState(false);
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleSigningIn, setGoogleSigningIn] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);

  // Browser-only (managed/local) accounts have no server cookie for the proxy to see.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("signin") || params.has("auth_error")) return;
    const sessionId = localStorage.getItem(STORAGE.session);
    if (sessionId && storedAccounts().some((account) => account.id === sessionId)) window.location.replace(WORKSPACE_PATH);
  }, []);

  useEffect(() => {
    const open = (event: Event) => {
      const mode = (event as CustomEvent<{ mode?: "signin" | "register" }>).detail?.mode ?? "register";
      setAuthMode(mode);
      setAuthStage("credentials");
      setAuthError("");
      setAuthNotice("");
      setShowAuth(true);
    };
    window.addEventListener(OPEN_AUTH_EVENT, open);
    return () => window.removeEventListener(OPEN_AUTH_EVENT, open);
  }, []);

  // Google configuration is only needed once the dialog opens.
  useEffect(() => {
    if (!showAuth || googleClientId) return;
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ googleConfigured?: boolean; googleClientId?: string }>)
      .then((session) => {
        if (cancelled) return;
        setGoogleConfigured(Boolean(session.googleConfigured && session.googleClientId));
        setGoogleClientId(session.googleClientId ?? "");
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [googleClientId, showAuth]);

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
            window.location.assign(WORKSPACE_PATH);
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
        locale: "en",
        width: Math.min(400, Math.max(240, googleButtonRef.current.clientWidth)),
      });
    };

    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (window.google?.accounts?.id) renderGoogleButton();
    else if (existing) existing.addEventListener("load", renderGoogleButton, { once: true });
    else {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://accounts.google.com/gsi/client?hl=en";
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
    const shouldOpenSignin = params.get("signin") === "1";
    if (googleAuthError || shouldOpenSignin) {
      queueMicrotask(() => {
        setAuthMode("signin");
        if (googleAuthError) setAuthError(googleAuthError);
        setShowAuth(true);
      });
      params.delete("auth_error");
      params.delete("signin");
      const nextQuery = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
    }
  }, []);

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
        const result = await response.json() as { authenticated?: boolean; error?: string; account?: { id: string; username: string; companyName: string; setupComplete: boolean; unlimitedAbns: boolean } };
        if (!response.ok || !result.authenticated) {
          setAuthError(result.error || "Sign-in failed.");
          return;
        }
        if (!result.account) {
          setAuthError("This account is not available.");
          return;
        }
        const accounts = storedAccounts();
        const existingAccount = accounts.find((account) => account.id === result.account?.id);
        const managedAccount: StoredAccount = {
          ...existingAccount,
          id: result.account.id,
          companyName: existingAccount?.companyName || result.account.companyName,
          email: result.account.username,
          passwordHash: "server-managed",
          createdAt: existingAccount?.createdAt || new Date().toISOString(),
          setupComplete: existingAccount?.setupComplete ?? result.account.setupComplete,
          ownAbn: existingAccount?.ownAbn || "",
          authProvider: "managed",
          unlimitedAbns: result.account.unlimitedAbns,
        };
        const nextAccounts = [...accounts.filter((account) => account.id !== managedAccount.id), managedAccount];
        localStorage.setItem(STORAGE.accounts, JSON.stringify(nextAccounts));
        localStorage.setItem(STORAGE.session, managedAccount.id);
        window.location.assign(WORKSPACE_PATH);
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
      window.location.assign(WORKSPACE_PATH);
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
      window.location.assign(WORKSPACE_PATH);
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

  if (!showAuth) return null;
  return (
      <div className="auth-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAuth(false); }}>
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
              {authMode === "register" && <div className="auth-plan-summary"><span>Free</span><b>Up to 10 ABN / bank-detail records</b><small>No credit card required</small></div>}
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
      </div>
  );
}
