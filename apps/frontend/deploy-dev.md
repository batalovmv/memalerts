# deploy-dev

Жёсткое правило: **beta (dev) деплоится только из `main`**. После пуша в `main` создаём тег `beta-<version>` на тот же коммит — это “маркер”, что конкретная версия реально ушла в beta и может быть продвинута в прод.

> Не совершать других действий, строго и кратко.

```bash
cd "/mnt/c/Users/LOTAS/Desktop/Memalerts/memalerts-frontend"
```

```bash
git status
```

```bash
git add -A
```

```bash
git commit -m "chore: ..."
```

```bash
git push origin main
```

```bash
VERSION=$(node -p "require('./package.json').version")
```

```bash
git tag -a "beta-$VERSION" -m "beta $VERSION"
```

```bash
git push origin "beta-$VERSION"
```


