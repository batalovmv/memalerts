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
- **`.surface` / `.surface-hover`**: "карточная" поверхность приложения
- **`.glass` / `.glass-btn`**: стекло/контролы в glass стиле (использовать умеренно)
  - ✨ **Для попапов/меню**: используй просто `.glass` для красивого размытия фона (см. раздел "Меню / Dropdown")

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

Исключение (редко):
- Для “плотных” инженерных панелей со множеством мелких контролов (например **OBS overlay настройки**),
  допускается использовать нативные `select`/`input[type=range]`/`input[type=color]`/`input[type=checkbox]`, если:
  - у элементов есть **единый визуальный стиль** (padding/radius/фон/контраст) и нормальный `:focus-visible`
  - логика/UX выигрышнее, чем массовая замена на абстракции
  - элементы не дублируют полностью существующие `shared/ui` компоненты (например “обычный” текстовый инпут — всё равно `Input`)

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

Минимальный стандарт ARIA:

- Кнопка-триггер: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`
- Попап: `role="menu"`
- Элементы: `role="menuitem"`
- **Esc закрывает** и возвращает фокус на триггер
- **ArrowUp/ArrowDown/Home/End** перемещают фокус внутри меню (если это меню, а не просто список)

#### Визуальный стиль popup меню (фиксированный стандарт)

Все выпадающие меню/попапы должны использовать **единый стиль с размытием фона**:

```tsx
// Пример для page-level меню (Settings, Dashboard и т.д.)
{isOpen && (
  <>
    {/* Backdrop: предотвращает проблемы с кликами и делает поведение предсказуемым */}
    <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} aria-hidden="true" />

    <div
      role="menu"
      className="absolute right-0 mt-2 w-56 glass rounded-xl shadow-xl ring-1 ring-black/5 dark:ring-white/10 py-2 z-20"
    >
      {/* Содержимое меню */}
    </div>
  </>
)}

// Для header/глобальных меню используй z-40 для backdrop, z-50 для popup
```

**Ключевые правила:**

1. **Backdrop обязателен**: `<div className="fixed inset-0 z-[N]" onClick={...} aria-hidden="true" />`
   - Предотвращает проблемы с "невидимыми слоями"
   - Делает клик вне меню предсказуемым
   - **Z-index зависит от контекста**:
     - Header/глобальные меню: backdrop `z-40`, popup `z-50`
     - Page-level меню: backdrop `z-10`, popup `z-20`
     - Popup всегда на 10 единиц выше backdrop

2. **Размытие фона**: просто `glass`
   - ✨ Используй ТОЛЬКО `glass` для красивого размытия
   - НЕ добавляй дополнительные `bg-*` классы - они уменьшают размытие
   - `glass` обеспечивает идеальный баланс прозрачности и читаемости

3. **Тень и обводка**: `shadow-xl ring-1 ring-black/5 dark:ring-white/10`
   - Тень для отделения от контента
   - Тонкая обводка для чёткости границ

4. **Скругление**: `rounded-xl` (единообразно с другими поверхностями)

См. эталонную реализацию: `src/widgets/user-menu/UserMenu.tsx`

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

Нюанс:
- В дефолтных текстах используем **`Loading…`** (типографский символ `…`) для единообразия.

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

Практика:
- **Не используем** `<a href="/...">` для внутренних страниц — это ломает SPA-навигацию (перезагрузка/сброс скролла) и обходит `react-router`.

---

## App layout: Footer

- `Footer` рендерится **один раз глобально** в `src/App.tsx`.
- Поэтому страницы/фичи **не должны** вручную добавлять `<Footer />` в JSX (иначе легко получить двойной футер).

---

## App layout: Background (важно для футера)

- Декоративный background для “обычных” страниц рисуется **глобально в `src/App.tsx`**, чтобы фон **продолжался под футером**.
- Для публичных channel страниц (`/channel/:slug`) фон задаётся **на самой странице** (через `PageShell variant="channel"` + `background`), поэтому глобальный фон там отключён.

---

## Темизация (primary/secondary/accent)

- Цвета темы приходят через CSS variables: `--primary-color`, `--secondary-color`, `--accent-color`.
- Избегай tailwind-опацити модификаторов на классах, где цвет — `var(...)` (например `border-secondary/30` может вести себя неожиданно).
- На public channel страницах, если нужен безопасный tint — используй `color-mix(...)` (см. паттерн в `StreamerProfilePage`).

Практика:
- Для “тонких разделителей” и лёгких обводок по умолчанию используем **нейтральные** токены:
  - `border-black/5 dark:border-white/10`
  - `ring-1 ring-black/5 dark:ring-white/10`
  Так контраст предсказуем на light/dark и не зависит от CSS vars темы.

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
- **Попапы/Dropdown меню**:
  - есть backdrop (`fixed inset-0` с правильным z-index для контекста)
  - размытие: просто `glass` (БЕЗ дополнительных `bg-*` классов)
  - тень и обводка: `shadow-xl ring-1 ring-black/5 dark:ring-white/10`
  - popup на 10 единиц z-index выше backdrop

---

## Settings: единый дизайн большого блока

Цель: настройки выглядят как **единый "большой блок"**, без вложенных "карточек внутри карточек".

- **Page-level**: `SettingsPage` уже оборачивает содержимое в **один общий `surface` контейнер** и даёт паддинги.
- **Табы (`src/features/settings/tabs/*`)**:
  - **НЕ добавляй** внешнюю обёртку `className="surface p-6"` в корне таба (иначе получится двойной `surface`).
  - Внутри таба используй:
    - `glass` для секций/панелей/настроек
    - `Card`/`surface` — только для отдельных карточек внутри таба, когда это реально отдельный блок (например список элементов)

### Таб-бар (фиксированный стиль)

**Структура:**
```tsx
<div className="flex items-center border-b border-black/5 dark:border-white/10 px-3 sm:px-6">
  {/* Tabs scroller */}
  <div className="flex-1 overflow-x-auto whitespace-nowrap no-scrollbar">
    <div className="flex gap-2 sm:gap-3 items-center" role="tablist">
      {/* Основные табы */}
    </div>
  </div>
  
  {/* More menu с визуальным разделителем */}
  <div className="relative flex-shrink-0 ml-2 border-l border-black/5 dark:border-white/10 pl-3">
    {/* Кнопка "More" */}
  </div>
