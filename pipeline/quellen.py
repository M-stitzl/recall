"""Erzeugt die Quellenansicht („Quelle anzeigen“) für Karten.

    pipeline/.venv/Scripts/python pipeline/quellen.py "kurse/<Kurs>/_karten/<Datei>.notes.json" [weitere …]

Für jede Note wird `source_ref` gelesen und `source_view` in die notes-Datei geschrieben:
  - „Folie 14“, „Folie 18–20“  → die ganze(n) Folie(n) als Bild (bei Bereichen höchstens 4).
    Die Nummer ist die **gedruckte** Foliennummer; bei animierten Decks wird der letzte
    Animationsschritt dieser Folie genommen.
  - „…; Übung 1 F14“           → zusätzlich Folie 14 der Lösung zu Übung 1 (falls im Kurs vorhanden).
  - „Step 2“, „Wrap-up“        → der Abschnitt des Lernpfad-Buchs (Markdown) als Text.
  - Excel-Quelle               → der Abschnitt des Blatts aus dem Extrakt als Text.
Bilder und Texte landen in kurse/<Kurs>/_quellen/. Danach hochladen mit
`pnpm cards:upload-images <notes.json> --linked` (lädt Bildkarten und Quellen hoch).
"""

from __future__ import annotations

import json
import re
import sys
from functools import lru_cache
from pathlib import Path

DPI = 110
MAX_PAGES = 4


def manifest(course_dir: Path) -> dict[str, dict]:
    data = json.loads((course_dir / "manifest.json").read_text(encoding="utf-8"))
    return {entry["file_path"]: entry for entry in data["sources"]}


@lru_cache(maxsize=None)
def printed_numbers(pdf: Path) -> dict[int, int]:
    """Gedruckte Foliennummer → PDF-Seite (letzte Seite mit dieser Nummer = fertige Animation)."""
    import pymupdf

    mapping: dict[int, int] = {}
    with pymupdf.open(pdf) as document:
        detected = 0
        for index, page in enumerate(document, start=1):
            width, height = page.rect.width, page.rect.height
            numbers = [
                int(word[4])
                for word in page.get_text("words")
                if word[4].isdigit() and word[1] > height * 0.8 and word[0] > width * 0.85
            ]
            if numbers:
                detected += 1
                mapping[numbers[-1]] = index
        # Ohne verlässliche Erkennung: gedruckte Nummer = PDF-Seite
        if detected < document.page_count * 0.5:
            return {i: i for i in range(1, document.page_count + 1)}
    return mapping


def slide_numbers(ref: str) -> list[int]:
    match = re.match(r"\s*Folie\s+(\d+)(?:\s*[–-]\s*(\d+))?", ref)
    if not match:
        return []
    start = int(match.group(1))
    end = int(match.group(2) or start)
    return list(range(start, min(end, start + MAX_PAGES - 1) + 1))


def render(pdf: Path, page_number: int, out_dir: Path) -> Path:
    import pymupdf

    target = out_dir / f"{pdf.stem}-p{page_number:03d}.png"
    if not target.exists():
        with pymupdf.open(pdf) as document:
            document[page_number - 1].get_pixmap(dpi=DPI).save(target)
    return target


def section(markdown: str, heading_pattern: str) -> str | None:
    lines = markdown.splitlines()
    start = next((i for i, line in enumerate(lines) if re.match(heading_pattern, line)), None)
    if start is None:
        return None
    level = len(lines[start]) - len(lines[start].lstrip("#"))
    end = next(
        (i for i in range(start + 1, len(lines))
         if lines[i].startswith("#") and len(lines[i]) - len(lines[i].lstrip("#")) <= level),
        len(lines),
    )
    return "\n".join(lines[start:end]).strip() + "\n"


def write_text(out_dir: Path, name: str, title: str, body: str) -> Path:
    target = out_dir / f"{name}.md"
    target.write_text(f"# {title}\n\n{body}", encoding="utf-8", newline="\n")
    return target


def views_for(note: dict, course_dir: Path, notes_dir: Path, sources: dict[str, dict]) -> list[dict]:
    out_dir = course_dir / "_quellen"
    out_dir.mkdir(exist_ok=True)
    source = note["source"]
    ref = note.get("source_ref", "")
    path = course_dir / source
    items: list[dict] = []
    rel = lambda p: Path("..", p.relative_to(course_dir)).as_posix()  # noqa: E731

    main_ref = ref.split(";")[0]
    if path.suffix.lower() == ".pdf":
        mapping = printed_numbers(path)
        for number in slide_numbers(main_ref):
            page = mapping.get(number)
            if page:
                items.append({"kind": "image", "label": f"Folie {number}", "file": rel(render(path, page, out_dir))})
    elif path.suffix.lower() == ".md":
        text = path.read_text(encoding="utf-8")
        step = re.match(r"\s*(Step \d+|Wrap-up|Start here)", main_ref)
        if step:
            body = section(text, rf"^#{{2,4}} {re.escape(step.group(1))}")
            if body:
                name = f"{path.stem}-{step.group(1).lower().replace(' ', '-')}"
                items.append({"kind": "text", "label": f"Lernpfad: {step.group(1)}",
                              "file": rel(write_text(out_dir, name, path.stem, body))})
    elif path.suffix.lower() == ".xlsx":
        extract = course_dir / "_extrakt" / f"{source}.md"
        if extract.exists():
            sheet = main_ref.split("(")[0].strip()
            body = section(extract.read_text(encoding="utf-8"), rf"^## Blatt {re.escape(sheet)}\s*$")
            if body:
                name = f"{path.stem}-{re.sub(r'[^a-z0-9]+', '-', sheet.lower()).strip('-')}"
                items.append({"kind": "text", "label": f"Excel-Blatt: {sheet}",
                              "file": rel(write_text(out_dir, name, path.name, body))})

    # Zusatzverweise auf Übungslösungen: „Übung 1 F14“
    for exercise, slide in re.findall(r"Übung (\d+) F(\d+)", ref):
        candidates = [p for p in sources if re.search(rf"Exercise{exercise}_.*solution", p, re.I)]
        if candidates:
            pdf = course_dir / candidates[0]
            page = printed_numbers(pdf).get(int(slide))
            if page:
                items.append({"kind": "image", "label": f"Übung {exercise}, Folie {slide}",
                              "file": rel(render(pdf, page, out_dir))})
    return items


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)

    for arg in sys.argv[1:]:
        notes_path = Path(arg).resolve()
        notes_dir = notes_path.parent
        course_dir = notes_dir.parent
        sources = manifest(course_dir)
        notes = json.loads(notes_path.read_text(encoding="utf-8"))
        without = []
        for note in notes:
            items = views_for(note, course_dir, notes_dir, sources)
            if items:
                # Bereits hochgeladene Dateien behalten ihren Speicherpfad.
                old = {item.get("file"): item.get("path") for item in (note.get("source_view") or {}).get("items", [])}
                for item in items:
                    if old.get(item["file"]):
                        item["path"] = old[item["file"]]
                note["source_view"] = {"items": items}
            else:
                note.pop("source_view", None)
                without.append(note.get("source_ref", ""))
        notes_path.write_text(json.dumps(notes, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print(f"{notes_path.name}: {len(notes) - len(without)} von {len(notes)} Karten mit Quellenansicht")
        for ref in without:
            print(f"  ohne Ansicht: {ref!r}")


if __name__ == "__main__":
    main()
