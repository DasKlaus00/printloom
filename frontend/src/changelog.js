/* Patchnotes der letzten Updates — zweisprachig (de/en), neueste zuerst.
   Wird auf der System-Seite unter „Version" angezeigt. Bei jedem Release oben
   einen Eintrag ergänzen (die Anzeige zeigt die neuesten fünf). */

export const CHANGELOG = [
  {
    version: '1.1.31',
    de: [
      'BEHOBEN: „Aus Magazin holen" fuhr mit dem Magnet-Greifer über die Z-Achsgrenze (365 statt höchstens 364 mm) — Klipper hätte die Bewegung mitten im Ablauf abgebrochen. Der Magnet holte die Platte aus dem Magazin mit derselben Bewegung wie aus einem Lagerfach, samt vollem Hub von 15 mm. Über dem obersten Fach ist dafür kein Platz.',
      'Der Magazin-Griff ist jetzt eine eigene, gemessene Bewegung: X, Y und Z fahren in EINEM Zug (oben ist nichts zu umfahren), und angehoben wird nur um 5 mm. Beide Werte stehen im Drucker-Tab und lassen sich nachjustieren.',
      'MAGAZIN-HÖHE IST JETZT FEST: Beim Magnet-Greifer wird die Greif-Höhe nicht mehr pro Platte im Stapel abgesenkt. Der Magnet schiebt sich unter die Platte und zieht sie beim Anheben an sich — wie tief der Stapel durchhängt, ändert daran nichts. Vorher wanderte die Höhe mit jeder entnommenen Platte, und die eingemessene Höhe stimmte nur bei genau einem Füllstand. Beim Original-Greifer bleibt die Absenkung: dort hängt der Stapel wirklich durch.',
      'EINLAGERN SCHNELLER: Beim Magnet-Greifer fahren X und Z jetzt gleichzeitig statt nacheinander. Der Arm stellt sich schon während der Fahrt quer durch die Anlage auf Fachhöhe; vorher stand er erst am Ziel und hob dann an. Das Original machte das ohnehin schon so — der Magnet war der Ausreißer.',
    ],
    en: [
      'FIXED: "take from magazine" drove past the Z axis limit with the magnet gripper (365 instead of at most 364 mm) — Klipper would have aborted the motion mid-sequence. The magnet took the plate out of the magazine with the same motion as out of a storage slot, full 15 mm lift included. There is no room for that above the topmost slot.',
      'The magazine grab is now its own measured motion: X, Y and Z move in ONE go (there is nothing to work around up there), and the lift is only 5 mm. Both values live in the printer tab and can be adjusted.',
      'MAGAZINE HEIGHT IS NOW FIXED: with the magnet gripper the grab height is no longer lowered per plate in the stack. The magnet slides under the plate and pulls it up against itself — how far the stack sags makes no difference. Previously the height moved with every plate taken out, and the measured height was only correct at exactly one fill level. For the original gripper the lowering stays: there the stack really does sag.',
      'STORING IS FASTER: with the magnet gripper X and Z now move at the same time instead of one after the other. The arm reaches slot height while still travelling across the setup; previously it arrived first and lifted afterwards. The original gripper always did it this way — the magnet was the odd one out.',
    ],
  },
  {
    version: '1.1.30',
    de: [
      'BEHOBEN: Haken (Kontrollkästchen) sahen aus wie bildschirmbreite Eingabefelder und quetschten den Text daneben zu einer Spalte aus Einzelwörtern — am deutlichsten beim neuen „Drucker einbeziehen" im Stresstest. Ursache war eine globale Regel, die JEDES <input> wie ein Textfeld behandelte, also auch Haken.',
      'Behoben an der Quelle statt an der einen Stelle: Haken und Radioknöpfe sind jetzt von der Textfeld-Regel ausgenommen und haben eine eigene, kleine Größe. Das betraf vier weitere Haken in der App (Sequenz-Editor, Drucker-Kalibrierung, Verbindungs-Einstellungen), die genauso falsch aussahen; zwei Stellen hatten sich das früher einzeln zurechtgebogen — dieser Notbehelf ist jetzt überflüssig.',
      'Ein Test hält die Ausnahme fest. Er wurde gegengeprüft: mit der alten Regel schlägt er fehl.',
    ],
    en: [
      'FIXED: checkboxes looked like full-width text fields and squeezed the text beside them into a column of single words — most visibly on the new "Include the printer" option in the stress test. The cause was a global rule that treated EVERY <input> as a text field, checkboxes included.',
      'Fixed at the source rather than at the one spot: checkboxes and radio buttons are now excluded from the text-field rule and have their own small size. This affected four more checkboxes in the app (sequence editor, printer calibration, connection settings) that looked equally wrong; two places had patched around it individually — that workaround is now obsolete.',
      'A test pins the exception down. It was counter-checked: with the old rule it fails.',
    ],
  },
  {
    version: '1.1.29',
    de: [
      'STRESSTEST MIT DRUCKER (Option): Ein Haken im Stresstest schickt jede Platte unterwegs über den Drucker — auflegen, wieder herunternehmen, dann erst ins Fach. Damit hängen Anfahrt, Bett-Höhe, Auswerfen und Einlegen mit im Dauerlauf; der reine Regal-Lauf lässt genau das aus.',
      'Der Haken ist bewusst AUS als Vorgabe: der Umweg fährt das Bett auf Z200 und öffnet die Tür — nichts davon soll passieren, weil jemand nur den Regal-Lauf starten wollte. Die Zeitschätzung rechnet den Umweg mit, sobald der Haken sitzt.',
      'Reihenfolge im Lauf: erst das Bett auf Z200 (Homing-Datei), dann die Tür, dann erst der Arm ins Gehäuse. Homing und Tür laufen genau EINMAL, nicht pro Platte — auf und zu bei jeder Platte wäre nur Verschleiß. Die Tür geht am Ende wieder zu, auch nach einem Abbruch; eine nie geöffnete Tür wird nicht zugefahren.',
      'MAGNET-GREIFER: Nach dem Einlegen zieht der Arm jetzt aus dem Drucker heraus (Y343 → Y300) statt über dem Bett stehen zu bleiben. So kann der Drucker anfahren, und die nächste Bewegung startet nicht aus dem Gehäuse. Die Vorschübe für Einfahren und Absetzen entsprechen jetzt der Messung.',
      'Der Drucker für den Umweg kommt aus demselben Geometrie-Block, dessen Koordinaten gefahren werden. Ein zweiter Weg („das erste Gerät in der Liste") könnte auf eine andere Maschine zeigen als die Positionen — das wäre ein Crash, kein Schönheitsfehler.',
    ],
    en: [
      'STRESS TEST WITH PRINTER (option): a checkbox in the stress test sends every plate via the printer on its way — put it on, take it off again, and only then into the slot. That puts the approach, bed height, ejecting and loading into the endurance run; the plain rack run leaves exactly that out.',
      'The checkbox is deliberately OFF by default: the detour moves the bed to Z200 and opens the door — none of that should happen because someone only wanted the rack run. The time estimate includes the detour as soon as the box is ticked.',
      'Order during the run: first the bed to Z200 (homing file), then the door, and only then the arm into the enclosure. Homing and door happen exactly ONCE, not per plate — opening and closing for every plate would be pure wear. The door closes again at the end, even after an abort; a door that was never opened is not driven shut.',
      'MAGNET GRIPPER: after loading, the arm now pulls out of the printer (Y343 → Y300) instead of staying above the bed. That lets the printer move, and the next motion does not start from inside the enclosure. The feed rates for entering and setting down now match the measurement.',
      'The printer for the detour comes from the same geometry block whose coordinates are driven. A second path ("the first device in the list") could point at a different machine than the positions — that would be a crash, not a cosmetic issue.',
    ],
  },
  {
    version: '1.1.28',
    de: [
      'BEHOBEN: Die geführte Erstkalibrierung stürzte beim Öffnen ab („homing is not defined"). Der Home-Knopf, den ich in 1.1.21 eingebaut habe, benutzte einen Zustand, den ich nie angelegt hatte — die ganze Seite blieb dadurch weiß.',
      'BEHOBEN: Der Test-Knopf für Push-Benachrichtigungen meldete immer „Test fehlgeschlagen". Der eigentliche Aufruf an den Server fehlte in der Funktion; der Fehler fiel in einen leeren Auffang-Block und war deshalb nicht zu sehen.',
      'NEU IM WÄCHTER: Die Testläufe prüfen jetzt zusätzlich auf vergessene Variablen. Genau diese beiden Fehler hätte kein Test gefunden — sie brechen erst beim Anzeigen, und die Prüfung lief bisher nirgends. Bewusst nur die Absturz-Regeln, damit der Wächter nicht im Stil-Meckern untergeht.',
    ],
    en: [
      'FIXED: the guided first calibration crashed on open ("homing is not defined"). The home button I added in 1.1.21 used a state value I never created — the whole page stayed blank.',
      'FIXED: the test button for push notifications always reported "test failed". The actual call to the server was missing from the function; the error fell into an empty catch block and was therefore invisible.',
      'NEW GUARD: the test runs now also check for forgotten variables. Neither of these two bugs would have been caught by a test — they only break at render time, and the check was not running anywhere. Deliberately limited to the crash rules so the guard is not drowned out by style complaints.',
    ],
  },
  {
    version: '1.1.27',
    de: [
      'BEHOBEN: In 1.1.26 fehlte die englische Fassung eines Hinweistextes im Drucker-Tab — die englische Oberfläche zeigte dort Deutsch. Der Übersetzungs-Wächter hatte es gemeldet, ich hatte seine Ausgabe abgeschnitten und den Fehlschlag übersehen.',
    ],
    en: [
      'FIXED: version 1.1.26 was missing the English text for one hint in the printer tab — the English interface showed German there. The translation guard had reported it; I had truncated its output and missed the failure.',
    ],
  },
  {
    version: '1.1.26',
    de: [
      'MAGNET-GREIFER AM DRUCKER: eigene Bewegung statt der Klemm-Wege. Bisher nutzte der Magnet beim Auswerfen und Einlegen die Bewegung des Klemm-Greifers samt X-Andruck — das war der letzte Ort, an dem er noch seitlich gefahren wäre. Jetzt richtet er die X genau einmal aus und lässt sie stehen.',
      'Auswerfen (gemessen): Y250 → Y343 → Z76 → Y300/Z73 → Y250/Z70 → Y225/Z60 → Y25/Z40. Der Arm fährt auf Bett-Höhe unter die Platte, hebt sie an und zieht auf einer Rampe heraus, die gleichzeitig hochgeht — der Greifer muss über die Druckerkante. Die Rampe läuft bewusst ohne Zwischenhalt durch, sonst ruckelt der Arm mit der Platte über die Kante.',
      'Einlegen (gemessen): Y25/Z73 → Y220 → Z75 → Y343 → Z20. Der Arm kommt hoch herein, fährt über das Bett und senkt die Platte darauf ab — dieselbe Mechanik wie beim Ablegen ins Regal, nur ohne das Untertauchen, weil das Bett der Anschlag ist.',
      'Alle Zahlen sind Versätze zur eingetragenen Drucker-Position: steht der Drucker woanders, wandert die ganze Bewegung mit. Die Regel „mit Platte nie unter Y25" gilt auch hier.',
      'ABLEGEN INS REGAL: Abstand zum Greif-Y von 1 auf 2 mm. Ablegen fährt damit Y25 → Z50 → Y300 → Y340 → Z10 → Y300.',
      'Der Klemm-Greifer bleibt am Drucker unverändert — abgesichert durch eine Gegenprobe, die seine erzeugte Bewegung mit der von vorher vergleicht.',
    ],
    en: [
      'MAGNETIC GRIPPER AT THE PRINTER: its own motion instead of the clamping paths. Until now the magnet used the clamping gripper motion including the X push when ejecting and placing — the last place where it would still have travelled sideways. It now aligns X exactly once and leaves it there.',
      'Ejecting (measured): Y250 → Y343 → Z76 → Y300/Z73 → Y250/Z70 → Y225/Z60 → Y25/Z40. The arm moves in at bed height underneath the plate, lifts it and pulls out along a ramp that rises at the same time — the gripper has to clear the printer edge. The ramp deliberately runs through without intermediate stops, otherwise the arm judders over the edge with the plate.',
      'Placing (measured): Y25/Z73 → Y220 → Z75 → Y343 → Z20. The arm enters high, travels over the bed and lowers the plate onto it — the same mechanism as storing into a rack, only without dipping below, because the bed is the stop.',
      'All numbers are offsets from the printer position you entered: if the printer sits elsewhere, the whole motion moves with it. The rule "never below Y25 while carrying a plate" applies here too.',
      'STORING INTO A RACK: the gap to the engage Y goes from 1 to 2 mm. Storing therefore runs Y25 → Z50 → Y300 → Y340 → Z10 → Y300.',
      'The clamping gripper is unchanged at the printer — covered by a counter-check that compares its generated motion against the previous one.',
    ],
  },
  {
    version: '1.1.25',
    de: [
      'MAGNET-GREIFER: MIT PLATTE NIE UNTER Y25. Der Rückzugsanschlag ist auf den LEEREN Greifer bemessen — mit Platte steht der Arm weiter vorn im Raum, und wie weit er zurück darf, ist eine andere Zahl. Sie gilt jetzt als Regel an jeder Stelle, an der der Arm etwas trägt: Ablegen, Vor-Drucker-Fahren, Auswerfen und Einlegen.',
      'Die Regel greift auch dort, wo sie vorher nur zufällig gehalten hätte: die Y-Rampe nach dem Auswerfen tauchte bei einem engen Greif-Y unter die Schranke, und im Einlegen stand ein fest eingetragenes Y50. Beides läuft jetzt durch dieselbe Prüfung. Die Schranke hebt nur an und senkt nie — ein bereits höherer Wert bleibt stehen.',
      'ABLEGEN: Der Arm bleibt auf Y25 und setzt einen Millimeter vor dem Greif-Y ab (Y341 statt Y342). Beides ist einstellbar — „Y-Minimum mit Platte" und „Ablege-Abstand" im Drucker-Tab.',
      'Ablegen fährt damit: Y25 → Z50 → Y300 → Y341 → Z10 → Y300.',
      'Der Klemm-Greifer bleibt unberührt. Er hält die Platte anders und fährt seine gemessenen Wege seit jeher ohne diese Schranke — sie gilt ausschließlich für den Magneten.',
    ],
    en: [
      'MAGNETIC GRIPPER: NEVER BELOW Y25 WHILE CARRYING A PLATE. The retract stop is dimensioned for an EMPTY gripper — with a plate the arm sits further forward, and how far back it may go is a different number. It now applies as a rule everywhere the arm carries something: storing, moving to the printer, ejecting and placing.',
      'The rule also covers places where it would previously have held only by coincidence: the Y ramp after ejecting dipped below the limit at a tight engage Y, and placing contained a hard-coded Y50. Both now go through the same check. The limit only raises and never lowers — a value that is already higher stays as it is.',
      'STORING: the arm stays at Y25 and sets the plate down one millimetre short of the engage Y (Y341 instead of Y342). Both are adjustable — "Y minimum when loaded" and "Store gap" in the printer tab.',
      'Storing therefore runs: Y25 → Z50 → Y300 → Y341 → Z10 → Y300.',
      'The clamping gripper is untouched. It holds the plate differently and has always driven its measured paths without this limit — it applies to the magnet only.',
    ],
  },
  {
    version: '1.1.24',
    de: [
      'MAGNET-GREIFER: Beim Greifen richtet der Arm die X jetzt auf einer REISE-Y aus (280) statt am Rückzugsanschlag (5). Von ganz hinten auf Fachhöhe zu fahren war nur verschenkter Weg; 280 ist dieselbe Reise-Y, die auch der Original-Greifer benutzt.',
      'Der Rückzug nach dem Anheben geht auf Y25 statt bis an den Anschlag. Der Arm trägt an dieser Stelle eine Platte und muss nur weit genug heraus, um frei zu sein. Beide Werte sind im Drucker-Tab einstellbar („Reise-Y" und „Y-Rückzug").',
      'Greifen fährt damit: Y280 → Z15 → Y300 → Y342 → Z30 → Y25.',
      'Das ABLEGEN richtet die X bewusst weiterhin am Rückzugsanschlag aus. Dort trägt der Arm einen fertigen Druck — ihn 275 mm weiter vorn quer durch die Anlage zu fahren ist eine andere Zusage als mit leerem Greifer, und die gehört gemessen statt abgeleitet.',
    ],
    en: [
      'MAGNETIC GRIPPER: when grabbing, the arm now aligns X at a TRAVEL Y (280) instead of at the retract stop (5). Moving from the far back onto slot height was wasted travel; 280 is the same travel Y the original gripper uses.',
      'The retract after lifting goes to Y25 rather than all the way to the stop. The arm is carrying a plate at that point and only needs to come out far enough to be clear. Both values are adjustable in the printer tab ("Travel Y" and "Y retract").',
      'Grabbing therefore runs: Y280 → Z15 → Y300 → Y342 → Z30 → Y25.',
      'STORING deliberately still aligns X at the retract stop. There the arm carries a finished print — moving it 275 mm further forward across the machine is a different promise than doing so with an empty gripper, and that belongs measured rather than inferred.',
    ],
  },
  {
    version: '1.1.23',
    de: [
      'BEHOBEN: „Zu dicht am Endschalter" kam beim Magnet-Greifer weiterhin. Die Prüfung lag an ZWEI Stellen — im Backend (v1.1.22 korrigiert) und noch einmal im Drucker-Tab, wo Regal-Karte und Schienen-Übersicht sie selbst rechnen. Diese zweite Stelle kannte den Greifer nicht. Beide fragen jetzt denselben Wert ab: an den Regalen ist der Andruck-Weg beim Magnet 0, am Drucker gelten die 30 mm weiter.',
      'Abgesichert ist nicht nur das Verschwinden der Meldung, sondern auch die Gegenprobe: die erzeugte Magnet-Bewegung ist an genau diesem Regal tatsächlich fahrbar. Sonst wäre nur eine Warnung stumm geschaltet worden, während der Arm weiter unter Null fährt.',
      'EINMESSEN: Referenzfahrt-Knopf ganz oben im Schritt „Einmessen". Ohne Homing lehnt Klipper jede Bewegung ab — Anfahren und Justieren scheiterten also beide, und die Meldung sagte nicht, dass die Referenzfahrt fehlt. Der Knopf zeigt an, ob sie gelaufen ist.',
    ],
    en: [
      'FIXED: "too close to the endstop" still appeared for the magnetic gripper. The check lived in TWO places — in the backend (corrected in v1.1.22) and again in the printer tab, where the rack card and the rail overview compute it themselves. That second place did not know about the gripper. Both now read the same value: at the racks the push distance is 0 for the magnet, at the printer the 30 mm still apply.',
      'What is covered by tests is not only that the message disappears but also the counter-check: the generated magnetic motion really is drivable at that very rack. Otherwise a warning would merely have been silenced while the arm still travelled below zero.',
      'MEASURING IN: a homing button at the top of the "measuring in" step. Without homing, Klipper rejects every move — so driving to a position and adjusting it both failed, and the message did not say that homing was what was missing. The button shows whether it has run.',
    ],
  },
  {
    version: '1.1.22',
    de: [
      'MAGNET-GREIFER AUF DIE GEMESSENE BEWEGUNG UMGEBAUT. Meine erste Fassung fuhr über der Platte ein und senkte sich auf sie ab — das war falsch herum. Der Magnet nimmt die Platte von UNTEN auf: der Arm fährt auf Fachhöhe unter sie und hebt sie an. Gemessen an Regal 3 Fach 1: Greifen Z15 → Y300 → Y342 → Z30 → Y20.',
      'Damit ist auch das Ablösen geklärt, das bisher der offene Punkt war. Beim Ablegen kommt der Arm HÖHER herein als die Fachhöhe und senkt sich DARUNTER: die Platte setzt auf, der Arm fährt unter ihr weg, der Magnet lässt los. Es braucht keinen Abstreifer. Gemessen: Ablegen Z50 → Y342 → Z10 → Y300.',
      'Fünf einstellbare Werte statt zwei (Drucker-Tab → „Greifer & Platte"): Anheben, Einfahrhöhe, Ablöse-Tiefe, Y-Vorposition und ein X-Versatz fürs Ablegen. Unsinnige Eingaben werden abgefangen — eine Einfahrhöhe unter dem Anhebeweg ließe die getragene Platte am Fach darüber streifen, eine negative Ablöse-Tiefe würde beim Ablegen anheben statt absetzen.',
      'BEHOBEN: „Regal steht zu dicht am Endschalter" erschien auch beim Magnet-Greifer. Die Meldung gehört zum Andruck-Weg des Klemm-Greifers — der Magnet fährt beim Greifen und Ablegen gar nicht mehr in X. Am Drucker (Auswurf, Einlegen) gilt der Andruck-Weg weiterhin, dort wird auch weiter geprüft.',
      'TÜRBEWEGUNG auf die gemessene Form umgestellt. Die eingegebenen X/Y/Z bleiben der erste Fahrpunkt, alle Zwischenpunkte sind jetzt Versätze davon — die ganze Schwenkform wandert mit, wenn der Drucker woanders steht. Der Öffnungsbogen schwingt bis Y0, der Schließbogen wird geometrisch aus Radius und Sehne bestimmt; beide behalten dabei einen gültigen Radius, was Klipper sonst mitten in der Bewegung abbrechen lässt.',
      'Die Zu-Position des Schließens kommt jetzt aus dem Öffnen-Punkt statt aus einer zweiten, getrennt gepflegten Zahl für dieselbe Stelle. Ein zu kleiner Bogenradius (Zahlendreher) erzeugt keinen ungültigen G-code mehr, sondern fällt auf einen fahrbaren Bogen zurück.',
    ],
    en: [
      'MAGNETIC GRIPPER REBUILT AROUND THE MEASURED MOTION. My first version entered above the plate and lowered onto it — that was the wrong way round. The magnet picks the plate up from BELOW: the arm moves in at slot height underneath it and lifts. Measured on rack 3 slot 1: grabbing Z15 → Y300 → Y342 → Z30 → Y20.',
      'That also settles the release, which had been the open question. When storing, the arm enters HIGHER than the slot and lowers BELOW it: the plate sets down, the arm moves away underneath it, the magnet lets go. No stripper needed. Measured: storing Z50 → Y342 → Z10 → Y300.',
      'Five adjustable values instead of two (printer tab → "Gripper & plate"): lift, entry height, release depth, Y approach and an X offset for storing. Nonsensical entries are caught — an entry height below the lift would drag the carried plate along the slot above, and a negative release depth would lift when storing instead of setting down.',
      'FIXED: "rack is too close to the endstop" also appeared for the magnetic gripper. That message belongs to the push distance of the clamping gripper — the magnet no longer moves in X when grabbing or storing at all. At the printer (eject, place) the push distance still applies and is still checked.',
      'DOOR MOTION switched to the measured shape. The X/Y/Z you enter remain the first travel point, and every intermediate point is now an offset from it — the whole swing shape moves along when the printer sits elsewhere. The opening arc swings out to Y0, the closing arc is derived geometrically from radius and chord; both keep a valid radius, which Klipper would otherwise abort on mid-motion.',
      'The closed position for closing now comes from the opening point instead of a second, separately maintained number for the same spot. A radius that is too small (a typo) no longer produces invalid G-code but falls back to an arc that can actually be driven.',
    ],
  },
  {
    version: '1.1.21',
    de: [
      'MAGNET-GREIFER ZUM AUSTESTEN FREIGEGEBEN. Er lässt sich jetzt im Setup-Assistenten auswählen und trägt dort das Kennzeichen „Test". Greifen und Ablegen fahren damit nur noch in Z: der Arm fährt über der Platte ins Fach, senkt sich auf sie ab, hebt sie an und zieht heraus — kein Weg mehr nach links/rechts. Magazin und Lagerfach werden dadurch zur selben Bewegung.',
      'Schwebe-Höhe und Anhebeweg sind einstellbar (Drucker-Tab → „Greifer & Platte"), weil sie am realen Aufbau noch nicht vermessen sind. Fest eingebaut hätte jeder danebenliegende Testlauf eine neue Programmversion gebraucht. Beim Magnet-Greifer erscheinen dort diese beiden Felder ANSTELLE des Andruck-Wegs — eine Anlage hat immer nur einen Greifarm, beide Sätze gleichzeitig wären zur Hälfte Lärm.',
      'Unsinnige Werte werden abgefangen, nicht übernommen: eine Schwebe-Höhe von 0 oder darunter würde den Arm auf Plattenhöhe einfahren lassen, wo er die Platte vor sich her schöbe; ein Anhebeweg unterhalb der Schwebe-Höhe würde die Platte gar nicht erst aus dem Fach ziehen. Beides wird auf einen sicheren Wert angehoben.',
      'Das Ablösen beim Ablegen bleibt der offene Punkt: der Arm hebt nach dem Absetzen einfach ab. Ob die Fachhalterung die Platte dabei hält oder es einen Abstreifer braucht, zeigt erst der Testlauf — deshalb steht im Drucker-Tab der Hinweis, Greifen und Ablegen zuerst einzeln über die Test-Knöpfe zu fahren statt gleich mit einer Farm-Sequenz.',
      'Der Klemm-Greifer bleibt unangetastet: die neuen Werte wirken ausschließlich auf die Magnet-Bewegung, und ohne Angabe fährt jede Bestandsanlage weiter wie bisher.',
    ],
    en: [
      'MAGNETIC GRIPPER RELEASED FOR TESTING. It can now be selected in the setup wizard, where it is marked "Testing". Grabbing and storing move in Z only: the arm enters the slot above the plate, lowers onto it, lifts it and pulls out — no more left/right travel. Magazine and storage slot become the same motion as a result.',
      'Hover height and lift travel are adjustable (printer tab → "Gripper & plate"), because they have not been measured on the real build yet. Hard-coded, every test run that came out wrong would have needed a new program version. For the magnetic gripper these two fields appear INSTEAD of the push distance — a machine only ever has one gripper arm, so showing both sets would be half noise.',
      'Nonsensical values are caught rather than applied: a hover height of 0 or below would send the arm in at plate height, where it would shove the plate ahead of it; a lift travel below the hover height would never pull the plate out of the slot. Both are raised to a safe value.',
      'The release when storing remains the open question: the arm simply lifts off after setting the plate down. Whether the slot holder keeps the plate there or a stripper is needed can only be shown by a test run — which is why the printer tab advises running grabbing and storing individually via the test buttons first, rather than straight away with a farm sequence.',
      'The clamping gripper is untouched: the new values affect the magnetic motion only, and without any setting every existing machine keeps moving exactly as before.',
    ],
  },
  {
    version: '1.1.20',
    de: [
      'Setup-Assistent: Beim obersten Fach war die Herkunft vertauscht. „Alle Fächer = Lagerfächer" ist der Original-Aufbau und steht jetzt links mit dem Tag „OTTOmat3D"; das Magazin ist die Printloom-Erweiterung und steht rechts mit „Printloom". Vorausgewählt bleibt bewusst das Magazin — nur damit holt sich die Farm selbst Nachschub.',
    ],
    en: [
      'Setup wizard: the origin of the top-slot options was swapped. "All slots = storage" is the original build and now sits on the left tagged "OTTOmat3D"; the magazine is the Printloom extension and sits on the right tagged "Printloom". The magazine stays preselected on purpose — it is the only option where the farm fetches its own supply.',
    ],
  },
  {
    version: '1.1.19',
    de: [
      'GEFÜHRTE ERSTKALIBRIERUNG als letzter Schritt des Setup-Assistenten. Printloom fährt jede Position selbst an, du justierst mit den Pfeilen nach und übernimmst — der Wert kommt aus der echten Ist-Position, nicht aus einem Eingabefeld. Die Reihenfolge folgt der Abhängigkeit: Regal 1 (Anker) → Magazin → äußerstes Regal → Drucker. Jede Station ist einzeln überspringbar, der ganze Schritt auch.',
      'Zwei Werte muss dabei niemand mehr abmessen: Aus der Höhe von Fach 1 und der Höhe des Magazins rechnet Printloom den FACH-ABSTAND aus — der Wert, bei dem ein Tippfehler den Arm ins Blech fährt. Aus Regal 1 und dem äußersten Regal folgt der REGAL-ABSTAND; die Regale dazwischen werden verteilt und bleiben einzeln korrigierbar.',
      'Der Einmess-Schritt ist bewusst vom Kalibrierungs-Schritt getrennt: Homing-Datei und Achsgrenzen sind die Voraussetzung (ohne sie kein geprüftes Verfahren), das Einmessen die Arbeit danach. In einem Schritt wäre es eine lange Wand.',
      'DASHBOARD FREI KONFIGURIERBAR. Die Startseite ist jetzt ein Raster: jedes Panel lässt sich verschieben, in der Größe ändern und ausblenden — über „✎ Layout" oben rechts. Bisher stand die Startseite in einer festen Reihenfolge in einer schmalen Spalte, egal wie breit der Bildschirm war.',
      'Für jede Bildschirmbreite eine eigene Anordnung: breit (ab 1100 px), mittel (ab 700 px) und Handy (eine Spalte). Die drei Anordnungen sind ausgeschrieben und nicht aus einer heruntergerechnet — ein Desktop-Raster auf 360 px zusammengestaucht ergibt übereinanderliegende Fetzen. Verschieben am Handy ändert also die Reihenfolge, nicht die Position, und die Desktop-Anordnung bleibt unberührt. Das Layout liegt auf dem Server, gilt auf allen Geräten und steckt im Backup.',
      'SETUP-ASSISTENT: GREIFER als eigene Komponente. Neben Regal-Halterung und oberstem Fach fragt der Assistent jetzt den Greifarm ab — er ist unabhängig vom Regal, und nur er entscheidet, WIE eine Platte aufgenommen wird.',
      'NEU: MAGNET-GREIFER (in Arbeit). Umgebauter Greifarm mit magnetischem Greifmechanismus. Er zieht beim Greifen und Ablegen NICHT mehr nach links oder rechts, sondern senkt sich nur ab, nimmt die Platte auf und hebt wieder. Dadurch werden Magazin und Lagerfach zur selben Bewegung — der NOLIFT-Sonderweg des Original-Greifers entfällt.',
      'Magnet-Greifer und Kompakt-Halterung sind SICHTBAR, aber ausgegraut und mit „In Arbeit" gekennzeichnet: die Bauformen existieren, ihre Maße sind am realen Aufbau aber noch nicht nachgemessen. Sichtbar statt versteckt, damit erkennbar ist, was kommt. Wer die Kompakt-Halterung schon ausgewählt hatte, behält sie.',
      'Jede Option trägt jetzt ihre Herkunft: „OTTOmat3D" für den Original-Aufbau, „Printloom" für eine ergänzte Bauform. Vorher war nicht erkennbar, was Originalteil ist und was eine Erweiterung.',
      'BEHOBEN: Die Magazin-Anzeige auf der Startseite rechnete gegen den falschen Nenner. Sie verglich die Platten in den Magazinen mit der Zahl der LAGERFÄCHER — bei 3 Regalen mit je 4 Platten und 6 Lagerfächern stand dort „12 von 18", obwohl 12 die volle Bestückung ist. Jetzt gilt die konfigurierte Soll-Zahl.',
      'BEHOBEN: Einstellungen wirken bei laufender Farm. Fehlerstrategie, Betriebszeiten, HMS-Liste, Wiederholversuche, Bewegungs-Timeout und „nur exakte Farbe" waren beim Start eingefroren — die Oberfläche sagte „Gespeichert.", wirksam wurde es aber erst beim nächsten Start, und das stand nirgends. Sie werden jetzt im laufenden Betrieb nachgezogen. Laufzeit-Zustand (Jobs, Greifer, Fach-Belegung) bleibt unberührt: den mitten im Druck zu ersetzen wäre kein Nachziehen, sondern ein Neustart.',
      'BEHOBEN: Der Filamentpreis war eine tote Einstellung — gespeichert, angezeigt, nirgends verrechnet. Die Materialkosten stehen jetzt neben Strom- und Maschinenkosten in den Gesamtkosten. Der Verbrauch kommt plattengenau aus dem G-code-Header der gedruckten Datei. Dateien ohne Angabe (Fremdformate, alte Slicer) werden NICHT als 0 g verbucht, sondern benannt — eine unvollständige Rechnung soll nicht vollständig aussehen.',
      'BEHOBEN: Zeitstempel der Druck-Historie lagen zwei Stunden in der Vergangenheit. Sie wurden als UTC ohne Zeitzonen-Angabe geschrieben, was der Browser als lokale Zeit liest. Alles andere in Printloom schreibt lokale Zeit — es lagen also zwei Konventionen in einer App. Neue Stempel tragen einen Marker, Bestandseinträge bekommen ihn beim Lesen nachgetragen. Auch Schnappschuss-Dateinamen tragen jetzt die eigene Uhrzeit.',
      'BEHOBEN: Die verbauten Komponenten lagen nur im Browser. Ein zweites Gerät zeigte im Assistenten „Standard-Halterung", obwohl die Anlage anders gebaut ist — und hätte beim Übernehmen die echte Auswahl überschrieben. Sie kommen jetzt vom Server.',
      'Kleinigkeiten: In der Startseite steckte eine tote Zeitberechnung, die nichts anzeigte; die Anzahl gerade druckender Fächer wurde berechnet, aber nirgends gezeigt — sie steht jetzt bei den Kennzahlen. Panels ohne Daten verschwinden nicht mehr, sondern sagen, dass noch nichts da ist (ein verschwindendes Panel hätte im Raster ein Loch hinterlassen).',
    ],
    en: [
      'GUIDED FIRST CALIBRATION as the final step of the setup wizard. Printloom drives to each position itself, you adjust with the arrow keys and apply — the value comes from the real current position, not from an input field. The order follows the dependency: rack 1 (the anchor) → magazine → outermost rack → printer. Every station can be skipped individually, and so can the whole step.',
      'Two values nobody has to measure any more: from the height of slot 1 and the height of the magazine, Printloom computes the SLOT SPACING — the value where a typo drives the arm into sheet metal. From rack 1 and the outermost rack follows the RACK SPACING; the racks in between are spaced out and stay individually adjustable.',
      'The measuring step is deliberately separate from the calibration step: the homing file and the axis limits are the prerequisite (without them there is no checked movement), measuring in is the work that follows. In one step it would be a long wall of text.',
      'DASHBOARD IS NOW FREELY CONFIGURABLE. The home page is a grid: every panel can be moved, resized and hidden — via "✎ Layout" at the top right. Until now the home page was a fixed sequence in one narrow column, no matter how wide the screen was.',
      'A separate arrangement for each screen width: wide (from 1100 px), medium (from 700 px) and phone (single column). The three arrangements are written out rather than derived from one another — a desktop grid squeezed into 360 px produces overlapping scraps. So dragging on a phone changes the order, not the position, and the desktop arrangement is left untouched. The layout is stored on the server, applies on every device and is part of the backup.',
      'SETUP WIZARD: THE GRIPPER IS NOW ITS OWN COMPONENT. Alongside the rack holder and the top slot, the wizard now asks about the gripper arm — it is independent of the rack, and it alone decides HOW a plate is picked up.',
      'NEW: MAGNETIC GRIPPER (in progress). A converted gripper arm with a magnetic grip mechanism. When grabbing and storing it no longer pulls left or right; it only lowers, picks the plate up and lifts again. As a result magazine and storage slot become the same motion — the original gripper\'s NOLIFT special case falls away.',
      'The magnetic gripper and the compact holder are VISIBLE but greyed out and marked "In progress": the variants exist, but their dimensions have not been measured on the real build yet. Visible rather than hidden, so you can see what is coming. Anyone who had already selected the compact holder keeps it.',
      'Every option now carries its origin: "OTTOmat3D" for the original build, "Printloom" for an added variant. Previously there was no way to tell an original part from an extension.',
      'FIXED: the magazine display on the home page used the wrong denominator. It compared the plates in the magazines against the number of STORAGE SLOTS — with 3 racks holding 4 plates each and 6 storage slots it read "12 of 18", although 12 is a full load. It now uses the configured target count.',
      'FIXED: settings take effect while the farm is running. Error strategy, operating hours, HMS list, retries, move timeout and "exact colour only" were frozen at start — the interface said "Saved.", but it only took effect on the next start, and that was stated nowhere. They are now picked up during operation. Runtime state (jobs, gripper, slot occupancy) is left untouched: replacing that mid-print would not be an update but a restart.',
      'FIXED: the filament price was a dead setting — stored, displayed, never used in any calculation. Material costs now sit alongside power and machine costs in the total. Usage is read per plate from the G-code header of the printed file. Files without a figure (foreign formats, old slicers) are NOT booked as 0 g but named — an incomplete calculation should not look complete.',
      'FIXED: timestamps in the print history were two hours in the past. They were written as UTC without a timezone marker, which the browser reads as local time. Everything else in Printloom writes local time — so two conventions were living in one app. New timestamps carry a marker, and existing entries have one added when read. Snapshot filenames now carry your own local time too.',
      'FIXED: the components you built were stored only in the browser. A second device showed "Standard holder" in the wizard although the machine is built differently — and would have overwritten the real selection on apply. They now come from the server.',
      'Small things: the home page contained a dead time calculation that displayed nothing; the number of slots currently printing was computed but never shown — it now appears under the key figures. Panels without data no longer disappear but say that there is nothing yet (a vanishing panel would have left a hole in the grid).',
    ],
  },
  {
    version: '1.1.18',
    de: [
      'NEU: STRESSTEST im Drucker-Tab. Er holt eine leere Platte aus Magazin 1, legt sie in ein zufälliges freies Fach und wiederholt das, bis alle Magazine leer sind. Weil die Ziele gewürfelt werden, entstehen lauter unterschiedlich lange Wege quer über die Schiene statt derselben Strecke im Kreis — der Dauerlauf für Riemen, Endschalter, Wiederholgenauigkeit und die eingemessene Geometrie, ganz ohne einen einzigen Druck.',
      'Vor dem Start steht da, was passieren wird: wie viele Platten, wohin sie gehen und wie lange es ungefähr dauert. Die Zeit ist nicht geraten — Printloom erzeugt den G-code, den der Test wirklich fahren würde, und rechnet Strecke ÷ Vorschub, plus einen Zuschlag fürs Beschleunigen und Bremsen. Die echte Zeit hängt an deiner Klipper-Beschleunigung und liegt eher etwas darüber.',
      'Danach sind die Magazine LEER und die Platten liegen verteilt in den Fächern. Das ist das Ergebnis, kein Versehen — zurückräumen ist Handarbeit. Die Rückfrage vor dem Start sagt das ausdrücklich.',
      'Der Plan hält sich an dieselben Kollisionsregeln wie die Farm und prüft sich dabei gegen sich selbst: eine Platte, die der Test gerade abgelegt hat, zählt für die nächste Entscheidung schon als liegend. Magazin-Fächer, gesperrte und belegte Fächer sowie Fächer unter einem hohen Druck kommen nie als Ziel infrage — dort käme die Platte nicht herein.',
      'Nach JEDER Platte werden Magazin-Bestand und Fach-Belegung nachgezogen, nicht erst am Ende. Bricht der Test ab — Stopp, Fehler, Stromausfall — stimmt die Anzeige trotzdem mit der Wirklichkeit überein. Passen nicht alle Platten in die freien Fächer, bleibt der Rest im Magazin und wird benannt, statt still zu verschwinden.',
    ],
    en: [
      'NEW: STRESS TEST in the printer tab. It takes an empty plate from magazine 1, puts it into a random free slot and repeats until every magazine is empty. Because the destinations are rolled at random, you get travels of many different lengths across the rail instead of the same loop over and over — an endurance run for belts, endstops, repeatability and the geometry you measured in, without printing anything at all.',
      'Before you start, it shows what will happen: how many plates, where they go and roughly how long it takes. The time is not guessed — Printloom generates the G-code the test would actually drive and computes distance ÷ feedrate, plus an allowance for accelerating and braking. The real time depends on your Klipper acceleration and will tend to be a little longer.',
      'Afterwards the magazines are EMPTY and the plates are spread across the slots. That is the result, not a mishap — putting them back is manual work. The confirmation before starting says so explicitly.',
      'The plan follows the same collision rules as the farm and checks itself against itself: a plate the test has only just put down already counts as lying there for the next decision. Magazine slots, locked and occupied slots, and slots above a tall print are never used as destinations — a plate could not enter there.',
      'Magazine counts and slot occupancy are updated after EVERY plate, not at the end. If the test stops — button, error, power cut — the display still matches reality. If not every plate fits into the free slots, the rest stays in the magazine and is named, instead of quietly disappearing.',
    ],
  },
  {
    version: '1.1.16',
    de: [
      'UPDATE-SCHLEIFE BEHOBEN. Nach einem Update konnte sich die App in einer Endlosschleife aus Neuladen festfahren und war nicht mehr bedienbar.',
      'Die Ursache: Die index.html — die Datei, in der die Namen aller anderen Dateien stehen — durfte vom Browser zwischengespeichert werden. Nach einem Update holte der Browser sie aus seinem Cache und lud damit weiter das ALTE Frontend, während der Server längst die neue Version meldete. Die App bemerkte den Unterschied, lud neu, bekam wieder dieselbe alte Datei aus dem Cache — und wieder von vorn. Die index.html wird jetzt nie mehr zwischengespeichert.',
      'Zusätzlich eine Bremse: Hat Neuladen nach zwei Versuchen nichts geändert, lädt die App nicht mehr weiter, sondern sagt oben, was los ist — inklusive dem Tastenkürzel, das den Cache umgeht (Strg+Umschalt+R). Vorher gab es gegen die Schleife überhaupt keine Sicherung: der Merker dagegen lag im Speicher der Seite, und den löscht das Neuladen ja gerade.',
      'Als Nebeneffekt lädt die Seite schneller: Die JS- und CSS-Dateien tragen einen Namen, der sich bei jeder Änderung mitändert. Sie dürfen deshalb jetzt dauerhaft im Browser liegen bleiben, statt bei jedem Aufruf neu geholt zu werden.',
    ],
    en: [
      'UPDATE LOOP FIXED. After an update the app could get stuck in an endless reload loop and became unusable.',
      'The cause: index.html — the file that holds the names of all the other files — was allowed to be cached by the browser. After an update the browser took it from its cache and kept loading the OLD frontend, while the server had long since been reporting the new version. The app noticed the difference, reloaded, got the same cached file again — and round it went. index.html is now never cached.',
      'Plus a brake: if reloading has not changed anything after two attempts, the app stops reloading and says what is going on at the top of the page — including the shortcut that bypasses the cache (Ctrl+Shift+R). Previously there was no safeguard at all: the flag meant to prevent it lived in the page\'s memory, and reloading is precisely what wipes that.',
      'A welcome side effect: the page loads faster. The JS and CSS files carry a name that changes whenever their content changes, so they may now stay in the browser permanently instead of being fetched on every visit.',
    ],
  },
  {
    version: '1.1.15',
    de: [
      'Der blaue „Update installieren"-Knopf unter System erscheint jetzt nur noch, wenn es wirklich ein Update gibt. Vorher stand er dauerhaft da und bot „Neu installieren" an — das sah aus wie eine offene Aufgabe, war aber keine.',
      'Ist alles aktuell, steht an der Stelle nur noch ein unauffälliger Link „Trotzdem neu installieren / Kanal wechseln". Der wird gebraucht: Der Weg von Beta zurück auf Stabil meldet nie ein „Update" (die stabile Version ist ja älter) — ohne diesen Link käme man aus dem Beta-Kanal nicht mehr heraus. Auch wenn die Prüfung selbst scheitert, weil GitHub nicht erreichbar ist, bleibt man damit handlungsfähig.',
    ],
    en: [
      'The blue "Install update" button under System now only appears when there actually is an update. Before it sat there permanently offering "Reinstall" — which looked like an open task but was not one.',
      'When everything is current, all that remains in its place is a quiet "Reinstall anyway / switch channel" link. It is needed: going from beta back to stable never reports an "update" (the stable version is older, after all) — without that link there would be no way out of the beta channel. It also keeps you able to act when the check itself fails because GitHub is unreachable.',
    ],
  },
  {
    version: '1.1.14',
    de: [
      'Die Smart-Steckdose lässt sich jetzt direkt oben in der Kopfleiste schalten — neben den Status-Anzeigen für Drucker und Klipper. Kein Umweg mehr über Konfiguration → Geräte.',
      'Der Knopf zeigt gleich mit, was gerade fließt: bei eingeschalteter Dose die aktuelle Leistung in Watt, sonst „Aus". Ist die Steckdose selbst nicht erreichbar, steht dort „?" — und ausdrücklich NICHT „Aus", denn niemand weiß dann, wie sie wirklich steht.',
      'Ausschalten fragt vorher nach. Der Knopf sitzt dauerhaft oben rechts, und ein Fehlklick kappt dem Drucker mitten im Druck den Strom. Läuft die Auto-Farm, sagt die Rückfrage das ausdrücklich. Einschalten geht ohne Nachfrage.',
      'Der Knopf erscheint nur, wenn unter Konfiguration → Geräte → „Energie & Kosten" wirklich eine Steckdose eingerichtet ist (Home Assistant, Tasmota oder Shelly). Bei mehreren Druckern bekommt jeder mit eigener Dose seinen eigenen Knopf.',
      'Abgefragt wird gesammelt über einen einzigen Aufruf statt einen je Drucker, und nur solange der Tab sichtbar ist — im Hintergrund geht keine einzige Anfrage an Home Assistant.',
    ],
    en: [
      'The smart plug can now be switched straight from the top bar — next to the printer and Klipper status pills. No more detour via Configuration → Devices.',
      'The button also shows what is flowing: current draw in watts while the plug is on, otherwise "Off". If the plug itself cannot be reached it shows "?" — deliberately NOT "Off", because at that point nobody knows how it actually stands.',
      'Switching off asks first. The button sits permanently in the top right, and a misclick cuts power to the printer mid-print. If the auto farm is running, the prompt says so explicitly. Switching on needs no confirmation.',
      'The button only appears if a plug is actually set up under Configuration → Devices → "Energy & costs" (Home Assistant, Tasmota or Shelly). With several printers, each one with its own plug gets its own button.',
      'State is fetched in one combined call instead of one per printer, and only while the tab is visible — in the background not a single request goes to Home Assistant.',
    ],
  },
  {
    version: '1.1.13',
    de: [
      'Der Datei-Browser zeigt jetzt bei jeder Datei, wann sie hochgeladen wurde — Datum und Uhrzeit. Die Liste war schon immer nach Upload-Zeit sortiert (neueste oben); jetzt sieht man auch, warum sie so sortiert ist.',
      'Dabei ist ein Fehler aufgefallen und mit behoben: Der Server schickte den Zeitpunkt ohne Zeitzone, obwohl es UTC war. Der Browser hätte ihn als Ortszeit gelesen und die Uhrzeit im Sommer um zwei Stunden zu früh angezeigt. Der Zeitpunkt trägt seine Zeitzone jetzt mit — das gilt rückwirkend auch für alle bereits hochgeladenen Dateien.',
    ],
    en: [
      'The file browser now shows when each file was uploaded — date and time. The list has always been sorted by upload time (newest first); now you can see why it is in that order.',
      'A bug turned up while doing this and was fixed along the way: the server sent the timestamp without a timezone even though it was UTC. The browser would have read it as local time and shown the clock two hours early in summer. The timestamp now carries its timezone — retroactively, for every file already uploaded.',
    ],
  },
  {
    version: '1.1.12',
    de: [
      'DIE SEITE LÄDT WIEDER SOFORT. Wer die Datei-Bibliothek öffnete, brachte damit die ganze App ins Stocken: Printloom startete pro Datei gleichzeitig Vorschaubild, Zeitangabe UND den vollständigen Crash-Check — und der liest bei einer 40-MB-Datei den kompletten G-code. Diese Arbeit lief direkt im Herzstück des Servers, das nebenbei auch die Seite selbst ausliefert. Solange sie lief, kam nichts anderes durch: weiße Seite, Warten, Neuladen.',
      'Jetzt läuft alles Datei-lastige nebenher statt mittendrin, und höchstens zwei Vollscans gleichzeitig. Die Bibliothek bleibt dadurch genauso schnell, aber der Rest der App bleibt bedienbar, während sie lädt.',
      'Der Crash-Check merkt sich sein Ergebnis jetzt dauerhaft. Vorher war es nach jedem Neustart und nach jedem Update weg, und beim ersten Öffnen der Bibliothek wurde jede Datei wieder komplett durchgelesen — genau der Moment, in dem es am meisten störte.',
      'Vorschaubilder werden zwischengespeichert und dürfen vom Browser behalten werden. Bisher wurde für JEDES Bild bei JEDEM Öffnen das Archiv neu geöffnet.',
      'Die Datenbank arbeitet jetzt im WAL-Modus mit mehr gleichzeitigen Verbindungen. Vorher blockierte ein Schreibvorgang sämtliche Lesevorgänge, und ab 15 gleichzeitigen Zugriffen stand jeder weitere Aufruf bis zu 30 Sekunden still — auch der, der die Seite lädt.',
      'Ein offener Kamera-Stream belegte eine Datenbank-Verbindung, solange er lief (also stundenlang). Zwei Tabs mit Kamera reichten, um den Rest auszubremsen. Der Stream gibt sie jetzt sofort wieder frei.',
      'Große Dateien werden beim Hochladen stückweise auf die Platte geschrieben statt zuerst komplett in den Arbeitsspeicher. Der Upload blockiert damit nichts mehr.',
      'Die Oberfläche hängt nicht mehr für immer, wenn eine Anfrage unbeantwortet bleibt (Backend startet neu, Netz weg): nach 45 Sekunden gilt sie als gescheitert und die Anzeige erholt sich. Upload, Update und Druck-Übertragung sind bewusst ausgenommen — die dürfen dauern.',
      'Farm-Ansicht: Verband sich ein Browser in genau dem Moment neu, in dem der letzte andere ging, blieb sie eingefroren stehen, bis man neu lud.',
      'Crash-Warnung bei Multi-Plate-Dateien: Es wurde die Höhe der Fundplatte gemeldet statt der höchsten Platte der Datei.',
    ],
    en: [
      'THE PAGE LOADS INSTANTLY AGAIN. Opening the file library used to bring the whole app to a crawl: Printloom kicked off the preview image, the time estimate AND the full crash check for every file at once — and on a 40 MB file that reads the entire G-code. All of it ran right inside the core of the server, which also serves the page itself. While it ran, nothing else got through: blank page, waiting, reloading.',
      'File-heavy work now runs alongside instead of inside that core, and at most two full scans at a time. The library stays just as quick, but the rest of the app stays usable while it loads.',
      'The crash check now remembers its result permanently. Previously it was lost on every restart and every update, so the first time you opened the library every file was read through again — exactly when it hurt most.',
      'Preview images are cached and the browser is allowed to keep them. Until now every image reopened the archive on every visit.',
      'The database now runs in WAL mode with more concurrent connections. Before, a single write blocked all reads, and beyond 15 concurrent accesses every further call stalled for up to 30 seconds — including the one loading the page.',
      'An open camera stream held a database connection for as long as it ran (i.e. hours). Two tabs with a camera were enough to slow everything else down. The stream now releases it immediately.',
      'Large uploads are written to disk in chunks instead of being read into memory in full first. Uploading no longer blocks anything.',
      'The interface no longer hangs forever when a request goes unanswered (backend restarting, network gone): after 45 seconds it counts as failed and the display recovers. Upload, update and sending a print are deliberately exempt — those are allowed to take their time.',
      'Farm view: if a browser reconnected at exactly the moment the last other one left, it stayed frozen until you reloaded.',
      'Crash warning on multi-plate files: it reported the height of the plate where the hit was found instead of the tallest plate in the file.',
    ],
  },
  {
    version: '1.1.11',
    de: [
      'KEIN OBJEKT MEHR GEGEN DIE PLATTE DARÜBER. Liegt im Fach über dem Ziel schon eine Platte — Magazin, markierte Leerplatte oder ein eingelagerter Druck — darf das Objekt nur noch die halbe Fachhöhe hoch sein. Neuer Wert unter Konfiguration → Regal: „Nutzhöhe unter belegtem Fach (%)", Standard 50.',
      'Grund: Die Platte fährt nicht waagerecht auf ihre Endhöhe ins Fach, sondern kommt etwa 25 mm höher herein und wird abgesenkt — beim Holen wird sie genauso angehoben. Während der Fahrt braucht ein Objekt also deutlich mehr Luft als danach. Beim Füllen von unten nach oben fällt das nicht auf, weil das Fach darüber in dem Moment noch leer ist. Über dem Magazin, das nie leer ist, fällt es sofort auf.',
      'Das Magazin gilt dabei IMMER als belegt, auch bei Zähler 0 — es wird von Hand nachgefüllt, jederzeit. Eine Höhe, die nur bei leerem Magazin passt, wäre nach dem nächsten Auffüllen falsch, ohne dass es jemand merkt.',
      'Das kostet Platz: ein 60-mm-Objekt braucht jetzt ein freies Fach über sich, statt sich mit der nächsten Platte zu drängen. Wessen Mechanik mehr hergibt, stellt den Prozentsatz höher — 100 % heißt volle Fachhöhe (aber ohne die Höhen-Toleranz, die genau den Platz beschreibt, den es unter einer Platte nicht gibt).',
      'Der G-code fürs ABLEGEN und GREIFEN lässt sich jetzt sinnvoll bearbeiten: „⚙ Eigenen G-code bearbeiten" lädt die eingebaute Bewegung als Vorlage mit PLATZHALTERN statt fertiger Koordinaten. Die Zuordnung „Regal 1 Fach 3" bleibt damit Sache von Printloom — nur die Bewegung danach gehört dir.',
      'Platzhalter können jetzt rechnen: {slot_z+25} ist die Fachhöhe plus 25 mm, {y_engage-35} entsprechend. Ohne das ließe sich die eingebaute Bewegung gar nicht als bearbeitbare Vorlage ausdrücken — sie fährt genau solche Versätze.',
      'Ein Test hält fest, dass die unveränderte Vorlage Zeichen für Zeichen dieselbe Bewegung erzeugt wie die eingebaute — über alle Regale und Fächer, auch bei unterschiedlich gebauten Regalen.',
    ],
    en: [
      'NO MORE OBJECTS PUSHED INTO THE PLATE ABOVE. If the slot above the target already holds a plate — magazine, marked empty plate or a stored print — the object may only be half the slot height. New value under Configuration → Rack: "Usable height below an occupied slot (%)", default 50.',
      'Reason: the plate does not slide in level at its final height — it enters about 25 mm higher and is then lowered, and it is lifted the same way when fetched. During that movement an object needs considerably more clearance than afterwards. Filling bottom-up hides this, because the slot above is still empty at that moment. Below the magazine, which is never empty, it shows immediately.',
      'The magazine always counts as occupied, even at a count of 0 — it is refilled by hand, at any time. A height that only fits an empty magazine would be wrong after the next top-up, with nobody noticing.',
      'This costs space: a 60 mm object now needs a free slot above it instead of squeezing under the next plate. If your mechanics allow more, raise the percentage — 100 % means the full slot height (but without the height tolerance, which describes exactly the room that is not there below a plate).',
      'The G-code for STORING and GRABBING can now be edited usefully: "⚙ Edit custom G-code" loads the built-in movement as a template with PLACEHOLDERS instead of fixed coordinates. Which rack and which slot stays Printloom\'s job — only the movement after that is yours.',
      'Placeholders can do arithmetic now: {slot_z+25} is the slot height plus 25 mm, {y_engage-35} likewise. Without that the built-in movement could not be expressed as an editable template at all — it drives exactly those offsets.',
      'A test pins down that the unmodified template produces character-for-character the same movement as the built-in one — across every rack and slot, including differently built racks.',
    ],
  },
  {
    version: '1.1.10',
    de: [
      'DIE ABSCHNITTE FOLGEN JETZT DER KONFIGURATION. Wie viele Drucker es gibt, steht in der Geräteliste (Konfiguration → Geräte) — genau wie die Regalzahl in der Rack-Konfiguration steht. Der Drucker-Tab zeigt einen Abschnitt je angelegtem Gerät und je Regal.',
      'Der Knopf „+ Drucker hinzufügen" ist deshalb weg: er wäre eine zweite Stelle gewesen, an der dieselbe Angabe steht. Wer einen zweiten Drucker anlegt, sieht ihn hier sofort — ohne Neuladen.',
      'Name und Modell eines Druckers kommen jetzt vom Gerät und werden hier nur angezeigt. Ohne angelegtes Gerät bleiben beide Felder änderbar, damit sich die Anlage auch vorher einmessen lässt.',
      'Wird ein Gerät gelöscht, verschwindet sein Abschnitt — und Regale, die ihm zugeordnet waren, werden wieder frei statt auf einen Drucker zu zeigen, den es nicht mehr gibt.',
      'Die Farm startet nicht mehr, wenn für den gewählten Drucker noch keine Positionen eingemessen sind und sie App-G-code fahren soll — vorher hätte sie die Koordinaten des ersten Druckers benutzt, also gegen die falsche Maschine gegriffen.',
    ],
    en: [
      'THE SECTIONS NOW FOLLOW THE CONFIGURATION. How many printers there are lives in the device list (Configuration → Devices) — just as the rack count lives in the rack configuration. The printer tab shows one section per configured device and per rack.',
      'The "+ Add printer" button is therefore gone: it would have been a second place holding the same fact. Create a second printer and it shows up here immediately — no reload.',
      'A printer\'s name and model now come from the device and are only displayed here. Without a device both fields stay editable, so the setup can be taught in beforehand.',
      'Deleting a device removes its section — and racks that were assigned to it are freed instead of pointing at a printer that no longer exists.',
      'The farm refuses to start when the selected printer has no taught positions yet and app G-code is enabled — previously it would have used the first printer\'s coordinates, i.e. reached for the wrong machine.',
    ],
  },
  {
    version: '1.1.9',
    de: [
      'ZWEITER DRUCKER MÖGLICH — und der Drucker-Tab ist komplett neu aufgebaut. Er heißt jetzt „Drucker & Regale", ist einspaltig, und ganz oben steht die Schiene mit dem ganzen Aufbau. Ein Klick auf ein Modul springt zu seinem Abschnitt.',
      'Jeder Drucker hat einen eigenen ausklappbaren Abschnitt mit den fünf Positionen (Tür auf, Tür zu, Vor Drucker fahren, Auswerfen, Einlegen) — je Operation mit eigener Geschwindigkeit, eigenem G-code und eigener Farm-Freigabe.',
      'Jedes Regal hat ebenfalls einen eigenen Abschnitt: X-Position, Y-Engage, Höhe von Fachboden 1, Fach-Abstand — und zu welchem Drucker es gehört. Regale dürfen also unterschiedlich gebaut sein.',
      'Alle Positionen sind jetzt ABSOLUT (die Zahl, die der Arm anfährt). Vorher war die Drucker-X eine Basis, zu der beim Fahren ein Regal-Versatz addiert wurde — ein zusätzliches Regal verschob damit still den Drucker. Das passiert nicht mehr.',
      'Deine eingemessenen Werte bleiben auf den Millimeter gleich: Beim ersten Öffnen wird die alte Form einmalig in die neue umgerechnet. Ein Test vergleicht den G-code aller Operationen über alle Regale und Fächer vorher/nachher.',
      'Die Auswahlliste „Drucker-Modell" links ist weg. Das Modell steht jetzt am Drucker selbst; „⤓ Werte aus Modell-Vorlage" übernimmt Y/Z und die Tür-Form der Vorlage und lässt die eingemessene X in Ruhe.',
      'Die Prüfung schaut jetzt jeden Drucker einzeln an (vorher nur den ersten) und meldet zwei Module an derselben Stelle. Bei mehreren Druckern steht in der Meldung, welcher gemeint ist.',
      'Der Farm-Zyklus fährt die Positionen des Druckers, mit dem er gestartet wurde. Gleichzeitig laufen weiterhin nicht zwei Drucker — das ist der nächste Schritt.',
    ],
    en: [
      'A SECOND PRINTER IS NOW POSSIBLE — and the printer tab has been rebuilt from scratch. It is called "Printers & racks", uses a single column, and the rail showing the whole setup sits right at the top. Clicking a module jumps to its section.',
      'Every printer gets its own collapsible section with the five positions (open door, close door, move to printer, eject, place) — each with its own speed, its own G-code and its own farm release.',
      'Every rack gets its own section too: X position, Y engage, height of shelf 1, slot spacing — and which printer it belongs to. Racks may therefore be built differently.',
      'All positions are now ABSOLUTE (the number the arm drives to). Before, the printer X was a base value with a rack offset added while driving — so adding a rack silently moved the printer. That no longer happens.',
      'Your taught values stay identical to the millimetre: on first open the old form is converted once. A test compares the G-code of every operation across every rack and slot, before and after.',
      'The "printer model" list on the left is gone. The model now lives on the printer itself; "⤓ Values from model template" takes Y/Z and the door shape from the template and leaves the measured X alone.',
      'The check now inspects every printer individually (previously only the first) and reports two modules in the same place. With several printers the message says which one it means.',
      'The farm cycle drives the positions of the printer it was started with. Two printers still do not run at the same time — that is the next step.',
    ],
  },
  {
    version: '1.1.8',
    de: [
      'FARM-LAYOUT UND DRUCKER SIND JETZT EINS. Der eigene Tab „Farm-Layout" ist weg — die Schienen-Ansicht sitzt direkt im Drucker-Tab unter den X-Feldern, aus denen sie entsteht.',
      'Grund: Jede X-Position stand zweimal in der App — im Drucker-Tab (Start-X + Versatz + Δ je Regal) und noch einmal als eigene X-Referenz je Modul im Farm-Layout. Beide wurden getrennt gepflegt und liefen auseinander. Schlimmer: der Test-Knopf im Drucker-Tab fuhr nach der einen Quelle, die Farm nach der anderen — derselbe Knopf konnte also unterschiedliche Positionen anfahren, ohne dass man sah, welcher Wert gilt.',
      'Jetzt gibt es genau EINE Quelle: die Drucker-Geometrie. Das Layout (Übersicht, Job-Verteilung, Regal → Drucker) wird daraus abgeleitet und kann gar nicht mehr abweichen.',
      'Die Schiene zeichnet direkt die Werte aus den Feldern daneben — schon beim Tippen, ohne Speichern. Regale, die näher am Endschalter stehen als der Andruck-Weg, werden rot markiert: dort ist Greifen und Ablegen unmöglich.',
      'Deine eingemessenen Positionen bleiben unverändert: Es gelten die Werte aus dem Drucker-Tab, mit denen du auch bisher getestet hast. Ein evtl. abweichender Wert aus der alten Layout-Seite wird verworfen. Namen und die Zuordnung Regal → Drucker bleiben erhalten.',
      'Alte Lesezeichen auf „/layout" landen automatisch im Drucker-Tab.',
    ],
    en: [
      'FARM LAYOUT AND PRINTER ARE NOW ONE. The separate "Farm layout" tab is gone — the rail view sits in the printer tab, right below the X fields it is built from.',
      'Reason: every X position existed twice in the app — in the printer tab (start X + offset + Δ per rack) and again as its own per-module X reference in the farm layout. Both were maintained separately and drifted apart. Worse: the test button in the printer tab used one source while the farm used the other — the same button could drive to different positions, with no way to see which value applied.',
      'There is now exactly ONE source: the printer geometry. The layout (overview, job distribution, rack → printer) is derived from it and can no longer disagree.',
      'The rail draws the values from the fields next to it — live while typing, no save needed. Racks closer to the endstop than the push distance are marked red: grabbing and storing are impossible there.',
      'Your taught positions stay unchanged: the values from the printer tab apply — the same ones you have been testing with. A diverging value from the old layout page is discarded. Names and the rack → printer assignment are kept.',
      'Old bookmarks to "/layout" now land in the printer tab.',
    ],
  },
  {
    version: '1.1.7',
    de: [
      'Die Geometrie-Prüfung sagt jetzt, WARUM ein Regal nicht gegriffen werden kann: Steht ein Regal näher am Endschalter als der Andruck-Weg, ist der Griff unmöglich — der Arm müsste hinter X 0 fahren. Bisher stand da nur „fährt auf X −25 mm"; jetzt steht der Grund und der nötige Mindestabstand dabei.',
      'Das erklärt auch den verwirrenden Unterschied: „Anfahren" funktioniert bei so einem Regal, „Greifen"/„Ablegen"/„Aus Magazin holen" nicht — Anfahren macht die Andruck-Bewegung gar nicht.',
      'Dasselbe für die andere Seite: Steht der Drucker zu nah an der oberen Achsgrenze, wird das jetzt vor dem Auswerfen/Einlegen gemeldet statt erst beim Abbruch.',
    ],
    en: [
      'The geometry check now says WHY a rack cannot be grabbed: if a rack sits closer to the endstop than the push distance, the grab is impossible — the arm would have to travel past X 0. It used to say only "moves to X −25 mm"; now it gives the reason and the required clearance.',
      'That also explains the confusing difference: "Approach" works for such a rack while "Grab"/"Store"/"Grab from magazine" do not — approach never makes the push move.',
      'Same for the other end: if the printer sits too close to the upper axis limit, that is now reported before ejecting/placing instead of only on abort.',
    ],
  },
  {
    version: '1.1.6',
    de: [
      'Andruck-Weg 0 fällt nicht mehr still durch: Steht „Andruck-Weg (mm)" im Drucker-Tab auf 0, greift der Arm NICHT — er fährt vor das Fach, hebt an und kommt leer zurück, ohne Fehlermeldung. Grund: genau diese X-Bewegung ist der Griff; bei 0 zielt sie auf die Stelle, an der der Arm schon steht.',
      'Die Geometrie-Prüfung meldet das jetzt als Hinweis — und zwar nur dann, wenn die gebaute Bewegung überhaupt benutzt wird (mit eigenem G-code für Greifen/Ablegen/Auswerfen/Einlegen ist der Wert bedeutungslos).',
      'Der Hilfetext am Feld war irreführend („0 = Greifpunkt = Start-X" klang nach einer normalen Einstellung) und sagt jetzt klar, was 0 bedeutet.',
    ],
    en: [
      'A push distance of 0 no longer slips through silently: with "Push distance (mm)" set to 0 in the printer tab the arm does NOT grab — it moves in front of the slot, lifts and comes back empty, without any error. Reason: that very X move IS the grab; at 0 it targets the spot the arm is already at.',
      'The geometry check now reports this as a notice — and only when the built-in move is actually used (with your own G-code for grab/store/eject/place the value is irrelevant).',
      'The field\'s help text was misleading ("0 = grab point = start X" read like a normal option) and now says plainly what 0 means.',
    ],
  },
  {
    version: '1.1.5',
    de: [
      'SPRACHE: Die Oberfläche folgt jetzt durchgängig der eingestellten Sprache. Vorher blieben etliche Stellen fest deutsch (oder fest englisch), egal was eingestellt war — 144 Texte fehlten schlicht in der Übersetzungstabelle und fielen still auf Deutsch zurück.',
      'Behoben: Das Geräte-Formular unter „Konfiguration → Geräte" stand als einzige Stelle fest auf ENGLISCH („Device Name", „IP Address", „Access Code", „Use TLS", „No devices configured") — auch in der deutschen Oberfläche.',
      'Übersetzt sind jetzt auch: Sequenz-Schritte, Trockenlauf, Fehlerstrategie, Drucker-Einstellungen, Wiederherstellungs-Hinweis nach Neustart, Push-Fehlermeldungen, Farbschema-Namen, AMS-Trefferqualität, Web-Push-Hinweise für iOS und die Fehlerseite der App.',
      'Der Sequenz-Editor nutzt endlich die englischen Bezeichnungen, die das Backend zu jeder Operation schon immer mitgeliefert hat („Grab from magazine" statt „Aus Magazin holen").',
      'Prüf-Meldungen aus dem Backend (Geometrie, Farm-Layout, Trockenlauf) sind übersetzbar geworden: Der Server kennt die eingestellte Sprache nicht — die steht im Browser — und schickt deshalb jetzt die Textvorlage samt Werten mit, statt einen fertigen deutschen Satz.',
      'Datum und Uhrzeit folgen der Sprache (englisch = 07/24/2026), vorher stand an mehreren Stellen fest „de-DE".',
      'Aufgeräumt: 71 doppelte Einträge in der Übersetzungstabelle entfernt — bei doppeltem Schlüssel gewann still der letzte. Ein Fall war widersprüchlich: „Übernehmen" heißt in der englischen Oberfläche jetzt überall „Apply" (vorher beim Geräte-Fund „Use").',
      'Neuer Test wacht darüber: Er sammelt alle übersetzbaren Texte aus Frontend UND Backend und schlägt fehl, sobald einer ohne englische Fassung dazukommt.',
    ],
    en: [
      'LANGUAGE: the interface now follows the selected language throughout. Before, plenty of places stayed German (or stayed English) no matter what was set — 144 strings were simply missing from the translation table and silently fell back to German.',
      'Fixed: the device form under "Configuration → Devices" was the one place hard-wired to ENGLISH ("Device Name", "IP Address", "Access Code", "Use TLS", "No devices configured") — even in the German interface.',
      'Now translated as well: sequence steps, dry run, error strategy, printer settings, the recovery notice after a restart, push error messages, colour-scheme names, AMS match quality, the iOS web-push hints and the app\'s error page.',
      'The sequence editor finally uses the English labels the backend has always shipped for every operation ("Grab from magazine" instead of "Aus Magazin holen").',
      'Check messages from the backend (geometry, farm layout, dry run) became translatable: the server does not know the selected language — that lives in the browser — so it now sends the text template plus its values instead of a finished German sentence.',
      'Date and time follow the language (English = 07/24/2026); several places were hard-wired to "de-DE".',
      'Cleanup: removed 71 duplicate entries from the translation table — with a duplicate key the last one silently won. One was contradictory: "Übernehmen" is now "Apply" everywhere in the English interface (it was "Use" on the device-discovery button).',
      'A new test guards this: it collects every translatable string from the frontend AND the backend and fails as soon as one arrives without an English version.',
    ],
  },
  {
    version: '1.1.4',
    de: [
      'Farm-Layout: Die Schiene wird jetzt so gezeichnet, wie das Gerät steht — X 0 (Home/Endschalter) RECHTS, wachsende X-Werte nach links. Vorher lief die Darstellung andersherum als die Maschine, man musste beim Einmessen im Kopf spiegeln.',
      'Die Modul-Liste steht in derselben Reihenfolge wie die Schiene (links = größtes X = Drucker, rechts = Home). Neu angelegte Module rutschen sofort an ihre Stelle, statt erst nach dem Speichern.',
    ],
    en: [
      'Farm layout: the rail is now drawn the way the machine actually stands — X 0 (home/endstop) on the RIGHT, growing X values towards the left. Before, the drawing ran opposite to the machine, so you had to mirror it in your head while teaching positions.',
      'The module list is in the same order as the rail (left = largest X = printer, right = home). Newly added modules jump to their place immediately instead of only after saving.',
    ],
  },
  {
    version: '1.1.3',
    de: [
      'ROADMAP-PHASE 4 „Mehrere Drucker & unterschiedliche Regale" — Printloom ist nicht mehr auf einen Drucker und gleichmäßige Regal-Abstände festgelegt.',
      'NEU Farm-Layout (eigener Tab): Drucker, Regale und der Home-Anker stehen als Module auf der X-Schiene, jedes mit seiner EIGENEN absoluten X-Position in mm. Bisher kam die Regal-Position aus einer Formel (gleicher Abstand für alle Regale) — damit war weder ein zweiter Drucker noch ein anders gebautes Regal möglich.',
      'Migration ohne Positionsänderung: Ein Klick erzeugt das Layout aus der bisherigen Konfiguration und übernimmt EXAKT die Werte, die die Formel liefert — inklusive der Δ-Korrekturen je Regal. Es verschiebt sich keine einzige Position, niemand muss neu einmessen. Wer nichts umstellt, für den bleibt alles wie es war.',
      'NEU Sperre: Das Layout ist standardmäßig gesperrt und lässt sich bei laufender Farm gar nicht erst entsperren — falsche X-Werte fahren den Arm gegen die Mechanik. Entsperren ist eine bewusste Handlung mit Rückfrage.',
      'Das Layout wird wie die Geometrie geprüft: Position unter 0 mm, über der Achsgrenze, zwei Module zu dicht beieinander, Regal ohne Drucker, zwei Module auf demselben Gerät.',
      'NEU Der OTTOeject ist als geteilte Ressource abgesichert: Jede Bewegung läuft durch eine Sperre, sodass zwei Drucker den Arm nicht gleichzeitig losschicken können. Wer wartet, steht in der Übersicht. Bei einem Drucker ändert sich dadurch nichts.',
      'NEU Job-Verteilung: Die Warteschlange lässt sich auf die Drucker verteilen — erst als Vorschau, dann übernehmen. Eine feste Zuweisung wird nie stillschweigend umgangen: passt der zugewiesene Drucker gerade nicht, wartet der Job, statt woanders zu landen. Verteilt wird nach frei/beschäftigt und Länge der Warteschlange, mit Begründung je Drucker.',
      'NEU Drucker-Übersicht in der Farm-Ansicht: Status je Drucker nebeneinander, freie Fächer, Warteschlange und wer gerade den Arm hat. Erscheint nur mit eingerichtetem Layout.',
    ],
    en: [
      'ROADMAP PHASE 4 "Multiple printers & different racks" — Printloom is no longer tied to one printer and evenly spaced racks.',
      'NEW Farm layout (own tab): printers, racks and the home anchor are modules on the X rail, each with its OWN absolute X position in mm. Rack positions used to come from a formula (same spacing for every rack), which allowed neither a second printer nor a differently built rack.',
      'Migration without moving anything: one click creates the layout from the existing configuration and adopts EXACTLY the values the formula produces — including the per-rack Δ corrections. Not a single position shifts, nobody has to re-teach. If you change nothing, everything stays as it was.',
      'NEW Lock: the layout is locked by default and cannot even be unlocked while the farm is running — wrong X values drive the arm into the mechanics. Unlocking is a deliberate action with a confirmation.',
      'The layout is checked like the geometry: position below 0 mm, above the axis limit, two modules too close together, a rack without a printer, two modules on the same device.',
      'NEW The OTTOeject is protected as a shared resource: every move goes through a lock, so two printers cannot send the arm off at the same time. Whoever is waiting is shown in the overview. With a single printer nothing changes.',
      'NEW Job distribution: the queue can be spread across the printers — preview first, then apply. A fixed assignment is never silently bypassed: if the assigned printer does not fit right now, the job waits instead of landing elsewhere. Distribution goes by free/busy and queue length, with a reason per printer.',
      'NEW Printer overview in the farm view: status per printer side by side, free slots, queue and who currently has the arm. Only appears once a layout is set up.',
    ],
  },
  {
    version: '1.1.2',
    de: [
      'ROADMAP-PHASE 3 „Dauerbetrieb, dem man wegläuft" — die Farm übersteht jetzt, was in echt passiert: Neustart, Update, Notaus, hängende Bewegung.',
      'WICHTIG Der Farm-Zustand überlebt einen Neustart. Bisher lag er nur im Speicher: Nach einem Container-Neustart — auch dem durch das EIGENE In-App-Update — druckte der Drucker weiter, während die Farm einfach weg war. Niemand wusste, ob eine Platte im Greifer hängt. Jetzt wird bei jedem Schritt mitgeschrieben, und beim nächsten Start meldet Printloom, welcher Job bei welchem Schritt unterbrochen wurde.',
      'Fortgesetzt wird bewusst NICHTS von allein: der Arm steht an unbekannter Stelle. Es kommt eine Meldung mit „was ist zu tun", die man quittiert — danach referenziert die nächste Bewegung automatisch zuerst.',
      'NEU Der Greifer-Zustand wird mitgeführt: leer / leere Platte / fertiger Druck, samt Herkunftsfach. Nach einem Abbruch ist das die einzige Information darüber, ob noch etwas am Arm hängt — sie steht jetzt in der Meldung.',
      'NEU Hängende Bewegungen werden erkannt: Meldet der OTTOeject eine Bewegung nicht innerhalb des Zeitlimits als beendet (einstellbar, Standard 180 s), gilt sie als hängend. Vorher lief das in einen nackten „Network Error", ohne dass jemand merkte, dass der Arm steht. Neue Fehlerstrategie „Bewegung hängt" (Standard: pausieren, danach denselben Job erneut versuchen).',
      'NEU Nach Notaus, Force-Reset oder hängender Bewegung gilt die Position des Arms als unbekannt — die nächste Bewegung fährt automatisch erst eine Referenzfahrt, statt von einer falschen Annahme loszufahren.',
      'NEU Drucker-Fehler-Historie (Historie-Tab): jeder HMS-Code mit Zeitstempel, Schweregrad, Klartext, ausgeführter Strategie und betroffenem Job — auch die ignorierten. Bisher standen sie nur im Live-Log und waren nach einem Neustart weg, also genau dann, wenn man nachschlagen will, ob ein Fehler schon einmal auftrat.',
    ],
    en: [
      'ROADMAP PHASE 3 "Unattended operation you can walk away from" — the farm now survives what actually happens: restart, update, emergency stop, stuck move.',
      'IMPORTANT The farm state survives a restart. It used to live only in memory: after a container restart — including the one triggered by Printloom’s OWN in-app update — the printer kept printing while the farm was simply gone. Nobody knew whether a plate was still in the gripper. Now the state is written on every step, and on the next start Printloom reports which job was interrupted at which step.',
      'Nothing resumes on its own, deliberately: the arm is at an unknown position. You get a message with what to check, acknowledge it — and the next move homes first automatically.',
      'NEW The gripper state is tracked: empty / empty plate / finished print, including the source slot. After an abort that is the only information about whether something is still attached to the arm — and it is now in the message.',
      'NEW Stuck moves are detected: if the OTTOeject does not report a move as finished within the time limit (configurable, default 180 s), it counts as stuck. Previously this ran into a bare "network error" without anyone noticing that the arm had stopped. New error strategy "move is stuck" (default: pause, then retry the same job).',
      'NEW After an emergency stop, force reset or stuck move the arm position counts as unknown — the next move homes first instead of starting from a wrong assumption.',
      'NEW Printer error history (History tab): every HMS code with timestamp, severity, plain text, the strategy applied and the affected job — including the ignored ones. Previously they only appeared in the live log and were gone after a restart, exactly when you want to look up whether an error occurred before.',
    ],
  },
  {
    version: '1.1.1',
    de: [
      'ROADMAP-PHASE 2 „Einrichten ohne Rätselraten" — die Erstinbetriebnahme kommt jetzt ohne Zahlenraten aus.',
      'NEU Einmess-Assistent (📐 an jeder Positions-Karte im Drucker-Tab): Position anfahren, mit Pfeilen in 0,1–10-mm-Schritten justieren, „Hierher übernehmen" — Printloom rechnet den Wert aus der echten Ist-Position. Jeder Schritt wird vorher gegen die Achsgrenzen geprüft und gar nicht erst gesendet, wenn er aus der Achse führt.',
      'Beim Regal misst man nur Fach 1 in Regal 1 ein — Start-X, Y-Engage und Fachhöhe folgen daraus, die übrigen Fächer und Regale rechnet Printloom.',
      'NEU Trockenlauf (Setup-Assistent, letzter Schritt): spielt die ganze Sequenz durch, OHNE etwas an Drucker oder OTTOeject zu senden. Zeigt je Schritt das Ziel-Fach, woher die leere Platte käme und ob eine Bewegung aus der Achse fahren würde.',
      'Das Drucker-Modell wird jetzt wirklich genutzt: passt die gewählte Geometrie-Vorlage nicht zum angelegten Drucker, kommt eine Warnung mit Ein-Klick-Korrektur. Die Kalibrierung wird nur noch bei Modellen angeboten, die sie annehmen (X1-Serie) — beim P1S/A1 stand der Knopf da und tat nichts. Für Modelle ohne Vorlage (A1 mini, H2D) steht dort der Hinweis, die Positionen einzumessen, statt geratener Werte.',
      'NEU Bauart-Paket: Wer im Setup sein Modell wählt, bekommt die passende Geometrie-Vorlage automatisch — und bei einem offenen Drucker (P1P/A1) fallen die Tür-Schritte aus der Sequenz, statt ins Leere zu laufen.',
      'Achsgrenzen lassen sich jetzt direkt im Setup-Assistenten vom Gerät holen (bisher nur im Drucker-Tab).',
      'Der Einrichtungs-Status prüft vier Punkte mehr: Geometrie plausibel, Achsgrenzen bekannt, Sequenz vorhanden, leere Platten bereit.',
      'Sprachwahl ist der erste Schritt im Assistenten — alles Weitere steht dann schon in der eigenen Sprache.',
      'NEU „Was ist neu": nach einem Update kommt die Änderungsliste einmal von selbst. Bei einer Neuinstallation bewusst nicht.',
      'FEHLER BEHOBEN: Der letzte Schritt des Setup-Assistenten war leer — Homing, Status und Abschluss hingen fälschlich am Regal-Schritt (seit dem Komponenten-Schritt in v1.0.158).',
    ],
    en: [
      'ROADMAP PHASE 2 "Setup without guesswork" — first-time setup no longer requires guessing numbers.',
      'NEW teach-in assistant (📐 on every position card in the Printer tab): move to the position, adjust with arrows in 0.1–10 mm steps, "use this position" — Printloom derives the value from the real current position. Every step is checked against the axis limits up front and is not sent at all if it would leave the axis.',
      'For the rack you only teach in slot 1 of rack 1 — start X, Y engage and slot height follow from it, Printloom computes the other slots and racks.',
      'NEW dry run (setup wizard, last step): walks the whole sequence WITHOUT sending anything to the printer or OTTOeject. Shows the target slot per step, where the empty plate would come from and whether a move would leave the axis.',
      'The printer model is now actually used: if the selected geometry template does not match the configured printer, you get a warning with a one-click fix. Calibration is only offered for models that accept it (X1 series) — on the P1S/A1 the button was there and did nothing. Models without a template (A1 mini, H2D) now say "teach in the positions" instead of showing guessed values.',
      'NEW build package: choosing your model in the setup wizard applies the matching geometry template automatically — and on an open printer (P1P/A1) the door steps drop out of the sequence instead of running into nothing.',
      'Axis limits can now be read from the device right in the setup wizard (previously only in the Printer tab).',
      'The setup status checks four more points: geometry plausible, axis limits known, sequence present, empty plates ready.',
      'Language is the first step in the wizard — everything after it is already in your language.',
      'NEW "What’s new": after an update the change list appears once by itself. Deliberately not on a fresh install.',
      'BUG FIX: the last step of the setup wizard was empty — homing, status and finish were wrongly attached to the rack step (since the components step in v1.0.158).',
    ],
  },
  {
    version: '1.0.163',
    de: [
      'NEU im Aufbau OHNE Magazin („alle Fächer = Lagerfächer"): In der Farm-Ansicht markierst du jetzt je Fach mit ▭, ob dort eine leere Platte liegt. Der Knopf erscheint NUR in dieser Bauart — mit Magazin bleibt es beim Magazin-Zähler.',
      '„Platte holen" nimmt die Platte aus einem markierten Fach, immer das oberste zuerst — so muss der Arm nie über eine noch liegende Platte hinweg. Nach dem Griff verschwindet die Markierung automatisch.',
      'Der fertige Druck wird immer in ein Fach OHNE Platte gelegt. Markierte Fächer sind als Ablageziel gesperrt, sonst käme der Druck auf eine liegende Platte.',
      'Nimmst du einen fertigen Druck aus dem Regal, gilt das Fach wieder als „Leerplatte liegt drin" — du legst die abgeräumte Platte ja zurück. Nimmst du sie mit, klickst du die Markierung weg.',
      'Vorher war nur eine ANZAHL je Regal bekannt und Printloom nahm an, die Platten lägen lückenlos in den untersten Fächern. Lücken oder ein Nachlegen in der Mitte führten dadurch zum Griff ins falsche Fach. Bestehende Aufbauten übernehmen die alte Annahme einmalig, danach zählt deine Markierung.',
      'Warnung, wenn in jedem freien Fach eine leere Platte liegt — dann bleibt kein Ziel für den fertigen Druck übrig.',
      'Die Beschreibungen der beiden Bauarten im Setup-Assistenten gab es nur auf Deutsch; sie sind jetzt auch auf Englisch da.',
    ],
    en: [
      'NEW for the setup WITHOUT a magazine ("all slots = storage"): in the farm view you now mark per slot with ▭ whether an empty plate is in it. The button appears ONLY in this build — with a magazine the magazine counter stays.',
      '"Grab plate" takes the plate from a marked slot, always the topmost one first — so the arm never has to travel over a plate that is still lying there. After the grab the marker clears itself.',
      'The finished print always goes into a slot WITHOUT a plate. Marked slots are blocked as a target, otherwise the print would land on a lying plate.',
      'Taking a finished print out of the rack marks that slot as holding an empty plate again — you do put the cleared plate back. If you take it with you, just unmark it.',
      'Previously only a COUNT per rack was known and Printloom assumed the plates sat gap-free in the lowest slots. Gaps, or refilling in the middle, made it grab the wrong slot. Existing setups adopt the old assumption once; after that your marking counts.',
      'Warning when every free slot holds an empty plate — no target would be left for the finished print.',
      'The descriptions of the two builds in the setup wizard existed only in German; they are now available in English too.',
    ],
  },
  {
    version: '1.0.162',
    de: [
      'NEU Plausibilitätsprüfung der Geometrie (Drucker-Tab → „🛡 Plausibilität & Achsgrenzen"): Printloom rechnet jede Bewegung vorab durch und meldet, wenn eine Position aus der Achse fährt — mit Achse, Wert und Grenze. Vorher nahm die Geometrie jede Zahl an, und ein Tippfehler (X 4250 statt 425) fiel erst auf, wenn der Arm schon fuhr.',
      'Neu „⤓ Grenzen vom Gerät holen": liest die echten Achsgrenzen aus Klipper. Sind sie bekannt, wird eine Bewegung außerhalb der Achse GAR NICHT gesendet — vorher brach Klipper sie mitten im Ablauf ab, womöglich mit Platte im Greifer. Solange die Grenzen fehlen, wird nur „unter 0 mm" geprüft (Endschalter) — wer seine X-Schiene verlängert hat, wird also nicht ausgebremst.',
      'Geprüft werden außerdem unmögliche Werte: kein Höhenschritt zwischen den Fächern, mehrere Regale ohne Abstand, Greif-Y hinter der Rückzugsposition.',
      'NEU Drucker-Modell am Gerät (Konfiguration → Geräte und im Setup-Assistenten): X1/X1C/X1E, P1P/P1S, A1/A1 mini, H2D. Damit ist das Kamera-Protokoll eindeutig, statt es über einen Netzwerk-Test zu erraten. Bestehende Geräte werden beim Update automatisch aus der Seriennummer vorbelegt; ohne Angabe erkennt Printloom die Kamera weiter selbst.',
      'Die Netzwerk-Suche schlägt das Modell jetzt gleich mit vor.',
      'Für Entwickler: die automatischen Tests im Repo sind von 46 auf 174 gewachsen (Achsprüfung, Platten-Quelle mit/ohne Magazin, Kamera-Protokolle, Kamera-Hub, Online-Opt-in, Diagnose-Redaction, Modell-Erkennung, DB-Migration). Sie laufen bei jedem Push — vorher war ein Teil davon nur einmalig von Hand geprüft.',
    ],
    en: [
      'NEW geometry plausibility check (Printer tab → "🛡 Plausibility & axis limits"): Printloom now computes every move up front and reports positions that leave the axis — naming axis, value and limit. Previously the geometry accepted any number, and a typo (X 4250 instead of 425) only surfaced once the arm was already moving.',
      'New "⤓ Read limits from device": fetches the real axis limits from Klipper. Once known, a move outside the axis is NOT sent at all — previously Klipper aborted it mid-sequence, possibly with a plate in the gripper. While the limits are unknown, only "below 0 mm" is rejected (endstop), so anyone who extended their X rail is not held back.',
      'Impossible values are flagged too: no height step between slots, several racks without spacing, grab Y behind the retract position.',
      'NEW printer model on the device (Configuration → Devices and in the setup wizard): X1/X1C/X1E, P1P/P1S, A1/A1 mini, H2D. This makes the camera protocol unambiguous instead of guessing it via a network probe. Existing devices are pre-filled from their serial number on update; without a model, Printloom keeps detecting the camera itself.',
      'Network discovery now suggests the model as well.',
      'For developers: the automated tests in the repo grew from 46 to 174 (axis check, plate source with/without magazine, camera protocols, camera hub, online opt-in, diagnostics redaction, model detection, DB migration). They run on every push — before, part of this was only verified once by hand.',
    ],
  },
  {
    version: '1.0.161',
    de: [
      'Entfernt: Die Einstellung „Abgelöste Teile überspringen" ist wieder raus. Das Feld steckt zwar im Datenstrom des Druckers, ist aber KEINE Einstellung, die man am Bambu-Display umschaltet — die Beschreibung in Printloom war irreführend.',
      'Aufgeräumt: die relative Zeitangabe („vor 5 Min.") lag doppelt im Code und sitzt jetzt an einer Stelle.',
    ],
    en: [
      'Removed: the "skip detached objects" setting is gone again. The field does appear in the printer’s data stream, but it is NOT a setting you toggle on the Bambu display — the description in Printloom was misleading.',
      'Cleanup: the relative time label ("5 min ago") existed twice in the code and now lives in one place.',
    ],
  },
  {
    version: '1.0.160',
    de: [
      'Die Bibliothek ist jetzt ein eigener Tab in der Seitenleiste (statt eines kleinen Blocks in System) und zeigt zu jedem Eintrag alle Daten: Autor, Version, Beschreibung, Art (Sprachpaket/Profil/Sequenz), Kennung und Quelle.',
      'Filter je Art mit Anzahl (Alle / Sprachen / Profile / Sequenzen) und Suche über Name, Autor und Beschreibung.',
      'Vorschau zeigt vorab eine Kurz-Statistik des Inhalts — z. B. „Sprachcode fr · 42 Übersetzungen" oder „7 Schritte" — und bei Sprachpaketen, unter welchem Sprachcode wirklich installiert wird (der kann vom Katalog-Namen abweichen). Übernommen wird weiterhin nur nach Bestätigung; Sequenzen behalten ihren Warnhinweis.',
      'Ist die Bibliothek nicht freigeschaltet, zeigt der Tab nur einen Hinweis und ruft NICHTS ab — mit direktem Weg zu den Online-Diensten.',
      'Aufgeräumt: In System steht jetzt nur noch der Verweis auf den Tab, damit es nicht zwei Ansichten für dasselbe gibt.',
    ],
    en: [
      'The library is now its own tab in the sidebar (instead of a small block in System) and shows all data per entry: author, version, description, kind (language pack/profile/sequence), ID and source.',
      'Per-kind filter with counts (All / Languages / Profiles / Sequences) plus search across name, author and description.',
      'The preview now shows a short content summary up front — e.g. "language code fr · 42 translations" or "7 steps" — and for language packs which language code will actually be installed (it can differ from the catalogue name). Applying still requires confirmation; sequences keep their warning.',
      'If the library is not enabled, the tab only shows a notice and fetches NOTHING — with a direct link to the online services.',
      'Cleanup: System now only links to the tab, so there are no longer two views for the same thing.',
    ],
  },
  {
    version: '1.0.159',
    de: [
      'NEU „Online-Dienste" (System): Printloom verbindet sich jetzt NUR noch nach ausdrücklicher Freigabe nach außen. Standardmäßig ist alles AUS — dann geht kein einziger Request an einen Server außerhalb deines Netzwerks, und die App funktioniert vollständig offline.',
      'WICHTIG: Die Update-Prüfung lief bisher ungefragt automatisch (beim Start und alle 10 Minuten an GitHub/ghcr). Sie heißt jetzt „Update-Prüfung im Internet", ist standardmäßig AUS und läuft nur, wenn du sie einschaltest. Von Hand prüfen kannst du jederzeit mit „Jetzt prüfen (einmalig)".',
      'Vor der ersten Aktivierung kommt ein Hinweis, der genau benennt, mit welchem Server verbunden wird, dass nur gelesen wird und dass keine Drucker-Daten, Dateinamen, Zugangsdaten oder Nutzungsstatistiken gesendet werden. Widerrufen (inkl. Löschen des Zwischenspeichers) geht jederzeit mit einem Klick.',
      'NEU „Bekannte Probleme & Hinweise": zeigt Warnungen zur laufenden Version — so erfährst du von einem Fehler, ohne auf ein Update zu warten. Wird lokal zwischengespeichert (6 h) und ist ohne Netz nie eine Fehlerwand.',
      'NEU „Sprachpakete & Bibliothek": Katalog mit Sprachpaketen, Drucker-Profilen und Sequenzen. Inhalte werden IMMER erst als Vorschau gezeigt und nur nach deiner Bestätigung übernommen — bei Sequenzen zusätzlich mit Warnhinweis, weil sie echte Mechanik bewegen.',
      'NEU „Diagnose-Paket" (System): erzeugt eine ZIP mit Konfiguration, Geometrie, Sequenzen, Versions-Infos und den letzten Log-Zeilen zum Verschicken an den Support. Access-Codes, Tokens und Passwörter werden dabei automatisch entfernt (rekursiv anhand der Feldnamen) — Druckdateien und Kamerabilder sind nicht enthalten. Es wird nichts automatisch hochgeladen.',
    ],
    en: [
      'NEW "Online services" (System): Printloom now only connects to the outside after explicit consent. Everything is OFF by default — then not a single request goes to any server outside your network, and the app works fully offline.',
      'IMPORTANT: the update check previously ran automatically without asking (at startup and every 10 minutes, to GitHub/ghcr). It is now called "Check for updates online", is OFF by default and only runs if you enable it. You can always check manually via "Check now (one-off)".',
      'Before the first activation a notice states exactly which server is contacted, that data is only read, and that no printer data, file names, credentials or usage statistics are sent. Revoking (including clearing the cache) is one click away at any time.',
      'NEW "Known issues & notices": shows warnings about your running version — so you hear about a bug without waiting for an update. Cached locally (6 h) and never an error wall when offline.',
      'NEW "Language packs & library": a catalogue of language packs, printer profiles and sequences. Content is ALWAYS shown as a preview first and only applied after you confirm — sequences additionally carry a warning, because they drive real mechanics.',
      'NEW "Diagnostics package" (System): creates a ZIP with configuration, geometry, sequences, version info and the last log lines to send to support. Access codes, tokens and passwords are stripped automatically (recursively, by field name) — print files and camera images are not included. Nothing is uploaded automatically.',
    ],
  },
  {
    version: '1.0.158',
    de: [
      'Setup-Assistent: neuer erster Schritt „Komponenten" — du wählst mit Beschreibung aus, WAS du gebaut hast (Regal-Halterung Standard/Kompakt, oberstes Fach als Magazin oder Lagerfach). Daraus setzt Printloom die Grundkonfiguration: Fächer je Regal, Magazin-Fach, Z-Schritt und Fachhöhe. Standard-Halterung = 7 Positionen mit 55 mm Abstand, Kompakt = 10 Positionen mit 25 mm.',
      'Ablauf passt sich dem Aufbau an: MIT Magazin holt die Farm den Nachschub wie bisher aus dem Magazin-Fach. OHNE Magazin (alle Fächer = Lagerfächer) liegen die leeren Platten schon in den Fächern — die Farm greift sich eine von OBEN nach unten heraus (normaler Fach-Griff statt Magazin-Griff) und legt den fertigen Druck dort wieder ab. Fächer, in denen noch eine leere Platte liegt, werden nie als Ablageziel vergeben (Kollisionsschutz).',
      'Der Z-Schritt wird jetzt als gemessener Abstand von Fach zu Fach eingegeben (Standard 55 mm, Kompakt 25 mm) statt als interner slot_gap — die Umrechnung macht Printloom.',
      'Setup-Assistent ist aus der Seitenleiste in „System → Einrichtung" gewandert (einmalige Einrichtung, kein Alltags-Tab). Am Ende führt er direkt auf die Drucker-Seite („Drucker einrichten") statt nur „Fertig" zu sagen.',
      'Drucker-Seite: neuer Knopf „⌂ Bett homen" neben dem Bett-Z-Feld (G28) — referenziert die Achsen neu, wenn die Z-Höhe nicht mehr stimmt.',
      'Drucker-Steuerung richtet sich nach dem gewählten Modell: Bett-Fahrt/Homing und Einstellungen erscheinen nur bei Bambu-Lab-Modellen (nur die kann Printloom per MQTT erreichen); bei Fremdmodellen steht dort ein klarer Hinweis statt toter Knöpfe.',
      'NEU für Bambu Lab: Panel „Drucker-Einstellungen" direkt unter den Controls — Erste-Schicht-Prüfung, Spaghetti-Erkennung, Bauplatten-Erkennung, KI-Überwachung, abgelöste Teile überspringen, Druckgeschwindigkeit (Leise/Standard/Sport/Ludicrous), Auto-Recovery, Kammerlicht und die große Kalibrierung (~16 Min, einzeln wählbar). Damit muss man für diese Einstellungen nicht mehr an den Drucker.',
    ],
    en: [
      'Setup wizard: new first step "Components" — you pick, with descriptions, WHAT you built (rack holder standard/compact, top slot as magazine or storage). Printloom derives the base configuration from it: slots per rack, magazine slot, Z pitch and slot height. Standard holder = 7 positions at 55 mm spacing, compact = 10 positions at 25 mm.',
      'The workflow adapts to your build: WITH a magazine the farm takes fresh plates from the magazine slot as before. WITHOUT a magazine (all slots = storage) the empty plates already sit in the slots — the farm grabs one from the TOP downwards (normal slot grab instead of magazine grab) and puts the finished print back there. Slots that still hold an empty plate are never assigned as a drop target (collision safety).',
      'The Z pitch is now entered as the measured slot-to-slot distance (standard 55 mm, compact 25 mm) instead of the internal slot_gap — Printloom does the conversion.',
      'The setup wizard moved from the sidebar into "System → Setup" (one-time setup, not an everyday tab). At the end it now leads straight to the printer page ("Set up printer") instead of just saying "Done".',
      'Printer page: new "⌂ Home bed" button next to the bed-Z field (G28) — re-references the axes when the Z height is off.',
      'Printer controls now follow the selected model: bed move/homing and settings only appear for Bambu Lab models (the only ones Printloom can reach via MQTT); other models show a clear note instead of dead buttons.',
      'NEW for Bambu Lab: a "Printer settings" panel right below the controls — first-layer inspection, spaghetti detection, build plate detection, AI monitoring, skip detached objects, print speed (silent/standard/sport/ludicrous), auto-recovery, chamber light and the full calibration (~16 min, individually selectable). No more walking to the printer for these.',
    ],
  },
  {
    version: '1.0.157',
    de: [
      'Drucker-Kamera funktioniert jetzt auch für P1P/P1S und A1/A1 mini. Diese Modelle haben (anders als der X1C) keinen RTSP-Stream — Printloom spricht jetzt ihr Port-6000-Kameraprotokoll. Hinweis: Der P1S/A1 liefert nur langsame Standbilder (~1–wenige Bilder/s, Hardware-Limit), kein flüssiges Video wie beim X1C.',
      'Das Kamera-Backend wird pro Drucker automatisch erkannt (X1-Serie → RTSPS, P1/A1 → Port 6000). In „Konfiguration & Kameras" lässt sich der Kamera-Typ pro Drucker auch manuell festlegen (Automatisch / X1 / P1·A1 / Aus), falls die Erkennung mal danebenliegt.',
      'Aufräumen unter der Haube: Die geteilte Kamera-Hub-Logik (ein Stream pro Drucker, Verteilung an alle Zuschauer, Leerlauf-Stopp) ist jetzt protokoll-unabhängig und wird von beiden Kamera-Wegen genutzt.',
    ],
    en: [
      'The printer camera now works for P1P/P1S and A1/A1 mini too. Unlike the X1C these models have no RTSP stream — Printloom now speaks their port-6000 camera protocol. Note: the P1S/A1 only delivers slow stills (~1–a few frames/s, a hardware limit), not smooth video like the X1C.',
      'The camera backend is auto-detected per printer (X1 series → RTSPS, P1/A1 → port 6000). In "Configuration & cameras" you can also set the camera type per printer manually (Auto / X1 / P1·A1 / Off) in case detection gets it wrong.',
      'Under-the-hood cleanup: the shared camera-hub logic (one stream per printer, fanned out to all viewers, idle stop) is now protocol-agnostic and used by both camera paths.',
    ],
  },
  {
    version: '1.0.156',
    de: [
      'Release-Kanal ist jetzt ein kompakter Umschalter (Latest ↔ Beta). Auf Beta erscheint eine deutliche Warnung: Beta ist NICHT stabil, Nutzung auf eigene Gefahr, vorher Backup machen.',
      'Backup & Restore sichert jetzt WIRKLICH alles — zusätzlich: Drucker-Geometrie (X-Positionen je Regal/Drucker & G-code-Overrides), Profile und den globalen Kamera-Schalter. Bestehende Sicherungen bleiben kompatibel.',
      'Auto Farm: Ist die letzte Platte gedruckt und die Warteschlange leer, PARKT der OTTOeject jetzt (statt vor dem Regal stehen zu bleiben). Kommt später ein neuer Job dazu, wird zuerst neu gehomt (Klipper kann in der Wartezeit die Motoren abschalten) und dann weitergemacht.',
      'Historie: Neuer Knopf „+ Warteschlange" — legt das gedruckte Modell direkt wieder in die Auto-Farm-Queue.',
      'Behoben: Nach einem Seitenwechsel/Tab-Wechsel wurde der Drucker-Status im Header manchmal nicht angezeigt (bis zum Reload) — er wird jetzt bei Navigation und beim Zurückkehren zum Tab sofort aufgefrischt.',
      'Dashboard-Layout: Panels füllen ihre Rasterzelle jetzt vollständig aus — nebeneinander liegende Panels sind dadurch gleich hoch.',
    ],
    en: [
      'The release channel is now a compact toggle (Latest ↔ Beta). On Beta a clear warning appears: Beta is NOT stable, use at your own risk, back up first.',
      'Backup & Restore now really saves everything — additionally: printer geometry (per-rack/printer X positions & G-code overrides), profiles and the global camera switch. Existing backups stay compatible.',
      'Auto Farm: once the last plate is printed and the queue is empty, the OTTOeject now PARKS (instead of staying in front of the rack). When a new job is added later, it re-homes first (Klipper may power the motors down while idle) and then continues.',
      'History: new "+ Queue" button — puts the printed model straight back into the Auto Farm queue.',
      'Fixed: after switching page/tab the printer status in the header sometimes did not show (until reload) — it now refreshes immediately on navigation and when returning to the tab.',
      'Dashboard layout: panels now fill their grid cell completely — side-by-side panels are therefore equal height.',
    ],
  },
  {
    version: '1.0.155',
    de: [
      'Crash-Warnung in der Datei-Bibliothek: Ein rotes „!" erscheint an Modellen, deren G-code den OTTOeject-Arm rammen würde — geprüft wird der GESAMTE G-code (inkl. Verfahrwege): ragt oberhalb von 30 mm Höhe ein X-Wert in den seitlichen 10-mm-Randstreifen (links 0–10 mm oder rechts X_max−10 mm), gilt der Druck als riskant. Klick auf das „!" zeigt den konkreten Trefferpunkt (Z/X) und was zu tun ist. Bei Multi-Plate-Dateien werden alle Platten geprüft.',
      'Warteschlange: Fertige Jobs werden jetzt wirklich ausgeblendet (mit Zähler „N fertig — ausgeblendet" und Umschalter zum Einblenden).',
      'Neuer Tab „Historie": alle abgeschlossenen Druck-Jobs mit Datum, Anfangs- und End-Uhrzeit, Dauer, Modell (inkl. Platte), Fach und Status (Fertig/Fehler/Geborgen).',
    ],
    en: [
      'Crash warning in the file library: a red "!" appears on models whose G-code would hit the OTTOeject arm — the ENTIRE G-code is checked (incl. travel moves): if above 30 mm height any X value reaches into the 10 mm side margin (left 0–10 mm or right X_max−10 mm), the print is flagged risky. Clicking the "!" shows the exact hit point (Z/X) and what to do. Multi-plate files check every plate.',
      'Queue: finished jobs are now actually hidden (with a "N done — hidden" counter and a toggle to show them).',
      'New "History" tab: all completed print jobs with date, start and end time, duration, model (incl. plate), slot and status (Done/Error/Recovered).',
    ],
  },
  {
    version: '1.0.154',
    de: [
      'Netzwerk-Suche: Fehler „_.trim is not a function" beim Start der Suche behoben (der Klick übergab versehentlich das Event statt des Subnetzes).',
      'Netzwerk-Suche: Bereits angelegte Geräte werden nicht mehr als Fund angeboten — abgeglichen per IP UND Seriennummer (ein umgezogener Drucker mit neuer IP taucht so nicht doppelt auf).',
    ],
    en: [
      'Network discovery: fixed the "_.trim is not a function" error when starting a scan (the click accidentally passed the event instead of the subnet).',
      'Network discovery: already-added devices are no longer offered as a result — matched by IP AND serial number (a printer that moved to a new IP no longer shows up twice).',
    ],
  },
  {
    version: '1.0.153',
    de: [
      'Netzwerk-Suche in Docker korrigiert: Bisher meldete die Suche im Docker-Bridge-Netz fälschlich eine Docker-interne Adresse (z. B. 172.18.0.2) als Drucker. Jetzt erkennt Printloom die Bridge, scannt das nutzlose Docker-Netz nicht mehr und blendet die eigene Container-Adresse aus. Stattdessen erscheint ein Feld, in dem du dein echtes LAN-Subnetz (z. B. 192.168.1) eingibst — damit wird das richtige Netz gescannt (per Docker-Routing erreichbar), auch ohne „network_mode: host".',
    ],
    en: [
      'Fixed network discovery in Docker: previously the scan in a Docker bridge network wrongly reported a Docker-internal address (e.g. 172.18.0.2) as a printer. Printloom now detects the bridge, no longer scans the useless Docker network and hides its own container address. Instead a field appears where you enter your real LAN subnet (e.g. 192.168.1) — that scans the correct network (reachable via Docker routing), even without "network_mode: host".',
    ],
  },
  {
    version: '1.0.152',
    de: [
      'Magazin-Sollzahl fest je Rack: In Konfiguration → Regal legst du „Platten pro Magazin" jetzt als FESTE Sollzahl fest (z. B. 4+4+4). Beim Entnehmen aller Platten und beim Reset/Auffüllen stellt sich das Magazin wieder exakt auf diese Ursprungszahl — vorher konnte es je nach Verlauf schief stehen (z. B. 3/6/3) und bis zur Fachzahl (6) hochlaufen.',
      'Magazin-Badge im Regal (oben links) zeigt jetzt die konfigurierte Maximalzahl (z. B. 11/12) statt der theoretischen Fach-Kapazität (11/18).',
    ],
    en: [
      'Fixed magazine target per rack: in Configuration → Rack you now set "Plates per magazine" as a FIXED target (e.g. 4+4+4). When you remove all plates and on reset/refill the magazine returns to exactly this original number — previously it could end up uneven (e.g. 3/6/3) and climb up to the slot count (6).',
      'The rack magazine badge (top left) now shows the configured maximum (e.g. 11/12) instead of the theoretical slot capacity (11/18).',
    ],
  },
  {
    version: '1.0.151',
    de: [
      'Netzwerk-Suche für Drucker: Im Setup-Assistenten (Schritt Drucker & OTTOeject) und in Konfiguration → Geräte gibt es jetzt „🔍 Netzwerk durchsuchen". Bambu-Drucker werden per SSDP gefunden (IP, Name UND Seriennummer werden direkt übernommen — wie in OrcaSlicer); Klipper/OTTOeject per Moonraker-Scan inkl. Hostname. Ein Klick füllt das Formular vor, nur der Access-Code wird noch selbst eingetragen (der wird aus Sicherheitsgründen nie mitgesendet). Hinweis: In Docker-Bridge-Netzen erreichen SSDP-Broadcasts den Container nicht — dort greift ein Port-Scan-Fallback (Drucker mit IP, Seriennummer dann manuell) oder man nutzt „network_mode: host".',
      'Neue Geräte-Option „🌀 Bauraumlüftung dauerhaft aus" (bei Bambu-Druckern, Konfiguration → Geräte): Ist sie aktiv, prüft Printloom im 5-Sekunden-Takt über die bestehende MQTT-Verbindung, ob der Bauraumlüfter (P3) läuft, und schaltet ihn aus, sobald er anläuft. Standardmäßig aus — nichts ändert sich ohne dein Zutun.',
    ],
    en: [
      'Network discovery for printers: the setup wizard (printer & OTTOeject steps) and Configuration → Devices now have "🔍 Scan network". Bambu printers are found via SSDP (IP, name AND serial number are filled in directly — like OrcaSlicer); Klipper/OTTOeject via a Moonraker scan including hostname. One click pre-fills the form; you only add the access code yourself (it is never broadcast for security). Note: in Docker bridge networks SSDP broadcasts do not reach the container — there a port-scan fallback applies (printer with IP, serial then manual) or use "network_mode: host".',
      'New device option "🌀 Keep chamber fan off" (for Bambu printers, Configuration → Devices): when enabled, Printloom checks every 5 seconds over the existing MQTT connection whether the chamber fan (P3) is running and turns it off as soon as it starts. Off by default — nothing changes unless you enable it.',
    ],
  },
  {
    version: '1.0.150',
    de: [
      'Auto-Farm-Warteschlange: Bei benannten Platten zeigt das Badge jetzt Name UND Plattenzahl („Name · 1/12") statt nur des Namens.',
      'Der Schalter „Kamera komplett deaktivieren" (Energiesparmodus) ist von System zu Konfiguration & Kameras (Tab „Kameras") umgezogen. NEU: Bei Neuinstallationen ist die Kamera jetzt standardmäßig komplett deaktiviert (kein ffmpeg) — wer das Live-Bild will, schaltet sie dort einmalig ein. Bestehende Installationen behalten beim Update ihren bisherigen Stand (Kamera bleibt an).',
    ],
    en: [
      'Auto Farm queue: for named plates the badge now shows name AND plate count (“name · 1/12”) instead of the name alone.',
      'The “disable camera completely” switch (power-saving mode) moved from System to Configuration & Cameras (“Cameras” tab). NEW: on fresh installations the camera is now completely disabled by default (no ffmpeg) — enable it there once if you want the live view. Existing installations keep their current state on update (camera stays on).',
    ],
  },
  {
    version: '1.0.149',
    de: [
      'Multi-Plate-.3mf: Die im Slicer vergebenen PLATTEN-NAMEN (Orca/Bambu „Platte benennen") werden jetzt überall angezeigt statt nur „Platte 1/2": in der Platten-Liste des Datei-Browsers und auf den Karten der Auto-Farm-Warteschlange (Plattennummer weiterhin im Tooltip). Neue Jobs übernehmen den Namen automatisch — sowohl beim Einreihen einzelner Platten als auch beim Expandieren einer Mehr-Platten-Datei.',
    ],
    en: [
      'Multi-plate .3mf: the PLATE NAMES assigned in the slicer (Orca/Bambu “rename plate”) are now shown everywhere instead of just “Plate 1/2”: in the file browser’s plate list and on Auto Farm queue cards (plate number stays in the tooltip). New jobs pick up the name automatically — both when queueing single plates and when expanding a multi-plate file.',
    ],
  },
  {
    version: '1.0.148',
    de: [
      'Multi-Plate-.3mf (Orca/Bambu) jetzt PLATTENGENAU: Höhe und Druckzeit werden pro Platte aus deren eigenem G-code gelesen — bisher bekam jede Platte fälschlich die Werte der ersten (falsche Fach-Reservierung und Zeitplanung). Gilt für Queue-Jobs, laufende Farm (enqueue) und die Höhen-Analyse.',
      'Datei-Browser: Multi-Plate-Dateien zeigen ein Badge „🗂 N Platten". Aufklappen listet jede Platte mit ihrer Zeit, Höhe und Filamentmenge — und jede Platte lässt sich einzeln SOFORT drucken oder einzeln in die Auto-Farm-Queue legen. Der Direkt-Druck sendet dabei nur die gewählte Platte (umgepackt als Einzel-Platten-.3mf, plattengenaue AMS-Zuordnung).',
    ],
    en: [
      'Multi-plate .3mf (Orca/Bambu) is now PLATE-ACCURATE: height and print time are read per plate from its own G-code — previously every plate wrongly got the first plate’s values (wrong slot reservation and scheduling). Applies to queue jobs, the running farm (enqueue) and the height analysis.',
      'File browser: multi-plate files show a “🗂 N plates” badge. Expanding lists each plate with its time, height and filament — and each plate can be printed immediately on its own or added individually to the Auto Farm queue. Direct print sends only the selected plate (repacked as a single-plate .3mf, plate-accurate AMS mapping).',
    ],
  },
  {
    version: '1.0.147',
    de: [
      'Neue native Installation OHNE Docker (systemd-Dienst) — für schwache Geräte wie den Raspberry Pi Zero 2 W (512 MB), auf denen Docker zu viel RAM kostet, und generell für alle, die ohne Docker arbeiten wollen (arm64 & amd64, Debian/Ubuntu/Raspberry Pi OS). Ein Befehl installiert alles: curl -fsSL https://raw.githubusercontent.com/DasKlaus00/printloom/main/scripts/install-native.sh | bash — inkl. fertigem Frontend (Vite-Build kommt als Release-Artefakt, schwache Geräte müssen nichts bauen), automatischen Speichergrenzen auf 512-MB-Geräten (schützt z. B. Klipper auf demselben Gerät) und ffmpeg nur bei genug RAM. Updates: bash ~/printloom/scripts/update-native.sh (auch für den Kanalwechsel). Die System-Seite erkennt den nativen Betrieb und zeigt den passenden Update-Weg. Doku: docs/INSTALL-NATIVE.md.',
    ],
    en: [
      'New native installation WITHOUT Docker (systemd service) — for low-power devices like the Raspberry Pi Zero 2 W (512 MB) where Docker costs too much RAM, and generally for anyone who prefers no Docker (arm64 & amd64, Debian/Ubuntu/Raspberry Pi OS). One command installs everything: curl -fsSL https://raw.githubusercontent.com/DasKlaus00/printloom/main/scripts/install-native.sh | bash — including a prebuilt frontend (the Vite build ships as a release artifact, weak devices build nothing), automatic memory limits on 512 MB devices (protects e.g. Klipper on the same machine) and ffmpeg only with enough RAM. Updates: bash ~/printloom/scripts/update-native.sh (also switches channels). The System page detects native mode and shows the matching update path. Docs: docs/INSTALL-NATIVE.md.',
    ],
  },
  {
    version: '1.0.146',
    de: [
      'Neuer Energiesparmodus für schwache Geräte (z. B. Raspberry Pi): Unter System → „Kamera" lässt sich die Kamera komplett deaktivieren. Dann startet nie ein ffmpeg-Transcoder (Live-Stream UND Drucker-Snapshots aus) — das spart mehrere CPU-Kerne und ~150 MB RAM. Ein gerade laufender Stream wird beim Umschalten sofort beendet. Externe Webcams (HTTP-URL) funktionieren weiter. Standard: Kamera an (nichts ändert sich ohne Zutun).',
    ],
    en: [
      'New power-saving mode for low-power devices (e.g. Raspberry Pi): under System → “Camera” the camera can be disabled completely. No ffmpeg transcoder is ever started then (live stream AND printer snapshots off) — saving several CPU cores and ~150 MB RAM. A currently running stream is stopped immediately when toggled. External webcams (HTTP URL) keep working. Default: camera on (nothing changes unless you flip it).',
    ],
  },
  {
    version: '1.0.145',
    de: [
      'Docker-Image jetzt auch für Raspberry Pi: Das Image wird als Multi-Arch gebaut (amd64 + arm64) — dasselbe :latest/:beta-Tag läuft damit unverändert auf PC/Proxmox UND auf einem Raspberry Pi 3/4/5 mit 64-bit Raspberry Pi OS. Jeder Host zieht automatisch die passende Architektur; an bestehenden Installationen ändert sich nichts. Hinweis: 32-bit-Systeme werden nicht unterstützt; für den Kamera-Stream empfiehlt sich ein Pi 4 oder 5.',
    ],
    en: [
      'Docker image now also for Raspberry Pi: the image is built multi-arch (amd64 + arm64) — the same :latest/:beta tag runs unchanged on PC/Proxmox AND on a Raspberry Pi 3/4/5 with 64-bit Raspberry Pi OS. Each host automatically pulls its architecture; existing installations are unaffected. Note: 32-bit systems are not supported; a Pi 4 or 5 is recommended for the camera stream.',
    ],
  },
  {
    version: '1.0.144',
    de: [
      'Auto Farm — Regal: Alle Fächer haben jetzt eine FESTE Zeilenhöhe. Leere, belegte, fertige und reservierte Fächer (↑ hineinragende Teile) sind exakt gleich groß — die Regale R1/R2/R3 bleiben immer auf gleicher Höhe ausgerichtet und nichts verrutscht mehr.',
      'Auto Farm — Hinweise verschieben nichts mehr: Meldungen wie „Pausiert", „Wartet auf neue Jobs", Erfolg/Fehler-Feedback oder „Kein Gerät konfiguriert" erscheinen jetzt als schwebende Pille ganz oben mittig über dem Header (Overlay) statt im Seiteninhalt. Das Dashboard springt dadurch nicht mehr nach unten.',
    ],
    en: [
      'Auto Farm — rack: all slots now have a FIXED row height. Empty, occupied, done and reserved slots (↑ overhanging parts) are exactly the same size — racks R1/R2/R3 always stay vertically aligned, nothing shifts anymore.',
      'Auto Farm — notices no longer push content: messages like “Paused”, “Waiting for jobs”, success/error feedback or “No device configured” now appear as a floating pill at the top center over the header (overlay) instead of inside the page. The dashboard no longer jumps down.',
    ],
  },
  {
    version: '1.0.143',
    de: [
      'Drucker-Tab (Regal & Greifen): In der Reihe „X-Position je Regal" gibt es jetzt ganz links ein Feld „🖨 Drucker". Damit setzt du die Start-X von „Vor Drucker fahren", „Platte auswerfen" und „Platte einlegen" gemeinsam an einer Stelle (absoluter Maschinen-X, inkl. Regal-Versatz). Der „→"-Knopf daneben fährt zum Testen vor den Drucker. (Die Reihe erscheint ab 2 Regalen.)',
    ],
    en: [
      'Printer tab (Rack & grab): the “X per rack” row now has a “🖨 Printer” field on the far left. It sets the start X of “Move to printer”, “Eject plate” and “Place plate” together in one place (absolute machine X, incl. rack offset). The “→” button next to it drives in front of the printer to test. (The row shows with 2+ racks.)',
    ],
  },
  {
    version: '1.0.142',
    de: [
      'Drucker-Tab: Bei JEDEM benannten Drucker (nicht nur „Custom Printer") lässt sich für die fünf Wechsel-Operationen — Tür öffnen, Tür schließen, Vor Drucker fahren, Platte auswerfen, Platte einlegen — wieder ein eigener G-code hinterlegen. Unter den Positions-Feldern gibt es den Knopf „⚙ Eigenen G-code bearbeiten (Feinjustage)": er lädt den aus deinen Werten berechneten G-code als Vorlage in ein Editorfeld, das du frei anpassen kannst. „Test" fährt exakt diesen G-code, die Farm nutzt ihn bei aktivem Op-Schalter. „✕ zurück zu Werten" entfernt den Override wieder. Ohne Override bleibt alles positionsbasiert (unverändert).',
    ],
    en: [
      'Printer tab: every named printer (not only “Custom Printer”) can again have its own G-code for the five swap operations — open door, close door, move to printer, eject plate, place plate. Below the position fields there is an “⚙ Edit custom G-code (fine-tuning)” button: it loads the G-code computed from your values as a template into an editor you can freely adjust. “Test” runs exactly that G-code, and the farm uses it when the op’s toggle is on. “✕ back to values” removes the override. Without an override everything stays position-based (unchanged).',
    ],
  },
  {
    version: '1.0.141',
    de: [
      'Tür (öffnen & schließen): Start-X/Y/Z sind jetzt der ERSTE Fahrpunkt der Bewegung — der Punkt, den der Arm zuerst anfährt. Die restliche Türbewegung (Bogen, Andrücken) folgt automatisch daraus, der Pin-Abstand ist der Bogenradius. Die Bewegung selbst bleibt dieselbe Form. ACHTUNG — Werte neu setzen: Da sich die Bedeutung der Felder geändert hat, trag den gewünschten ersten Fahrpunkt neu ein (aus dem „gesendeten G-code" ablesbar). Bei „Tür schließen" liegt der erste Punkt auf der Bogen-Seite (z. B. X~1036 / Y~18), nicht bei der geschlossenen Position. Immer zuerst mit „Test" prüfen.',
      'Aufgeräumt: G90 (absolute Positionierung) steht jetzt EINMAL ganz vorne im G-code (vorher kosmetisch doppelt). G90 ist korrekt und muss bleiben — es erzwingt absolute Koordinaten; das relative G91 ist das, was Probleme macht.',
    ],
    en: [
      'Door (open & close): start X/Y/Z are now the FIRST travel point of the motion — the point the arm moves to first. The rest of the door motion (arc, pressing) follows automatically, the pin distance is the arc radius. The motion shape stays the same. NOTE — re-enter values: since the meaning of the fields changed, enter your desired first travel point anew (readable from the “sent G-code”). For “close door” the first point is on the arc side (e.g. X~1036 / Y~18), not at the closed position. Always check with “Test” first.',
      'Cleanup: G90 (absolute positioning) now appears ONCE at the very front of the G-code (previously cosmetically doubled). G90 is correct and must stay — it forces absolute coordinates; the relative G91 is what causes problems.',
    ],
  },
  {
    version: '1.0.140',
    de: [
      'Kleinigkeit: Das Y-Feld heißt jetzt „Start-Y" (statt nur „Y") — konsistent zu Start-X und Start-Z. Es ist der Y-Wert des Greif-/Startpunkts, den du direkt bestimmst.',
    ],
    en: [
      'Small fix: the Y field is now labeled “Start-Y” (instead of just “Y”) — consistent with Start-X and Start-Z. It’s the Y of the grab/start point that you set directly.',
    ],
  },
  {
    version: '1.0.139',
    de: [
      'Neuer „Andruck-Weg (mm)" im Drucker-Tab (Regal & Greifen): der bisher fest verdrahtete ±30-mm-Klemm-Andruck ist jetzt einstellbar. Der Arm fährt beim Greifen/Ablegen um diesen Weg über die X hinaus, um den Greifer in die Platten-Halterung zu drücken (Auswerfen/Einlegen: +, Greifen/Ablegen: −). Original bleibt 30. Auf 0 stellen, wenn der Greifer genau bei deinem Start-X fassen soll — behebt den ~30er-Versatz (1065 statt 1035).',
    ],
    en: [
      'New “Push distance (mm)” in the printer tab (rack & grabbing): the previously hard-wired ±30 mm clamp push is now adjustable. On grab/place the arm moves this far beyond X to press the gripper into the plate bracket (eject/place: +, grab/store: −). Default stays 30. Set to 0 for the gripper to engage exactly at your start X — fixes the ~30 offset (1065 instead of 1035).',
    ],
  },
  {
    version: '1.0.138',
    de: [
      'Wichtiger Fix (absolute Bewegungen, überarbeitet): G90 wird jetzt zentral vor JEDEM G-code erzwungen, der an den OTTOeject/Klipper geht — nicht nur bei den App-Ops, sondern auch bei den Geräte-Macros (EJECT_FROM…/GRAB_FROM_RACK…), der direkten G-code-Zeile und allen Farm-Schritten. Ursache des „fährt raus, obwohl alles stimmt": Die Geräte-Macros setzen selbst kein G90 — stand der OTTOeject nach Homing/Jog relativ, liefen ihre Bewegungen als Versatz ab der Ist-Position (z. B. falsche Z-Höhe beim zweiten Tür-Schieben, Move out of range). Jetzt sind ALLE Bewegungen verlässlich absolute Maschinen-Koordinaten.',
    ],
    en: [
      'Important fix (absolute moves, reworked): G90 is now enforced centrally before EVERY G-code sent to the OTTOeject/Klipper — not just app ops, but also the device macros (EJECT_FROM…/GRAB_FROM_RACK…), the direct G-code line and all farm steps. Root cause of “drives out of range although everything is correct”: the device macros set no G90 themselves — if the OTTOeject was left relative after homing/jog, their moves ran as offsets from the current position (e.g. wrong Z on the second door push, move out of range). Now ALL moves are reliably absolute machine coordinates.',
    ],
  },
  {
    version: '1.0.137',
    de: [
      '„Vor Drucker fahren" endet jetzt zurückgezogen bei Y = Pullback (5) statt vorne an der Druckerfront: sichere Höhe → auf y=5 zurückziehen → auf Drucker-X ausrichten (Y bleibt 5). Auswerfen/Einlegen fahren selbst aus dieser Position an die Front.',
    ],
    en: [
      '“Move to printer” now ends retracted at Y = pullback (5) instead of at the printer front: safe height → retract to y=5 → align to printer X (Y stays 5). Eject/place move to the front themselves from there.',
    ],
  },
  {
    version: '1.0.136',
    de: [
      'Tür-Bewegung exakt nach dem Original-OTTOeject-Macro nachgebaut (Öffnen & Schließen). Die eingebaute Version war früher handjustiert und wich vom Original ab (Tür schloss/öffnete nicht sauber). Jetzt gibst du nur den Startpunkt an (Start-X/Y/Z + Pin-Abstand) und der komplette Ablauf — Bogen und Andrücken — wird 1:1 wie im Original daraus berechnet. Nichts mehr an einzelnen Werten nachbessern.',
    ],
    en: [
      'Door motion rebuilt to exactly match the original OTTOeject macro (open & close). The built-in version had drifted from the original due to hand-tuning (door didn’t open/close cleanly). Now you only set the start point (start X/Y/Z + pin distance) and the whole sequence — arc and pressing — is computed from it 1:1 like the original. No more tweaking individual values.',
    ],
  },
  {
    version: '1.0.135',
    de: [
      'Drucker-Tab: Neuer Knopf „🖨 Druckerbett → Z" — fährt das Bett des verbundenen Bambu-Druckers (X1C) absolut auf die Ziel-Z. Standard Z200 (Ladeposition für den Platten-Wechsel), Z frei einstellbar. Praktisch beim Kalibrieren: erst Bett auf Z200, dann OTTOeject-Operationen testen. Drucker muss idle sein.',
    ],
    en: [
      'Printer tab: new button “🖨 Print bed → Z” — moves the connected Bambu printer’s bed (X1C) to the target Z in absolute terms. Default Z200 (loading position for the plate swap), Z freely adjustable. Handy for calibration: bed to Z200 first, then test OTTOeject operations. Printer must be idle.',
    ],
  },
  {
    version: '1.0.134',
    de: [
      '„Tür schließen" hat wieder eigene, einstellbare Start-Koordinaten (Start-X absolut, Y, Start-Z, Pin-Abstand) — unabhängig von „Tür öffnen". Standard/Fallback bleibt die Öffnen-Position, wenn keine eigenen Werte gesetzt sind. Der Hinweis „übernimmt Position von Tür öffnen" entfällt.',
    ],
    en: [
      '“Close door” has its own adjustable start coordinates again (absolute start X, Y, start Z, pin distance) — independent of “Open door”. Default/fallback stays the open position when no own values are set. The “taken from Open door” note is gone.',
    ],
  },
  {
    version: '1.0.133',
    de: [
      'Wichtiger Fix: Alle OTTOeject-Operationen erzwingen jetzt absolute Positionierung (G90). Stand der OTTOeject durch manuelles Jog in Mainsail im relativen Modus, wurde z. B. „G1 X1020" als +1020 ab Ist-Position gefahren → „Move out of range" (obwohl die Koordinaten korrekt waren). Jetzt sind alle Op-Koordinaten verlässlich absolute Maschinen-Koordinaten — betrifft Vor Drucker fahren, Auswerfen, Einlegen, Tür, Greifen/Ablegen und eigenen G-code gleichermaßen.',
    ],
    en: [
      'Important fix: all OTTOeject operations now force absolute positioning (G90). If the OTTOeject was left in relative mode by a manual Mainsail jog, e.g. “G1 X1020” ran as +1020 from the current position → “Move out of range” (even though the coordinates were correct). Now every op coordinate is reliably an absolute machine coordinate — applies to move to printer, eject, place, door, grab/store and custom G-code alike.',
    ],
  },
  {
    version: '1.0.132',
    de: [
      'Drucker-Tab → „Vor Drucker fahren" hat jetzt eine eigene, einstellbare Start-Position (absolutes X wie bei den anderen Ops, plus Y/Start-Z) statt fest die Auswurf-Position zu übernehmen. Standard bleibt die Auswurf-Position; wer die Anfahrt separat feinjustieren will, kann es hier. Bestehende Setups ohne eigenen Wert fahren unverändert wie die Auswurf-Position.',
    ],
    en: [
      'Printer tab → “Move to printer” now has its own adjustable start position (absolute X like the other ops, plus Y/start Z) instead of always borrowing the eject position. Default stays the eject position; tune the approach separately here if you want. Existing setups without a value keep moving exactly like the eject position.',
    ],
  },
  {
    version: '1.0.131',
    de: [
      'Auto Farm: Einzelne Regal-Fächer lassen sich jetzt direkt im Regal als „belegt" markieren (🔒) — sie werden ausgegraut und der Roboter legt dort nichts ab (die Platzsuche überspringt sie). Mit 🔓 gibst du sie wieder frei. Praktisch für Fächer, in denen schon etwas von Hand steht. Zählt nicht als Platte (kein Einfluss aufs Magazin).',
    ],
    en: [
      'Auto Farm: individual rack slots can now be marked “occupied” right in the rack (🔒) — they grey out and the robot places nothing there (slot search skips them). Release again with 🔓. Handy for slots you’ve filled by hand. Does not count as a plate (no effect on the magazine).',
    ],
  },
  {
    version: '1.0.130',
    de: [
      'Tür: Du stellst nur noch EINE Türposition ein — bei „Tür öffnen". „Tür schließen" übernimmt Start-X/Y/Z und Pin-Abstand jetzt automatisch daraus; die Eingabefelder dort sind weg (nur noch Test & eigene Geschwindigkeit). Weniger doppelte Kalibrierung, keine auseinanderlaufenden Auf/Zu-Werte mehr.',
    ],
    en: [
      'Door: you now set only ONE door position — at “Open door”. “Close door” takes start X/Y/Z and pin distance from it automatically; its input fields are gone (only Test & own speed remain). Less double calibration, no more drifting open/close values.',
    ],
  },
  {
    version: '1.0.129',
    de: [
      'Klare Trennung im Drucker-Tab: Bei den Modell-Druckern (X1C, P1S, …) stellst du nur noch die Start-Positionen je Operation ein und justierst sie — der G-code-Editor („Eigenen G-code bearbeiten") ist dort entfernt. Für vollständig eigene Abläufe gibt es den neuen „Custom Printer": jede Operation (Tür auf/zu, vor Drucker, auswerfen, einlegen) wird ausschließlich über deinen eigenen G-code gefahren, ganz ohne Start-Positionen. „⤓ Vorlage laden" füllt einen Startpunkt zum Bearbeiten; Platzhalter wie {rack_x}/{slot_z} skalieren weiter über Regale/Fächer.',
    ],
    en: [
      'Clear split in the printer tab: for the model printers (X1C, P1S, …) you now only set and adjust the start positions per operation — the G-code editor (“Edit custom G-code”) is removed there. For fully custom motion there’s the new “Custom Printer”: every operation (door open/close, move to printer, eject, place) runs exclusively from your own G-code, with no start positions at all. “⤓ Load template” fills a starting point to edit; placeholders like {rack_x}/{slot_z} still scale across racks/slots.',
    ],
  },
  {
    version: '1.0.128',
    de: [
      'Drucker-Tab: Auch „Vor Drucker fahren", „Platte auswerfen" und „Platte einlegen" nehmen den Start-X jetzt als absoluten Maschinenwert (wie zuvor die Tür) — du tippst genau die Position ein, die die OTTOeject anfährt; der Regal-Versatz wird intern verrechnet, ein Hinweis zeigt Basis + Versatz. Y und Start-Z waren schon immer absolut. „Vor Drucker fahren" nutzt weiterhin die Auswurf-Position als Bezug.',
    ],
    en: [
      'Printer tab: “Move to printer”, “Eject plate” and “Place plate” now also take start X as an absolute machine value (like the door) — you type exactly the position the OTTOeject moves to; the rack offset is handled internally, a hint shows base + offset. Y and start Z were always absolute. “Move to printer” still uses the eject position as its reference.',
    ],
  },
  {
    version: '1.0.127',
    de: [
      'Drucker-Tab → Tür öffnen/schließen: Start-X und Start-Z werden jetzt als absolute Maschinenwerte eingegeben — du tippst genau die Position ein, die die OTTOeject anfährt. Kein verwirrender „effektiv X…"-Unterschied mehr: der Regal-Versatz wird intern verrechnet (ein kleiner Hinweis zeigt Basis + Versatz), sodass die Türbewegung auch bei anderer Regalzahl stimmt.',
    ],
    en: [
      'Printer tab → open/close door: start X and start Z are now entered as absolute machine values — you type exactly the position the OTTOeject moves to. No more confusing “effective X…” gap: the rack offset is handled internally (a small hint shows base + offset), so the door motion stays correct even with a different rack count.',
    ],
  },
  {
    version: '1.0.126',
    de: [
      'Drucker-Tab → Regal & Greifen: Die X-Position jedes Regals lässt sich jetzt einzeln setzen. Standard bleibt Start-X + Regal-Versatz; ein geänderter Wert wird als Δ-Korrektur pro Regal gespeichert (✕ = zurück auf Standard) und gilt für alle Fächer, das Magazin und den eigenen G-code des Regals. Pro Regal gibt es einen „→"-Test (Fach 1 anfahren, ohne zu greifen) — praktisch, wenn die Regale nicht exakt im gleichmäßigen Raster stehen.',
    ],
    en: [
      'Printer tab → rack & grabbing: each rack’s X position can now be set individually. Default remains start X + rack offset; a changed value is stored as a Δ correction per rack (✕ = back to default) and applies to all slots, the magazine and the rack’s custom G-code. Each rack has a “→” test (approach slot 1 without grabbing) — handy when the racks don’t sit on a perfectly even grid.',
    ],
  },
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
