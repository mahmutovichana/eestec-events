"use server";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertAdmin } from "@/lib/session";
import { rateLimit } from "@/lib/ratelimit";
import { slugify } from "@/lib/util";
import { canTransition, type Status } from "@/lib/status";

/*
 * PRAVILO: svaka eksportovana akcija u ovom fajlu poziva `await guard()` prije prvog pristupa bazi.
 * guard() poziva assertAdmin() (verifikovana sesija + uloga ADMIN) i distribuirano ograničava brzinu.
 * Test test/actions-guard.test.mjs provjerava ovo pravilo statički.
 *
 * Politika čuvanja podataka (docs/SECURITY.md):
 *  - pitanje s odgovorima i opcija s glasovima se ARHIVIRAJU, nikad ne brišu;
 *  - događaj se briše samo iz Nacrta ili Arhive, uz upis tačnog naziva;
 *  - forma/anketa s podacima, reset glasova i brisanje odgovora traže upis riječi OBRIŠI.
 */

export type Result = { ok: true; message?: string; version?: number } | { ok: false; error: string; conflict?: boolean };
const ok = (message?: string, extra?: { version?: number }): Result => ({ ok: true, message, ...extra });

async function guard() {
  const admin = await assertAdmin();
  if (!(await rateLimit("act", admin.id, 240, 60_000))) throw new Error("RATE_LIMITED");
  return admin;
}

/** Pretvara greške u poruke za korisnika. Redirect i not-found prolaze dalje. */
async function run(fn: () => Promise<Result | void>): Promise<Result> {
  try {
    const r = (await fn()) as Result | undefined;
    return r ?? ok();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Neispravan unos." };
    const m = e instanceof Error ? e.message : "";
    if (m === "UNAUTHENTICATED") return { ok: false, error: "Sesija je istekla. Prijavi se ponovo." };
    if (m === "FORBIDDEN") return { ok: false, error: "Nemaš dozvolu za ovu radnju." };
    if (m === "RATE_LIMITED") return { ok: false, error: "Previše radnji u kratkom roku. Pokušaj za minutu." };
    const code = e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "";
    if (code === "P2025") return { ok: false, error: "Stavka više ne postoji." };
    if (code === "P2003") return { ok: false, error: "Stavka se koristi i ne može se obrisati. Arhiviraj je umjesto brisanja." };
    if (m.startsWith("USER:")) return { ok: false, error: m.slice(5) };
    console.error("[action]", code || m); // namjerno bez podataka iz zahtjeva
    return { ok: false, error: "Došlo je do greške. Pokušaj ponovo." };
  }
}
const fail = (m: string) => new Error("USER:" + m);

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const optDate = (s: string) => (s ? new Date(s + "T12:00:00Z") : null);
const isUnique = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";

/** Upis potvrde: zadani izraz mora tačno odgovarati. */
function requireConfirm(fd: FormData, expected: string) {
  if (str(fd, "confirm") !== expected) throw fail(`Za potvrdu upiši tačno: ${expected}`);
}

const bump = (...paths: string[]) => {
  revalidatePath("/admin", "layout");
  revalidatePath("/e", "layout");
  paths.forEach((p) => revalidatePath(p));
};

const DEFAULT_QUESTIONS: { type: "RATING" | "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "SHORT_TEXT" | "LONG_TEXT"; label: string; required: boolean; options?: string[] }[] = [
  { type: "RATING", label: "Ukupno zadovoljstvo događajem", required: true },
  { type: "RATING", label: "Kvalitet sesija", required: false },
  { type: "RATING", label: "Relevantnost tema", required: false },
  { type: "RATING", label: "Organizacija i logistika", required: false },
  { type: "RATING", label: "Trajanje događaja", required: false },
  { type: "RATING", label: "Komunikacija", required: false },
  { type: "LONG_TEXT", label: "Šta ti je bilo najvrijednije na događaju?", required: false },
  { type: "LONG_TEXT", label: "Šta bi trebalo poboljšati?", required: false },
  { type: "LONG_TEXT", label: "Prijedlozi za buduće događaje", required: false },
];

/* ======================= Događaji ======================= */
const EventInput = z.object({
  name: z.string().trim().min(2, "Naziv mora imati bar 2 znaka.").max(120),
  description: z.string().max(600),
  location: z.string().max(160),
});

