export interface OkxOrderBookTopic {
    arg: {
        channel: OkxTopicName.ORDERBOOK;
        instId: string;
    },
    action: OkxTopicType,
    data: {
        asks: [string, string, string, string][];
        bids: [string, string, string, string][];
        instId: string;
        ts: string;
        seqId: number;
    }[];
}

export interface OkxTickerTopic {
    arg: {
        channel: OkxTopicName.TICKER,
        instId: string;
    },
    data: {
        instType: string;
        instId: string;
        last: string;
        lastSz: string;
        askPx: string;
        askSz: string;
        bidPx: string;
        bidSz: string;
        open24h: string;
        high24h: string;
        low24h: string;
        sodUtc0: string;
        sodUtc8: string;
        volCcy24h: string;
        vol24h: string;
        ts: string;
    }[];
}

export enum OkxTopicName {
    ORDERBOOK = 'books',
    TICKER = 'tickers',
}

export enum OkxTopicType {
    UPDATE = 'update',
    SNAPSHOT = 'snapshot',
}