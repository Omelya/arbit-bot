export interface KrakenTickerTopic {
    channel: KrakenTopicName.TICKER;
    type: KrakenTopicType;
    data: {
        symbol: string;
        bid: number;
        bid_qty: number;
        ask: number;
        ask_qty: number;
        last: number;
        volume: number;
        vwap: number;
        low: number;
        high: number;
        change: number;
        change_pct: number;
    }[];
}

export interface KrakenOrderBookTopic {
    channel: KrakenTopicName.ORDERBOOK,
    type: KrakenTopicType,
    data: {
        symbol: string,
        bids: { price: number, qty: number }[],
        asks: { price: number, qty: number }[],
        checksum: number
    }[];
}

export enum KrakenTopicName {
    TICKER = 'ticker',
    ORDERBOOK = 'book',
}

export enum KrakenTopicType {
    UPDATE = 'update',
    SNAPSHOT = 'snapshot',
}