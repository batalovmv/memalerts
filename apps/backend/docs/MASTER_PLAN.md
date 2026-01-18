# 🎯 MemAlerts Backend — Мастер-план

**Единый план развития проекта**  
*Дата: 2026-01-18*

---

## 📊 Текущее состояние

| Метрика | Значение |
|---------|----------|
| Версия | 1.0.6 |
| ESLint errors | 0 |
| ESLint warnings | 0 |
| Тесты | 225 (все проходят) |
| Coverage | ~70.55% → цель 80% |
| VPS | prod + beta online |
| Мониторинг | Полный |

---

# 🏗️ ЧАСТЬ 1: ИНФРАСТРУКТУРА

## 1.1 DevOps & Автоматизация

### ✅ Уже сделано
- [x] CI/CD (GitHub Actions, self-hosted runner)
- [x] Canary deploys
- [x] Health checks (5 endpoints)
- [x] VPS мониторинг (cron scripts)
- [x] Prometheus + Grafana
- [x] PM2 управление процессами
- [x] Backup + verify

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 1.1.1 | ✅ Добавить Dependabot | 5 мин | 🟠 |
| 1.1.2 | ✅ Обновить coverage-baseline.json | 5 мин | 🟠 |
| 1.1.3 | ✅ Настроить Renovate (альтернатива Dependabot) | 15 мин | 🟡 |
| 1.1.4 | ⏸️ Docker compose для prod (deferred per ADR 0004) | 2 ч | 🟢 |

**Файл для Dependabot:**
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    groups:
      dev-dependencies:
        patterns:
          - "@types/*"
          - "eslint*"
          - "vitest*"