/** Slug je jedinstven u bazi. Kolizije (i istovremene) rješava ponavljanje s nasumičnim sufiksom. */
async function createWithUniqueSlug<T>(base: string, make: (slug: string) => Promise<T>): Promise<T> {
  const root = slugify(base);
  for (let i = 0; i < 5; i++) {
    const slug = i === 0 ? root : `${root}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      return await make(slug);
    } catch (e) {
      if (!isUnique(e)) throw e;
    }
  }
  throw fail("Ne mogu napraviti jedinstven link. Pokušaj s drugim nazivom.");
}

function checkDates(startsAt: Date | null, endsAt: Date | null) {
  if ((startsAt && isNaN(startsAt.getTime())) || (endsAt && isNaN(endsAt.getTime()))) throw fail("Neispravan datum.");
  if (startsAt && endsAt && endsAt < startsAt) throw fail("Datum završetka ne može biti prije početka.");
}

export async function createEvent(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const v = EventInput.parse({ name: str(fd, "name"), description: str(fd, "description"), location: str(fd, "location") });
    const startsAt = optDate(str(fd, "startsAt"));
    const endsAt = optDate(str(fd, "endsAt"));
    checkDates(startsAt, endsAt);
    const p = await createWithUniqueSlug(str(fd, "slug") || v.name, (slug) => db.project.create({ data: { ...v, slug, startsAt, endsAt } }));
    bump();
    redirect(`/admin/events/${p.id}`);
  });
}

export async function updateEvent(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const id = str(fd, "id");
    const v = EventInput.parse({ name: str(fd, "name"), description: str(fd, "description"), location: str(fd, "location") });
    const slug = slugify(str(fd, "slug"));
    const startsAt = optDate(str(fd, "startsAt"));
    const endsAt = optDate(str(fd, "endsAt"));
    checkDates(startsAt, endsAt);
    try {
      await db.project.update({ where: { id }, data: { ...v, slug, startsAt, endsAt } });
    } catch (e) {
      if (isUnique(e)) throw fail("Taj link je već zauzet.");
      throw e;
    }
    bump();
    return ok("Događaj je sačuvan.");
  });
}

/** Provjera i upis u jednoj transakciji uz zaključan red: dva istovremena prelaza ne mogu preskočiti pravila. */
async function transition(id: string, to: Status) {
  await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: Status }[]>`SELECT "status"::text AS "status" FROM "Project" WHERE "id" = ${id} FOR UPDATE`;
    const from = rows[0]?.status;
    if (!from) throw fail("Događaj ne postoji.");
    if (!canTransition(from, to)) throw fail(`Prelaz ${from} → ${to} nije dozvoljen.`);
    await tx.project.update({ where: { id }, data: { status: to } });
  });
  bump();
}

export async function setEventStatus(id: string, status: string): Promise<Result> {
  return run(async () => {
    await guard();
    await transition(id, z.enum(["DRAFT", "PUBLISHED", "COMPLETED", "ARCHIVED"]).parse(status));
    return ok("Status je promijenjen.");
  });
}

/** Arhiviranje iz forme s potvrdom (isto pravilo prelaza kao setEventStatus). */
export async function archiveEvent(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    await transition(str(fd, "id"), "ARCHIVED");
    return ok("Događaj je arhiviran.");
  });
}

export async function duplicateEvent(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const src = await db.project.findUniqueOrThrow({
      where: { id: str(fd, "id") },
      include: {
        agendas: { orderBy: { position: "asc" }, include: { items: { orderBy: { position: "asc" } } } },
        polls: { include: { options: { where: { archivedAt: null }, orderBy: { position: "asc" } } } },
        forms: { include: { questions: { where: { archivedAt: null }, orderBy: { position: "asc" } } } },
      },
    });
    const name = str(fd, "name") || `${src.name} (kopija)`;
    // Kopiraju se struktura i postavke. Glasovi, odgovori, datumi i arhivirane stavke se ne kopiraju.
    const copy = await createWithUniqueSlug(name, (slug) =>
      db.project.create({
        data: {
          name, slug, description: src.description, location: src.location, status: "DRAFT",
          agendas: {
            create: src.agendas.map((a) => ({
              slug: a.slug, title: a.title, dateLabel: "", position: a.position,
              items: { create: a.items.map(({ id: _i, agendaId: _a, version: _v, ...it }) => it) },
            })),
          },
          polls: {
            create: src.polls.map((p) => ({
              title: p.title, description: p.description, isOpen: true, allowChange: p.allowChange, showResultsWhileOpen: p.showResultsWhileOpen,
              options: { create: p.options.map(({ id: _i, pollId: _p, archivedAt: _x, ...o }) => o) },
            })),
          },
          forms: {
            create: src.forms.map((f) => ({
              title: f.title, description: f.description, isOpen: true, mode: f.mode, oneResponsePerUser: f.oneResponsePerUser,
              questions: { create: f.questions.map(({ id: _i, formId: _f, archivedAt: _x, ...q }) => q) },
            })),
          },
        },
      }),
    );
    bump();
    redirect(`/admin/events/${copy.id}`);
  });
}

export async function deleteEvent(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const id = str(fd, "id");
    const p = await db.project.findUniqueOrThrow({ where: { id } });
    // Aktivan događaj se ne briše: prvo ga arhiviraj (vraćanje je moguće), pa tek onda trajno brisanje.
    if (p.status !== "DRAFT" && p.status !== "ARCHIVED") throw fail("Događaj se može obrisati samo iz Nacrta ili Arhive. Prvo ga arhiviraj.");
    requireConfirm(fd, p.name);
    await db.project.delete({ where: { id } });
    bump();
    redirect("/admin/events");
  });
}

/* ======================= Agende ======================= */
export async function createAgenda(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const projectId = str(fd, "projectId");
    const title = z.string().trim().min(1, "Unesi naslov agende.").max(120).parse(str(fd, "title"));
    const position = await db.agenda.count({ where: { projectId } });
    // Slug je jedinstven po događaju: kolizija se rješava ponavljanjem sa sufiksom.
    const root = slugify(title);
    let a: { id: string } | undefined;
    for (let i = 0; i < 5 && !a; i++) {
      const slug = i === 0 ? root : `${root}-${Math.random().toString(36).slice(2, 5)}`;
      try {
        a = await db.agenda.create({ data: { projectId, title, slug, dateLabel: str(fd, "dateLabel"), position } });
      } catch (e) {
        if (!isUnique(e)) throw e;
      }
    }
    if (!a) throw fail("Ne mogu napraviti jedinstven link agende.");
    bump();
    redirect(`/admin/events/${projectId}/agendas/${a.id}`);
  });
}

export async function updateAgenda(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const title = z.string().trim().min(1, "Unesi naslov agende.").max(120).parse(str(fd, "title"));
    await db.agenda.update({ where: { id: str(fd, "id") }, data: { title, dateLabel: str(fd, "dateLabel") } });
    bump();
    return ok("Agenda je sačuvana.");
  });
}

export async function deleteAgenda(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const a = await db.agenda.findUniqueOrThrow({ where: { id: str(fd, "id") }, include: { _count: { select: { items: true } } } });
    if (a._count.items > 0) requireConfirm(fd, a.title);
    await db.agenda.delete({ where: { id: a.id } });
    bump();
    redirect(`/admin/events/${a.projectId}/agendas`);
  });
}

const ItemInput = z
  .object({
    startTime: z.string().regex(TIME, "Početak mora biti u formatu HH:MM."),
    endTime: z.string().regex(TIME, "Kraj mora biti u formatu HH:MM."),
    title: z.string().trim().min(1, "Unesi naslov stavke.").max(200),
    description: z.string().max(1500),
    speaker: z.string().max(160),
    location: z.string().max(160),
    notes: z.string().max(1500),
    kind: z.enum(["SESSION", "TALK", "BREAK", "MEAL", "END"]),
  })
  .refine((v) => v.endTime >= v.startTime, { message: "Kraj ne može biti prije početka.", path: ["endTime"] });

export type ItemFields = z.input<typeof ItemInput>;

export async function createItem(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const agendaId = str(fd, "agendaId");
    const v = ItemInput.parse({
      startTime: str(fd, "startTime"), endTime: str(fd, "endTime"), title: str(fd, "title"), description: str(fd, "description"),
      speaker: str(fd, "speaker"), location: str(fd, "location"), notes: str(fd, "notes"), kind: str(fd, "kind"),
    });
    // Pozicija = max + 1 pod advisory lockom agende: dva istovremena dodavanja ne dobijaju istu poziciju.
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"agenda:" + agendaId}))`;
      const last = await tx.agendaItem.aggregate({ where: { agendaId }, _max: { position: true } });
      await tx.agendaItem.create({ data: { agendaId, position: (last._max.position ?? -1) + 1, ...v } });
    });
    bump();
    return ok("Stavka je dodana.");
  });
}

