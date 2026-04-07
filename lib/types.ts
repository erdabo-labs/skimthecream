export type ProductStatus = 'pending' | 'active' | 'inactive';
export type ProductConfidence = 'low' | 'medium' | 'high' | 'very_high';
export type SellVelocity = 'fast' | 'moderate' | 'slow';
export type EaseRating = 'easy' | 'moderate' | 'hard';

export interface Product {
  id: number;
  canonical_name: string;
  brand: string | null;
  model_line: string | null;
  tier: string | null;
  generation: string | null;
  status: ProductStatus;
  first_seen_at: string;
  listing_count: number;
  avg_asking_price: number | null;
  median_asking_price: number | null;
  low_price: number | null;
  high_price: number | null;
  target_buy_price: number | null;
  ai_market_value: number | null;
  avg_days_to_sell: number | null;
  sell_velocity: SellVelocity | null;
  avg_profit: number | null;
  times_sold: number;
  ease_rating: EaseRating | null;
  confidence: ProductConfidence;
  notes: string | null;
  last_refreshed: string | null;
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
  parsed_storage: string | null;
  product_id: number | null;
  estimated_profit: number | null;
  score: ListingScore | null;
  status: ListingStatus;
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
  product_id: number | null;
  product_name: string;
  purchase_price: number | null;
  purchase_date: string | null;
  purchase_source: string | null;
  sold_price: number | null;
  sold_date: string | null;
  sold_platform: string | null;
  fees: number | null;
  profit: number | null;
  notes: string | null;
  target_sell_price: number | null;
  ai_estimated_value: number | null;
  status: InventoryStatus;
  created_at: string;
  updated_at: string;
}

export interface BrandRule {
  id: number;
  brand: string;
  max_age_years: number | null;
  auto_approve: boolean;
  notes: string | null;
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
