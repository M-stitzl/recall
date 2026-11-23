import { getSupabase } from "./supabase";
import { endOfLocalDay, startOfLocalDay } from "./queue";
import {
  DEFAULT_SETTINGS,
  type Course,
  type CourseOverview,
  type Note,
  type NoteWithContext,
  type Settings,
  type StatsOverview,
  type StudyCard,
} from "./types";

/** Datenzugriffe der App. Alle Abfragen laufen mit der Session des Nutzers (RLS). */

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

export async function fetchSettings(): Promise<Settings> {
  const data = unwrap(
    await getSupabase()
      .from("settings")
      .select("desired_retention, fsrs_params, new_per_day, max_reviews_per_day")
      .maybeSingle(),
  ) as Settings | null;
  return data ?? DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const supabase = getSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error("Nicht angemeldet");
  unwrap(
    await supabase
      .from("settings")
      .upsert({ user_id: auth.user.id, ...settings, updated_at: new Date().toISOString() })
      .select("user_id"),
  );
}

export async function fetchCourseOverview(now = new Date()): Promise<CourseOverview[]> {
  return unwrap(
    await getSupabase().rpc("course_overview", {
      p_due_before: endOfLocalDay(now).toISOString(),
    }),
  ) as CourseOverview[];
}

export async function fetchCourses(): Promise<Course[]> {
  return unwrap(
    await getSupabase()
      .from("courses")
      .select("id, name, semester, exam_date, exam_type, priority")
      .order("name"),
  ) as Course[];
}

export type CourseInput = Omit<Course, "id">;

export async function saveCourse(input: CourseInput, id?: string): Promise<void> {
  const table = getSupabase().from("courses");
  unwrap(
    id ? await table.update(input).eq("id", id).select("id") : await table.insert(input).select("id"),
  );
}

export async function deleteCourse(id: string): Promise<void> {
  unwrap(await getSupabase().from("courses").delete().eq("id", id).select("id"));
}

const NOTE_COLUMNS =
  "id, course_id, source_id, type, front, back, extra, source_ref, tags, priority, status, origin, reject_reason, ai_flags, format, relevance, image_path, occlusion, source_view, created_at";

export async function fetchDrafts(limit = 200): Promise<NoteWithContext[]> {
  return unwrap(
    await getSupabase()
      .from("notes")
      .select(`${NOTE_COLUMNS}, courses(name), sources(file_path)`)
      .eq("status", "draft")
      .order("created_at")
      .order("id")
      .limit(limit),
  ) as unknown as NoteWithContext[];
}

export async function countDrafts(): Promise<number> {
  const { count, error } = await getSupabase()
    .from("notes")
    .select("id", { count: "exact", head: true })
    .eq("status", "draft");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function fetchCourseNotes(courseId: string): Promise<Note[]> {
  return unwrap(
    await getSupabase()
      .from("notes")
      .select(NOTE_COLUMNS)
      .eq("course_id", courseId)
      .order("created_at", { ascending: false })
      .limit(1000),
  ) as Note[];
}

export type NoteContent = Pick<
  Note,
  "type" | "front" | "back" | "extra" | "source_ref" | "tags" | "priority" | "relevance"
>;

export async function updateNote(
  id: string,
  patch: Partial<NoteContent> & Partial<Pick<Note, "status" | "reject_reason">>,
): Promise<void> {
  unwrap(await getSupabase().from("notes").update(patch).eq("id", id).select("id"));
}

/** Nimmt alle offenen Entwürfe auf einmal an. Gibt zurück, wie viele es waren. */
export async function approveAllDrafts(): Promise<number> {
  const rows = unwrap(
    await getSupabase().from("notes").update({ status: "approved" }).eq("status", "draft").select("id"),
  ) as { id: string }[];
  return rows.length;
}

/** Eigene Karte anlegen – ist sofort freigegeben und erzeugt damit direkt Karten. */
export async function createNote(courseId: string, content: NoteContent): Promise<void> {
  unwrap(
    await getSupabase()
      .from("notes")
      .insert({ ...content, course_id: courseId, origin: "user", status: "approved" })
      .select("id"),
  );
}

export async function deleteNote(id: string): Promise<void> {
  unwrap(await getSupabase().from("notes").delete().eq("id", id).select("id"));
}

export async function importNotes(notes: unknown[]): Promise<{ inserted: number; duplicates: number }> {
  return unwrap(await getSupabase().rpc("import_notes", { p_notes: notes })) as {
    inserted: number;
    duplicates: number;
  };
}

export type StudyData = {
  cards: StudyCard[];
  settings: Settings;
  newDoneToday: number;
  reviewsDoneToday: number;
};

async function countLogsToday(now: Date, newCards: boolean): Promise<number> {
  let query = getSupabase()
    .from("review_logs")
    .select("id", { count: "exact", head: true })
    .gte("reviewed_at", startOfLocalDay(now).toISOString());
  query = newCards ? query.eq("state", 0) : query.eq("state", 2);
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Lädt alle Kandidaten für die heutige Session (optional nur ein Kurs). */
export async function fetchStudyData(courseId: string | null, now = new Date()): Promise<StudyData> {
  const supabase = getSupabase();
  const settings = await fetchSettings();
  const dayEnd = endOfLocalDay(now).toISOString();

  let dueQuery = supabase
    .from("study_cards")
    .select("*")
    .neq("state", 0)
    .lt("due", dayEnd)
    .order("due")
    .limit(1000);
  let newQuery = supabase
    .from("study_cards")
    .select("*")
    .eq("state", 0)
    .order("exam_date", { nullsFirst: false })
    .order("course_priority", { ascending: false })
    // „hoch“ < „mittel“ < „niedrig“ sortiert alphabetisch bereits richtig.
    .order("note_priority")
    .order("created_at")
    .limit(Math.max(1, Math.min(1000, settings.new_per_day * 3)));
  if (courseId) {
    dueQuery = dueQuery.eq("course_id", courseId);
    newQuery = newQuery.eq("course_id", courseId);
  }

  const [due, fresh, newDoneToday, reviewsDoneToday] = await Promise.all([
    dueQuery,
    newQuery,
    countLogsToday(now, true),
    countLogsToday(now, false),
  ]);

  return {
    cards: [...(unwrap(due) as StudyCard[]), ...(unwrap(fresh) as StudyCard[])],
    settings,
    newDoneToday,
    reviewsDoneToday,
  };
}

export async function fetchStats(): Promise<StatsOverview> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin";
  return unwrap(await getSupabase().rpc("stats_overview", { p_tz: timezone })) as StatsOverview;
}

const EXPORT_TABLES = ["courses", "sources", "notes", "cards", "review_logs", "settings"] as const;

/** Vollständiger JSON-Export aller eigenen Daten (seitenweise, ohne Zeilenlimit). */
export async function exportAll(): Promise<Record<string, unknown[]>> {
  const supabase = getSupabase();
  const dump: Record<string, unknown[]> = {};
  const pageSize = 1000;
  for (const table of EXPORT_TABLES) {
    const rows: unknown[] = [];
    const orderColumn = table === "settings" ? "user_id" : "id";
    for (let from = 0; ; from += pageSize) {
      const page = unwrap(
        await supabase
          .from(table)
          .select("*")
          .order(orderColumn)
          .range(from, from + pageSize - 1),
      ) as unknown[];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    dump[table] = rows;
  }
  return dump;
}
