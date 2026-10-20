' Launch claude-work.cmd without a visible command window.
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
launcher = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "claude-work.cmd")
If shell.Run("cmd.exe /c " & Chr(34) & Chr(34) & launcher & Chr(34) & Chr(34), 0, True) <> 0 Then
  MsgBox "Could not start Claude Desktop Work profile. Run claude-work.cmd to see error.", vbCritical, "Claude Work"
End If
