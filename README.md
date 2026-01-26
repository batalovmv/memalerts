# MemAlerts

Платформа для активации мемов на стримах через channel points и другие механики.

> **AI-ассистентам**: Гайд автоматически загружается из `CLAUDE.md` / `AGENTS.md` / `.cursorrules`

## Структура

```
memalerts-monorepo/
├── apps/
│   ├── backend/          # Express API, Socket.IO, боты чатов
│   └── frontend/         # React SPA + OBS overlay
├── packages/
│   ├── api-contracts/    # Zod schemas для API (ЕДИНЫЙ ИСТОЧНИК ТИПОВ)
│   └── shared/           # Общие утилиты
├── CLAUDE.md             # Руководство для Claude Code (авто)
├── AGENTS.md             # Руководство для Codex (авто)
├── CODEX.md              # Альтернатива для Codex
├── .cursorrules          # Руководство для Cursor (авто)
└── ARCHITECTURE_REFACTORING_PLAN.md
```

## Быстрый старт

```bash
# Установка зависимостей
pnpm install

# Разработка
pnpm dev              # Все приложения
pnpm dev:backend      # Только backend
pnpm dev:frontend     # Только frontend

# Сборка
pnpm build
pnpm build:contracts  # Пересобрать api-contracts

# Тесты
pnpm --filter @memalerts/backend test
pnpm --filter @memalerts/frontend test
```

## Деплой

| Среда | Триггер | URL |
|-------|---------|-----|
| Beta | Push в `main` | beta.twitchmemes.ru |
| Production | Push тега `prod-*` | twitchmemes.ru |

```bash
# Создание production релиза
git tag prod-v1.2.3
git push origin prod-v1.2.3

# Проверка статуса
gh run list --limit 5
```

## Документация

### Для AI-ассистентов (одинаковый контент, разные форматы)
| Файл | AI | Авто-загрузка |
|------|----|---------------|
| `CLAUDE.md` | Claude Code | ✅ |
| `AGENTS.md` | Codex | ✅ |
| `.cursorrules` | Cursor | ✅ |

> **При изменении гайда** — обнови все 3 файла!

### Архитектура
- [Backend Architecture](./apps/backend/ARCHITECTURE.md)
- [Frontend Architecture](./apps/frontend/docs/ARCHITECTURE.md)
- [Refactoring Plan](./ARCHITECTURE_REFACTORING_PLAN.md)
