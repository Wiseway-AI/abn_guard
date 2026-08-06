import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ABN Guard · Supplier Verification",
  description: "Extract and verify ABNs, GST status and supplier registration details from contracts, with a local ABN register.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
