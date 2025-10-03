import { ArbitrageConfig } from './arbitrage';
import {ExchangePrice, OrderBookMetrics} from "./exchange";

export interface TriangularConfig extends Omit<ArbitrageConfig, 'slippageByLiquidity'> {
    maxSlippage: number,
    maxSlippagePerTrade: number,
}

export interface TriangularPath {
    symbols: string[];
    directions: ('buy' | 'sell')[];
    minAmount: number;
    description: string;
}

export interface TriangularOpportunity {
    id: string;
    exchange: 'bybit';
    path: string[];
    directions: ('buy' | 'sell')[];
    prices: number[];
    effectivePrices: number[];
    startAmount: number;
    endAmount: number;
    profitPercent: number;
    profitUSDT: number;
    fees: {
        total: number;
        perTrade: number[];
    };
    confidence: number;
    executionTime: number;
    slippage: {
        total: number;
        perTrade: number[];
    };
    timestamp: Date;
    valid: boolean;
}

export interface PriceCache {
    price: ExchangePrice;
    orderBook?: OrderBookMetrics;
}