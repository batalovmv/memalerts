# Development

## Требования
- Node.js >= 18 (в CI используется Node 20)
- pnpm >= 8

## Установка
```bash
pnpm install
```

## Запуск
```bash
pnpm dev
```
Или отдельно:
```bash
pnpm dev:web      # http://localhost:5173
pnpm dev:overlay  # http://localhost:5174
```

## ENV (локально)
В dev окружении backend URL задаётся через `VITE_API_URL`:
- корень проекта: `.env`
- overlay: `overlay/.env`

Пример:
```env
VITE_API_URL=http://localhost:3001
```

Важно:
- В production/beta URL окружения берётся из `GET /config.json` (см. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)), а не из build‑time env.

## Линт и сборка
```bash
pnpm lint
pnpm typecheck
pnpm build:web
pnpm build:overlay
```

## Полезные заметки
- **API**: клиент `src/lib/api.ts` возвращает `data` напрямую и имеет дедупликацию GET‑запросов. Для приведения ошибок к единому виду используйте `toApiError()` (`src/shared/api/toApiError.ts`).
- **Socket**: общий провайдер `src/contexts/SocketContext.tsx`.
- **Медиа‑URL**: используйте `resolveMediaUrl()` (`src/shared/config/urls.ts`, реэкспорт: `src/lib/urls.ts`) вместо ручной склейки строк.
- **Share links**: используйте `resolvePublicUrl()` (там же), чтобы не хардкодить домен.


