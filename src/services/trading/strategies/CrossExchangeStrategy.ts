import { EventEmitter } from 'events';
import { createChildLogger } from '../../../utils/logger';
import { ArbitrageOpportunity } from '../../../types';
import { TradeAttempt, TradeStatus, TradeState, ProfitResult } from '../../../types/trading';
import { TradeExecutionService, OrderRequest } from '../TradeExecutionService';
import { BalanceManager } from '../BalanceManager';
import { RiskManager } from '../../RiskManager';
import * as crypto from 'node:crypto';

const logger = createChildLogger(__filename);

export class CrossExchangeStrategy extends EventEmitter {
    constructor(
        private executionService: TradeExecutionService,
        private balanceManager: BalanceManager,
        private riskManager: RiskManager
    ) {
        super();
    }

    public async execute(opportunity: ArbitrageOpportunity): Promise<TradeAttempt> {
        const tradeAttempt: TradeAttempt = {
            id: crypto.randomUUID(),
            opportunityId: opportunity.id,
            opportunityType: 'cross-exchange',
            status: TradeStatus.VALIDATING,
            orders: [],
            preTradeState: await this.captureTradeState(opportunity),
            startTime: Date.now()
        };

        logger.info({
            msg: '🎯 Starting cross-exchange trade',
            tradeId: tradeAttempt.id,
            opportunity: {
                symbol: opportunity.symbol,
                buyExchange: opportunity.buyExchange,
                sellExchange: opportunity.sellExchange,
                profit: opportunity.profitPercent
            }
        });

        try {
            // 1. Risk check
            const riskCheck = await this.riskManager.checkOpportunity(opportunity, 'cross-exchange');

            if (!riskCheck.approved) {
                tradeAttempt.status = TradeStatus.REJECTED;
                tradeAttempt.error = riskCheck.reasons.join(', ');
                tradeAttempt.endTime = Date.now();

                logger.warn({
                    msg: '⚠️ Trade rejected by risk manager',
                    tradeId: tradeAttempt.id,
                    reasons: riskCheck.reasons
                });

                this.emit('tradeRejected', tradeAttempt);
                return tradeAttempt;
            }

            tradeAttempt.status = TradeStatus.APPROVED;
            this.emit('tradeApproved', tradeAttempt);

            // 2. Lock balances
            const [baseCurrency, quoteCurrency] = opportunity.symbol.split('/');
            const buyAmount = opportunity.recommendedTradeSize || 100;
            const sellAmount = buyAmount / opportunity.buyPrice;

            const buyLocked = this.balanceManager.lockBalance(
                tradeAttempt.id,
                opportunity.buyExchange,
                quoteCurrency,
                buyAmount
            );

            const sellLocked = this.balanceManager.lockBalance(
                tradeAttempt.id,
                opportunity.sellExchange,
                baseCurrency,
                sellAmount
            );

            if (!buyLocked || !sellLocked) {
                throw new Error('Failed to lock balances');
            }

            // 3. Increment active trades
            this.riskManager.incrementActiveTrades('cross-exchange');

            // 4. Execute orders simultaneously
            tradeAttempt.status = TradeStatus.EXECUTING;
            this.emit('tradeExecuting', tradeAttempt);

            const orders: OrderRequest[] = [
                {
                    exchange: opportunity.buyExchange,
                    symbol: opportunity.symbol,
                    side: 'buy',
                    amount: sellAmount,
                    type: 'market'
                },
                {
                    exchange: opportunity.sellExchange,
                    symbol: opportunity.symbol,
                    side: 'sell',
                    amount: sellAmount,
                    type: 'market'
                }
            ];

            const executedOrders = await this.executionService.executeOrders(orders);
            tradeAttempt.orders = executedOrders;

            // 5. Monitor order completion
            tradeAttempt.status = TradeStatus.MONITORING;
            this.emit('tradeMonitoring', tradeAttempt);

            await Promise.all(
                executedOrders.map(order =>
                    this.executionService.waitForOrderCompletion(
                        order.exchange,
                        order.id,
                        30000
                    )
                )
            );

            // 6. Calculate profit
            const profit = this.calculateProfit(opportunity, executedOrders);
            tradeAttempt.profit = profit;

            // 7. Capture post-trade state
            tradeAttempt.postTradeState = await this.captureTradeState(opportunity);

            // 8. Complete
            tradeAttempt.status = TradeStatus.COMPLETED;
            tradeAttempt.endTime = Date.now();
            tradeAttempt.executionTimeMs = tradeAttempt.endTime - tradeAttempt.startTime;

            // 9. Record in risk manager
            this.riskManager.recordTrade(profit.netProfit);

            logger.info({
                msg: '✅ Cross-exchange trade completed',
                tradeId: tradeAttempt.id,
                profit: profit.netProfit.toFixed(2),
                profitPercent: profit.profitPercent.toFixed(2),
                executionTime: tradeAttempt.executionTimeMs
            });

            this.emit('tradeCompleted', tradeAttempt);

            return tradeAttempt;

        } catch (error: any) {
            logger.error({
                msg: '❌ Cross-exchange trade failed',
                tradeId: tradeAttempt.id,
                error: error.message
            });

            tradeAttempt.status = TradeStatus.FAILED;
            tradeAttempt.error = error.message;
            tradeAttempt.endTime = Date.now();

            this.emit('tradeFailed', tradeAttempt);

            return tradeAttempt;

        } finally {
            // Unlock balances
            const [baseCurrency, quoteCurrency] = opportunity.symbol.split('/');
            this.balanceManager.unlockBalance(
                tradeAttempt.id,
                opportunity.buyExchange,
                quoteCurrency
            );
            this.balanceManager.unlockBalance(
                tradeAttempt.id,
                opportunity.sellExchange,
                baseCurrency
            );

            // Decrement active trades
            this.riskManager.decrementActiveTrades('cross-exchange');

            // Refresh balances
            await this.balanceManager.fetchBalance(opportunity.buyExchange);
            await this.balanceManager.fetchBalance(opportunity.sellExchange);
        }
    }

