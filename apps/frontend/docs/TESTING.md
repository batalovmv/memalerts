# Testing

Цель: тесты должны ловить регрессии **до деплоя на VPS**, быть **стабильными** (без флаков) и быстрыми.

## Стек
- **Unit / integration**: Vitest + React Testing Library
- **Network mocks**: MSW (Node mode через `msw/node`)

E2E (Playwright) можно добавить следующим этапом, когда определим 3–5 критичных пользовательских сценариев.

## Как устроена конфигурация
- `vitest.config.ts`: запускает два проекта через `test.projects`: **web** и **overlay**
- `vitest.web.config.ts`: настройки web (alias `@` → `src/`)
- `overlay/vitest.config.ts`: настройки overlay

## Важные соглашения

### 1) Никаких реальных сетевых запросов в тестах
По умолчанию MSW настроен так, что **любой неожиданный запрос = ошибка**.
Это защищает от флака/случайных запросов в интернет.

- Web setup: `src/test/setup.ts` (MSW server + i18n)
- Overlay setup: `overlay/test/setup.ts`

Чтобы замокать запрос в конкретном тесте:
```ts
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';

server.use(
  http.get('/api/me', () => HttpResponse.json({ id: '1' })),
);
```

### 2) Для компонентов используем единый рендер-хелпер
`src/test/test-utils.tsx` экспортирует `renderWithProviders()`:
- `Provider` (Redux)
- `MemoryRouter` (роутинг)

Это делает тесты единообразными и упрощает миграции.

### 3) Куда класть тесты
Рекомендуем рядом с кодом, который тестируем:
- `src/shared/lib/foo.ts` → `src/shared/lib/foo.test.ts`
- `src/features/X/ui/Widget.tsx` → `src/features/X/ui/Widget.test.tsx`
- overlay: аналогично внутри `overlay/`

### 4) Что тестировать в первую очередь
- `shared/*` утилиты и конфиги (быстрые, много пользы)
- Redux slices (логика состояния)
- Критичные UI-паттерны (модалки/меню/табы) + a11y поведение
- API-обвязку (там уже есть нетривиальная логика: дедуп/304/глобальные события)

## CI на VPS
Тесты интегрированы в self-hosted workflows:
- `.github/workflows/ci-selfhosted-checks.yml` (PR checks)
- `.github/workflows/ci-cd-selfhosted.yml` (deploy beta/prod) — деплой происходит только после успешного прогона тестов


