"""Lädt die Dateien eines Moodle-Kurses nach kurse/<kurs>/<abschnitt>/.

Nutzt die offizielle Moodle-Web-Service-Schnittstelle mit einem persönlichen Token.
Ob deine Moodle-Instanz solche Tokens für Studierende ausstellt, ist nicht geprüft – wenn nicht,
bleibt der manuelle Download aus dem Browser in dieselbe Ordnerstruktur.

    # Token nur als Umgebungsvariable, nie als Argument (Shell-Historie!) und nie im Repo:
    $env:MOODLE_TOKEN = "…"                       # PowerShell
    python pipeline/moodle_fetch.py --list         # eigene Kurse mit IDs anzeigen
    python pipeline/moodle_fetch.py <kurs-id> --name "<Kursname>"

Bereits vorhandene Dateien gleicher Größe werden übersprungen. Das Skript lädt nur
herunter; es lädt nichts hoch und verändert nichts in Moodle.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_BASE = "https://moodle.example.edu"  # eigene Instanz über MOODLE_URL oder --base
DOWNLOADABLE = {".pdf", ".pptx", ".ppt", ".docx", ".xlsx", ".csv", ".txt", ".zip", ".ipynb"}


def safe_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return cleaned[:120] or "unbenannt"


class Moodle:
    def __init__(self, base: str, token: str) -> None:
        self.base = base.rstrip("/")
        self.token = token

    def call(self, function: str, **params: object) -> object:
        # Token im POST-Body, nicht in der URL – so landet er in keinem Log.
        body = urllib.parse.urlencode(
            {"wstoken": self.token, "wsfunction": function, "moodlewsrestformat": "json", **params}
        ).encode()
        request = urllib.request.Request(f"{self.base}/webservice/rest/server.php", data=body)
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.load(response)
        if isinstance(data, dict) and data.get("exception"):
            raise SystemExit(f"Moodle-Fehler: {data.get('message', data.get('errorcode'))}")
        return data

    def download(self, file_url: str, target: Path) -> None:
        # Datei-URLs der Web-Services erwarten den Token als Parameter.
        separator = "&" if "?" in file_url else "?"
        request = urllib.request.Request(f"{file_url}{separator}token={urllib.parse.quote(self.token)}")
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(target.suffix + ".part")
        with urllib.request.urlopen(request, timeout=300) as response, partial.open("wb") as handle:
            while block := response.read(1 << 20):
                handle.write(block)
        partial.replace(target)


def list_courses(moodle: Moodle) -> None:
    info = moodle.call("core_webservice_get_site_info")
    assert isinstance(info, dict)
    courses = moodle.call("core_enrol_get_users_courses", userid=info["userid"])
    assert isinstance(courses, list)
    for course in sorted(courses, key=lambda c: c["fullname"]):
        print(f"{course['id']:>8}  {course['fullname']}")


def fetch_course(moodle: Moodle, course_id: int, name: str | None, root: Path) -> None:
    if name is None:
        found = moodle.call("core_course_get_courses_by_field", field="id", value=course_id)
        assert isinstance(found, dict)
        courses = found.get("courses") or []
        name = courses[0]["fullname"] if courses else f"Kurs {course_id}"
    course_dir = root / safe_name(name)

    sections = moodle.call("core_course_get_contents", courseid=course_id)
    assert isinstance(sections, list)
    downloaded = skipped = 0
    for index, section in enumerate(sections):
        section_dir = course_dir / safe_name(f"{index:02d} {section.get('name') or 'Allgemein'}")
        for module in section.get("modules", []):
            for item in module.get("contents", []) or []:
                if item.get("type") != "file":
                    continue
                filename = safe_name(item["filename"])
                if Path(filename).suffix.lower() not in DOWNLOADABLE:
                    continue
                target = section_dir / filename
                if target.exists() and target.stat().st_size == item.get("filesize"):
                    skipped += 1
                    continue
                moodle.download(item["fileurl"], target)
                downloaded += 1
                print(f"  {target.relative_to(root)}")
    print(f"{name}: {downloaded} geladen, {skipped} unverändert → {course_dir}")
    print(f'Weiter mit: python pipeline/recall_pipeline.py extract "{course_dir}"')


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("course_id", type=int, nargs="?", help="Kurs-ID aus der Moodle-URL (course/view.php?id=…)")
    parser.add_argument("--name", help="Ordnername unter kurse/ (Standard: Kursname aus Moodle)")
    parser.add_argument("--list", action="store_true", help="eigene Kurse mit IDs anzeigen")
    parser.add_argument("--base", default=os.environ.get("MOODLE_URL", DEFAULT_BASE))
    parser.add_argument("--out", type=Path, default=Path("kurse"))
    args = parser.parse_args()

    token = os.environ.get("MOODLE_TOKEN")
    if not token:
        parser.error("Umgebungsvariable MOODLE_TOKEN fehlt.")
    moodle = Moodle(args.base, token)

    if args.list:
        list_courses(moodle)
    elif args.course_id is not None:
        fetch_course(moodle, args.course_id, args.name, args.out)
    else:
        parser.error("Kurs-ID angeben oder --list verwenden.")


if __name__ == "__main__":
    main()
