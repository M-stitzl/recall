"""Lokale Content-Pipeline von Recall: Kursmaterial erfassen und in Markdown umwandeln.

Kursmaterial liegt unter  kurse/<kurs>/<woche>/<datei>  und verlässt den Rechner nie.

    python pipeline/recall_pipeline.py ingest  "kurse/<Kurs>"
    python pipeline/recall_pipeline.py extract "kurse/<Kurs>"

ingest   schreibt kurse/<kurs>/manifest.json (Pfad, Titel, Art, Woche, SHA-256).
extract  wandelt neue oder geänderte PDFs/PPTX in Markdown mit Foliennummern um:
         kurse/<kurs>/_extrakt/<woche>/<datei>.md  (+ Seitenbilder für Folien mit Abbildungen)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

SUPPORTED = {".pdf", ".pptx", ".xlsx", ".md"}
EXTRACT_DIR = "_extrakt"
MANIFEST = "manifest.json"

KIND_PATTERNS = [
    ("altklausur", r"klausur|exam|pruefung|prüfung|probeklausur|mock"),
    ("uebung", r"uebung|übung|exercise|tutorial|_tut\d|blatt|sheet|homework|aufgabe|solution|loesung|lösung"),
    ("folien", r"."),
]


@dataclass
class Source:
    file_path: str  # relativ zum Kursordner, mit "/" als Trenner
    title: str
    week: str | None
    kind: str
    content_hash: str
    size_bytes: int
    extracted_hash: str | None = None
    extract_path: str | None = None
    pages: int | None = None


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def guess_kind(name: str) -> str:
    lowered = name.lower()
    for kind, pattern in KIND_PATTERNS:
        if re.search(pattern, lowered):
            return kind
    return "folien"


def title_of(path: Path) -> str:
    return re.sub(r"[_\-]+", " ", path.stem).strip()


def load_manifest(course_dir: Path) -> dict[str, Source]:
    file = course_dir / MANIFEST
    if not file.exists():
        return {}
    data = json.loads(file.read_text(encoding="utf-8"))
    return {entry["file_path"]: Source(**entry) for entry in data.get("sources", [])}


def save_manifest(course_dir: Path, sources: dict[str, Source]) -> None:
    payload = {
        "course": course_dir.name,
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": [asdict(sources[key]) for key in sorted(sources)],
    }
    (course_dir / MANIFEST).write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n"
    )


def course_files(course_dir: Path) -> list[Path]:
    return sorted(
        path
        for path in course_dir.rglob("*")
        if path.is_file()
        and path.suffix.lower() in SUPPORTED
        and EXTRACT_DIR not in path.relative_to(course_dir).parts
    )


def ingest(course_dir: Path) -> dict[str, Source]:
    known = load_manifest(course_dir)
    current: dict[str, Source] = {}
    new = changed = 0

    for path in course_files(course_dir):
        relative = path.relative_to(course_dir)
        key = relative.as_posix()
        digest = sha256(path)
        previous = known.get(key)
        source = Source(
            file_path=key,
            title=title_of(path),
            week=relative.parts[0] if len(relative.parts) > 1 else None,
            kind=guess_kind(key),
            content_hash=digest,
            size_bytes=path.stat().st_size,
        )
        if previous is None:
            new += 1
        else:
            # Von Hand korrigierte Art (z. B. "altklausur") bleibt erhalten.
            source.kind = previous.kind
            source.extracted_hash = previous.extracted_hash
            source.extract_path = previous.extract_path
            source.pages = previous.pages
            if previous.content_hash != digest:
                changed += 1
        current[key] = source

    removed = sorted(set(known) - set(current))
    save_manifest(course_dir, current)
    print(f"{course_dir.name}: {len(current)} Dateien ({new} neu, {changed} geändert, {len(removed)} entfernt)")
    for key in removed:
        print(f"  entfernt: {key}")
    return current


def clean_text(text: str) -> str:
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.splitlines()]
    cleaned = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def extract_pdf(path: Path, image_dir: Path, image_prefix: str, all_images: bool) -> tuple[list[str], int]:
    import pymupdf  # PyMuPDF

    parts: list[str] = []
    with pymupdf.open(path) as document:
        total = document.page_count
        for index, page in enumerate(document, start=1):
            text = clean_text(page.get_text("text"))
            has_figure = bool(page.get_images(full=True)) or len(page.get_drawings()) > 25
            parts.append(f"## Folie {index}\n")
            parts.append(text if text else "_(kein Text auf dieser Folie)_")
            # Folien mit Abbildungen, Diagrammen oder kaum Text zusätzlich als Bild sichern,
            # damit Formeln und Grafiken beim Kartenschreiben geprüft werden können.
            if all_images or has_figure or len(text) < 40:
                image_dir.mkdir(parents=True, exist_ok=True)
                image = image_dir / f"folie-{index:03d}.png"
                page.get_pixmap(dpi=110).save(image)
                parts.append(f"\n![Folie {index}]({image_prefix}/{image.name})")
            parts.append("")
    return parts, total


def extract_pptx(path: Path) -> tuple[list[str], int]:
    from pptx import Presentation

    presentation = Presentation(str(path))
    parts: list[str] = []
    for index, slide in enumerate(presentation.slides, start=1):
        texts: list[str] = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                texts.append(shape.text_frame.text)
            if getattr(shape, "has_table", False) and shape.has_table:
                for row in shape.table.rows:
                    texts.append(" | ".join(cell.text for cell in row.cells))
        notes = ""
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
            notes = slide.notes_slide.notes_text_frame.text.strip()
        body = clean_text("\n".join(texts))
        parts.append(f"## Folie {index}\n")
        parts.append(body if body else "_(kein Text auf dieser Folie)_")
        if notes:
            parts.append(f"\n> Notizen: {clean_text(notes)}")
        parts.append("")
    return parts, len(presentation.slides)


def extract_xlsx(path: Path, max_rows: int = 120, max_cols: int = 16) -> tuple[list[str], int]:
    """Arbeitsmappe als Text: je Blatt die beschrifteten Zeilen (Werte, keine Formeln)."""
    from openpyxl import load_workbook

    workbook = load_workbook(path, read_only=True, data_only=True)
    parts: list[str] = []
    for sheet in workbook.worksheets:
        parts.append(f"## Blatt {sheet.title}\n")
        rows: list[str] = []
        for row in sheet.iter_rows(max_row=max_rows, max_col=max_cols, values_only=True):
            cells = ["" if value is None else (f"{value:.4g}" if isinstance(value, float) else str(value)).strip() for value in row]
            # Nur Zeilen mit mindestens einer Beschriftung: Modelle bestehen sonst aus Zahlenwüsten.
            if any(cell and not re.fullmatch(r"[-\d.,%e+ ]+", cell) for cell in cells):
                while cells and not cells[-1]:
                    cells.pop()
                rows.append(" | ".join(cells))
        parts.append("\n".join(rows) if rows else "_(keine beschrifteten Zeilen)_")
        parts.append("")
    count = len(workbook.worksheets)
    workbook.close()
    return parts, count


def extract_markdown(path: Path) -> tuple[list[str], int]:
    """Bereits als Text gesicherte Seiten (z. B. Moodle-Buch): übernehmen, Kapitel zählen."""
    text = path.read_text(encoding="utf-8")
    return [text], max(1, len(re.findall(r"^### ", text, flags=re.M)))


def extract(course_dir: Path, force: bool, all_images: bool) -> None:
    sources = ingest(course_dir)
    done = skipped = failed = 0

    for key, source in sources.items():
        # Endung im Namen behalten: „Lösung.pdf“ und „Lösung.xlsx“ dürfen sich nicht überschreiben.
        target = course_dir / EXTRACT_DIR / Path(key + ".md")
        if not force and source.extracted_hash == source.content_hash and target.exists():
            skipped += 1
            continue

        path = course_dir / key
        image_dir = target.with_name(f"{Path(key).name}_bilder")
        try:
            suffix = path.suffix.lower()
            if suffix == ".pdf":
                parts, pages = extract_pdf(path, image_dir, image_dir.name, all_images)
            elif suffix == ".pptx":
                parts, pages = extract_pptx(path)
            elif suffix == ".xlsx":
                parts, pages = extract_xlsx(path)
            else:
                parts, pages = extract_markdown(path)
        except Exception as error:  # eine kaputte Datei soll den Rest nicht aufhalten
            failed += 1
            print(f"  FEHLER {key}: {error}", file=sys.stderr)
            continue

        header = [
            f"# {source.title}",
            "",
            f"- Kurs: {course_dir.name}",
            f"- Quelle: {key}",
            f"- Art: {source.kind}",
            f"- Woche: {source.week or '–'}",
            f"- Hash: {source.content_hash}",
            "",
        ]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("\n".join(header + parts).rstrip() + "\n", encoding="utf-8", newline="\n")
        source.extracted_hash = source.content_hash
        source.extract_path = target.relative_to(course_dir).as_posix()
        source.pages = pages
        done += 1
        unit = {".xlsx": "Blätter", ".md": "Kapitel"}.get(path.suffix.lower(), "Folien")
        print(f"  extrahiert: {key} ({pages} {unit})")

    save_manifest(course_dir, sources)
    print(f"Fertig: {done} extrahiert, {skipped} unverändert, {failed} fehlgeschlagen")
    if failed:
        sys.exit(1)


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    ingest_parser = commands.add_parser("ingest", help="Manifest eines Kursordners aktualisieren")
    ingest_parser.add_argument("course_dir", type=Path)

    extract_parser = commands.add_parser("extract", help="PDF/PPTX in Markdown mit Foliennummern umwandeln")
    extract_parser.add_argument("course_dir", type=Path)
    extract_parser.add_argument("--force", action="store_true", help="auch unveränderte Dateien neu extrahieren")
    extract_parser.add_argument("--alle-bilder", action="store_true", help="jede Folie zusätzlich als Bild sichern")

    args = parser.parse_args()
    course_dir: Path = args.course_dir
    if not course_dir.is_dir():
        parser.error(f"Kursordner nicht gefunden: {course_dir}")

    if args.command == "ingest":
        ingest(course_dir)
    else:
        extract(course_dir, force=args.force, all_images=args.alle_bilder)


if __name__ == "__main__":
    main()
