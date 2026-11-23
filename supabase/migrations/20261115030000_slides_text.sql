-- Quellenansicht: neben Folienbildern auch zitierte Textabschnitte (Markdown) im privaten Speicher.
update storage.buckets
  set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'text/markdown', 'text/plain']
  where id = 'slides';
