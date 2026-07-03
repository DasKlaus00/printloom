# Printloom — Roadmap

10 Phasen × 10 Features. Grob nach Wert/Reihenfolge sortiert: Phase 1 ist der
aktuelle Schmerz (Filament/AMS-Zuverlässigkeit), danach Onboarding, dann Ausbau
Richtung Druckfarm-Plattform. „(teils da)" = existiert in Grundzügen und wird
ausgebaut.

> **Zwei sofort gemeldete Probleme** (in Phase 1/2 oben eingeordnet):
> - AMS nahm beim Druck ein **falsches Filament** („Latte Brown"), obwohl mit
>   *PLA Dark Red* gesliced wurde **und** Slot 3 *PLA Dark Red* (`#BB3D43`) geladen
>   war → **exakter Treffer muss immer gewinnen** (Phase 1.1–1.3).
> - **Zeitzone im Setup-Wizard** verpflichtend abfragen (Phase 2.1).

> **~~Durchgestrichen~~ = umgesetzt** (Kern vorhanden & nutzbar; einige mit „teils da"
> markierte werden laut Roadmap noch ausgebaut). Stand: **v1.0.98** (2026-07).

---

## Phase 1 — Filament & AMS-Zuverlässigkeit *(höchste Priorität)*
1. **Pro-Datei Filament „festnageln"** beim Upload (Material + Farbe je Extruder verbindlich, wie Printago „Configure") — kein Auto-Raten mehr.
2. ~~**Exakter-Treffer-Vorrang:** ist die exakte Farbe/Material-Kombi im AMS, wird IMMER dieser Slot genommen, nie eine farbähnliche Alternative.~~
3. **AMS-Mapping-Vorschau vor dem Druck:** je Slicer-Filament → gewählter AMS-Slot mit Ampel (exakt / ähnlich / fehlt), bestätigbar.
4. ~~**„Nur exakt"-Modus** pro Datei/Projekt: lieber pausieren als Ersatzfarbe drucken.~~
5. ~~**Manuelles AMS-Override persistent** pro Datei (Server statt localStorage) — übersteht Reload/Gerätewechsel.~~
6. ~~**Farbnamen-Auflösung:** AMS-Farbcodes ↔ Klartext (Firebrick, Charcoal, Dark Red …) inkl. Bambu-Katalog.~~
7. **Rest­mengen-Tracking** je AMS-Slot + Warnung „reicht nicht für den Job" (Gramm-Abgleich).
8. **Slot-Belegung manuell pflegen**, wenn das AMS nichts meldet (Generic-Spulen ohne RFID).
9. ~~**Auswahl-Protokoll:** bei jedem Start loggen, welches Filament warum gewählt wurde (Audit gegen genau diesen Bug).~~
10. **Material-Profile** (Marke/Typ/Düsentemp/Trockenstatus) zentral verwalten und an Dateien hängen.

## Phase 2 — Onboarding & Setup-Wizard
1. ~~**Zeitzone im Wizard** (Pflichtschritt, aus Browser vorbelegt, speicherbar).~~
2. ~~**Geführtes Erst-Setup:** Drucker → OTTOeject → Regal kalibrieren → Testlauf, Schritt für Schritt.~~
3. ~~**Verbindungs-Selbsttest** (X1C MQTT/FTP, Klipper/Moonraker) mit Klartext-Fehlern + Lösungsvorschlägen.~~
4. **Regal-Kalibrier-Assistent** mit Live-Vorschau (Fachhöhe, Toleranz, Magazin). *(Live-Vorschau + Fachhöhe da; Toleranz/Magazin fehlen noch)*
5. **AMS-Erkennungs-Check** im Wizard (geladene Slots zur Kontrolle anzeigen).
6. ~~**Demo-/Beispieldaten** laden (Beispiel-Teil + Sequenz) zum Ausprobieren ohne echten Druck.~~
7. ~~**Backup/Restore** der gesamten Konfiguration als eine Datei.~~
8. **Sprachwahl** ganz am Anfang (DE/EN). *(Sprachen DE/EN da, aber nicht als Wizard-Schritt)*
9. ~~**Health-Check nach Setup:** Checkliste, was konfiguriert ist / was fehlt.~~
10. **„Was ist neu"** beim ersten Start nach Update + Update-Hinweis. *(Update-Hinweis + Changelog da; „was ist neu"-Popup beim ersten Start fehlt)*

