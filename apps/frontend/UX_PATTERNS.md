# UX Паттерны - Быстрая справка

## Готовые паттерны из реализованного кода

### 1. Модальное окно с формой

```tsx
// Состояние
const [modal, setModal] = useState<{ open: boolean; id: string | null }>({
  open: false,
  id: null,
});

// Открытие
const openModal = (id: string) => {
  setModal({ open: true, id });
};

// Структура модалки
{modal.open && (
  <div className="fixed inset-0 z-50 overflow-y-auto">
    <div className="fixed inset-0 bg-black/50" onClick={closeModal} />
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full">
        {/* Header, Content, Footer */}
      </div>
    </div>
  </div>
)}
```

### 2. Валидация формы

```tsx
const handleSubmit = async () => {
  const value = parseInt(form.value, 10);
  
  if (isNaN(value) || value < 1) {
    toast.error('Value must be at least 1');
    return;
  }
  
  // Отправка
};
```

### 3. Превью файла

```tsx
const [filePreview, setFilePreview] = useState<string | null>(null);

const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (file) {
    const reader = new FileReader();
    reader.onloadend = () => {
      setFilePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  }
};

{filePreview && (
  <video src={filePreview} controls className="max-w-full max-h-64" />
)}
```

### 4. Кнопка на карточке при hover

```tsx
{isHovered && onActivate && (
  <div className="absolute bottom-0 left-0 right-0 bg-black/90 text-white p-3">
    <button
      onClick={(e) => {
        e.stopPropagation(); // Важно!
        onActivate(id);
      }}
      disabled={!canActivate}
      className={canActivate ? 'bg-green-600' : 'bg-gray-600 cursor-not-allowed'}
    >
      {canActivate ? 'Activate' : 'Insufficient Coins'}
    </button>
  </div>
)}
```

### 5. Блок баланса

```tsx
<div className="bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl shadow-lg p-6 text-white">
  <p className="text-purple-100 text-sm mb-1">Your Balance</p>
  <div className="text-4xl font-bold">
    {balance} <span className="text-2xl text-purple-200">coins</span>
  </div>
</div>
```

### 6. Информационный блок

```tsx
<div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
  <p className="text-sm text-blue-800 dark:text-blue-200">
    <strong>What happens next?</strong> Your submission will be reviewed...
  </p>
</div>
```

### 7. Иерархия карточек

```tsx
{/* Primary */}
<div className="shadow-xl border-2 border-primary/20">
  <h2 className="text-2xl font-bold">Title</h2>
</div>

{/* Secondary */}
<div className="shadow-md">
  <h2 className="text-xl font-semibold">Title</h2>
</div>

{/* Tertiary */}
<div className="shadow opacity-90">
  <h2 className="text-lg font-medium">Title</h2>
</div>
```

### 8. Бейдж с количеством

```tsx
<div className="flex items-center justify-between">
  <h2>Title</h2>
  {count > 0 && (
    <span className="bg-red-500 text-white text-sm font-bold rounded-full px-3 py-1">
      {count}
    </span>
  )}
</div>
```

---

## Быстрые правила

1. **Модалки:** Backdrop + Header + Content + Footer
2. **Валидация:** Проверка перед отправкой + toast.error
3. **Превью:** FileReader.readAsDataURL
4. **Hover кнопки:** e.stopPropagation() обязательно
5. **Иерархия:** Primary (xl) > Secondary (md) > Tertiary (sm)
6. **Инфо блоки:** Синий для информации, красный для предупреждения

---

**Полная версия:** [UX_IMPLEMENTATION_GUIDE.md](./UX_IMPLEMENTATION_GUIDE.md)

