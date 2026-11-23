-- Recall: Grundschema (Single-User, per RLS geschützt)
-- Alle Zeitstempel sind timestamptz (UTC in der Datenbank).

-- ---------------------------------------------------------------------------
-- Zugangsbeschränkung: nur freigeschaltete E-Mail-Adressen dürfen sich anmelden
-- ---------------------------------------------------------------------------
create table public.allowed_emails (
  email text primary key,
  created_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
-- Bewusst keine Policy: nur über SQL-Editor / service_role pflegbar.

create function public.enforce_allowed_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.allowed_emails a where lower(a.email) = lower(new.email)
  ) then
    raise exception 'signup_not_allowed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger enforce_allowed_email
  before insert on auth.users
  for each row execute function public.enforce_allowed_email();

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  semester text,
  exam_date date,
  exam_type text check (exam_type in ('offen', 'geschlossen')),
  priority smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  file_path text not null,
  title text,
  week text,
  kind text not null default 'folien'
    check (kind in ('folien', 'uebung', 'altklausur', 'sonstiges')),
  content_hash text,
  created_at timestamptz not null default now(),
  unique (user_id, course_id, file_path)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  source_id uuid references public.sources (id) on delete set null,
  type text not null check (type in ('basic', 'cloze')),
  front text not null check (length(btrim(front)) > 0),
  back text not null default '',
  extra text not null default '',
  source_ref text not null default '',
  tags text[] not null default '{}',
  priority text not null default 'mittel' check (priority in ('hoch', 'mittel', 'niedrig')),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'rejected', 'suspended')),
  origin text not null default 'ai' check (origin in ('ai', 'user')),
  reject_reason text,
  ai_flags text[] not null default '{}',
  -- Erkennt doppelte Inhalte beim Import (auch bereits verworfene Notes).
  content_hash text generated always as (
    md5(type || chr(31) || lower(btrim(front)) || chr(31) || lower(btrim(back)))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (user_id, course_id, content_hash)
);
create index notes_status_idx on public.notes (user_id, status, created_at);
create index notes_course_idx on public.notes (course_id);

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  note_id uuid not null references public.notes (id) on delete cascade,
  ordinal smallint not null default 0,
  due timestamptz not null default now(),
  stability double precision not null default 0,
  difficulty double precision not null default 0,
  scheduled_days double precision not null default 0,
  learning_step smallint not null default 0,
  reps integer not null default 0,
  lapses integer not null default 0,
  -- 0 = new, 1 = learning, 2 = review, 3 = relearning (wie ts-fsrs State)
  state smallint not null default 0 check (state between 0 and 3),
  last_review timestamptz,
  created_at timestamptz not null default now(),
  unique (note_id, ordinal)
);
create index cards_due_idx on public.cards (user_id, state, due);

-- Jede einzelne Bewertung. Wird nie gelöscht oder geändert (keine Policies dafür).
create table public.review_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id uuid references public.cards (id) on delete set null,
  course_id uuid references public.courses (id) on delete set null,
  rating smallint not null check (rating between 1 and 4),
  -- Zustand der Karte VOR der Bewertung
  state smallint not null check (state between 0 and 3),
  due timestamptz not null,
  stability double precision not null,
  difficulty double precision not null,
  elapsed_days double precision not null default 0,
  scheduled_days double precision not null default 0,
  learning_step smallint not null default 0,
  last_review timestamptz,
  duration_ms integer not null default 0,
  reviewed_at timestamptz not null default now()
);
create index review_logs_time_idx on public.review_logs (user_id, reviewed_at);
create index review_logs_card_idx on public.review_logs (card_id, reviewed_at);

create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  desired_retention double precision not null default 0.9
    check (desired_retention between 0.7 and 0.97),
  fsrs_params jsonb,
  new_per_day integer not null default 20 check (new_per_day between 0 and 500),
  max_reviews_per_day integer not null default 200 check (max_reviews_per_day between 0 and 5000),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.courses enable row level security;
alter table public.sources enable row level security;
alter table public.notes enable row level security;
alter table public.cards enable row level security;
alter table public.review_logs enable row level security;
alter table public.settings enable row level security;

create policy "own courses" on public.courses for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own sources" on public.sources for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own notes" on public.notes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own cards" on public.cards for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own settings" on public.settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- review_logs: nur lesen und anfügen
create policy "read own logs" on public.review_logs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "append own logs" on public.review_logs for insert to authenticated
  with check (user_id = (select auth.uid()));

revoke all on public.allowed_emails from anon, authenticated;
revoke all on public.courses, public.sources, public.notes, public.cards,
  public.review_logs, public.settings from anon;
grant select, insert, update, delete on public.courses, public.sources, public.notes,
  public.cards, public.settings to authenticated;
