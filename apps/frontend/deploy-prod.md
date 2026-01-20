# deploy-prod

> Не совершать других действий, строго и кратко.

```bash
git switch main
```

```bash
git pull
```

```bash
pnpm version patch --no-git-tag-version
```

```bash
git add package.json
```

```bash
git commit -m "prod: bump version"
```

```bash
git tag prod-$(node -p "require('./package.json').version")
```

```bash
git push origin main
```

```bash
git push origin prod-$(node -p "require('./package.json').version")
```


