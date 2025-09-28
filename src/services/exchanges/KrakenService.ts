import { AbstractExchangeService } from './AbstractExchangeService';
import WebSocket from 'ws';
import { ExchangePrice } from '../../types';

export class KrakenService extends AbstractExchangeService {
    protected wsUrl: string = 'wss://ws.kraken.com/v2';
    protected name: string = 'kraken';

    protected handlePriceUpdate(data: any): void {
        try {
            const priceData = this.normalizePrice(data);
            if (priceData) {
                priceData.forEach(item => {
                    if (item && this.validatePriceData(item)) {
                        this.emitPriceUpdate(item);
                    }
                });
            }
        } catch (error) {
            console.error(`Error handling price update from ${this.name}:`, error);
        }
    }

    protected subscribeToSymbols(ws: WebSocket, symbols: string[]): void {
        ws.send(JSON.stringify({
            method: 'subscribe',
            params: {
                channel: 'ticker',
                symbol: [...symbols],
            },
        }));

        console.log(`📡 Subscribed to Kraken pairs: ${symbols.join(', ')}`);
    }

    private normalizePrice(data: any): ExchangePrice[] | null {
        if (data.data) {
            const res = data?.data as Record<string, any>[];

            return res
                .map(item => ({
                    exchange: this.name,
                    symbol: item.symbol,
                    price: parseFloat(item.last),
                    timestamp: Date.now(),
                    volume: parseFloat(item.volume),
                    bid: parseFloat(item.bid),
                    ask: parseFloat(item.ask),
                }))
                .filter(item => item.symbol !== null);
        }

        return null;
    }
}
