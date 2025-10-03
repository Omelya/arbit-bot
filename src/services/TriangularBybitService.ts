import { EventEmitter } from 'events';
import { ExchangePrice, OrderBookMetrics } from '../types';
import { PriceCache, TriangularConfig, TriangularOpportunity, TriangularPath } from '../types/triangular';
import * as crypto from 'node:crypto';

export class TriangularBybitService extends EventEmitter {
    private priceCache: Map<string, PriceCache> = new Map();
    private opportunities: Map<string, TriangularOpportunity> = new Map();
    private lastCheckTime: Map<string, number> = new Map();

    private readonly maxPriceAge = 2000;
    private readonly bybitTakerFee = 0.001;
    private readonly checkThrottle = 100;

    private readonly paths: TriangularPath[] = [
        {
            symbols: ['BTC/USDT', 'ETH/BTC', 'ETH/USDT'],
            directions: ['buy', 'buy', 'sell'],
            minAmount: 100,
            description: 'USDT → BTC → ETH → USDT'
        },
        {
            symbols: ['BTC/USDT', 'SOL/BTC', 'SOL/USDT'],
            directions: ['buy', 'buy', 'sell'],
            minAmount: 50,
            description: 'USDT → BTC → SOL → USDT'
        },
        {
            symbols: ['BTC/USDT', 'XRP/BTC', 'XRP/USDT'],
            directions: ['buy', 'buy', 'sell'],
            minAmount: 50,
            description: 'USDT → BTC → XRP → USDT'
        },
        {
            symbols: ['BTC/USDT', 'LTC/BTC', 'LTC/USDT'],
            directions: ['buy', 'buy', 'sell'],
            minAmount: 50,
            description: 'USDT → BTC → LTC → USDT'
        },
    ];

    constructor(private config: TriangularConfig) {
        super();
        this.startCleanupInterval();
    }

    public handlePriceUpdate(priceData: ExchangePrice): void {
        if (priceData.exchange !== 'bybit') return;

        const key = this.getPriceKey(priceData.symbol);
        const cached = this.priceCache.get(key);

        this.priceCache.set(key, {
            price: priceData,
            orderBook: cached?.orderBook
        });

        this.checkRelevantPaths(priceData.symbol);
    }

    public handleOrderBookUpdate(data: {
        exchange: string;
        symbol: string;
        orderBook: OrderBookMetrics;
    }): void {
        if (data.exchange !== 'bybit') return;

        const key = this.getPriceKey(data.symbol);
        const cached = this.priceCache.get(key);

        if (cached) {
            cached.orderBook = data.orderBook;
        }
    }

    private checkRelevantPaths(updatedSymbol: string): void {
        for (const path of this.paths) {
            if (!path.symbols.includes(updatedSymbol)) continue;

            const pathKey = this.getPathKey(path);
            const lastCheck = this.lastCheckTime.get(pathKey) || 0;
            const now = Date.now();

            if (now - lastCheck < this.checkThrottle) continue;

            this.lastCheckTime.set(pathKey, now);
            this.checkTriangularPath(path);
        }
    }

    private checkTriangularPath(path: TriangularPath): void {
        const startTime = Date.now();

        const pricesData = this.gatherPriceData(path);
        if (!pricesData) return;

        const opportunity = this.calculateOpportunity(
            path,
            pricesData,
            startTime
        );

        if (!opportunity || !opportunity.valid) return;

        if (
            opportunity.profitPercent >= this.config.minProfitPercent &&
            opportunity.confidence >= this.config.minConfidence
        ) {
            this.addOpportunity(opportunity);
            this.emit('triangularOpportunity', opportunity);
        }
    }

    private gatherPriceData(path: TriangularPath): PriceCache[] | null {
        const data: PriceCache[] = [];

        for (const symbol of path.symbols) {
            const key = this.getPriceKey(symbol);
            const cached = this.priceCache.get(key);

            if (!cached) return null;

            if (this.isPriceStale(cached.price)) return null;

            data.push(cached);
        }

        return data;
    }

