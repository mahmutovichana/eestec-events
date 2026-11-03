import { PrismaClient } from "../src/generated/prisma";

const db = new PrismaClient();

type It = [string, string, string, ("SESSION" | "TALK" | "BREAK" | "MEAL" | "END")?];

const SAT: It[] = [
  ["10:00", "10:05", "Uvod"],
  ["10:05", "10:25", "O EESTEC-u i INT-u"],
  ["10:25", "10:40", "Maskota i pjesma"],
  ["10:40", "10:55", "Reflection group"],
  ["10:55", "11:00", "Pauza", "BREAK"],
  ["11:00", "12:00", "Komunikacija i aktivno slušanje – sesija 1", "SESSION"],
  ["12:00", "12:05", "Pauza", "BREAK"],
  ["12:05", "13:05", "Time i stress management – sesija", "SESSION"],
  ["13:05", "14:35", "Ručak", "MEAL"],
  ["14:35", "15:50", "Kreiranje zajedničkog vremenskog plana", "SESSION"],
  ["15:50", "17:20", "Feedback zajedničkog vremenskog plana", "SESSION"],
  ["17:20", "17:25", "Pauza", "BREAK"],
  ["17:25", "18:25", "IT sesija", "SESSION"],
  ["18:25", "18:25", "Kraj prvog dana", "END"],
];
const SUN: It[] = [
  ["10:00", "10:10", "Uvod"],
  ["10:10", "10:55", "Kreiranje pojedinačnih vremenskih planova", "SESSION"],
  ["10:55", "11:55", "Feedback pojedinačnih vremenskih planova", "SESSION"],
  ["11:55", "12:05", "Pauza", "BREAK"],
  ["12:05", "12:50", "Feedback sesija", "SESSION"],
  ["12:50", "13:20", "Budžet sesija", "SESSION"],
  ["13:20", "13:30", "Pauza", "BREAK"],
  ["13:30", "14:30", "Delegiranje i odnos sa članovima – sesija", "SESSION"],
  ["14:30", "14:30", "Ručak i kraj HOBOM-a", "END"],
];

const mk = (list: It[]) =>
  list.map(([startTime, endTime, title, kind], position) => ({ position, startTime, endTime, title, kind: kind ?? "SESSION" }));

async function main() {
  if (await db.project.findUnique({ where: { slug: "hobom" } })) {
    console.log("Seed preskočen: projekat 'hobom' već postoji.");
    return;
  }
  await db.project.create({
    data: {
      slug: "hobom",
      name: "HOBOM",
      description: "HandOver Board Meeting",
      status: "PUBLISHED",
      location: "Sarajevo",
      agendas: {
        create: [
          { slug: "subota", title: "Subota", position: 0, items: { create: mk(SAT) } },
          { slug: "nedjelja", title: "Nedjelja", position: 1, items: { create: mk(SUN) } },
        ],
      },
      polls: {
        create: [
          {
            title: "Izbor ručka",
            description: "Odaberi jednu opciju za ručak.",
            options: {
              create: [
                { position: 0, name: "Piletina sa povrćem", description: "Pečena piletina, povrće na žaru", allergens: "" },
                { position: 1, name: "Vegetarijanska pasta", description: "Tjestenina, povrće, sir", allergens: "gluten, mlijeko" },
                { position: 2, name: "Burek", description: "Sa mesom ili sirom", allergens: "gluten, jaja, mlijeko" },
              ],
            },
          },
        ],
      },
      forms: {
        create: [
          {
            title: "Evaluacija HOBOM-a",
            questions: {
              create: [
                { position: 0, type: "RATING", label: "Ukupni doživljaj događaja", required: true },
                { position: 1, type: "RATING", label: "Kvalitet sesija" },
                { position: 2, type: "RATING", label: "Relevantnost tema" },
                { position: 3, type: "RATING", label: "Organizacija" },
                { position: 4, type: "RATING", label: "Trajanje" },
                { position: 5, type: "RATING", label: "Komunikacija" },
                { position: 6, type: "LONG_TEXT", label: "Šta ti je bilo najbolje na događaju?" },
                { position: 7, type: "LONG_TEXT", label: "Šta nedostaje ili šta bi trebalo poboljšati?" },
                { position: 8, type: "LONG_TEXT", label: "Prijedlozi za buduće događaje" },
              ],
            },
          },
        ],
      },
    },
  });
  console.log("Seed gotov: projekat 'hobom'.");
}

main().finally(() => db.$disconnect());
