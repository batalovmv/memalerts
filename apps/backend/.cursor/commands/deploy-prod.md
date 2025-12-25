# deploy-prod

# Production deploy теперь триггерится ТОЛЬКО тегом `prod-*` (self-hosted runner на VPS).
# Поэтому важно создать и запушить именно `prod-...`, а не `prod-v...`.
git switch develop && git pull && git add -A && git commit -m "prod: ..." && git tag prod-$(node -p "require('./package.json').version") && git push origin develop && git push origin prod-$(node -p "require('./package.json').version")