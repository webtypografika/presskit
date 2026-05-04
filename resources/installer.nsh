!macro customInstall
  ; Register presscal-fh:// protocol handler
  DetailPrint "Registering presscal-fh:// protocol handler..."
  DeleteRegKey HKCU "Software\Classes\presscal-fh"
  WriteRegStr HKCU "Software\Classes\presscal-fh" "" "URL:PressCal File Helper"
  WriteRegStr HKCU "Software\Classes\presscal-fh" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\presscal-fh\DefaultIcon" "" "$INSTDIR\PressKit.exe,0"
  WriteRegStr HKCU "Software\Classes\presscal-fh\shell\open\command" "" '"$INSTDIR\PressKit.exe" "%1"'

  ; Pin to taskbar — delete first to force Windows to re-read the icon.
  ; Without the delete, Windows holds onto the cached icon from the previous
  ; install (especially after we changed icons mid-version).
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\PressKit.lnk"
  CreateShortCut "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\PressKit.lnk" "$INSTDIR\PressKit.exe" "" "$INSTDIR\resources\icon.ico" 0

  ; Check if Ghostscript is already installed
  IfFileExists "$PROGRAMFILES\gs\gs*\bin\gswin64c.exe" gsFound gsNotFound

  gsNotFound:
    MessageBox MB_YESNO|MB_ICONINFORMATION "PressKit needs Ghostscript (free tool by Artifex) to convert PDF files.$\n$\nPressKit will open the download in your browser — just run the installer afterwards. It takes 1-2 minutes.$\n$\nContinue?" IDYES gsOpen IDNO gsDone

  gsOpen:
    ExecShell "open" "https://github.com/ArtifexSoftware/ghostpdl-downloads/releases/download/gs10050/gs10050w64.exe"
    MessageBox MB_OK "The download has opened in your browser.$\n$\nOnce complete, run gs10050w64.exe and follow the instructions. You can then open PressKit normally."
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
