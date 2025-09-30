export interface ExchangePrice {
    exchange: string;
    symbol: string;
    price: number;
    timestamp: number;
    volume?: number;
    bid?: number;
    ask?: number;
}

export interface ExchangeConfig {
    name: string;
    apiKey?: string;
    secret?: string;
    passphrase?: string;
    sandbox?: boolean;
    rateLimit?: number;
}

export interface OrderBook {
    symbol: string;
    bids: [number, number][];
    asks: [number, number][];
    timestamp: number;
    datetime: string;
}

export interface OrderBookState {
    symbol: string;
    bids: Map<number, number>;  // price -> volume
    asks: Map<number, number>;  // price -> volume
    lastUpdateId: number;
    timestamp: number;
    isInitialized: boolean;     // Чи отримали snapshot
}

export interface OrderBookMetrics extends OrderBook {
    midPrice: number;
    spread: number;
    spreadPercent: number;
    totalBidVolume: number;
    totalAskVolume: number;
    updateId: number;
}