```

---

## 1.2 Документация

### ✅ Уже есть (35+ документов)
- [x] README, ARCHITECTURE, DEVELOPMENT, DEPLOYMENT
- [x] API_ERRORS, FRONTEND_API_CHEATSHEET
- [x] security.md, observability.md, backup.md
- [x] ADR (4 записи)
- [x] VPS_STRUCTURE, VPS_MONITORING_PLAN

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 1.2.1 | ✅ CONTRIBUTING.md | 15 мин | 🟡 |
| 1.2.2 | ✅ LICENSE файл | 2 мин | 🟡 |
| 1.2.3 | ✅ Issue templates (.github/ISSUE_TEMPLATE/) | 20 мин | 🟡 |
| 1.2.4 | ✅ PR template (.github/pull_request_template.md) | 10 мин | 🟡 |
| 1.2.5 | ✅ CHANGELOG automation (standard-version) | 30 мин | 🟡 |
| 1.2.6 | OpenAPI docs расширение | 2 ч | 🟢 |

---

## 1.3 Качество кода

### ✅ Уже сделано
- [x] ESLint 0 errors, 0 warnings
- [x] Prettier настроен
- [x] Husky pre-commit hooks
- [x] TypeScript strict mode

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 1.3.1 | ✅ Добавить commitlint (conventional commits) | 20 мин | 🟡 |
| 1.3.2 | ✅ Добавить lint-staged для tests | 10 мин | 🟢 |
| 1.3.3 | ⏸️ SonarQube интеграция (requires SonarQube server) | 2 ч | 🟢 |

---

# 🧪 ЧАСТЬ 2: ТЕСТИРОВАНИЕ

## 2.1 План тестирования (из TEST_PLAN_TICKETS.md)

**Цель:** Coverage 13% → 80%  
**Тикетов:** 70  
**Время:** ~220-255 часов

### Фаза 1: Критические бизнес-потоки (50-60 ч)

| # | Тикет | Компонент | Время | Статус |
|---|-------|-----------|-------|--------|
| TICKET-001 | Viewer Activation Flow | activation.ts | 4-6 ч | ✅ |
| TICKET-002 | Wallet Service | WalletService.ts | 3-4 ч | ✅ |
| TICKET-003 | Submission Create Flow | createSubmission.ts | 6-8 ч | ✅ |
| TICKET-004 | Submission Import | importMeme.ts | 4-5 ч | ✅ |
| TICKET-005 | Submission Approve Flow | approveSubmission.ts | 4-5 ч | ✅ |
| TICKET-006 | Socket.IO Rooms & Events | socket/index.ts | 4-5 ч | ✅ |
| TICKET-007 | Overlay Token & Rotation | overlay.ts | 3-4 ч | ✅ |
| TICKET-008 | Twitch Channel Points | twitchRewards.ts | 5-6 ч | ✅ |
| TICKET-009 | Beta/Prod Isolation | auth.ts, csrf.ts | 4-5 ч | ✅ |
| TICKET-010 | Internal Relay | /internal/* | 3-4 ч | ✅ |
| TICKET-011 | Rate Limiting | rateLimit.ts | 3-4 ч | ✅ |
| TICKET-012 | OAuth Providers | providers/*.ts | 5-6 ч | ✅ |
| TICKET-013 | Credits Overlay | creditsOverlay.ts | 4-5 ч | ✅ |

### Фаза 2: Вторичные потоки (70-80 ч)

| # | Тикет | Компонент | Время |
|---|-------|-----------|-------|
| TICKET-014 | Channel Settings | channelSettings.ts | 4-5 ч |
| TICKET-015 | Promotions | promotions.ts | 3-4 ч |
| TICKET-016 | Meme CRUD | memes.ts | 4-5 ч |
| TICKET-017 | Channel Statistics | stats.ts | 3-4 ч |
| TICKET-018 | Viewer Preferences | preferences.ts | 2-3 ч |
| TICKET-019 | Search | search.ts | 3-4 ч |
| TICKET-020 | Pagination | pagination.ts | 2-3 ч |
| TICKET-021 | File Hash Dedup | fileHash.ts | 3-4 ч |
| TICKET-022 | Video Validation | videoValidator.ts | 4-5 ч |
| TICKET-023 | S3 Storage | s3Storage.ts | 3-4 ч |
| TICKET-024 | AI Queue | aiQueue.ts | 4-5 ч |
| TICKET-025 | AI Moderation | aiModeration.ts | 5-6 ч |
| ... | ... | ... | ... |

### Фаза 3: Интеграции (55-65 ч)

| # | Тикет | Компонент | Время |
|---|-------|-----------|-------|
| TICKET-038 | Twitch API | twitchApi.ts | 4-5 ч |
| TICKET-039 | YouTube API | youtubeApi.ts | 4-5 ч |
| TICKET-040 | VKVideo API | vkvideoApi.ts | 4-5 ч |
| TICKET-041 | Trovo API | trovoApi.ts | 3-4 ч |
| TICKET-042 | Kick API | kickApi.ts | 3-4 ч |
| TICKET-043 | Discord API | discordApi.ts | 3-4 ч |
| TICKET-044 | Boosty API | boostyApi.ts | 3-4 ч |
| TICKET-045-058 | Bot integrations | bots/*.ts | 30-35 ч |

### Фаза 4: Edge cases & Resilience (45-50 ч)

| # | Тикет | Компонент | Время |
|---|-------|-----------|-------|
| TICKET-059 | Error Handling | errorHandler.ts | 3-4 ч |
| TICKET-060 | Circuit Breakers | circuitBreaker.ts | 3-4 ч |
| TICKET-061 | Retry Logic | retryWithBackoff.ts | 2-3 ч |
| TICKET-062 | Graceful Shutdown | shutdownState.ts | 2-3 ч |
| TICKET-063 | Concurrent Operations | semaphore.ts | 3-4 ч |
| TICKET-064-070 | Security edge cases | various | 25-30 ч |

---

## 2.2 Load Testing

### ✅ Уже есть
- [x] k6 load tests (tests/load/*.k6.js)
- [x] Smoke profile (5 VUs / 10s)
- [x] Heavy profile (moderation 20 RPS, submissions 20 RPS)
- [x] Performance seed (pnpm seed:perf)
- [x] Rolling restart smoke test

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 2.2.1 | ✅ Добавить stress test profile | 2 ч | 🟡 |
| 2.2.2 | ✅ Добавить spike test profile | 2 ч | 🟡 |
| 2.2.3 | ✅ CI integration для load tests | 1 ч | 🟠 |
| 2.2.4 | ✅ Baseline metrics для регрессии | 1 ч | 🟠 |

---

# 🔒 ЧАСТЬ 3: БЕЗОПАСНОСТЬ

## 3.1 Security Boundaries (из ARCHITECTURE.md)

### ✅ Инварианты (поддерживать)
- [x] Beta ↔ Prod isolation (cookies, secrets, origins)
- [x] CSRF protection (POST/PUT/PATCH/DELETE)
- [x] Internal relay (localhost-only + x-memalerts-internal)
- [x] Wallet privacy (wallet:updated only to user:{id})
- [x] Slug normalization

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 3.1.1 | ✅ Security audit (OWASP Top 10) | 4 ч | 🟠 |
| 3.1.2 | ✅ Dependency vulnerability scan (Snyk/npm audit) | 1 ч | 🟠 |
| 3.1.3 | ✅ Rate limit tuning per endpoint | 2 ч | 🟡 |
| 3.1.4 | ✅ JWT rotation runbook | 30 мин | 🟡 |

---

## 3.2 CodeQL & Security Scanning

### ✅ Уже есть
- [x] CodeQL workflow (.github/workflows/codeql.yml)
- [x] Snyk in CI

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 3.2.1 | ✅ Настроить Snyk notifications | 15 мин | 🟡 |
| 3.2.2 | ⏸️ Добавить trivy для Docker (N/A: нет Dockerfile) | 30 мин | 🟢 |

---

# ⚡ ЧАСТЬ 4: ПРОИЗВОДИТЕЛЬНОСТЬ

## 4.1 Critical Paths (из perf-critical-paths.md)

### ✅ Оптимизировано
- [x] Cursor pagination
- [x] Composite indexes
- [x] Cache headers для /uploads/*
- [x] Load tests baseline

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 4.1.1 | ✅ Redis caching для hot paths | 3 ч | 🟡 |
| 4.1.2 | ✅ ETag для GET endpoints | 2 ч | 🟡 |
| 4.1.3 | ✅ Connection pooling audit | 1 ч | 🟡 |
| 4.1.4 | Query analysis (EXPLAIN) | 2 ч | 🟢 |

---

## 4.2 Observability

### ✅ Уже есть
- [x] Prometheus metrics
- [x] Grafana dashboards (5)
- [x] Jaeger tracing
- [x] Structured logging (Pino)
- [x] Request context (requestId, traceId)

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 4.2.1 | ✅ Dashboard для bot health | 2 ч | 🟡 |
| 4.2.2 | ✅ Alert rules refinement | 1 ч | 🟡 |
| 4.2.3 | ✅ Log retention policy | 30 мин | 🟢 |

---

# 🤖 ЧАСТЬ 5: БОТЫ & ИНТЕГРАЦИИ

## 5.1 Multistream Bots

### ✅ Реализовано
- [x] Twitch bot
- [x] YouTube bot
- [x] VKVideo bot
- [x] Trovo bot
- [x] Kick bot

### ⬜ TODO (hardening)

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 5.1.1 | ✅ Token refresh resilience | 3 ч | 🟠 |
| 5.1.2 | ✅ Reconnect backoff | 2 ч | 🟠 |
| 5.1.3 | ✅ Message dedup (idempotency) | 2 ч | 🟠 |
| 5.1.4 | ✅ Rate limit per channel | 2 ч | 🟡 |
| 5.1.5 | Bot health dashboard | 2 ч | 🟡 |
| 5.1.6 | ✅ Outbox cleanup job | 1 ч | 🟡 |

---

## 5.2 External APIs

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 5.2.1 | ✅ API response type definitions | 4 ч | 🟡 |
| 5.2.2 | Mock server для тестов | 3 ч | 🟡 |
| 5.2.3 | ✅ API versioning strategy | 2 ч | 🟢 |

---

# 📦 ЧАСТЬ 6: DATA & MIGRATIONS

## 6.1 Dual-Write Consistency

### ✅ Документировано
- [x] dual-write-inventory.md
- [x] audit:consistency script

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 6.1.1 | ✅ Автоматический consistency check в CI | 1 ч | 🟠 |
| 6.1.2 | Миграция на single source of truth | 8 ч | 🟡 |

---

## 6.2 Database

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 6.2.1 | Index audit (unused indexes) | 2 ч | 🟡 |
| 6.2.2 | Partition strategy для больших таблиц | 4 ч | 🟢 |
| 6.2.3 | Read replica (если нужно) | 8 ч | 🟢 |

---

# 🎨 ЧАСТЬ 7: UX & API

## 7.1 Error Messages

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 7.1.1 | ✅ Локализация ошибок (RU) | 3 ч | 🟡 |
| 7.1.2 | ✅ Helpful hints в error responses | 2 ч | 🟡 |
| 7.1.3 | ✅ Validation error details | 2 ч | 🟡 |

---

## 7.2 API Polish

### ⬜ TODO

| # | Задача | Время | Приоритет |
|---|--------|-------|-----------|
| 7.2.1 | ✅ API versioning (/api/v1/) | 4 ч | 🟢 |
| 7.2.2 | ✅ Deprecation headers | 1 ч | 🟢 |
| 7.2.3 | ✅ Rate limit headers | 1 ч | 🟡 |

---

# 📋 СВОДНАЯ ТАБЛИЦА

## По приоритетам

| Приоритет | Задач | Время |
|-----------|-------|-------|
| 🔴 Критичные | 0 | — |
| 🟠 Средние | 15 | ~25 ч |
| 🟡 Низкие | 40 | ~80 ч |
| 🟢 Опциональные | 15 | ~40 ч |
| **Тесты** | 70 | ~220 ч |

## По категориям

| Категория | Задач | Время |
|-----------|-------|-------|
| Инфраструктура | 12 | ~8 ч |
| Документация | 6 | ~1.5 ч |
| Тестирование | 70 | ~220 ч |
| Безопасность | 6 | ~8 ч |
| Производительность | 7 | ~12 ч |
| Боты | 6 | ~12 ч |
| Data | 5 | ~15 ч |
| UX/API | 6 | ~13 ч |
| **ИТОГО** | **118** | **~290 ч** |

---

# 🚀 QUICK WINS (можно сделать за 1 день)

| # | Задача | Время |
|---|--------|-------|
| 1 | ✅ Dependabot | 5 мин |
| 2 | ✅ Coverage baseline update | 5 мин |
| 3 | ✅ CONTRIBUTING.md | 15 мин |
| 4 | ✅ LICENSE | 2 мин |
| 5 | ✅ Issue templates | 20 мин |
| 6 | ✅ PR template | 10 мин |
| 7 | Snyk notifications | 15 мин |
| **Итого** | | **~1.5 ч** |

---

# 📅 Рекомендуемый порядок

## Неделя 1-2: Инфраструктура
- [ ] Quick wins (Dependabot, templates, LICENSE)
- [ ] Coverage baseline
- [ ] CHANGELOG automation

## Неделя 3-6: Тесты (Фаза 1)
- [ ] TICKET-004 — TICKET-013
- [ ] CI load test integration

## Неделя 7-10: Тесты (Фаза 2)
- [ ] TICKET-014 — TICKET-037

## Неделя 11-14: Тесты (Фаза 3)
- [ ] TICKET-038 — TICKET-058

## Неделя 15-16: Тесты (Фаза 4)
- [ ] TICKET-059 — TICKET-070
- [ ] Security audit

## Неделя 17+: Polish
- [ ] Производительность
- [ ] Боты hardening
- [ ] API polish

---

# ✅ Definition of Done

Проект считается "завершённым" когда:

- [ ] Coverage ≥ 80%
- [ ] 0 ESLint errors/warnings
- [ ] 0 security vulnerabilities (npm audit)
- [ ] Все тесты проходят
- [ ] Load tests baseline зафиксирован
- [ ] Документация актуальна
- [ ] Dependabot настроен
- [ ] VPS мониторинг работает
- [ ] Backup + restore протестированы

---

*Создано: 2026-01-18*  
*Обновлять по мере выполнения задач*

