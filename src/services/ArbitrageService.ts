import { EventEmitter } from 'events';
import { ArbitrageOpportunity, ArbitrageConfig, ExchangePrice } from '../types';
import * as crypto from "node:crypto";

export class ArbitrageService extends EventEmitter {
    private opportunities: Map<string, ArbitrageOpportunity> = new Map();
    private prices: Map<string, ExchangePrice> = new Map();

    constructor(private config: ArbitrageConfig) {
        super();
    }

    public handlePriceUpdate(priceData: ExchangePrice): void {
        const key = `${priceData.exchange}:${priceData.symbol}`;
        this.prices.set(key, priceData);

        this.checkArbitrageOpportunities(priceData.symbol);
    }

    private checkArbitrageOpportunities(symbol: string): void {
        const relevantPrices = Array.from(this.prices.values())
            .filter(price => price.symbol === symbol);

        if (relevantPrices.length < 2) return;

        const opportunities: ArbitrageOpportunity[] = [];

        for (let i = 0; i < relevantPrices.length; i++) {
            for (let j = i + 1; j < relevantPrices.length; j++) {
                const price1 = relevantPrices[i];
                const price2 = relevantPrices[j];

                const opportunity1 = this.calculateOpportunity(price1, price2);
                const opportunity2 = this.calculateOpportunity(price2, price1);

                if (opportunity1) opportunities.push(opportunity1);
                if (opportunity2) opportunities.push(opportunity2);
            }
        }

        opportunities.forEach(opportunity => {
            if (opportunity.profitPercent >= this.config.minProfitPercent) {
                this.addOpportunity(opportunity);
                this.emit('opportunityFound', opportunity);
            }
        });
    }

    private calculateOpportunity(
        buyPrice: ExchangePrice,
        sellPrice: ExchangePrice
    ): ArbitrageOpportunity | null {
        if (sellPrice.price <= buyPrice.price) return null;

        const fees = this.calculateFees(buyPrice.exchange, sellPrice.exchange);
        const grossProfit = sellPrice.price - buyPrice.price;
        const netProfit = grossProfit - fees.total;
        const profitPercent = (netProfit / buyPrice.price) * 100;

        if (profitPercent <= 0) return null;

        return {
            id: crypto.randomUUID(),
            symbol: buyPrice.symbol,
            buyExchange: buyPrice.exchange,
            sellExchange: sellPrice.exchange,
            buyPrice: buyPrice.price,
            sellPrice: sellPrice.price,
            profitPercent: Number(profitPercent.toFixed(4)),
            profitAmount: Number(netProfit.toFixed(6)),
            volume: Math.min(buyPrice.volume || 0, sellPrice.volume || 0),
            timestamp: new Date(),
            fees
        };
    }

    private calculateFees(buyExchange: string, sellExchange: string): { buy: number; sell: number; total: number } {
        const exchangeFees: Record<string, number> = {
            binance: 0.001,  // 0.1%
            coinbase: 0.005, // 0.5%
            kraken: 0.0026,  // 0.26%
        };

        const buyFee = exchangeFees[buyExchange] || 0.001;
        const sellFee = exchangeFees[sellExchange] || 0.001;

        return {
            buy: buyFee,
            sell: sellFee,
            total: buyFee + sellFee
        };
    }

    private addOpportunity(opportunity: ArbitrageOpportunity): void {
        this.opportunities.set(opportunity.id, opportunity);

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        for (const [id, opp] of this.opportunities) {
            if (opp.timestamp < fiveMinutesAgo) {
                this.opportunities.delete(id);
            }
        }
    }

    public getOpportunities(): ArbitrageOpportunity[] {
        return Array.from(this.opportunities.values())
            .sort((a, b) => b.profitPercent - a.profitPercent);
    }

    public getOpportunity(id: string): ArbitrageOpportunity | undefined {
        return this.opportunities.get(id);
    }

    public getPrice(exchange: string, symbol: string): ExchangePrice | undefined {
        return this.prices.get(`${exchange}:${symbol}`);
    }

    public getAllPrices(): ExchangePrice[] {
        return Array.from(this.prices.values());
    }
}
