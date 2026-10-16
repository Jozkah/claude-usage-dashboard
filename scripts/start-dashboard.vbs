Option Explicit

Dim files, shell, root, node, server
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
node = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not files.FileExists(node) Then node = "node.exe"
server = root & "\server\index.js"

shell.CurrentDirectory = root
shell.Environment("Process")("NO_OPEN") = "1"
shell.Run Chr(34) & node & Chr(34) & " " & Chr(34) & server & Chr(34), 0, False
