import type { MetadataRoute } from "next";

/**
 * What a phone needs to keep Workflow Portfolio on its Home Screen as an app (the
 * user, 2026-10-04). iPhone delivers push notifications only to a site added
 * to the Home Screen and opened from there, so this is part of notifications,
 * not decoration.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Workflow Portfolio 生產單管理系統",
    short_name: "Workflow Portfolio",
    description: "內部生產單協作系統",
    lang: "zh-Hant",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0C2340",
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