</div>
```

**Стили кнопок табов:**

1. **Активный таб:**
   ```tsx
   className="px-4 py-2.5 rounded-lg transition-all text-sm font-medium whitespace-nowrap bg-primary text-white shadow-sm"
   ```
   - ✨ Яркий акцент: белый текст на цветном фоне
   - Легкая тень для глубины
   - font-medium для читаемости

2. **Неактивный таб:**
   ```tsx
   className="px-4 py-2.5 rounded-lg transition-all text-sm font-medium whitespace-nowrap text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50"
   ```
   - Заметный hover эффект
   - Полупрозрачный фон на dark theme

3. **Кнопка "More" (три точки):**
   ```tsx
   // Активная (если выбран таб из меню)
   className="p-2.5 rounded-lg transition-all bg-primary text-white shadow-sm"
   
   // Неактивная
   className="p-2.5 rounded-lg transition-all text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50 hover:text-gray-900 dark:hover:text-gray-200"
   ```
   - Компактнее основных табов (p-2.5 вместо px-4 py-2.5)
   - Отделена border-l разделителем

4. **Элементы dropdown меню "More":**
   ```tsx
   className="w-full text-left px-4 py-2.5 text-sm font-medium transition-colors rounded-md mx-1 bg-primary/10 text-primary" // активный
   className="w-full text-left px-4 py-2.5 text-sm font-medium transition-colors rounded-md mx-1 text-gray-700 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10" // неактивный
   ```
   - rounded-md для элементов внутри меню
   - mx-1 для отступов от краёв

**Spacing:**
- Gap между табами: `gap-2 sm:gap-3`
- Padding контейнера: `px-3 sm:px-6`
- Разделитель перед "More": `ml-2 border-l pl-3`

**Правила:**
- НЕ используй `border-secondary/30` и подобные opacity-модификаторы на CSS vars (см. раздел "Темизация")
- Активный таб = `bg-primary text-white` (не `bg-primary/10`)
- Всегда `font-medium` для читаемости
- `whitespace-nowrap` на табах для предотвращения переноса
- `transition-all` для плавных анимаций

См. эталонную реализацию: `src/features/settings/SettingsPage.tsx`