grant select, insert on public.review_logs to authenticated;
grant all on public.allowed_emails, public.courses, public.sources, public.notes,
  public.cards, public.review_logs, public.settings to service_role;

-- ---------------------------------------------------------------------------
-- Karten entstehen ausschließlich aus freigegebenen Notes
-- ---------------------------------------------------------------------------
create function public.touch_note()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger notes_touch
  before update on public.notes
  for each row execute function public.touch_note();

create function public.create_note_cards()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ordinals smallint[];
begin
  if new.status <> 'approved' then
    return null;
  end if;

  if new.type = 'cloze' then
    select coalesce(array_agg(distinct (m[1])::smallint), '{}')
      into ordinals
      from regexp_matches(new.front, '\{\{c(\d+)::', 'g') as m;
  end if;
  if ordinals is null or cardinality(ordinals) = 0 then
    ordinals := array[0::smallint];
  end if;

  insert into public.cards (user_id, note_id, ordinal)
    select new.user_id, new.id, o from unnest(ordinals) as o
    on conflict (note_id, ordinal) do nothing;

  -- Lücken, die es nach einer Bearbeitung nicht mehr gibt, verlieren ihre Karte.
  delete from public.cards c
    where c.note_id = new.id and not (c.ordinal = any (ordinals));

  return null;
end;
$$;

create trigger notes_create_cards
  after insert or update of status, type, front on public.notes
  for each row execute function public.create_note_cards();