## Phase 3 — Warteschlange & Planung
1. Drag-&-Drop stabiler + **Mehrfachauswahl** verschieben.
2. **„Als nächstes drucken" / Pinnen** ohne komplettes Umsortieren.
3. **Wiederkehrende Jobs / geplante Läufe** (z. B. jeden Abend X).
4. ~~**Endzeit-Prognose** je Job inkl. Betriebszeiten~~ *(da; weiter ausbaubar)*.
5. **„Was-wäre-wenn"-Planer:** Reihenfolge testen, bevor man speichert.
6. **Smart-Sort ausbauen:** Filament-Gruppierung → weniger Spulenwechsel.
7. **Wartungsfenster** einplanen (z. B. Düsenreinigung nach N Stunden).
8. **Queue-Richtlinien** als Vorabprüfung (max. Höhe, nur passende Materialien).
9. **Job-Abhängigkeiten / Sets** (erst A, dann B; zusammen drucken).
10. **Warteschlange exportieren/importieren** + teilen.

## Phase 4 — Teile-Bibliothek, SKUs & Organisation
1. **Mehrere Plates/Varianten je Teil** verwalten (Printago „Plates").
2. **SKUs = Stückliste:** ein Produkt aus mehreren Teilen, ein Klick reiht alle ein.
3. **Tags / Print-Tags** + gespeicherte Filter / Smart-Ordner.
4. **Datei-Versionierung** (Replace mit Historie, Rückrollen).
5. **„Reprocess Metadata"**: Slicer-Daten neu auslesen (Zeit, Gramm, Farben, Kompatibilität).
6. **Kompatibilität anzeigen** (Druckermodell, Düse, Platte) + Warnung bei Inkompatibilität.
7. **Bulk-Aktionen** ausbauen (verschieben, taggen, löschen).
8. **Thumbnails je Plate** + 3D-Vorschau.
9. **Duplikate-Erkennung** beim Upload (Hash).
10. **Such-Index** über Name/SKU/Tag/Material/Farbe mit Schnellfiltern.

## Phase 5 — Drucker-, OTTOeject- & Hardware-Steuerung
1. **Mehrere Sequenz-Profile** je Drucker/Workflow.
2. ~~**Sequenz-Editor mit Einzel-Schritt-Test** (Makro testen)~~ *(da; inkl. Printloom-Op-Schritt seit v1.0.98)*.
3. **Kalibrier-Routinen** (Bett, Flow, Platten-Offset) per Knopf.
4. **OTTOeject-Jog-Steuerung** (manuelles Verfahren) mit Sicherheits-Limits.
5. **Druckplatten-/Magazin-Verwaltung** (welche Platte liegt wo, Typ je Platte).
6. **Multi-Schrank-Vorbereitung** (mehrere Regale, X1C-Position links/rechts).
7. **Notaus / sicheres Parken** zentral.
8. **Klipper-/Firmware-Status** + Neustart-Buttons.
9. ~~**Steckdosen-/Energiesteuerung** (Smart-Plug, Auto-Aus nach Leerlauf)~~ *(da)*.
10. **Hardware-Profil je Drucker** (Düse, max. Höhe, Bauraum) für die Kompatibilitätsprüfung.

## Phase 6 — Überwachung, Kamera & Fehlererkennung
1. **Mehrere Kameras** (X1C intern + extern) + Aufnahme/Zeitraffer je Job.
2. **Fehlschlag-/Spaghetti-Erkennung** → Auto-Pause.
3. **HMS-Historie** mit Lösungen (aufbauend auf v1.0.63). *(HMS live erkannt/gemeldet; durchsuchbare Historie fehlt)*
4. **Live-Overlay** im Bild (Schicht, %, Restzeit, Temperaturen).
5. **Benachrichtigungen ausbauen** (Telegram/Push/E-Mail bei Start/Ende/Fehler/Filament leer). *(Web-Push da; Telegram/E-Mail fehlen)*
6. ~~**Verbindungs-Watchdog** + Alarm bei Abriss~~ *(da)*.
7. ~~**Stillstands-Erkennung** (kein Fortschritt) → Pause/Alarm~~ *(da)*.
8. ~~**Schnappschuss-Galerie** je Job (vorher/nachher)~~ *(da)*.
9. **Handy-Fernsteuerung** (PWA) inkl. Pause/Stop/Fortsetzen.
10. **Ereignis-Zeitleiste** je Drucker mit Filter.

## Phase 7 — Multi-Drucker & Skalierung
1. **Mehrere Drucker** verwalten (echte Druckfarm).
2. **Job-Verteilung** auf passenden Drucker (Material/Größe/Auslastung).
3. **Pro-Drucker-Queue** + globale Übersicht.
4. **Lastausgleich** / „nächster freier Drucker".
5. **Drucker-Gruppen / Standorte.**
6. **Gemeinsamer Spulen-/Material-Pool** über Drucker hinweg.
7. **Mehrbenutzer & Rollen** (wer darf was).
8. **Pro-Drucker-Sequenzen & -Kalibrierung.**
9. **Reservierung/Sperren** eines Druckers (Wartung).
10. **Skalierung absichern** (viele Jobs/Dateien performant).

## Phase 8 — Analytics, Kosten & Reporting
1. **Kosten je Job/Teil** (Material + Strom + Maschinenstunde — teils da → ausbauen).
2. **Material-Verbrauch** je Farbe/Marke über Zeit.
3. **Auslastung/Erfolgsquote/Fehlerstatistik** je Drucker.
4. **Durchsatz-Report** (Teile/Tag, Druckstunden).
5. **Energie-Report** (kWh, Kosten — teils da).
6. **Export** als CSV/PDF.
7. **Preis-/Angebotskalkulation** je Teil (Marge).
8. **Verbrauchsprognose** + Nachbestell-Hinweis für Filament.
9. ~~**Echte-Druckzeiten-Historie** → bessere Schätzungen~~ *(da)*.
10. **Frei anordbare Dashboards/Widgets** (teils da → ausbauen).

## Phase 9 — Aufträge, SKUs & Fulfillment
1. **Orders:** Kunde + Positionen (SKUs/Mengen) → automatisch in die Queue.
2. **Auftragsstatus** (offen/druckt/fertig/versendet) + Fortschritt.
3. **Shop-Anbindung** (Etsy/Shopify/WooCommerce) → Bestellung = Druckauftrag.
4. **Label-/Lieferschein-Druck.**
5. **Lagerbestand fertiger Teile** (auf Lager/verkauft).
6. ~~**Chargen-/Serien-Druck** (N Stück eines SKU) mit Abhaken (Projekt-Tab)~~ *(da; weiter ausbaubar)*.
7. **Kunden-/Projekt-Zuordnung** je Druck.
8. **Priorisierung nach Liefertermin.**
9. **Wiederholbestellung** mit einem Klick.
10. **Rechnungs-/Kostenübersicht** je Auftrag.

## Phase 10 — Integration, API & Erweiterbarkeit
1. **Öffentliche REST-API** + API-Keys.
2. **Webhooks** (Job-Start/-Ende/-Fehler) für eigene Automatisierungen.
3. **Home Assistant / MQTT**-Integration (Status, Steuerung). *(HA-Kamera-Proxy da; Status/Steuerung fehlen)*
4. **Slicer-Hotfolder/-Plugin:** direkt aus OrcaSlicer/Bambu Studio nach Printloom.
5. **Drag-&-Drop-Upload aus dem Slicer** („Hot Drop"-Stil).
6. **PWA/Mobile** verbessern (Offline, Push, Home-Screen). *(PWA/Push/Home-Screen da; Offline-Ausbau offen)*
7. **Plugin-/Addon-System** (eigene Schritte/Integrationen).
8. **Weitere Sprachen** ausbauen.
9. **SSO / Reverse-Proxy / HTTPS-Anleitung** + Auth.
10. **Sicherer Remote-Zugriff / Cloud-Sync** für unterwegs.
