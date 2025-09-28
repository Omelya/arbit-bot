import { AbstractExchangeService } from './AbstractExchangeService';
import WebSocket from 'ws';
import { ExchangePrice } from '../../types';

export class BinanceService extends AbstractExchangeService {
    protected wsUrl: string = 'wss://stream.binance.com:9443/ws';
    protected name: string = 'binance';

    protected handlePriceUpdate(data: any): void {
        try {
            if (!data.s || data.result !== undefined) {
                return;
            }

            const priceData = this.normalizePrice(data);
            if (priceData && this.validatePriceData(priceData)) {
                this.emitPriceUpdate(priceData);
            }
        } catch (error) {
            console.error(`Error handling price update from ${this.name}:`, error);
        }
    }

    protected subscribeToSymbols(ws: WebSocket, symbols: string[]): void {
        const streams = symbols.map(symbol => {
            const normalizedSymbol = this.normalizeSymbol(symbol);
            return `${normalizedSymbol}@ticker`;
        });

        const subscribeMessage = {
            method: 'SUBSCRIBE',
            params: streams,
            id: Date.now(),
        };

        ws.send(JSON.stringify(subscribeMessage));
        console.log(`📡 Subscribed to Binance streams: ${streams.join(', ')}`);
    }

    private normalizePrice(data: any): ExchangePrice | null {
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
}
