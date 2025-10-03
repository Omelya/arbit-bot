import { AbstractExchangeService } from './AbstractExchangeService';
import WebSocket from 'ws';
import { ExchangePrice } from '../../types';
import { OkxOrderBookTopic, OkxTickerTopic, OkxTopicName, OkxTopicType } from '../../types/okx';
import { createChildLogger } from '../../utils/logger';

const logger = createChildLogger(__filename);

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

        if (data.arg?.channel === OkxTopicName.ORDERBOOK) {
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
            logger.error({
                msg: `Error handling price update from ${this.name}:`,
                error,
            });
        }
    }

    private handleOrderBookMessage(message: OkxOrderBookTopic): void {
        const { data, arg, action } = message;
        const instId = arg?.instId;

        if (!instId) {
            logger.warn(`⚠️ Missing instId in OKX Order Book message`);
            return;
        }

        const symbol = this.formatSymbolToStandard(instId);

        try {
            const bookData = data[0];

            let state = this.orderBookStates.get(symbol);

            if (action === OkxTopicType.SNAPSHOT) {
                state = {
                    symbol,
                    bids: new Map(),
                    asks: new Map(),
                    lastUpdateId: bookData.seqId || 0,
                    timestamp: parseInt(bookData.ts) || Date.now(),
                    isInitialized: true
                };
            } else {
                if (!state) {
                    logger.warn(`⚠️ Received update for ${symbol} before snapshot, creating new state`);
                    state = {
                        symbol,
                        bids: new Map(),
                        asks: new Map(),
                        lastUpdateId: 0,
                        timestamp: Date.now(),
                        isInitialized: false
                    };
                }

                state.lastUpdateId = bookData.seqId || state.lastUpdateId;
                state.timestamp = parseInt(bookData.ts) || Date.now();
            }

            if (bookData.bids && Array.isArray(bookData.bids)) {
                for (const [priceStr, sizeStr] of bookData.bids) {
                    const price = parseFloat(priceStr);
                    const size = parseFloat(sizeStr);

                    if (isNaN(price)) continue;

                    if (!isNaN(size) && size > 0) {
                        state.bids.set(price, size);
                    } else {
                        state.bids.delete(price);
                    }
                }
            }

            if (bookData.asks && Array.isArray(bookData.asks)) {
                for (const [priceStr, sizeStr] of bookData.asks) {
                    const price = parseFloat(priceStr);
                    const size = parseFloat(sizeStr);

                    if (isNaN(price)) continue;

                    if (!isNaN(size) && size > 0) {
                        state.asks.set(price, size);
                    } else {
                        state.asks.delete(price);
                    }
                }
            }

            this.orderBookStates.set(symbol, state);
            this.emitOrderBookUpdate(symbol, state);
        } catch (error: any) {
            logger.error({
                msg: `❌ Error handling OKX Order Book for ${symbol}:`,
                error,
            });
        }
    }

    protected subscribeToSymbols(ws: WebSocket, symbols: string[]): void {
        const tickerArgs = symbols.map(symbol => ({
            channel: 'tickers',
            instId: this.normalizeSymbol(symbol),
        }));

        const bookArgs = symbols.map(symbol => ({
            channel: 'books',
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
        logger.info(`📡 Subscribed to OKX products: ${tickerArgs.join(', ')}`);
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
