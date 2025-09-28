import {AbstractExchangeService} from "./AbstractExchangeService";
import WebSocket from "ws";
import {ExchangePrice} from "../../types";

export class BybitService extends AbstractExchangeService {
    protected name: string = 'bybit';
    protected wsUrl: string = 'wss://stream.bybit.com/v5/public/spot';
    private pingInterval: NodeJS.Timeout | null = null;

    protected handlePriceUpdate(data: any): void {
        try {
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

            if (data.topic && data.topic.startsWith('tickers.') && data.data) {
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
        const topics = symbols.map(symbol => {
            const bybitSymbol = this.normalizeSymbol(symbol);
            return `tickers.${bybitSymbol}`;
        });

        const subscribeMessage = {
            op: 'subscribe',
            args: topics,
        };

        ws.send(JSON.stringify(subscribeMessage));
        console.log(`📡 Subscribed to Bybit topics: ${topics.join(', ')}`);

        this.setupBybitPing(ws);
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
