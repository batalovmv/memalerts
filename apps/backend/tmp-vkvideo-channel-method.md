
<h1 id="api-vk-video-live--channel-">Канал (channel)</h1>

## Получение информации о канале

<a id="opIdVKPLDevAPIService_Channel"></a>

### Примеры кода

`GET /v1/channel`

Получение основной информации о канале, его авторе и текущем стриме

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь, приложение | все |  |

<h3 id="получение-информации-о-канале-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`channel_url`|query|*string*|true|Url канала.|
|`with_source_urls`|query|*boolean*|false|Получить ссылки на видео-потоки.|
|`ip`|query|*string*|false|ip адрес клиента, для которого формируется ссылка.|
|`user_agent`|query|*string*|false|user-agent клиента.|

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
    },
    "streams": [
      {
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

<h3 id="получение-информации-о-канале-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Отдается при успешном запросе|[v1ChannelResponse](../schemas/channel#v1channelresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

## Получение данных для проведения трансляции

<a id="opIdVKPLDevAPIService_ChannelCredentials"></a>

### Примеры кода

`GET /v1/channel/credentials`

Данный метод позволяет получить ссылку, на которую требуется 
отправлять rtmp-поток, а так же ключ трансляции

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь | владелец канала | channel:credentials |

<h3 id="получение-данных-для-проведения-трансляции-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`channel_url`|query|*string*|true|Url канала.|
|`slot_url`|query|*string*|false|Url слота.|

### Примеры ответов

#### 200 Ответ

```json
{
  "data": {
    "token": "string",
    "url": "string"
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

<h3 id="получение-данных-для-проведения-трансляции-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Отдается при успешном запросе|[v1ChannelCredentialsResponse](../schemas/channel#v1channelcredentialsresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

## Изменение параметров трансляции

<a id="opIdVKPLDevAPIService_ChannelStreamEdit"></a>

### Примеры кода

`POST /v1/channel/stream/edit`

Данный метод позволяет поменять параметры трансляции

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь | владелец канала | channel:stream:settings |

### Тело запроса

```json
{
  "stream": {
    "category": {
      "cover_url": "string",
      "id": "string",
      "title": "string",
      "type": "string"
    },
    "planned_at": 0,
    "title": "string"
  }
}
```

<h3 id="изменение-параметров-трансляции-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`channel_url`|query|*string*|true|Url канала.|
|`slot_url`|query|*string*|false|Url слота.|
|`body`|body|*[v1ChannelStreamEditRequestData](../schemas/channel#v1channelstreameditrequestdata)*|true|Параметры трансляции.|

### Примеры ответов

#### 200 Ответ

```json
{}
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

<h3 id="изменение-параметров-трансляции-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Отдается при успешном запросе|[v1ChannelStreamEditResponse](../schemas/channel#v1channelstreameditresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

## Получение основной информации о каналах, их авторах и текущем стриме

<a id="opIdVKPLDevAPIService_Channels"></a>

### Примеры кода

`POST /v1/channels`

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь, приложение | все |  |

### Тело запроса

```json
{
  "channels": [
    {
      "url": "string"
    }
  ]
}
```

<h3 id="получение-основной-информации-о-каналах,-их-авторах-и-текущем-стриме-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`body`|body|*[v1ChannelsRequestData](../schemas/channel#v1channelsrequestdata)*|true|Url канала.|

### Примеры ответов

#### 200 Ответ

```json
{
  "data": {
    "channels": [
      {
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
          "started_at": 0,
          "title": "string",
          "video_id": "string",
          "vk_video": {
            "owner_id": "string",
            "video_id": "string"
          }
        },
        "streams": [
          {
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
        ]
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

<h3 id="получение-основной-информации-о-каналах,-их-авторах-и-текущем-стриме-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|none|[v1ChannelsResponse](../schemas/channel#v1channelsresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

