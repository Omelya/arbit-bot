export * from './exchange';
export * from './arbitrage';

type WSMessageType = 'price_update'
    | 'arbitrage_opportunity'
    | 'error'
    | 'initial_data'
    | 'connection'
    | 'ping'
    | 'pong'
    | 'subscribe'
    | 'subscribed'
    | 'unsubscribe'
    | 'unsubscribed';

export interface WSMessage {
    type: WSMessageType;
    data: any;
    timestamp: number;
}

export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    timestamp: number;
}
