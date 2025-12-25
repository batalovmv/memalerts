
<h1 id="api-vk-video-live-websocket-websocket-">WebSocket (websocket)</h1>

## Получение токена для подписки на websocket-канал

<a id="opIdVKPLDevAPIService_WebSocketSubscriptionToken"></a>

### Примеры кода

`GET /v1/websocket/subscription_token`

Метод предназначен для получения токенов для подписки на ws-каналы.
Если метод не возвращает токен для какого либо из запрошенных 
каналов - значит доступ к каналу не может быть предоставлен 
данному пользователю.

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь | все |  |

<h3 id="получение-токена-для-подписки-на-websocket-канал-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`channels`|query|*string*|false|Список имен ws-каналов через запятую.|

### Примеры ответов

#### 200 Ответ

```json
{
  "data": {
    "channel_tokens": [
      {
        "channel": "string",
        "token": "string"
      }
    ]
  }
}
```

#### 401 Ответ

```json
{
  "error": "unauthorized",
  "error_description": "Not authorized"
}
```

#### 403 Ответ

```json
{
  "error": "forbidden",
  "error_description": "Access to resource forbidden"
}
```

<h3 id="получение-токена-для-подписки-на-websocket-канал-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Отдается при успешном запросе|[v1WebSocketSubscriptionTokenResponse](../schemas/websocket_token#v1websocketsubscriptiontokenresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

## Метод получения токена для подключения к pubsub сервису

<a id="opIdVKPLDevAPIService_WebSocketToken"></a>

### Примеры кода

`GET /v1/websocket/token`

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь, приложение | все |  |

### Примеры ответов

#### 200 Ответ

```json
{
  "data": {
    "token": "string"
  }
}
```

#### 401 Ответ

```json
{
  "error": "unauthorized",
  "error_description": "Not authorized"
}
```

#### 403 Ответ

```json
{
  "error": "forbidden",
  "error_description": "Access to resource forbidden"
}
```

<h3 id="метод-получения-токена-для-подключения-к-pubsub-сервису-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Отдается при успешном запросе|[v1WebSocketTokenResponse](../schemas/websocket_token#v1websockettokenresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

