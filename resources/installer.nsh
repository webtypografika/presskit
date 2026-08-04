; Finish-page checkbox: pin to taskbar (opt-out). Reuses the MUI "show readme"
; checkbox slot — the standard electron-builder way to add a finish checkbox.
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Pin PressKit to the taskbar"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION pinToTaskbar

Function pinToTaskbar
  ; Delete first to force Windows to re-read the icon — without it, Windows
  ; keeps the cached icon from a previous install.
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\PressKit.lnk"
  CreateShortCut "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\PressKit.lnk" "$INSTDIR\PressKit.exe" "" "$INSTDIR\resources\icon.ico" 0
FunctionEnd

!macro customInstall
  ; Register presscal-fh:// protocol handler
  DetailPrint "Registering presscal-fh:// protocol handler..."
  DeleteRegKey HKCU "Software\Classes\presscal-fh"
  WriteRegStr HKCU "Software\Classes\presscal-fh" "" "URL:PressCal File Helper"
  WriteRegStr HKCU "Software\Classes\presscal-fh" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\presscal-fh\DefaultIcon" "" "$INSTDIR\PressKit.exe,0"
  WriteRegStr HKCU "Software\Classes\presscal-fh\shell\open\command" "" '"$INSTDIR\PressKit.exe" "%1"'

  ; ── Ghostscript (PDF engine) ──────────────────────────────────────────
  ; Ghostscript installs to the 64-bit Program Files; this NSIS installer is
  ; 32-bit, so the check MUST use $PROGRAMFILES64 ($PROGRAMFILES points to
  ; "Program Files (x86)" and always missed existing installs).
  IfFileExists "$PROGRAMFILES64\gs\gs*\bin\gswin64c.exe" gsFound 0
  ; Silent runs = auto-updates: never download/elevate/open pages there.
  IfSilent gsDone gsNotFound

  gsNotFound:
    ; No questions: install it for the user. For transparency, show what
    ; Ghostscript is while it downloads (info page only, not a download link).
    DetailPrint "Ghostscript (free PDF engine by Artifex) not found - downloading..."
    ExecShell "open" "https://www.ghostscript.com/"
    nsExec::ExecToLog "powershell -NoProfile -ExecutionPolicy Bypass -Command $\"$$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10050/gs10050w64.exe' -OutFile '$TEMP\presskit-gs-setup.exe'$\""
    Pop $0
    IfFileExists "$TEMP\presskit-gs-setup.exe" 0 gsManual
    DetailPrint "Installing Ghostscript (a Windows security prompt may appear)..."
    ExecShellWait "open" "$TEMP\presskit-gs-setup.exe" "/S"
    Delete "$TEMP\presskit-gs-setup.exe"
    IfFileExists "$PROGRAMFILES64\gs\gs*\bin\gswin64c.exe" gsInstalled gsManual

  gsInstalled:
    DetailPrint "Ghostscript installed."
    Goto gsDone

  gsManual:
    ; Automatic path failed (blocked download, declined elevation, ...) —
    ; fall back to the old manual flow. /SD keeps unattended runs moving.
    MessageBox MB_OK|MB_ICONINFORMATION /SD IDOK "Automatic Ghostscript installation didn't complete.$\n$\nPressKit will open the download page - run gs10050w64.exe after this setup finishes. It takes 1-2 minutes."
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
