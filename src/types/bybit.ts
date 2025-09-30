export interface BybitOrderBookTopic {
    topic: string;
    ts: number;
    type: BybitTopicType;
    data: {
        s: string;
        b: [string, string][];
        a: [string, string][];
        u: number;
        seq: number;
    };
    cts: number;
}

export interface BybitTickerTopic {
    topic: string;
    ts: number;
    type: BybitTopicType.SNAPSHOT;
    cs: number;
    data: {
        symbol: string;
        lastPrice: number;
        highPrice24h: number;
        lowPrice24h: number;
        prevPrice24h: number;
        volume24h: number;
        turnover24h: number;
        price24hPcnt: number;
        usdIndexPrice: number;
    };
}

export enum BybitTopicName {
    TICKERS = 'tickers',
    ORDERBOOK = 'orderbook',
}

export enum BybitTopicType {
    SNAPSHOT = 'snapshot',
    DELTA = 'delta',
}