    private calculateOpportunity(
        path: TriangularPath,
        pricesData: PriceCache[],
        startTime: number
    ): TriangularOpportunity | null {
        let amount = path.minAmount;
        const prices: number[] = [];
        const effectivePrices: number[] = [];
        const feesPerTrade: number[] = [];
        const slippagePerTrade: number[] = [];

        for (let i = 0; i < path.symbols.length; i++) {
            const cached = pricesData[i];
            const direction = path.directions[i];
            const price = cached.price;

            prices.push(price.price);

            const effectivePrice = this.calculateEffectivePrice(
                cached,
                direction,
                amount,
            );

            if (!effectivePrice) return null;

            effectivePrices.push(effectivePrice.price);
            slippagePerTrade.push(effectivePrice.slippage);

            if (effectivePrice.slippage > this.config.maxSlippagePerTrade) {
                return null;
            }

            if (direction === 'buy') {
                amount = amount / effectivePrice.price;
            } else {
                amount = amount * effectivePrice.price;
            }

            const fee = amount * this.bybitTakerFee;
            feesPerTrade.push(fee);
            amount -= fee;
        }

        const profitUSDT = amount - path.minAmount;
        const profitPercent = (profitUSDT / path.minAmount) * 100;

        if (profitPercent <= 0) return null;

        const confidence = this.calculateConfidence(
            pricesData,
            slippagePerTrade,
            profitPercent,
        );

        const totalSlippage = slippagePerTrade.reduce((sum, s) => sum + s, 0);
        if (totalSlippage > this.config.maxSlippage) return null;

        const executionTime = Date.now() - startTime;

        return {
            id: crypto.randomUUID(),
            exchange: 'bybit',
            path: path.symbols,
            directions: path.directions,
            prices,
            effectivePrices,
            startAmount: path.minAmount,
            endAmount: amount,
            profitPercent: Number(profitPercent.toFixed(4)),
            profitUSDT: Number(profitUSDT.toFixed(2)),
            fees: {
                total: Number(feesPerTrade.reduce((sum, f) => sum + f, 0).toFixed(2)),
                perTrade: feesPerTrade.map(f => Number(f.toFixed(2)))
            },
            confidence: Number(confidence.toFixed(2)),
            executionTime,
            slippage: {
                total: Number(totalSlippage.toFixed(4)),
                perTrade: slippagePerTrade.map(s => Number(s.toFixed(4)))
            },
            timestamp: new Date(),
            valid: true,
        };
    }

    private calculateEffectivePrice(
        cached: PriceCache,
        direction: 'buy' | 'sell',
        amount: number
    ): { price: number; slippage: number } | null {
        const price = cached.price;
        const orderBook = cached.orderBook;

        if (orderBook && orderBook.bids.length > 0 && orderBook.asks.length > 0) {
            return this.calculatePriceFromOrderBook(
                orderBook,
                direction,
                amount,
                price.price
            );
        }

        if (direction === 'buy') {
            const effectivePrice = price.ask || price.price * 1.0005;
            const slippage = Math.abs(effectivePrice - price.price) / price.price;
            return { price: effectivePrice, slippage };
        } else {
            const effectivePrice = price.bid || price.price * 0.9995;
            const slippage = Math.abs(price.price - effectivePrice) / price.price;
            return { price: effectivePrice, slippage };
        }
    }

    private calculatePriceFromOrderBook(
        orderBook: OrderBookMetrics,
        direction: 'buy' | 'sell',
        amountUSDT: number,
        marketPrice: number
    ): { price: number; slippage: number } | null {
        const orders = direction === 'buy' ? orderBook.asks : orderBook.bids;

        let remainingAmount = direction === 'buy'
            ? amountUSDT / marketPrice
            : amountUSDT / marketPrice;

        let totalCost = 0;
        let totalVolume = 0;

        for (const [orderPrice, orderVolume] of orders) {
            if (remainingAmount <= 0) break;

            const fillAmount = Math.min(remainingAmount, orderVolume);
            totalCost += fillAmount * orderPrice;
            totalVolume += fillAmount;
            remainingAmount -= fillAmount;
        }

        if (remainingAmount > 0) {
            return null;
        }

        const effectivePrice = totalCost / totalVolume;
        const slippage = Math.abs(effectivePrice - marketPrice) / marketPrice;

        return { price: effectivePrice, slippage };
    }

