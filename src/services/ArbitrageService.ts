import { EventEmitter } from 'events';
import {ArbitrageOpportunity, ArbitrageConfig, ExchangePrice, OrderBookMetrics, SlippageResult} from '../types';
import * as crypto from "node:crypto";
import {createChildLogger} from "../utils/logger";

const logger = createChildLogger(__filename);

export class ArbitrageService extends EventEmitter {
    private opportunities: Map<string, ArbitrageOpportunity> = new Map();
    private prices: Map<string, ExchangePrice> = new Map();
    private orderBooks: Map<string, OrderBookMetrics> = new Map();

    private readonly minLiquidity: number = 1000;
    private readonly minConfidence: number = 60;
    private readonly maxSlippagePercent: number = 1.0;
    private readonly orderBookMaxAge: number = 10000;

    constructor(private config: ArbitrageConfig,) {
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
            if (this.isOpportunityValid(opportunity)) {
                this.addOpportunity(opportunity);
                this.emit('opportunityFound', opportunity);
            }
        });
    }

    public handleOrderBookUpdate(data: {
        exchange: string;
        symbol: string;
        orderBook: any;
    }): void {
        const key = this.getKey(data.exchange, data.symbol);

        const cache: OrderBookMetrics = {
            symbol: data.symbol,
            exchange: data.exchange,
            bids: data.orderBook.bids || [],
            asks: data.orderBook.asks || [],
            midPrice: data.orderBook.midPrice || 0,
            spread: data.orderBook.spread || 0,
            spreadPercent: data.orderBook.spreadPercent || 0,
            totalBidVolume: data.orderBook.totalBidVolume || 0,
            totalAskVolume: data.orderBook.totalAskVolume || 0,
            timestamp: data.orderBook.timestamp || Date.now(),
            updateId: 0,
            datetime: '',
        };

        this.orderBooks.set(key, cache);
    }

    public handleOrderBookInvalidated(data: {
        exchange: string;
        symbol: string;
    }): void {
        const key = this.getKey(data.exchange, data.symbol);

        this.orderBooks.delete(key);
    }

    private calculateOpportunity(
        buyPrice: ExchangePrice,
        sellPrice: ExchangePrice
    ): ArbitrageOpportunity | null {
        if (sellPrice.price <= buyPrice.price) return null;

        const orderBooks = this.getValidOrderBooks(buyPrice, sellPrice);
        if (!orderBooks) {
            return this.calculateSimpleOpportunity(buyPrice, sellPrice);
        }

        const { buyOrderBook, sellOrderBook } = orderBooks;

        const liquidity = this.calculateAvailableLiquidity(
            buyOrderBook,
            sellOrderBook,
            buyPrice,
            sellPrice,
        );
        if (!this.isLiquiditySufficient(liquidity)) return null;

        const tradeParams = this.calculateTradeParameters(liquidity, buyPrice.price);

        const slippageResult = this.calculateBothSlippages(
            buyOrderBook,
            sellOrderBook,
            tradeParams,
            buyPrice,
            sellPrice,
        );

        if (!slippageResult) return null;

        const profitCalculation = this.calculateNetProfit(
            slippageResult,
            tradeParams.tradeAmount,
            buyPrice.exchange,
            sellPrice.exchange
        );

        if (profitCalculation.profitPercent <= 0) return null;

        const metrics = this.calculateQualityMetrics(
            buyPrice,
            sellPrice,
            buyOrderBook,
            sellOrderBook,
            slippageResult.buy,
            slippageResult.sell,
            profitCalculation.profitPercent,
            liquidity,
        );

        if (metrics.confidence < this.minConfidence) return null;

        return this.buildOpportunity(
            buyPrice,
            sellPrice,
            profitCalculation,
            slippageResult,
            metrics,
            liquidity,
            tradeParams.tradeAmount
        );
    }

    private getValidOrderBooks(
        buyPrice: ExchangePrice,
        sellPrice: ExchangePrice
    ): { buyOrderBook: OrderBookMetrics; sellOrderBook: OrderBookMetrics } | null {
        const buyOrderBook = this.getOrderBook(buyPrice.exchange, buyPrice.symbol);
        const sellOrderBook = this.getOrderBook(sellPrice.exchange, sellPrice.symbol);

        if (!buyOrderBook || !sellOrderBook) return null;

        if (this.areOrderBooksStale(buyOrderBook, sellOrderBook)) {
            logger.warn(`Order Book too old for ${buyPrice.symbol}, exchanges ${buyOrderBook.exchange}, ${sellOrderBook.exchange}`);
            return null;
        }

        return { buyOrderBook, sellOrderBook };
    }

    private areOrderBooksStale(buyOrderBook: OrderBookMetrics, sellOrderBook: OrderBookMetrics): boolean {
        const now = Date.now();
        return (
            now - buyOrderBook.timestamp > this.orderBookMaxAge ||
            now - sellOrderBook.timestamp > this.orderBookMaxAge
        );
    }

    private calculateAvailableLiquidity(
        buyOrderBook: OrderBookMetrics,
        sellOrderBook: OrderBookMetrics,
        buyPrice: ExchangePrice,
        sellPrice: ExchangePrice
    ): number {
        return Math.min(
            buyOrderBook.totalAskVolume * buyPrice.price,
            sellOrderBook.totalBidVolume * sellPrice.price
        );
    }

    private isLiquiditySufficient(liquidity: number): boolean {
        return liquidity >= this.minLiquidity;
    }

    private calculateTradeParameters(liquidity: number, buyPrice: number) {
        const LIQUIDITY_USAGE_RATIO = 0.1;
        const tradeValueUSD = Math.min(
            this.config.maxInvestment,
            liquidity * LIQUIDITY_USAGE_RATIO
        );
        const tradeAmount = tradeValueUSD / buyPrice;

        return { tradeValueUSD, tradeAmount };
    }

    private calculateBothSlippages(
        buyOrderBook: OrderBookMetrics,
        sellOrderBook: OrderBookMetrics,
        tradeParams: { tradeAmount: number },
        buyPrice: ExchangePrice,
        sellPrice: ExchangePrice
    ): { buy: SlippageResult; sell: SlippageResult; totalPercent: number } | null {
        const buySlippage = this.calculateSlippage(
            buyOrderBook.asks,
            tradeParams.tradeAmount,
            buyPrice.price
        );

        const sellSlippage = this.calculateSlippage(
            sellOrderBook.bids,
            tradeParams.tradeAmount,
            sellPrice.price
        );

        if (!buySlippage.feasible || !sellSlippage.feasible) {
            return null;
        }

        const PERCENT_MULTIPLIER = 100;
        const totalPercent =
            ((buySlippage.slippage + sellSlippage.slippage) / buyPrice.price) * PERCENT_MULTIPLIER;

        if (totalPercent > this.maxSlippagePercent) {
            logger.warn(`Slippage too high: ${totalPercent.toFixed(2)}%`);
            return null;
        }

        return {
            buy: buySlippage,
            sell: sellSlippage,
            totalPercent
        };
    }

    private calculateNetProfit(
        slippageResult: { buy: SlippageResult; sell: SlippageResult },
        tradeAmount: number,
        buyExchange: string,
        sellExchange: string
    ) {
        const fees = this.calculateFees(buyExchange, sellExchange);

        const buyFee = slippageResult.buy.effectivePrice * fees.buy;
        const sellFee = slippageResult.sell.effectivePrice * fees.sell;

        const grossProfit =
            (slippageResult.sell.effectivePrice - slippageResult.buy.effectivePrice) * tradeAmount;
        const netProfit = grossProfit - buyFee - sellFee;

        const PERCENT_MULTIPLIER = 100;
        const investedAmount = slippageResult.buy.effectivePrice * tradeAmount;
        const profitPercent = (netProfit / investedAmount) * PERCENT_MULTIPLIER;

        return {
            grossProfit,
            netProfit,
            profitPercent,
            fees: {
                buy: fees.buy,
                sell: fees.sell,
                total: fees.buy + fees.sell
            }
        };
    }

    private buildOpportunity(
        buyPrice: ExchangePrice,
        sellPrice: ExchangePrice,
        profitCalculation: ReturnType<typeof this.calculateNetProfit>,
        slippageResult: { buy: SlippageResult; sell: SlippageResult },
        metrics: {
            confidence: number;
            liquidityScore: number;
            spreadImpact: number;
        },
        liquidity: number,
        tradeAmount: number
    ): ArbitrageOpportunity {
        return {
            id: crypto.randomUUID(),
            symbol: buyPrice.symbol,
            buyExchange: buyPrice.exchange,
            sellExchange: sellPrice.exchange,
            buyPrice: buyPrice.price,
            sellPrice: sellPrice.price,
            profitPercent: Number(profitCalculation.profitPercent.toFixed(4)),
            profitAmount: Number(profitCalculation.netProfit.toFixed(6)),
            volume: Math.min(buyPrice.volume || 0, sellPrice.volume || 0),
            timestamp: new Date(),
            fees: profitCalculation.fees,
            buySlippage: slippageResult.buy.slippage,
            sellSlippage: slippageResult.sell.slippage,
            effectiveBuyPrice: slippageResult.buy.effectivePrice,
            effectiveSellPrice: slippageResult.sell.effectivePrice,
            confidence: metrics.confidence,
            liquidityScore: metrics.liquidityScore,
            spreadImpact: metrics.spreadImpact,
            availableLiquidity: Number(liquidity.toFixed(2)),
            recommendedTradeSize: tradeAmount,
            netProfitAfterSlippage: Number(profitCalculation.netProfit.toFixed(6)),
            profitPercentAfterSlippage: Number(profitCalculation.profitPercent.toFixed(4))
        };
    }

    private calculateSlippage(
        orders: [number, number][],
        amount: number,
        marketPrice: number
    ): SlippageResult {
        let remainingAmount = amount;
        let totalCost = 0;

        for (const [price, volume] of orders) {
            if (remainingAmount <= 0) break;

            const fillAmount = Math.min(remainingAmount, volume);
            totalCost += fillAmount * price;
            remainingAmount -= fillAmount;
        }

        if (remainingAmount > 0) {
            return {
                slippage: Infinity,
                effectivePrice: Infinity,
                feasible: false
            };
        }

        const effectivePrice = totalCost / amount;
        const slippage = Math.abs(effectivePrice - marketPrice);

        return {
            slippage,
            effectivePrice,
            feasible: true
        };
    }

    private calculateQualityMetrics(
        buyPrice: ExchangePrice,
        sellPrice: ExchangePrice,
        buyOrderBook: OrderBookMetrics,
        sellOrderBook: OrderBookMetrics,
        buySlippageData: SlippageResult,
        sellSlippageData: SlippageResult,
        profitPercent: number,
        totalLiquidity: number,
    ): {
        confidence: number;
        liquidityScore: number;
        spreadImpact: number;
    } {
        // 1. Фактор свіжості даних
        const now = Date.now();
        const buyAge = now - buyPrice.timestamp;
        const sellAge = now - sellPrice.timestamp;
        const ageFactor = Math.max(0, 100 - (buyAge + sellAge) / 200);

        // 2. Фактор ліквідності
        const liquidityScore = Math.min(100, (totalLiquidity / this.minLiquidity) * 100);

        // 3. Фактор прибутку
        const profitFactor = Math.min(100, profitPercent * 20); // 5% = 100 балів

        // 4. Фактор спреду (менший спред = краще)
        const avgSpreadPercent = (buyOrderBook.spreadPercent + sellOrderBook.spreadPercent) / 2;
        const spreadFactor = Math.max(0, 100 - avgSpreadPercent * 100);

        // 5. Фактор slippage (менший slippage = краще)
        const totalSlippagePercent = ((buySlippageData.slippage + sellSlippageData.slippage) / buyPrice.price) * 100;
        const slippageFactor = Math.max(0, 100 - totalSlippagePercent * 50);

        const confidence = (
            ageFactor * 0.15 +
            liquidityScore * 0.30 +
            profitFactor * 0.25 +
            spreadFactor * 0.15 +
            slippageFactor * 0.15
        );

        const spreadImpact = (avgSpreadPercent / profitPercent) * 100;

        return {
            confidence: Number(confidence.toFixed(2)),
            liquidityScore: Number(liquidityScore.toFixed(2)),
            spreadImpact: Number(spreadImpact.toFixed(2))
        };
    }

    private calculateSimpleOpportunity(
        buyPrice: ExchangePrice,
        sellPrice: ExchangePrice
    ): ArbitrageOpportunity | null {
        if (sellPrice.price <= buyPrice.price) return null;

        const fees = this.calculateFees(buyPrice.exchange, sellPrice.exchange);

        const buySlippage = buyPrice.ask && buyPrice.bid
            ? (buyPrice.ask - buyPrice.bid) / 2
            : buyPrice.price * 0.001;

        const sellSlippage = sellPrice.ask && sellPrice.bid
            ? (sellPrice.ask - sellPrice.bid) / 2
            : sellPrice.price * 0.001;

        const effectiveBuyPrice = buyPrice.price + buySlippage;
        const effectiveSellPrice = sellPrice.price - sellSlippage;

        const grossProfit = effectiveSellPrice - effectiveBuyPrice;
        const netProfit = grossProfit - (effectiveBuyPrice * fees.buy) - (effectiveSellPrice * fees.sell);
        const profitPercent = (netProfit / effectiveBuyPrice) * 100;

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
            fees: {
                buy: fees.buy,
                sell: fees.sell,
                total: fees.buy + fees.sell
            },
            buySlippage,
            sellSlippage,
            effectiveBuyPrice,
            effectiveSellPrice,
            confidence: 50,
            liquidityScore: 50,
            spreadImpact: 50,
            netProfitAfterSlippage: Number(netProfit.toFixed(6)),
            profitPercentAfterSlippage: Number(profitPercent.toFixed(4))
        };
    }

    private isOpportunityValid(opportunity: ArbitrageOpportunity): boolean {
        return (
            opportunity.profitPercentAfterSlippage >= this.config.minProfitPercent &&
            opportunity.confidence >= this.minConfidence &&
            opportunity.liquidityScore >= 50 &&
            opportunity.netProfitAfterSlippage > 0
        );
    }

    private getOrderBook(exchange: string, symbol: string): OrderBookMetrics | null {
        return this.orderBooks.get(this.getKey(exchange, symbol)) || null;
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
        const existingKey = this.findSimilarOpportunity(opportunity);

        if (existingKey) {
            const existing = this.opportunities.get(existingKey);
            if (existing && opportunity.confidence > existing.confidence) {
                this.opportunities.set(existingKey, opportunity);
            }
            return;
        }

        this.opportunities.set(opportunity.id, opportunity);

        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        for (const [id, opp] of this.opportunities) {
            if (opp.timestamp < fiveMinutesAgo) {
                this.opportunities.delete(id);
            }
        }
    }

    private findSimilarOpportunity(opportunity: ArbitrageOpportunity): string | null {
        for (const [id, existing] of this.opportunities) {
            if (
                existing.symbol === opportunity.symbol &&
                existing.buyExchange === opportunity.buyExchange &&
                existing.sellExchange === opportunity.sellExchange
            ) {
                return id;
            }
        }

        return null;
    }

    private getKey(exchange: string, symbol: string): string {
        return `${exchange}:${symbol}`;
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

    public getAllOrderBooks(): OrderBookMetrics[] {
        return Array.from(this.orderBooks.values());
    }
}
