-- Bildkarten (Image Occlusion): ausgewählte Folienbilder im privaten Speicher.
-- Regel: nur Folien, die in einer Bildkarte vorkommen; Zugriff nur für den Eigentümer.

-- Privater Speicherbereich. Dateien liegen unter <user_id>/<sha256>.png
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slides', 'slides', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "slides: read own" on storage.objects for select to authenticated
  using (bucket_id = 'slides' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "slides: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'slides' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "slides: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'slides' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Bild und verdeckter Bereich je Note (Koordinaten relativ zur Bildgröße, 0..1)
alter table public.notes
  add column image_path text,
  add column occlusion jsonb,
  add constraint notes_occlusion_shape check (
    occlusion is null or (
      jsonb_typeof(occlusion) = 'object'
      and (occlusion->>'x')::numeric between 0 and 1
      and (occlusion->>'y')::numeric between 0 and 1
      and (occlusion->>'w')::numeric > 0 and (occlusion->>'w')::numeric <= 1
      and (occlusion->>'h')::numeric > 0 and (occlusion->>'h')::numeric <= 1
    )
  ),
  add constraint notes_image_card check (
    format is distinct from 'bild' or (image_path is not null and occlusion is not null)
  );

-- Lernsicht um die Bilddaten erweitern (neue Spalten nur am Ende)
create or replace view public.study_cards
with (security_invoker = true)
as
select
  c.id, c.note_id, c.ordinal, c.due, c.stability, c.difficulty, c.scheduled_days,
  c.learning_step, c.reps, c.lapses, c.state, c.last_review, c.created_at,
  n.type, n.front, n.back, n.extra, n.source_ref, n.tags, n.priority as note_priority,
  n.course_id, co.name as course_name, co.exam_date, co.priority as course_priority,
  s.file_path as source_file,
  n.format, n.image_path, n.occlusion
from public.cards c
join public.notes n on n.id = c.note_id and n.status = 'approved'
join public.courses co on co.id = n.course_id
left join public.sources s on s.id = n.source_id;

-- Import übernimmt Bildpfad und Abdeckung
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
    if n->>'format' = 'bild' and coalesce(n->>'image_path', '') = '' then
      raise exception 'image_not_uploaded: Bildkarte ohne hochgeladenes Bild (%)', left(n->>'front', 60);
    end if;
    -- Bildpfade müssen im Ordner des Nutzers liegen.
    if coalesce(n->>'image_path', '') <> '' and split_part(n->>'image_path', '/', 1) <> p_user::text then
      raise exception 'image_path_foreign_folder';
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
      priority, status, origin, ai_flags, format, relevance, image_path, occlusion, created_at
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
