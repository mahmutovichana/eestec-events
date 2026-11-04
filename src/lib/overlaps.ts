export type TimedItem = { id: string; startTime: string; endTime: string; title: string };

const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Parovi stavki čiji se rasponi preklapaju. Nulte dužine (npr. "Kraj dana") i stavke koje se samo dodiruju
 * (kraj jedne = početak druge) se ne računaju. Preklapanje je upozorenje, ne greška: paralelni tokovi su legitimni.
 */
export function findOverlaps(items: TimedItem[]): [TimedItem, TimedItem][] {
  const out: [TimedItem, TimedItem][] = [];
  const valid = items.filter((i) => /^\d\d:\d\d$/.test(i.startTime) && /^\d\d:\d\d$/.test(i.endTime) && toMin(i.endTime) > toMin(i.startTime));
  for (let a = 0; a < valid.length; a++) {
    for (let b = a + 1; b < valid.length; b++) {
      if (toMin(valid[a].startTime) < toMin(valid[b].endTime) && toMin(valid[b].startTime) < toMin(valid[a].endTime)) out.push([valid[a], valid[b]]);
    }
  }
  return out;
}
