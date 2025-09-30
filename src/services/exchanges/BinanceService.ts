import { AbstractExchangeService } from './AbstractExchangeService';
import WebSocket from 'ws';
import {ExchangePrice, OrderBookMetrics, OrderBookState} from '../../types';
import {BinanceOrderBookTopic, BinanceTickerTopic, BinanceTopicName} from "../../types/binance";

export class BinanceService extends AbstractExchangeService {
    protected wsUrl: string = 'wss://stream.binance.com:9443/ws';
    protected name: string = 'binance';

    protected handleMessage(data: any): void {
        if (data.result !== undefined) {
            return;
        }

        if (data.stream) {
            if (data.stream.includes(BinanceTopicName.TICKER)) {
                this.handlePriceUpdate(data);
            }

            if (data.stream.includes(BinanceTopicName.ORDERBOOK)) {
                this.handleOrderBookUpdate(data);
            }
        }
    }

    protected handlePriceUpdate(data: BinanceTickerTopic['data']): void {
        try {
            const priceData = this.normalizePrice(data);
            if (priceData && this.validatePriceData(priceData)) {
                this.emitPriceUpdate(priceData);
            }
        } catch (error) {
            console.error(`Error handling price update from ${this.name}:`, error);
        }
    }

    private handleOrderBookUpdate(item: BinanceOrderBookTopic): void {
        const {stream, data} = item;
        const symbol = this.extractSymbolFromTopic(stream);

        if (!symbol) {
            console.warn(`⚠️ Unable to parse symbol from topic ${stream}`);
            return;
        }

        this.orderBookStates.delete(symbol);

        const state: OrderBookState = {
            symbol,
            bids: new Map(),
            asks: new Map(),
            lastUpdateId: data.lastUpdateId || 0,
            timestamp: Date.now(),
            isInitialized: true,
        };

        if (data.bids && Array.isArray(data.bids)) {
            for (const [priceStr, volumeStr] of data.bids) {
                const price = parseFloat(priceStr);
                const volume = parseFloat(volumeStr);

                if (volume > 0) state.bids.set(price, volume);
            }
        }

        if (data.asks && Array.isArray(data.asks)) {
            for (const [priceStr, volumeStr] of data.asks) {
                const price = parseFloat(priceStr);
                const volume = parseFloat(volumeStr);

                if (volume > 0) state.asks.set(price, volume);
            }
        }

        this.orderBookStates.set(symbol, state);
        this.emitOrderBookUpdate(symbol, state);
    }

    protected subscribeToSymbols(ws: WebSocket, symbols: string[]): void {
        const tickers = symbols.map(symbol => {
            const normalizedSymbol = this.normalizeSymbol(symbol);
            return `${normalizedSymbol}@ticker`;
        });

        const orderBook = symbols.map(symbol => {
            const normalizedSymbol = this.normalizeSymbol(symbol);
            return `${normalizedSymbol}@depth20`;
        });

        const subscribeMessage = {
            method: 'SUBSCRIBE',
            params: [
                ...tickers,
                ...orderBook,
            ],
            id: Date.now(),
        };

        ws.send(JSON.stringify(subscribeMessage));
        console.log(`📡 Subscribed to Binance streams: ${tickers.join(', ')}`);
    }

    private normalizePrice(data: BinanceTickerTopic['data']): ExchangePrice | null {
        if (data.s) {
            const symbol = data.s as string;

            return {
                exchange: this.name,
                symbol: this.formatSymbolToStandard(symbol),
                price: parseFloat(data.c),
                timestamp: Date.now(),
                volume: parseFloat(data.v),
                bid: parseFloat(data.b),
                ask: parseFloat(data.a),
            };
        }

        return null;
    }

    private formatSymbolToStandard(symbol: string): string {
        const commonQuotes = ['USDT', 'USDC', 'BTC', 'ETH', 'BNB'];

        for (const quote of commonQuotes) {
            if (symbol.endsWith(quote)) {
                const base = symbol.slice(0, -quote.length);
                return `${base}/${quote}`;
            }
        }

        return symbol;
    }

    private extractSymbolFromTopic(topic: string): string | null {
        // topic format: "btcusdt@depth20"
        const parts = topic.split('@');
        if (parts.length >= 3) {
            return this.formatSymbolToStandard(parts[2]).toUpperCase();
        }

        return null;
    }

    protected normalizeSymbol(symbol: string): string {
        return symbol
            .replace('/', '')
            .toLowerCase();
    }
}
