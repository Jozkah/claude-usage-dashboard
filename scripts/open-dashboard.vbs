Option Explicit

Dim files, shell, root, launcher, request, attempt, ready
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
launcher = files.BuildPath(root, "scripts\start-dashboard.vbs")
shell.CurrentDirectory = root
shell.Run "wscript.exe " & Chr(34) & launcher & Chr(34), 0, False

ready = False
For attempt = 1 To 60
  On Error Resume Next
  Set request = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  request.setTimeouts 1000, 1000, 1000, 1000
  request.Open "GET", "http://127.0.0.1:4777/api/chats/sync-status", False
  request.Send
  If Err.Number = 0 Then ready = (request.Status = 200)
  Err.Clear
  On Error GoTo 0
  If ready Then Exit For
  WScript.Sleep 1000
Next

If ready Then
  shell.Run "http://127.0.0.1:4777", 1, False
Else
  MsgBox "Dashboard did not start within one minute. Check data\dashboard-watchdog.log.", vbExclamation, "Claude Usage Dashboard"
End If
