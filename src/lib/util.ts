export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || Math.random().toString(36).slice(2, 10)
  );
}

export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const r = min % 60;
  return h ? (r ? `${h}h ${r}min` : `${h}h`) : `${r} min`;
}

const dateFmt = new Intl.DateTimeFormat("bs-BA", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Sarajevo" });
export function fmtDateRange(a?: Date | null, b?: Date | null): string {
  if (!a) return "";
  if (!b || b.getTime() === a.getTime()) return dateFmt.format(a);
  return `${dateFmt.format(a)} – ${dateFmt.format(b)}`;
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Nacrt",
  PUBLISHED: "Objavljen",
  COMPLETED: "Završen",
  ARCHIVED: "Arhiviran",
};

export const KIND_LABEL: Record<string, string> = { SESSION: "Sesija", TALK: "Govor", BREAK: "Pauza", MEAL: "Ručak", END: "Kraj" };

export const QTYPE_LABEL: Record<string, string> = {
  RATING: "Ocjena 1–5",
  SINGLE_CHOICE: "Jedan izbor",
  MULTIPLE_CHOICE: "Više izbora",
  SHORT_TEXT: "Kratak tekst",
  LONG_TEXT: "Dug tekst",
};

/** CSV ćelija sa zaštitom od formula injekcije (=, +, -, @, tab, CR) i pravilnim navodnicima. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",");

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
