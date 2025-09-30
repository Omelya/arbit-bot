import {AbstractExchangeService} from "./AbstractExchangeService";
import WebSocket from "ws";
import {ExchangePrice, OrderBookState} from "../../types";
import {OkxOrderBookTopic, OkxTickerTopic, OkxTopicName} from "../../types/okx";

export class OkxService extends AbstractExchangeService {
    protected name: string = 'okx';
    protected wsUrl: string = 'wss://ws.okx.com:8443/ws/v5/public';
    protected maxReconnectAttempts: number = 2;
    private messageId: number = 0;

    protected handleMessage(data: any): void {
        if (data.event === 'subscribe' || data.type === 'unsubscribe') {
            return;
        }

        if (data.arg?.channel === OkxTopicName.TICKER) {
            this.handlePriceUpdate(data);
        }

        if (data.arg?.channel === OkxTopicName.ORDERBOOK_5) {
            this.handleOrderBookMessage(data);
        }
    }

    protected handlePriceUpdate(data: OkxTickerTopic): void {
        try {
            if (data.data) {
                const priceData = this.normalizePrice(data.data[0]);
                if (priceData && this.validatePriceData(priceData)) {
                    this.emitPriceUpdate(priceData);
                }
            }
        } catch (error) {
            console.error(`Error handling price update from ${this.name}:`, error);
        }
    }

    private handleOrderBookMessage(message: OkxOrderBookTopic): void {
        const { data, arg } = message;
        const instId = arg?.instId;

        if (!instId) {
            console.warn(`⚠️ Missing instId in OKX Order Book message`);
            return;
        }

        const symbol = this.formatSymbolToStandard(instId);

        try {
            const bookData = data[0];

            const state: OrderBookState = {
                symbol,
                bids: new Map(),
                asks: new Map(),
                lastUpdateId: bookData.seqId || 0,
                timestamp: parseInt(bookData.ts) || Date.now(),
                isInitialized: true
            };

            if (bookData.bids && Array.isArray(bookData.bids)) {
                for (const [priceStr, sizeStr] of bookData.bids) {
                    const price = parseFloat(priceStr);
                    const size = parseFloat(sizeStr);
                    if (!isNaN(price) && !isNaN(size) && size > 0) {
                        state.bids.set(price, size);
                    }
                }
            }

            if (bookData.asks && Array.isArray(bookData.asks)) {
                for (const [priceStr, sizeStr] of bookData.asks) {
                    const price = parseFloat(priceStr);
                    const size = parseFloat(sizeStr);
                    if (!isNaN(price) && !isNaN(size) && size > 0) {
                        state.asks.set(price, size);
                    }
                }
            }

            this.orderBookStates.set(symbol, state);
            this.emitOrderBookUpdate(symbol, state);
        } catch (error: any) {
            console.error(`❌ Error handling OKX Order Book for ${symbol}:`, error);
        }
    }

    protected subscribeToSymbols(ws: WebSocket, symbols: string[]): void {
        const tickerArgs = symbols.map(symbol => ({
            channel: 'tickers',
            instId: this.normalizeSymbol(symbol),
        }));

        const bookArgs = symbols.map(symbol => ({
            channel: 'books5',
            instId: this.normalizeSymbol(symbol),
        }));

        const subscribeMessage = {
            id: ++this.messageId,
            op: 'subscribe',
            args: [
                ...tickerArgs,
                ...bookArgs,
            ],
        };

        ws.send(JSON.stringify(subscribeMessage));
        console.log(`📡 Subscribed to OKX products: ${tickerArgs.join(', ')}`);
    }

    private normalizePrice(data: any): ExchangePrice | null {
        if (data.instId) {
            return{
                exchange: this.name,
                symbol: this.formatSymbolToStandard(data.instId),
                price: parseFloat(data.last),
                timestamp: Date.now(),
                volume: parseFloat(data.vol24h),
                bid: parseFloat(data.bidPx),
                ask: parseFloat(data.askPx),
            };
        }

        return null;
    }

    private formatSymbolToStandard(symbol: string): string {
        return symbol
            .replace('-', '/');
    }

    protected normalizeSymbol(symbol: string): string {
        return symbol
            .replace('/', '-');
    }
}
