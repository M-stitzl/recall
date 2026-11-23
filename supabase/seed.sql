-- Lokale Entwicklungsdaten. Wird bei `supabase db reset` geladen, nie in Produktion.
-- Test-Zugang für die Playwright-E2E-Tests:
insert into public.allowed_emails (email) values ('e2e@recall.test')
  on conflict do nothing;
