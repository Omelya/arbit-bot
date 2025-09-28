import {AbstractExchangeService} from "./AbstractExchangeService";
import WebSocket from "ws";
import {ExchangePrice} from "../../types";

export class OkxService extends AbstractExchangeService {
    protected name: string = 'okx';
    protected wsUrl: string = 'wss://ws.okx.com:8443/ws/v5/public';
    protected maxReconnectAttempts: number = 2;
    private messageId: number = 0;

    protected handlePriceUpdate(data: any): void {
        try {
            if (data.type === 'subscribe' || data.type === 'unsubscribe') {
                return;
            }

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

    protected subscribeToSymbols(ws: WebSocket, symbols: string[]): void {
        const streams = symbols.map(symbol => ({
            channel: 'tickers',
            instId: this.normalizeSymbol(symbol),
        }));

        const subscribeMessage = {
            id: ++this.messageId,
            op: 'subscribe',
            args: streams,
        };

        ws.send(JSON.stringify(subscribeMessage));
        console.log(`📡 Subscribed to OKX products: ${streams.join(', ')}`);
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
