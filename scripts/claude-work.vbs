' Launch claude-work.cmd without a visible command window.
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
launcher = files.BuildPath(files.GetParentFolderName(WScript.ScriptFullName), "claude-work.cmd")
shell.Run "cmd.exe /c " & Chr(34) & Chr(34) & launcher & Chr(34) & Chr(34), 0, False
