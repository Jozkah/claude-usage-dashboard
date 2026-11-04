Option Explicit

Dim shell, files, root, launcher
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
launcher = files.BuildPath(root, "scripts\launch-profile.ps1")
shell.CurrentDirectory = root
If shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & launcher & Chr(34) & " -Name Third", 0, True) <> 0 Then
  MsgBox "Could not start Claude Desktop Third profile. See data\launcher.log.", vbCritical, "Claude Third"
End If
