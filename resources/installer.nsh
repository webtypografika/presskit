!macro customInstall
  ; Register presscal-fh:// protocol handler
  DetailPrint "Registering presscal-fh:// protocol handler..."
  DeleteRegKey HKCU "Software\Classes\presscal-fh"
  WriteRegStr HKCU "Software\Classes\presscal-fh" "" "URL:PressCal File Helper"
  WriteRegStr HKCU "Software\Classes\presscal-fh" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\presscal-fh\DefaultIcon" "" "$INSTDIR\PressKit.exe,0"
  WriteRegStr HKCU "Software\Classes\presscal-fh\shell\open\command" "" '"$INSTDIR\PressKit.exe" "%1"'

  ; Pin to taskbar (Windows 10/11 — creates shortcut in TaskBar folder)
  CreateShortCut "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\PressKit.lnk" "$INSTDIR\PressKit.exe" "" "$INSTDIR\PressKit.exe" 0

  ; Check if Ghostscript is already installed
  IfFileExists "$PROGRAMFILES\gs\gs*\bin\gswin64c.exe" gsFound gsNotFound

  gsNotFound:
    MessageBox MB_YESNO|MB_ICONQUESTION "Το PressKit χρησιμοποιεί το Ghostscript για μετατροπή PDF.$\n$\nΘέλετε να ανοίξει η σελίδα λήψης;" IDYES gsOpen IDNO gsDone

  gsOpen:
    ExecShell "open" "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10050/gs10050w64.exe"
    MessageBox MB_OK "Το Ghostscript θα κατέβει στον browser.$\nΕγκαταστήστε το και μετά ανοίξτε το PressKit."
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
