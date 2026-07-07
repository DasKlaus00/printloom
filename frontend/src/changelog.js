/* Patchnotes der letzten Updates — zweisprachig (de/en), neueste zuerst.
   Wird auf der System-Seite unter „Version" angezeigt. Bei jedem Release oben
   einen Eintrag ergänzen (die Anzeige zeigt die neuesten fünf). */

export const CHANGELOG = [
  {
    version: '1.0.125',
    de: [
      'Kein F5 mehr nötig: Alle Seiten frischen ihre Daten jetzt automatisch auf, sobald sie wieder in den Vordergrund kommen (Seitenwechsel, Tab-Fokus, PWA wieder geöffnet) — Auto-Farm-Regal & Dateiliste, Filament-Bibliothek, Profile, Projekte und die OTTOeject-Position in der Steuerung. Formulareingaben werden dabei nicht überschrieben (ausstehende Speicherungen haben Vorrang).',
      'Aufgeräumt: alter, ungenutzter Code entfernt (Alt-Queue-Router samt UI-Panel, verwaister MQTT-Queue-Manager, Legacy-Port-6000-Kamera) — keine Funktionsänderung, weniger Ballast.',
    ],
    en: [
      'No more F5: all pages now refresh their data automatically when they come back to the foreground (page switch, tab focus, PWA reopen) — Auto Farm rack & file list, filament library, profiles, projects and the OTTOeject position in Control. Form input is never clobbered (pending saves take precedence).',
      'Cleanup: removed old unused code (legacy queue router incl. UI panel, orphaned MQTT queue manager, legacy port-6000 camera) — no functional change, less ballast.',
    ],
  },
  {
    version: '1.0.124',
    de: [
      'Warteschlange räumt sich mit dem Regal auf: Fertige Jobs bleiben sichtbar, solange ihre Platte im Regal liegt — wird das Fach geleert (✓, ↻ oder „Alle entnehmen"), verschwindet der zugehörige fertige Job auch aus der Warteschlange. Unten stehen damit nur noch aktive/wartende Jobs und die fertigen, deren Platte noch im Regal ist.',
    ],
    en: [
      'Queue cleans up with the rack: finished jobs stay visible while their plate sits in the rack — once the slot is cleared (✓, ↻ or “Remove all”), the corresponding finished job disappears from the queue as well. What remains below are only active/waiting jobs and the finished ones whose plate is still in the rack.',
    ],
  },
  {
    version: '1.0.123',
    de: [
      'Magazin leer: Der OTTOeject PARKT jetzt (statt vor dem Regal stehen zu bleiben), die Farm pausiert; nach dem Auffüllen + Fortsetzen homt er neu und holt die Platte aus dem JETZT aktiven Magazin. Behebt auch den Fehler, dass er nach dem Auffüllen zum falschen Regal fuhr (z. B. R3 statt R1): das Magazin-Regal wurde vor der Leer-Pause festgelegt und bei „alle leer" auf das letzte Regal gesetzt — jetzt wird es nach dem Auffüllen frisch bestimmt.',
      'Regal-Ansicht: Jedes Regal zeigt jetzt sein Magazin (📦 mit Bestand) — die Zahl lässt sich direkt dort setzen (Enter/Klick daneben), z. B. nach dem Auffüllen eines einzelnen Magazins.',
      'Umsortieren bei laufender Farm zuverlässig: Die neue Reihenfolge wird jetzt IMMER an die laufende Farm gemeldet (vorher konnte sie bei kurz veraltetem Verbindungsstatus nur in der gespeicherten Datei landen — die UI zeigte die neue Reihenfolge, gedruckt wurde die alte). Das Farm-Log bestätigt jede Umsortierung mit einer „↕"-Zeile.',
    ],
    en: [
      'Empty magazine: the OTTOeject now PARKS (instead of idling in front of the rack) and the farm pauses; after refilling + resume it re-homes and grabs from the magazine that is active NOW. Also fixes it driving to the wrong rack after refilling (e.g. R3 instead of R1): the magazine rack was resolved before the empty-pause and defaulted to the last rack when all were empty — it is now re-resolved after refilling.',
      'Rack view: each rack now shows its magazine (📦 with stock) — the number can be set right there (Enter/click away), e.g. after refilling a single magazine.',
      'Reordering while the farm runs is reliable now: the new order is ALWAYS reported to the running farm (previously, with a briefly stale connection status, it could end up only in the saved file — the UI showed the new order, but the old one was printed). The farm log confirms every reorder with a “↕” line.',
    ],
  },
  {
    version: '1.0.122',
    de: [
      'Warteschlangen-Karten zeigen jetzt bei jedem wartenden Job die Slicer-Prognose seiner Platte (z. B. „~1 h 22 min" bei kurzen, „~4 h 32 min" bei langen Platten) — vorher stand dort bei wartenden Jobs gar keine Zeit. Ergänzt die Planer-/ETA-Korrektur aus v1.0.121: die Zeit pro Platte steht damit überall einzeln.',
    ],
    en: [
      'Queue cards now show the slicer prediction of each waiting job’s plate (e.g. “~1 h 22 min” for short, “~4 h 32 min” for long plates) — previously waiting jobs showed no time at all. Complements the planner/ETA fix from v1.0.121: the per-plate time now appears individually everywhere.',
    ],
  },
  {
    version: '1.0.121',
    de: [
      'Planer/ETA: Multi-Plate-Jobs rechnen jetzt mit der Slicer-Zeit IHRER Platte statt pauschal mit der Zeit der ersten Platte (vorher: 16 × „3 h 20 min", obwohl die Platten 1,3–4,5 h brauchen). Die Zeiten pro Platte kommen aus der Datei (slice_info „prediction"); der laufende Job nutzt weiter die Live-Restzeit. Gesamtzeit und Fertig-Uhrzeit der Warteschlange stimmen damit deutlich genauer.',
    ],
    en: [
      'Planner/ETA: multi-plate jobs now use the slicer time of THEIR plate instead of blanket-using the first plate’s time (before: 16 × “3 h 20 min” although the plates take 1.3–4.5 h). Per-plate times come from the file (slice_info “prediction”); the running job keeps using the live remaining time. Queue total and finish time are much more accurate now.',
    ],
  },
  {
    version: '1.0.120',
    de: [
      'Warteschlange: „neue Jobs erscheinen erst nach F5" behoben. Ursache war ein Wettlauf zwischen dem Hinzufügen aus der Datei-Bibliothek und dem automatischen Speichern der Auto-Farm-Seite: deren verzögerter Speichervorgang konnte die frisch geschriebene Server-Queue mit dem alten Stand überschreiben. Beim Queue-Änderungs-Signal wird der anstehende Auto-Save jetzt verworfen; zusätzlich lädt die Auto-Farm-Seite die Queue neu, sobald der Tab wieder in den Vordergrund kommt (F5 nicht mehr nötig).',
    ],
    en: [
      'Queue: fixed “new jobs only appear after F5”. Cause was a race between adding from the file library and the Auto Farm page’s debounced auto-save: the delayed save could overwrite the freshly written server queue with the old state. The pending auto-save is now discarded on the queue-change signal; additionally the Auto Farm page reloads the queue whenever the tab regains focus (no more F5 needed).',
    ],
  },
  {
    version: '1.0.119',
    de: [
      'Multi-Plate-Dateien: minutenlange „Vorbereitung 100 %" am Drucker behoben. Printloom schickte bisher das komplette Projekt (z. B. 16 Platten ≈ 38 MB) — der X1C musste alles auspacken und parsen. Jetzt wird beim Senden nur die gewählte Platte in eine kleine Einzel-Platten-.3mf umgepackt (wie Bambu Studio es macht): G-code unverändert, Filament-/AMS-Infos der Platte bleiben erhalten, Upload-Größe typisch ~3 MB statt 38 MB. Gilt für Farm-Jobs (je Platte) und Direktsenden.',
    ],
    en: [
      'Multi-plate files: fixed the minutes-long “preparing 100%” on the printer. Printloom used to send the whole project (e.g. 16 plates ≈ 38 MB) — the X1C had to unpack and parse all of it. Now only the selected plate is repacked into a small single-plate .3mf when sending (like Bambu Studio does): G-code unchanged, the plate’s filament/AMS info is preserved, upload size typically ~3 MB instead of 38 MB. Applies to farm jobs (per plate) and direct send.',
    ],
  },
  {
    version: '1.0.118',
    de: [
      'Steuerung: AMS-Aktionen direkt im Panel — je Slot „⟳" (Slot neu einlesen, wenn die Spule nicht erkannt wurde) und „⬆" (dieses Filament in den Extruder laden), oben „⬇ Entladen" (aktuelles Filament zurück ins AMS). Laden nutzt automatisch die Düsentemperatur der Spule; während eines laufenden Drucks sind Laden/Entladen gesperrt (Pause ist ok).',
    ],
    en: [
      'Control: AMS actions directly in the panel — per slot “⟳” (re-read the slot when the spool was not recognized) and “⬆” (load this filament into the extruder), plus “⬇ Unload” at the top (current filament back into the AMS). Loading automatically uses the spool’s nozzle temperature; loading/unloading is blocked while a print is running (pause is fine).',
    ],
  },
  {
    version: '1.0.117',
    de: [
      'Drucker-Tab: neue Zeile zum direkten Senden von G-code an den OTTOeject (für die Kalibrierung) — Befehl eintippen, Enter oder „▶ Senden", Ergebnis erscheint in der Statuszeile und unter „Gesendeter G-code". RACK=-Nummern werden dabei automatisch in die Geräte-Zählung übersetzt.',
    ],
    en: [
      'Printer tab: new line to send G-code directly to the OTTOeject (for calibration) — type a command, press Enter or “▶ Send”, the result shows in the status line and under “Sent G-code”. RACK= numbers are translated to the device numbering automatically.',
    ],
  },
  {
    version: '1.0.116',
    de: [
      'Kompletter Stabilitäts-Scan nach den gemeldeten Hängern — drei Ursachen gefunden und behoben: 1) Der Live-Kanal (WebSocket) konnte an EINEM halbtoten Client (eingeschlafenes Handy/Tab) hängenbleiben — alle anderen Ansichten bekamen dann keine Updates mehr und die App wirkte eingefroren; Sendevorgänge haben jetzt ein Timeout und tote Clients fliegen raus. 2) Die Farm-Warteschleifen forderten über Stunden alle ~2 s einen Vollreport vom Drucker an — unnötige Dauerlast auf der MQTT-Verbindung (der X1C meldet Änderungen von selbst); jetzt höchstens alle 5 s. 3) Push-Benachrichtigungen ohne Timeout konnten die Farm im Moment einer Meldung unbegrenzt anhalten — jetzt max. 10 s.',
    ],
    en: [
      'Full stability scan after the reported freezes — found and fixed three causes: 1) The live channel (WebSocket) could stall on ONE half-dead client (sleeping phone/tab) — all other views then stopped receiving updates and the app appeared frozen; sends now have a timeout and dead clients are dropped. 2) The farm wait loops requested a full report from the printer every ~2 s for hours — needless constant load on the MQTT connection (the X1C reports changes on its own); now at most every 5 s. 3) Push notifications without a timeout could halt the farm indefinitely at the moment of a message — now max. 10 s.',
    ],
  },
  {
    version: '1.0.115',
    de: [
      'AMS-Fehler am Drucker behoben, wenn eine Datei nicht mit Filament 1 gesliced wurde: Der X1C erwartet die AMS-Zuordnung pro Slicer-Filament-Nummer — druckt eine Datei z. B. nur mit Filament 3, hieß das gesendete Mapping bisher trotzdem „[Spule]" (= Zuordnung für Filament 1, Filament 3 blieb leer) → der Drucker meldete eine unpassende AMS-Zuordnung und blieb beim Aufheizen stehen. Jetzt wird das Mapping auf die richtigen Slot-Positionen gehoben (unbenutzte Filamente = -1, wie Bambu Studio). Gilt für Farm, Direktsenden und manuelle Zuordnungen.',
    ],
    en: [
      'Fixed the AMS error on the printer when a file was not sliced with filament 1: the X1C expects the AMS mapping indexed by slicer filament number — if a file prints only with filament 3, the sent mapping was still “[tray]” (= assignment for filament 1, filament 3 left unmapped) → the printer reported a mismatched AMS mapping and stalled while heating. The mapping is now lifted to the correct slot positions (unused filaments = -1, like Bambu Studio). Applies to farm, direct send and manual assignments.',
    ],
  },
  {
    version: '1.0.114',
    de: [
      'Warteschlange aufgeräumt: Jobs zeigen jetzt fest ihr Produkt (kein Datei-Dropdown mehr am Job — die Datei eines Jobs ändert man nicht, man legt Jobs in der Datei-Bibliothek an; dort geht dasselbe Produkt beliebig oft in die Queue: mehrfach „+ Queue" klicken oder über die Auswahl-Leiste mit Menge). Der ⚡-Smart-Sortier-Knopf wurde entfernt.',
    ],
    en: [
      'Queue cleaned up: jobs now show their product as fixed text (no more file dropdown on the job — you don’t change a job’s file, you create jobs in the file library; there the same product can be queued any number of times: click “+ Queue” repeatedly or use the selection bar with quantity). The ⚡ smart-sort button was removed.',
    ],
  },
  {
    version: '1.0.113',
    de: [
      'App-Hänger behoben („Seite lädt ewig, nur Neustart hilft"): War der Drucker aus oder unerreichbar, versuchte jede Status-Abfrage einen kompletten MQTT-Neuverbindungsaufbau (~6 s) — die Anfragen stauten sich schneller auf, als sie scheitern konnten, blockierten dabei Datenbank-Verbindungen und legten so nach und nach die ganze App lahm. Jetzt: Nach einem fehlgeschlagenen Verbindungsversuch antwortet der Status 20 s lang sofort aus dem Cache (offline), statt erneut zu verbinden; die Status-Anfrage hat zusätzlich eine 10-s-Notbremse. Außerdem gestopft: Ein Verbindungs-Timeout ließ die offene Verbindung liegen (Datei-Handle-Leck — nach Stunden ging gar nichts mehr, bis zum Neustart).',
    ],
    en: [
      'Fixed app freezes (“page loads forever, only a restart helps”): with the printer off or unreachable, every status poll attempted a full MQTT reconnect (~6 s) — requests piled up faster than they could fail, held database connections and gradually froze the whole app. Now: after a failed connection attempt, status responds instantly from cache (offline) for 20 s instead of reconnecting; the status request also has a 10 s emergency timeout. Also plugged: a connection timeout left the open connection behind (file-handle leak — after hours nothing worked until a restart).',
    ],
  },
  {
    version: '1.0.112',
    de: [
      'Standard-Sequenzen nutzen jetzt Printloom-Ops statt Geräte-Macros: Tür öffnen/schließen, Aus Magazin holen, Platte einlegen, Vor Drucker fahren, Auswerfen und Zurücklegen laufen als App-Bausteine über die Drucker-Tab-Geometrie bzw. deinen eigenen G-code mit Platzhaltern — nur so skalieren die Bewegungen korrekt über mehrere Regale (inkl. Magazin-Durchbiegung und Geschwindigkeit pro Operation). Nur OTTOeject homen/Parken bleiben Geräte-Macros (Endstops). Der ⏱-Vorstart unterstützt Printloom-Ops jetzt ebenfalls. Zum Übernehmen: im Sequenz-Editor je Karte „↺ Standard".',
    ],
    en: [
      'Default sequences now use Printloom ops instead of device macros: open/close door, grab from magazine, place plate, move to printer, eject and store run as app blocks through the printer-tab geometry or your custom G-code with placeholders — only then do the motions scale correctly across multiple racks (incl. magazine sag and per-operation speed). Only OTTOeject home/park remain device macros (endstops). The ⏱ pre-start now supports Printloom ops as well. To adopt: press “↺ Default” per card in the sequence editor.',
    ],
  },
  {
    version: '1.0.111',
    de: [
      'Übergabe First Start → Zyklus vervollständigt: Beim 1. Job überspringt der Zyklus jetzt ALLES bis einschließlich seines Griff-Schritts — nicht nur den Griff. Vorher wäre z. B. „Tür öffnen" vor dem Griff nochmal gelaufen, mit der Platte im Greifer (Tür war schon offen — unnötige Fahrt, Kollisionsrisiko). Der grüne Marker im Editor sagt es jetzt genau so; das Farm-Log listet die übersprungenen Schritte auf. Sicherheits-Fallback: steckt der Griff in einer ∥-Gruppe oder liegt ein Datei-/Warteschritt davor, wird wie bisher nur der Griff selbst übersprungen.',
    ],
    en: [
      'First Start → cycle handover completed: on job 1 the cycle now skips EVERYTHING up to and including its grab step — not just the grab. Previously e.g. “open door” before the grab would have run again, with the plate in the gripper (door already open — pointless move, collision risk). The green marker in the editor now says exactly that; the farm log lists the skipped steps. Safety fallback: if the grab sits in a ∥ group or a file/wait step precedes it, only the grab itself is skipped as before.',
    ],
  },
  {
    version: '1.0.110',
    de: [
      'Sequenz-Editor: deutliche Warnung, wenn der Zyklus keinen Griff-Schritt mehr hat (z. B. als vermeintliche „Dopplung" zum First Start gelöscht) — ab Job 2 würde sonst keine neue Platte geholt. Der Übergabe-Marker erklärt jetzt explizit: Job 1 überspringt den Zyklus-Griff automatisch, ab Job 2 greift er normal — er ist KEINE Dopplung.',
    ],
    en: [
      'Sequence editor: clear warning when the cycle has no grab step left (e.g. deleted as a supposed “duplicate” of First Start) — from job 2 on, no new plate would be fetched. The handover marker now states explicitly: job 1 skips the cycle grab automatically, from job 2 on it grabs normally — it is NOT a duplicate.',
    ],
  },
  {
    version: '1.0.109',
    de: [
      'Schnellerer Start: Beim Start-Knopf holt das OTTOeject die erste Platte jetzt, WÄHREND der Drucker noch homet — Standard-First-Start: Homing im Hintergrund starten (⏩) → OTTOeject homen → Tür öffnen → Platte holen → vor dem Drucker warten → „Auf Z200 warten". Die Homing-Datei fährt das Bett jetzt schnell auf Z200 (F3000 statt F600) und wird bei jedem Senden automatisch frisch erzeugt (kein „Erstellen" mehr nötig). Der Zyklus erkennt die schon gegriffene Platte und überspringt seinen Griff beim 1. Job automatisch.',
      'Sequenz-Editor aufgeräumt: klare Karten „First Start — einmal beim Start-Knopf" und „Zyklus — jeder Job", grüner Übergabe-Marker zeigt, wo der First Start in den Zyklus übergibt. ⏱ „Vor Druckende vorziehen" ist nur noch im Zyklus wählbar (dort gehört es hin). Bedingungen an einzelnen Schritten und „Optional/Fehler ignorieren" wurden entfernt — weniger versteckte Logik, vorhersehbarer Ablauf. Passende Schritt-Menüs pro Karte und eine kompakte, aktuelle Legende.',
    ],
    en: [
      'Faster start: when you press Start, the OTTOeject now fetches the first plate WHILE the printer is still homing — default First Start: start homing in the background (⏩) → home OTTOeject → open door → grab plate → wait in front of the printer → “Wait for Z200”. The homing file now moves the bed to Z200 fast (F3000 instead of F600) and is regenerated automatically on every send (no more “Create” needed). The cycle detects the already-grabbed plate and skips its own grab on job 1 automatically.',
      'Sequence editor cleaned up: clear “First Start — once when you press Start” and “Cycle — every job” cards, a green handover marker shows where First Start hands over into the cycle. ⏱ “run early before print end” is now only offered in the cycle (where it belongs). Per-step conditions and “optional/ignore errors” were removed — less hidden logic, more predictable runs. Matching add menus per card and a compact, up-to-date legend.',
    ],
  },
  {
    version: '1.0.108',
    de: [
      'Regal-Nummerierung jetzt ÜBERALL einheitlich: R1 = Regal direkt am Drucker. Die Klipper-Macros auf dem OTTOeject (GRAB_FROM_RACK/STORE_TO_RACK) zählen intern vom Homing-Punkt rechts — genau andersherum. Printloom übersetzt die RACK=-Nummer jetzt automatisch beim Senden (bei 3 Regalen: R1→3, R2→2, R3→1). Behebt: Anzeige sagte „R1 Fach 1", die Platte landete aber im Regal ganz rechts. Gilt für die Farm, den Sequenz-Test, die Konsole und eigene G-code-Overrides; die Übersetzung steht sichtbar im Farm-Log.',
    ],
    en: [
      'Rack numbering is now consistent EVERYWHERE: R1 = the rack right next to the printer. The Klipper macros on the OTTOeject (GRAB_FROM_RACK/STORE_TO_RACK) internally count from the homing point on the right — exactly the other way round. Printloom now translates the RACK= number automatically on send (with 3 racks: R1→3, R2→2, R3→1). Fixes: the display said “R1 slot 1” but the plate ended up in the rightmost rack. Applies to the farm, sequence tests, the console and custom G-code overrides; the translation is shown in the farm log.',
    ],
  },
  {
    version: '1.0.107',
    de: [
      'Magazin-Durchbiegung kompensiert: Die flach gestapelten Platten hängen durch — der Stapel liegt pro Platte ~1 mm tiefer. „Aus Magazin holen" senkt die Greif-Z jetzt automatisch um 1 mm je Platte im Magazin (6 Platten → Z−6, 4 → Z−4), pro Regal anhand des Magazin-Zählers. Gilt für die berechnete Bewegung UND den {mag_z}-Platzhalter im eigenen G-code. Ohne Zähler bleibt alles wie bisher.',
      'Drucker-Tab: Neue Magazin-Knöpfe je Regal (skaliert mit der Regalzahl) — ein Klick holt eine Platte aus dem jeweiligen Magazin (NOLIFT), daneben steht live, wie viele Platten noch drin sind. Die Entnahme zählt den Bestand automatisch runter, damit auch die Z-Absenkung der nächsten Entnahme stimmt. Auffüllen wie gehabt im Rack Manager.',
    ],
    en: [
      'Magazine sag compensated: the flat-stacked plates bend — the stack sits ~1 mm lower per plate. “Grab from magazine” now automatically lowers the grab Z by 1 mm per plate in the magazine (6 plates → Z−6, 4 → Z−4), per rack based on the magazine counter. Applies to the computed motion AND the {mag_z} placeholder in custom G-code. Without a counter nothing changes.',
      'Printer tab: new per-rack magazine buttons (scales with the number of racks) — one click grabs a plate from that rack’s magazine (NOLIFT), with a live count of the plates remaining next to it. Grabbing decrements the counter automatically so the next grab’s Z compensation stays correct. Refill as usual in the Rack Manager.',
    ],
  },
  {
    version: '1.0.106',
    de: [
      'Deutlich weniger CPU-Last: Die X1C-Kamera läuft jetzt über EINEN geteilten Video-Prozess pro Drucker — egal wie viele Ansichten/Geräte zuschauen (vorher: ein eigener ffmpeg PRO Zuschauer, je ~1 CPU-Kern, und da der Drucker nur EINEN Kamera-Zugriff erlaubt, warfen sich mehrere gegenseitig raus → Dauer-Reconnects, hohe Grundlast). Der Prozess stoppt ~5 s nachdem der letzte Zuschauer weg ist. Snapshots bedienen sich am laufenden Stream, statt ihn zu unterbrechen.',
      'Die Kamera in der Steuerung pausiert jetzt, wenn die Seite im Hintergrund ist (wie in Auto Farm) — vorher lief der Server-Transcode ewig weiter, sobald man die Steuerung einmal besucht hatte.',
      'Versteckte Seiten fragen nicht mehr dauerhaft Daten ab: Einmal besuchte Seiten bleiben zwar im Speicher (schneller Wechsel), aber ihr Auto-Refresh pausiert jetzt im Hintergrund und frischt beim Zurückwechseln sofort auf. Spart dauerhaft ~1–2 Anfragen pro Sekunde.',
      'Kleinere Einsparungen: Kammerlicht wird höchstens einmal pro Minute geschaltet (statt bei jedem Kamerabild), Kamera-Snapshots blockieren keine anderen Anfragen mehr, und der Live-Status (WebSocket + /status) überträgt die interne Drucker-Geometrie nicht mehr mit.',
    ],
    en: [
      'Much lower CPU load: the X1C camera now runs through ONE shared video process per printer — no matter how many views/devices watch (before: a separate ffmpeg PER viewer at ~1 CPU core each, and since the printer allows only ONE camera client they kept evicting each other → constant reconnects, high base load). The process stops ~5 s after the last viewer leaves. Snapshots reuse the running stream instead of interrupting it.',
      'The camera on the Control page now pauses when the page is in the background (like Auto Farm) — previously the server-side transcode ran forever once you had visited the page.',
      'Hidden pages no longer poll continuously: visited pages stay mounted (fast switching), but their auto-refresh now pauses in the background and refreshes immediately when you switch back. Saves a constant ~1–2 requests per second.',
      'Smaller savings: the chamber light is toggled at most once per minute (instead of on every camera frame), camera snapshots no longer block other requests, and the live status (WebSocket + /status) no longer transmits the internal printer geometry.',
    ],
  },
  {
    version: '1.0.105',
    de: [
      'Eigener G-code skaliert jetzt über mehrere Regale/Fächer. In den G-code-Feldern (Drucker-Tab) kannst du Platzhalter verwenden, die Printloom pro Regal/Fach einsetzt: {rack_x} = X-Position des Regals, {slot_z} = Z-Höhe des Fachs, {mag_z} = Z des Magazinfachs, {y_engage}/{y_pullback} = Y-Werte, {rack}/{slot} = Nummern. So schreibst du die Bewegung EINMAL und sie fährt jedes Regal (R1 am Drucker … Rn am Home-Ende) und jedes Fach korrekt an. Behebt: fixer G-code ohne Platzhalter schickte JEDES Regal an denselben Punkt (die fertige Platte landete immer im selben Fach).',
    ],
    en: [
      'Custom G-code now scales across racks/slots. In the G-code fields (Printer tab) you can use placeholders that Printloom fills in per rack/slot: {rack_x} = the rack’s X position, {slot_z} = the slot’s Z height, {mag_z} = magazine-slot Z, {y_engage}/{y_pullback} = Y values, {rack}/{slot} = numbers. Write the motion ONCE and it reaches every rack (R1 at the printer … Rn at the home end) and every slot correctly. Fixes: fixed G-code without placeholders sent EVERY rack to the same point (finished plates always landed in the same slot).',
    ],
  },
  {
    version: '1.0.104',
    de: [
      'Robuster nach einem Update: Ein Tab, der noch die alte Version geladen hatte, zeigte beim Seitenwechsel manchmal „Fehler auf dieser Seite — Unable to preload CSS …" (die neuen Build-Dateien haben neue Namen, die alten sind weg). Die App lädt jetzt in dem Fall automatisch EINMAL neu und holt die frische Version (mit Schutz gegen Endlos-Neuladen). Der „Neu laden"-Knopf lädt die Seite jetzt wirklich neu statt nur neu zu rendern.',
      'Die Status-Anzeigen „Drucker/Klipper" oben flackern beim Update nicht mehr sofort rot, wenn das Backend kurz neu startet — erst nach 2 Fehlversuchen, und die Anzeige erholt sich in Sekunden (schnelleres Nachfassen) statt erst beim nächsten 30-Sekunden-Poll. Behebt die „mal Network Error / alles rot"-Aussetzer nach einem Update.',
    ],
    en: [
      'More robust after an update: a tab still running the old version sometimes showed “Error on this page — Unable to preload CSS …” when navigating (the new build’s files have new hashed names, the old ones are gone). The app now automatically reloads ONCE in that case to fetch the fresh version (with a guard against reload loops). The “Reload” button now truly reloads the page instead of only re-rendering.',
      'The “Printer/Klipper” status pills at the top no longer flash red the instant the backend briefly restarts during an update — only after 2 failed checks, and they recover within seconds (faster re-poll) instead of waiting for the next 30-second poll. Fixes the occasional “Network Error / everything red” blips after an update.',
    ],
  },
  {
    version: '1.0.103',
    de: [
      'Regal-Nummerierung korrigiert: R1 ist jetzt das Regal DIREKT am Drucker, R2/R3/… gehen nach rechts davon weg (Richtung Home-Anker). Eingelagert wird von R1‑1 bis R1‑6, dann R2‑1…, IMMER von links (Drucker) nach rechts. Vorher war R1 das vom Drucker am weitesten entfernte Regal — die Sortierung lief verkehrt herum. Der Drucker wandert wie gehabt mit der Regalzahl mit (Home rechts = fester Anker), skalierbar 1–99 Regale. Bei nur 1 Regal ändert sich nichts.',
    ],
    en: [
      'Rack numbering fixed: R1 is now the rack DIRECTLY at the printer, R2/R3/… extend to the right away from it (toward the home anchor). Storing goes R1‑1…R1‑6, then R2‑1…, ALWAYS left (printer) to right. Previously R1 was the rack farthest from the printer, so sorting ran backwards. The printer still shifts with the rack count (home anchor on the right is fixed), scalable 1–99 racks. With a single rack nothing changes.',
    ],
  },
  {
    version: '1.0.102',
    de: [
      'Neue Fehlerstrategie „Platte auswerfen & weiter" für „Druck fehlgeschlagen": Bei FAILED fährt das Bett auf Z200, die Tür wird geöffnet, die fehlgeschlagene Platte ausgeworfen und ins vorgesehene Fach eingelagert — danach startet automatisch der nächste Job (der eine frische Platte holt). Behebt den gemeldeten Fehler, dass nach einem Fehldruck sofort eine neue Platte geholt wurde, obwohl die alte noch im Drucker lag (Tür zu, Bett nicht auf Z200) — Kollisionsgefahr.',
      '„Platte auswerfen & weiter" ist jetzt der Standard für Druckfehler (die bisherige „Job überspringen"-Voreinstellung ließ die kaputte Platte im Drucker). „Job überspringen" bleibt wählbar — nur nutzen, wenn du die Platte selbst entnimmst. In Configuration → Fehlerstrategie einstellbar.',
    ],
    en: [
      'New error strategy “Eject plate & continue” for “Print failed”: on FAILED the bed moves to Z200, the door opens, the failed plate is ejected and stored in its rack slot — then the next job starts automatically (grabbing a fresh plate). Fixes the reported bug where, after a failed print, a new plate was grabbed immediately even though the old one was still in the printer (door closed, bed not at Z200) — a collision risk.',
      '“Eject plate & continue” is now the default for print failures (the previous “Skip job” default left the failed plate in the printer). “Skip job” stays available — only use it if you remove the plate yourself. Configurable under Configuration → Error strategy.',
    ],
  },
  {
    version: '1.0.101',
    de: [
      'Fehler behoben: Beim Auslösen eines Schritts im Sequenz-Editor (▶) kam „Network Error", obwohl der OTTOeject verbunden war. Ursache: die Bewegung wurde synchron abgewartet — bei einem echten Greifen/Auswerfen (20–60 s) brach die Verbindung vorher ab (zu kurzer Timeout bzw. Proxy). Der ▶-Test kehrt jetzt zurück, sobald die Bewegung GESTARTET ist, und zeigt „läuft…" statt abzubrechen. Betrifft Makro-, Klipper-GCode- und Printloom-Op-Schritte sowie die Live-Tests im Drucker-Tab und in der Steuerung.',
    ],
    en: [
      'Bug fix: triggering a step in the Sequence editor (▶) returned “Network Error” even though the OTTOeject was connected. Cause: the move was awaited synchronously — a real grab/eject (20–60 s) outlasted the timeout (or a proxy) and the connection dropped first. The ▶ test now returns as soon as the move has STARTED and shows “running…” instead of failing. Affects macro, Klipper-GCode and Printloom-op steps as well as the live tests in the Printer and Control tabs.',
    ],
  },
  {
    version: '1.0.100',
    de: [
      'Fehler behoben: Im Sequenz-Editor stürzte die Seite ab („Fehler auf dieser Seite"), sobald man einen Schritt per ▶ auslösen wollte. Ursache war eine Server-Fehlermeldung, die als Objekt statt als Text angezeigt wurde. Zusätzlich funktioniert der Einzel-Test jetzt für ALLE Makros (auch GRAB_FROM_RACK, MOVE_TO_PRINTER … mit Platzhaltern), nicht nur für die feste Liste — und Fehler erscheinen jetzt als lesbarer Text.',
      'Fehler behoben: Direkt nach einem Update war die Geräteliste manchmal leer (erst ein F5 brachte die Geräte zurück). Die App fragt jetzt kurz nach, wenn das gerade neu gestartete Backend noch nicht bereit war.',
    ],
    en: [
      'Bug fix: the Sequence editor crashed (“Error on this page”) as soon as you triggered a step with ▶. The cause was a server error being rendered as an object instead of text. Single-step test now also works for ALL macros (including GRAB_FROM_RACK, MOVE_TO_PRINTER … with placeholders), not just the fixed list — and errors now show as readable text.',
      'Bug fix: right after an update the device list was sometimes empty (only an F5 brought the devices back). The app now retries briefly when the just-restarted backend was not ready yet.',
    ],
  },
  {
    version: '1.0.99',
    de: [
      'Sequenz-Editor: neue Printloom-Op „Aus Magazin holen" — greift die frische Platte immer aus dem Magazin-Fach des Regals (global gesetztes Fach, z. B. 7) und zwar mit NOLIFT (die Platten liegen flach gestapelt). Ergänzt „Platte holen" (aus einem normalen Fach, mit Anheben).',
    ],
    en: [
      'Sequence editor: new Printloom op “Grab from magazine” — always grabs the fresh plate from the rack’s magazine slot (the globally set slot, e.g. 7) with NOLIFT (plates are stacked flat). Complements “Grab from rack” (from a normal slot, with lift).',
    ],
  },
  {
    version: '1.0.98',
    de: [
      'Stabilität: Printloom hält jetzt EINE dauerhafte Verbindung pro Drucker, statt bei fast jeder Aktion (Status-Abfrage, Kamera-Licht, Farm-Schritt) eine neue aufzubauen. Der X1C erlaubt nur wenige Verbindungen — das ständige Neu-Verbinden hat sie sich gegenseitig rauswerfen lassen (dauernder Verbindungsabbruch) und die App zum Hängen gebracht. Behoben: eine geteilte Verbindung mit Auto-Reconnect + gemeinsamer Status-Cache; alle Seiten teilen sich denselben Status.',
      'Drucker-Tab: der Wechsel lässt sich jetzt feiner steuern — neue Operation „Vor Drucker fahren", plus „Auswerfen" und „Einlegen (Place)" als getrennte Schritte. Jede Operation hat eine EIGENE Geschwindigkeit (M220), damit der Plattenwechsel so schnell und effizient wie möglich wird. Die globale Geschwindigkeit bleibt als Fallback.',
      'Sequenz-Editor: die Printloom-eigenen Operationen (Tür, Auswurf, Einlegen, Greifen …) lassen sich jetzt als Schritt „Printloom-Op" frei in Sequenzen einsetzen — wie die Geräte-Makros, aber immer mit der im Drucker-Tab eingestellten Position & Geschwindigkeit.',
    ],
    en: [
      'Stability: Printloom now keeps ONE persistent connection per printer instead of opening a new one for almost every action (status poll, camera light, farm step). The X1C only allows a few connections — the constant reconnecting made them evict each other (repeated connection drops) and froze the app. Fixed with a shared connection (auto-reconnect) + a common status cache that all pages share.',
      'Printer tab: the swap can be tuned more finely now — a new “Move to printer” operation, plus “Eject” and “Place” as separate steps. Each operation has its OWN speed (M220) to make the plate swap as fast and efficient as possible. The global speed remains as a fallback.',
      'Sequence editor: Printloom’s own operations (door, eject, place, grab …) can now be used freely as a “Printloom op” step — like the device macros, but always with the position & speed set in the Printer tab.',
    ],
  },
  {
    version: '1.0.97',
    de: [
      'Fehler behoben: Beim Feinjustieren im Drucker-Tab konnte ein leeres oder mit Komma eingegebenes Zahlenfeld (z. B. „17,5") den Test und die G-code-Anzeige lahmlegen (Server-Fehler → kein Klartext-G-code mehr, Werte schienen nicht zu greifen). Die Zahlenfelder akzeptieren jetzt Komma UND Punkt, und der Server ist robust gegen leere/ungültige Werte (nimmt dann den Standard).',
    ],
    en: [
      'Bug fix: while fine-tuning in the Printer tab, an empty field or a comma decimal (e.g. “17,5”) could break the test and the G-code display (server error → no more plaintext G-code, values seemed not to apply). Number fields now accept both comma and period, and the server is robust against empty/invalid values (falls back to the default).',
    ],
  },
  {
    version: '1.0.96',
    de: [
      'Drucker hinter dem letzten Regal: Auswurf, Einlegen und Tür wandern jetzt wieder korrekt mit der Regalzahl mit — X = eingegeben + (Regale−1)·Regal-Versatz, mit der GLOBALEN Regalzahl aus der Konfiguration. Bei 3 Regalen öffnet die Tür also weiter außen (hinter Regal 3), bei 1 Regal ohne Versatz. Jede Karte zeigt das effektive X an. (Wer den Drucker fix stehen hat: eigenen G-code nutzen — der wird absolut gesendet.)',
      'Geschwindigkeit: zusätzlich 25 % und 50 % für langsame, vorsichtige Fahrten.',
    ],
    en: [
      'Printer behind the last rack: eject, load and door again move correctly with the rack count — X = entered + (racks−1)·rack offset, using the GLOBAL rack count from Configuration. With 3 racks the door opens further out (behind rack 3), with 1 rack no offset. Each card shows the effective X. (Fixed printer position: use custom G-code — it is sent absolutely.)',
      'Speed: added 25 % and 50 % for slow, careful moves.',
    ],
  },
  {
    version: '1.0.95',
    de: [
      'Regalzahl, Fächer/Regal und Magazin-Fach gibt es jetzt nur noch an EINER Stelle: Konfiguration → Rack Configuration. Der Drucker-Tab (und der erzeugte G-code) lesen sie global von dort — die doppelten Felder im Drucker-Tab sind weg. Im Drucker-Tab bleiben nur die physischen mm-Werte (Start-X, Regal-Versatz X, Höhe Fach 1, Fach-Abstand). Behebt u. a. eine mögliche Magazin-Fach-Abweichung (falsche NOLIFT-Erkennung).',
      'Geschwindigkeit: Klick auf 100–500 % schickt jetzt sofort „M220 S…" an den OTTOeject (und gilt weiter für alle Test-/Farm-Bewegungen).',
    ],
    en: [
      'Rack count, slots/rack and magazine slot now live in ONE place only: Configuration → Rack Configuration. The Printer tab (and the generated G-code) read them globally from there — the duplicate fields in the Printer tab are gone. The Printer tab keeps only the physical mm values (start X, rack offset X, slot 1 height, slot spacing). Fixes a possible magazine-slot mismatch (wrong NOLIFT detection).',
      'Speed: clicking 100–500 % now immediately sends “M220 S…” to the OTTOeject (and still applies to all test/farm moves).',
    ],
  },
  {
    version: '1.0.94',
    de: [
      'Drucker-Tab: die eingegebene Position wird jetzt 1:1 gesendet — der automatische Rack-Versatz für Auswurf/Einlegen/Tür ist raus (er hatte X um (Regale−1)·Regal-Versatz verschoben, dadurch wirkte alles wie „3 Regale", auch nach Umstellen auf 1). Die Regal-Zahl beeinflusst nur noch Greifen/Ablegen.',
      'Neu: eigener, editierbarer G-code je Operation (Tür auf/zu, Auswurf, Einlegen) für die Feinjustage. „⚙ Eigenen G-code bearbeiten" lädt den berechneten G-code als Startpunkt; „Test" fährt genau diesen Text; „✕ zurück zu Werten" führt wieder zur X/Y/Z-Eingabe. Die Farm nutzt den eigenen G-code ebenfalls (wenn die Operation aktiviert ist).',
      'Neu: OTTOeject-Geschwindigkeit 100–500 % (M220) im Drucker-Tab — gilt für Live-Test und aktivierte Farm-Operationen.',
    ],
    en: [
      'Printer tab: the entered position is now sent 1:1 — the automatic rack offset for eject/load/door is gone (it shifted X by (racks−1)·rack offset, so everything behaved like “3 racks” even after switching to 1). Rack count now only affects grab/store.',
      'New: custom, editable G-code per operation (open/close door, eject, load) for fine-tuning. “⚙ Edit custom G-code” loads the computed G-code as a starting point; “Test” runs exactly that text; “✕ back to values” returns to X/Y/Z entry. The farm uses the custom G-code too (when the operation is enabled).',
      'New: OTTOeject speed 100–500 % (M220) in the printer tab — applies to live test and enabled farm operations.',
    ],
  },
  {
    version: '1.0.93',
    de: [
      'Neuer Tab „Drucker" ersetzt den Konfigurator: Modell wählen (X1C, P1S, P1P, A1, K1C, Elegoo CC, Anycubic Kobra S1, Flashforge AD5X oder „Anderer") und die Position jeder Aufgabe direkt einstellen — Tür öffnen/schließen, Platte auswerfen/einlegen, Greifen/Ablegen. Jede Operation hat einen Live-Test-Knopf (Printloom sendet den G-code direkt aus den Werten; nur OTTOEJECT_HOME bleibt Geräte-Macro). Kein Bearbeiten der Klipper-Config mehr nötig.',
      'Farm-Nutzung ist opt-in: je Operation ein Schalter „Farm nutzt diese Position". Standard AUS — die Auto-Farm fährt weiter die bewährten Geräte-Macros, bis du eine Operation nach dem Live-Test freischaltest. So wird nichts ungewollt umgestellt.',
      'Der alte Konfigurator (inkl. Config-Export slots.cfg/printer_calibration_variables.cfg und Regal-Schema) ist entfernt — die Positionen leben jetzt in Printloom und werden gespeichert.',
    ],
    en: [
      'New “Printer” tab replaces the configurator: pick a model (X1C, P1S, P1P, A1, K1C, Elegoo CC, Anycubic Kobra S1, Flashforge AD5X or “other”) and set the position of every task directly — open/close door, eject/load plate, grab/store. Each operation has a live test button (Printloom sends the G-code straight from the values; only OTTOEJECT_HOME stays a device macro). No more editing the Klipper config.',
      'Farm use is opt-in: a “Farm uses this position” switch per operation. Default OFF — the auto farm keeps running the proven device macros until you enable an operation after the live test. Nothing gets switched over unintentionally.',
      'The old configurator (incl. config export slots.cfg/printer_calibration_variables.cfg and rack schematic) is removed — the positions now live in Printloom and are saved.',
    ],
  },
  {
    version: '1.0.92',
    de: [
      'Mehrere Regale korrekt: Auswurf, Einlegen und Tür öffnen/schließen wandern jetzt automatisch mit der Regalzahl mit (X + (Regale−1)·Regal-Versatz), damit der Drucker immer HINTER dem letzten Regal (ganz links) angefahren wird — vorher landete die Tür bei 3 Regalen mitten im Regal. Standard ist AN; ein Hinweis zeigt den Versatz, ausschaltbar unter „Koordinaten je Operation".',
      'Auswurf-Startwerte an die OTTOmat3D-Referenz (mk01) angeglichen: X1C 425/340/17.5, P1S 421/334/15 (Auswurf = Einlegen).',
    ],
    en: [
      'Multiple racks fixed: eject, load and open/close door now shift automatically with the rack count (X + (racks−1)·rack offset), so the printer is always approached BEHIND the last rack (far left) — previously the door ended up in the middle of the racks with 3 racks. Default is ON; a hint shows the offset, can be turned off under “coordinates per operation”.',
      'Eject start values aligned with the OTTOmat3D reference (mk01): X1C 425/340/17.5, P1S 421/334/15 (eject = load).',
    ],
  },
  {
    version: '1.0.91',
    de: [
      'Neuer Weg: Printloom kennt jetzt ALLE Koordinaten und kann die Bewegungen direkt als G-code senden (Greifen, Ablegen, Auswurf, Einlegen, Tür auf/zu, Fach anfahren) — kein Config-Flashen, sofort wirksam. Nur OTTOEJECT_HOME bleibt Geräte-Macro. Der klassische Config-Export bleibt zusätzlich erhalten (beide Wege möglich).',
      'Im Konfigurator lassen sich die Start-Koordinaten je Operation eingeben (Start-X für Regal, Auswurf, Einlegen, Türen inkl. Pin-Abstand). Die Werte speichert Printloom und nutzt sie sowohl für den Config-Export als auch für den Live-G-code. Neue Live-Buttons: Magazin greifen / in R1/F1 ablegen zum Testen.',
      'Skalierung von rechts korrigiert: Regal 1 sitzt rechts (x_unclamp), jedes weitere Regal nach links Richtung Drucker; optional „Drucker hinter letztem Regal" (X = Start + (Regale−1)·Regal-Versatz). Das Schema ist entsprechend gespiegelt (Drucker links, Regal 1 rechts).',
    ],
    en: [
      'New path: Printloom now knows ALL coordinates and can send the motions directly as G-code (grab, store, eject, load, open/close door, approach slot) — no config flashing, instantly effective. Only OTTOEJECT_HOME stays a device macro. The classic config export remains available too (both ways possible).',
      'In the configurator you can enter the start coordinates per operation (start X for rack, eject, load, doors incl. pin distance). Printloom stores the values and uses them for both the config export and the live G-code. New live buttons: grab magazine / store to R1/S1 for testing.',
      'Fixed the build-from-the-right scaling: rack 1 sits on the right (x_unclamp), each further rack extends left toward the printer; optional “printer behind last rack” (X = start + (racks−1)·rack offset). The schematic is mirrored accordingly (printer left, rack 1 right).',
    ],
  },
  {
    version: '1.0.90',
    de: [
      'Live-Aktionen im Konfigurator erweitert: neben „Fach anfahren" gibt es jetzt Tür öffnen, Tür schließen, Platte einlegen und Platte aus dem Drucker holen — mit dem passenden Piktogramm des gewählten Druckers. (Braucht die aufgespielte printer_calibration_variables.cfg + Referenzfahrt; Tür-Aktionen nur bei Druckern mit Tür-Macro.)',
      'Das Bau-Schema zeigt jetzt die 2020-Alu-Profile zwischen den Regalen und bemaßt oben alle Abstände: Drucker ↔ Regal 1, Regal-Raster (Anfang 1 → Anfang 2 = Regal-Versatz X), Regalbreite und die lichte Weite zwischen zwei 2020-Trägern. Neues Feld „Regalbreite" (nur fürs Schema; geht nicht in die Klipper-Config ein).',
    ],
    en: [
      'Live actions in the configurator extended: besides “approach slot” there are now open door, close door, load plate and eject plate from the printer — with the matching pictogram of the selected printer. (Needs the flashed printer_calibration_variables.cfg + homing; door actions only for printers with a door macro.)',
      'The build schematic now shows the 2020 aluminium profiles between the racks and dimensions all distances at the top: printer ↔ rack 1, rack pitch (start 1 → start 2 = rack offset X), rack width and the clear width between two 2020 profiles. New field “Rack width” (schematic only; not part of the Klipper config).',
    ],
  },
  {
    version: '1.0.89',
    de: [
      'Konfigurator-Vorschau ist jetzt ein technisches Schema: links das Piktogramm des gewählten Druckers (geschlossen mit Tür bzw. offener Rahmen), rechts daneben die Regale — die nach rechts wachsen. Eingezeichnet sind die einzuhaltenden Abstände: Drucker ↔ Regal 1, Regal-Raster (Mitte–Mitte = Regal-Versatz X) und das Fach-Raster (Z-Schritt). Fächer bleiben anklickbar zum Anfahren.',
      'Hinweis für den Aufbau mit 2020-Alu-Profil (20 mm): das Regal-Raster muss mindestens Regalbreite + Profil + etwas Luft betragen. Maße sind schematisch (OTTOeject-X/Z in mm).',
    ],
    en: [
      'The configurator preview is now a technical schematic: the pictogram of the selected printer on the left (enclosed with door or open frame), the racks to its right — growing to the right. The required distances are drawn in: printer ↔ rack 1, rack pitch (centre-to-centre = rack offset X) and the slot pitch (Z step). Slots stay clickable to approach them.',
      'Note for building with 2020 aluminium extrusion (20 mm): the rack pitch must be at least rack width + profile + some clearance. Dimensions are schematic (OTTOeject X/Z in mm).',
    ],
  },
  {
    version: '1.0.88',
    de: [
      'Konfigurator erzeugt die Regal-Config jetzt skalierbar (slots.cfg): keine einzelnen Pro-Fach-Macros mehr, sondern eine Formel. Aufruf wie in der Farm — GRAB_FROM_RACK RACK=2 SLOT=5 / STORE_TO_RACK RACK=3 SLOT=1. Neuer Wert „Regal-Versatz X" (global_rack_x_gap): ein zusätzliches Regal verschiebt automatisch alles um eine Regalbreite. Pro-Regal-Feinkorrektur (rack_x_trim/rack_z_trim) ist vorbereitet. Das Magazin (oberste Etage) wird automatisch ohne Anheben gegriffen (NOLIFT).',
      'Die Drucker-Config nutzt jetzt die festen Macro-Namen, die die Farm-Sequenz tatsächlich aufruft (EJECT_FROM_BAMBULAB_X_ONE_C, LOAD_ONTO_BAMBULAB_X_ONE_C, OPEN/CLOSE_DOOR_BAMBU_X_ONE_C) — unabhängig vom gewählten Modell.',
      'Im Konfigurator lassen sich die Fächer in der Vorschau anklicken: nach einer Referenzfahrt fährt der OTTOeject das gewählte Fach mit den aktuellen Werten an (zum Kalibrieren, greift nicht).',
    ],
    en: [
      'The configurator now generates the rack config in a scalable way (slots.cfg): no more per-slot macros, just a formula. Called like the farm does — GRAB_FROM_RACK RACK=2 SLOT=5 / STORE_TO_RACK RACK=3 SLOT=1. New value “Rack offset X” (global_rack_x_gap): adding a rack automatically shifts everything by one rack width. Per-rack fine-tuning (rack_x_trim/rack_z_trim) is prepared. The magazine (top slot) is grabbed without lifting automatically (NOLIFT).',
      'The printer config now uses the fixed macro names the farm sequence actually calls (EJECT_FROM_BAMBULAB_X_ONE_C, LOAD_ONTO_BAMBULAB_X_ONE_C, OPEN/CLOSE_DOOR_BAMBU_X_ONE_C) — regardless of the chosen model.',
      'Slots in the configurator preview are now clickable: after homing, the OTTOeject approaches the chosen slot with the current values (for calibration, does not grab).',
    ],
  },
  {
    version: '1.0.87',
    de: [
      'CPU-Fix: Die Kamera-Streams (X1C-MJPEG, HLS, WebRTC) liefen weiter, auch wenn man längst auf einer anderen Seite war — Seiten bleiben für schnellen Wechsel im Hintergrund geladen, und die Videos dekodierten/transcodierten unsichtbar weiter (deutliche CPU-Last). Jetzt pausieren die Streams automatisch, sobald ihre Kachel nicht sichtbar ist, und laufen beim Zurückwechseln wieder an.',
      'Die X1C-Kamera wird zudem sparsamer transcodiert (6 statt 10 fps, max. 1280 px Breite) → weniger CPU im laufenden Betrieb.',
    ],
    en: [
      'CPU fix: camera streams (X1C MJPEG, HLS, WebRTC) kept running even after you’d navigated to another page — pages stay mounted in the background for fast switching, and the videos kept decoding/transcoding invisibly (noticeable CPU load). Streams now pause automatically when their tile isn’t visible and resume on return.',
      'The X1C camera is also transcoded more efficiently (6 instead of 10 fps, max 1280 px wide) → less CPU during operation.',
    ],
  },
  {
    version: '1.0.86',
    de: [
      'Konfigurator-Layout: Drucker- und Regal-Auswahl liegen jetzt oben nebeneinander, die generierte Klipper-Config steht in voller Breite darunter (beide Dateien nebeneinander) — übersichtlicher.',
    ],
    en: [
      'Configurator layout: printer and rack selection now sit side by side at the top, with the generated Klipper config full width below (both files side by side) — clearer.',
    ],
  },
  {
    version: '1.0.85',
    de: [
      'Neuer Tab „Konfigurator": Drucker wählen (X1C, P1S, P1P, A1, K1C, Elegoo CC, Anycubic Kobra S1, Flashforge AD5X), Regale/Fächer/Magazin und Maße einstellen — mit Live-Vorschau. Erzeugt fertige Klipper-Configs (storage_calibration_variables.cfg + printer_calibration_variables.cfg inkl. Tür-Macros) zum Kopieren/Download. Magazin-Option dabei.',
    ],
    en: [
      'New “Configurator” tab: pick the printer (X1C, P1S, P1P, A1, K1C, Elegoo CC, Anycubic Kobra S1, Flashforge AD5X), set racks/slots/magazine and dimensions — with live preview. Generates ready-made Klipper configs (storage_calibration_variables.cfg + printer_calibration_variables.cfg incl. door macros) to copy/download. Magazine option included.',
    ],
  },
  {
    version: '1.0.84',
    de: [
      'WICHTIG: Der „Drucken"-Knopf im Datei-Browser (Direktdruck) nutzt jetzt dieselbe sichere AMS-Logik wie die Auto-Farm — echtes Material + Farbe der Datei, Live-AMS-Abgleich (NIE materialübergreifend) und deine pro-Datei-Zuordnung. Fehlt das passende Filament im AMS (z. B. PETG nicht geladen), wird der Druck ABGEBROCHEN mit klarer Meldung, statt alles mit dem geladenen Filament (z. B. PLA „Latte Brown") zu drucken. Das war der letzte ungeschützte Pfad.',
    ],
    en: [
      'IMPORTANT: the “Print” button in the file browser (direct print) now uses the same safe AMS logic as Auto Farm — the file’s real material + color, live AMS matching (NEVER across materials) and your per-file mapping. If the matching filament isn’t loaded (e.g. PETG missing), the print is ABORTED with a clear message instead of printing everything with the loaded filament (e.g. PLA “Latte Brown”). This was the last unguarded path.',
    ],
  },
  {
    version: '1.0.83',
    de: [
      'Fix: AMS-Spulen wurden nicht erkannt/gelernt (0 Filamente), obwohl geladen — die Status-Antwort lieferte das AMS unter einem anderen Feld als das Frontend gelesen hat. Jetzt sehen Datei-Browser, Auto-Farm und das Filament-Lernen die AMS-Slots wieder.',
      'Filamente-Seite: Knopf „↻ Aus AMS aktualisieren" — liest die aktiven Spulen sofort ein und ergänzt neue (mit Rückmeldung, falls kein AMS erkannt wird).',
    ],
    en: [
      'Fix: AMS spools were not detected/learned (0 filaments) despite being loaded — the status response exposed the AMS under a different field than the frontend read. File browser, Auto Farm and filament learning see the AMS slots again.',
      'Filaments page: “↻ Refresh from AMS” button — reads the active spools immediately and adds new ones (with feedback if no AMS is detected).',
    ],
  },
  {
    version: '1.0.82',
    de: [
      'Fix „No AMS detected" trotz Online-Drucker: Bambu schickt das AMS nur im ersten Vollreport, danach nur Teil-Updates — die haben den Zustand bisher überschrieben, so ging das AMS verloren. Jetzt werden die Updates zusammengeführt (AMS bleibt erhalten), die Status-Abfrage wartet aktiv auf den Vollreport, und der Datei-Browser frischt die AMS-Slots alle 30 s auf.',
    ],
    en: [
      'Fix “No AMS detected” with an online printer: Bambu only sends the AMS in the first full report, then partial updates — these overwrote the state, losing the AMS. Updates are now merged (AMS is kept), the status query actively waits for the full report, and the file browser refreshes the AMS slots every 30 s.',
    ],
  },
  {
    version: '1.0.81',
    de: [
      'Manuelle AMS-Zuordnung pro Datei (Datei-Browser → „Filamente & AMS-Zuordnung"): je Filament der Datei einen AKTIVEN AMS-Slot wählen; wird pro Datei gespeichert und beim Druck verwendet. „↺ Automatisch" stellt die automatische Zuordnung (Material + Farbe) wieder her.',
      'Sicherheitsnetz: Auch eine manuelle Zuordnung darf das Material nicht kreuzen — wählst du z. B. für PETG einen PLA-Slot, gibt es eine Warnung und der Druck pausiert, statt falsch zu drucken.',
    ],
    en: [
      'Manual AMS mapping per file (File Library → “Filaments & AMS mapping”): pick an ACTIVE AMS slot for each filament of the file; saved per file and used when printing. “↺ Automatic” restores automatic mapping (material + color).',
      'Safety net: even a manual mapping may not cross materials — e.g. choosing a PLA slot for PETG warns and pauses the print instead of printing wrong.',
    ],
  },
  {
    version: '1.0.80',
    de: [
      'Filament-Bibliothek lernt aus dem AMS: kein fester Bambu-Katalog mehr — die Liste füllt sich automatisch aus den aktiven AMS-Spulen. Jede neu erkannte Material+Farbe-Kombination wird ergänzt und unten als „Material · Farbe hinzugefügt" gemeldet.',
      '„Alle löschen" leert die Bibliothek (wird danach neu aus dem AMS gelernt); manuelles Hinzufügen/Bearbeiten bleibt erhalten.',
    ],
    en: [
      'Filament library learns from the AMS: no fixed Bambu catalog anymore — the list fills automatically from the active AMS spools. Each newly detected material+color combination is added and announced at the bottom as “material · color added”.',
      '“Clear all” empties the library (then re-learns from the AMS); manual add/edit stays.',
    ],
  },
  {
    version: '1.0.79',
    de: [
      'WICHTIGER Sicherheits-Fix: Es wird NIE mehr materialübergreifend zugeordnet. Bisher konnte die Farm ohne passendes Material auf ein falsches ausweichen (z. B. PETG-Druck mit PLA). Jetzt nur exakt gleiches Material — fehlt es, pausiert die Farm zur manuellen Zuordnung, statt falsch zu drucken.',
      '„Pin filament" entfernt: Dateien werden nicht mehr auf ein Material/Farbe festgenagelt (das war die Ursache für den falschen Druck). Der Datei-Browser zeigt stattdessen die echten Filamente aus dem Druck (Material + Farbe); die AMS-Zuordnung erfolgt material- UND farbgenau automatisch oder manuell in der Queue.',
    ],
    en: [
      'IMPORTANT safety fix: never map across materials anymore. Before, with no matching material the farm could fall back to a wrong one (e.g. printing PETG with PLA). Now only the exact same material — if missing, the farm pauses for manual assignment instead of printing wrong.',
      'Removed “Pin filament”: files are no longer pinned to a material/color (that caused the wrong print). The file browser now shows the real filaments from the print (material + color); AMS mapping happens by exact material AND color, automatically or manually in the queue.',
    ],
  },
  {
    version: '1.0.78',
    de: [
      'Geräte bearbeiten: in Configuration → Geräte gibt es jetzt einen Stift-Knopf je Gerät — Name, IP, Port, Seriennummer & Access-Code ändern, ohne löschen & neu anlegen. Access-Code leer lassen = bleibt unverändert; der Gerätetyp bleibt fest.',
    ],
    en: [
      'Edit devices: Configuration → Devices now has a pencil button per device — change name, IP, port, serial & access code without deleting and re-adding. Leave the access code empty to keep it; the device type stays fixed.',
    ],
  },
  {
    version: '1.0.77',
    de: [
      'Einrichtungs-Status (Health-Check): Checkliste in System und am Ende des Setup-Wizards — Zeitzone, Drucker, OTTOeject, Regal, Homing-Datei: was bereit ist (✓), was offline ist (!) und was fehlt (✗).',
      'Regal-Live-Vorschau: im Setup-Wizard und im Rack Manager wird das Regal als Raster gezeigt und aktualisiert sich sofort beim Ändern von Regalen/Fächern/Fachhöhe.',
      '„+ Beispiel-Teil laden" in der Datei-Bibliothek: legt einen Demo-Druck an, um Bibliothek/Queue/Vorschau ohne echten Druck auszuprobieren.',
    ],
    en: [
      'Setup status (health check): a checklist in System and at the end of the setup wizard — time zone, printer, OTTOeject, rack, homing file: what is ready (✓), offline (!) or missing (✗).',
      'Live rack preview: the setup wizard and Rack Manager show the rack as a grid that updates instantly as you change racks/slots/slot height.',
      '“+ Load demo part” in the File Library: creates a demo print to try out library/queue/preview without a real print.',
    ],
  },
  {
    version: '1.0.76',
    de: [
      'Setup-Wizard: Zeitzone gleich im ersten Schritt (Willkommen) einstellbar — vorbelegt aus dem Browser, sofort gespeichert. Basis für Betriebszeiten & Uhrzeiten, damit die Farm nicht in UTC zur falschen Zeit startet.',
    ],
    en: [
      'Setup wizard: time zone right in the first step (Welcome) — prefilled from the browser, saved immediately. Basis for operating hours & times so the farm doesn’t start at the wrong time in UTC.',
    ],
  },
  {
    version: '1.0.75',
    de: [
      'Filament pro Datei fixieren (Datei-Bibliothek → „Filament fixieren"): das festgelegte Material/Farbe wird beim Drucken IMMER verwendet — kein Auto-Raten aus den Slicer-Metadaten mehr. Jetzt server-seitig dauerhaft gespeichert (übersteht Neuladen/Gerätewechsel) und treibt AMS-Matching + Vorschau (exakte Farbe).',
    ],
    en: [
      'Pin filament per file (File Library → “Pin filament”): the chosen material/color is ALWAYS used when printing — no more auto-guessing from slicer metadata. Now stored server-side permanently (survives reload/device change) and drives AMS matching + preview (exact color).',
    ],
  },
  {
    version: '1.0.74',
    de: [
      '„Nur exakte Farbe drucken" (Configuration → Auto Farm): wenn aktiv, weicht die Farm nicht mehr auf eine nur ähnliche Ersatzfarbe aus — ohne exakten Treffer pausiert sie und verlangt die manuelle AMS-Zuordnung, statt im falschen Farbton zu drucken.',
    ],
    en: [
      '“Print exact color only” (Configuration → Auto Farm): when on, the farm no longer substitutes a merely similar color — without an exact match it pauses and asks for manual AMS assignment instead of printing the wrong shade.',
    ],
  },
  {
    version: '1.0.73',
    de: [
      'AMS-Mapping-Vorschau pro Job: zeigt vor dem Druck je Filament den voraussichtlichen AMS-Slot mit Ampel — grün „exakt", gelb „ähnlich" (Ersatzfarbe), rot „kein Material".',
      'Farben im Klartext: AMS- und Datei-Farben werden nach Möglichkeit mit Bambu-Namen angezeigt (z. B. „Charcoal", „Terracotta") statt nur Hex.',
    ],
    en: [
      'Per-job AMS mapping preview: before printing, each filament shows the likely AMS slot with a traffic light — green “exact”, amber “similar” (substitute color), red “no material”.',
      'Plain-text colors: AMS and file colors now show Bambu names where possible (e.g. “Charcoal”, “Terracotta”) instead of just hex.',
    ],
  },
  {
    version: '1.0.72',
    de: [
      'Wichtiger Fix AMS-Farbwahl: Eine EXAKT passende Farbe wird jetzt immer bevorzugt. Vorher konnte eine nur farbähnliche, leerere Spule eine exakt passende verdrängen (z. B. „Latte Brown" statt des geladenen „Dark Red") — der Druck lief im falschen Filament. Drei Stufen: exakt → ähnlich (Ersatz) → weit weg; exakt schlägt immer ähnlich.',
    ],
    en: [
      'Important AMS color fix: an EXACT color match is now always preferred. Before, a merely similar but emptier spool could beat an exact match (e.g. “Latte Brown” instead of the loaded “Dark Red”) — printing in the wrong filament. Three tiers: exact → similar (substitute) → far; exact always beats similar.',
    ],
  },
  {
    version: '1.0.71',
    de: [
      'Behoben: Bei Multi-Material-Projektdateien (mehrere Filamente angelegt, eine Platte druckt aber nur eines) wurde fälschlich „Manuelle AMS-Zuordnung / keine Filament-Info" gemeldet. Es werden jetzt pro Platte nur die TATSÄCHLICH benutzten Filamente (Typ + Farbe) aus slice_info.config gelesen — die echte Farbe wird erkannt und das AMS-Matching verlangt keine ungenutzten Filamente mehr.',
    ],
    en: [
      'Fixed: multi-material project files (several filaments defined, but a plate prints only one) wrongly showed “Manual AMS assignment / no filament info”. Per plate, only the filaments actually USED (type + color) are now read from slice_info.config — the real color is detected and AMS matching no longer demands unused filaments.',
    ],
  },
  {
    version: '1.0.70',
    de: [
      'Behoben: Umsortieren WÄHREND des Start-Countdowns wirkt jetzt — der oberste wartende Job wird erst nach Ablauf des Countdowns bestimmt. Vorher startete trotz Tausch der zuvor oberste Job (z. B. Platte 1 statt der nach vorn gezogenen Platte 2).',
      'Auto-Start-Schalter wieder entfernt — die Farm läuft dauerhaft automatisch (kein „Jetzt starten" nötig).',
      'Planer zeigt jetzt auch die Platte je Job an (z. B. „P2/4").',
    ],
    en: [
      'Fixed: reordering DURING the start countdown now takes effect — the top waiting job is picked only after the countdown ends. Before, the previously-top job started despite the swap (e.g. plate 1 instead of the plate 2 you moved up).',
      'Removed the auto-start toggle again — the farm runs continuously and automatically (no “Start now” needed).',
      'Planner now also shows the plate per job (e.g. “P2/4”).',
    ],
  },
  {
    version: '1.0.69',
    de: [
      'Neuer „Auto-Start"-Schalter in der Warteschlange: standardmäßig EIN (voll automatisch wie bisher). Schaltest du ihn AUS, starten neu in den Leerlauf gekommene Jobs nicht von selbst — du legst die Reihenfolge in Ruhe fest und drückst dann „▶ Jetzt starten". Praktisch z. B. wenn du bei einer Mehr-Platten-Datei erst eine bestimmte Platte drucken willst.',
    ],
    en: [
      'New “Auto-start” toggle in the queue: on by default (fully automatic as before). Turn it off and newly idle jobs no longer start on their own — set the order calmly, then press “▶ Start now”. Handy e.g. when you want a specific plate of a multi-plate file to print first.',
    ],
  },
  {
    version: '1.0.68',
    de: [
      'Behoben: Eine Mehr-Platten-.3mf aus der Datei-Bibliothek („+ Queue") landete nur als EIN Job (Platte 1). Jetzt wird je Platte ein eigener Job angelegt (z. B. 13 Platten → 13 Jobs), jeweils mit Badge „Platte 3/13". (Der Auto-Farm-Picker war v1.0.67 der falsche Weg — Jobs kommen aus der Bibliothek.)',
    ],
    en: [
      'Fixed: a multi-plate .3mf added from the File Library (“+ Queue”) only became ONE job (plate 1). Now each plate gets its own job (e.g. 13 plates → 13 jobs), each with a “Plate 3/13” badge. (v1.0.67 fixed the wrong path — jobs are added from the library.)',
    ],
  },
  {
    version: '1.0.67',
    de: [
      'Mehr-Platten-.3mf: beim Hinzufügen werden jetzt automatisch ALLE Platten als eigene Jobs angelegt — kein Platten-Auswahlbalken mehr. Jeder Job zeigt „Platte 3/13".',
      'Behoben: der Platten-Auswahlbalken blieb oben hängen, obwohl die Jobs längst aus der Warteschlange entfernt waren.',
    ],
    en: [
      'Multi-plate .3mf: adding now creates a job for EVERY plate automatically — no more plate selection bar. Each job shows “Plate 3/13”.',
      'Fixed: the plate selection bar stayed at the top even after the jobs had been removed from the queue.',
    ],
  },
  {
    version: '1.0.66',
    de: [
      'Datei-Browser: mehrere markierte Dateien lassen sich jetzt auf einmal löschen (Knopf „Löschen (N)" in der Auswahl-Leiste, eine Sicherheitsabfrage).',
    ],
    en: [
      'File browser: multiple selected files can now be deleted at once (“Delete (N)” button in the selection bar, single confirmation).',
    ],
  },
  {
    version: '1.0.65',
    de: [
      'Fix: Nach längerer Wartezeit (leere Warteschlange, Magazin auffüllen, Regal voll) schalteten die OTTOeject-Motoren ab und verloren das Homing — der nächste Job scheiterte mit „Must home axis first" und der Arm holte keine Platte. Die Farm homed jetzt in dem Fall automatisch und wiederholt den Schritt.',
    ],
    en: [
      'Fix: after a longer wait (empty queue, refilling the magazine, rack full) the OTTOeject motors switched off and lost their homing — the next job failed with “Must home axis first” and the arm grabbed no plate. The farm now re-homes automatically in that case and retries the step.',
    ],
  },
  {
    version: '1.0.64',
    de: [
      'Uhrzeit (lokale Zeit) oben rechts in der Kopfleiste neben den Status-Anzeigen.',
    ],
    en: [
      'Local time shown at the top right of the header bar next to the status pills.',
    ],
  },
  {
    version: '1.0.63',
    de: [
      'Drucker-Fehler (HMS) verständlicher: Meldung zeigt Schweregrad + Kurzbeschreibung, und der Fehlercode ist ein Direktlink auf die Bambu-Wiki-Seite mit der genauen Erklärung.',
      'Pause / Fortsetzen / Stop im Auto Farm steuern jetzt auch den X1C direkt — der Drucker pausiert, setzt fort bzw. bricht den Druck mit ab.',
      'Zeitzone in der Konfiguration auswählbar (Basis für die Betriebszeiten) und speicherbar.',
    ],
    en: [
      'Clearer printer errors (HMS): the message shows severity + a short description, and the error code is a direct link to the Bambu wiki page with the exact explanation.',
      'Pause / Resume / Stop in Auto Farm now also drive the X1C directly — the printer pauses, resumes or cancels the print accordingly.',
      'Time zone is now selectable in Configuration (basis for operating hours) and saved.',
    ],
  },
  {
    version: '1.0.62',
    de: [
      'Bugfix Betriebszeiten: Zeiten werden jetzt in deiner lokalen Zeitzone geprüft. Der Container lief in UTC, dadurch startete die Farm Stunden zu spät (z. B. „Start ab 05:00" erst um 07:00).',
      'Projekte-Tab komplett neu: mehrere benannte Projekte, Dateien mit Stückzahl sammeln, „Drucken" startet bzw. füllt die Auto Farm automatisch, fertige Objekte werden pro Stück abgehakt (2/3 …).',
      'Planer: Preis-/€-Spalte entfernt.',
      'System: Backup-Warnung sitzt wieder direkt am „Update installieren"-Knopf (Patchnotes ans Ende der Karte verschoben).',
    ],
    en: [
      'Fix operating hours: times are now evaluated in your local timezone. The container ran in UTC, so the farm started hours late (e.g. “start at 05:00” only fired at 07:00).',
      'Projects tab rebuilt: multiple named projects, collect files with quantities, “Print” auto-starts or fills Auto Farm, finished objects are ticked off per piece (2/3 …).',
      'Planner: removed the price/€ column.',
      'System: the backup warning is back right next to the “Install update” button (patch notes moved to the end of the card).',
    ],
  },
  {
    version: '1.0.61',
    de: [
      'Job-Karten in der Warteschlange kompakter: Höhe + Fächer-Bedarf steht oben rechts; Fach-Anzeige, Filament-Punkte und das AMS-Dropdown entfallen. Die manuelle AMS-Festlegung erscheint nur noch, wenn die Farm wirklich darauf wartet.',
    ],
    en: [
      'More compact queue job cards: height + slot demand now top-right; the slot label, filament dots and AMS dropdown are gone. The manual AMS picker only appears when the farm is actually waiting for it.',
    ],
  },
  {
    version: '1.0.60',
    de: [
      'Auto-Farm-Planer zeigt jetzt zusätzlich den Tag an (heute / morgen / +N Tage), da ein Job durch Betriebszeiten erst an einem späteren Tag fertig werden kann.',
    ],
    en: [
      'Auto Farm planner now also shows the day (today / tomorrow / +N days), since operating hours can push a job’s finish to a later day.',
    ],
  },
  {
    version: '1.0.59',
    de: [
      'Betriebszeiten jetzt pro Wochentag einzeln einstellbar (eigenes Von–Bis je Tag, Tag ganz abschaltbar, „auf alle Tage übernehmen").',
      'Auto-Farm-Planer berücksichtigt die Betriebszeiten: die Fertig-Uhrzeit enthält jetzt die Wartezeit bis zum nächsten Zeitfenster.',
    ],
    en: [
      'Operating hours can now be set per weekday (own from–to per day, a day can be turned off entirely, “apply to all days”).',
      'Auto Farm planner now accounts for operating hours: the finish time includes the wait until the next window.',
    ],
  },
  {
    version: '1.0.58',
    de: [
      'Steuerung: Holen nur noch aus dem Magazin (Fach 7), Einlagern nur in die Lager-Fächer (1–6). Aus den Lager-Fächern wird nicht mehr geholt.',
    ],
    en: [
      'Control page: grab only from the magazine (slot 7), store only into the storage slots (1–6). Storage slots are no longer grabbed from.',
    ],
  },
  {
    version: '1.0.57',
    de: [
      'Auto-Farm-Layout: feineres, weiterhin einrastendes Raster zum Anordnen der Kacheln.',
      'Auto Farm: zweite Kamera (unten) lässt sich ausblenden.',
      'Steuerung nutzt während eines Farm-Laufs die Live-Verbindung der Farm, statt alle 15 s neu zu verbinden.',
      'System: Patchnotes der letzten Updates hier unter „Version" (Sprache folgt der Auswahl unten links).',
    ],
    en: [
      'Auto Farm layout: finer, still-snapping grid for arranging the panels.',
      'Auto Farm: the second (bottom) camera can be hidden.',
      'Control page uses the farm’s live connection during a run instead of reconnecting every 15 s.',
      'System: patch notes for recent updates shown here under “Version” (follows the language selected at bottom left).',
    ],
  },
  {
    version: '1.0.56',
    de: [
      'Auto Farm läuft jetzt im Dauerbetrieb: Start läuft bis zum manuellen Stopp oder Update — kein Auto-Stopp bei leerer Warteschlange.',
      'Neuer Job aus dem Leerlauf startet nach einem 15-Sekunden-Countdown (oben im Header sichtbar).',
      'Fächer werden live beim Druckstart berechnet und nicht mehr vorab angezeigt — nur der startende Job erscheint im Regal.',
      'Regal voll: die fertige Platte wartet im Drucker, bis genug Fächer übereinander frei sind, dann geht es automatisch weiter.',
      'Geringerer Speicherverbrauch (Logging und malloc-Tuning).',
    ],
    en: [
      'Auto Farm now runs continuously: Start runs until you stop it or an update arrives — no auto-stop on an empty queue.',
      'A new job out of idle starts after a 15-second countdown (shown in the header).',
      'Slots are computed live at print start and no longer shown in advance — only the starting job appears in the rack.',
      'Rack full: the finished plate waits in the printer until enough stacked slots are free, then continues automatically.',
      'Lower memory usage (logging and malloc tuning).',
    ],
  },
  {
    version: '1.0.55',
    de: [
      'Betriebszeiten/Zeitfenster: neue Drucke nur innerhalb eines gewählten Fensters starten (über Nacht möglich); laufende Drucke werden nie unterbrochen.',
      'Fix: Teil-Einstellungen (Farm/Strom/Fehlerstrategie) überschrieben sich gegenseitig nicht mehr — es wird jetzt zusammengeführt.',
    ],
    en: [
      'Operating hours/time windows: start new prints only within a chosen window (overnight supported); running prints are never interrupted.',
      'Fix: partial settings (farm/power/error-strategy) no longer overwrite each other — they are merged now.',
    ],
  },
  {
    version: '1.0.54',
    de: [
      'Fix: Fehler-Banner blieb nach „Fortsetzen" hängen — wird beim Fortsetzen jetzt gelöscht.',
      'Druck lässt sich direkt vom Dashboard aus fortsetzen.',
    ],
    en: [
      'Fix: the error banner stayed after “Resume” — it is now cleared on resume.',
      'A print can be resumed directly from the dashboard.',
    ],
  },
  {
    version: '1.0.53',
    de: [
      'Fächer-Toleranz konfigurierbar (Rack Manager).',
      'Geteilter WebSocket-Live-Kanal für Status; leichteres Aktivitäts-Log; sauberere Logik.',
    ],
    en: [
      'Configurable slot tolerance (Rack Manager).',
      'Shared WebSocket live channel for status; lighter activity log; cleaner logic.',
    ],
  },
  {
    version: '1.0.52',
    de: [
      'Fix: doppelte MQTT-Verbindung beim erneuten Senden einer Datei.',
      'Private IP-Adressen aus dem Projekt entfernt.',
    ],
    en: [
      'Fix: duplicate MQTT connection when re-sending a file.',
      'Removed private IP addresses from the project.',
    ],
  },
]