/** Autosave kartice. `version` je verzija koju je klijent učitao: ako se u međuvremenu promijenila, izmjena se odbija. */
export async function saveItem(id: string, version: number, fields: ItemFields): Promise<Result> {
  return run(async () => {
    await guard();
    const data = ItemInput.parse(fields);
    const r = await db.agendaItem.updateMany({ where: { id, version }, data: { ...data, version: { increment: 1 } } });
    if (r.count === 0) {
      const exists = await db.agendaItem.findUnique({ where: { id }, select: { id: true } });
      if (!exists) return { ok: false, error: "Stavka je obrisana u drugom prozoru.", conflict: true };
      return { ok: false, error: "Stavka je izmijenjena u drugom prozoru. Osvježi stranicu da vidiš najnoviju verziju.", conflict: true };
    }
    revalidatePath("/e", "layout");
    return ok(undefined, { version: version + 1 });
  });
}

export async function deleteItem(id: string): Promise<Result> {
  return run(async () => {
    await guard();
    await db.agendaItem.delete({ where: { id } });
    bump();
    return ok("Stavka je obrisana.");
  });
}

export async function reorderItems(agendaId: string, orderedIds: string[]): Promise<Result> {
  return run(async () => {
    await guard();
    const ids = z.array(z.string()).max(500).parse(orderedIds);
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"agenda:" + agendaId}))`;
      const existing = await tx.agendaItem.findMany({ where: { agendaId }, select: { id: true } });
      const have = new Set(existing.map((e) => e.id));
      // Lista mora sadržavati tačno stavke ove agende: bez izostavljenih, tuđih i duplih id-eva.
      if (ids.length !== have.size || new Set(ids).size !== ids.length || ids.some((i) => !have.has(i))) {
        throw fail("Lista stavki je zastarjela. Osvježi stranicu.");
      }
      for (let position = 0; position < ids.length; position++) {
        await tx.agendaItem.update({ where: { id: ids[position] }, data: { position } });
      }
    });
    revalidatePath("/e", "layout");
    return ok("Redoslijed je sačuvan.");
  });
}

/* ======================= Lunch poll ======================= */
export async function createPoll(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const projectId = str(fd, "projectId");
    await db.lunchPoll.create({ data: { projectId, title: str(fd, "title") || "Izbor ručka", description: str(fd, "description") } });
    bump();
    return ok("Anketa je kreirana.");
  });
}

export async function updatePoll(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const title = z.string().trim().min(1, "Unesi naslov ankete.").max(160).parse(str(fd, "title"));
    await db.lunchPoll.update({
      where: { id: str(fd, "id") },
      data: { title, description: str(fd, "description"), isOpen: bool(fd, "isOpen"), allowChange: bool(fd, "allowChange"), showResultsWhileOpen: bool(fd, "showResultsWhileOpen") },
    });
    bump();
    return ok("Anketa je sačuvana.");
  });
}

export async function deletePoll(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const p = await db.lunchPoll.findUniqueOrThrow({ where: { id: str(fd, "id") }, include: { _count: { select: { votes: true } } } });
    if (p._count.votes > 0) requireConfirm(fd, "OBRIŠI");
    await db.lunchPoll.delete({ where: { id: p.id } });
    bump();
    return ok("Anketa je obrisana.");
  });
}

export async function clearVotes(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    requireConfirm(fd, "OBRIŠI");
    await db.lunchVote.deleteMany({ where: { pollId: str(fd, "id") } });
    bump();
    return ok("Glasovi su obrisani.");
  });
}

const OptionInput = z.object({ name: z.string().trim().min(1, "Unesi naziv opcije.").max(120), description: z.string().max(400), allergens: z.string().max(200) });

export async function createOption(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const pollId = str(fd, "pollId");
    const v = OptionInput.parse({ name: str(fd, "name"), description: str(fd, "description"), allergens: str(fd, "allergens") });
    const last = await db.lunchOption.aggregate({ where: { pollId }, _max: { position: true } });
    await db.lunchOption.create({ data: { pollId, position: (last._max.position ?? -1) + 1, ...v } });
    bump();
    return ok("Opcija je dodana.");
  });
}

export async function updateOption(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const v = OptionInput.parse({ name: str(fd, "name"), description: str(fd, "description"), allergens: str(fd, "allergens") });
    const id = str(fd, "id");
    const o = await db.lunchOption.findUniqueOrThrow({ where: { id }, include: { _count: { select: { votes: true } } } });
    // Preimenovanje bi tiho promijenilo značenje već datih glasova. Za novu opciju koristi "Dodaj opciju" i arhiviraj staru.
    if (o._count.votes > 0 && v.name !== o.name) throw fail("Opcija već ima glasove pa se naziv ne može mijenjati. Dodaj novu opciju i arhiviraj ovu.");
    await db.lunchOption.update({ where: { id }, data: v });
    bump();
    return ok("Opcija je sačuvana.");
  });
}

/** Opcija bez glasova se briše. Opcija s glasovima se arhivira (nestaje s glasanja, glasovi ostaju u rezultatima). */
export async function deleteOption(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const id = str(fd, "id");
    const o = await db.lunchOption.findUniqueOrThrow({ where: { id }, include: { _count: { select: { votes: true } } } });
    if (o._count.votes > 0) {
      await db.lunchOption.update({ where: { id }, data: { archivedAt: new Date() } });
      bump();
      return ok("Opcija ima glasove pa je arhivirana. Rezultati su sačuvani.");
    }
    await db.lunchOption.delete({ where: { id } });
    bump();
    return ok("Opcija je obrisana.");
  });
}

export async function restoreOption(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    await db.lunchOption.update({ where: { id: str(fd, "id") }, data: { archivedAt: null } });
    bump();
    return ok("Opcija je vraćena.");
  });
}

/* ======================= Feedback ======================= */
const parseOptions = (s: string) => [...new Set(s.split("\n").map((x) => x.trim()).filter(Boolean))].slice(0, 20);

export async function createForm(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const projectId = str(fd, "projectId");
    const mode = z.enum(["ANONYMOUS", "IDENTIFIED"]).parse(str(fd, "mode") || "ANONYMOUS");
    await db.feedbackForm.create({
      data: {
        projectId, mode, title: str(fd, "title") || "Evaluacija događaja",
        questions: { create: DEFAULT_QUESTIONS.map((q, position) => ({ position, type: q.type, label: q.label, required: q.required, options: q.options ?? [] })) },
      },
    });
    bump();
    return ok("Forma je kreirana s predloženim pitanjima.");
  });
}

export async function updateForm(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const id = str(fd, "id");
    const mode = z.enum(["ANONYMOUS", "IDENTIFIED"]).parse(str(fd, "mode"));
    const title = z.string().trim().min(1, "Unesi naslov forme.").max(160).parse(str(fd, "title"));
    await db.$transaction(async (tx) => {
      // FOR UPDATE: slanje odgovora drži FOR SHARE na formi, pa promjena moda čeka kraj slanja i broji odgovore nakon njega.
      await tx.$queryRaw`SELECT "id" FROM "FeedbackForm" WHERE "id" = ${id} FOR UPDATE`;
      const form = await tx.feedbackForm.findUniqueOrThrow({ where: { id } });
      if (mode !== form.mode) {
        const n = await tx.feedbackResponse.count({ where: { formId: id } });
        // Privatnost: način se ne mijenja nakon prvog odgovora, jer su učesnici odgovarali pod drugim uslovima.
        if (n > 0) throw fail("Način prikupljanja se ne može promijeniti jer već postoje odgovori. Kreiraj novu formu.");
      }
      await tx.feedbackForm.update({ where: { id }, data: { title, description: str(fd, "description"), isOpen: bool(fd, "isOpen"), oneResponsePerUser: bool(fd, "oneResponsePerUser"), mode } });
    });
    bump();
    return ok("Forma je sačuvana.");
  });
}

export async function deleteForm(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const f = await db.feedbackForm.findUniqueOrThrow({ where: { id: str(fd, "id") }, include: { _count: { select: { responses: true } } } });
    if (f._count.responses > 0) requireConfirm(fd, "OBRIŠI");
    await db.feedbackForm.delete({ where: { id: f.id } });
    bump();
    return ok("Forma je obrisana.");
  });
}

export async function deleteResponses(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    requireConfirm(fd, "OBRIŠI");
    await db.feedbackResponse.deleteMany({ where: { formId: str(fd, "id") } });
    bump();
    return ok("Odgovori su obrisani.");
  });
}

const QuestionInput = z.object({
  type: z.enum(["RATING", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "SHORT_TEXT", "LONG_TEXT"]),
  label: z.string().trim().min(1, "Unesi tekst pitanja.").max(200),
});

export async function createQuestion(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const formId = str(fd, "formId");
    const v = QuestionInput.parse({ type: str(fd, "type"), label: str(fd, "label") });
    const options = parseOptions(str(fd, "options"));
    const choice = v.type === "SINGLE_CHOICE" || v.type === "MULTIPLE_CHOICE";
    if (choice && options.length < 2) throw fail("Pitanje s izborom treba bar dvije opcije (jedna po retku).");
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"form:" + formId}))`;
      const last = await tx.feedbackQuestion.aggregate({ where: { formId }, _max: { position: true } });
      await tx.feedbackQuestion.create({ data: { formId, position: (last._max.position ?? -1) + 1, ...v, options: choice ? options : [], required: bool(fd, "required") } });
    });
    bump();
    return ok("Pitanje je dodano.");
  });
}

