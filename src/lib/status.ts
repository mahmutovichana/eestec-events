export type Status = "DRAFT" | "PUBLISHED" | "COMPLETED" | "ARCHIVED";

// Dozvoljeni prelazi statusa događaja. Arhiva se može vratiti (restore) u Završen ili Nacrt.
export const TRANSITIONS: Record<Status, Status[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: ["COMPLETED", "DRAFT"],
};

export const canTransition = (from: Status, to: Status) => from === to || TRANSITIONS[from].includes(to);

/** Javno vidljiv događaj (nacrt vidi samo admin). */
export const isPublic = (s: Status) => s !== "DRAFT";
/** Glasanje je dozvoljeno samo dok je događaj objavljen. */
export const votingAllowed = (s: Status) => s === "PUBLISHED";
/** Feedback se prima dok je događaj objavljen ili završen. */
export const feedbackAllowed = (s: Status) => s === "PUBLISHED" || s === "COMPLETED";
