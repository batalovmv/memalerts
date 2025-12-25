
<h1 id="api-vk-video-live--chat-">Чат (chat)</h1>

## Получение детальной информации об участнике чата

<a id="opIdVKPLDevAPIService_ChatMember"></a>

### Примеры кода

`GET /v1/chat/member`

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь, приложение | все |  |

<h3 id="получение-детальной-информации-об-участнике-чата-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`channel_url`|query|*string*|true|Url канала.|
|`user_id`|query|*integer(int64)*|true|Id пользователя.|

### Примеры ответов

#### 200 Ответ

```json
{
  "data": {
    "channel": {
      "status": "string",
      "url": "string"
    },
    "statistics": {
      "chat_messages_count": 0,
      "permanent_bans_count": 0,
      "temporary_bans_count": 0,
      "total_watched_time": 0
    },
    "user": {
      "avatar_url": "string",
      "badges": [
        {
          "achievement_name": "string",
          "id": "string",
          "large_url": "string",
          "medium_url": "string",
          "name": "string",
          "small_url": "string"
        }
      ],
      "id": 0,
      "is_moderator": true,
      "is_owner": true,
      "nick": "string",
      "nick_color": 0,
      "registered_at": 0,
      "roles": [
        {
          "id": "string",
          "large_url": "string",
          "medium_url": "string",
          "name": "string",
          "small_url": "string"
        }
      ]
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

<h3 id="получение-детальной-информации-об-участнике-чата-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Отдается при успешном запросе|[v1ChatMemberResponse](../schemas/chat#v1chatmemberresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

## Получение участников чата

<a id="opIdVKPLDevAPIService_ChatMembers"></a>

### Примеры кода

`GET /v1/chat/members`

Отдает пользователей, которые пишут в чат, либо смотрят стрим. 
(Отдает не более 200 пользователей).

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь, приложение | все |  |

<h3 id="получение-участников-чата-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`channel_url`|query|*string*|true|Url канала.|
|`limit`|query|*integer(int64)*|true|Количество запрашиваемых пользователей (Не более 200).|

### Примеры ответов

#### 200 Ответ

```json
{
  "data": {
    "users": [
      {
        "avatar_url": "string",
        "id": 0,
        "is_moderator": true,
        "is_owner": true,
        "nick": "string",
        "nick_color": 0
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

<h3 id="получение-участников-чата-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Отдается при успешном запросе|[v1ChatMembersResponse](../schemas/chat#v1chatmembersresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

## Отправка сообщения в чат

<a id="opIdVKPLDevAPIService_ChatMessageSend"></a>

### Примеры кода

`POST /v1/chat/message/send`

Отправка сообщений в чат канала

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь | пользователь, удовлетворяющий настройкам чата | chat:message:send |

### Тело запроса

```json
{
  "parts": [
    {
      "link": {
        "url": "string"
      },
      "mention": {
        "id": 0
      },
      "smile": {
        "id": "string"
      },
      "text": {
        "content": "string"
      }
    }
  ]
}
```

<h3 id="отправка-сообщения-в-чат-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`channel_url`|query|*string*|true|Url канала.|
|`stream_id`|query|*string*|true|Id трансляций.|
|`body`|body|*[v1ChatMessagesRequestData](../schemas/chat#v1chatmessagesrequestdata)*|true|Части сообщения.|

### Примеры ответов

#### 200 Ответ

```json
{}
```

> Ошибки данных

```json
{
  "error": "message_too_long",
  "error_description": "Text too long"
}
```

```json
{
  "error": "same_message",
  "error_description": "Message is the same"
}
```

```json
{
  "error": "send_too_fast",
  "error_description": "Sending messages too fast"
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

<h3 id="отправка-сообщения-в-чат-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|none|[v1ChatMessageSendResponse](../schemas/chat#v1chatmessagesendresponse)|
|400|[Bad Request](https://tools.ietf.org/html/rfc7231#section-6.5.1)|Ошибки данных|[v1HttpError](../schemas/http_error#v1httperror)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отправка сообщений в чат запрещена.|[v1HttpError](../schemas/http_error#v1httperror)|

## Получение сообщений из чата

<a id="opIdVKPLDevAPIService_ChatMessages"></a>

### Примеры кода

`GET /v1/chat/messages`

Получение сообщений из чата канала

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь, приложение | все |  |

<h3 id="получение-сообщений-из-чата-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`channel_url`|query|*string*|true|Url канала.|
|`limit`|query|*integer(int64)*|true|Количество запрашиваемых сообщений	 ( Не более 200 ).|

### Примеры ответов

#### 200 Ответ

```json
{
  "data": {
    "chat_messages": [
      {
        "author": {
          "avatar_url": "string",
          "badges": [
            {
              "achievement_name": "string",
              "id": "string",
              "large_url": "string",
              "medium_url": "string",
              "name": "string",
              "small_url": "string"
            }
          ],
          "id": 0,
          "is_moderator": true,
          "is_owner": true,
          "nick": "string",
          "nick_color": 0,
          "roles": [
            {
              "id": "string",
              "large_url": "string",
              "medium_url": "string",
              "name": "string",
              "small_url": "string"
            }
          ]
        },
        "created_at": 0,
        "id": 0,
        "is_private": true,
        "parts": [
          {
            "link": {
              "content": "string",
              "url": "string"
            },
            "mention": {
              "id": 0,
              "nick": "string"
            },
            "smile": {
              "animated": true,
              "id": "string",
              "large_url": "string",
              "medium_url": "string",
              "name": "string",
              "small_url": "string"
            },
            "text": {
              "content": "string"
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

<h3 id="получение-сообщений-из-чата-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Отдается при успешном запросе|[v1ChatMessagesResponse](../schemas/chat#v1chatmessagesresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

## Получение настроек чата

<a id="opIdVKPLDevAPIService_ChatSettings"></a>

### Примеры кода

`GET /v1/chat/settings`

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь | владелец канала, модератор канала | chat:settings |

<h3 id="получение-настроек-чата-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`channel_url`|query|*string*|true|Url канала.|

### Примеры ответов

#### 200 Ответ

```json
{
  "data": {
    "chat_settings": {
      "allow_access": "string",
      "allow_access_after": 0,
      "any_message_timeout": 0,
      "follow_alert": true,
      "mode": {
        "general": {
          "is_caps_prohibited": true,
          "is_links_prohibited": true,
          "is_ru_en_numbers": true
        },
        "only_smiles": {}
      },
      "same_message_timeout": 0,
      "subscription_alert": true
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

<h3 id="получение-настроек-чата-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Отдается при успешном запросе|[v1ChatSettingsResponse](../schemas/chat#v1chatsettingsresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

## Изменение настроек чата

<a id="opIdVKPLDevAPIService_ChatSettingsEdit"></a>

### Примеры кода

`POST /v1/chat/settings/edit`

| Авторизация | Доступность | Разрешения |
| ----- | ----------- | ----------- |
| пользователь | владелец канала, модератор канала | chat:settings |

### Тело запроса

```json
{
  "chat_settings": {
    "allow_access": "string",
    "allow_access_after": 0,
    "any_message_timeout": 0,
    "follow_alert": true,
    "mode": {
      "general": {
        "is_caps_prohibited": true,
        "is_links_prohibited": true,
        "is_ru_en_numbers": true
      },
      "only_smiles": {}
    },
    "same_message_timeout": 0,
    "subscription_alert": true
  }
}
```

<h3 id="изменение-настроек-чата-parameters">Параметры</h3>

|Имя параметра|Расположение|Формат|Обязательный|Описание|
|---|---|---|---|---|
|`channel_url`|query|*string*|false|Url канала.|
|`body`|body|*[v1ChatSettingsData](../schemas/chat#v1chatsettingsdata)*|true|Полезная нагрузка.|

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

<h3 id="изменение-настроек-чата-responses">Ответы</h3>

|Cтатус|Значение|Описание|Схема|
|---|---|---|---|
|200|[OK](https://tools.ietf.org/html/rfc7231#section-6.3.1)|Отдается при успешном запросе|[v1ChatSettingsEditResponse](../schemas/chat#v1chatsettingseditresponse)|
|401|[Unauthorized](https://tools.ietf.org/html/rfc7235#section-3.1)|Отдается при ошибке проверки авторизационных токенов|[v1HttpError](../schemas/http_error#v1httperror)|
|403|[Forbidden](https://tools.ietf.org/html/rfc7231#section-6.5.3)|Отдается, если текущий уровень авторизации недопускает данной операции|[v1HttpError](../schemas/http_error#v1httperror)|

