# deploy-prod

git switch develop && git pull && git add -A && git commit -m "prod: ..." && git tag prod-v$(node -p "require('./package.json').version") && git push origin develop && git push origin prod-v$(node -p "require('./package.json').version")