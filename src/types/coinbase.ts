export interface CoinbaseOrderBookSnapshot {
    type: 'snapshot';
    product_id: string;
    bids: [string, string][];
    asks: [string, string][];
    time: string;
}

export interface CoinbaseOrderBookUpdate {
    type: 'l2update';
    product_id: string;
    changes: ['buy' | 'sell', string, string][];
    time: string;
}

export interface CoinbaseTickerTopic {
    type: CoinbaseTopicName.TICKER,
    sequence: number,
    product_id: string,
    price: string,
    open_24h: string,
    volume_24h: string,
    low_24h: string,
    high_24h: string,
    volume_30d: string,
    best_bid: string,
    best_bid_size: string,
    best_ask: string,
    best_ask_size: string,
    side: 'buy' | 'sell',
    time: string,
    trade_id: number,
    last_size: string,
}

export enum CoinbaseTopicName {
    TICKER = 'ticker',
    ORDERBOOK = 'l2update',
    SNAPSHOT = 'snapshot',
}