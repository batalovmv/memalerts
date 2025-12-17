# Migration Scripts

## migrate-beta-to-production.ts

Скрипт для объединения данных из beta базы данных (`memalerts_beta`) в production базу данных (`memalerts`).

### Что делает скрипт:

1. **Объединяет пользователей** по `twitchUserId`:
   - Если пользователь существует в production - обновляет данные (displayName, profileImageUrl, hasBetaAccess)
   - Если пользователь не существует - создает нового пользователя

2. **Объединяет кошельки**:
   - Если кошелек существует для того же канала - суммирует балансы
   - Если кошелек не существует - создает новый

3. **Сохраняет историю транзакций**:
   - Мигрирует redemptions (если их еще нет в production)
   - Мигрирует activations (если их еще нет в production)

### Использование:

```bash
# На сервере, с доступом к обеим базам данных
cd /opt/memalerts-backend

# Установить переменные окружения
export DATABASE_URL="postgresql://memalerts_user:password@localhost:5432/memalerts?schema=public"
export DATABASE_URL_BETA="postgresql://memalerts_user:password@localhost:5432/memalerts_beta?schema=public"

# Запустить скрипт
pnpm migrate:beta-to-production
```

### Важно:

- Скрипт безопасен - он не удаляет данные, только добавляет/обновляет
- Дубликаты проверяются перед созданием (по twitchUserId для пользователей, по twitchRedemptionId для redemptions)
- Балансы кошельков суммируются, а не перезаписываются
- Скрипт можно запускать несколько раз - он идемпотентен

### После миграции:

После успешной миграции beta backend будет использовать ту же базу данных что и production (благодаря обновлению CI/CD), поэтому новые данные будут автоматически синхронизироваться.

