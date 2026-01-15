# VK Video Live DevAPI — локальная шпаргалка (неофициальная)

Источник: [VK Video Live DevAPI docs](https://dev.live.vkvideo.ru/docs/index)

Этот документ собран в удобный “инженерный” формат по публичной документации VK Video Live DevAPI. Если что-то в API меняется — сверяйтесь с оригиналом.

## Оглавление

- [Базовые URL](#базовые-url)
- [Авторизация](#авторизация)
  - [Пользовательская авторизация: окно OAuth](#пользовательская-авторизация-окно-oauth)
  - [CodeFlow (server-side)](#codeflow-server-side)
  - [ImplicitFlow (browser-side)](#implicitflow-browser-side)
  - [Авторизация приложения](#авторизация-приложения)
  - [Отзыв токена (revoke)](#отзыв-токена-revoke)
  - [Заголовки авторизации](#заголовки-авторизации)
- [Методы: WebSocket](#методы-websocket)
- [Методы: Channel](#методы-channel)
- [Методы: Chat](#методы-chat)
- [Прочие разделы “Методы”](#прочие-разделы-методы)

## Базовые URL

- **Точка входа DevAPI (dev)**: `http://apidev.live.vkvideo.ru/` (как указано в документации) — см. [VK Video Live DevAPI docs](https://dev.live.vkvideo.ru/docs/index)
- **OAuth окно (user login)**: `https://auth.live.vkvideo.ru/app/oauth2/authorize` — см. [VK Video Live DevAPI docs](https://dev.live.vkvideo.ru/docs/index)
- **OAuth token endpoint**: `https://api.live.vkvideo.ru/oauth/server/token` — см. [VK Video Live DevAPI docs](https://dev.live.vkvideo.ru/docs/index)
- **OAuth revoke endpoint**: `https://api.live.vkvideo.ru/oauth/server/revoke` — см. [VK Video Live DevAPI docs](https://dev.live.vkvideo.ru/docs/index)

> В доках встречаются `http://api.live.vkvideo.ru/...` и `https://api.live.vkvideo.ru/...` — для production-логики ориентируйтесь на HTTPS.

## Авторизация

Документация описывает вызовы DevAPI:

- **от имени пользователя** (user token)
- **от имени приложения** (app secret / app token)

Уровень требуемой авторизации указан в конкретных методах. См. раздел “Авторизация” в доках: [VK Video Live DevAPI docs](https://dev.live.vkvideo.ru/docs/index)

### Пользовательская авторизация: окно OAuth

URL окна: `https://auth.live.vkvideo.ru/app/oauth2/authorize`

Query-параметры окна:

- **client_id** (required): идентификатор зарегистрированного приложения
- **redirect_uri** (required): редирект (должен совпадать с зарегистрированным в приложении “до символа”)
- **response_type** (optional): `code` (CodeFlow) или `token` (ImplicitFlow)
- **scope** (optional): список scope через запятую
- **state** (optional): произвольная строка приложения, возвращается обратно (обычно для CSRF/корреляции)

### CodeFlow (server-side)

Используется для взаимодействия с DevAPI с серверов разработчика.

**1) Пользователь логинится в окне OAuth**

- После успешной авторизации пользователь будет перенаправлен на `redirect_uri` с query-параметром **`code`**.

**2) Обмен `code` на токен**

`POST https://api.live.vkvideo.ru/oauth/server/token`

Параметры:

- **grant_type**: `authorization_code`
- **code**: код из query `code`
- **redirect_uri**: тот же `redirect_uri`, что использовался при получении `code`
- **Authorization (header)**: `Basic <base64(client_id:secret)>`
- **Content-Type (header)**: `application/x-www-form-urlencoded`

Ответ (JSON-поля):

- **access_token**: токен для вызова DevAPI
- **refresh_token**: токен для получения нового access_token без участия пользователя
- **expires_in**: TTL `access_token` (в секундах)
- **token_type**: всегда `Bearer`

**3) Обновление токена**

`POST https://api.live.vkvideo.ru/oauth/server/token`

Параметры:

- **grant_type**: `refresh_token`
- **refresh_token**: refresh токен, полученный на шаге (2)
- **redirect_uri**: тот же `redirect_uri`
- **Authorization (header)**: `Basic <base64(client_id:secret)>`
- **Content-Type (header)**: `application/x-www-form-urlencoded`

Ответ (JSON-поля) — аналогично выдаче токена:

- **access_token**
- **refresh_token**
- **expires_in**
- **token_type**

### ImplicitFlow (browser-side)

Используется для взаимодействия с DevAPI прямо из браузера.

После успешной авторизации пользователь будет перенаправлен на `redirect_uri`, где в hash-фрагменте будут параметры:

- **access_token**
- **state**
- **expire_time**: время окончания действия токена (в доках указано как Unix timestamp)
- **token_type**: всегда `Bearer`

Замечания (из доков):

- Нельзя продлить токен через `refresh_token` (он не выдаётся приложению в ImplicitFlow).
- На момент описания ограничений на использование методов DevAPI с таким токеном “нет”, но они могут появиться.
- На момент описания **невозможно получать WebHook события** при этом способе авторизации.

### Авторизация приложения

Поддерживаются 2 варианта:

- **Прямое использование секретного ключа** при вызове методов DevAPI (не рекомендуется).
- **Обмен секретного ключа на Bearer-токен** (ClientCredentials / app token).

**Вызов DevAPI с секретным ключом**

Заголовок:

- `Authorization: Basic <base64(client_id:secret)>`

> Важно из доков: **секрет нельзя использовать/передавать на клиент (браузер)**.

**ClientCredentials (получение Bearer токена приложения)**

`POST https://api.live.vkvideo.ru/oauth/server/token`

Параметры:

- **grant_type**: `client_credentials`
- **Authorization (header)**: `Basic <base64(client_id:secret)>`
- **Content-Type (header)**: `application/x-www-form-urlencoded`

Ответ (JSON-поля):

- **access_token**
- **state**
- **expire_time**: “время в секундах от момента выдачи токена” (как указано в доках)
- **token_type**: всегда `Bearer`

### Отзыв токена (revoke)

`POST https://api.live.vkvideo.ru/oauth/server/revoke`

Параметры:

- **token**: либо `access_token`, либо `refresh_token`
- **token_type_hint**: `access_token` или `refresh_token`
- **Authorization (header)**: `Basic <base64(client_id:secret)>`
- **Content-Type (header)**: `application/x-www-form-urlencoded`

Ответ: в доках указано, что при успехе отдаётся **пустой JSON-объект**.

### Заголовки авторизации

**От имени пользователя**

- `Authorization: Bearer <access_token>`

**От имени приложения (secret)**

- `Authorization: Basic <base64(client_id:secret)>`

## Методы: WebSocket

Оригинальный раздел: `https://dev.live.vkvideo.ru/docs/method/websocket`

### Получение токена для подписки на websocket-канал

- **HTTP**: `GET /v1/websocket/subscription_token`
- **Авторизация**: пользователь
- **Доступность**: все

Параметры:

- **channels** (query, string, optional): список имён ws-каналов через запятую

Ошибки (пример из доков):

- **401**:
  - `{"error":"unauthorized","error_description":"Not authorized"}`
- **403**:
  - `{"error":"forbidden","error_description":"Access to resource forbidden"}`

### Метод получения токена для подключения к pubsub сервису

- **HTTP**: `GET /v1/websocket/token`
- **Авторизация**: пользователь **или** приложение
- **Доступность**: все

Успешный ответ (пример): `{"data":{"token":"string"}}`

## Методы: Channel

Оригинальный раздел: `https://dev.live.vkvideo.ru/docs/method/channel`

### Получение информации о канале

- **HTTP**: `GET /v1/channel`
- **Авторизация**: пользователь, приложение
- **Доступность**: все

Параметры:

- **channel_url** (query, string, required): URL канала
- **with_source_urls** (query, boolean, optional): получить ссылки на видео-потоки
- **ip** (query, string, optional): IP клиента, для которого формируется ссылка

### Получение данных для проведения трансляции

- **HTTP**: `GET /v1/channel/credentials`
- **Авторизация**: пользователь
- **Доступность**: владелец канала
- **Разрешение**: `channel:credentials`

Параметры:

- **channel_url** (query, string, required): URL канала
- **slot_url** (query, string, optional): URL слота

Ответ (пример): `{"data":{"token":"string","url":"string"}}`

### Изменение параметров трансляции

- **HTTP**: `POST /v1/channel/stream/edit`
- **Авторизация**: пользователь
- **Доступность**: владелец канала
- **Разрешение**: `channel:stream:settings`

Query-параметры:

- **channel_url** (query, string, required): URL канала
- **slot_url** (query, string, optional): URL слота

Тело запроса (пример структуры из доков):

- `stream.category`:
  - `cover_url` (string)
  - `id` (string)
  - `title` (string)
  - `type` (string)
- `stream.planned_at` (number)
- `stream.title` (string)

### Получение основной информации о каналах, их авторах и текущем стриме

- **HTTP**: `POST /v1/channels`
- **Авторизация**: пользователь, приложение
- **Доступность**: все

Тело запроса (пример):

- `channels`: массив объектов `{ url: string }`

## Методы: Chat

Оригинальный раздел: `https://dev.live.vkvideo.ru/docs/method/chat`

### Получение детальной информации об участнике чата

- **HTTP**: `GET /v1/chat/member`
- **Авторизация**: пользователь, приложение
- **Доступность**: все

Параметры:

- **channel_url** (query, string, required)
- **user_id** (query, integer(int64), required): id пользователя

### Получение участников чата

- **HTTP**: `GET /v1/chat/members`
- **Авторизация**: пользователь, приложение
- **Доступность**: все

Параметры:

- **channel_url** (query, string, required)
- **limit** (query, integer(int64), required): количество пользователей (не более 200)

### Отправка сообщения в чат

- **HTTP**: `POST /v1/chat/message/send`
- **Авторизация**: пользователь
- **Доступность**: пользователь, удовлетворяющий настройкам чата
- **Разрешение**: `chat:message:send`

Query-параметры:

- **channel_url** (query, string, required)

Тело запроса (пример структуры из доков):

- `parts`: массив частей сообщения, где каждая часть может содержать:
  - `link.url` (string)
  - `mention.id` (number)
  - `smile.id` (string)
  - `text.content` (string)

### Получение сообщений из чата

- **HTTP**: `GET /v1/chat/messages`
- **Авторизация**: пользователь, приложение
- **Доступность**: все

Параметры:

- **channel_url** (query, string, required)
- **limit** (query, integer(int64), required): количество сообщений (не более 200)

### Получение настроек чата

- **HTTP**: `GET /v1/chat/settings`
- **Авторизация**: пользователь
- **Доступность**: владелец канала, модератор канала
- **Разрешение**: `chat:settings`

Параметры:

- **channel_url** (query, string, required)

### Изменение настроек чата

- **HTTP**: `POST /v1/chat/settings/edit`
- **Авторизация**: пользователь
- **Доступность**: владелец канала, модератор канала
- **Разрешение**: `chat:settings`

Тело запроса (пример структуры из доков):

- `chat_settings`:
  - `allow_access` (string)
  - `allow_access_after` (number)
  - `any_message_timeout` (number)
  - `follow_alert` (boolean)
  - `mode.general.*` (ограничения: caps/links/ru_en_numbers и т.п.)
  - `same_message_timeout` (number)
  - `subscription_alert` (boolean)

## Прочие разделы “Методы”

В оригинальной документации также есть отдельные разделы методов (смотрите левое меню “Методы”):

- `catalog`
- `category`
- `current_user`
- `channel_roles`
- `channel_points`
- `stream_records`
- `stream`
- `video`
- `token`

См. [VK Video Live DevAPI docs](https://dev.live.vkvideo.ru/docs/index).




















