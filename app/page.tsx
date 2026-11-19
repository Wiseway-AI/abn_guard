import { SignInButton, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";
import { LandingPlanButton, LegacyAuthDialog } from "./landing-auth";

// Server-rendered marketing page: the HTML carries the full landing content, and the workspace
// bundle (app/workspace-app.tsx) is only loaded under /app. Signed-in visitors are redirected to
// the workspace by proxy.ts before this renders.
export default function LandingPage() {
  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Main navigation">
        <a className="landing-brand" href="#top" aria-label="ABN Guard home"><span>A</span><strong>ABN Guard</strong></a>
        <div className="landing-nav-links"><a href="#product">Product</a><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><a href="#security">Security</a></div>
        <div className="landing-nav-actions"><SignInButton mode="modal" forceRedirectUrl="/app/check"><button className="landing-signin" type="button">Sign in</button></SignInButton><SignUpButton mode="modal" forceRedirectUrl="/app/check"><button className="landing-nav-cta" type="button">Join now <span>↗</span></button></SignUpButton></div>
      </nav>

      <section className="landing-hero" id="top">
        <div className="landing-hero-copy">
          <div className="landing-kicker"><span>✓</span> Australian supplier verification</div>
          <h1>Know who you’re paying.<br /><em>Before money moves.</em></h1>
          <p>Turn contracts and invoices into trusted supplier records. Check ABNs, GST status and bank details in one clear workflow.</p>
          <div className="landing-hero-actions"><SignUpButton mode="modal" forceRedirectUrl="/app/check"><button type="button" className="landing-primary">Check suppliers free <span>→</span></button></SignUpButton><a href="#product" className="landing-secondary"><span>▶</span> See how it works</a></div>
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
          <article><p>Free</p><h3><span>A$</span>0<small>/month</small></h3><b>Up to 10 ABN / bank-detail records</b><ul><li>Google or email sign-in</li><li>Supplier verification</li><li>ABN register and alerts</li></ul><LandingPlanButton plan="free">Join now <span>→</span></LandingPlanButton></article>
          <article className="popular"><em>Most popular</em><p>Starter</p><h3><span>A$</span>9.90<small>/month + GST</small></h3><b>Up to 100 ABN / bank-detail records</b><ul><li>Everything in Free</li><li>Larger supplier register</li><li>Stripe subscription management</li></ul><LandingPlanButton plan="starter">Choose Starter <span>→</span></LandingPlanButton></article>
          <article className="enterprise"><p>Enterprise</p><h3>Custom</h3><b>For larger teams and tailored workflows</b><ul><li>Everything in Starter</li><li>Custom record limits and onboarding</li><li>Priority support and integrations</li></ul><Link className="enterprise-cta" href="/contact">Contact us <span>→</span></Link></article>
        </div>
        <small>Prices are in Australian dollars and exclude GST where applicable. Cancel or change Starter through the secure Stripe billing portal.</small>
      </section>

      <section className="landing-security" id="security"><div className="security-orbit"><div className="security-ring one"/><div className="security-ring two"/><div className="security-lock">✓</div><span className="security-chip chip-one">LOCAL<br />WORKSPACE</span><span className="security-chip chip-two">OFFICIAL<br />ABN DATA</span><span className="security-chip chip-three">TEAM<br />CONTROL</span></div><div className="security-copy"><p className="landing-label">BUILT FOR TRUST</p><h2>Your supplier data stays<br />under your control.</h2><p>ABN Guard is designed for sensitive finance workflows. Company workspaces are separate, credentials stay server-side and PDF pages are sent only to the configured private extraction endpoint during verification.</p><div><span><b>01</b>Private VLM document extraction</span><span><b>02</b>Server-side ABN credentials</span><span><b>03</b>Separate company workspaces</span></div></div></section>

      <section className="landing-final"><p className="landing-label">START WITH YOUR NEXT SUPPLIER</p><h2>A clearer check.<br /><em>A safer payment.</em></h2><p>Give your finance team one dependable place to verify every supplier before money moves.</p><SignUpButton mode="modal" forceRedirectUrl="/app/check"><button type="button" className="landing-primary light">Join now — it’s free <span>→</span></button></SignUpButton><small>No credit card required · Set up in minutes</small></section>

      <footer className="landing-footer"><a className="landing-brand" href="#top"><span>A</span><strong>ABN Guard</strong></a><p>Supplier verification for Australian finance teams.</p><div><a href="#product">Product</a><Link href="/contact">Contact</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><SignInButton mode="modal" forceRedirectUrl="/app/check"><button type="button">Sign in</button></SignInButton></div><small>© {new Date().getFullYear()} ABN Guard</small></footer>
      <LegacyAuthDialog />
    </main>
  );
}
