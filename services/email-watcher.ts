import { fetchUnreadAlerts, deleteMessage } from './gmail/client';
import { parseWithFallback } from './gmail/parsers';
import { createServiceClient } from '../lib/supabase/service';
import { getCategories, findCategorySync } from '../lib/constants';

const POLL_INTERVAL_MS = 30_000;
const supabase = createServiceClient();

async function processAlerts(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Polling for new alerts...`);

  const emails = await fetchUnreadAlerts('is:unread {from:erdabo@gmail.com from:classifieds@ksl.com from:notification@facebookmail.com}');

  if (emails.length === 0) {
    return;
  }

  console.log(`Found ${emails.length} unread alerts`);

  for (const email of emails) {
    try {
      const source = email.from.toLowerCase().includes('facebook')
        ? 'facebook' as const
        : 'ksl' as const;

      const listings = await parseWithFallback(email.subject, email.body, source);
      const categories = await getCategories(supabase);

      for (const listing of listings) {
        const category = findCategorySync(listing.title, categories);

        const { error } = await supabase
          .from('stc_listings')
          .upsert(
            {
              ...listing,
              parsed_category: category,
              first_seen_at: new Date().toISOString(),
              status: 'new',
            },
            { onConflict: 'source,source_id' }
          );

        if (error) {
          console.error(`Insert error for ${listing.source_id}:`, error.message);
        }
      }

      await deleteMessage(email.id);
      console.log(`Processed email: ${email.subject} (${listings.length} listings)`);
    } catch (err) {
      console.error(`Error processing email ${email.id}:`, err);
    }
  }
}

let running = true;

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  running = false;
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  running = false;
});

async function main(): Promise<void> {
  console.log('Email watcher started');

  while (running) {
    try {
      await processAlerts();
    } catch (err) {
      console.error('Poll cycle error:', err);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  console.log('Email watcher stopped');
}

main();
