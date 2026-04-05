# SkimTheCream

AI-powered deal-finding and flipping assistant. Monitors Facebook Marketplace and KSL Classifieds via Gmail alerts, scores deals against market value, and provides a webapp for negotiation, inventory tracking, listing generation, and profit reporting.

## Tech Stack

- **Framework:** Next.js 15 (App Router) + TypeScript + Tailwind CSS
- **Backend:** Supabase (no RLS — single-user personal tool)
- **AI:** OpenAI (gpt-4o-mini for parsing/scoring, gpt-4o for negotiation/listings)
- **Notifications:** ntfy.sh
- **Background Services:** launchd (macOS), compiled via `tsconfig.services.json`
- **Hosting:** Vercel (webapp), local MacBook (services)

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

# Deploy
vercel deploy                       # preview
vercel deploy --prod -y             # production (ask owner first)

# Database
supabase db push                    # apply migrations
```

## Architecture

- `lib/` — shared code (Supabase clients, types, scoring, OpenAI helpers, ntfy)
- `app/` — Next.js pages (dashboard, deals, negotiate, inventory, sell, prices, reports)
- `components/` — React components
- `services/` — Background services (email-watcher, deal-scorer, price-scraper)
- `services/gmail/` — Gmail OAuth + parsers
- `services/scrapers/` — Price scrapers (Swappa, eBay)
- `supabase/migrations/` — SQL migrations
- `plists/` — launchd plist files

## Database Tables (all prefixed `stc_`)

- `stc_market_prices` — scraped/manual market values by product
- `stc_listings` — parsed deal listings from email alerts
- `stc_inventory` — purchased items tracked through sale
- `stc_negotiations` — AI negotiation chat histories

## Env Vars

See `.envrc.template` for required environment variables.

## Git Conventions

Follow monorepo conventions from parent `CLAUDE.md`:
- Conventional commits: `type(stc): description`
- Branch naming: `feat/stc/description`, `fix/stc/description`
- Never push directly to main; always open a PR
