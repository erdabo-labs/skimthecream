import type { Product } from './types';

// In-memory cache with TTL
let cachedProducts: Product[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getActiveProducts(supabase: { from: (table: string) => any }): Promise<Product[]> {
  if (cachedProducts && Date.now() < cacheExpiry) {
    return cachedProducts;
  }

  try {
    const { data } = await supabase
      .from('stc_products')
      .select('*')
      .eq('status', 'active')
      .order('canonical_name');

    if (data && data.length > 0) {
      cachedProducts = data;
      cacheExpiry = Date.now() + CACHE_TTL;
      return data;
    }
  } catch {
    // DB not available
  }

  return [];
}

export async function getAllProducts(supabase: { from: (table: string) => any }): Promise<Product[]> {
  try {
    const { data } = await supabase
      .from('stc_products')
      .select('*')
      .order('canonical_name');

    return data ?? [];
  } catch {
    return [];
  }
}

export async function getProductByName(
  supabase: { from: (table: string) => any },
  canonicalName: string
): Promise<Product | null> {
  // Check cache first
  if (cachedProducts && Date.now() < cacheExpiry) {
    const found = cachedProducts.find(
      p => p.canonical_name.toLowerCase() === canonicalName.toLowerCase()
    );
    if (found) return found;
  }

  try {
    const { data } = await supabase
      .from('stc_products')
      .select('*')
      .ilike('canonical_name', canonicalName)
      .limit(1);

    if (data && data.length > 0) return data[0];
  } catch {
    // DB not available
  }

  return null;
}

// Invalidate cache (call after product status changes)
export function invalidateProductCache(): void {
  cachedProducts = null;
  cacheExpiry = 0;
}
