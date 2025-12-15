# MemAlerts Backend

Express API с Socket.IO для Channel Points Mem Alerts - системы активации мемов через Twitch Channel Points.

## 📋 Описание

Backend API предоставляет:
- Twitch OAuth аутентификацию
- Обработку Twitch EventSub webhooks
- Управление пользователями, каналами и мемами
- Socket.IO для real-time коммуникации с overlay
- REST API для frontend приложений

## 🚀 Быстрый старт

### Требования

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- PostgreSQL >= 15

### Установка

```bash
# Установить зависимости
pnpm install
```

### Настройка

1. Создайте файл `.env` в корне проекта:

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/memalerts?schema=public"

# Server
PORT=3001
NODE_ENV=development

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d

# Twitch OAuth
TWITCH_CLIENT_ID=your-twitch-client-id
TWITCH_CLIENT_SECRET=your-twitch-client-secret
TWITCH_CALLBACK_URL=http://localhost:3001/auth/twitch/callback

# Twitch EventSub
TWITCH_EVENTSUB_SECRET=your-eventsub-secret-for-hmac-verification

# CORS
WEB_URL=http://localhost:5173
OVERLAY_URL=http://localhost:5174

# File Upload
MAX_FILE_SIZE=10485760
UPLOAD_DIR=./uploads
```

2. Создайте базу данных PostgreSQL:

```sql
CREATE DATABASE memalerts;
```

3. Примените схему базы данных:

```bash
pnpm db:push
```

### Запуск

```bash
# Development режим (с hot reload)
pnpm dev

# Production режим
pnpm build
pnpm start
```

## 📦 Команды

```bash
# Разработка
pnpm dev              # Запуск в dev режиме с hot reload

# Сборка
pnpm build            # Сборка TypeScript в JavaScript

# База данных
pnpm db:push          # Применить схему Prisma без миграций
pnpm db:migrate       # Создать и применить миграцию
pnpm db:seed          # Заполнить базу тестовыми данными
pnpm db:studio        # Открыть Prisma Studio (GUI для БД)

# Production
pnpm start            # Запуск собранного приложения
```

## 🏗️ Структура проекта

```
.
├── prisma/
│   ├── schema.prisma    # Prisma схема базы данных
│   └── seed.ts          # Скрипт для заполнения тестовыми данными
├── src/
│   ├── controllers/     # Контроллеры для обработки запросов
│   ├── middleware/      # Express middleware (auth, upload, rate limit)
│   ├── routes/          # Маршруты API
│   ├── socket/          # Socket.IO настройка
│   ├── lib/             # Утилиты (Prisma client)
│   ├── shared/          # Общие типы и Zod схемы
│   └── index.ts         # Точка входа приложения
├── uploads/             # Загруженные файлы (мемы)
└── dist/                # Собранный JavaScript код
```

## 🔌 API Endpoints

### Аутентификация

- `GET /auth/twitch` - Инициация Twitch OAuth
- `GET /auth/twitch/callback` - Callback от Twitch OAuth
- `POST /auth/logout` - Выход из системы

### Пользователь (требует авторизации)

- `GET /me` - Получить информацию о текущем пользователе
- `GET /wallet` - Получить баланс кошелька
- `GET /memes` - Получить список одобренных мемов
- `POST /memes/:id/activate` - Активировать мем

### Заявки на мемы (требует авторизации)

- `POST /submissions` - Создать заявку на мем (с загрузкой файла)
- `GET /submissions/mine` - Получить мои заявки

### Админ панель (требует роль streamer/admin)

- `GET /admin/submissions` - Получить заявки (с фильтром по статусу)
- `POST /admin/submissions/:id/approve` - Одобрить заявку
- `POST /admin/submissions/:id/reject` - Отклонить заявку
- `GET /admin/memes` - Получить все мемы
- `PATCH /admin/memes/:id` - Обновить мем
- `PATCH /admin/channel/settings` - Обновить настройки канала

### Webhooks

- `POST /webhooks/twitch/eventsub` - Webhook от Twitch EventSub

## 🔒 Безопасность

- JWT токены в httpOnly cookies
- CORS настроен только для разрешенных доменов
- Rate limiting на активацию мемов (1 раз в 3 секунды)
- Валидация всех входных данных через Zod
- HMAC проверка подписи EventSub webhooks
- Ограничения на размер и тип загружаемых файлов

## 🚢 Деплой

### С PM2

```bash
# Сборка
pnpm build

# Запуск с PM2
pm2 start dist/index.js --name memalerts-api

# Сохранение конфигурации PM2
pm2 save
pm2 startup
```

### С Docker (опционально)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

## 🔧 Настройка Twitch

1. Создайте приложение на https://dev.twitch.tv/console/apps
2. Получите Client ID и Client Secret
3. Добавьте Redirect URL: `http://your-domain.com/auth/twitch/callback`
4. Настройте EventSub подписку для `channel.channel_points_custom_reward_redemption.add`
5. Укажите полученные данные в `.env`

## 📝 Переменные окружения

См. раздел "Настройка" выше для полного списка переменных окружения.

## 🐛 Troubleshooting

### Ошибка подключения к базе данных

- Убедитесь, что PostgreSQL запущен
- Проверьте правильность `DATABASE_URL` в `.env`
- Убедитесь, что база данных `memalerts` создана

### EventSub не работает

- Убедитесь, что webhook URL публично доступен
- Проверьте, что `TWITCH_EVENTSUB_SECRET` совпадает с секретом в подписке
- Проверьте логи приложения

### Файлы не загружаются

- Убедитесь, что директория `uploads/` существует
- Проверьте права доступа к директории
- Проверьте `MAX_FILE_SIZE` в `.env`

## 📄 Лицензия

MIT
