$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$s = $shell.CreateShortcut("$desktop\OpenCode Desktop.lnk")
$s.TargetPath = "C:\Tools\OpenCode-Desktop\OpenCode-Desktop.bat"
$s.WorkingDirectory = "C:\Tools\OpenCode-Desktop"
$s.Description = "OpenCode Desktop"
$s.IconLocation = "shell32.dll,175"
$s.Save()
Write-Host "Shortcut created"
