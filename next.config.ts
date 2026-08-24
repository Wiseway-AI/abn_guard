import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: [
          "default-src 'self'",
          "base-uri 'self'",
          "object-src 'none'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client https://*.clerk.accounts.dev https://*.clerk.com",
          "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
          "img-src 'self' data: blob: https://*.googleusercontent.com https://img.clerk.com",
          "font-src 'self' data:",
          "connect-src 'self' https://accounts.google.com/gsi/ https://*.clerk.accounts.dev https://*.clerk.com",
          "frame-src https://accounts.google.com/gsi/ https://*.clerk.accounts.dev https://*.clerk.com",
          "worker-src 'self' blob:",
          "media-src 'self' blob:",
          "manifest-src 'self'",
          "upgrade-insecure-requests",
        ].join("; ") },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
        { key: "Origin-Agent-Cluster", value: "?1" },
      ],
    }];
  },
};

export default nextConfig;
