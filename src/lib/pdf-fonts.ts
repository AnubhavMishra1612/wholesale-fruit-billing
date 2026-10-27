/**
 * Shared font registration for @react-pdf/renderer.
 *
 * Noto Sans Regular + Bold are shipped under src/assets/fonts/ to provide
 * broader Unicode coverage (Latin Extended, Devanagari, etc.) than PDFKit's
 * built-in Helvetica. Registration is best-effort: if loading fails we
 * silently fall back to Helvetica/Courier so invoice PDFs always render.
 *
 * Register is guarded by an in-process flag so repeat calls across requests
 * don't re-register (react-pdf throws on duplicate family names).
 */
import path from "node:path";

import fs from "node:fs";

type FontLike = {
  register: (opts: unknown) => void;
};

let registered = false;

export async function registerPdfFonts(Font: FontLike): Promise<void> {
  if (registered) return;
  try {
    const regularPath = getFontPath("NotoSans-Regular.ttf");
    const boldPath = getFontPath("NotoSans-Bold.ttf");

    if (fs.existsSync(regularPath) && fs.existsSync(boldPath)) {
      Font.register({
        family: "NotoSans",
        fonts: [
          { src: regularPath, fontWeight: "normal" },
          { src: boldPath, fontWeight: "bold" },
        ],
      });
      registered = true;
    }
  } catch (e) {
    console.warn("[pdf-fonts] Failed to register NotoSans:", (e as Error).message);
  }
}

// Keep path helper exported for future use
export function getFontPath(name: string): string {
  return path.join(process.cwd(), "src", "assets", "fonts", name);
}
