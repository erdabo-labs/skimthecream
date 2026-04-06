export interface MarketPrice {
  id: number;
  category: string;
  product_name: string;
  condition: string;
  avg_sold_price: number | null;
  low_sold_price: number | null;
  high_sold_price: number | null;
  source: string;
  sample_size: number;
  scraped_at: string;
  manual_override: boolean;
  created_at: string;
  updated_at: string;
}

export type ListingScore = 'pass' | 'good' | 'great';
export type ListingStatus = 'new' | 'contacted' | 'purchased' | 'dismissed';

export interface Listing {
  id: number;
  source: string;
  source_id: string;
  title: string;
  asking_price: number | null;
  listing_url: string | null;
  parsed_category: string | null;
  parsed_product: string | null;
  parsed_condition: string | null;
  market_price_id: number | null;
  estimated_profit: number | null;
  score: ListingScore | null;
  status: ListingStatus;
  parsed_storage: string | null;
  price_source: string | null;
  feedback: string | null;
  feedback_note: string | null;
  raw_email_snippet: string | null;
  alert_sent: boolean;
  first_seen_at: string | null;
  last_seen_at: string | null;
  gone_at: string | null;
  days_active: number | null;
  created_at: string;
  updated_at: string;
}

export type InventoryStatus = 'in_stock' | 'listed' | 'sold';

export interface InventoryItem {
  id: number;
  listing_id: number | null;
  product_name: string;
  purchase_price: number | null;
  purchase_date: string | null;
  purchase_source: string | null;
  sold_price: number | null;
  sold_date: string | null;
  sold_platform: string | null;
  fees: number | null;
  profit: number | null;
  status: InventoryStatus;
  created_at: string;
  updated_at: string;
}

export interface ProductIntel {
  id: number;
  product_name: string;
  category: string | null;
  notes: string | null;
  difficulty: 'easy' | 'moderate' | 'hard' | null;
  storage_matters: boolean;
  battery_matters: boolean;
  price_floor: number | null;
  price_ceiling: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  keywords: string[];
  avg_days_to_sell: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export type NegotiationStatus = 'active' | 'closed' | 'purchased';

export interface NegotiationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Negotiation {
  id: number;
  listing_id: number;
  messages: NegotiationMessage[];
  target_price: number | null;
  status: NegotiationStatus;
  created_at: string;
  updated_at: string;
}