-- ---------------------------------------------------------------------------
-- Bewertung: Kartenzustand + Log atomar und idempotent schreiben
-- ---------------------------------------------------------------------------
create function public.review_card(
  p_log_id uuid,
  p_card_id uuid,
  p_rating smallint,
  p_reviewed_at timestamptz,
  p_duration_ms integer,
  p_due timestamptz,
  p_stability double precision,
  p_difficulty double precision,
  p_scheduled_days double precision,
  p_learning_step smallint,
  p_reps integer,
  p_lapses integer,
  p_state smallint
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  c public.cards%rowtype;
  v_course uuid;
  v_inserted integer;
begin
  select * into c from public.cards where id = p_card_id for update;
  if not found then
    raise exception 'card_not_found';
  end if;
  select n.course_id into v_course from public.notes n where n.id = c.note_id;

  insert into public.review_logs (
    id, user_id, card_id, course_id, rating, state, due, stability, difficulty,
    elapsed_days, scheduled_days, learning_step, last_review, duration_ms, reviewed_at
  ) values (
    p_log_id, c.user_id, c.id, v_course, p_rating, c.state, c.due, c.stability, c.difficulty,
    case when c.last_review is null then 0
         else greatest(0, extract(epoch from (p_reviewed_at - c.last_review)) / 86400.0) end,
    c.scheduled_days, c.learning_step, c.last_review, greatest(0, p_duration_ms), p_reviewed_at
  )
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;

  -- Wiederholter Aufruf mit derselben Log-ID (z. B. Offline-Retry): nichts doppelt buchen.
  if v_inserted = 0 then
    return false;
  end if;

  update public.cards set
    due = p_due,
    stability = p_stability,
    difficulty = p_difficulty,
    scheduled_days = p_scheduled_days,
    learning_step = p_learning_step,
    reps = p_reps,
    lapses = p_lapses,
    state = p_state,
    last_review = p_reviewed_at
  where id = p_card_id;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Import der KI-Karten (JSON aus der lokalen Pipeline) als Entwürfe
-- ---------------------------------------------------------------------------
create function public.import_notes_for(
  p_user uuid,
  p_notes jsonb,
  -- Eigene, bereits gelernte Karten (z. B. aus Anki) dürfen die Freigabe überspringen.
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
      priority, status, origin, ai_flags, created_at
    ) values (
      p_user, v_course, v_source, n->>'type', n->>'front', coalesce(n->>'back', ''),
      coalesce(n->>'extra', ''), coalesce(n->>'source_ref', ''),
      coalesce((select array_agg(t) from jsonb_array_elements_text(
        case when jsonb_typeof(n->'tags') = 'array' then n->'tags' else '[]'::jsonb end) as t), '{}'),
      coalesce(n->>'priority', 'mittel'), p_status, p_origin,
      coalesce((select array_agg(t) from jsonb_array_elements_text(
        case when jsonb_typeof(n->'check'->'issues') = 'array'
             then n->'check'->'issues' else '[]'::jsonb end) as t), '{}'),
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

-- Für die App: importiert immer für den angemeldeten Nutzer und immer als Entwurf.
create function public.import_notes(p_notes jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.import_notes_for((select auth.uid()), p_notes);
$$;

-- ---------------------------------------------------------------------------
-- Lesende Sichten / Auswertungen
-- ---------------------------------------------------------------------------
create view public.study_cards
with (security_invoker = true)
as
select
  c.id, c.note_id, c.ordinal, c.due, c.stability, c.difficulty, c.scheduled_days,
  c.learning_step, c.reps, c.lapses, c.state, c.last_review, c.created_at,
  n.type, n.front, n.back, n.extra, n.source_ref, n.tags, n.priority as note_priority,
  n.course_id, co.name as course_name, co.exam_date, co.priority as course_priority,
  s.file_path as source_file
from public.cards c
join public.notes n on n.id = c.note_id and n.status = 'approved'
join public.courses co on co.id = n.course_id
left join public.sources s on s.id = n.source_id;

revoke all on public.study_cards from anon;
grant select on public.study_cards to authenticated, service_role;

create function public.course_overview(p_due_before timestamptz)
returns table (
  id uuid, name text, semester text, exam_date date, exam_type text, priority smallint,
  due_count bigint, learning_count bigint, new_count bigint, card_count bigint,
  draft_count bigint, note_count bigint
)
language sql
stable
set search_path = ''
as $$
  select co.id, co.name, co.semester, co.exam_date, co.exam_type, co.priority,
    (select count(*) from public.study_cards sc
      where sc.course_id = co.id and sc.state <> 0 and sc.due <= p_due_before),
    (select count(*) from public.study_cards sc
      where sc.course_id = co.id and sc.state in (1, 3) and sc.due <= p_due_before),
    (select count(*) from public.study_cards sc where sc.course_id = co.id and sc.state = 0),
    (select count(*) from public.study_cards sc where sc.course_id = co.id),
    (select count(*) from public.notes n where n.course_id = co.id and n.status = 'draft'),
    (select count(*) from public.notes n where n.course_id = co.id and n.status = 'approved')
  from public.courses co
  order by co.exam_date nulls last, co.priority desc, co.name;
$$;

create function public.stats_overview(p_tz text default 'Europe/Berlin')
returns jsonb
language sql
stable
set search_path = ''
as $$
  with days as (
    select generate_series(0, 13) as offset_days
  ),
  today as (
    select (now() at time zone p_tz)::date as d
  ),
  forecast as (
    select d.offset_days,
      (select count(*) from public.study_cards sc, today t
        where sc.state <> 0
          and case when d.offset_days = 0
                then (sc.due at time zone p_tz)::date <= t.d
                else (sc.due at time zone p_tz)::date = t.d + d.offset_days end) as due
    from days d
  ),
  history as (
    select (l.reviewed_at at time zone p_tz)::date as day,
      count(*) as reviews,
      coalesce(sum(l.duration_ms), 0) as duration_ms
    from public.review_logs l, today t
    where (l.reviewed_at at time zone p_tz)::date > t.d - 30
    group by 1
  ),
  retention as (
    select count(*) as total, count(*) filter (where l.rating > 1) as passed
    from public.review_logs l
    where l.state = 2 and l.reviewed_at > now() - interval '30 days'
  ),
  states as (
    select sc.state, count(*) as n from public.study_cards sc group by sc.state
  ),
  decisions as (
    select
      count(*) filter (where n.status in ('approved', 'suspended')) as approved,
      count(*) filter (where n.status = 'rejected') as rejected,
      count(*) filter (where n.status = 'draft') as draft
    from public.notes n where n.origin = 'ai'
  )
  select jsonb_build_object(
    'forecast', (select coalesce(jsonb_agg(jsonb_build_object('offset', offset_days, 'due', due)
                   order by offset_days), '[]'::jsonb) from forecast),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('day', day, 'reviews', reviews,
                   'duration_ms', duration_ms) order by day), '[]'::jsonb) from history),
    'retention', (select jsonb_build_object('total', total, 'passed', passed) from retention),
    'states', (select coalesce(jsonb_object_agg(state::text, n), '{}'::jsonb) from states),
    'decisions', (select jsonb_build_object('approved', approved, 'rejected', rejected,
                   'draft', draft) from decisions),
    'total_reviews', (select count(*) from public.review_logs)
  );
$$;

revoke all on function public.review_card(uuid, uuid, smallint, timestamptz, integer, timestamptz,
  double precision, double precision, double precision, smallint, integer, integer, smallint)
  from public, anon;
revoke all on function public.import_notes(jsonb) from public, anon;
revoke all on function public.course_overview(timestamptz) from public, anon;
revoke all on function public.stats_overview(text) from public, anon;
grant execute on function public.review_card(uuid, uuid, smallint, timestamptz, integer, timestamptz,
  double precision, double precision, double precision, smallint, integer, integer, smallint)
  to authenticated, service_role;
grant execute on function public.import_notes(jsonb) to authenticated;
grant execute on function public.course_overview(timestamptz) to authenticated, service_role;
grant execute on function public.stats_overview(text) to authenticated, service_role;
