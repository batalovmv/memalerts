param(
  [int]$AppPortA = 3003,
  [int]$AppPortB = 3004,
  [int]$ProxyPort = 3002,
  [int]$SigtermAfterMs = 7000,
  [switch]$SkipSeed
)

$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$tempDir = Join-Path $env:TEMP 'memalerts-rolling-restart'
New-Item -ItemType Directory -Force $tempDir | Out-Null

function Ensure-K6 {
  if ($env:K6_BIN -and (Test-Path $env:K6_BIN)) {
    return $env:K6_BIN
  }
  $k6Version = 'v0.49.0'
  $k6Zip = Join-Path $tempDir "k6-$k6Version-windows-amd64.zip"
  $k6Dir = Join-Path $tempDir "k6-$k6Version"
  $k6Exe = Join-Path $k6Dir 'k6.exe'
  if (-not (Test-Path $k6Exe)) {
    $url = "https://github.com/grafana/k6/releases/download/$k6Version/k6-$k6Version-windows-amd64.zip"
    Write-Host "Downloading k6 $k6Version..."
    Invoke-WebRequest -Uri $url -OutFile $k6Zip
    if (Test-Path $k6Dir) { Remove-Item $k6Dir -Recurse -Force }
    Expand-Archive -Path $k6Zip -DestinationPath $k6Dir
    $nested = Get-ChildItem -Path $k6Dir | Where-Object { $_.PSIsContainer } | Select-Object -First 1
    if ($nested) {
      $nestedExe = Join-Path $nested.FullName 'k6.exe'
      if (Test-Path $nestedExe) {
        Copy-Item -Path $nestedExe -Destination $k6Exe -Force
      }
    }
  }
  if (-not (Test-Path $k6Exe)) { throw "k6.exe not found at $k6Exe" }
  return $k6Exe
}

if (-not $SkipSeed) {
  Write-Host 'Running pnpm seed:perf (best-effort)...'
  & pnpm -s seed:perf
  if ($LASTEXITCODE -ne 0) {
    Write-Host "seed:perf failed (exit $LASTEXITCODE); continuing anyway"
  }
}

$loader = Join-Path $tempDir 'ts-loader.mjs'
@"
export async function resolve(specifier, context, defaultResolve) {
  if ((specifier.startsWith('.') || specifier.startsWith('/')) && specifier.endsWith('.js')) {
    const tsSpecifier = specifier.slice(0, -3) + '.ts';
    try {
      return await defaultResolve(tsSpecifier, context, defaultResolve);
    } catch {
      // fall through
    }
  }
  return defaultResolve(specifier, context, defaultResolve);
}
"@ | Set-Content -Path $loader -Encoding ASCII

$preload = Join-Path $tempDir 'emit-sigterm.mjs'
@"
const delay = Number(process.env.SIGTERM_AFTER_MS || '0');
if (Number.isFinite(delay) && delay > 0) {
  setTimeout(() => {
    process.emit('SIGTERM');
  }, delay);
}
"@ | Set-Content -Path $preload -Encoding ASCII

$loaderUrl = [Uri]::new($loader).AbsoluteUri
$preloadUrl = [Uri]::new($preload).AbsoluteUri

$outA = Join-Path $tempDir 'serverA.out.log'
$errA = Join-Path $tempDir 'serverA.err.log'
$outB = Join-Path $tempDir 'serverB.out.log'
$errB = Join-Path $tempDir 'serverB.err.log'
$proxyOut = Join-Path $tempDir 'proxy.out.log'
$proxyErr = Join-Path $tempDir 'proxy.err.log'

if (Test-Path $outA) { Remove-Item $outA -Force }
if (Test-Path $errA) { Remove-Item $errA -Force }
if (Test-Path $outB) { Remove-Item $outB -Force }
if (Test-Path $errB) { Remove-Item $errB -Force }
if (Test-Path $proxyOut) { Remove-Item $proxyOut -Force }
if (Test-Path $proxyErr) { Remove-Item $proxyErr -Force }

function Start-Server {
  param([int]$Port, [int]$SigtermMs, [string]$OutLog, [string]$ErrLog)
  $prevNodeEnv = $env:NODE_ENV
  $prevPort = $env:PORT
  $prevSigterm = $env:SIGTERM_AFTER_MS
  $env:NODE_ENV = 'test'
  $env:PORT = $Port
  if ($SigtermMs -gt 0) {
    $env:SIGTERM_AFTER_MS = $SigtermMs
  } else {
    if (Test-Path Env:SIGTERM_AFTER_MS) { Remove-Item Env:SIGTERM_AFTER_MS }
  }
  $args = @(
    '--experimental-transform-types',
    '--experimental-loader', $loaderUrl,
    '--import', $preloadUrl,
    'src/index.ts'
  ) -join ' '
  $proc = Start-Process -FilePath 'node' -ArgumentList $args -WorkingDirectory $repoRoot -NoNewWindow -PassThru -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog
  $env:NODE_ENV = $prevNodeEnv
  $env:PORT = $prevPort
  if ($null -ne $prevSigterm) { $env:SIGTERM_AFTER_MS = $prevSigterm } else { if (Test-Path Env:SIGTERM_AFTER_MS) { Remove-Item Env:SIGTERM_AFTER_MS } }
  return $proc
}

