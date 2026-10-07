import type { Metadata, Viewport } from "next";
import "@workflow/ui/tokens.css";
import "@workflow/ui/base.css";
// Noto Sans TC is vendored rather than fetched from Google at build time; see
// scripts/fonts/vendor-noto-sans-tc.mjs and DESIGN.md section 3.2.2. The
// stylesheet is generated, sliced by unicode-range, and names the family
// literally — which is what --cc-font-sans in tokens.css already asks for.
import "./fonts.css";
import "./app.css";

export const metadata: Metadata = {
  title: "Workflow Portfolio 生產單管理系統",
  description: "內部生產單協作系統",
  // On the Home Screen it opens as an app, which is how iPhone receives push
  // notifications (the user, 2026-10-04). The manifest is app/manifest.ts.
  appleWebApp: { capable: true, title: "Workflow Portfolio", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png", icon: "/icons/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Never block zoom — DESIGN.md section 3.4 targets WCAG 2.2 AA.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Browsers write their own attributes onto <html> before React loads —
    // Chrome on iPhone adds __gcrremoteframetoken (the user, 2026-10-03) — so
    // React is told not to compare this one element's attributes. It reaches
    // one level only: a real mismatch in the page still reports.
    <html lang="zh-Hant" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
