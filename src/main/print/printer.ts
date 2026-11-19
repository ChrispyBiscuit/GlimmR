// The Electron side of printing: listing printers, printing an HTML page set through a hidden window, and PDF.

import { BrowserWindow, type WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  PAPER_NAMES,
  type Layout,
  type PrintSettings,
} from "../../shared/print";
import type { PrinterInfo } from "../../shared/types";
import { cupsPrint, driverInfo } from "./driver";

const STATES: Record<string, PrinterInfo["state"]> = {
  "3": "ready",
  "4": "busy",
  "5": "stopped",
};

/** Installed printers, default first. Status and location come from the driver where it reports them (CUPS). */
export async function listPrinters(wc: WebContents): Promise<PrinterInfo[]> {
  const list = await wc.getPrintersAsync();
  return list
    .map((p) => {
      const o = (p.options ?? {}) as Record<string, string>;
      return {
        name: p.name,
        displayName: p.displayName || p.name,
        description: p.description || o["printer-make-and-model"] || "",
        isDefault:
          (p as unknown as { isDefault?: boolean }).isDefault === true ||
          o["is-default"] === "true",
        state: STATES[o["printer-state"] ?? ""] ?? "unknown",
        location: o["printer-location"] ?? "",
        model: o["printer-make-and-model"] ?? "",
      };
    })
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.displayName.localeCompare(b.displayName),
    );
}

/** Loads the page set in an invisible window and waits for every image and font. */
async function load(file: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  await win.loadURL(pathToFileURL(file).toString());
  await win.webContents.executeJavaScript(
    "Promise.all(Array.from(document.images, (i) => i.decode().catch(() => null))).then(() => document.fonts.ready).then(() => true)",
  );
  return win;
}

const microns = (inches: number): number => Math.round(inches * 25400);

/** Whether the system dialog is used: when asked for, or when Glimmr manages colour (the driver's own colour
 * management must be turned off there). */
export const usesDialog = (s: PrintSettings): boolean =>
  s.systemDialog || s.colorMode === "glimmr";

/**
 * Prints the page set. On macOS and Linux silent prints go through CUPS with the driver settings chosen in Glimmr
 * (tray, media type, quality), since Chromium can't pass those. Otherwise, and when the dialog is used, Chromium
 * prints it. Resolves with a note for the confirmation, such as the CUPS job id.
 */
export async function printHtml(
  file: string,
  layout: Layout,
  s: PrintSettings,
  title = "Glimmr print",
): Promise<string> {
  if (process.platform !== "win32" && !usesDialog(s)) {
    const info = await driverInfo(s.printer);
    if (info.kind === "cups") {
      const pdf = path.join(path.dirname(file), "print.pdf");
      fs.writeFileSync(pdf, await pdfHtml(file, layout));
      try {
        const id = await cupsPrint(pdf, s, layout, info, title);
        return id ? `job ${id}` : "";
      } catch (e) {
        // No lp command (rare): fall back to Chromium.
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
  }
  await chromiumPrint(file, layout, s);
  return "";
}

async function chromiumPrint(
  file: string,
  layout: Layout,
  s: PrintSettings,
): Promise<void> {
  const win = await load(file);
  // Standard papers go by name, so the driver matches its own size (and the tray that holds it).
  const named = PAPER_NAMES[s.paper]?.electron;
  try {
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: !usesDialog(s),
          deviceName: s.printer ?? undefined,
          printBackground: true,
          color: !s.grayscale,
          margins: { marginType: "none" },
          landscape: layout.landscape,
          pageSize: named ?? {
            width: microns(Math.min(layout.width, layout.height)),
            height: microns(Math.max(layout.width, layout.height)),
          },
          copies: Math.max(1, Math.round(s.copies)),
          collate: s.collate,
          duplexMode: s.duplex,
          dpi: { horizontal: s.ppi, vertical: s.ppi },
        },
        (ok, reason) =>
          ok
            ? resolve()
            : reject(
                new Error(
                  /cancel/i.test(reason)
                    ? "Cancelled."
                    : `The printer reported: ${reason || "unknown error"}`,
                ),
              ),
      );
    });
  } finally {
    win.destroy();
  }
}

/** Renders the page set to a PDF of the exact paper size. */
export async function pdfHtml(file: string, layout: Layout): Promise<Buffer> {
  const win = await load(file);
  try {
    return await win.webContents.printToPDF({
      pageSize: { width: layout.width, height: layout.height },
      printBackground: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    });
  } finally {
    win.destroy();
  }
}

/** @font-face rules for the app's own text face, so printed captions match the interface. */
export function fontCss(rendererDir: string): string {
  try {
    const dir = path.join(rendererDir, "assets");
    const file =
      fs
        .readdirSync(dir)
        .find(
          (f) =>
            /^archivo.*wdth.*\.woff2$/i.test(f) && /latin-wdth-normal/i.test(f),
        ) ?? fs.readdirSync(dir).find((f) => /^archivo.*\.woff2$/i.test(f));
    return file
      ? `@font-face { font-family: Archivo; src: url("${pathToFileURL(path.join(dir, file))}") format("woff2"); font-weight: 100 900; font-stretch: 62% 125% }`
      : "";
  } catch {
    return "";
  }
}
