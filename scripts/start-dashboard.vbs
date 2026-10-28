Option Explicit

Dim files, shell, root, watchdog
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
watchdog = root & "\scripts\watch-dashboard.ps1"

shell.CurrentDirectory = root
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & watchdog & Chr(34), 0, False
