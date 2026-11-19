// Printer driver settings: paper source (tray), media type, quality and everything else a driver offers.
//
// macOS and Linux print through CUPS whatever the brand (Epson, Canon, HP, Brother, Ricoh and the rest, including
// driverless AirPrint and IPP Everywhere printers). Every CUPS queue describes its options, so Glimmr lists them,
// lets you choose, and sends the job with `lp`. Chromium's print path can't set them: it passes only paper size,
// copies, duplex and colour, so the driver falls back to its default tray.
//
// Windows drivers keep these settings in their own Printing Preferences window (the Epson, Canon or HP dialog).
// Glimmr opens it; silent prints start from the preferences chosen there.
//
// Nothing here imports Electron, so it's unit-tested.

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  PAPER_NAMES,
  type Layout,
  type PrintSettings,
} from "../../shared/print";
import type { DriverInfo, DriverOption } from "../../shared/types";

/** Options Glimmr sets itself, or that would fight its layout. */
const MANAGED =
  /^(PageSize|PageRegion|PaperDimension|ImageableArea|Duplex|Collate|Copies|ColorModel|cupsPrintColorMode|print-color-mode|orientation-requested|number-up|page-ranges|fit-to-page|print-scaling)$/i;

const GROUPS: [DriverOption["group"], RegExp][] = [
  [
    "source",
    /InputSlot|MediaSource|PaperSource|MediaSupply|PaperFeed|Tray|Cassette|Feeder|Bin$/i,
  ],
  ["media", /MediaType|PaperType|Media$|Medium|Paper$|Substrate/i],
  ["quality", /Quality|OutputMode|Resolution|PrintMode|Dpi|Speed|HalfTon/i],
];

export function groupOf(key: string): DriverOption["group"] {
  return GROUPS.find(([, re]) => re.test(key))?.[0] ?? "other";
}

/** "PhotoPaperGlossy" → "Photo paper glossy", "w288h432" stays. */
export function humanize(word: string): string {
  if (/^w\d+h\d+$/.test(word)) return word;
  const s = word
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Labels from a PPD file: option label, and each choice's label. */
export function parsePpdLabels(
  ppd: string,
): Map<string, { label?: string; choices: Map<string, string> }> {
  const out = new Map<
    string,
    { label?: string; choices: Map<string, string> }
  >();
  const entry = (
    k: string,
  ): { label?: string; choices: Map<string, string> } => {
    let e = out.get(k);
    if (!e) out.set(k, (e = { choices: new Map() }));
    return e;
  };
  for (const line of ppd.split(/\r?\n/)) {
    const open = /^\*(?:JCL)?OpenUI\s+\*([^/:\s]+)(?:\/([^:]*))?:/.exec(line);
    if (open) {
      if (open[2]?.trim()) entry(open[1]).label = open[2].trim();
      continue;
    }
    // *InputSlot Rear/Rear Paper Feed: "..."
    const choice = /^\*([A-Za-z][^\s/:]*)\s+([^\s/:]+)\/([^:]+):/.exec(line);
    if (choice && !/^(Default|Open|Close|Order|Translation)/.test(choice[1]))
      entry(choice[1]).choices.set(choice[2], choice[3].trim());
  }
  return out;
}

/** Parses `lpoptions -l`: `InputSlot/Paper Source: *Main Rear Photo`. */
export function parseLpoptions(
  text: string,
  ppd?: string,
): { options: DriverOption[]; pageSizes: string[] } {
  const labels = ppd ? parsePpdLabels(ppd) : new Map();
  const options: DriverOption[] = [];
  let pageSizes: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([^/:\s]+)(?:\/([^:]*))?:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, key, label, rest] = m;
    const words = rest.split(/\s+/).filter(Boolean);
    const values = words.map((w) => w.replace(/^\*/, ""));
    if (/^PageSize$/i.test(key)) pageSizes = values;
    if (MANAGED.test(key) || values.length < 2) continue;
    const known = labels.get(key);
    const def = words.find((w) => w.startsWith("*"))?.slice(1) ?? values[0];
    options.push({
      key,
      label: known?.label || label?.trim() || humanize(key),
      group: groupOf(key),
      choices: values.map((v) => ({
        value: v,
        label: known?.choices.get(v) ?? humanize(v),
      })),
      defaultValue: def,
    });
  }
  const order = { source: 0, media: 1, quality: 2, other: 3 };
  options.sort((a, b) => order[a.group] - order[b.group]);
  return { options, pageSizes };
}

const run = (cmd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) =>
    execFile(
      cmd,
      args,
      { timeout: 8000, maxBuffer: 4 << 20 },
      (err, stdout, stderr) =>
        err
          ? reject(Object.assign(err, { stderr: String(stderr) }))
          : resolve(String(stdout)),
    ),
  );

/** The CUPS default destination, for when no printer is chosen. */
async function cupsDefault(): Promise<string | null> {
  try {
    return (
      /destination:\s*(\S+)/.exec(await run("lpstat", ["-d"]))?.[1] ?? null
    );
  } catch {
    return null;
  }
}

