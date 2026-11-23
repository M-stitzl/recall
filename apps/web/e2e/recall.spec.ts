import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { getAdmin, login, makeNotes, resetTestUser } from "./helpers";

const COURSE = "E2E Corporate Finance";

let userId: string;

test.beforeEach(async () => {
  userId = await resetTestUser();
});

async function count(table: string, filters: Record<string, string | number> = {}): Promise<number> {
  let query = getAdmin().from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  const { count: total, error } = await query;
  if (error) throw error;
  return total ?? 0;
}

async function importNotes(page: Page, notes: unknown[]) {
  await page.goto("/import");
  await page.getByLabel("… oder JSON einfügen").fill(JSON.stringify(notes));
  await expect(page.getByTestId("import-summary")).toContainText(`${notes.length} gültige Notes`);
  await page.getByRole("button", { name: "Importieren" }).click();
}

test("ohne Anmeldung geht es nur zum Login, fremde Adressen kommen nicht hinein", async ({ page }) => {
  await page.goto("/");
  await page.waitForURL("**/login");

  await page.getByRole("button", { name: "Konto anlegen" }).click();
  await page.getByLabel("E-Mail-Adresse").fill("fremd@example.com");
  await page.getByLabel(/Passwort/).fill("ein-langes-testpasswort");
  await page.getByRole("button", { name: "Konto anlegen" }).first().click();
  await expect(page.locator("main [role=alert]")).toContainText("nicht freigeschaltet");
});

