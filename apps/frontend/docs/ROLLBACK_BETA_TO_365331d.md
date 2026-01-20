### Откат беты на коммит `365331d` при CI/CD

Деплой беты описан в GitHub Actions: `.github/workflows/ci-cd-selfhosted.yml`.

Критично: job **`deploy-beta` запускается только на** `push` в ветку **`main`** (`if: github.event_name == 'push' && github.ref == 'refs/heads/main'`).

Также есть `workflow_dispatch`, но в текущем виде он **не запустит `deploy-beta`**, потому что `if` у job требует именно `push`.

---

## Вариант A (рекомендую): сделать новый коммит(ы) `git revert` и запустить обычный деплой

Плюсы: **без force-push**, прозрачная история, обычно лучший вариант для CI/CD.

### Шаги

1) Перейти на `main`:

```bash
git checkout main
```

2) Обновить её:

```bash
git pull
```

3) Откатить **все коммиты после** `365331d` (вернуть состояние `main` к `365331d` через revert-коммиты):

```bash
git revert 365331d..HEAD
```

4) Запушить в origin (**это и триггернёт деплой беты**):

```bash
git push
```

Если на шаге `git revert ...` будут конфликты — их придётся разрешить и продолжить:

```bash
git revert --continue
```

Отмена “полу-реверта”:

```bash
git revert --abort
```

---

## Вариант B: `reset --hard` + `push --force-with-lease`

Плюсы: быстро. Минусы: **переписывает историю**, может ломать параллельные работы.

### Шаги

1) Перейти на `main`:

```bash
git checkout main
```

2) Обновить refs:

```bash
git fetch --all --prune
```

3) Сдвинуть ветку на `365331d`:

```bash
git reset --hard 365331d
```

4) Перезаписать удалённую ветку (осторожно):

```bash
git push --force-with-lease
```

---

## Вариант C: redeploy конкретного SHA без изменения ветки (если CI это поддерживает)

В текущем workflow это **не поддерживается** для беты, потому что `deploy-beta` не запустится от `workflow_dispatch`.
Чтобы поддержать такой вариант, нужно менять `.github/workflows/ci-cd-selfhosted.yml` (например, убрать/расширить `if` у `deploy-beta`).


