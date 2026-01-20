## API error contract

Любой **не-2xx** ответ API обязан иметь единый JSON shape:

```json
{
  "error": "Human readable message",
  "errorCode": "SOME_CODE",
  "details": { "optional": true },
  "requestId": "uuid-or-short-id",
  "traceId": "otel-trace-id"
}
```

### Поля

- **error**: человекочитаемое сообщение (можно показывать пользователю).
- **errorCode**: стабильный код для ветвления логики на фронте и для аналитики.
- **details** (optional): доп. контекст (без токенов/куки/секретов).
- **requestId**: корреляция в логах и в ответе (также дублируется заголовком `X-Request-Id`).
- **traceId**: OpenTelemetry trace id (если включена трассировка; иначе `null`).

### Где формируется

- **requestId** генерируется/прокидывается в `src/middleware/requestContext.ts`.
- Ответы `>=400` нормализуются в `src/middleware/errorResponseFormat.ts`.
- Исключения и `next(err)` ловятся в `src/middleware/errorHandler.ts`.

### Ключевые errorCode (часто используемые)

- **Auth**: `UNAUTHORIZED`, `SESSION_EXPIRED`, `ROLE_REQUIRED`, `FORBIDDEN`
- **CSRF**: `CSRF_INVALID`
- **Rate limit**: `RATE_LIMITED`
- **Upload/Submissions**: `FILE_TOO_LARGE`, `INVALID_FILE_TYPE`, `INVALID_FILE_CONTENT`, `VIDEO_TOO_LONG`, `TRANSCODE_FAILED`, `UPLOAD_TIMEOUT`, `UPLOAD_FAILED`
- **Submissions gating**: `STREAMER_SUBMISSIONS_DISABLED`, `ONLY_WHEN_LIVE`

### Rate limit headers

При ответе `429` API добавляет стандартные заголовки лимитов:

- `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
- Legacy-совместимость: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- `Retry-After` (секунды до следующей попытки)










