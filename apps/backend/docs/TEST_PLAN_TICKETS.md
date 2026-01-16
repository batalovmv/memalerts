# 🧪 MemAlerts Backend — План тестирования

> **Цель**: довести покрытие кода тестами с 13% до 80%+
>
> **Текущее состояние**: 6,665 / 50,427 линий покрыто (13.21%)
>
> **Ориентировочно**: ~100-120 новых тестов

---

## 📋 Как работать с этим документом

1. Каждый тикет — отдельная задача, которую можно взять в работу
2. Тикеты сгруппированы по фазам (приоритет убывает)
3. Перед началом работы прочитать `docs/TESTING.md`
4. Использовать фабрики из `tests/factories/` — не делать прямые `prisma.*.create`
5. Использовать существующие моки из `tests/mocks/`
6. После написания тестов проверить локально: `pnpm test`

---

## 🔑 Общие требования ко всем тестам

- [ ] Тест изолирован (не зависит от порядка выполнения)
- [ ] Используются фабрики для создания тестовых данных
- [ ] Мокируются внешние сервисы (Twitch, YouTube и т.д.)
- [ ] Проверяется как happy path, так и error cases
- [ ] Проверяются security invariants (см. `docs/TESTING.md`)
- [ ] Тест проходит локально перед коммитом

---

# ФАЗА 1: Критические бизнес-потоки

> **Приоритет**: 🔴 ВЫСОКИЙ
>
> **Цель фазы**: покрытие 40%

---

## TICKET-001: Viewer Activation Flow

**Компонент**: `src/controllers/viewer/activation.ts`, `src/services/meme/activateMeme.ts`

**Описание**:
Протестировать полный flow активации мема — от запроса до Socket.IO события.

**Файл теста**: `tests/viewerActivation.test.ts`

**Что тестировать**:
- [x] Успешная активация мема с достаточным балансом
- [x] Отклонение при недостаточном балансе
- [x] Отклонение для неактивного/удалённого мема
- [x] Списание правильной суммы с учётом промо
- [x] Создание `MemeActivation` со статусом `queued`
- [x] Socket.IO emit `activation:new` в комнату `channel:{slug}`
- [x] Socket.IO emit `wallet:updated` в комнату `user:{userId}`
- [x] Проверка что `wallet:updated` НЕ идёт в `channel:*` (privacy)
- [x] Idempotency — повторный запрос с тем же ключом не списывает дважды

**Acceptance Criteria**:
```
✅ Все сценарии покрыты
✅ Проверена изоляция wallet:updated (только user room)
✅ Проверена работа с промо-ценами
```

**Примерная сложность**: 4-6 часов

---

## TICKET-002: Wallet Service

**Компонент**: `src/services/WalletService.ts`

**Описание**:
Полное покрытие WalletService — все операции с балансом.

**Файл теста**: `tests/walletService.test.ts`

**Что тестировать**:
- [x] `getWallet` — получение существующего кошелька
- [x] `getWalletOrDefault` — возврат default при отсутствии
- [x] `getOrCreateWallet` — upsert логика
- [x] `incrementBalance` — начисление с optimistic locking
- [x] `decrementBalance` — списание
- [x] `setBalance` — установка баланса
- [x] Race condition — параллельные операции (уже частично в `walletConcurrency.test.ts`)
- [x] Метрики записываются (`recordWalletOperation`, `recordWalletRaceConflict`)

Примечание: в текущей версии `WalletService` нет методов `credit/debit/transfer`, покрыты актуальные публичные методы.

**Acceptance Criteria**:
```
✅ Все публичные методы покрыты
✅ Проверены edge cases (отрицательный баланс, нулевые суммы)
✅ Проверена работа с lockedWallet
```

**Примерная сложность**: 3-4 часа

---

## TICKET-003: Submission Create Flow

**Компонент**: `src/controllers/submission/createSubmission.ts`, `src/services/submission/submissionCreate*.ts`

**Описание**:
Тестирование создания submission с загрузкой файла.

**Файл теста**: `tests/submissionCreate.test.ts`

**Что тестировать**:
- [x] Успешная загрузка видео (mock file)
- [x] Валидация magic bytes (отклонение spoofed files)
- [x] Валидация размера файла (> 50MB отклоняется)
- [x] Валидация длительности (> 15s отклоняется)
- [x] Дедупликация по SHA-256 (повторная загрузка = reuse FileHash)
- [x] Owner канала → сразу `approved` мем
- [x] Viewer → `pending` submission
- [x] Создание тегов (через `tags` body)
- [x] Socket.IO emit `submission:created`
- [x] Idempotency key предотвращает дубликаты

**Мокировать**:
- FFprobe (длительность)
- File system / S3 storage
- Socket.IO emit

**Acceptance Criteria**:
```
✅ Happy path покрыт
✅ Все валидации проверены
✅ Проверена дедупликация
```

**Примерная сложность**: 6-8 часов

---

## TICKET-004: Submission Import (Server-side Download)

**Компонент**: `src/controllers/submission/importMeme*.ts`

**Описание**:
Тестирование импорта мема по URL (server-side download).

**Файл теста**: `tests/submissionImport.test.ts`

**Что тестировать**:
- [x] Успешный импорт по валидному URL
- [x] Отклонение невалидного URL
- [x] Отклонение слишком большого файла
- [x] Отклонение невалидного content-type
- [x] Timeout при долгом скачивании
- [x] Дедупликация (тот же файл = reuse)
- [x] Owner import → сразу в мемы

**Мокировать**:
- HTTP запросы (nock или msw)
- FFprobe
- Storage

**Acceptance Criteria**:
```
✅ Проверены все error cases
✅ Замокированы внешние HTTP запросы
```

**Примерная сложность**: 4-5 часов

---

## TICKET-005: Submission Moderation (Approve/Reject/NeedsChanges)

