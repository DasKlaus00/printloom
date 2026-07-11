; Inno-Setup-Skript für die native Printloom-Windows-App.
; Baut aus dem PyInstaller-One-Folder (dist\Printloom) einen Installer.
;
; Kompilieren (Version wird übergeben):
;   iscc /DMyAppVersion=1.0.141 desktop\installer.iss
;
; Ergebnis: desktop\Output\Printloom-Setup-<version>.exe
; Per-User-Installation (kein Admin nötig) → weniger SmartScreen-Reibung.

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

#define MyAppName "Printloom"
#define MyAppPublisher "Printloom"
#define MyAppExeName "Printloom.exe"

[Setup]
AppId={{7E2B9F41-9C3A-4E7D-8B21-PRINTLOOM01}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=Output
OutputBaseFilename=Printloom-Setup-{#MyAppVersion}
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Beim Update die laufende App schließen, damit Dateien ersetzt werden können.
CloseApplications=yes
RestartApplications=no
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startup"; Description: "Printloom automatisch mit Windows starten"; GroupDescription: "Autostart:"

[Files]
; PyInstaller-One-File: eine einzige EXE.
Source: "..\dist\Printloom.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Registry]
; Autostart (HKCU-Run) nur wenn der Nutzer die Aufgabe wählt.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; \
    ValueName: "Printloom"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: startup

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
