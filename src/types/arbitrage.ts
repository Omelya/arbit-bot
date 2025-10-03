import {ExchangeConfig} from "./exchange";

export interface ArbitrageOpportunity {
    id: string;
    symbol: string;
    buyExchange: string;
    sellExchange: string;
    buyPrice: number;
    sellPrice: number;
    profitPercent: number;
    profitAmount: number;
    volume: number;
    timestamp: Date;
    fees: {
        buy: number;
        sell: number;
        total: number;
    };
    buySlippage: number;
    sellSlippage: number;
    effectiveBuyPrice: number;
    effectiveSellPrice: number;
    confidence: number;
    liquidityScore: number;
    spreadImpact: number;
    availableLiquidity?: number;
    recommendedTradeSize?: number;
    netProfitAfterSlippage: number;
    profitPercentAfterSlippage: number;
}

export interface ArbitrageConfig {
    minProfitPercent: number;
    maxInvestment: number;
    minConfidence: number;
    slippageByLiquidity: {
        high: number;
        medium: number;
        low: number;
    }
}

export interface SlippageResult {
    slippage: number;
    effectivePrice: number;
    feasible: boolean;
}
