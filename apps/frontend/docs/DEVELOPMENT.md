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
pnpm build
pnpm build:overlay
```

## Полезные заметки
- **API**: единый клиент `src/lib/api.ts` возвращает `data` напрямую и имеет дедупликацию GET‑запросов.
- **Socket**: общий провайдер `src/contexts/SocketContext.tsx`.
- **Медиа‑URL**: используйте `resolveMediaUrl()` (`src/lib/urls.ts`) вместо ручной склейки строк.
- **Share links**: используйте `resolvePublicUrl()` (`src/lib/urls.ts`), чтобы не хардкодить домен.


