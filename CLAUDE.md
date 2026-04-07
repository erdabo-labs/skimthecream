# SkimTheCream

AI-powered deal-finding and flipping assistant. Monitors Facebook Marketplace (via Chrome extension) and KSL Classifieds (via Gmail alerts), scores deals against market value using AI + observed data, and provides a mobile-first webapp for deal review, negotiation coaching, inventory tracking, and profit reporting.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **Backend:** Supabase (no RLS — single-user personal tool)
- **AI:** OpenAI (gpt-4o-mini for parsing/scoring/normalization, gpt-4o for negotiation/listing generation/market research)
- **Notifications:** ntfy.sh (JSON body format, high-confidence great deals only, action buttons for listing + app)
- **Background Services:** launchd (macOS), compiled via `tsconfig.services.json`, env loaded via `scripts/run-service.sh`
- **Browser Extension:** Chrome Manifest V3 — scrapes FB Marketplace and KSL from logged-in browser tabs (runs unattended)
- **Hosting:** Vercel (webapp), local MacBook (services + extension)

## Commands

```bash
# Webapp
npm run dev          # local dev server
npm run build        # production build
npm run lint         # eslint

# Background services
npm run build:services              # compile services to dist/
npm run dev:email-watcher           # run email watcher locally
npm run dev:deal-scorer             # run deal scorer locally
npm run dev:intelligence            # run intelligence refresh locally
npm run dev:listing-monitor         # run listing monitor locally
npm run services:install            # install launchd plists

# After changing service code:
npm run build:services
launchctl unload ~/Library/LaunchAgents/com.skimthecream.<service>.plist
launchctl load ~/Library/LaunchAgents/com.skimthecream.<service>.plist

# Deploy
vercel deploy                       # preview
vercel deploy --prod -y             # production (ask owner first)
```

## Architecture

- `lib/` — shared code (Supabase clients, types, OpenAI helpers, ntfy, product constants)
- `app/` — Next.js pages: home (command center + search), inventory (manual entry + AI estimates), products (pending/active/inactive management), negotiate, sell, reports
- `app/api/` — API routes: health, listing generation, negotiate, estimate (AI price estimation)
- `components/` — React components (deal-card, score-badge, stat-card, chat-interface, nav)
- `services/` — Background services (email-watcher, deal-scorer, intelligence, listing-monitor)
- `services/gmail/` — Gmail OAuth + email parsers (Facebook + KSL)
- `extension/` — Chrome extension (fb-scraper.js, ksl-scraper.js, background.js, popup)
- `scripts/` — run-service.sh (env loader for launchd), gmail-auth.ts
- `supabase/migrations/` — SQL migrations (001-007)
- `plists/` — launchd plist files (email-watcher, deal-scorer, intelligence, listing-monitor)

## Database Tables (all prefixed `stc_`)

- `stc_products` — **center of gravity**. One row per base product variant (e.g. "iPad Pro M4 11-inch", no storage in name). Fields: canonical_name, brand, model_line, tier, generation, status (pending/active/inactive), listing_count, pricing stats (avg/median/low/high asking prices), target_buy_price, ai_market_value, avg_days_to_sell, sell_velocity, avg_profit, times_sold, ease_rating, confidence (low/medium/high/very_high), notes, last_refreshed
- `stc_listings` — marketplace listings from email alerts + extension. Links to products via product_id FK. Key fields: parsed_product, parsed_storage, parsed_condition, score, estimated_profit, price_source, feedback, first_seen_at, last_seen_at, gone_at, days_active, status (new/contacted/purchased/dismissed)
- `stc_inventory` — purchased items tracked through sale. Links to products via product_id FK. Supports manual entry with notes, target_sell_price, ai_estimated_value
- `stc_negotiations` — AI negotiation chat histories

## Product Lifecycle

```
Listing ingested → AI normalizes to base product → Product exists?
  ├─ YES (active)    → Score against target_buy_price
  ├─ YES (inactive)  → Auto-dismiss
  └─ NO (new)        → Create product in 'pending' status
                        User reviews: Approve → active, Reject → inactive
```

Products are BASE VARIANTS — "iPad Pro M4 11-inch" not "iPad Pro M4 11-inch 256GB". Storage is extracted separately and used as a profit modifier.

## Scoring Pipeline (deal-scorer.ts)

The scorer runs every 2 minutes via launchd. For each unscored listing:

1. **Skip garbage** — titles like "Just listed" or < 4 chars auto-dismissed
2. **Fetch description** — scorer fetches listing page server-side if no description stored
3. **AI Reasoning** — smart prompt that reasons through ambiguity. "iPad 15 Pro" → "iPad Pro M4" based on description context. Returns canonical base product name, storage (separate), condition, flags
4. **Filter gates** — accessories, damaged, rentals, wanted, irrelevant, parts-condition all auto-dismissed
5. **Product lookup** — find or create product in stc_products (new products start as 'pending')
6. **Product status gate** — inactive=dismiss, pending=wait (no score), active=score
7. **Score** — compare asking_price to product.target_buy_price with condition multiplier + storage bonus
8. **Confidence-gated alerts** — ntfy only when product.confidence >= 'high' AND score = 'great'

## Intelligence Service (intelligence.ts)

Daily service (4am via launchd) that refreshes pricing intelligence for every active product:

1. Pull all listings → compute median/avg/low/high asking prices, listing_count
2. Pull gone_at data → compute avg_days_to_sell, sell_velocity (fast/moderate/slow)
3. AI market research (gpt-4o) → feed real observed data, get fair market value + buy-below price
4. Compute target_buy_price: user manual override > (observed 70% + AI 30%) * 0.65
5. Compute confidence: low (<5 listings) → medium (5-9) → high (10+) → very_high (10+ with sales)
6. Pull inventory sales → compute avg_profit, times_sold, ease_rating
7. Update product with all fields + last_refreshed

Gets smarter over time as more listings and sales data accumulates.

## Listing Monitor (listing-monitor.ts)

Overnight service (3am via launchd) that checks if listings are still live. When a listing goes down:
- Records `gone_at` timestamp and `days_active`
- Updates `avg_days_to_sell`, `sell_velocity`, `ease_rating` on stc_products from real data

## Vercel Env Vars

IMPORTANT: Env var values must NOT have quotes or trailing whitespace/newlines on Vercel.
Both SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL must be set (server + client).
The lib/supabase/client.ts and server.ts have cleanEnvVar() that strips quotes and trims whitespace.

## Key Patterns

- Email watcher query: `is:unread {from:erdabo@gmail.com from:classifieds@ksl.com from:notification@facebookmail.com}`
- Gmail account: agent.erdabo@gmail.com (OAuth token in gmail-token.json, gitignored)
- Chrome extension writes directly to Supabase via REST API (anon key in extension storage)
- Extension runs unattended on a MacBook Pro — auto-refreshes marketplace tabs every 5 min
- Extension marks listings as "seen" only AFTER successful Supabase ingest (retry on failure)
- Homepage (/) is the deal command center with search bar — /deals redirects to /
- Inventory page supports manual entry with AI price estimation (gpt-4o via /api/estimate)
- Products page has three sections: pending review, active (with intelligence data), inactive
- Deal cards have visual hierarchy: great=emerald glow, good=amber, pass=collapsed
- Nav has 3 tabs: Deals, Inventory, Products

## Git Conventions

Follow monorepo conventions from parent `CLAUDE.md`:
- Conventional commits: `type(stc): description`
- Branch naming: `feat/stc/description`, `fix/stc/description`
- Currently pushing directly to main (owner preference for this project)
