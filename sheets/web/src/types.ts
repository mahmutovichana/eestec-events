export type Me = { loggedIn: boolean; isAdmin: boolean; name?: string; email?: string };
export type EventRow = { id: string; slug: string; name: string; year: number; description: string; location: string; startDate: string; endDate: string; status: "DRAFT" | "PUBLISHED" | "COMPLETED" | "ARCHIVED"; agendas?: number; polls?: number; forms?: number };
export type Item = { id: string; startTime: string; endTime: string; title: string; description: string; speaker: string; location: string; notes: string; kind: "SESSION" | "TALK" | "BREAK" | "MEAL" | "END"; position: number; version: number };
export type Agenda = { id: string; title: string; date: string; position: number; items: Item[] };
export type Option = { id: string; name: string; description: string; allergens: string; archived: boolean; votes: number | null };
export type Poll = { id: string; title: string; description: string; status: "OPEN" | "CLOSED"; allowChange: boolean; resultsVisibility: string; open: boolean; myOptionId: string | null; resultsShown: boolean; total: number | null; options: Option[] };
export type Question = { id: string; label: string; type: "RATING" | "SINGLE" | "MULTI" | "SHORT" | "LONG"; options: string[]; required: boolean; archived: boolean; position: number };
export type Form = { id: string; title: string; description: string; mode: "ANONYMOUS" | "IDENTIFIED"; status: "OPEN" | "CLOSED"; open: boolean; submitted: boolean; responseCount?: number; questions: Question[] };
export type EventData = { event: EventRow; agendas: Agenda[]; polls: Poll[]; forms: Form[]; me: Me };
export type Stats = {
  event: EventRow;
  polls: { id: string; title: string; status: string; total: number; options: { id: string; name: string; archived: boolean; votes: number; voters: { name: string; email: string; at: string }[] }[] }[];
  forms: { id: string; title: string; mode: string; status: string; responseCount: number;
    stats: { questionId: string; label: string; type: string; archived: boolean; count: number; average?: number | null; distribution?: number[]; counts?: Record<string, number>; texts?: string[] }[];
    responses: { id: string; at: string; name?: string; email?: string; answers: { label: string; value: string | string[] }[] }[] }[];
};
