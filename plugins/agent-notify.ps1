# ============================================================
#  SEND - Agent Notify Plugin
#  Pops a Windows toast whenever the AI agent finishes a task
#  or needs your approval. Runs detached in the background.
#
#  Start it:  START-NOTIFY.bat   (or this script with -Watch)
#  The agent writes tasks to  mailbox.json  next to this file:
#    [ {"title":"...", "msg":"..."} ]
#  Each entry becomes a toast, then the mailbox is cleared.
# ============================================================
param(
    [switch]$Watch,
    [string]$Title,
    [string]$Msg
)

$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$mailbox = Join-Path $dir 'mailbox.json'
$archive = Join-Path $dir 'mailbox.log'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$script:icon = $null

function Show-Toast {
    param([string]$t, [string]$m)
    # Balloon tip: Windows 10/11 renders it as a native toast. Reliable in
    # plain PowerShell — no WinRT, no hanging.
    try {
        if (-not $script:icon) {
            $script:icon = New-Object System.Windows.Forms.NotifyIcon
            $script:icon.Icon = [System.Drawing.SystemIcons]::Information
            $script:icon.Visible = $true
        }
        $m2 = if ($m) { $m.Substring(0, [Math]::Min(200, $m.Length)) } else { '' }
        $script:icon.ShowBalloonTip(7000, $t, $m2, [System.Windows.Forms.ToolTipIcon]::Info)
    } catch { }
}

function Cleanup {
    try { if ($script:icon) { $script:icon.Visible = $false; $script:icon.Dispose() } } catch { }
}

if ($Watch) {
    # single-instance guard
    $mutex = New-Object System.Threading.Mutex($false, 'SendAgentNotifyWatcher')
    if (-not $mutex.WaitOne(0)) { exit 0 }
    Show-Toast -t '✅ Agent notify plugin running' -m 'You will get a toast when the AI finishes or needs approval.'
    while ($true) {
        if (Test-Path $mailbox) {
            $raw = ''
            try { $raw = Get-Content $mailbox -Raw -Encoding UTF8 } catch { }
            if ($raw) {
                try {
                    $items = $raw | ConvertFrom-Json
                    foreach ($it in $items) {
                        Show-Toast -t $it.title -m $it.msg
                        Add-Content -Path $archive -Value ("[{0}] {1} | {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm'), $it.title, $it.msg) -Encoding UTF8
                    }
                    Remove-Item $mailbox -Force -ErrorAction SilentlyContinue
                } catch { }
            }
        }
        Start-Sleep -Milliseconds 1500
    }
}
else {
    Show-Toast -t $Title -m $Msg
    Start-Sleep -Seconds 6
    Cleanup
}
