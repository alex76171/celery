; Lessn installer (built with makensis on any OS)
Unicode true
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "Lessn"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\Lessn"
InstallDirRegKey HKCU "Software\Lessn" "InstallDir"
RequestExecutionLevel user
BrandingText "Lessn ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Lessn"
VIAddVersionKey "FileDescription" "Lessn Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MIT License"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\Lessn.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start Lessn"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "German"

Function .onInit
  ; close a running Lessn (it keeps running in the tray) so files can be replaced
  nsExec::Exec 'taskkill /IM Lessn.exe /F'
FunctionEnd

Section "Lessn" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Uninstall Lessn.exe"
  CreateDirectory "$SMPROGRAMS\Lessn"
  CreateShortcut "$SMPROGRAMS\Lessn\Lessn.lnk" "$INSTDIR\Lessn.exe"
  CreateShortcut "$SMPROGRAMS\Lessn\Uninstall Lessn.lnk" "$INSTDIR\Uninstall Lessn.exe"
  WriteRegStr HKCU "Software\Lessn" "InstallDir" "$INSTDIR"
  !define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lessn"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "Lessn"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "Lessn"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\Lessn.exe"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\Uninstall Lessn.exe"'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST}" "EstimatedSize" $0
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\Lessn.lnk" "$INSTDIR\Lessn.exe"
SectionEnd

Section "Start with Windows (in the tray)" SecAutostart
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Lessn" '"$INSTDIR\Lessn.exe" --hidden'
SectionEnd

Section "Allow phones in your network (firewall)" SecFirewall
  ; lets the Lessn app on your phone reach this PC (files, sync, local AI); asks for admin rights once
  ExecShellWait "runas" "netsh" 'advfirewall firewall add rule name="Lessn" dir=in action=allow program="$INSTDIR\Lessn.exe" enable=yes profile=private' SW_HIDE
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM Lessn.exe /F'
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\Lessn.lnk"
  RMDir /r "$SMPROGRAMS\Lessn"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Lessn"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Lessn"
  DeleteRegKey HKCU "Software\Lessn"
SectionEnd
