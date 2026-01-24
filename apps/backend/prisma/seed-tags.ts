import type { PrismaClient } from '@prisma/client';

type TagSeed = {
  name: string;
  display: string;
  aliases: string[];
};

type CategorySeed = {
  displayName: string;
  sortOrder?: number;
  tags: TagSeed[];
};

export const INITIAL_CATALOG: Record<string, CategorySeed> = {
  mood: {
    displayName: 'Настроение',
    sortOrder: 0,
    tags: [
      { name: 'funny', display: 'Смешное', aliases: ['смешной', 'humor', 'lol', 'угар', 'ржака'] },
      { name: 'sad', display: 'Грустное', aliases: ['грустный', 'печаль', 'депрессия'] },
      { name: 'epic', display: 'Эпичное', aliases: ['эпик', 'legendary', 'крутой'] },
      { name: 'cringe', display: 'Кринж', aliases: ['кринжовый', 'awkward'] },
      { name: 'wholesome', display: 'Душевное', aliases: ['милый', 'cute', 'добрый'] },
      { name: 'scary', display: 'Страшное', aliases: ['horror', 'хоррор', 'жуткий'] },
      { name: 'hype', display: 'Хайп', aliases: ['viral', 'хайповый'] },
      { name: 'cursed', display: 'Проклятое', aliases: ['cursed_image', 'проклятый'] },
      { name: 'nostalgic', display: 'Ностальгия', aliases: ['олдскул', 'oldschool'] },
    ],
  },
  intent: {
    displayName: 'Цель',
    sortOrder: 1,
    tags: [
      { name: 'troll', display: 'Потроллить', aliases: ['троллинг', 'стеб', 'троль'] },
      { name: 'support', display: 'Поддержать', aliases: ['поддержка', 'wholesome'] },
      { name: 'hurry', display: 'Поторопить', aliases: ['давай', 'быстрее', 'го'] },
      { name: 'celebrate', display: 'Победа', aliases: ['victory', 'win', 'pog', 'погчамп'] },
      { name: 'fail', display: 'Фейл', aliases: ['oof', 'rip', 'F', 'провал'] },
      { name: 'vibe', display: 'Вайб', aliases: ['chill', 'расслабон'] },
      { name: 'react', display: 'Реакция', aliases: ['reaction', 'bruh'] },
    ],
  },
  content_type: {
    displayName: 'Тип контента',
    sortOrder: 2,
    tags: [
      { name: 'music', display: 'Музыка', aliases: ['музыкальный', 'song', 'песня'] },
      { name: 'sound_effect', display: 'Звуковой эффект', aliases: ['звук', 'sfx', 'эффект'] },
      { name: 'dialogue', display: 'Диалог', aliases: ['речь', 'цитата', 'разговор'] },
      { name: 'earrape', display: 'Earrape', aliases: ['громкий', 'loud'] },
      { name: 'remix', display: 'Ремикс', aliases: ['mashup', 'микс'] },
      { name: 'vine', display: 'Вайн', aliases: ['вайн'] },
    ],
  },
  source: {
    displayName: 'Источник',
    sortOrder: 3,
    tags: [
      { name: 'tiktok', display: 'TikTok', aliases: ['тикток'] },
      { name: 'youtube', display: 'YouTube', aliases: ['ютуб', 'yt'] },
      { name: 'movie', display: 'Фильм', aliases: ['кино', 'cinema', 'фильм'] },
      { name: 'tv_show', display: 'Сериал', aliases: ['сериал', 'show'] },
      { name: 'anime', display: 'Аниме', aliases: ['аниме'] },
      { name: 'game', display: 'Игра', aliases: ['gaming', 'геймплей', 'игра'] },
      { name: 'cartoon', display: 'Мультфильм', aliases: ['мультик', 'animation'] },
      { name: 'stream', display: 'Стрим', aliases: ['twitch', 'clip', 'клип'] },
    ],
  },
  theme: {
    displayName: 'Тема',
    sortOrder: 4,
    tags: [
      { name: 'animals', display: 'Животные', aliases: ['pets', 'животные'] },
      { name: 'cat', display: 'Кот', aliases: ['котик', 'кошка'] },
      { name: 'dog', display: 'Собака', aliases: ['пёс', 'собачка'] },
      { name: 'food', display: 'Еда', aliases: ['еда', 'food'] },
      { name: 'sports', display: 'Спорт', aliases: ['футбол', 'sport'] },
      { name: 'cars', display: 'Машины', aliases: ['авто', 'cars'] },
    ],
  },
  meme_format: {
    displayName: 'Мем-формат',
    sortOrder: 5,
    tags: [
      { name: 'bruh', display: 'Bruh', aliases: ['бра', 'bruh_moment'] },
      { name: 'sigma', display: 'Sigma', aliases: ['сигма', 'gigachad', 'гигачад'] },
      { name: 'skibidi', display: 'Skibidi', aliases: ['скибиди'] },
      { name: 'ohio', display: 'Ohio', aliases: ['огайо', 'only_in_ohio'] },
      { name: 'bonk', display: 'Bonk', aliases: ['бонк'] },
      { name: 'oof', display: 'Oof', aliases: ['уф'] },
      { name: 'rickroll', display: 'Рикролл', aliases: ['rick_roll', 'rick_astley'] },
    ],
  },
};

