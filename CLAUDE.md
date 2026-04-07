# SkimTheCream

AI-powered deal-finding and flipping assistant. Monitors Facebook Marketplace (via Chrome extension) and KSL Classifieds (via Gmail alerts), scores deals against market value using AI + observed data, and provides a mobile-first webapp for deal review, negotiation coaching, inventory tracking, and profit reporting.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **Backend:** Supabase (no RLS — single-user personal tool)
- **AI:** OpenAI (gpt-4o-mini for parsing/scoring/normalization, gpt-4o for negotiation/listing generation/price estimates)
- **Notifications:** ntfy.sh (JSON body format, great deals only, action buttons for listing + app)
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
npm run dev:price-scraper           # run price scraper locally
npm run dev:deal-scorer             # run deal scorer locally
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

- `lib/` — shared code (Supabase clients, types, scoring, OpenAI helpers, ntfy, constants)
- `app/` — Next.js pages: home (command center + search), watch, inventory (manual entry + AI estimates), products, negotiate, sell, reports, prices
- `app/api/` — API routes: health, listing generation, negotiate, estimate (AI price estimation)
- `components/` — React components (deal-card, score-badge, stat-card, chat-interface, nav)
- `services/` — Background services (email-watcher, deal-scorer, price-scraper, listing-monitor)
- `services/gmail/` — Gmail OAuth + email parsers (Facebook + KSL)
- `extension/` — Chrome extension (fb-scraper.js, ksl-scraper.js, background.js, popup)
- `scripts/` — run-service.sh (env loader for launchd), gmail-auth.ts
- `supabase/migrations/` — SQL migrations (001-006)
- `plists/` — launchd plist files (email-watcher, deal-scorer, price-scraper, listing-monitor)

## Database Tables (all prefixed `stc_`)

- `stc_listings` — marketplace listings from email alerts + extension. Key fields: parsed_product, parsed_storage, parsed_category, parsed_condition, score, estimated_profit, price_source, feedback, feedback_note, first_seen_at, last_seen_at, gone_at, days_active, status (new/contacted/purchased/dismissed)
- `stc_market_prices` — market values by product. Sources: 'observed' (from listings), 'manual' (user set)
- `stc_categories` — dynamic watchlist categories with keywords (managed via /watch page)
- `stc_product_intel` — per-product user context: notes, difficulty, price_floor, price_ceiling, tags
- `stc_inventory` — purchased items tracked through sale. Supports manual entry with notes, target_sell_price, ai_estimated_value
- `stc_negotiations` — AI negotiation chat histories

## Scoring Pipeline (deal-scorer.ts)

The scorer runs every 2 minutes via launchd. For each unscored listing:

1. **Skip garbage** — titles like "Just listed" or < 4 chars auto-dismissed
2. **Fetch description** — scorer fetches listing page server-side if no description stored (extension can't reliably pass FB cookies)
3. **AI Step 1: "What is being sold?"** — plain English answer forces AI to understand the actual item before extracting specs. Prevents model-name confusion (e.g. "Bambu P1S nozzles" ≠ a P1S printer)
4. **Relevance gate** — must match a watched category or get dismissed
5. **AI Step 2: Extract specs** — baseModel, condition, year, processor from title+description. Known products list loaded for matching consistency
6. **Filter gates** — accessories, damaged, rentals, wanted, parts-condition all auto-passed
7. **Pricing** — manual/ceiling (60%) > observed median (40%) > AI estimate (fallback)
8. **AI-only pricing capped at "good"** — never "great". Requires 35%+ off and $150+ profit for "good". AI estimates are too unreliable for high-confidence scores.
9. **Condition multiplier** — like_new=1.0, good=0.9, fair=0.75, poor=0.55, parts=0.25
10. **ntfy alert** — great deals only, with "View Listing" and "Open App" action buttons

## Listing Monitor (listing-monitor.ts)

Overnight service (3am via launchd) that checks if listings are still live. When a listing goes down:
- Records `gone_at` timestamp and `days_active`
- Updates `avg_days_to_sell` on categories from real data
- Auto-infers product difficulty (easy/moderate/hard) from sell speed

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
- Products page groups by category with collapsible sections
- Deal cards have visual hierarchy: great=emerald glow, good=amber, pass=collapsed

## Git Conventions

Follow monorepo conventions from parent `CLAUDE.md`:
- Conventional commits: `type(stc): description`
- Branch naming: `feat/stc/description`, `fix/stc/description`
- Currently pushing directly to main (owner preference for this project)