    private async captureTradeState(opportunity: ArbitrageOpportunity): Promise<TradeState> {
        const [baseCurrency, quoteCurrency] = opportunity.symbol.split('/');

        const buyQuoteBalance = this.balanceManager.getBalance(
            opportunity.buyExchange,
            quoteCurrency
        );

        const sellBaseBalance = this.balanceManager.getBalance(
            opportunity.sellExchange,
            baseCurrency
        );

        return {
            timestamp: Date.now(),
            balances: [
                {
                    exchange: opportunity.buyExchange,
                    currency: quoteCurrency,
                    amount: buyQuoteBalance?.free || 0
                },
                {
                    exchange: opportunity.sellExchange,
                    currency: baseCurrency,
                    amount: sellBaseBalance?.free || 0
                }
            ],
            prices: [
                {
                    exchange: opportunity.buyExchange,
                    symbol: opportunity.symbol,
                    price: opportunity.buyPrice
                },
                {
                    exchange: opportunity.sellExchange,
                    symbol: opportunity.symbol,
                    price: opportunity.sellPrice
                }
            ]
        };
    }

    private calculateProfit(
        opportunity: ArbitrageOpportunity,
        orders: any[]
    ): ProfitResult {
        const buyOrder = orders.find(o => o.side === 'buy');
        const sellOrder = orders.find(o => o.side === 'sell');

        if (!buyOrder || !sellOrder) {
            throw new Error('Missing orders for profit calculation');
        }

        const buyCost = buyOrder.cost + buyOrder.fee.cost;
        const sellRevenue = sellOrder.cost - sellOrder.fee.cost;

        const grossProfit = sellRevenue - buyCost;
        const netProfit = grossProfit;

        const profitPercent = (netProfit / buyCost) * 100;

        const totalFees = buyOrder.fee.cost + sellOrder.fee.cost;

        const expectedSlippage = opportunity.buySlippage + opportunity.sellSlippage;
        const actualBuySlippage = Math.abs(buyOrder.average - opportunity.buyPrice);
        const actualSellSlippage = Math.abs(sellOrder.average - opportunity.sellPrice);
        const actualSlippage = actualBuySlippage + actualSellSlippage;

        return {
            grossProfit,
            netProfit,
            profitPercent,
            fees: {
                total: totalFees,
                breakdown: [
                    {
                        exchange: buyOrder.exchange,
                        amount: buyOrder.fee.cost
                    },
                    {
                        exchange: sellOrder.exchange,
                        amount: sellOrder.fee.cost
                    }
                ]
            },
            slippage: {
                total: actualSlippage,
                expected: expectedSlippage,
                actual: actualSlippage
            }
        };
    }

    public cleanup(): void {
        this.removeAllListeners();
        logger.info('✅ CrossExchangeStrategy cleaned up');
    }
}
