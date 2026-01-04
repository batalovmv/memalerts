# deploy-prod

Жёсткое правило: **prod деплоится только из той же версии, которая уже ушла в beta**.
Технически это фиксируется тегом `beta-<version>` (см. `deploy-dev.md`).

> Не совершать других действий, строго и кратко.

```bash
cd "/mnt/c/Users/LOTAS/Desktop/Memalerts/memalerts-frontend"
```

```bash
git fetch origin main --tags --prune
```

```bash
git switch main
```

```bash
git pull --ff-only origin main
```

```bash
git status
```

```bash
node scripts/deploy/guard-prod-from-beta.mjs
```

```bash
VERSION=$(node -p "require('./package.json').version")
```

```bash
git tag -a "prod-$VERSION" -m "prod $VERSION"
```

```bash
git push origin "prod-$VERSION"
```


