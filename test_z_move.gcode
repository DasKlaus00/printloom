; OTTOmat3D - Z-Achsen Test
; Faehrt Z nach oben und wieder zurueck
; Sicher fuer Bambu Lab X1C im LAN-Modus

G28 Z          ; Z-Achse homen
G1 Z50 F600    ; Langsam auf 50mm fahren
G4 P3000       ; 3 Sekunden warten
G1 Z10 F600    ; Zurueck auf 10mm
M400           ; Warten bis Bewegung fertig
