"use server";
import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertAdmin } from "@/lib/session";
import { rateLimit, slugify } from "@/lib/util";

/*
 * PRAVILO: svaka eksportovana akcija u ovom fajlu mora počinjati sa `await guard()`.
 * guard() (prva naredba u run()) poziva assertAdmin() (verifikovana sesija + uloga ADMIN iz baze) i ograničava brzinu.
 * Test test/actions-guard.test.mjs provjerava ovo pravilo statički.
 */

export type Result = { ok: true; message?: string } | { ok: false; error: string };
const ok = (message?: string): Result => ({ ok: true, message });

async function guard() {
  const admin = await assertAdmin();
  if (!rateLimit("act:" + admin.id, 240, 60_000)) throw new Error("RATE_LIMITED");
  return admin;
}

/** Pretvara greške u poruke za korisnika. Redirect i not-found prolaze dalje. */
async function run(fn: () => Promise<Result | void>): Promise<Result> {
  try {
    return (await fn()) ?? ok();
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Neispravan unos." };
    const m = e instanceof Error ? e.message : "";
    if (m === "UNAUTHENTICATED") return { ok: false, error: "Sesija je istekla. Prijavi se ponovo." };
    if (m === "FORBIDDEN") return { ok: false, error: "Nemaš dozvolu za ovu radnju." };
    if (m === "RATE_LIMITED") return { ok: false, error: "Previše radnji u kratkom roku. Pokušaj za minutu." };
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2025") return { ok: false, error: "Stavka više ne postoji." };
    if (m.startsWith("USER:")) return { ok: false, error: m.slice(5) };
    console.error(e);
    return { ok: false, error: "Došlo je do greške. Pokušaj ponovo." };
  }
}
const fail = (m: string) => new Error("USER:" + m);

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const optDate = (s: string) => (s ? new Date(s + "T12:00:00Z") : null);

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
  name: z.string().min(2, "Naziv mora imati bar 2 znaka.").max(120),
  description: z.string().max(600),
  location: z.string().max(160),
});

async function uniqueSlug(base: string, exceptId?: string) {
  let slug = slugify(base);
  const clash = await db.project.findFirst({ where: { slug, NOT: exceptId ? { id: exceptId } : undefined } });
  if (clash) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
  return slug;
}

export async function createEvent(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const v = EventInput.parse({ name: str(fd, "name"), description: str(fd, "description"), location: str(fd, "location") });
    const slug = await uniqueSlug(str(fd, "slug") || v.name);
    const p = await db.project.create({
      data: { ...v, slug, startsAt: optDate(str(fd, "startsAt")), endsAt: optDate(str(fd, "endsAt")) },
    });
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
    if (await db.project.findFirst({ where: { slug, NOT: { id } } })) throw fail("Taj link je već zauzet.");
    const startsAt = optDate(str(fd, "startsAt"));
    const endsAt = optDate(str(fd, "endsAt"));
    if (startsAt && endsAt && endsAt < startsAt) throw fail("Datum završetka ne može biti prije početka.");
    await db.project.update({ where: { id }, data: { ...v, slug, startsAt, endsAt } });
    bump();
    return ok("Događaj je sačuvan.");
  });
}

export async function setEventStatus(id: string, status: string): Promise<Result> {
  return run(async () => {
    await guard();
    const s = z.enum(["DRAFT", "PUBLISHED", "COMPLETED", "ARCHIVED"]).parse(status);
    await db.project.update({ where: { id }, data: { status: s } });
    bump();
    return ok("Status je promijenjen.");
  });
}

export async function archiveEvent(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    await db.project.update({ where: { id: str(fd, "id") }, data: { status: "ARCHIVED" } });
    bump();
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
        polls: { include: { options: { orderBy: { position: "asc" } } } },
        forms: { include: { questions: { orderBy: { position: "asc" } } } },
      },
    });
    const name = str(fd, "name") || `${src.name} (kopija)`;
    const slug = await uniqueSlug(name);
    // Kopiraju se struktura i postavke. Glasovi, odgovori i datumi se ne kopiraju.
    const copy = await db.project.create({
      data: {
        name, slug, description: src.description, location: src.location, status: "DRAFT",
        agendas: {
          create: src.agendas.map((a) => ({
            slug: a.slug, title: a.title, dateLabel: "", position: a.position,
            items: { create: a.items.map(({ id: _i, agendaId: _a, ...it }) => it) },
          })),
        },
        polls: {
          create: src.polls.map((p) => ({
            title: p.title, description: p.description, isOpen: true, allowChange: p.allowChange, showResultsWhileOpen: p.showResultsWhileOpen,
            options: { create: p.options.map(({ id: _i, pollId: _p, ...o }) => o) },
          })),
        },
        forms: {
          create: src.forms.map((f) => ({
            title: f.title, description: f.description, isOpen: true, mode: f.mode, oneResponsePerUser: f.oneResponsePerUser,
            questions: { create: f.questions.map(({ id: _i, formId: _f, ...q }) => q) },
          })),
        },
      },
    });
    bump();
    redirect(`/admin/events/${copy.id}`);
  });
}

export async function deleteEvent(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    await db.project.delete({ where: { id: str(fd, "id") } });
    bump();
    redirect("/admin/events");
  });
}

/* ======================= Agende ======================= */
export async function createAgenda(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const projectId = str(fd, "projectId");
    const title = z.string().min(1, "Unesi naslov agende.").max(120).parse(str(fd, "title"));
    let slug = slugify(title);
    if (await db.agenda.findUnique({ where: { projectId_slug: { projectId, slug } } })) slug += "-" + Math.random().toString(36).slice(2, 5);
    const position = await db.agenda.count({ where: { projectId } });
    const a = await db.agenda.create({ data: { projectId, title, slug, dateLabel: str(fd, "dateLabel"), position } });
    bump();
    redirect(`/admin/events/${projectId}/agendas/${a.id}`);
  });
}

