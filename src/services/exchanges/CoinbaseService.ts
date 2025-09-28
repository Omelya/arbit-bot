import { AbstractExchangeService } from './AbstractExchangeService';
import WebSocket from 'ws';
import { ExchangePrice } from '../../types';

export class CoinbaseService extends AbstractExchangeService {
    protected wsUrl: string = 'wss://ws-feed.exchange.coinbase.com';
    protected name: string = 'coinbase';
    private heartbeatInterval?: NodeJS.Timeout;

    protected handlePriceUpdate(data: any): void {
        try {
            if (data.type === 'subscriptions' || data.type === 'heartbeat') {
                return;
            }

            if (data.type === 'ticker') {
                const priceData = this.normalizePrice(data);
                if (priceData && this.validatePriceData(priceData)) {
                    this.emitPriceUpdate(priceData);
                }
            }
        } catch (error) {
            console.error(`Error handling price update from ${this.name}:`, error);
        }
    }

    protected subscribeToSymbols(ws: WebSocket, symbols: string[]): void {
        const coinbaseProducts = symbols.map(symbol => this.normalizeSymbol(symbol));

        const subscribeMessage = {
            type: 'subscribe',
            product_ids: coinbaseProducts,
            channels: ['ticker']
        };

        ws.send(JSON.stringify(subscribeMessage));
        console.log(`📡 Subscribed to Coinbase products: ${coinbaseProducts.join(', ')}`);

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
