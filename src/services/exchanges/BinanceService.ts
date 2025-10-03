import { AbstractExchangeService } from './AbstractExchangeService';
import WebSocket from 'ws';
import {ExchangePrice, OrderBookState} from '../../types';
import {
    BinanceDepthSnapshotTopic,
    BinanceDepthUpdateTopic,
    BinanceTickerTopic,
    BinanceTopicName,
    OrderBookBuffer,
} from '../../types/binance';
import {createChildLogger} from "../../utils/logger";

const logger = createChildLogger(__filename);

export class BinanceService extends AbstractExchangeService {
    protected wsUrl: string = 'wss://stream.binance.com:9443/ws';
    protected name: string = 'binance';
    private restBaseUrl: string = 'https://api.binance.com';
    private orderBookBuffers: Map<string, OrderBookBuffer> = new Map();

    protected handleMessage(data: any): void {
        if (data.result !== undefined || data.id !== undefined) {
            return;
        }

        if (data.e === BinanceTopicName.TICKER) {
            this.handlePriceUpdate(data);
        } else if (data.e === BinanceTopicName.ORDERBOOK) {
            this.handleDepthUpdate(data);
        }
    }

    protected handlePriceUpdate(data: BinanceTickerTopic): void {
        try {
            const priceData = this.normalizePrice(data);
            if (priceData && this.validatePriceData(priceData)) {
                this.emitPriceUpdate(priceData);
            }
        } catch (error) {
            logger.error({
                msg: `Error handling price update from ${this.name}:`,
                error,
            });
        }
    }

    private async handleDepthUpdate(data: BinanceDepthUpdateTopic): Promise<void> {
        const symbol = this.formatSymbolToStandard(data.s);
        let buffer = this.orderBookBuffers.get(symbol);

        if (!buffer) {
            buffer = {
                events: [],
                isInitialized: false,
                lastUpdateId: 0,
            };

            this.orderBookBuffers.set(symbol, buffer);

            await this.initializeOrderBook(symbol, buffer);
        }

        if (!buffer.isInitialized) {
            buffer.events.push(data);
            return;
        }

        this.applyDepthUpdate(symbol, data, buffer);
    }

    private async initializeOrderBook(symbol: string, buffer: OrderBookBuffer): Promise<void> {
        try {
            const normalizedSymbol = this.normalizeSymbol(symbol);
            const url = `${this.restBaseUrl}/api/v3/depth?symbol=${normalizedSymbol.toUpperCase()}&limit=1000`;

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const snapshot = await response.json() as BinanceDepthSnapshotTopic;

            const firstBufferedEvent = buffer.events[0];
            if (firstBufferedEvent && snapshot.lastUpdateId >= firstBufferedEvent.U) {
                buffer.events = buffer.events.filter(
                    event => event.u > snapshot.lastUpdateId
                );

                const firstEvent = buffer.events[0];
                if (firstEvent &&
                    (firstEvent.U > snapshot.lastUpdateId + 1 ||
                        firstEvent.u < snapshot.lastUpdateId)
                ) {
                    logger.error(`❌ Gap in orderbook updates for ${symbol}, restarting...`);
                    buffer.events = [];
                    buffer.isInitialized = false;

                    setTimeout(() => this.initializeOrderBook(symbol, buffer), 1000);
                    return;
                }
            }

            const state: OrderBookState = {
                symbol,
                bids: new Map(),
                asks: new Map(),
                lastUpdateId: snapshot.lastUpdateId,
                timestamp: Date.now(),
                isInitialized: true,
            };

            for (const [priceStr, volumeStr] of snapshot.bids) {
                const price = parseFloat(priceStr);
                const volume = parseFloat(volumeStr);

                if (volume > 0) state.bids.set(price, volume);
            }

            for (const [priceStr, volumeStr] of snapshot.asks) {
                const price = parseFloat(priceStr);
                const volume = parseFloat(volumeStr);
                if (volume > 0) {
                    state.asks.set(price, volume);
                }
            }

            this.orderBookStates.set(symbol, state);
            buffer.lastUpdateId = snapshot.lastUpdateId;
            buffer.isInitialized = true;

            for (const event of buffer.events) {
                this.applyDepthUpdate(symbol, event, buffer);
            }

            buffer.events = [];

            this.emitOrderBookUpdate(symbol, state);
        } catch (error) {
            logger.error({
                msg: `❌ Failed to initialize orderbook for ${symbol}:`,
                error,
            });

            buffer.isInitialized = false;

            setTimeout(() => this.initializeOrderBook(symbol, buffer), 5000);
        }
    }

    private applyDepthUpdate(
        symbol: string,
        data: BinanceDepthUpdateTopic,
        buffer: OrderBookBuffer,
    ): void {
        const state = this.orderBookStates.get(symbol);
        if (!state) {
            logger.warn(`⚠️ No state found for ${symbol}`);
            return;
        }

        if (data.u <= buffer.lastUpdateId) {
            return;
        }

        if (data.U > buffer.lastUpdateId + 1) {
            logger.error(`❌ Gap detected for ${symbol}: expected ${buffer.lastUpdateId + 1}, got ${data.U}. Restarting...`);
            buffer.isInitialized = false;
            buffer.events = [];

            this.initializeOrderBook(symbol, buffer);
            return;
        }

        for (const [priceStr, volumeStr] of data.b) {
            const price = parseFloat(priceStr);
            const volume = parseFloat(volumeStr);

            if (volume === 0) {
                state.bids.delete(price);
            } else {
                state.bids.set(price, volume);
            }
        }

        for (const [priceStr, volumeStr] of data.a) {
            const price = parseFloat(priceStr);
            const volume = parseFloat(volumeStr);

            if (volume === 0) {
                state.asks.delete(price);
            } else {
                state.asks.set(price, volume);
            }
        }

        buffer.lastUpdateId = data.u;
        state.lastUpdateId = data.u;
        state.timestamp = data.E;

        this.emitOrderBookUpdate(symbol, state);
    }

    protected subscribeToSymbols(ws: WebSocket, symbols: string[]): void {
        const tickers = symbols.map(symbol => {
            const normalizedSymbol = this.normalizeSymbol(symbol);
            return `${normalizedSymbol}@ticker`;
        });

        const orderBook = symbols.map(symbol => {
            const normalizedSymbol = this.normalizeSymbol(symbol);
            return `${normalizedSymbol}@depth@100ms`;
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
        logger.info(`📡 Subscribed to Binance streams: ${tickers.join(', ')}`);
    }

    private normalizePrice(data: BinanceTickerTopic): ExchangePrice | null {
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

    protected normalizeSymbol(symbol: string): string {
        return symbol
            .replace('/', '')
            .toLowerCase();
    }

    protected clearState() {
        super.clearState();

        this.orderBookBuffers.clear();
    }
}