export async function updateAgenda(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const title = z.string().min(1, "Unesi naslov agende.").max(120).parse(str(fd, "title"));
    await db.agenda.update({ where: { id: str(fd, "id") }, data: { title, dateLabel: str(fd, "dateLabel") } });
    bump();
    return ok("Agenda je sačuvana.");
  });
}

export async function deleteAgenda(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const a = await db.agenda.delete({ where: { id: str(fd, "id") } });
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
    const position = await db.agendaItem.count({ where: { agendaId } });
    await db.agendaItem.create({ data: { agendaId, position, ...v } });
    bump();
    return ok("Stavka je dodana.");
  });
}

/** Poziva se iz autosave-a kartice. */
export async function saveItem(id: string, fields: ItemFields): Promise<Result> {
  return run(async () => {
    await guard();
    await db.agendaItem.update({ where: { id }, data: ItemInput.parse(fields) });
    revalidatePath("/e", "layout");
    return ok();
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
    await db.$transaction(ids.map((id, position) => db.agendaItem.updateMany({ where: { id, agendaId }, data: { position } })));
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
    const title = z.string().min(1, "Unesi naslov ankete.").max(160).parse(str(fd, "title"));
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
    await db.lunchPoll.delete({ where: { id: str(fd, "id") } });
    bump();
    return ok("Anketa je obrisana.");
  });
}

export async function clearVotes(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
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
    const position = await db.lunchOption.count({ where: { pollId } });
    await db.lunchOption.create({ data: { pollId, position, ...v } });
    bump();
    return ok("Opcija je dodana.");
  });
}

export async function updateOption(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const v = OptionInput.parse({ name: str(fd, "name"), description: str(fd, "description"), allergens: str(fd, "allergens") });
    await db.lunchOption.update({ where: { id: str(fd, "id") }, data: v });
    bump();
    return ok("Opcija je sačuvana.");
  });
}

export async function deleteOption(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    await db.lunchOption.delete({ where: { id: str(fd, "id") } });
    bump();
    return ok("Opcija je obrisana.");
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
    const form = await db.feedbackForm.findUniqueOrThrow({ where: { id }, include: { _count: { select: { responses: true } } } });
    // Privatnost: način prikupljanja se ne mijenja nakon što postoje odgovori, jer su učesnici odgovarali pod drugim uslovima.
    if (mode !== form.mode && form._count.responses > 0) {
      throw fail("Način prikupljanja se ne može promijeniti jer već postoje odgovori. Obriši odgovore ili kreiraj novu formu.");
    }
    const title = z.string().min(1, "Unesi naslov forme.").max(160).parse(str(fd, "title"));
    await db.feedbackForm.update({
      where: { id },
      data: { title, description: str(fd, "description"), isOpen: bool(fd, "isOpen"), oneResponsePerUser: bool(fd, "oneResponsePerUser"), mode },
    });
    bump();
    return ok("Forma je sačuvana.");
  });
}

export async function deleteForm(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    await db.feedbackForm.delete({ where: { id: str(fd, "id") } });
    bump();
    return ok("Forma je obrisana.");
  });
}

export async function deleteResponses(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
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
    if ((v.type === "SINGLE_CHOICE" || v.type === "MULTIPLE_CHOICE") && options.length < 2) throw fail("Pitanje s izborom treba bar dvije opcije (jedna po retku).");
    const position = await db.feedbackQuestion.count({ where: { formId } });
    await db.feedbackQuestion.create({ data: { formId, position, ...v, options: v.type.endsWith("CHOICE") ? options : [], required: bool(fd, "required") } });
    bump();
    return ok("Pitanje je dodano.");
  });
}

export async function updateQuestion(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    const q = await db.feedbackQuestion.findUniqueOrThrow({ where: { id: str(fd, "id") } });
    const label = z.string().trim().min(1, "Unesi tekst pitanja.").max(200).parse(str(fd, "label"));
    const choice = q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CHOICE";
    const options = choice ? parseOptions(str(fd, "options")) : [];
    if (choice && options.length < 2) throw fail("Pitanje s izborom treba bar dvije opcije.");
    await db.feedbackQuestion.update({ where: { id: q.id }, data: { label, options, required: bool(fd, "required"), enabled: bool(fd, "enabled") } });
    bump();
    return ok("Pitanje je sačuvano.");
  });
}

export async function deleteQuestion(fd: FormData): Promise<Result> {
  return run(async () => {
    await guard();
    await db.feedbackQuestion.delete({ where: { id: str(fd, "id") } });
    bump();
    return ok("Pitanje je obrisano.");
  });
}

export async function moveQuestion(id: string, dir: "up" | "down"): Promise<Result> {
  return run(async () => {
    await guard();
    const q = await db.feedbackQuestion.findUniqueOrThrow({ where: { id } });
    const list = await db.feedbackQuestion.findMany({ where: { formId: q.formId }, orderBy: { position: "asc" } });
    const i = list.findIndex((x) => x.id === q.id);
    const j = i + (dir === "up" ? -1 : 1);
    if (j < 0 || j >= list.length) return ok();
    [list[i], list[j]] = [list[j], list[i]];
    await db.$transaction(list.map((x, position) => db.feedbackQuestion.update({ where: { id: x.id }, data: { position } })));
    bump();
    return ok();
  });
}