test("Import → Freigabe → Lernsession → Statistik", async ({ page }, testInfo) => {
  const useKeyboard = testInfo.project.name === "desktop";
  const notes = makeNotes(COURSE, 20);

  // Fehlgeschlagene API-Aufrufe im Testprotokoll sichtbar machen.
  page.on("response", async (response) => {
    if (response.url().includes("/rest/v1/") && response.status() >= 400) {
      console.log("API-Fehler", response.status(), response.url(), await response.text().catch(() => ""));
    }
  });
  page.on("requestfailed", (request) => console.log("Request fehlgeschlagen", request.url(), request.failure()?.errorText));
  page.on("pageerror", (error) => console.log("Seitenfehler", error.message));

  await login(page);

  // --- Import -------------------------------------------------------------
  await importNotes(page, notes);
  await expect(page.getByRole("status")).toContainText("21 Notes importiert");
  expect(await count("notes", { status: "draft" })).toBe(21);
  expect(await count("cards")).toBe(0); // Entwürfe erzeugen keine Karten

  // Derselbe Import noch einmal: alles Duplikate.
  await importNotes(page, notes);
  await expect(page.getByRole("status")).toContainText("0 Notes importiert, 21 Duplikate übersprungen");

  // Ungültiges JSON wird abgelehnt, bevor etwas importiert wird.
  await page.getByLabel("… oder JSON einfügen").fill(JSON.stringify([{ ...(notes[0] as object), source_ref: "" }]));
  await expect(page.locator("main [role=alert]")).toContainText("Quellenverweis");
  await expect(page.getByRole("button", { name: "Importieren" })).toBeDisabled();

  // --- Freigabe-Queue -----------------------------------------------------
  await page.goto("/review");
  const draft = page.getByTestId("draft-note");
  await expect(draft).toContainText("Testfrage 1:");

  // Erste Note verwerfen (mit Grund).
  if (useKeyboard) {
    await page.keyboard.press("r");
    await page.keyboard.press("2");
  } else {
    await page.getByRole("button", { name: /^Verwerfen/ }).click();
    await page.getByRole("button", { name: /Zu trivial/ }).click();
  }
  await expect(draft).toContainText("Testfrage 2:");

  // Die übrigen 19 Basic-Notes annehmen.
  for (let i = 2; i <= 20; i++) {
    await expect(draft).toContainText(`Testfrage ${i}:`);
    if (useKeyboard) await page.keyboard.press("a");
    else await page.getByRole("button", { name: /^Annehmen/ }).click();
  }

  // Die Cloze-Note trägt den Hinweis der Selbstprüfung; bearbeiten und annehmen.
  await expect(draft).toContainText("Hinweise aus der Selbstprüfung");
  await expect(draft).toContainText("Formel unvollständig");
  await expect(draft.locator(".katex").first()).toBeVisible();
  if (useKeyboard) await page.keyboard.press("e");
  else await page.getByRole("button", { name: /^Bearbeiten/ }).click();
  await page.getByLabel("Zusatz (optional)").fill("Vom Test bearbeitet");
  await page.getByRole("button", { name: "Speichern und annehmen" }).click();

  await expect(page.getByText("Alles gesichtet")).toBeVisible();
  await expect(page.getByText("20 angenommen · 1 verworfen")).toBeVisible();

  expect(await count("notes", { status: "approved" })).toBe(20);
  expect(await count("notes", { status: "rejected" })).toBe(1);
  expect(await count("cards")).toBe(20); // 19 Basic + 1 Cloze-Lücke
  const { data: rejected } = await getAdmin()
    .from("notes")
    .select("reject_reason")
    .eq("user_id", userId)
    .eq("status", "rejected")
    .single();
  expect(rejected?.reject_reason).toBe("Zu trivial / nicht prüfungsrelevant");

  // --- Dashboard ----------------------------------------------------------
  await page.goto("/");
  await expect(page.getByTestId("due-total")).toHaveText("20 Karten"); // Tageslimit: 20 neue Karten
  await page.getByRole("link", { name: "Lernen beginnen" }).click();
  await page.waitForURL("**/study");

  // --- Lernsession: 20 Karten durchlernen -------------------------------------
  const card = page.getByTestId("study-card");
  let ratings = 0;
  let sawCloze = false;
  for (let step = 0; step < 80; step++) {
    const done = page.getByText("Geschafft");
    const show = page.getByRole("button", { name: "Antwort zeigen" });
    await expect(done.or(show)).toBeVisible();
    if (await done.isVisible()) break;

    const isCloze = (await card.locator(".cloze-hidden").count()) > 0;
    await expect(page.getByTestId("answer")).toHaveCount(0);
    if (useKeyboard) await page.keyboard.press("Space");
    else await show.click();
    await expect(page.getByTestId("answer")).toBeVisible();

    if (isCloze) {
      sawCloze = true;
      await expect(card.locator(".cloze-revealed")).toBeVisible();
      await expect(card).toContainText("Vom Test bearbeitet");
    }

    // Unter jedem Button steht das nächste Intervall.
    await expect(page.getByTestId("grade-1")).toContainText("Min");
    await expect(page.getByTestId("grade-4")).toContainText(/[0-9]+ Tage?/);

    // Erste Karte: „Nochmal“ (kommt wieder). Danach abwechselnd „Gut“ und „Einfach“.
    const grade = ratings === 0 ? 1 : ratings % 2 === 0 ? 3 : 4;
    if (useKeyboard) await page.keyboard.press(String(grade));
    else await page.getByTestId(`grade-${grade}`).click();
    ratings += 1;
  }
  await expect(page.getByText("Geschafft")).toBeVisible();
  expect(sawCloze).toBe(true);
  expect(ratings).toBeGreaterThan(20);

  // Alle Bewertungen sind angekommen: Log und Kartenzustand stimmen überein.
  await expect.poll(() => count("review_logs")).toBe(ratings);
  expect(await count("review_logs", { state: 0 })).toBe(20);
  expect(await count("cards", { state: 2 })).toBe(20);
  expect(await count("cards", { state: 0 })).toBe(0); // alle 20 Karten heute gelernt
  expect(await page.evaluate(() => localStorage.getItem("recall-outbox-v1"))).toBe("[]");

  // --- Dashboard und Statistik ----------------------------------------------
  await page.getByRole("link", { name: "Zur Übersicht" }).click();
  await expect(page.getByText("Für heute erledigt")).toBeVisible();

  await page.goto("/stats");
  await expect(page.getByText(`${ratings} Bewertungen · 20 aktive Karten`)).toBeVisible();
  await expect(page.getByText("95,2 %")).toBeVisible(); // Freigabequote 20 von 21
});

