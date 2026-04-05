export interface CategoryConfig {
  name: string;
  keywords: string[];
  avgDaysToSell: number;
}

export const CATEGORIES: Record<string, CategoryConfig> = {
  apple: {
    name: 'Apple',
    keywords: ['ipad pro', 'macbook', 'macbook pro', 'macbook air', 'ipad air'],
    avgDaysToSell: 7,
  },
  telescopes: {
    name: 'Telescopes',
    keywords: ['celestron', 'telescope', 'nexstar'],
    avgDaysToSell: 21,
  },
  '3d_printers': {
    name: '3D Printers',
    keywords: ['bambu', 'bambu lab', 'bambu labs', 'p1s', 'x1c', 'a1 mini'],
    avgDaysToSell: 14,
  },
};

export const ALL_KEYWORDS = Object.values(CATEGORIES).flatMap((c) => c.keywords);

export function findCategory(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [key, config] of Object.entries(CATEGORIES)) {
    if (config.keywords.some((kw) => lower.includes(kw))) {
      return key;
    }
  }
  return null;
}
