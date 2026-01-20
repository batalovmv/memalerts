# deploy-prod

# Production deploy теперь триггерится ТОЛЬКО тегом `prod-*` (self-hosted runner на VPS).
# Поэтому важно создать и запушить именно `prod-...`, а не `prod-v...`.
git switch main
git pull
pnpm version patch --no-git-tag-version
git add package.json
git commit -m "prod: bump version"
git tag prod-$(node -p "require('./package.json').version")
git push origin main
git push origin prod-$(node -p "require('./package.json').version")