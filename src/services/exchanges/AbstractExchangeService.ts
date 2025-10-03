import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { ExchangePrice, OrderBookMetrics, OrderBookState } from '../../types';
import {createChildLogger} from "../../utils/logger";

const logger = createChildLogger(__filename);

export abstract class AbstractExchangeService extends EventEmitter {
    protected abstract wsUrl: string;
    protected abstract name: string;
    protected readonly maxDepth: number = 50;
    protected readonly updateThrottle: number = 100;
    protected lastEmit: Map<string, number> = new Map();
    protected orderBookStates: Map<string, OrderBookState> = new Map();
    protected ws: WebSocket | null = null;
    protected isConnected: boolean = false;
    protected reconnectAttempts: number = 0;
    protected maxReconnectAttempts: number = 5;
    protected reconnectDelay: number = 5000;

    protected abstract subscribeToSymbols(ws: WebSocket, symbols: string[]): void;

    protected abstract handleMessage(data: any): void;

    public async connectWebSockets(symbols: string[]): Promise<void> {
        if (this.isConnected) {
            logger.warn(`WebSocket for ${this.name} already connected`);
            return;
        }

        try {
            await this.createWSConnection(symbols);
        } catch (error) {
            logger.error({
                msg: `Failed to connect WebSocket for ${this.name}:`,
                error,
            });

            throw error;
        }
    }

    public async disconnect(): Promise<void> {
        this.isConnected = false;
        this.reconnectAttempts = 0;

        if (this.ws) {
            this.ws.removeAllListeners();

            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }

            this.ws = null;
        }

        logger.info(`🔌 Disconnected from ${this.name} WebSocket`);
    }

    public getConnectionStatus(): boolean {
        return this.isConnected;
    }

    private async createWSConnection(symbols: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.wsUrl);

                const connectionTimeout = setTimeout(() => {
                    if (this.ws) this.ws.terminate();

                    reject(new Error(`Connection timeout for ${this.name}`));
                }, 10000);

                this.ws.on('open', () => {
                    clearTimeout(connectionTimeout);
                    logger.info(`🔌 Connected to ${this.name} WebSocket`);
                    this.isConnected = true;
                    this.reconnectAttempts = 0;

                    try {
                        this.subscribeToSymbols(this.ws!, symbols);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });

                this.ws.on('message', (data: Buffer) => {
                    try {
                        const parsed = JSON.parse(data.toString());
                        this.handleMessage(parsed);
                    } catch (error) {
                        logger.error({
                            msg: `Error parsing message from ${this.name}:`,
                            error,
                        });
                    }
                });

                this.ws.on('close', (code, reason) => {
                    clearTimeout(connectionTimeout);
                    this.isConnected = false;
                    logger.error(`❌ Disconnected from ${this.name} WebSocket (Code: ${code}, Reason: ${reason?.toString()})`);

                    if (this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.scheduleReconnect(symbols);
                    } else {
                        logger.error(`❌ Max reconnection attempts reached for ${this.name}`);
                        this.emit('maxReconnectAttemptsReached', this.name);
                    }

                    for (const [symbol] of this.orderBookStates.entries()) {
                        this.emit('orderBookInvalidate', {
                            exchange: this.name,
                            symbol,
                        });
                    }

                    this.clearState();
                });

                this.ws.on('error', (error) => {
                    clearTimeout(connectionTimeout);
                    logger.error({
                        msg: `❌ WebSocket error for ${this.name}:`,
                        error,
                    });

                    if (!this.isConnected) {
                        reject(error);
                    }
                });

                this.ws.on('ping', (data) => {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.pong(data);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    private scheduleReconnect(symbols: string[]): void {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        logger.info(`🔄 Scheduling reconnect for ${this.name} (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);

        setTimeout(async () => {
            try {
                await this.createWSConnection(symbols);
            } catch (error) {
                logger.error({
                    msg: `❌ Reconnection failed for ${this.name}:`,
                    error,
                });
            }
        }, delay);
    }

    protected emitPriceUpdate(priceData: ExchangePrice): void {
        this.emit('priceUpdate', priceData);
    }

    protected emitOrderBookUpdate(symbol: string, state: OrderBookState): void {
        const now = Date.now();
        const lastEmit = this.lastEmit.get(symbol) || 0;

        if (now - lastEmit < this.updateThrottle) {
            return;
        }

        const orderBook = this.stateToOrderBook(state);

        this.emit('orderBookUpdate', {
            exchange: this.name,
            symbol,
            orderBook,
        });

        this.lastEmit.set(symbol, now);
    }

    protected stateToOrderBook(state: OrderBookState): OrderBookMetrics {
        const bids = Array.from(state.bids.entries())
            .sort((a, b) => b[0] - a[0])
            .slice(0, this.maxDepth);

        const asks = Array.from(state.asks.entries())
            .sort((a, b) => a[0] - b[0])
            .slice(0, this.maxDepth);

        const bestBid = bids[0]?.[0] || 0;
        const bestAsk = asks[0]?.[0] || 0;
        const midPrice = (bestBid + bestAsk) / 2;
        const spread = bestAsk - bestBid;
        const spreadPercent = midPrice > 0 ? (spread / midPrice) * 100 : 0;

        const totalBidVolume = bids.reduce((sum, [_, vol]) => sum + vol, 0);
        const totalAskVolume = asks.reduce((sum, [_, vol]) => sum + vol, 0);

        return {
            exchange: this.name,
            symbol: state.symbol,
            bids: bids as [number, number][],
            asks: asks as [number, number][],
            timestamp: state.timestamp,
            datetime: new Date(state.timestamp).toISOString(),
            midPrice,
            spread,
            spreadPercent,
            totalBidVolume,
            totalAskVolume,
            updateId: state.lastUpdateId,
        };
    }

    protected validatePriceData(data: any): boolean {
        return data &&
            typeof data.price === 'number' &&
            !isNaN(data.price) &&
            data.price > 0 &&
            typeof data.symbol === 'string' &&
            data.symbol.length > 0;
    }

    protected sendSubscriptionInChunks(
        ws: WebSocket,
        topics: string[],
        chunkSize: number,
        formatMessage: (chunk: string[]) => any,
    ): void {
        const totalChunks = Math.ceil(topics.length / chunkSize);

        for (let i = 0; i < topics.length; i += chunkSize) {
            const chunk = topics.slice(i, i + chunkSize);
            const message = formatMessage(chunk);
            const chunkNumber = Math.floor(i / chunkSize) + 1;

            ws.send(JSON.stringify(message));

            logger.info(
                `📡 [${this.name}] Subscription chunk ${chunkNumber}/${totalChunks}: ` +
                `${chunk.length} topics`,
            );
        }
    }

    protected clearState(): void {
        this.orderBookStates.clear();
        this.lastEmit.clear();
    }
}
