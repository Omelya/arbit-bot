import {AbstractExchangeService} from "./AbstractExchangeService";
import WebSocket from "ws";
import {ExchangePrice, OrderBookState} from "../../types";
import {BybitOrderBookTopic, BybitTickerTopic, BybitTopicName, BybitTopicType} from "../../types/bybit";

export class BybitService extends AbstractExchangeService {
    protected name: string = 'bybit';
    protected wsUrl: string = 'wss://stream.bybit.com/v5/public/spot';
    private pingInterval: NodeJS.Timeout | null = null;

    protected handleMessage(data: any) {
        if (data.op || data.success !== undefined) {
            if (data.op === 'subscribe' && data.success) {
                console.log(`✅ Successfully subscribed to Bybit: ${data.conn_id}`);
            }
            return;
        }

        if (data.op === 'pong') {
            console.log(`🏓 Received pong from ${this.name}`);
            return;
        }

        if (data.topic) {
            if (data.topic.startsWith(BybitTopicName.TICKERS)) {
                this.handlePriceUpdate(data);
            }

            if (data.topic.startsWith(BybitTopicName.ORDERBOOK)) {
                this.handleOrderBookUpdate(data);
            }
        }
    }

    private handleOrderBookUpdate(item: BybitOrderBookTopic): void {
        const { type, data, topic } = item;
        const symbol = this.extractSymbolFromTopic(topic);

        if (!symbol) {
            console.warn(`⚠️ Cannot extract symbol from topic: ${topic}`);
            return;
        }

        try {
            if (type === BybitTopicType.SNAPSHOT) {
                this.handleSnapshot(symbol, data);
            } else if (type === BybitTopicType.DELTA) {
                this.handleDelta(symbol, data);
            } else {
                console.warn(`⚠️ Unknown Order Book type: ${type}`);
            }
        } catch (error) {
            console.error(`❌ Error handling Order Book update for ${symbol}:`, error);
        }
    }

    private handlePriceUpdate(data: BybitTickerTopic): void {
        try {
            if (data.data) {
                const priceData = this.normalizePrice(data.data);
                if (priceData && this.validatePriceData(priceData)) {
                    this.emitPriceUpdate(priceData);
                }
            }
        } catch (error) {
            console.error(`Error handling price update from ${this.name}:`, error);
        }
    }

    protected subscribeToSymbols(ws: WebSocket, symbols: string[]): void {
        const tickers = symbols.map(symbol => {
            const bybitSymbol = this.normalizeSymbol(symbol);
            return `tickers.${bybitSymbol}`;
        });

        const orderBook = symbols.map(symbol => {
            const bybitSymbol = this.normalizeSymbol(symbol);
            return `orderbook.50.${bybitSymbol}`;
        });

        const subscribeMessage = {
            op: 'subscribe',
            args: [
                ...tickers,
                ...orderBook,
            ],
        };

        ws.send(JSON.stringify(subscribeMessage));
        console.log(`📡 Subscribed to Bybit topics: ${tickers.join(', ')}`);

        this.setupBybitPing(ws);
    }

    private handleSnapshot(symbol: string, data: BybitOrderBookTopic['data']): void {
        const state: OrderBookState = {
            symbol,
            bids: new Map(),
            asks: new Map(),
            lastUpdateId: data.u || 0,
            timestamp: Date.now(),
            isInitialized: true,
        };

        if (data.b && Array.isArray(data.b)) {
            for (const [priceStr, volumeStr] of data.b) {
                const price = parseFloat(priceStr);
                const volume = parseFloat(volumeStr);

                if (volume > 0) state.bids.set(price, volume);
            }
        }

        if (data.a && Array.isArray(data.a)) {
            for (const [priceStr, volumeStr] of data.a) {
                const price = parseFloat(priceStr);
                const volume = parseFloat(volumeStr);

                if (volume > 0) state.asks.set(price, volume);
            }
        }

        this.orderBookStates.set(symbol, state);
        this.emitOrderBookUpdate(symbol, state);
    }

    private handleDelta(symbol: string, data: BybitOrderBookTopic['data']): void {
        const state = this.orderBookStates.get(symbol);

        if (!state || !state.isInitialized) {
            console.warn(`⚠️ Received delta for ${symbol} before snapshot, ignoring`);
            return;
        }

        if (data.b && Array.isArray(data.b)) {
            for (const [priceStr, volumeStr] of data.b) {
                const price = parseFloat(priceStr);
                const volume = parseFloat(volumeStr);

                volume === 0
                    ? state.bids.delete(price)
                    : state.bids.set(price, volume);
            }
        }

        if (data.a && Array.isArray(data.a)) {
            for (const [priceStr, volumeStr] of data.a) {
                const price = parseFloat(priceStr);
                const volume = parseFloat(volumeStr);

                volume === 0
                    ? state.asks.delete(price)
                    : state.asks.set(price, volume);
            }
        }

        state.lastUpdateId = data.u || state.lastUpdateId;
        state.timestamp = Date.now();

        this.emitOrderBookUpdate(symbol, state);
    }

    private normalizePrice(data: any): ExchangePrice | null {
        if (!data.symbol || !data.lastPrice) {
            return null;
        }

        return{
            exchange: this.name,
            symbol: this.formatSymbolToStandard(data.symbol),
            price: parseFloat(data.lastPrice),
            timestamp: Date.now(),
            volume: parseFloat(data.volume24h),
            bid: 0,
            ask: 0,
        };
    }

    protected normalizeSymbol(symbol: string): string {
        return symbol.replace('/', '');
    }

    private extractSymbolFromTopic(topic: string): string | null {
        // topic format: "orderbook.50.BTCUSDT"
        const parts = topic.split('.');
        if (parts.length >= 3) {
            return this.formatSymbolToStandard(parts[2]);
        }

        return null;
    }

    private formatSymbolToStandard(bybitSymbol: string): string {
        const commonQuotes = ['USDT', 'USDC', 'BTC', 'ETH'];

        for (const quote of commonQuotes) {
            if (bybitSymbol.endsWith(quote)) {
                const base = bybitSymbol.slice(0, -quote.length);
                return `${base}/${quote}`;
            }
        }

        return bybitSymbol;
    }

    private setupBybitPing(ws: WebSocket): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }

        this.pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                const pingMessage = {op: 'ping'};

                ws.send(JSON.stringify(pingMessage));
            }
        }, 20000);
    }

    public async disconnect(): Promise<void> {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        await super.disconnect();
    }
}
