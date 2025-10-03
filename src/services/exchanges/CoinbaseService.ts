import { AbstractExchangeService } from './AbstractExchangeService';
import WebSocket from 'ws';
import {ExchangePrice, OrderBookState} from '../../types';
import {
    CoinbaseOrderBookSnapshot,
    CoinbaseOrderBookUpdate,
    CoinbaseTickerTopic,
    CoinbaseTopicName
} from "../../types/coinbase";
import {createChildLogger} from "../../utils/logger";

const logger = createChildLogger(__filename);

export class CoinbaseService extends AbstractExchangeService {
    protected wsUrl: string = 'wss://ws-feed.exchange.coinbase.com';
    protected name: string = 'coinbase';
    private heartbeatInterval?: NodeJS.Timeout;

    protected handleMessage(data: any): void {
        if (data.type === 'subscriptions' || data.type === 'heartbeat') {
            return;
        }

        if (data.type === CoinbaseTopicName.TICKER) {
            this.handlePriceUpdate(data);
        } else if (
            data.type === CoinbaseTopicName.ORDERBOOK ||
            data.type === CoinbaseTopicName.SNAPSHOT
        ) {
            this.handleOrderBookUpdate(data);
        }
    }

    protected handlePriceUpdate(data: CoinbaseTickerTopic): void {
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

    private handleOrderBookUpdate(data: any): void {
        try {
            if (data.type === 'snapshot') {
                this.handleOrderBookSnapshot(data);
            } else if (data.type === 'l2update') {
                this.handleOrderBookDelta(data);
            }
        } catch (error) {
            logger.error({
                msg: `❌ Error handling Coinbase Order Book:`,
                error,
            });
        }
    }

    private handleOrderBookSnapshot(data: CoinbaseOrderBookSnapshot): void {
        const symbol = this.formatSymbolToStandard(data.product_id);

        const state: OrderBookState = {
            symbol,
            bids: new Map(),
            asks: new Map(),
            lastUpdateId: 0,
            timestamp: new Date(data.time).getTime(),
            isInitialized: true,
        };

        if (data.bids && Array.isArray(data.bids)) {
            for (const [priceStr, sizeStr] of data.bids) {
                const price = parseFloat(priceStr);
                const size = parseFloat(sizeStr);

                if (!isNaN(price) && !isNaN(size) && size > 0) {
                    state.bids.set(price, size);
                }
            }
        }

        if (data.asks && Array.isArray(data.asks)) {
            for (const [priceStr, sizeStr] of data.asks) {
                const price = parseFloat(priceStr);
                const size = parseFloat(sizeStr);

                if (!isNaN(price) && !isNaN(size) && size > 0) {
                    state.asks.set(price, size);
                }
            }
        }

        this.orderBookStates.set(symbol, state);
        this.emitOrderBookUpdate(symbol, state);
    }

    private handleOrderBookDelta(data: CoinbaseOrderBookUpdate): void {
        const symbol = this.formatSymbolToStandard(data.product_id);
        const state = this.orderBookStates.get(symbol);

        if (!state || !state.isInitialized) {
            logger.warn(`⚠️ Received l2update for ${symbol} before snapshot, ignoring`);
            return;
        }

        if (data.changes && Array.isArray(data.changes)) {
            for (const [side, priceStr, sizeStr] of data.changes) {
                const price = parseFloat(priceStr);
                const size = parseFloat(sizeStr);

                if (isNaN(price) || isNaN(size)) {
                    logger.warn(`⚠️ Invalid price or size: ${priceStr}, ${sizeStr}`);
                    continue;
                }

                const bookSide = side === 'buy' ? state.bids : state.asks;

                size === 0
                    ? bookSide.delete(price)
                    : bookSide.set(price, size);
            }
        }

        state.timestamp = new Date(data.time).getTime();
        state.lastUpdateId++;

        this.emitOrderBookUpdate(symbol, state);
    }

    protected subscribeToSymbols(ws: WebSocket, symbols: string[]): void {
        const coinbaseProducts = symbols.map(symbol => this.normalizeSymbol(symbol));

        const subscribeMessage = {
            type: 'subscribe',
            product_ids: coinbaseProducts,
            channels: ['ticker', 'level2_batch'],
        };

        ws.send(JSON.stringify(subscribeMessage));
        logger.info(`📡 Subscribed to Coinbase products: ${coinbaseProducts.join(', ')}`);

        this.setupHeartbeat(ws);
    }

    private setupHeartbeat(ws: WebSocket): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'heartbeat',
                    on: true
                }));
            }
        }, 30000);
    }

    private normalizePrice(data: any): ExchangePrice | null {
        if (data.product_id) {
            return{
                exchange: this.name,
                symbol: this.formatSymbolToStandard(data.product_id),
                price: parseFloat(data.price),
                timestamp: Date.now(),
                volume: parseFloat(data.volume_24h),
                bid: parseFloat(data.best_bid),
                ask: parseFloat(data.best_ask),
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

    public async disconnect(): Promise<void> {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = undefined;
        }

        await super.disconnect();
    }
}