$serverA = $null
$serverB = $null
$proxy = $null

try {
  Write-Host "Starting server A on port $AppPortA (SIGTERM after $SigtermAfterMs ms)..."
  $serverA = Start-Server -Port $AppPortA -SigtermMs $SigtermAfterMs -OutLog $outA -ErrLog $errA

  Write-Host "Starting server B on port $AppPortB..."
  $serverB = Start-Server -Port $AppPortB -SigtermMs 0 -OutLog $outB -ErrLog $errB

  $upstreams = "http://localhost:$AppPortA,http://localhost:$AppPortB"
  $prevUpstreams = $env:UPSTREAMS
  $prevProxyPort = $env:PROXY_PORT
  $prevHealthInterval = $env:HEALTH_INTERVAL_MS
  $env:UPSTREAMS = $upstreams
  $env:PROXY_PORT = $ProxyPort
  $env:HEALTH_INTERVAL_MS = 200
  Write-Host "Starting proxy on port $ProxyPort..."
  $proxy = Start-Process -FilePath 'node' -ArgumentList 'tools/rolling-restart-proxy.mjs' -WorkingDirectory $repoRoot -NoNewWindow -PassThru -RedirectStandardOutput $proxyOut -RedirectStandardError $proxyErr
  if ($null -ne $prevUpstreams) { $env:UPSTREAMS = $prevUpstreams } else { if (Test-Path Env:UPSTREAMS) { Remove-Item Env:UPSTREAMS } }
  if ($null -ne $prevProxyPort) { $env:PROXY_PORT = $prevProxyPort } else { if (Test-Path Env:PROXY_PORT) { Remove-Item Env:PROXY_PORT } }
  if ($null -ne $prevHealthInterval) { $env:HEALTH_INTERVAL_MS = $prevHealthInterval } else { if (Test-Path Env:HEALTH_INTERVAL_MS) { Remove-Item Env:HEALTH_INTERVAL_MS } }

  $baseUrl = "http://localhost:$ProxyPort"
  $healthy = $false
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $resp = Invoke-WebRequest -Uri "$baseUrl/health" -UseBasicParsing -TimeoutSec 2
      if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $healthy) { throw 'Proxy did not become healthy' }

  function Test-Login {
    param([string]$Role, [string]$Slug)
    $body = @{ role = $Role }
    if ($Slug) { $body.channelSlug = $Slug }
    $json = $body | ConvertTo-Json
    return Invoke-RestMethod -Uri "$baseUrl/test/login" -Method Post -ContentType 'application/json' -Body $json
  }

  $streamerLogin = Test-Login -Role 'streamer' -Slug 'perf_test_channel'
  $viewerLogin = Test-Login -Role 'viewer' -Slug ''

  $streamerToken = $streamerLogin.token
  $viewerToken = $viewerLogin.token
  if (-not $streamerToken -or -not $viewerToken) { throw 'Missing token from /test/login' }
  $publicSlug = if ($streamerLogin.channel -and $streamerLogin.channel.slug) { $streamerLogin.channel.slug } else { 'perf_test_channel' }

  $env:BASE_URL = $baseUrl
  $env:STREAMER_COOKIE = "token=$streamerToken; token_beta=$streamerToken"
  $env:VIEWER_COOKIE = "token=$viewerToken; token_beta=$viewerToken"
  $env:PUBLIC_CHANNEL_SLUG = $publicSlug

  $k6Exe = Ensure-K6
  Write-Host 'Running k6 smoke test...'
  & $k6Exe run --duration 10s --vus 5 "$repoRoot\tests\load\smoke.k6.js"
  $k6Exit = $LASTEXITCODE

  $serverAExit = $null
  try {
    Wait-Process -Id $serverA.Id -Timeout 40 -ErrorAction Stop
    $serverA.Refresh()
    if ($serverA.HasExited) { $serverAExit = $serverA.ExitCode }
  } catch {
    $serverAExit = $null
  }

  Write-Host "K6_EXIT_CODE=$k6Exit"
  Write-Host "SERVER_A_EXIT_CODE=$serverAExit"
  Write-Host "Logs: $tempDir"
} finally {
  if ($serverA -and -not $serverA.HasExited) { Stop-Process -Id $serverA.Id -Force }
  if ($serverB -and -not $serverB.HasExited) { Stop-Process -Id $serverB.Id -Force }
  if ($proxy -and -not $proxy.HasExited) { Stop-Process -Id $proxy.Id -Force }
}
