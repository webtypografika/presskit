; Finish-page checkbox: pin to taskbar (opt-out). Reuses the MUI "show readme"
; checkbox slot — the standard electron-builder way to add a finish checkbox.
; Guarded: this file is also included when building the UNINSTALLER, where the
; same MUI_FINISHPAGE_* defines would leak into MUI_UNPAGE_FINISH and reference
; a function that doesn't exist there.
!ifndef BUILD_UNINSTALLER
  !define MUI_FINISHPAGE_SHOWREADME ""
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "Pin PressKit to the taskbar"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION pinToTaskbar

  Function pinToTaskbar
    ; Delete first to force Windows to re-read the icon — without it, Windows
    ; keeps the cached icon from a previous install.
    Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\PressKit.lnk"
    CreateShortCut "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\PressKit.lnk" "$INSTDIR\PressKit.exe" "" "$INSTDIR\resources\icon.ico" 0
  FunctionEnd
!endif

!macro customInstall
  ; Register presscal-fh:// protocol handler
  DetailPrint "Registering presscal-fh:// protocol handler..."
  DeleteRegKey HKCU "Software\Classes\presscal-fh"
  WriteRegStr HKCU "Software\Classes\presscal-fh" "" "URL:PressCal File Helper"
  WriteRegStr HKCU "Software\Classes\presscal-fh" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\presscal-fh\DefaultIcon" "" "$INSTDIR\PressKit.exe,0"
  WriteRegStr HKCU "Software\Classes\presscal-fh\shell\open\command" "" '"$INSTDIR\PressKit.exe" "%1"'

  ; ── Ghostscript (PDF engine) ──────────────────────────────────────────
  ; Detect via the registry, 64-bit view: Ghostscript writes
  ; HKLM\SOFTWARE\GPL Ghostscript\<version> on install. IfFileExists cannot
  ; match a wildcard mid-path (gs\gs*\bin\...), which is why every earlier
  ; version of this check missed existing installs and re-prompted everyone.
  SetRegView 64
  EnumRegKey $0 HKLM "SOFTWARE\GPL Ghostscript" 0
  SetRegView lastused
  StrCmp $0 "" 0 gsFound

  ; Registry miss — scan Program Files\gs\gs*\ folders as a fallback.
  FindFirst $1 $2 "$PROGRAMFILES64\gs\gs*"
  gsDirLoop:
    StrCmp $2 "" gsDirDone
    IfFileExists "$PROGRAMFILES64\gs\$2\bin\gswin64c.exe" 0 gsDirNext
    FindClose $1
    Goto gsFound
  gsDirNext:
    FindNext $1 $2
    Goto gsDirLoop
  gsDirDone:
  FindClose $1

  ; Silent runs = auto-updates: never download/elevate there.
  IfSilent gsDone

  ; No questions and nothing auto-opens in the browser: install it for the
  ; user. The info URL is printed in the install log for the curious.
  DetailPrint "Ghostscript (free PDF engine by Artifex) not found - downloading..."
  DetailPrint "About Ghostscript: https://www.ghostscript.com"
  nsExec::ExecToLog "powershell -NoProfile -ExecutionPolicy Bypass -Command $\"$$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10050/gs10050w64.exe' -OutFile '$TEMP\presskit-gs-setup.exe'$\""
  Pop $0
  IfFileExists "$TEMP\presskit-gs-setup.exe" 0 gsManual
  DetailPrint "Installing Ghostscript (a Windows security prompt may appear)..."
  ; ExecWait passes /S verbatim on the command line. ExecShellWait dropped it
  ; (observed 04/08: full wizard appeared), so the installer ran interactively.
  ClearErrors
  ExecWait '"$TEMP\presskit-gs-setup.exe" /S'
  Delete "$TEMP\presskit-gs-setup.exe"
  ; Verify the same way we detect: registry, 64-bit view.
  SetRegView 64
  EnumRegKey $0 HKLM "SOFTWARE\GPL Ghostscript" 0
  SetRegView lastused
  StrCmp $0 "" gsManual gsInstalled

  gsInstalled:
    DetailPrint "Ghostscript installed."
    Goto gsDone

  gsManual:
    ; Automatic path failed (blocked download, declined elevation, ...) —
    ; fall back to the old manual flow. /SD keeps unattended runs moving.
    MessageBox MB_OK|MB_ICONINFORMATION "Automatic Ghostscript installation didn't complete.$\n$\nPressKit will open the download page - run gs10050w64.exe after this setup finishes. It takes 1-2 minutes." /SD IDOK
    ExecShell "open" "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10050/gs10050w64.exe"
    Goto gsDone

  gsFound:
    DetailPrint "Ghostscript already installed."

  gsDone:
!macroend

!macro customUnInstall
  ; Remove presscal-fh:// protocol handler
  DetailPrint "Removing presscal-fh:// protocol handler..."
  DeleteRegKey HKCU "Software\Classes\presscal-fh"

  ; Remove taskbar pin
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\PressKit.lnk"
!macroend
