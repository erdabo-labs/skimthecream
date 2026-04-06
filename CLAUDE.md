# SkimTheCream

AI-powered deal-finding and flipping assistant. Monitors Facebook Marketplace (via Chrome extension) and KSL Classifieds (via Gmail alerts), scores deals against market value using AI + observed data, and provides a mobile-first webapp for deal review, negotiation coaching, inventory tracking, and profit reporting.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **Backend:** Supabase (no RLS — single-user personal tool)
- **AI:** OpenAI (gpt-4o-mini for parsing/scoring/normalization, gpt-4o for negotiation/listing generation)
- **Notifications:** ntfy.sh (JSON body format, great deals only)
- **Background Services:** launchd (macOS), compiled via `tsconfig.services.json`, env loaded via `scripts/run-service.sh`
- **Browser Extension:** Chrome Manifest V3 — scrapes FB Marketplace and KSL from logged-in browser tabs
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
- `app/` — Next.js pages: home (command center), watch, inventory, products, negotiate, sell, reports, prices
- `components/` — React components (deal-card, score-badge, stat-card, chat-interface, nav)
- `services/` — Background services (email-watcher, deal-scorer, price-scraper)
- `services/gmail/` — Gmail OAuth + email parsers (Facebook + KSL)
- `extension/` — Chrome extension (fb-scraper.js, ksl-scraper.js, background.js, popup)
- `scripts/` — run-service.sh (env loader for launchd), gmail-auth.ts
- `supabase/migrations/` — SQL migrations (001-004)
- `plists/` — launchd plist files (email-watcher, deal-scorer, price-scraper)

## Database Tables (all prefixed `stc_`)

- `stc_listings` — marketplace listings from email alerts + extension. Key fields: parsed_product, parsed_storage, parsed_category, score, estimated_profit, price_source, feedback, feedback_note, status (new/contacted/purchased/dismissed)
- `stc_market_prices` — market values by product. Sources: 'observed' (from listings), 'manual' (user set)
- `stc_categories` — dynamic watchlist categories with keywords (managed via /watch page)
- `stc_product_intel` — per-product user context: notes, difficulty, price_floor, price_ceiling, tags
- `stc_inventory` — purchased items tracked through sale
- `stc_negotiations` — AI negotiation chat histories

## Scoring System

Multi-signal pricing (weighted): manual/user ceiling (60%) > observed median (40%) > AI estimate (fallback).
AI normalization separates base model from storage (iPhone 13 Pro ≠ iPhone 13 Pro Max).
Auto-skips: accessories, damaged items, rentals, wanted posts.
Scores: great (30%+ off, $200+ profit), good (15%+ off, $50+ profit), pass.
Alerts only fire for great deals via ntfy.

## Vercel Env Vars

IMPORTANT: NEXT_PUBLIC_ env vars must NOT have quotes in the value on Vercel.
Both SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL must be set (server + client).
The lib/supabase/client.ts and server.ts have stripQuotes() as a defensive measure.

## Key Patterns

- Email watcher query: `is:unread {from:erdabo@gmail.com from:classifieds@ksl.com from:notification@facebookmail.com}`
- Gmail account: agent.erdabo@gmail.com (OAuth token in gmail-token.json, gitignored)
- Chrome extension writes directly to Supabase via REST API (anon key in extension storage)
- Homepage (/) is the deal command center — /deals redirects to /
- Products page groups by category with collapsible sections
- Deal cards have visual hierarchy: great=emerald glow, good=amber, pass=collapsed

## Git Conventions

Follow monorepo conventions from parent `CLAUDE.md`:
- Conventional commits: `type(stc): description`
- Branch naming: `feat/stc/description`, `fix/stc/description`
- Currently pushing directly to main (owner preference for this project)