function readPpd(name: string): string | undefined {
  for (const dir of ["/etc/cups/ppd", "/private/etc/cups/ppd"]) {
    try {
      return fs.readFileSync(path.join(dir, `${name}.ppd`), "latin1");
    } catch {
      // Often root-only on Linux; lpoptions still lists the options.
    }
  }
  return undefined;
}

/** What the printer's driver offers. */
export async function driverInfo(
  printer: string | null,
  platform = process.platform,
): Promise<DriverInfo> {
  if (platform === "win32")
    return { kind: "windows", printer, options: [], pageSizes: [] };
  const name = printer ?? (await cupsDefault());
  if (!name) return { kind: "none", printer, options: [], pageSizes: [] };
  try {
    const { options, pageSizes } = parseLpoptions(
      await run("lpoptions", ["-p", name, "-l"]),
      readPpd(name),
    );
    return { kind: "cups", printer: name, options, pageSizes };
  } catch {
    return { kind: "none", printer: name, options: [], pageSizes: [] };
  }
}

/** The chosen driver settings for a printer, keeping only ones the driver still offers. */
export function chosenOptions(
  s: PrintSettings,
  info: DriverInfo,
): Record<string, string> {
  const saved = s.driver[s.printer ?? ""] ?? {};
  const out: Record<string, string> = {};
  for (const o of info.options) {
    const v = saved[o.key];
    if (
      v != null &&
      v !== o.defaultValue &&
      o.choices.some((c) => c.value === v)
    )
      out[o.key] = v;
  }
  return out;
}

const BORDERLESS = [".Borderless", ".FullBleed", ".FB", "FB", ".Fullbleed"];

/**
 * The CUPS media name for the page: the driver's own keyword when it has the paper (its borderless variant for
 * zero margins), else the PWG name, which CUPS matches to a driver size by its dimensions, else a custom size.
 */
export function cupsMedia(
  s: PrintSettings,
  layout: Layout,
  pageSizes: string[],
): string {
  const names = PAPER_NAMES[s.paper];
  const has = (n: string): string | undefined =>
    pageSizes.find((p) => p.toLowerCase() === n.toLowerCase());
  const borderless = Object.values(s.margins).every((m) => m === 0);
  if (names && s.paper !== "custom") {
    for (const n of names.ppd) {
      const base = has(n);
      if (!base) continue;
      if (borderless)
        for (const suffix of BORDERLESS) {
          const b = has(base + suffix);
          if (b) return b;
        }
      return base;
    }
    return names.pwg;
  }
  const w = Math.min(layout.width, layout.height);
  const h = Math.max(layout.width, layout.height);
  return `Custom.${+w.toFixed(3)}x${+h.toFixed(3)}in`;
}

/** `lp` arguments for a PDF of the job. */
export function lpArgs(
  pdf: string,
  s: PrintSettings,
  layout: Layout,
  info: DriverInfo,
  title: string,
): string[] {
  const args: string[] = [];
  if (info.printer) args.push("-d", info.printer);
  const copies = Math.max(1, Math.round(s.copies));
  args.push("-t", title, "-n", String(copies));
  const o = (k: string, v: string): void => void args.push("-o", `${k}=${v}`);
  o("media", cupsMedia(s, layout, info.pageSizes));
  // The PDF page is already the paper size; scaling would change the print size.
  o("print-scaling", "none");
  o("fit-to-page", "false");
  o(
    "sides",
    s.duplex === "longEdge"
      ? "two-sided-long-edge"
      : s.duplex === "shortEdge"
        ? "two-sided-short-edge"
        : "one-sided",
  );
  if (copies > 1) o("collate", s.collate ? "true" : "false");
  if (s.grayscale) o("print-color-mode", "monochrome");
  for (const [k, v] of Object.entries(chosenOptions(s, info))) o(k, v);
  args.push("--", pdf);
  return args;
}

/** Sends a PDF to a CUPS queue. Resolves with the job id. Rejects with code ENOENT when `lp` isn't installed. */
export function cupsPrint(
  pdf: string,
  s: PrintSettings,
  layout: Layout,
  info: DriverInfo,
  title: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("lp", lpArgs(pdf, s, layout, info, title), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(/request id is (\S+)/.exec(out)?.[1] ?? "");
      else
        reject(
          new Error(
            `The printer reported: ${err.trim().replace(/^lp:\s*/i, "") || `lp exited with ${code}`}`,
          ),
        );
    });
  });
}

/** Opens the Windows driver's Printing Preferences (Epson, Canon, HP…), whose settings silent prints use. */
export function openWindowsPreferences(printer: string): void {
  // printui reads the raw command line, so quote the name ourselves.
  const child = spawn(
    "rundll32.exe",
    [`printui.dll,PrintUIEntry /e /n "${printer.replace(/"/g, "")}"`],
    { windowsVerbatimArguments: true, detached: true, stdio: "ignore" },
  );
  child.on("error", () => undefined);
  child.unref();
}
