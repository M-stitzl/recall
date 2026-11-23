-- Kopiere diese Datei nach seed.local.sql und trage deine E-Mail-Adresse ein.
insert into public.allowed_emails (email) values ('du@example.com')
  on conflict do nothing;
