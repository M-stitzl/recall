-- Kartenformat v2: Kartentyp für den Mix und Begründung der Prüfungsrelevanz je Note.

alter table public.notes
  add column format text check (format in ('warum', 'cloze', 'anwendung', 'bild')),
  add column relevance text not null default '';

comment on column public.notes.format is
  'Kartentyp für den Mix: warum (Warum/Wie, freie Antwort), cloze (Formel/Begriff), anwendung (Mini-Rechenaufgabe), bild (verdecktes Element in einer Grafik)';
comment on column public.notes.relevance is
  'Ein Satz: warum die Karte laut Prüfungsprofil prüfungsrelevant ist';

-- Import übernimmt die neuen Felder (format, warum_relevant).
create or replace function public.import_notes_for(
  p_user uuid,
  p_notes jsonb,
  p_status text default 'draft',
  p_origin text default 'ai'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  n jsonb;
  v_course uuid;
  v_source uuid;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_rows integer;
begin
  if p_user is null then
    raise exception 'not_authenticated';
  end if;
  if jsonb_typeof(p_notes) <> 'array' then
    raise exception 'notes_must_be_array';
  end if;
  if p_status not in ('draft', 'approved') or p_origin not in ('ai', 'user') then
    raise exception 'invalid_import_options';
  end if;

  for n in select * from jsonb_array_elements(p_notes) loop
    insert into public.courses (user_id, name)
      values (p_user, btrim(n->>'course'))
      on conflict (user_id, name) do nothing;
    select id into v_course from public.courses
      where user_id = p_user and name = btrim(n->>'course');

    v_source := null;
    if coalesce(btrim(n->>'source'), '') <> '' then
      insert into public.sources (user_id, course_id, file_path, title, week, kind, content_hash)
        values (p_user, v_course, btrim(n->>'source'), n->>'source_title', n->>'week',
                coalesce(n->>'source_kind', 'folien'), n->>'source_hash')
        on conflict (user_id, course_id, file_path) do update
          set content_hash = coalesce(excluded.content_hash, public.sources.content_hash),
              week = coalesce(excluded.week, public.sources.week),
              title = coalesce(excluded.title, public.sources.title)
        returning id into v_source;
    end if;

    insert into public.notes (
      user_id, course_id, source_id, type, front, back, extra, source_ref, tags,
      priority, status, origin, ai_flags, format, relevance, created_at
    ) values (
      p_user, v_course, v_source, n->>'type', n->>'front', coalesce(n->>'back', ''),
      coalesce(n->>'extra', ''), coalesce(n->>'source_ref', ''),
      coalesce((select array_agg(t) from jsonb_array_elements_text(
        case when jsonb_typeof(n->'tags') = 'array' then n->'tags' else '[]'::jsonb end) as t), '{}'),
      coalesce(n->>'priority', 'mittel'), p_status, p_origin,
      coalesce((select array_agg(t) from jsonb_array_elements_text(
        case when jsonb_typeof(n->'check'->'issues') = 'array'
             then n->'check'->'issues' else '[]'::jsonb end) as t), '{}'),
      n->>'format',
      coalesce(n->>'warum_relevant', ''),
      -- clock_timestamp(): die Reihenfolge der Datei bleibt in der Freigabe-Queue erhalten.
      clock_timestamp()
    )
    on conflict (user_id, course_id, content_hash) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 1 then
      v_inserted := v_inserted + 1;
    else
      v_duplicates := v_duplicates + 1;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_duplicates);
end;
$$;

revoke all on function public.import_notes_for(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.import_notes_for(uuid, jsonb, text, text) to service_role;