test("Kurs und eigene Karte anlegen, Einstellungen speichern", async ({ page }) => {
  await login(page);

  await page.goto("/courses");
  await page.getByRole("button", { name: "Neuer Kurs" }).click();
  await page.getByLabel("Name").fill("E2E Asset Management");
  await page.getByLabel("Klausurdatum").fill("2027-02-15");
  await page.getByRole("button", { name: "Kurs anlegen" }).click();
  await page.getByRole("link", { name: /E2E Asset Management/ }).click();

  await page.getByRole("button", { name: "Neue Karte" }).click();
  await page.getByLabel("Typ").selectOption("cloze");
  await page.getByLabel(/Text mit Lücken/).fill("CAPM: $E[r] = r_f + {{c1::\\beta}}$ … {{c1::Beta}} misst {{c2::systematisches Risiko}}");
  await page.getByRole("button", { name: "Karte anlegen" }).click();
  await expect(page.getByRole("button", { name: "Karte anlegen" })).toHaveCount(0);
  await expect(page.getByRole("listitem").filter({ hasText: "CAPM" })).toBeVisible();
  expect(await count("cards")).toBe(2); // eigene Karten sind sofort aktiv

  await page.goto("/settings");
  await page.getByLabel("Neue Karten pro Tag").fill("7");
  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toHaveText("Gespeichert.");
  const { data: settings } = await getAdmin()
    .from("settings")
    .select("new_per_day")
    .eq("user_id", userId)
    .single();
  expect(settings?.new_per_day).toBe(7);
});

test("Bewertungen ohne Netz bleiben erhalten und werden nachgesendet", async ({ page, context }) => {
  await getAdmin().rpc("import_notes_for", {
    p_user: userId,
    p_notes: makeNotes("E2E Offline", 3),
    p_status: "approved",
    p_origin: "user",
  });
  await login(page);
  await page.goto("/study");
  await expect(page.getByRole("button", { name: "Antwort zeigen" })).toBeVisible();

  // Funkloch mitten in der Session: zwei Karten bewerten.
  await context.setOffline(true);
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Antwort zeigen" }).click();
    await page.getByTestId("grade-4").click();
  }
  await expect(page.getByText("2 Bewertungen warten auf Synchronisierung")).toBeVisible();
  expect(await count("review_logs")).toBe(0);

  // Die App-Hülle lädt auch ohne Netz (Service Worker), die Bewertungen bleiben gespeichert.
  await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "Du bist offline" })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("recall-outbox-v1") ?? "[]").length)).toBe(2);

  // Zurück im Netz: automatisch nachsenden, nichts doppelt.
  await context.setOffline(false);
  await expect.poll(() => count("review_logs")).toBe(2);
  expect(await count("cards", { state: 2 })).toBe(2);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("recall-outbox-v1")))
    .toBe("[]");
});

test("Anmeldung mit E-Mail und Passwort, Fehler bei falschem Passwort", async ({ page }) => {
  const password = "ein-langes-testpasswort-123";
  const { error } = await getAdmin().auth.admin.updateUserById(userId, { password });
  if (error) throw error;

  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill("e2e@recall.test");
  await page.getByLabel(/Passwort/).fill("falsches-passwort-000");
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.locator("main [role=alert]")).toContainText("Passwort ist falsch");

  await page.getByLabel(/Passwort/).fill(password);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL("**/");
  await expect(page.getByRole("heading", { name: "Heute" })).toBeVisible();

  // Die Sitzung überlebt einen Neustart der Seite (wichtig für die iPhone-App).
  await page.reload();
  await expect(page.getByRole("heading", { name: "Heute" })).toBeVisible();
});