**Компонент**: `src/services/submission/submissionApprove.ts`, `submissionReject.ts`, `submissionNeedsChanges.ts`

**Описание**:
Тестирование модерации submissions.

**Файл теста**: `tests/submissionModeration.test.ts`

**Что тестировать**:
- [x] Approve: submission → ChannelMeme + MemeAsset
- [x] Approve: начисление submissionRewardCoins (если настроено)
- [x] Approve: проверка onlyWhenLive флага
- [x] Reject: установка статуса + причины
- [x] NeedsChanges: установка статуса + feedback
- [x] Доступ: только streamer/admin канала могут модерировать
- [x] Socket.IO события при смене статуса
- [x] File operations при approve (перемещение из temp)

**Acceptance Criteria**:
```
✅ Все три операции покрыты
✅ Проверены права доступа
✅ Проверено начисление наград
```

**Примерная сложность**: 5-6 часов

---

## TICKET-006: Submission Resubmit

**Компонент**: `src/controllers/submission/resubmitSubmission.ts`

**Описание**:
Тестирование повторной отправки после needs_changes.

**Файл теста**: `tests/submissionResubmit.test.ts`

**Что тестировать**:
- [x] Успешный resubmit из статуса `needs_changes`
- [x] Отклонение resubmit из других статусов
- [x] Только автор может resubmit
- [x] Новый файл заменяет старый (N/A: resubmit принимает только метаданные)
- [x] Статус меняется на `pending`

**Acceptance Criteria**:
```
✅ Проверены все статусы
✅ Проверены права доступа
```

**Примерная сложность**: 2-3 часа

---

## TICKET-007: Bulk Submissions Operations

**Компонент**: `src/controllers/streamer/bulkSubmissionsController.ts`

**Описание**:
Тестирование массовых операций с submissions.

**Файл теста**: `tests/submissionBulk.test.ts`

**Что тестировать**:
- [x] Bulk approve (несколько submissions)
- [x] Bulk reject
- [x] Partial success (часть approved, часть failed)
- [x] Валидация массива ID
- [x] Права доступа

**Acceptance Criteria**:
```
✅ Проверены все bulk операции
✅ Проверена partial success логика
```

**Примерная сложность**: 3-4 часа

---

## TICKET-008: Auth OAuth Initiate & Callback

**Компонент**: `src/controllers/auth/*`, `src/auth/providers/*`

**Описание**:
Тестирование OAuth flow для всех провайдеров.

**Файл теста**: `tests/authOAuthFlows.test.ts` (расширить существующий `oauthCallbackFlows.test.ts`)

**Что тестировать для каждого провайдера** (Twitch, YouTube, Discord, VK, VKVideo, Kick, Trovo):
- [x] `GET /auth/:provider` — redirect на OAuth URL
- [x] `GET /auth/:provider/callback` — успешный callback, создание user
- [x] Callback с существующим user — login
- [x] Невалидный state — отклонение
- [x] Expired state — отклонение
- [x] OAuth error от провайдера — корректная обработка
- [x] Установка cookie (token/token_beta в зависимости от instance)

**Мокировать**:
- OAuth token exchange
- User info endpoints

**Acceptance Criteria**:
```
✅ Все 7 провайдеров покрыты
✅ Проверена beta/prod cookie isolation
```

**Примерная сложность**: 8-10 часов

---

## TICKET-009: Auth Account Linking

**Компонент**: `src/controllers/auth/accounts.ts`

**Описание**:
Тестирование связывания/отвязывания аккаунтов.

**Файл теста**: `tests/authAccountLinking.test.ts`

**Что тестировать**:
- [x] `GET /auth/accounts` — список связанных аккаунтов
- [x] `GET /auth/:provider/link` — initiate linking
- [x] `GET /auth/:provider/link/callback` — complete linking
- [x] `DELETE /auth/accounts/:id` — unlink
- [x] Нельзя отвязать primary account
- [x] Linking уже связанного провайдера — обновление токенов
- [x] Linking к другому user — conflict

**Acceptance Criteria**:
```
✅ Все CRUD операции покрыты
✅ Проверены edge cases
```

**Примерная сложность**: 4-5 часов

---

## TICKET-010: Auth Boosty Link

**Компонент**: `src/controllers/auth/boosty.ts`

**Описание**:
Тестирование manual linking Boosty (без OAuth redirect).

**Файл теста**: `tests/authBoostyLink.test.ts`

**Что тестировать**:
- [x] `POST /auth/boosty/link` с валидным API key
- [x] Отклонение невалидного API key
- [x] Обновление при повторном linking

**Мокировать**:
- Boosty API

**Acceptance Criteria**:
```
✅ Проверена валидация API key
```

**Примерная сложность**: 2 часа

---

## TICKET-011: Auth Logout

**Компонент**: `src/controllers/auth/index.ts` (logout)

**Описание**:
Тестирование logout flow.

**Файл теста**: `tests/authLogout.test.ts` (расширить существующий `logoutCsrf.test.ts`)

**Что тестировать**:
**Что тестировать**:
- [x] `POST /auth/logout` — очистка cookie
- [x] Logout на beta — очистка `token_beta`
- [x] Logout на prod — очистка `token`
- [x] CSRF проверка (уже покрыто частично)
- [x] Logout без cookie — 200 OK (idempotent)

**Acceptance Criteria**:
```
✅ Проверена очистка правильного cookie
```

**Примерная сложность**: 1-2 часа

---

## TICKET-012: Public Channel API

**Компонент**: `src/controllers/public/channelPublic/*`

**Описание**:
Тестирование публичного API каналов (доступно гостям).

**Файл теста**: `tests/publicChannelApi.test.ts`

**Что тестировать**:
- [x] `GET /public/channels/:slug` - channel meta
- [x] `GET /public/channels/:slug?includeMemes=true` - с мемами
- [x] `GET /public/channels/:slug/memes` - pagination
- [x] `GET /public/channels/:slug/memes/search?q=...` - поиск
- [x] Несуществующий slug - 404
- [x] Pagination параметры (limit, offset, sortBy, sortOrder)
- [x] DTO не содержит приватных полей

