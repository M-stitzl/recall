"""Erzeugt Bildkarten (Image Occlusion) aus einer Spezifikation.

    pipeline/.venv/Scripts/python pipeline/bildkarten.py "kurse/<Kurs>/_karten/bildkarten.spec.json"

Spezifikation (JSON-Liste), je Eintrag:
    source          Datei relativ zum Kursordner, z. B. "02 Woche/Vorlesung02.pdf"
    page            PDF-Seite (1-basiert)
    slide           optional: gedruckte Foliennummer für die Quellenangabe, falls abweichend
    hide            Text, der verdeckt wird – oder Liste von Zeilen, die zusammen verdeckt werden
    occurrence      optional: welcher Treffer (1 = erster, Standard)
    question, answer, warum_relevant, priority, tags, extra

Ergebnis: <spec>.notes.json neben der Spezifikation, mit `image` (Pfad relativ zur notes-Datei)
und `occlusion` (relativ 0..1). Gerendert werden nur die Folien aus der Spezifikation, nach
kurse/<kurs>/_bilder/. Danach: `pnpm cards:upload-images <notes.json> --linked`.

Die Position des verdeckten Bereichs kommt aus dem Textlayer des PDFs (keine Schätzung).
Findet sich der Text nicht (z. B. Rasterbild), bricht das Skript mit einer Meldung ab.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

DPI = 150
PAD_PT = 3.0


def load_manifest(course_dir: Path) -> dict[str, dict]:
    data = json.loads((course_dir / "manifest.json").read_text(encoding="utf-8"))
    return {entry["file_path"]: entry for entry in data["sources"]}


def find_box(page, hide: str | list[str], occurrence: int):
    import pymupdf

    parts = [hide] if isinstance(hide, str) else hide
    box = None
    for part in parts:
        hits = page.search_for(part)
        if len(hits) < occurrence:
            raise SystemExit(f'„{part}“ nicht gefunden (Treffer: {len(hits)}) auf Folie {page.number + 1}')
        rect = hits[occurrence - 1]
        box = rect if box is None else box | rect
    assert box is not None
    box = pymupdf.Rect(box.x0 - PAD_PT, box.y0 - PAD_PT, box.x1 + PAD_PT, box.y1 + PAD_PT) & page.rect
    width, height = page.rect.width, page.rect.height
    return {
        "x": round(box.x0 / width, 4),
        "y": round(box.y0 / height, 4),
        "w": round(box.width / width, 4),
        "h": round(box.height / height, 4),
    }


def main() -> None:
    import pymupdf

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)

    spec_path = Path(sys.argv[1]).resolve()
    notes_dir = spec_path.parent
    course_dir = notes_dir.parent
    image_dir = course_dir / "_bilder"
    image_dir.mkdir(exist_ok=True)
    manifest = load_manifest(course_dir)
    specs = json.loads(spec_path.read_text(encoding="utf-8"))

    notes = []
    rendered: set[Path] = set()
    for spec in specs:
        source = spec["source"]
        if source not in manifest:
            raise SystemExit(f"Quelle nicht im Manifest: {source}")
        meta = manifest[source]
        with pymupdf.open(course_dir / source) as document:
            page = document[spec["page"] - 1]
            occlusion = find_box(page, spec["hide"], spec.get("occurrence", 1))
            image = image_dir / f"{Path(source).stem}-p{spec['page']:03d}.png"
            if image not in rendered:
                page.get_pixmap(dpi=DPI).save(image)
                rendered.add(image)
        notes.append(
            {
                "course": course_dir.name,
                "source": source,
                # „slide“: gedruckte Foliennummer, falls sie von der PDF-Seite abweicht (animierte Decks)
                "source_ref": f"Folie {spec.get('slide', spec['page'])}",
                "week": meta.get("week"),
                "source_kind": meta.get("kind", "folien"),
                "source_hash": meta["content_hash"],
                "type": "basic",
                "format": "bild",
                "warum_relevant": spec["warum_relevant"],
                "front": spec["question"],
                "back": spec["answer"],
                "extra": spec.get("extra", ""),
                "tags": spec.get("tags", []),
                "priority": spec.get("priority", "mittel"),
                "image": Path("..", "_bilder", image.name).as_posix(),
                "occlusion": occlusion,
                "check": {"ok": True, "issues": []},
            }
        )

    out = spec_path.with_name(spec_path.name.replace(".spec.json", ".notes.json"))
    out.write_text(json.dumps(notes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(f"{len(notes)} Bildkarten, {len(rendered)} Folien gerendert → {out.relative_to(course_dir.parent.parent)}")


if __name__ == "__main__":
    main()
