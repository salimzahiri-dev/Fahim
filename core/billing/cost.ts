import type { ModelUsage } from '../../providers/model/ModelProvider';

/** Estimated cost of a session in USD, from the usage reported by the model provider. */
export function estimateCostUsd(
  usage: ModelUsage,
  prices: { priceInputPerMTok: number; priceOutputPerMTok: number },
): number {
  return (usage.inputTokens * prices.priceInputPerMTok + usage.outputTokens * prices.priceOutputPerMTok) / 1_000_000;
}
