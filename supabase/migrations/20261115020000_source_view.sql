-- Quellenansicht je Note: die zitierten Folien (ganze Folie als Bild) oder der zitierte
-- Textabschnitt (z. B. Lernpfad-Kapitel), abgelegt im privaten Speicher „slides“.
-- Format: {"items": [{"kind": "image"|"text", "label": "Folie 18", "path": "<user_id>/<sha256>.png"}]}

alter table public.notes
  add column source_view jsonb,
  add constraint notes_source_view_shape check (
    source_view is null or (
      jsonb_typeof(source_view) = 'object' and jsonb_typeof(source_view->'items') = 'array'
    )
  );

-- Lernsicht: Quellenansicht ergänzen (neue Spalte nur am Ende)
create or replace view public.study_cards
with (security_invoker = true)
as
select
  c.id, c.note_id, c.ordinal, c.due, c.stability, c.difficulty, c.scheduled_days,
  c.learning_step, c.reps, c.lapses, c.state, c.last_review, c.created_at,
  n.type, n.front, n.back, n.extra, n.source_ref, n.tags, n.priority as note_priority,
  n.course_id, co.name as course_name, co.exam_date, co.priority as course_priority,
  s.file_path as source_file,
  n.format, n.image_path, n.occlusion,
  n.source_view
from public.cards c
join public.notes n on n.id = c.note_id and n.status = 'approved'
join public.courses co on co.id = n.course_id
left join public.sources s on s.id = n.source_id;

-- Prüft, dass alle Dateien einer Quellenansicht im Ordner des Nutzers liegen.
create function public.source_view_in_folder(p_view jsonb, p_user uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_view is null or not exists (
    select 1 from jsonb_array_elements(coalesce(p_view->'items', '[]'::jsonb)) as item
    where coalesce(item->>'path', '') = '' or split_part(item->>'path', '/', 1) <> p_user::text
  );
$$;

-- Import übernimmt die Quellenansicht
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
  v_view jsonb;
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
    if n->>'format' = 'bild' and coalesce(n->>'image_path', '') = '' then
      raise exception 'image_not_uploaded: Bildkarte ohne hochgeladenes Bild (%)', left(n->>'front', 60);
    end if;
    if coalesce(n->>'image_path', '') <> '' and split_part(n->>'image_path', '/', 1) <> p_user::text then
      raise exception 'image_path_foreign_folder';
    end if;
    v_view := case when jsonb_typeof(n->'source_view') = 'object' then n->'source_view' end;
    if not public.source_view_in_folder(v_view, p_user) then
      raise exception 'source_view_not_uploaded_or_foreign: %', left(n->>'front', 60);
    end if;

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
      priority, status, origin, ai_flags, format, relevance, image_path, occlusion,
      source_view, created_at
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
      nullif(n->>'image_path', ''),
      case when jsonb_typeof(n->'occlusion') = 'object' then n->'occlusion' end,
      v_view,
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

-- Quellenansicht (und korrigierte Quellenangabe) bereits importierter Notes nachtragen,
-- per Inhalts-Hash; Status und Lernstand bleiben unverändert.
create function public.attach_source_views_for(p_user uuid, p_notes jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_updated integer := 0;
  v_rows integer;
  n jsonb;
begin
  for n in select * from jsonb_array_elements(p_notes) loop
    if jsonb_typeof(n->'source_view') <> 'object' or not public.source_view_in_folder(n->'source_view', p_user) then
      raise exception 'source_view_not_uploaded_or_foreign: %', left(n->>'front', 60);
    end if;
    update public.notes note
      set source_view = n->'source_view',
          source_ref = coalesce(nullif(btrim(n->>'source_ref'), ''), note.source_ref)
      from public.courses c
      where c.id = note.course_id and c.user_id = p_user and c.name = btrim(n->>'course')
        and note.user_id = p_user
        and note.content_hash = md5((n->>'type') || chr(31) || lower(btrim(n->>'front')) || chr(31)
                                    || lower(btrim(coalesce(n->>'back', ''))));
    get diagnostics v_rows = row_count;
    v_updated := v_updated + v_rows;
  end loop;
  return v_updated;
end;
$$;

revoke all on function public.attach_source_views_for(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.attach_source_views_for(uuid, jsonb) to service_role;
revoke all on function public.source_view_in_folder(jsonb, uuid) from public, anon;
