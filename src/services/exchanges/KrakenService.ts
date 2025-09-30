import {AbstractExchangeService} from './AbstractExchangeService';
import WebSocket from 'ws';
import {ExchangePrice, OrderBookState} from '../../types';
import {KrakenOrderBookTopic, KrakenTickerTopic, KrakenTopicName, KrakenTopicType} from "../../types/kraken";

export class KrakenService extends AbstractExchangeService {
    protected wsUrl: string = 'wss://ws.kraken.com/v2';
    protected name: string = 'kraken';

    protected handleMessage(data: any): void {
        if (data.method === 'subscribe' && data.success) {
            return;
        }

        if (data.channel === KrakenTopicName.TICKER && data.data) {
            this.handlePriceUpdate(data);
        }

        if (data.channel === KrakenTopicName.ORDERBOOK && data.type && data.data) {
            this.handleOrderBookMessage(data);
        }
    }

    protected handlePriceUpdate(data: KrakenTickerTopic): void {
        try {
            const priceData = this.normalizePrice(data);
            if (priceData) {
                priceData.forEach(item => {
                    if (item && this.validatePriceData(item)) {
                        this.emitPriceUpdate(item);
                    }
                });
            }
        } catch (error) {
            console.error(`Error handling price update from ${this.name}:`, error);
        }
    }

    private handleOrderBookMessage(message: KrakenOrderBookTopic): void {
        const { type, data } = message;

        if (!data || !Array.isArray(data) || data.length === 0) {
            return;
        }

        try {
            for (const bookData of data) {
                const symbol = bookData.symbol;

                if (!symbol) continue;

                if (type === KrakenTopicType.SNAPSHOT) {
                    this.handleOrderBookSnapshot(symbol, bookData);
                } else if (type === KrakenTopicType.UPDATE) {
                    this.handleOrderBookUpdate(symbol, bookData);
                }
            }
        } catch (error) {
            console.error(`❌ Error handling Kraken Order Book:`, error);
        }
    }

    private handleOrderBookSnapshot(symbol: string, data: any): void {
        const state: OrderBookState = {
            symbol,
            bids: new Map(),
            asks: new Map(),
            lastUpdateId: 0,
            timestamp: this.parseKrakenTimestamp(data.timestamp),
            isInitialized: true,
        };

        if (data.bids && Array.isArray(data.bids)) {
            for (const item of data.bids) {
                const price = item.price;
                const qty = item.qty;

                if (typeof price === 'number' && typeof qty === 'number' && qty > 0) {
                    state.bids.set(price, qty);
                }
            }
        }

        if (data.asks && Array.isArray(data.asks)) {
            for (const item of data.asks) {
                const price = item.price;
                const qty = item.qty;

                if (typeof price === 'number' && typeof qty === 'number' && qty > 0) {
                    state.asks.set(price, qty);
                }
            }
        }

        this.orderBookStates.set(symbol, state);
        this.emitOrderBookUpdate(symbol, state);
    }

    private handleOrderBookUpdate(symbol: string, data: any): void {
        const state = this.orderBookStates.get(symbol);

        if (!state || !state.isInitialized) {
            console.warn(`⚠️ Received update for ${symbol} before snapshot`);
            return;
        }

        if (data.bids && Array.isArray(data.bids)) {
            for (const item of data.bids) {
                const price = item.price;
                const qty = item.qty;

                if (typeof price !== 'number' || typeof qty !== 'number') continue;

                if (qty === 0) {
                    state.bids.delete(price);
                } else {
                    state.bids.set(price, qty);
                }
            }
        }

        if (data.asks && Array.isArray(data.asks)) {
            for (const item of data.asks) {
                const price = item.price;
                const qty = item.qty;

                if (typeof price !== 'number' || typeof qty !== 'number') continue;

                if (qty === 0) {
                    state.asks.delete(price);
                } else {
                    state.asks.set(price, qty);
                }
            }
        }

        state.timestamp = this.parseKrakenTimestamp(data.timestamp);

        this.emitOrderBookUpdate(symbol, state);
    }

    protected subscribeToSymbols(ws: WebSocket, symbols: string[]): void {
        ws.send(JSON.stringify({
            method: 'subscribe',
            params: {
                channel: 'ticker',
                symbol: [...symbols],
            },
        }));

        ws.send(JSON.stringify({
            method: 'subscribe',
            params: {
                channel: 'book',
                symbol: [...symbols],
            },
        }));

        console.log(`📡 Subscribed to Kraken pairs: ${symbols.join(', ')}`);
    }

    private normalizePrice(data: KrakenTickerTopic): ExchangePrice[] | null {
        if (data.data) {
            const res = data?.data;

            return res
                .map(item => ({
                    exchange: this.name,
                    symbol: item.symbol,
                    price: item.last,
                    timestamp: Date.now(),
                    volume: item.volume,
                    bid: item.bid,
                    ask: item.ask,
                }))
                .filter(item => item.symbol !== null);
        }

        return null;
    }

    private parseKrakenTimestamp(timestamp: string): number {
        if (!timestamp) {
            console.warn('Empty timestamp, using current time');
            return Date.now();
        }

        const truncated = timestamp.substring(0, 23) + 'Z';

        const time = new Date(truncated).getTime();

        if (isNaN(time)) {
            console.error('Invalid Kraken timestamp:', timestamp);
            return Date.now();
        }

        return time;
    }
}
