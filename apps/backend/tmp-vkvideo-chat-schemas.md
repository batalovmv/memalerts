<h1 id="api-vk-video-live--chat-">Чат</h1>

## v1Badge
<!-- backwards compatibility -->
<a id="schemav1badge"></a>
<a id="schema_v1Badge"></a>
<a id="tocSv1badge"></a>
<a id="tocsv1badge"></a>

Данные по значкам

```json
{
  "achievement_name": "string",
  "id": "string",
  "large_url": "string",
  "medium_url": "string",
  "name": "string",
  "small_url": "string"
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|achievement_name|string|true|Достижение, за которое выдан значок (Некоторая мнемоника. Например, owner, verified_streamer, subscription_01).|
|id|string|true|Id значка.|
|large_url|string|true|Ссылка на большое изображение.|
|medium_url|string|true|Ссылка на среднее изображение.|
|name|string|true|Название значака (Может быть пустым. Задается только для пользовательских значков).|
|small_url|string|true|Ссылка на маленькое изображение.|

## v1ChatMemberChannelData
<!-- backwards compatibility -->
<a id="schemav1chatmemberchanneldata"></a>
<a id="schema_v1ChatMemberChannelData"></a>
<a id="tocSv1chatmemberchanneldata"></a>
<a id="tocsv1chatmemberchanneldata"></a>

Данные канала пользователя

```json
{
  "status": "string",
  "url": "string"
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|status|string|false|none|
|url|string|false|none|

## v1ChatMemberResponse
<!-- backwards compatibility -->
<a id="schemav1chatmemberresponse"></a>
<a id="schema_v1ChatMemberResponse"></a>
<a id="tocSv1chatmemberresponse"></a>
<a id="tocsv1chatmemberresponse"></a>

Получение детальной информации об участнике чата.
Ответ

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

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|data|[v1ChatMemberResponseData](../schemas/chat#v1chatmemberresponsedata)|false|none|

## v1ChatMemberResponseData
<!-- backwards compatibility -->
<a id="schemav1chatmemberresponsedata"></a>
<a id="schema_v1ChatMemberResponseData"></a>
<a id="tocSv1chatmemberresponsedata"></a>
<a id="tocsv1chatmemberresponsedata"></a>

Данные с информацией по участнику чата

```json
{
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

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|channel|[v1ChatMemberChannelData](../schemas/chat#v1chatmemberchanneldata)|false|none|
|statistics|[v1ChatMemberStatistics](../schemas/chat#v1chatmemberstatistics)|true|none|
|user|[v1ChatMemberUserData](../schemas/chat#v1chatmemberuserdata)|true|none|

## v1ChatMemberStatistics
<!-- backwards compatibility -->
<a id="schemav1chatmemberstatistics"></a>
<a id="schema_v1ChatMemberStatistics"></a>
<a id="tocSv1chatmemberstatistics"></a>
<a id="tocsv1chatmemberstatistics"></a>

Данные статистики пользователя на канале

```json
{
  "chat_messages_count": 0,
  "permanent_bans_count": 0,
  "temporary_bans_count": 0,
  "total_watched_time": 0
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|chat_messages_count|integer(int64)|true|Количество сообщений написанных в чат за все время	.|
|permanent_bans_count|integer(int64)|true|Количество постоянных банов за все время.|
|temporary_bans_count|integer(int64)|true|Количество временных банов за все время.|
|total_watched_time|integer(int64)|true|Суммарное время просмотра канала пользователем (В секундах).|

## v1ChatMemberUserData
<!-- backwards compatibility -->
<a id="schemav1chatmemberuserdata"></a>
<a id="schema_v1ChatMemberUserData"></a>
<a id="tocSv1chatmemberuserdata"></a>
<a id="tocsv1chatmemberuserdata"></a>

Данные пользователя

```json
{
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

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|avatar_url|string|false|Ссылка на аватарку пользователя .|
|badges|[[v1Badge](../schemas/chat#v1badge)]|true|Значки пользователя.|
|id|integer(int64)|true|Id владельца канала.|
|is_moderator|boolean|true|Модератор канала.|
|is_owner|boolean|true|Владелец канала.|
|nick|string|true|Ник владельца канала.|
|nick_color|integer(int64)|true|Номер цвета владельца канала из палитры (Число от 0 до 15).|
|registered_at|integer(int64)|true|Время регистрации пользователя на площадке.|
|roles|[[v1ChannelRole](../schemas/channel_roles#v1channelrole)]|true|Роли пользователя на канале.|

## v1ChatMembersData
<!-- backwards compatibility -->
<a id="schemav1chatmembersdata"></a>
<a id="schema_v1ChatMembersData"></a>
<a id="tocSv1chatmembersdata"></a>
<a id="tocsv1chatmembersdata"></a>

Список пользователей

```json
{
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

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|users|[[v1ChatMembersUserData](../schemas/chat#v1chatmembersuserdata)]|true|Список пользователей.|

## v1ChatMembersResponse
<!-- backwards compatibility -->
<a id="schemav1chatmembersresponse"></a>
<a id="schema_v1ChatMembersResponse"></a>
<a id="tocSv1chatmembersresponse"></a>
<a id="tocsv1chatmembersresponse"></a>

Получение участников чата.
Ответ

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

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|data|[v1ChatMembersData](../schemas/chat#v1chatmembersdata)|false|none|

## v1ChatMembersUserData
<!-- backwards compatibility -->
<a id="schemav1chatmembersuserdata"></a>
<a id="schema_v1ChatMembersUserData"></a>
<a id="tocSv1chatmembersuserdata"></a>
<a id="tocsv1chatmembersuserdata"></a>

Данные Пользователя

```json
{
  "avatar_url": "string",
  "id": 0,
  "is_moderator": true,
  "is_owner": true,
  "nick": "string",
  "nick_color": 0
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|avatar_url|string|false|Ссылка на аватарку пользователя .|
|id|integer(int64)|true|Id владельца канала.|
|is_moderator|boolean|true|Модератор канала.|
|is_owner|boolean|true|Владелец канала.|
|nick|string|true|Ник владельца канала.|
|nick_color|integer(int64)|true|Номер цвета владельца канала из палитры (Число от 0 до 15).|

## v1ChatMessageContent
<!-- backwards compatibility -->
<a id="schemav1chatmessagecontent"></a>
<a id="schema_v1ChatMessageContent"></a>
<a id="tocSv1chatmessagecontent"></a>
<a id="tocsv1chatmessagecontent"></a>

Каждый part содержит в себе один из следующих объектов

```json
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

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|link|[v1ContentLink](../schemas/chat#v1contentlink)|false|none|
|mention|[v1ContentMention](../schemas/chat#v1contentmention)|false|none|
|smile|[v1ContentSmile](../schemas/chat#v1contentsmile)|false|none|
|text|[v1ContentText](../schemas/chat#v1contenttext)|false|none|

## v1ChatMessageRequestContent
<!-- backwards compatibility -->
<a id="schemav1chatmessagerequestcontent"></a>
<a id="schema_v1ChatMessageRequestContent"></a>
<a id="tocSv1chatmessagerequestcontent"></a>
<a id="tocsv1chatmessagerequestcontent"></a>

Каждый part содержит в себе один из следующих объектов

```json
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

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|link|[v1ContentRequestLink](../schemas/chat#v1contentrequestlink)|false|none|
|mention|[v1ContentRequestMention](../schemas/chat#v1contentrequestmention)|false|none|
|smile|[v1ContentRequestSmile](../schemas/chat#v1contentrequestsmile)|false|none|
|text|[v1ContentRequestText](../schemas/chat#v1contentrequesttext)|false|none|

## v1ChatMessageSendResponse
<!-- backwards compatibility -->
<a id="schemav1chatmessagesendresponse"></a>
<a id="schema_v1ChatMessageSendResponse"></a>
<a id="tocSv1chatmessagesendresponse"></a>
<a id="tocsv1chatmessagesendresponse"></a>

Отправка сообщения в чат.
Ответ

```json
{}

```

### Свойства

*None*

## v1ChatMessagesData
<!-- backwards compatibility -->
<a id="schemav1chatmessagesdata"></a>
<a id="schema_v1ChatMessagesData"></a>
<a id="tocSv1chatmessagesdata"></a>
<a id="tocsv1chatmessagesdata"></a>

Части сообщения

```json
{
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

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|parts|[[v1ChatMessageContent](../schemas/chat#v1chatmessagecontent)]|true|none|

## v1ChatMessagesRequestData
<!-- backwards compatibility -->
<a id="schemav1chatmessagesrequestdata"></a>
<a id="schema_v1ChatMessagesRequestData"></a>
<a id="tocSv1chatmessagesrequestdata"></a>
<a id="tocsv1chatmessagesrequestdata"></a>

Части сообщения

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

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|parts|[[v1ChatMessageRequestContent](../schemas/chat#v1chatmessagerequestcontent)]|true|none|

## v1ChatMessagesResponse
<!-- backwards compatibility -->
<a id="schemav1chatmessagesresponse"></a>
<a id="schema_v1ChatMessagesResponse"></a>
<a id="tocSv1chatmessagesresponse"></a>
<a id="tocsv1chatmessagesresponse"></a>

Получение сообщений из чата канала.
Ответ

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

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|data|[v1MessageData](../schemas/chat#v1messagedata)|false|none|

## v1ChatMode
<!-- backwards compatibility -->
<a id="schemav1chatmode"></a>
<a id="schema_v1ChatMode"></a>
<a id="tocSv1chatmode"></a>
<a id="tocsv1chatmode"></a>

```json
{
  "general": {
    "is_caps_prohibited": true,
    "is_links_prohibited": true,
    "is_ru_en_numbers": true
  },
  "only_smiles": {}
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|general|[v1ChatModeGeneral](../schemas/chat#v1chatmodegeneral)|false|none|
|only_smiles|[v1ChatModeOnlySmiles](../schemas/chat#v1chatmodeonlysmiles)|false|none|

## v1ChatModeGeneral
<!-- backwards compatibility -->
<a id="schemav1chatmodegeneral"></a>
<a id="schema_v1ChatModeGeneral"></a>
<a id="tocSv1chatmodegeneral"></a>
<a id="tocsv1chatmodegeneral"></a>

```json
{
  "is_caps_prohibited": true,
  "is_links_prohibited": true,
  "is_ru_en_numbers": true
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|is_caps_prohibited|boolean|false|Запрещен капс (будет автоматом применен LC)  .|
|is_links_prohibited|boolean|false|Запрещены ссылки.|
|is_ru_en_numbers|boolean|false|Разрешены только числа/буквы (/^[A-Za-zа-яА-ЯёЁ0-9\-\_\.\,\s]*$/) .|

## v1ChatModeOnlySmiles
<!-- backwards compatibility -->
<a id="schemav1chatmodeonlysmiles"></a>
<a id="schema_v1ChatModeOnlySmiles"></a>
<a id="tocSv1chatmodeonlysmiles"></a>
<a id="tocsv1chatmodeonlysmiles"></a>

```json
{}

```

### Свойства

*None*

## v1ChatSettings
<!-- backwards compatibility -->
<a id="schemav1chatsettings"></a>
<a id="schema_v1ChatSettings"></a>
<a id="tocSv1chatsettings"></a>
<a id="tocsv1chatsettings"></a>

Настройки чата

```json
{
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

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|allow_access|string|true|Сообщения могут отправлять:<br>subscribers - все подписчики,<br>paid_subscribers - платные подписчики,<br>any - все пользователи.|
|allow_access_after|integer(int64)|true|Через какое время, бесплатный подписчик может писать в чат.|
|any_message_timeout|integer(int64)|true|Минимальный интервал между отправками сообщений одним пользователем.|
|follow_alert|boolean|true|Сообщать о новых бесплатных подписчиках в чат.|
|mode|[v1ChatMode](../schemas/chat#v1chatmode)|false|none|
|same_message_timeout|integer(int64)|true|Минимальный интервал между отправками одинаковых сообщений одним пользователем.|
|subscription_alert|boolean|true|Сообщать о новых платных подписчиках в чат.|

## v1ChatSettingsData
<!-- backwards compatibility -->
<a id="schemav1chatsettingsdata"></a>
<a id="schema_v1ChatSettingsData"></a>
<a id="tocSv1chatsettingsdata"></a>
<a id="tocsv1chatsettingsdata"></a>

Данные с настройками

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

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|chat_settings|[v1ChatSettings](../schemas/chat#v1chatsettings)|true|none|

## v1ChatSettingsEditResponse
<!-- backwards compatibility -->
<a id="schemav1chatsettingseditresponse"></a>
<a id="schema_v1ChatSettingsEditResponse"></a>
<a id="tocSv1chatsettingseditresponse"></a>
<a id="tocsv1chatsettingseditresponse"></a>

Изменение настроек чата.
Ответ

```json
{}

```

### Свойства

*None*

## v1ChatSettingsResponse
<!-- backwards compatibility -->
<a id="schemav1chatsettingsresponse"></a>
<a id="schema_v1ChatSettingsResponse"></a>
<a id="tocSv1chatsettingsresponse"></a>
<a id="tocsv1chatsettingsresponse"></a>

Получение настроек чата.
Ответ

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

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|data|[v1ChatSettingsData](../schemas/chat#v1chatsettingsdata)|false|none|

## v1ContentLink
<!-- backwards compatibility -->
<a id="schemav1contentlink"></a>
<a id="schema_v1ContentLink"></a>
<a id="tocSv1contentlink"></a>
<a id="tocsv1contentlink"></a>

Ссылка

```json
{
  "content": "string",
  "url": "string"
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|content|string|true|Текст, который отображается пользователю.|
|url|string|true|Ссылка для перехода.|

## v1ContentMention
<!-- backwards compatibility -->
<a id="schemav1contentmention"></a>
<a id="schema_v1ContentMention"></a>
<a id="tocSv1contentmention"></a>
<a id="tocsv1contentmention"></a>

Упоминание

```json
{
  "id": 0,
  "nick": "string"
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|id|integer(int32)|true|Id упомянутого пользователя.|
|nick|string|true|Ник упомянутого пользователя.|

## v1ContentRequestLink
<!-- backwards compatibility -->
<a id="schemav1contentrequestlink"></a>
<a id="schema_v1ContentRequestLink"></a>
<a id="tocSv1contentrequestlink"></a>
<a id="tocsv1contentrequestlink"></a>

Ссылка

```json
{
  "url": "string"
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|url|string|true|Ссылка для перехода.|

## v1ContentRequestMention
<!-- backwards compatibility -->
<a id="schemav1contentrequestmention"></a>
<a id="schema_v1ContentRequestMention"></a>
<a id="tocSv1contentrequestmention"></a>
<a id="tocsv1contentrequestmention"></a>

Упоминание

```json
{
  "id": 0
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|id|integer(int32)|true|Id упомянутого пользователя.|

## v1ContentRequestSmile
<!-- backwards compatibility -->
<a id="schemav1contentrequestsmile"></a>
<a id="schema_v1ContentRequestSmile"></a>
<a id="tocSv1contentrequestsmile"></a>
<a id="tocsv1contentrequestsmile"></a>

Смайлик

```json
{
  "id": "string"
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|id|string|true|Id смайлика.|

## v1ContentRequestText
<!-- backwards compatibility -->
<a id="schemav1contentrequesttext"></a>
<a id="schema_v1ContentRequestText"></a>
<a id="tocSv1contentrequesttext"></a>
<a id="tocsv1contentrequesttext"></a>

Текст

```json
{
  "content": "string"
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|content|string|true|Текст сообщения.|

## v1ContentSmile
<!-- backwards compatibility -->
<a id="schemav1contentsmile"></a>
<a id="schema_v1ContentSmile"></a>
<a id="tocSv1contentsmile"></a>
<a id="tocsv1contentsmile"></a>

Смайлик

```json
{
  "animated": true,
  "id": "string",
  "large_url": "string",
  "medium_url": "string",
  "name": "string",
  "small_url": "string"
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|animated|boolean|true|Признак анимированного смайлика.|
|id|string|true|Id смайлика.|
|large_url|string|true|Ссылка на большое изображение.|
|medium_url|string|true|Ссылка на среднее изображение.|
|name|string|true|Название смайлика.|
|small_url|string|true|Ссылка на маленькое изображение.|

## v1ContentText
<!-- backwards compatibility -->
<a id="schemav1contenttext"></a>
<a id="schema_v1ContentText"></a>
<a id="tocSv1contenttext"></a>
<a id="tocsv1contenttext"></a>

Текст

```json
{
  "content": "string"
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|content|string|true|Текст сообщения.|

## v1Message
<!-- backwards compatibility -->
<a id="schemav1message"></a>
<a id="schema_v1Message"></a>
<a id="tocSv1message"></a>
<a id="tocsv1message"></a>

Сообщение

```json
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

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|author|[v1UserData](../schemas/chat#v1userdata)|true|none|
|created_at|integer(int64)|true|Время создания сообщения	(unix timestamp).|
|id|integer(int32)|true|Id сообщения.|
|is_private|boolean|true|Приватность сообщения (Сообщение видно только пользователю, от лица которого осуществлен запрос).|
|parts|[[v1ChatMessageContent](../schemas/chat#v1chatmessagecontent)]|true|Части сообщения.|

## v1MessageData
<!-- backwards compatibility -->
<a id="schemav1messagedata"></a>
<a id="schema_v1MessageData"></a>
<a id="tocSv1messagedata"></a>
<a id="tocsv1messagedata"></a>

Даннные сообщения

```json
{
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

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|chat_messages|[[v1Message](../schemas/chat#v1message)]|true|Список сообщений.|

## v1UserData
<!-- backwards compatibility -->
<a id="schemav1userdata"></a>
<a id="schema_v1UserData"></a>
<a id="tocSv1userdata"></a>
<a id="tocsv1userdata"></a>

Данные по пользователю

```json
{
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
}

```

### Свойства

|Имя параметра|Тип|Обязательный|Описание|
|---|---|---|---|
|avatar_url|string|false|Ссылка на аватарку пользователя .|
|badges|[[v1Badge](../schemas/chat#v1badge)]|true|Значки пользователя.|
|id|integer(int32)|true|Id владельца канала.|
|is_moderator|boolean|true|Модератор канала.|
|is_owner|boolean|true|Владелец канала.|
|nick|string|true|Ник владельца канала.|
|nick_color|integer(int32)|true|Номер цвета владельца канала из палитры.|
|roles|[[v1ChannelRole](../schemas/channel_roles#v1channelrole)]|true|Роли пользователя на канале.|

