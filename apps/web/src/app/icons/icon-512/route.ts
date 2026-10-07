import { ImageResponse } from "next/og";
import { createElement } from "react";

export const dynamic = "force-static";

/** The neutral portfolio icon at the size required by installable manifests. */
export function GET() {
  return new ImageResponse(
    createElement("div", {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#1D579C",
        color: "white",
        fontSize: 204,
        fontWeight: 700,
      },
    }, "WF"),
    { width: 512, height: 512 },
  );
}
