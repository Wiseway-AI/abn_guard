import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Use", description: "Terms for using ABN Guard supplier verification." };

export default function TermsPage() {
  return <main className="public-page"><nav className="public-page-nav"><Link className="public-brand" href="/"><span>A</span>ABN Guard</Link><div><Link href="/contact">Contact</Link><Link href="/privacy">Privacy</Link></div></nav><div className="public-page-main"><p>TERMS OF USE</p><h1>Use ABN Guard as a verification aid.</h1><p className="lead">These terms apply when you create an account or use ABN Guard. Last updated 14 August 2026.</p>
    <article><h2>The service</h2><p>ABN Guard helps teams extract supplier details, compare them with ABN Lookup data and maintain a supplier register. Results are an operational aid, not legal, tax, accounting or financial advice.</p></article>
    <article><h2>Your responsibilities</h2><p>You are responsible for confirming payment instructions through appropriate independent controls, maintaining accurate account information, protecting login details and ensuring you have authority to process uploaded documents and supplier data.</p></article>
    <article><h2>Acceptable use</h2><p>You must not misuse the service, attempt unauthorised access, circumvent usage limits, interfere with availability, upload unlawful material or use ABN Guard to facilitate fraud or harm.</p></article>
    <article><h2>Availability and official data</h2><p>We aim to provide a reliable service but cannot guarantee uninterrupted access or that third-party data is always current. Official ABN information is supplied by the Australian Government ABN Lookup service. You remain responsible for the final supplier and payment decision.</p></article>
    <article><h2>Plans, billing and cancellation</h2><p>Paid subscriptions renew through Stripe until cancelled. Current prices and limits are shown before checkout. You can manage or cancel a subscription through the billing portal; access may continue until the end of the paid period. Permanently deleting an ABN Guard account cancels any active subscription immediately and removes the associated workspace data.</p></article>
    <article><h2>Liability and changes</h2><p>To the extent permitted by law, ABN Guard is provided without guarantees beyond rights that cannot legally be excluded. We may update the service or these terms and will publish the current version here.</p></article>
    <article><h2>Contact</h2><p>Questions about these terms can be sent through our <Link href="/contact">contact page</Link>.</p></article>
  </div></main>;
}
