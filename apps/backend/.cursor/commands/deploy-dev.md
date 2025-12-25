# deploy-dev

# PowerShell-friendly deploy helper (dev -> pushes `main` which deploys to beta)
# - avoids failing on "nothing to commit"
# - uses pull --rebase to keep history clean
# - generates a timestamped commit message

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