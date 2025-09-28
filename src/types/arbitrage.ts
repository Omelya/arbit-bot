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
}

export interface ArbitrageConfig {
    minProfitPercent: number;
    maxInvestment: number;
    enabledExchanges: string[];
    symbols: string[];
}