function normalizeAlias(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_');
}

export async function seedTagCatalog(prisma: PrismaClient): Promise<void> {
  const categoryEntries = Object.entries(INITIAL_CATALOG);
  const categoryIdBySlug = new Map<string, string>();

  for (const [slug, category] of categoryEntries) {
    const cat = await prisma.tagCategory.upsert({
      where: { slug },
      update: {
        displayName: category.displayName,
        sortOrder: category.sortOrder ?? 0,
      },
      create: {
        slug,
        displayName: category.displayName,
        sortOrder: category.sortOrder ?? 0,
      },
      select: { id: true, slug: true },
    });
    categoryIdBySlug.set(cat.slug, cat.id);
  }

  const tagDefs = categoryEntries.flatMap(([categorySlug, category]) =>
    category.tags.map((tag) => ({ ...tag, categorySlug }))
  );
  const tagNames = tagDefs.map((tag) => tag.name);

  const existingTags = await prisma.tag.findMany({
    where: { name: { in: tagNames } },
    select: { id: true, name: true, displayName: true, categoryId: true },
  });
  const existingByName = new Map(existingTags.map((tag) => [tag.name, tag]));

  const toCreate = tagDefs
    .filter((tag) => !existingByName.has(tag.name))
    .map((tag) => ({
      name: tag.name,
      displayName: tag.display.slice(0, 80),
      categoryId: categoryIdBySlug.get(tag.categorySlug) ?? null,
    }));
  if (toCreate.length > 0) {
    await prisma.tag.createMany({ data: toCreate, skipDuplicates: true });
  }

  for (const tag of tagDefs) {
    const existing = existingByName.get(tag.name);
    if (!existing) continue;
    const data: { displayName?: string; categoryId?: string | null } = {};
    if (!existing.displayName && tag.display) {
      data.displayName = tag.display.slice(0, 80);
    }
    if (!existing.categoryId) {
      data.categoryId = categoryIdBySlug.get(tag.categorySlug) ?? null;
    }
    if (Object.keys(data).length > 0) {
      await prisma.tag.update({ where: { id: existing.id }, data });
    }
  }

  const allTags = await prisma.tag.findMany({ where: { name: { in: tagNames } }, select: { id: true, name: true } });
  const idByName = new Map(allTags.map((tag) => [tag.name, tag.id]));

  for (const tag of tagDefs) {
    const tagId = idByName.get(tag.name);
    if (!tagId) continue;
    for (const aliasRaw of tag.aliases) {
      const alias = normalizeAlias(aliasRaw);
      if (!alias || alias === tag.name) continue;
      await prisma.tagAlias.upsert({
        where: { alias },
        update: { tagId },
        create: { alias, tagId },
      });
    }
  }
}
