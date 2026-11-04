# Shared helper: show an error message box (used by the hidden launchers).
function Show-LauncherError([string]$Text, [string]$Title) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($Text, $Title, 'OK', 'Error')
  } catch { Write-Error $Text }
}
