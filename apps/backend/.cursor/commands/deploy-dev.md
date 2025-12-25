# deploy-dev

# PowerShell-friendly deploy helper (dev -> pushes `main` which deploys to beta)
# - avoids failing on "nothing to commit"
# - uses pull --rebase to keep history clean
# - generates a timestamped commit message
#
# If beta deploy fails with Prisma P3009 (failed migration blocks deploy), run on VPS:
#   ssh deploy@155.212.172.136
#   cd /opt/memalerts-backend-beta
#   pnpm prisma migrate status
#   # apply the intended SQL manually (or fix the DB), then mark the failed migration as applied:
#   pnpm prisma migrate resolve --applied 20251225000001_add_vkvideo_roles_and_subscription_user
#   pnpm prisma migrate deploy
#   pm2 restart memalerts-api-beta

# Optional preflight: check beta migrations BEFORE pushing (catches P3009 early).
# - Set SKIP_BETA_PREFLIGHT=1 to skip.
if (-not $env:SKIP_BETA_PREFLIGHT) {
  try {
    Write-Host "Preflight: checking beta migrations on VPS..."
    $status = ssh deploy@155.212.172.136 "cd /opt/memalerts-backend-beta && pnpm -s prisma migrate status" 2>&1
    if ($LASTEXITCODE -ne 0) {
      if ($status -match "Following migration have failed|migrations have failed|P3009|failed migrations") {
        Write-Host ""
        Write-Host "Blocked: beta database has FAILED Prisma migrations (P3009). Fix it first, then re-run deploy-dev." -ForegroundColor Red
        Write-Host "See: .cursor/commands/rule-no-stuck.md" -ForegroundColor Yellow
        Write-Host ""
        Write-Host $status
        exit 1
      } else {
        Write-Warning "Preflight SSH check failed (continuing anyway). Output: $status"
      }
    }
  } catch {
    Write-Warning "Preflight SSH check threw an exception (continuing anyway): $_"
  }
}

git switch main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git pull --rebase
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git add -A
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "No staged changes — nothing to commit."
  exit 0
}

$msg = "dev: deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
git commit -m $msg
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git push origin main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }