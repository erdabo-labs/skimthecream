import type { Category } from './types';
import type { ListingScore } from './types';

export interface ScoreInput {
  askingPrice: number;
  avgMarketValue: number;
  category: string | null;
  categoryDaysToSell?: number;
  listingAgeHours?: number;
}

export interface ScoreResult {
  score: ListingScore;
  estimatedProfit: number;
  confidence: number;
}

export function scoreDeal(input: ScoreInput): ScoreResult {
  const { askingPrice, avgMarketValue, category, categoryDaysToSell, listingAgeHours } = input;

  const estimatedSellPrice = avgMarketValue * 0.95;
  const estimatedProfit = estimatedSellPrice - askingPrice;

  // Confidence factors
  const profitMargin = askingPrice > 0 ? (estimatedProfit / askingPrice) * 100 : 0;
  let confidence = 0;

  // Profit margin contributes up to 40 points
  confidence += Math.min(40, profitMargin * 0.8);

  // Category days-to-sell contributes up to 30 points (faster = higher)
  if (categoryDaysToSell !== undefined) {
    confidence += Math.max(0, 30 - categoryDaysToSell);
  }

  // Freshness contributes up to 30 points (newer = higher)
  if (listingAgeHours !== undefined) {
    confidence += Math.max(0, 30 - listingAgeHours * 0.5);
  } else {
    confidence += 15; // neutral if unknown
  }

  confidence = Math.min(100, Math.max(0, confidence));

  let score: ListingScore;
  if (estimatedProfit >= 200 && confidence >= 70) {
    score = 'great';
  } else if (estimatedProfit >= 50 && confidence >= 50) {
    score = 'good';
  } else {
    score = 'pass';
  }

  return {
    score,
    estimatedProfit: Math.round(estimatedProfit * 100) / 100,
    confidence: Math.round(confidence),
  };
}