test("Alle Entwürfe auf einmal annehmen", async ({ page }) => {
  await getAdmin().rpc("import_notes_for", { p_user: userId, p_notes: makeNotes("E2E Sammelfreigabe", 4) });
  await login(page);
  await page.goto("/review");
  await expect(page.getByTestId("draft-note")).toBeVisible();

  await page.getByRole("button", { name: "Alle annehmen" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Alle 5 offenen Entwürfe annehmen?");
  await expect(dialog).toContainText("1 davon haben einen Hinweis");

  // Abbrechen ändert nichts.
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  expect(await count("notes", { status: "draft" })).toBe(5);

  await page.getByRole("button", { name: "Alle annehmen" }).click();
  await page.getByRole("button", { name: "Ja, alle annehmen" }).click();
  await expect(page.getByText("Alles gesichtet")).toBeVisible();
  await expect(page.getByText("5 angenommen · 0 verworfen")).toBeVisible();
  expect(await count("notes", { status: "approved" })).toBe(5);
  expect(await count("cards")).toBe(5); // 4 Basic + 1 Cloze
});

test("Bildkarte: verdecktes Element auf der Vorderseite, aufgedeckt auf der Rückseite", async ({ page }) => {
  const admin = getAdmin();
  const image = `${userId}/e2e-slide.png`;
  const png = readFileSync(path.join(__dirname, "../public/icons/icon-512.png"));
  const { error: uploadError } = await admin.storage
    .from("slides")
    .upload(image, png, { contentType: "image/png", upsert: true });
  if (uploadError) throw uploadError;

  const { error } = await admin.rpc("import_notes_for", {
    p_user: userId,
    p_status: "approved",
    p_notes: [
      {
        course: "E2E Bildkarten",
        source: "VL01.pdf",
        source_ref: "Folie 18",
        type: "basic",
        format: "bild",
        warum_relevant: "Testkarte für die E2E-Tests.",
        front: "Which party is hidden in the fund structure?",
        back: "The general partner (GP).",
        image_path: image,
        occlusion: { x: 0.3, y: 0.3, w: 0.4, h: 0.2 },
      },
    ],
  });
  if (error) throw error;

  await login(page);
  await page.goto("/study");
  const slide = page.getByTestId("slide-image");
  await expect(slide.locator("img")).toBeVisible();
  await expect(page.getByTestId("occlusion-hidden")).toBeVisible();
  await expect(page.getByTestId("occlusion-revealed")).toHaveCount(0);

  await page.getByRole("button", { name: "Antwort zeigen" }).click();
  await expect(page.getByTestId("occlusion-revealed")).toBeVisible();
  await expect(page.getByTestId("answer")).toContainText("general partner");

  // Zugriffsregel des privaten Speichers: eigener Ordner ja, fremder Ordner nein.
  const foreignPath = "00000000-0000-0000-0000-000000000000/fremd.png";
  await admin.storage.from("slides").upload(foreignPath, png, { contentType: "image/png", upsert: true });
  const results = await page.evaluate(
    async ({ own, foreign }) => {
      const raw = localStorage.getItem("recall-auth");
      const token = raw ? (JSON.parse(raw) as { access_token: string }).access_token : "";
      const base = document.querySelector<HTMLImageElement>("[data-testid=slide-image] img")!.src.split("/storage/v1/")[0];
      const sign = (objectPath: string) =>
        fetch(`${base}/storage/v1/object/sign/slides/${objectPath}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, apikey: token, "Content-Type": "application/json" },
          body: JSON.stringify({ expiresIn: 60 }),
        }).then((response) => response.status);
      return { own: await sign(own), foreign: await sign(foreign) };
    },
    { own: image, foreign: foreignPath },
  );
  expect(results.own).toBe(200);
  expect(results.foreign).not.toBe(200);
});

test("Bildpfade in fremden Ordnern werden beim Import abgelehnt", async () => {
  const { error } = await getAdmin().rpc("import_notes_for", {
    p_user: userId,
    p_notes: [
      {
        course: "E2E Bildkarten",
        source: "VL01.pdf",
        source_ref: "Folie 1",
        type: "basic",
        format: "bild",
        warum_relevant: "Test",
        front: "Q",
        back: "A",
        image_path: "00000000-0000-0000-0000-000000000000/fremd.png",
        occlusion: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
      },
    ],
  });
  expect(error?.message).toContain("image_path_foreign_folder");
});

test("Quelle anzeigen: ganze Folie bzw. Textabschnitt per Button", async ({ page }) => {
  const admin = getAdmin();
  const slidePath = `${userId}/e2e-source-slide.png`;
  const textPath = `${userId}/e2e-source-step.md`;
  const png = readFileSync(path.join(__dirname, "../public/icons/icon-512.png"));
  await admin.storage.from("slides").upload(slidePath, png, { contentType: "image/png", upsert: true });
  await admin.storage
    .from("slides")
    .upload(textPath, Buffer.from("# Lernpfad\n\n### Step 2: Uses and sources\n\nSenior debt is sized on EBITDA.\n\n| Assumption | Value |\n| --- | --- |\n| Leverage | 3.5x |\n"), {
      contentType: "text/markdown",
      upsert: true,
    });

  const note = (front: string, view: object) => ({
    course: "E2E Quellen",
    source: "VL01.pdf",
    source_ref: "Folie 7",
    type: "basic",
    format: "warum",
    warum_relevant: "Test.",
    front,
    back: "Answer.",
    source_view: view,
  });
  const { error } = await admin.rpc("import_notes_for", {
    p_user: userId,
    p_status: "approved",
    p_notes: [
      note("Card with slide?", { items: [{ kind: "image", label: "Folie 7", path: slidePath }] }),
      note("Card with text?", { items: [{ kind: "text", label: "Lernpfad: Step 2", path: textPath }] }),
    ],
  });
  if (error) throw error;

  await login(page);
  await page.goto("/study");
  const seen = new Set<string>();
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Antwort zeigen" }).click();
    // Vor dem Aufklappen ist keine Quelle geladen.
    await expect(page.getByTestId("source-panel")).toHaveCount(0);
    const front = (await page.getByTestId("study-card").innerText()).split("\n")[0];
    await page.getByTestId("source-toggle").click();
    if (front.includes("slide")) {
      await expect(page.getByTestId("source-panel").getByTestId("slide-image").locator("img")).toBeVisible();
      await expect(page.getByTestId("source-panel")).toContainText("Folie 7");
      seen.add("slide");
    } else {
      await expect(page.getByTestId("source-text")).toContainText("Senior debt is sized on EBITDA.");
      await expect(page.getByTestId("source-text").locator("td", { hasText: "3.5x" })).toBeVisible();
      seen.add("text");
    }
    await page.getByTestId("source-toggle").click();
    await expect(page.getByTestId("source-panel")).toHaveCount(0);
    await page.getByTestId("grade-4").click();
  }
  expect([...seen].sort()).toEqual(["slide", "text"]);
});

test("Quellenansicht mit fremdem Speicherpfad wird beim Import abgelehnt", async () => {
  const { error } = await getAdmin().rpc("import_notes_for", {
    p_user: userId,
    p_notes: [
      {
        course: "E2E Quellen",
        source: "VL01.pdf",
        source_ref: "Folie 1",
        type: "basic",
        format: "warum",
        warum_relevant: "Test",
        front: "Q?",
        back: "A",
        source_view: { items: [{ kind: "image", label: "Folie 1", path: "00000000-0000-0000-0000-000000000000/x.png" }] },
      },
    ],
  });
  expect(error?.message).toContain("source_view_not_uploaded_or_foreign");
});
