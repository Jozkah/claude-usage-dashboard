Option Explicit

Dim shell, files, root, launcher
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
launcher = files.BuildPath(root, "scripts\launch-third.ps1")
shell.CurrentDirectory = root
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & launcher & Chr(34), 0, False
