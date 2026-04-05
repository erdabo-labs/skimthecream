import { createServerClient } from '@/lib/supabase/server';
import { WatchClient } from './watch-client';

export const dynamic = 'force-dynamic';

export default async function WatchPage() {
  const supabase = createServerClient();

  const { data: categories } = await supabase
    .from('stc_categories')
    .select('*')
    .order('name');

  return <WatchClient categories={categories ?? []} />;
}