/**
 * Izmjena pitanja: tip se nikad ne mijenja. Tekst i opcije se mogu mijenjati i nakon odgovora, jer svaki odgovor čuva snimak
 * pitanja iz trenutka slanja (label, tip, opcije), pa historijski odgovori zadržavaju značenje.
 */
export async function updateQuestion(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const q = await db.feedbackQuestion.findUniqueOrThrow({ where: { id: str(fd, "id") } });
    if (q.archivedAt) throw fail("Arhivirano pitanje se ne uređuje. Prvo ga vrati.");
    const label = z.string().trim().min(1, "Unesi tekst pitanja.").max(200).parse(str(fd, "label"));
    const choice = q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CHOICE";
    const options = choice ? parseOptions(str(fd, "options")) : [];
    if (choice && options.length < 2) throw fail("Pitanje s izborom treba bar dvije opcije.");
    await db.feedbackQuestion.update({ where: { id: q.id }, data: { label, options, required: bool(fd, "required"), enabled: bool(fd, "enabled") } });
    bump();
    return ok("Pitanje je sačuvano.");
  });
}

/** Pitanje bez odgovora se briše. Pitanje s odgovorima se arhivira, pa statistika i izvozi ostaju kompletni. */
export async function deleteQuestion(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const id = str(fd, "id");
    const q = await db.feedbackQuestion.findUniqueOrThrow({ where: { id }, include: { _count: { select: { answers: true } } } });
    if (q._count.answers > 0) {
      await db.feedbackQuestion.update({ where: { id }, data: { archivedAt: new Date(), enabled: false } });
      bump();
      return ok("Pitanje ima odgovore pa je arhivirano. Statistika je sačuvana.");
    }
    await db.feedbackQuestion.delete({ where: { id } });
    bump();
    return ok("Pitanje je obrisano.");
  });
}

export async function restoreQuestion(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    await db.feedbackQuestion.update({ where: { id: str(fd, "id") }, data: { archivedAt: null } });
    bump();
    return ok("Pitanje je vraćeno (isključeno). Uključi ga da se prikaže učesnicima.");
  });
}

export async function moveQuestion(id: string, dir: "up" | "down"): Promise<Result> {
  return run(async () => {
    await guard();
    const q = await db.feedbackQuestion.findUniqueOrThrow({ where: { id } });
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"form:" + q.formId}))`;
      const list = await tx.feedbackQuestion.findMany({ where: { formId: q.formId, archivedAt: null }, orderBy: { position: "asc" } });
      const i = list.findIndex((x) => x.id === q.id);
      const j = i + (dir === "up" ? -1 : 1);
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      for (let position = 0; position < list.length; position++) {
        await tx.feedbackQuestion.update({ where: { id: list[position].id }, data: { position } });
      }
    });
    bump();
    return ok();
  });
}
