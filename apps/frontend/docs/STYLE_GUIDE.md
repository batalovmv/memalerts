# Memalerts Frontend — UI / UX Style Guide (based on recent refactor)

Этот документ фиксирует **практический стиль интерфейса**, к которому мы пришли в ходе правок: единые компоненты, доступность, состояния загрузки/пустоты и предсказуемая клавиатурная навигация.  
Цель: чтобы любой разработчик мог **делать новые фичи “в одном стиле”**, не копируя ручные классы и не ломая a11y.

---

## Принципы (TL;DR)

- **Используй `shared/ui` компоненты** вместо “ручных” `<button>/<input>/<select>/<textarea>`.
- **Фокус всегда видим** (`:focus-visible` задан глобально). Не отключай outline без замены.
- **Модалки/меню/табы** — только с корректной клавиатурой и ARIA.
- **Loading / Empty / Error** — единые паттерны (`Spinner` + `surface/glass` блок).
- **Внутренняя навигация** — через `react-router-dom` `Link`, не через `<a href="/...">`.

---

## Базовые строительные блоки

### Поверхности и layout

Используем общие utility-классы из `src/index.css`:

- **`.page-container`**: единая ширина/паддинги контейнера
- **`.section-gap`**: единый вертикальный ритм
- **`.surface` / `.surface-hover`**: “карточная” поверхность приложения
- **`.glass` / `.glass-btn`**: стекло/контролы в glass стиле (использовать умеренно)

Рекомендация:
- **Page-level**: `PageShell` + `Header` (**`PageShell` уже содержит `page-container` и `py-8`**)
- **Карточки/секции**: `surface` (или `Card` из `shared/ui`, который уже рендерит `surface`)

Практика:
- Если странице нужен другой max-width — **не добавляй второй `page-container` внутрь**. Используй `PageShell` проп `containerClassName`, например `containerClassName="max-w-3xl"`.
- Для публичных channel страниц используй `PageShell variant="channel"` и передавай фон через `background`.

---

## Shared UI: что использовать

Компоненты находятся в `src/shared/ui`:

- **Layout**: `PageShell`
- **Кнопки**: `Button`, `IconButton`
- **Формы**: `Input`, `Select`, `Textarea`
- **Состояния**: `Spinner`
- **Оверлеи**: `SavingOverlay`, `SavedOverlay`
- **Бейджи**: `Pill` (универсальные счётчики/статусы), `AttemptsPill` (специфичный индикатор попыток)
- **Модалки**: `Modal`

Правило:
- Если есть компонент в `shared/ui` — **не делаем “ручной” элемент** с теми же стилями.

---

## Кнопки (Button / IconButton)

### Обязательные правила

- Всегда ставь `type="button"` на кнопки, которые **не** submit-ят форму.
- Для icon-only кнопок **обязателен `aria-label`**.
- Для toggle кнопок используй **`aria-pressed`**.

### Пример

```tsx
import { Button, IconButton } from '@/shared/ui';

<Button type="button" variant="primary" onClick={onSave}>
  Save
</Button>

<IconButton
  type="button"
  variant="ghost"
  aria-label="Close"
  icon={<CloseIcon />}
  onClick={onClose}
/>
```

---

## Поля ввода (Input / Select / Textarea)

### Обязательные правила

- Используй `Input/Select/Textarea` из `shared/ui`.
- Label делай через `<label>` и `htmlFor`, когда это возможно.
- Не повторяй вручную `focus:ring-*` — базовые стили уже в компонентах.

### Пример

```tsx
import { Input, Select, Textarea } from '@/shared/ui';

<label htmlFor="title">Title</label>
<Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />

<Select value={sort} onChange={(e) => setSort(e.target.value)}>
  <option value="newest">Newest</option>
</Select>

<Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
```

---

## Фокус и клавиатура (A11y)

### focus-visible

Глобально в `src/index.css` задан единый `:focus-visible` ring.  
Не добавляй/не убирай outline без необходимости. Если делаешь кастомный фокус — он должен быть **видим** на dark/light/glass.

### Modal

Используй **только** `src/shared/ui/Modal/Modal.tsx`:

