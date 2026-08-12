import type { Metadata } from "next";
import "./globals.css";
import "./ui-refinements.css";

export const metadata: Metadata = {
  title: "ABN Guard · Supplier Verification",
  description: "Verify supplier ABNs, GST status and bank details, then monitor a secure cloud supplier register.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