**Acceptance Criteria**:
```
✅ Все endpoints покрыты
✅ Проверена pagination
✅ Проверен sanitized DTO
```

**Примерная сложность**: 4-5 часов

---

## TICKET-013: Public Submissions Control (Token-based)

**Компонент**: `src/controllers/public/submissionsPublicControlController.ts`

**Описание**:
Тестирование token-based control для StreamDeck/StreamerBot.

**Файл теста**: `tests/publicSubmissionsControl.test.ts`

**Что тестировать**:
- [x] `GET /public/submissions/status?token=...`
- [x] `POST /public/submissions/enable?token=...`
- [x] `POST /public/submissions/disable?token=...`
- [x] `POST /public/submissions/toggle?token=...`
- [x] Невалидный token - 401
- [x] Socket.IO emit `submissions:status`

**Acceptance Criteria**:
```
✅ Все endpoints покрыты
✅ Проверена авторизация по token
```

**Примерная сложность**: 3 часа

---

# ФАЗА 2: Streamer функционал

> **Приоритет**: 🟠 СРЕДНИЙ-ВЫСОКИЙ
>
> **Цель фазы**: покрытие 55%

---

## TICKET-014: Viewer /me Endpoint

**Компонент**: `src/controllers/viewer/me.ts`

**Описание**:
Тестирование GET /me.

**Файл теста**: `tests/viewerMe.test.ts`

**Что тестировать**:
- [x] Возврат user data (id, displayName, profileImageUrl, role)
- [x] Включение channel если есть
- [x] Включение wallets
- [x] Включение externalAccounts
- [x] isGlobalModerator флаг
- [x] 401 без auth

**Acceptance Criteria**:
```
✅ Все поля проверены
✅ Проверен unauthorized case
```

**Примерная сложность**: 2 часа

---

## TICKET-015: Viewer Preferences

**Компонент**: `src/controllers/viewer/preferences.ts`

**Описание**:
Тестирование GET/PATCH /me/preferences.

**Файл теста**: `tests/viewerPreferences.test.ts`

**Что тестировать**:
- [x] `GET /me/preferences` - текущие настройки
- [x] `PATCH /me/preferences` - обновление
- [x] Валидация полей
- [x] Partial update (только переданные поля)