- **Esc закрывает** (по умолчанию) и работает корректно для вложенных модалок.
- **Tab/Shift+Tab** — trap внутри модалки.
- **Фокус**:
  - при открытии идёт на первый фокусируемый элемент (fallback — на dialog)
  - при закрытии возвращается на элемент-источник
- ARIA: `role="dialog"`, `aria-modal`, `aria-label` / `aria-labelledby`

Правило:
- Передавай `ariaLabelledBy`, если есть видимый заголовок (`id` на `<h2>`).
- Иначе — `ariaLabel`.

### Меню / Dropdown

Минимальный стандарт:

- Кнопка-триггер: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`
- Попап: `role="menu"`
- Элементы: `role="menuitem"`
- **Esc закрывает** и возвращает фокус на триггер
- **ArrowUp/ArrowDown/Home/End** перемещают фокус внутри меню (если это меню, а не просто список)

### Tabs

Для вкладок используем ARIA Tabs:

- контейнер: `role="tablist"`
- кнопка: `role="tab"` + `aria-selected` + `aria-controls` + roving `tabIndex`
- панель: `role="tabpanel"` + `aria-labelledby` + `hidden`, если не активна
- клавиатура: **ArrowLeft/ArrowRight/Home/End**

См. реализацию как эталон: `src/features/settings/SettingsPage.tsx`, `src/features/submit/SubmitPage.tsx`.

---

## Состояния Loading / Empty / Error

### Loading

- Не показываем голый текст `Loading...`.
- Используем `Spinner` + текст (обычно `t('common.loading')`).

```tsx
import { Spinner } from '@/shared/ui';

<div className="flex items-center justify-center gap-3 py-10 text-gray-600 dark:text-gray-300">
  <Spinner className="h-5 w-5" />
  <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
</div>
```

### Empty state

- Используем `surface`/`glass` блок, короткий заголовок + подсказка/CTA.
- Если пустота из‑за фильтров — добавь **Clear filters**.

### Errors

- Для “локальных” ошибок — `toast.error(...)`.
- Для page-level ошибок — `surface` блок с текстом и безопасным CTA (например “Go home”).

---

## Бейджи / счётчики / статусы

### Pill

Для счётчиков, статусов, небольших меток:

```tsx
import { Pill } from '@/shared/ui';

<Pill variant="danger">3</Pill>
<Pill variant="success">approved</Pill>
```

Для “notification”-бейджей (маленькие плотные счетчики/дельты поверх иконок):

```tsx
import { Pill } from '@/shared/ui';

<Pill variant="dangerSolid">12</Pill>
<Pill variant="successSolid">+50</Pill>
```

### AttemptsPill

Для “оставшихся попыток”/ресабмитов:

```tsx
import { AttemptsPill } from '@/shared/ui';

<AttemptsPill left={1} max={2} />
```

---

## Навигация: Link vs <a>

- Внутри приложения для роутов (`/terms`, `/privacy`, `/dashboard`, …) — **`Link`**.
- `<a>` — только для внешних URL.

---

## App layout: Footer

- `Footer` рендерится **один раз глобально** в `src/App.tsx`.
- Поэтому страницы/фичи **не должны** вручную добавлять `<Footer />` в JSX (иначе легко получить двойной футер).

---

## Темизация (primary/secondary/accent)

- Цвета темы приходят через CSS variables: `--primary-color`, `--secondary-color`, `--accent-color`.
- Избегай tailwind-опацити модификаторов на классах, где цвет — `var(...)` (например `border-secondary/30` может вести себя неожиданно).
- На public channel страницах, если нужен безопасный tint — используй `color-mix(...)` (см. паттерн в `StreamerProfilePage`).

---

## Чеклист для PR

- **UI**: использованы `shared/ui` компоненты вместо ручных элементов
- **A11y**:
  - есть `aria-label` на icon-only
  - toggle → `aria-pressed`
  - меню/модалки закрываются по Esc, фокус возвращается
  - табы работают стрелками
- **States**: есть нормальные loading/empty блоки (Spinner + surface/glass)
- **Навигация**: внутренние ссылки через `Link`


