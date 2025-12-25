
<h1 id="api-vk-video-live--stream-">Стрим (stream)</h1>

## Получение информации о стриме

<a id="opIdVKPLDevAPIService_Stream"></a>

### Примеры кода

`GET /v1/stream`

Получение основной информации о стриме

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь, приложение | все |  |

<h3 id="получение-информации-о-стриме-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`stream_id`|query|*string*|true|ID стрима.|
|`with_source_urls`|query|*boolean*|false|Получить ссылки на видео-потоки.|
|`ip`|query|*string*|false|IP адрес клиента, для которого формируется ссылка.|
|`user_agent`|query|*string*|false|User-Agent клиента.|

### Примеры ответов

#### 200 Ответ

```json
{
  "data": {
    "channel": {
      "avatar_url": "string",
      "counters": {
        "subscribers": 0
      },
      "cover_url": "string",
      "description": "string",
      "id": 0,
      "nick": "string",
      "nick_color": 0,
      "status": "string",
      "url": "string",
      "web_socket_channels": {
        "channel_points": "string",
        "chat": "string",
        "info": "string",
        "limited_chat": "string",
        "limited_private_chat": "string",
        "private_channel_points": "string",
        "private_chat": "string",
        "private_info": "string"
      }
    },
    "owner": {
      "avatar_url": "string",
      "external_profile_links": [
        {
          "id": "string",
          "type": "string"
        }
      ],
      "id": 0,
      "is_verified_streamer": true,
      "nick": "string",
      "nick_color": 0
    },
    "stream": {
      "category": {
        "cover_url": "string",
        "id": "string",
        "title": "string",
        "type": "string"
      },
      "counters": {
        "viewers": 0,
        "views": 0
      },
      "ended_at": 0,
      "id": "string",
      "preview_url": "string",
      "reactions": [
        {
          "count": 0,
          "type": "string"
        }
      ],
      "slot": {
        "id": 0,
        "url": "string"
      },
      "source_urls": [
        {
          "type": "string",
          "url": "string"
        }
      ],
      "started_at": 0,
      "status": "string",
      "title": "string",
      "video_id": "string",
      "vk_video": {
        "owner_id": "string",
        "video_id": "string"
      }
    }
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

<h3 id="получение-информации-о-стриме-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Отдается при успешном запросе|[v1StreamResponse](../schemas/stream#v1streamresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