**Acceptance Criteria**:
```
✅ CRUD покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-016: Viewer Wallet Endpoints

**Компонент**: `src/controllers/viewer/wallet.ts`

**Описание**:
Тестирование wallet endpoints.

**Файл теста**: `tests/viewerWallet.test.ts`

**Что тестировать**:
- [x] `GET /wallet?channelId=...` - кошелёк для канала (N/A: списка всех кошельков нет)
- [x] `GET /channels/:slug/wallet` - кошелёк для конкретного канала
- [x] Upsert при первом обращении (создание если нет)
- [x] 401 без auth

**Acceptance Criteria**:
```
✅ Оба endpoint покрыты
```

**Примерная сложность**: 2 часа

---

## TICKET-017: Viewer Memes List & Search

**Компонент**: `src/controllers/viewer/memes.ts`, `src/controllers/viewer/search.ts`

**Описание**:
Тестирование списка мемов и поиска.

**Файл теста**: `tests/viewerMemesSearch.test.ts`

**Что тестировать**:
- [x] `GET /memes` - мемы пользователя
- [x] `GET /channels/:slug/memes` - мемы канала
- [x] `GET /channels/memes/search?q=...` - поиск
- [x] Pagination
- [x] Sorting (createdAt, priceCoins)
- [x] memeCatalogMode влияние (channel vs pool_all)
- [x] ETag / 304 caching

**Acceptance Criteria**:
```
✅ Все endpoints покрыты
✅ Проверена pagination и sorting
```

**Примерная сложность**: 4 часа

---

## TICKET-018: Viewer Stats

**Компонент**: `src/controllers/viewer/stats.ts`

**Описание**:
Тестирование GET /memes/stats.

**Файл теста**: `tests/viewerStats.test.ts`

**Что тестировать**:
- [x] Топ мемов по активациям
- [x] Кэширование (minute buckets)
- [x] Пустой результат при отсутствии данных

**Acceptance Criteria**:
```
✅ Проверена статистика и кэш
```

**Примерная сложность**: 2 часа

---

## TICKET-019: Viewer Pool Operations

**Компонент**: `src/controllers/viewer/pool.ts`, `src/controllers/submission/createPoolSubmission.ts`

**Описание**:
Тестирование операций с pool мемами.

**Файл теста**: `tests/viewerPool.test.ts`

**Что тестировать**:
- [x] `POST /submissions/pool` - добавление из pool
- [x] Проверка memeCatalogMode=pool_all
- [x] Копирование AI полей при adoption

**Acceptance Criteria**:
```
✅ Pool adoption покрыт
```

**Примерная сложность**: 3 часа

---

## TICKET-020: YouTube Like Reward

**Компонент**: `src/controllers/viewer/youtubeLikeReward.ts`

**Описание**:
Тестирование YouTube like reward claim.

**Файл теста**: `tests/viewerYoutubeLikeReward.test.ts`

**Что тестировать**:
- [x] `POST /rewards/youtube/like/claim`
- [x] status: disabled (feature off)
- [x] status: need_youtube_link
- [x] status: need_relink_scopes
- [x] status: not_live
- [x] status: cooldown
- [x] status: not_liked
- [x] status: already_claimed
- [x] status: success + начисление coins

**Мокировать**:
- YouTube API (videos.getRating)

**Acceptance Criteria**:
```
✅ Все статусы проверены
```

**Примерная сложность**: 4 часа

---

## TICKET-021: Streamer Submissions List

**Компонент**: `src/controllers/admin/submissions.ts`

**Описание**:
Тестирование GET /streamer/submissions.

**Файл теста**: `tests/streamerSubmissions.test.ts`

**Что тестировать**:
- [x] Список submissions на модерацию
- [x] Фильтрация по статусу
- [x] Pagination
- [x] Доступ только для streamer/admin
- [x] Только submissions своего канала

**Acceptance Criteria**:
```
✅ Проверена фильтрация и права
```

**Примерная сложность**: 3 часа

---

## TICKET-022: Streamer Memes CRUD

**Компонент**: `src/controllers/admin/memes.ts`

**Описание**:
Тестирование CRUD операций с мемами для стримера.

**Файл теста**: `tests/streamerMemes.test.ts`

**Что тестировать**:
- [x] `GET /streamer/memes` - список мемов канала
- [x] `PATCH /streamer/memes/:id` - обновление (title, price; N/A: tags)
- [x] `DELETE /streamer/memes/:id` - soft delete
- [x] Доступ только к мемам своего канала
- [x] Валидация полей при update

**Acceptance Criteria**:
```
✅ CRUD покрыт
✅ Проверены права доступа
```

**Примерная сложность**: 4 часа

---

## TICKET-023: Streamer Channel Settings

**Компонент**: `src/controllers/admin/channelSettings.ts`, `src/controllers/admin/channelSettings/*`

**Описание**:
Тестирование PATCH /streamer/channel/settings.

**Файл теста**: `tests/streamerChannelSettings.test.ts`

**Что тестировать**:
- [x] Обновление базовых настроек (colors; N/A: name/coinIconUrl нет в PATCH schema)
- [x] Обновление reward настроек (coinPerPointRatio, rewardCoins и т.д.)
- [x] Обновление submission настроек (submissionsEnabled, onlyWhenLive)
- [x] Обновление overlay настроек
- [x] Валидация (например, отрицательные значения)
- [x] Partial update
- [x] Socket.IO emit при изменении

**Acceptance Criteria**:
```
✅ Все группы настроек покрыты
✅ Проверена валидация
```

**Примерная сложность**: 5 часов

---

## TICKET-024: Streamer Twitch Rewards

**Компонент**: `src/controllers/admin/channelSettings/twitchRewards.ts`, `twitchAutoRewardsEventSub.ts`

**Описание**:
Тестирование управления Twitch Channel Points.

**Файл теста**: `tests/streamerTwitchRewards.test.ts`

**Что тестировать**:
- [x] `GET /streamer/twitch/reward/eligibility`
- [x] Create/Update/Delete reward
- [x] EventSub subscription management
- [x] Auto rewards configuration

**Мокировать**:
- Twitch API

**Acceptance Criteria**:
```
✅ Все reward операции покрыты
```

**Примерная сложность**: 5 часов

---

## TICKET-025: Streamer Kick Rewards

**Компонент**: `src/controllers/admin/channelSettings/kickRewards.ts`

**Описание**:
Тестирование Kick rewards configuration.

**Файл теста**: `tests/streamerKickRewards.test.ts`

**Что тестировать**:
- [x] Настройка Kick rewards
- [x] Валидация

**Acceptance Criteria**:
```
✅ Kick rewards покрыты
```

**Примерная сложность**: 2 часа

---

## TICKET-026: Streamer Overlay Settings

**Компонент**: `src/controllers/admin/overlay.ts`

**Описание**:
Тестирование overlay configuration.

**Файл теста**: `tests/streamerOverlay.test.ts`

**Что тестировать**:
- [x] GET overlay settings
- [x] PATCH overlay settings (via PUT overlay presets; overlay fields updated in channel settings)
- [x] Генерация overlay URL/token

**Acceptance Criteria**:
```
✅ Overlay config покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-027: Streamer Overlay Presets

**Компонент**: `src/controllers/admin/overlayPresets.ts`

**Описание**:
Тестирование CRUD overlay presets.

**Файл теста**: `tests/streamerOverlayPresets.test.ts`

**Что тестировать**:
- [ ] Create preset
- [ ] List presets
- [ ] Update preset
- [ ] Delete preset
- [ ] Apply preset

**Acceptance Criteria**:
```
✅ CRUD покрыт
```

**Примерная сложность**: 3 часа

---

## TICKET-028: Streamer Stats

**Компонент**: `src/controllers/admin/stats.ts`

**Описание**:
Тестирование GET /streamer/stats.

**Файл теста**: `tests/streamerStats.test.ts`

**Что тестировать**:
- [ ] Статистика канала (activations, revenue, users)
- [ ] Период фильтрации

**Acceptance Criteria**:
```
✅ Stats endpoint покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-029: Streamer Promotions

**Компонент**: `src/controllers/admin/promotions.ts`

**Описание**:
Тестирование CRUD promotions.

**Файл теста**: `tests/streamerPromotions.test.ts`

**Что тестировать**:
- [ ] Create promotion (discount percentage, dates)
- [ ] List promotions
- [ ] Update promotion
- [ ] Delete promotion
- [ ] Активная промо применяется к цене

**Acceptance Criteria**:
```
✅ CRUD покрыт
✅ Проверено применение скидки
```

**Примерная сложность**: 4 часа

---

## TICKET-030: Streamer Bot Integrations

**Компонент**: `src/controllers/streamer/botIntegrationsController.ts`, `botController.ts`

**Описание**:
Тестирование bot integrations (status, link, unlink).

**Файл теста**: `tests/streamerBotIntegrations.test.ts`

**Что тестировать для каждой платформы** (Twitch, YouTube, Kick, Trovo, VKVideo):
- [ ] GET status
- [ ] Initiate link
- [ ] Unlink
- [ ] Custom bot vs default bot

**Acceptance Criteria**:
```
✅ Все 5 платформ покрыты
```

**Примерная сложность**: 6 часов

---

## TICKET-031: Streamer Bot Settings

**Компонент**: `src/controllers/streamer/botSettings*.ts`

**Описание**:
Тестирование настроек ботов.

**Файл теста**: `tests/streamerBotSettings.test.ts`

**Что тестировать**:
- [ ] GET bot settings
- [ ] PATCH bot settings (commands, greetings, etc.)
- [ ] Валидация

**Acceptance Criteria**:
```
✅ Settings для всех платформ покрыты
```

**Примерная сложность**: 4 часа

---

## TICKET-032: Streamer Credits Overlay

**Компонент**: `src/controllers/admin/creditsOverlay.ts`

**Описание**:
Тестирование credits overlay configuration.

**Файл теста**: `tests/streamerCreditsOverlay.test.ts`

**Что тестировать**:
- [ ] GET credits overlay settings
- [ ] PATCH credits overlay settings
- [ ] Генерация credits overlay URL

**Acceptance Criteria**:
```
✅ Credits overlay покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-033: Streamer Entitlements

**Компонент**: `src/controllers/streamer/entitlementsController.ts`

**Описание**:
Тестирование просмотра entitlements стримера.

**Файл теста**: `tests/streamerEntitlements.test.ts`

**Что тестировать**:
- [ ] GET entitlements (custom bot, features)
- [ ] Отображение активных/неактивных

**Acceptance Criteria**:
```
✅ Entitlements view покрыт
```

**Примерная сложность**: 1-2 часа

---

## TICKET-034: Streamer AI Regenerate

**Компонент**: `src/controllers/streamer/aiRegenerateController.ts`

**Описание**:
Тестирование POST /streamer/memes/:id/ai/regenerate.

**Файл теста**: `tests/streamerAiRegenerate.test.ts`

**Что тестировать**:
- [ ] Запуск regenerate для мема
- [ ] Доступ только к своим мемам
- [ ] Rate limiting

**Мокировать**:
- AI service / OpenAI

**Acceptance Criteria**:
```
✅ Regenerate покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-035: Realtime Activation Events

**Компонент**: `src/socket/index.ts`, `src/realtime/*`

**Описание**:
Тестирование Socket.IO событий активации.

**Файл теста**: `tests/realtimeActivation.test.ts`

**Что тестировать**:
- [ ] `activation:new` — отправка в channel room
- [ ] `activation:played` — обновление статуса
- [ ] `activation:done` — завершение
- [ ] Только подписанные клиенты получают события

**Acceptance Criteria**:
```
✅ Все activation события покрыты
```

**Примерная сложность**: 4 часа

---

## TICKET-036: Realtime Submission Events

**Компонент**: `src/realtime/submissionBridge.ts`

**Описание**:
Тестирование Socket.IO событий submissions.

**Файл теста**: `tests/realtimeSubmission.test.ts`

**Что тестировать**:
- [ ] `submission:created` — при создании
- [ ] `submission:status` — при изменении статуса
- [ ] Slug normalization (lowercase)

**Acceptance Criteria**:
```
✅ Submission events покрыты
```

**Примерная сложность**: 3 часа

---

## TICKET-037: Realtime Credits State

**Компонент**: `src/realtime/creditsState.ts`, `creditsSessionStore.ts`

**Описание**:
Тестирование credits state management.

**Файл теста**: `tests/realtimeCreditsState.test.ts`

**Что тестировать**:
- [ ] Session store operations
- [ ] Credits state updates
- [ ] Ticker logic

**Acceptance Criteria**:
```
✅ Credits realtime покрыт
```

**Примерная сложность**: 3 часа

---

# ФАЗА 3: Admin и инфраструктура

> **Приоритет**: 🟡 СРЕДНИЙ
>
> **Цель фазы**: покрытие 70%

---

## TICKET-038: Owner Wallet Management

**Компонент**: `src/controllers/admin/wallet.ts`

**Описание**:
Тестирование owner wallet operations.

**Файл теста**: `tests/ownerWallet.test.ts`

**Что тестировать**:
- [ ] `GET /owner/wallets/options` — options для dropdown
- [ ] `GET /owner/wallets` — все wallets (pagination)
- [ ] `POST /owner/wallets/:userId/:channelId/adjust` — корректировка баланса
- [ ] Только admin access

**Acceptance Criteria**:
```
✅ Wallet management покрыт
```

**Примерная сложность**: 3 часа

---

## TICKET-039: Owner Default Bots

**Компонент**: `src/controllers/owner/*DefaultBotController.ts`

**Описание**:
Тестирование default bot management (all platforms).

**Файл теста**: `tests/ownerDefaultBots.test.ts`

**Что тестировать для каждой платформы**:
- [ ] GET status
- [ ] Link start
- [ ] Unlink

**Acceptance Criteria**:
```
✅ Все 5 платформ покрыты
```

**Примерная сложность**: 4 часа

---

## TICKET-040: Owner Entitlements

**Компонент**: `src/controllers/owner/entitlementsController.ts`

**Описание**:
Тестирование grant/revoke entitlements.

**Файл теста**: `tests/ownerEntitlements.test.ts`

**Что тестировать**:
- [ ] `GET /owner/entitlements/custom-bot`
- [ ] `POST /owner/entitlements/custom-bot/grant`
- [ ] `POST /owner/entitlements/custom-bot/revoke`
- [ ] `POST /owner/entitlements/custom-bot/grant-by-provider`
- [ ] Rate limiting на resolve

**Acceptance Criteria**:
```
✅ Entitlements management покрыт
```

**Примерная сложность**: 3 часа

---

## TICKET-041: Owner Channel Resolve

**Компонент**: `src/controllers/owner/channelResolveController.ts`

**Описание**:
Тестирование channel resolve by provider.

**Файл теста**: `tests/ownerChannelResolve.test.ts`

**Что тестировать**:
- [ ] `GET /owner/channels/resolve?provider=...&externalId=...`
- [ ] Все провайдеры
- [ ] Not found case

**Acceptance Criteria**:
```
✅ Resolve покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-042: Owner Meme Asset Moderation

**Компонент**: `src/controllers/owner/memeAssetModerationController.ts`

**Описание**:
Тестирование pool moderation.

**Файл теста**: `tests/ownerMemeAssetModeration.test.ts`

**Что тестировать**:
- [ ] `GET /owner/meme-assets` — list
- [ ] `POST /owner/meme-assets/:id/hide`
- [ ] `POST /owner/meme-assets/:id/unhide`
- [ ] `POST /owner/meme-assets/:id/purge`
- [ ] `POST /owner/meme-assets/:id/restore`

**Acceptance Criteria**:
```
✅ Все moderation actions покрыты
```

**Примерная сложность**: 3 часа

---

## TICKET-043: Owner Global Moderators

**Компонент**: `src/controllers/owner/moderatorsController.ts`

**Описание**:
Тестирование global moderators management.

**Файл теста**: `tests/ownerModerators.test.ts`

**Что тестировать**:
- [ ] `GET /owner/moderators` — list
- [ ] `POST /owner/moderators/:userId/grant`
- [ ] `POST /owner/moderators/:userId/revoke`

**Acceptance Criteria**:
```
✅ Moderators management покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-044: Owner AI Status

**Компонент**: `src/controllers/owner/aiStatusController.ts`

**Описание**:
Тестирование GET /owner/ai/status.

**Файл теста**: `tests/ownerAiStatus.test.ts`

**Что тестировать**:
- [ ] Статус AI scheduler
- [ ] Queue stats

**Acceptance Criteria**:
```
✅ AI status покрыт
```

**Примерная сложность**: 1 час

---

## TICKET-045: Repositories Layer

**Компонент**: `src/repositories/*`

**Описание**:
Тестирование repository layer.

**Файлы тестов**: `tests/repositories/*.test.ts`

**Что тестировать для каждого репозитория**:

### ChannelRepository
- [ ] findBySlug
- [ ] findById
- [ ] update

### MemeRepository
- [ ] create
- [ ] findById
- [ ] findByChannel (pagination)
- [ ] update
- [ ] softDelete

### SubmissionRepository
- [ ] create
- [ ] findById
- [ ] findByChannel (filtering, pagination)
- [ ] updateStatus

### UserRepository
- [ ] findById
- [ ] findByExternalAccount
- [ ] create
- [ ] update

### WalletRepository
- [ ] findByKey
- [ ] upsert
- [ ] lockForUpdate

**Acceptance Criteria**:
```
✅ Все repositories покрыты
```

**Примерная сложность**: 8 часов (все вместе)

---

## TICKET-046: Utility Functions — Core

**Компонент**: `src/utils/*` (core utilities)

**Описание**:
Тестирование core utility functions.

**Файл теста**: `tests/utilsCore.test.ts`

**Что тестировать**:
- [ ] `pagination.ts` — buildPaginatedResponse, parsePaginationParams
- [ ] `dto.ts` — DTO transformations
- [ ] `tags.ts` — tag normalization
- [ ] `jwt.ts` — sign, verify, decode
- [ ] `entitlements.ts` — hasEntitlement checks
- [ ] `promotions.ts` — calculatePromoPrice
- [ ] `httpErrors.ts` — error creation helpers

**Acceptance Criteria**:
```
✅ Core utils покрыты
```

**Примерная сложность**: 5 часов

---

## TICKET-047: Utility Functions — Async/Concurrency

**Компонент**: `src/utils/semaphore.ts`, `retry.ts`, `circuitBreaker.ts`, `pgAdvisoryLock.ts`

**Описание**:
Тестирование async/concurrency utilities.

**Файл теста**: `tests/utilsConcurrency.test.ts`

**Что тестировать**:
- [ ] Semaphore — acquire, release, limit enforcement
- [ ] Retry — exponential backoff, max attempts
- [ ] Circuit breaker — open, half-open, closed states
- [ ] PG advisory lock — acquire, release, timeout

**Acceptance Criteria**:
```
✅ Concurrency utils покрыты
```

**Примерная сложность**: 4 часа

---

## TICKET-048: Utility Functions — Media

**Компонент**: `src/utils/media/*`, `videoValidator.ts`

**Описание**:
Тестирование media utilities.

**Файл теста**: `tests/utilsMedia.test.ts`

**Что тестировать**:
- [ ] `videoNormalization.ts` — normalize (mock ffmpeg)
- [ ] `videoValidator.ts` — validateDuration, validateSize
- [ ] `configureFfmpeg.ts` — configuration

**Мокировать**:
- FFmpeg/FFprobe

**Acceptance Criteria**:
```
✅ Media utils покрыты
```

**Примерная сложность**: 3 часа

---

## TICKET-049: Utility Functions — Caching

**Компонент**: `src/utils/redisCache.ts`, `redisClient.ts`

**Описание**:
Тестирование Redis caching utilities.

**Файл теста**: `tests/utilsCache.test.ts`

**Что тестировать**:
- [ ] get/set/delete
- [ ] TTL handling
- [ ] Cache miss behavior
- [ ] Connection handling

**Мокировать**:
- Redis client

**Acceptance Criteria**:
```
✅ Cache utils покрыты
```

**Примерная сложность**: 2 часа

---

## TICKET-050: External APIs — Twitch

**Компонент**: `src/utils/twitch/*`

**Описание**:
Тестирование Twitch API utilities.

**Файл теста**: `tests/twitchApi.test.ts`

**Что тестировать**:
- [ ] `twitchApiRequest.ts` — request with retry
- [ ] `twitchAppToken.ts` — token management
- [ ] `twitchEventSub.ts` — subscription CRUD
- [ ] `twitchRewards.ts` — reward CRUD
- [ ] `twitchTokens.ts` — refresh logic
- [ ] `twitchUsers.ts` — user info fetch

**Мокировать**:
- Twitch API (использовать `tests/mocks/twitchApi.mock.ts`)

**Acceptance Criteria**:
```
✅ Twitch API покрыт
```

**Примерная сложность**: 5 часов

---

## TICKET-051: External APIs — YouTube

**Компонент**: `src/utils/youtube/*`

**Описание**:
Тестирование YouTube API utilities.

**Файл теста**: `tests/youtubeApi.test.ts`

**Что тестировать**:
- [ ] `youtubeChannels.ts` — channel info
- [ ] `youtubeLive.ts` — live stream detection
- [ ] `youtubeTokens.ts` — refresh logic
- [ ] `youtubeHttp.ts` — request handling

**Мокировать**:
- YouTube API (использовать `tests/mocks/youtubeApi.mock.ts`)

**Acceptance Criteria**:
```
✅ YouTube API покрыт
```

**Примерная сложность**: 4 часа

---

## TICKET-052: External APIs — VKVideo

**Компонент**: `src/utils/vkvideo/*`

**Описание**:
Тестирование VKVideo API utilities.

**Файл теста**: `tests/vkvideoApi.test.ts`

**Что тестировать**:
- [ ] `vkvideoChannel.ts`
- [ ] `vkvideoChannelPoints.ts`
- [ ] `vkvideoCore.ts`
- [ ] `vkvideoTokens.ts`
- [ ] `vkvideoRoles.ts`

**Acceptance Criteria**:
```
✅ VKVideo API покрыт
```

**Примерная сложность**: 4 часа

---

## TICKET-053: External APIs — Other (Discord, Boosty, Kick, Trovo)

**Компонент**: `src/utils/discordApi.ts`, `boostyApi.ts`, `kickApi.ts`, `trovoApi.ts`

**Описание**:
Тестирование остальных external APIs.

**Файл теста**: `tests/externalApis.test.ts`

**Что тестировать**:
- [ ] Discord API — guild members, roles
- [ ] Boosty API — tier info
- [ ] Kick API — channel info
- [ ] Trovo API — channel info

**Acceptance Criteria**:
```
✅ Все external APIs покрыты
```

**Примерная сложность**: 4 часа

---

## TICKET-054: Middleware — Error Handler

**Компонент**: `src/middleware/errorHandler.ts`, `errorResponseFormat.ts`

**Описание**:
Тестирование error handling middleware.

**Файл теста**: `tests/middlewareErrorHandler.test.ts`

**Что тестировать**:
- [ ] Обработка HttpError
- [ ] Обработка unknown errors
- [ ] Формат response
- [ ] Logging

**Acceptance Criteria**:
```
✅ Error handling покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-055: Middleware — Upload

**Компонент**: `src/middleware/upload.ts`

**Описание**:
Тестирование upload middleware.

**Файл теста**: `tests/middlewareUpload.test.ts`

**Что тестировать**:
- [ ] File size limits
- [ ] File type filtering
- [ ] Multer configuration
- [ ] Error handling

**Acceptance Criteria**:
```
✅ Upload middleware покрыт
```

**Примерная сложность**: 3 часа

---

## TICKET-056: Middleware — Idempotency

**Компонент**: `src/middleware/idempotencyKey.ts`

**Описание**:
Тестирование idempotency key middleware.

**Файл теста**: `tests/middlewareIdempotency.test.ts`

**Что тестировать**:
- [ ] Key extraction from header
- [ ] Duplicate request detection
- [ ] Response caching
- [ ] TTL expiration

**Acceptance Criteria**:
```
✅ Idempotency покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-057: Middleware — Moderator Check

**Компонент**: `src/middleware/moderator.ts`

**Описание**:
Тестирование moderator check middleware.

**Файл теста**: `tests/middlewareModerator.test.ts`

**Что тестировать**:
- [ ] Global moderator access
- [ ] Channel moderator access
- [ ] Non-moderator rejection

**Acceptance Criteria**:
```
✅ Moderator check покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-058: Middleware — Require Channel

**Компонент**: `src/middleware/requireChannel.ts`

**Описание**:
Тестирование require channel middleware.

**Файл теста**: `tests/middlewareRequireChannel.test.ts`

**Что тестировать**:
- [ ] User with channel — pass
- [ ] User without channel — reject

**Acceptance Criteria**:
```
✅ Require channel покрыт
```

**Примерная сложность**: 1 час

---

# ФАЗА 4: Edge cases и resilience

> **Приоритет**: 🟢 НИЗКИЙ
>
> **Цель фазы**: покрытие 80%+

---

## TICKET-059: Services — Bot Service

**Компонент**: `src/services/BotService.ts`, `src/services/bot/*`

**Описание**:
Тестирование BotService.

**Файл теста**: `tests/botServiceFull.test.ts`

**Что тестировать**:
- [ ] Bot commands processing
- [ ] Follow greetings
- [ ] Outbox management
- [ ] Subscription handling
- [ ] Stream duration tracking

**Acceptance Criteria**:
```
✅ BotService покрыт
```

**Примерная сложность**: 5 часов

---

## TICKET-060: Services — AI Moderation Service

**Компонент**: `src/services/AiModerationService.ts`, `src/services/aiModeration/*`

**Описание**:
Тестирование AI moderation pipeline.

**Файл теста**: `tests/aiModerationServiceFull.test.ts`

**Что тестировать**:
- [ ] Full pipeline (audio extraction → transcription → analysis)
- [ ] Auto-approve logic
- [ ] Reuse existing MemeAsset AI data
- [ ] Error recovery
- [ ] Rate limiting / concurrency

**Мокировать**:
- OpenAI API (использовать `tests/mocks/openaiApi.mock.ts`)
- FFmpeg

**Acceptance Criteria**:
```
✅ AI moderation pipeline покрыт
```

**Примерная сложность**: 6 часов

---

## TICKET-061: Jobs & Workers

**Компонент**: `src/jobs/*`, `src/workers/*`

**Описание**:
Тестирование background jobs.

**Файл теста**: `tests/jobs.test.ts`

**Что тестировать**:
- [ ] AI analysis job
- [ ] AI watchdog job
- [ ] Monitoring job
- [ ] Worker lifecycle

**Acceptance Criteria**:
```
✅ Jobs покрыты
```

**Примерная сложность**: 4 часа

---

## TICKET-062: Queues

**Компонент**: `src/queues/*`

**Описание**:
Тестирование BullMQ queues.

**Файл теста**: `tests/queues.test.ts`

**Что тестировать**:
- [ ] AI queue operations
- [ ] Chat outbox queue
- [ ] Job retry logic
- [ ] Dead letter queue

**Acceptance Criteria**:
```
✅ Queues покрыты
```

**Примерная сложность**: 3 часа

---

## TICKET-063: Storage Providers

**Компонент**: `src/storage/*`

**Описание**:
Тестирование storage providers.

**Файл теста**: `tests/storage.test.ts`

**Что тестировать**:
- [ ] Local storage — save, get, delete
- [ ] S3 storage — save, get, delete
- [ ] Storage factory

**Мокировать**:
- S3 client

**Acceptance Criteria**:
```
✅ Storage покрыт
```

**Примерная сложность**: 3 часа

---

## TICKET-064: Socket Redis Adapter

**Компонент**: `src/socket/redisAdapter.ts`

**Описание**:
Тестирование Redis adapter для Socket.IO.

**Файл теста**: `tests/socketRedisAdapter.test.ts`

**Что тестировать**:
- [ ] Multi-instance pub/sub
- [ ] Room synchronization
- [ ] Connection handling

**Acceptance Criteria**:
```
✅ Redis adapter покрыт
```

**Примерная сложность**: 3 часа

---

## TICKET-065: Utility — Service Heartbeat

**Компонент**: `src/utils/serviceHeartbeat.ts`

**Описание**:
Тестирование service heartbeat.

**Файл теста**: `tests/utilsServiceHeartbeat.test.ts`

**Что тестировать**:
- [ ] Heartbeat recording
- [ ] Stale detection
- [ ] Cleanup

**Acceptance Criteria**:
```
✅ Heartbeat покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-066: Utility — Audit Logger

**Компонент**: `src/utils/auditLogger.ts`

**Описание**:
Тестирование audit logging.

**Файл теста**: `tests/utilsAuditLogger.test.ts`

**Что тестировать**:
- [ ] Log creation
- [ ] Log format
- [ ] Context inclusion

**Acceptance Criteria**:
```
✅ Audit logger покрыт
```

**Примерная сложность**: 1 час

---

## TICKET-067: Utility — Metrics

**Компонент**: `src/utils/metrics.ts`

**Описание**:
Тестирование metrics recording.

**Файл теста**: `tests/utilsMetrics.test.ts`

**Что тестировать**:
- [ ] Counter increment
- [ ] Histogram observation
- [ ] Gauge set

**Acceptance Criteria**:
```
✅ Metrics покрыт
```

**Примерная сложность**: 2 часа

---

## TICKET-068: Integration Tests — Full User Journey

**Компонент**: Full stack

**Описание**:
End-to-end integration tests для полных user journeys.

**Файл теста**: `tests/integration/userJourneys.test.ts`

**Что тестировать**:
- [ ] Viewer: login → browse → activate meme
- [ ] Streamer: login → upload meme → configure channel
- [ ] Submission: viewer submit → streamer approve → meme appears

**Acceptance Criteria**:
```
✅ Key user journeys покрыты
```

**Примерная сложность**: 8 часов

---

## TICKET-069: Stress Tests — Concurrent Operations

**Компонент**: Critical paths

**Описание**:
Тесты на concurrent operations.

**Файл теста**: `tests/stress/concurrent.test.ts`

**Что тестировать**:
- [ ] Multiple activations same meme
- [ ] Multiple submissions same user
- [ ] Wallet operations under load
- [ ] Socket.IO message flood

**Acceptance Criteria**:
```
✅ No race conditions
✅ No data corruption
```

**Примерная сложность**: 6 часов

---

## TICKET-070: Error Scenarios

**Компонент**: All components

**Описание**:
Тестирование error scenarios и recovery.

**Файл теста**: `tests/errorScenarios.test.ts`

**Что тестировать**:
- [ ] Database connection failure
- [ ] Redis connection failure
- [ ] External API timeout
- [ ] Invalid input handling
- [ ] Graceful shutdown

**Acceptance Criteria**:
```
✅ System handles failures gracefully
```

**Примерная сложность**: 5 часов

---

# 📊 Сводка

| Фаза | Тикетов | Примерное время |
|------|---------|-----------------|
| Фаза 1 | 13 | ~50-60 часов |
| Фаза 2 | 24 | ~70-80 часов |
| Фаза 3 | 21 | ~55-65 часов |
| Фаза 4 | 12 | ~45-50 часов |
| **ИТОГО** | **70** | **~220-255 часов** |

---

# ✅ Definition of Done

Каждый тикет считается выполненным когда:

1. [ ] Все перечисленные test cases написаны
2. [ ] Тесты проходят локально (`pnpm test`)
3. [ ] Используются фабрики из `tests/factories/`
4. [ ] Внешние сервисы замокированы
5. [ ] Нет flaky tests (тест стабилен при многократном запуске)
6. [ ] Code review пройден
7. [ ] CI проходит успешно

---

# 📚 Полезные ссылки

- [Testing Guide](./TESTING.md)
- [API Cheatsheet](./FRONTEND_API_CHEATSHEET.md)
- [Architecture](../ARCHITECTURE.md)
- [Factories](../tests/factories/)
- [Mocks](../tests/mocks/)
