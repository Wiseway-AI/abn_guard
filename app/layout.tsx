import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";
import "./ui-refinements.css";
import "./reference-redesign.css";
import "./legal-pages.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://abn-guard.wiseway.ai"),
  title: { default: "ABN Guard · Supplier Verification", template: "%s · ABN Guard" },
  description: "Verify supplier ABNs, GST status and bank details, then monitor a secure cloud supplier register.",
  openGraph: { title: "ABN Guard · Supplier Verification", description: "Know who you’re paying before money moves.", type: "website", locale: "en_AU", images: [{ url: "/og.png", width: 1536, height: 1024, alt: "ABN Guard supplier verification" }] },
  twitter: { card: "summary_large_image", title: "ABN Guard · Supplier Verification", description: "Know who you’re paying before money moves.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>
        <ClerkProvider>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}