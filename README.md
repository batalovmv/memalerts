# MemAlerts

Платформа для активации мемов на стримах через channel points.

## Структура

```
apps/
├── backend/    # Express API, Socket.IO, боты чатов
└── frontend/   # React SPA, OBS overlay

packages/
└── shared/     # Общие типы и утилиты (TODO)
```

## Разработка

### Установка зависимостей
```bash
pnpm install
```

### Запуск в dev режиме
```bash
# Все приложения
pnpm dev

# Только backend
pnpm dev:backend

# Только frontend
pnpm dev:frontend
```

### Сборка
```bash
pnpm build
```

## Деплой

- **Beta**: push в `main` — автодеплой на beta.twitchmemes.ru
- **Production**: push тега `prod-*` — автодеплой на twitchmemes.ru

См. `.github/workflows/` для деталей CI/CD.
