export interface BinanceTickerTopic {
    e: string,
    E: number,
    s: string,
    p: string,
    P: string,
    w: string,
    x: string,
    c: string,
    Q: string,
    b: string,
    B: string,
    a: string,
    A: string,
    o: string,
    h: string,
    l: string,
    v: string,
    q: string,
    O: number,
    C: number,
    F: number,
    L: number,
    n: number,
}

export interface BinanceDepthUpdateTopic {
    e: 'depthUpdate';
    E: number;
    s: string;
    U: number;
    u: number;
    b: [string, string][];
    a: [string, string][];
}

export interface BinanceDepthSnapshotTopic {
    lastUpdateId: number;
    bids: [string, string][];
    asks: [string, string][];
}

export interface OrderBookBuffer {
    events: BinanceDepthUpdateTopic[];
    isInitialized: boolean;
    lastUpdateId: number;
}

export enum BinanceTopicName {
    TICKER = '24hrTicker',
    ORDERBOOK = 'depthUpdate',
}
