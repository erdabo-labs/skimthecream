import type { Category } from './types';

// Hardcoded fallback — used when DB isn't available (e.g. first run)
const DEFAULT_CATEGORIES: Category[] = [
  { id: 0, slug: 'apple', name: 'Apple', keywords: ['ipad pro', 'macbook', 'macbook pro', 'macbook air', 'ipad air', 'iphone'], avg_days_to_sell: 7, active: true, created_at: '', updated_at: '' },
  { id: 0, slug: 'telescopes', name: 'Telescopes', keywords: ['celestron', 'telescope', 'nexstar'], avg_days_to_sell: 21, active: true, created_at: '', updated_at: '' },
  { id: 0, slug: '3d_printers', name: '3D Printers', keywords: ['bambu', 'bambu lab', 'bambu labs', 'p1s', 'x1c', 'a1 mini'], avg_days_to_sell: 14, active: true, created_at: '', updated_at: '' },
];

// In-memory cache with TTL
let cachedCategories: Category[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getCategories(supabase: { from: (table: string) => any }): Promise<Category[]> {
  if (cachedCategories && Date.now() < cacheExpiry) {
    return cachedCategories;
  }

  try {
    const { data } = await supabase
      .from('stc_categories')
      .select('*')
      .eq('active', true)
      .order('name');

    if (data && data.length > 0) {
      cachedCategories = data;
      cacheExpiry = Date.now() + CACHE_TTL;
      return data;
    }
  } catch {
    // DB not available, use defaults
  }

  return DEFAULT_CATEGORIES;
}

export function findCategorySync(text: string, categories: Category[]): string | null {
  const lower = text.toLowerCase();
  for (const cat of categories) {
    if (cat.keywords.some((kw) => lower.includes(kw))) {
      return cat.slug;
    }
  }
  return null;
}

// Legacy sync version using defaults only (for contexts where async isn't possible)
export function findCategory(text: string): string | null {
  return findCategorySync(text, DEFAULT_CATEGORIES);
}
