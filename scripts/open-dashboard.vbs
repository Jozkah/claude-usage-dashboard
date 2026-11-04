Option Explicit

Dim files, shell, root, launcher, request, attempt, ready, port, baseUrl
Set files = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
launcher = files.BuildPath(root, "scripts\start-dashboard.vbs")
shell.CurrentDirectory = root
port = shell.ExpandEnvironmentStrings("%PORT%")
If port = "%PORT%" Or port = "" Then port = "4777"
baseUrl = "http://127.0.0.1:" & port
shell.Run "wscript.exe " & Chr(34) & launcher & Chr(34), 0, False

ready = False
For attempt = 1 To 60
  On Error Resume Next
  Set request = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  request.setTimeouts 1000, 1000, 1000, 1000
  request.Open "GET", baseUrl & "/api/health", False
  request.Send
  If Err.Number = 0 Then ready = (request.Status = 200)
  Err.Clear
  On Error GoTo 0
  If ready Then Exit For
  WScript.Sleep 1000
Next

If ready Then
  shell.Run baseUrl, 1, False
Else
  MsgBox "Dashboard did not start within one minute. Check data\dashboard-watchdog.log (created once the watchdog has started) and data\dashboard-server-error.log.", vbExclamation, "Claude Usage Dashboard"
End If
