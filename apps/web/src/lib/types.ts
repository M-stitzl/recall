export type NoteType = "basic" | "cloze";
export type NoteStatus = "draft" | "approved" | "rejected" | "suspended";
export type Priority = "hoch" | "mittel" | "niedrig";
export type NoteFormat = "warum" | "cloze" | "anwendung" | "bild";

/** Verdeckter Bereich einer Bildkarte, relativ zur Bildgröße (0..1). */
export type Occlusion = { x: number; y: number; w: number; h: number };

/** Zitierte Folien (ganze Folie als Bild) oder Textabschnitte im privaten Speicher. */
export type SourceItem = { kind: "image" | "text"; label: string; path: string };
export type SourceView = { items: SourceItem[] };

/** 0 = neu, 1 = Lernen, 2 = Wiederholung, 3 = Neu lernen (wie ts-fsrs State) */
export type CardState = 0 | 1 | 2 | 3;
export type Grade = 1 | 2 | 3 | 4;

export type Course = {
  id: string;
  name: string;
  semester: string | null;
  exam_date: string | null;
  exam_type: "offen" | "geschlossen" | null;
  priority: number;
};

export type CourseOverview = Course & {
  /** Heute fällig: laufende Lernschritte und Wiederholungen zusammen. */
  due_count: number;
  /** Davon in Lernschritten (Zustand Lernen / Neu lernen). */
  learning_count: number;
  new_count: number;
  card_count: number;
  draft_count: number;
  note_count: number;
};

export type Note = {
  id: string;
  course_id: string;
  source_id: string | null;
  type: NoteType;
  front: string;
  back: string;
  extra: string;
  source_ref: string;
  tags: string[];
  priority: Priority;
  status: NoteStatus;
  origin: "ai" | "user";
  reject_reason: string | null;
  ai_flags: string[];
  /** Kartentyp für den Mix (ältere Notes: null). */
  format: NoteFormat | null;
  /** Ein Satz: warum die Karte prüfungsrelevant ist. */
  relevance: string;
  /** Bildkarte: Pfad im privaten Speicher und verdeckter Bereich. */
  image_path: string | null;
  occlusion: Occlusion | null;
  source_view: SourceView | null;
  created_at: string;
};

export type NoteWithContext = Note & {
  courses: { name: string } | null;
  sources: { file_path: string } | null;
};

/** Zeile der Sicht `study_cards`: Lernzustand plus Inhalt der Note. */
export type StudyCard = {
  id: string;
  note_id: string;
  ordinal: number;
  due: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_step: number;
  reps: number;
  lapses: number;
  state: CardState;
  last_review: string | null;
  created_at: string;
  type: NoteType;
  front: string;
  back: string;
  extra: string;
  source_ref: string;
  tags: string[];
  note_priority: Priority;
  course_id: string;
  course_name: string;
  exam_date: string | null;
  course_priority: number;
  source_file: string | null;
  format: NoteFormat | null;
  image_path: string | null;
  occlusion: Occlusion | null;
  source_view: SourceView | null;
};

export type Settings = {
  desired_retention: number;
  fsrs_params: number[] | null;
  new_per_day: number;
  max_reviews_per_day: number;
};

export const DEFAULT_SETTINGS: Settings = {
  desired_retention: 0.9,
  fsrs_params: null,
  new_per_day: 20,
  max_reviews_per_day: 200,
};

export type StatsOverview = {
  forecast: { offset: number; due: number }[];
  history: { day: string; reviews: number; duration_ms: number }[];
  retention: { total: number; passed: number };
  states: Record<string, number>;
  decisions: { approved: number; rejected: number; draft: number };
  total_reviews: number;
};