    private calculateConfidence(
        pricesData: PriceCache[],
        slippagePerTrade: number[],
        profitPercent: number
    ): number {
        let score = 100;

        // 1. Фактор свіжості даних (максимум -20)
        const now = Date.now();
        const avgAge = pricesData.reduce((sum, p) =>
            sum + (now - p.price.timestamp), 0
        ) / pricesData.length;
        const agePenalty = Math.min(20, (avgAge / 100)); // -20 за 2000мс
        score -= agePenalty;

        // 2. Фактор slippage (максимум -30)
        const totalSlippage = slippagePerTrade.reduce((sum, s) => sum + s, 0);
        const slippagePenalty = (totalSlippage / this.config.maxSlippage) * 30;
        score -= slippagePenalty;

        // 3. Фактор прибутку (бонус до +20)
        const profitBonus = Math.min(20, profitPercent * 4); // +20 за 5% profit
        score += profitBonus;

        // 4. Фактор ліквідності (максимум -20)
        let liquidityPenalty = 0;
        for (const cached of pricesData) {
            if (!cached.orderBook) {
                liquidityPenalty += 5;
            } else {
                const spread = cached.orderBook.spreadPercent;
                liquidityPenalty += Math.min(10, spread * 100); // -10 за 10% spread
            }
        }
        score -= Math.min(20, liquidityPenalty / pricesData.length);

        return Math.max(0, Math.min(100, score));
    }

    private isPriceStale(price: ExchangePrice): boolean {
        return Date.now() - price.timestamp > this.maxPriceAge;
    }

    private addOpportunity(opportunity: TriangularOpportunity): void {
        const pathKey = this.getPathKey({
            symbols: opportunity.path,
            directions: opportunity.directions,
        });

        const existing = this.opportunities.get(pathKey);
        if (existing && existing.profitPercent > opportunity.profitPercent) {
            return;
        }

        this.opportunities.set(pathKey, opportunity);
    }

    public getOpportunities(): TriangularOpportunity[] {
        this.cleanupStaleOpportunities();

        return Array.from(this.opportunities.values())
            .filter(opp => opp.valid)
            .sort((a, b) => b.profitPercent - a.profitPercent);
    }

    public getOpportunity(id: string): TriangularOpportunity | undefined {
        for (const opp of this.opportunities.values()) {
            if (opp.id === id) return opp;
        }
        return undefined;
    }

    public getStats(): {
        totalOpportunities: number;
        profitableOpportunities: number;
        avgProfit: number;
        bestOpportunity: TriangularOpportunity | null;
        pathsMonitored: number;
    } {
        const opportunities = this.getOpportunities();
        const profitable = opportunities.filter(o => o.profitPercent > this.config.minProfitPercent);

        return {
            totalOpportunities: opportunities.length,
            profitableOpportunities: profitable.length,
            avgProfit: profitable.length > 0
                ? profitable.reduce((sum, o) => sum + o.profitPercent, 0) / profitable.length
                : 0,
            bestOpportunity: opportunities[0] || null,
            pathsMonitored: this.paths.length
        };
    }

    private cleanupStaleOpportunities(): void {
        const maxAge = 30000;
        const now = Date.now();

        for (const [key, opp] of this.opportunities) {
            if (now - opp.timestamp.getTime() > maxAge) {
                this.opportunities.delete(key);
            }
        }
    }

    private startCleanupInterval(): void {
        setInterval(() => {
            this.cleanupStaleOpportunities();
            this.cleanupStaleLastCheckTimes();
        }, 10000);
    }

    private cleanupStaleLastCheckTimes(): void {
        const maxAge = 60000;
        const now = Date.now();

        for (const [key, time] of this.lastCheckTime) {
            if (now - time > maxAge) {
                this.lastCheckTime.delete(key);
            }
        }
    }

    private getPriceKey(symbol: string): string {
        return `bybit:${symbol}`;
    }

    private getPathKey(path: { symbols: string[]; directions: ('buy' | 'sell')[] }): string {
        return `${path.symbols.join('→')}:${path.directions.join(',')}`;
    }

    public cleanup(): void {
        this.priceCache.clear();
        this.opportunities.clear();
        this.lastCheckTime.clear();
        this.removeAllListeners();
    }
}
