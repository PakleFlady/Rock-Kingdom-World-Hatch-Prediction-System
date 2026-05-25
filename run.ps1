$ErrorActionPreference = "Stop"

$pythonCandidates = @(
  "python",
  "py",
  "python3",
  "C:\Users\12396\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
)

$python = $null
foreach ($candidate in $pythonCandidates) {
  try {
    $command = Get-Command $candidate -ErrorAction Stop
    $python = $command.Source
    break
  } catch {
    if (Test-Path $candidate) {
      $python = $candidate
      break
    }
  }
}

if (-not $python) {
  Write-Host "没有找到 Python。请安装 Python 3.10+ 后再运行。" -ForegroundColor Red
  exit 1
}

& $python "$PSScriptRoot\app.py" @args
