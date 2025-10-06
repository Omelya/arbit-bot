import { EventEmitter } from 'events';
import { createChildLogger } from '../../../utils/logger';
import { TriangularOpportunity } from '../../../types/triangular';
import { TradeAttempt, TradeStatus, TradeState, ProfitResult } from '../../../types/trading';
import { TradeExecutionService, OrderRequest, ExecutedOrder } from '../TradeExecutionService';
import { BalanceManager } from '../BalanceManager';
import { RiskManager } from '../../RiskManager';
import * as crypto from 'node:crypto';

const logger = createChildLogger(__filename);

export class TriangularStrategy extends EventEmitter {
    constructor(
        private executionService: TradeExecutionService,
        private balanceManager: BalanceManager,
        private riskManager: RiskManager
    ) {
        super();
    }

    public async execute(opportunity: TriangularOpportunity): Promise<TradeAttempt> {
        const tradeAttempt: TradeAttempt = {
            id: crypto.randomUUID(),
            opportunityId: opportunity.id,
            opportunityType: 'triangular',
            status: TradeStatus.VALIDATING,
            orders: [],
            preTradeState: await this.captureTradeState(opportunity),
            startTime: Date.now()
        };

        logger.info({
            msg: '🔺 Starting triangular arbitrage trade',
            tradeId: tradeAttempt.id,
            opportunity: {
                exchange: opportunity.exchange,
                path: opportunity.path.join(' → '),
                profit: opportunity.profitPercent
            }
        });

        try {
            // 1. Risk check
            const riskCheck = await this.riskManager.checkOpportunity(opportunity, 'triangular');

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

            // 2. Lock balance (тільки USDT)
            const startAmount = opportunity.startAmount || 100;
            const locked = this.balanceManager.lockBalance(
                tradeAttempt.id,
                opportunity.exchange,
                'USDT',
                startAmount
            );

            if (!locked) {
                throw new Error('Failed to lock USDT balance');
            }

            // 3. Increment active trades
            this.riskManager.incrementActiveTrades('triangular');

            // 4. Execute orders sequentially
            tradeAttempt.status = TradeStatus.EXECUTING;
            this.emit('tradeExecuting', tradeAttempt);

            const executedOrders = await this.executeSequentially(opportunity);
            tradeAttempt.orders = executedOrders;

            // 5. Calculate profit
            const profit = this.calculateProfit(opportunity, executedOrders);
            tradeAttempt.profit = profit;

            // 6. Capture post-trade state
            tradeAttempt.postTradeState = await this.captureTradeState(opportunity);

            // 7. Complete
            tradeAttempt.status = TradeStatus.COMPLETED;
            tradeAttempt.endTime = Date.now();
            tradeAttempt.executionTimeMs = tradeAttempt.endTime - tradeAttempt.startTime;

            // 8. Record in risk manager
            this.riskManager.recordTrade(profit.netProfit);

            logger.info({
                msg: '✅ Triangular trade completed',
                tradeId: tradeAttempt.id,
                profit: profit.netProfit.toFixed(2),
                profitPercent: profit.profitPercent.toFixed(2),
                executionTime: tradeAttempt.executionTimeMs
            });

            this.emit('tradeCompleted', tradeAttempt);

            return tradeAttempt;

        } catch (error: any) {
            logger.error({
                msg: '❌ Triangular trade failed',
                tradeId: tradeAttempt.id,
                error: error.message,
                completedOrders: tradeAttempt.orders.length
            });

            tradeAttempt.status = TradeStatus.FAILED;
            tradeAttempt.error = error.message;
            tradeAttempt.endTime = Date.now();

            this.emit('tradeFailed', tradeAttempt);

            return tradeAttempt;

        } finally {
            // Unlock balance
            this.balanceManager.unlockBalance(
                tradeAttempt.id,
                opportunity.exchange,
                'USDT'
            );

            // Decrement active trades
            this.riskManager.decrementActiveTrades('triangular');

            // Refresh balance
            await this.balanceManager.fetchBalance(opportunity.exchange);
        }
    }

    private async executeSequentially(
        opportunity: TriangularOpportunity
    ): Promise<ExecutedOrder[]> {
        const executedOrders: ExecutedOrder[] = [];
        let currentAmount = opportunity.startAmount || 100;

        for (let i = 0; i < opportunity.path.length; i++) {
            const symbol = opportunity.path[i];
            const direction = opportunity.directions[i];

            // Розрахунок amount для ордера
            let orderAmount: number;
            if (direction === 'buy') {
                // Купуємо base за quote
                orderAmount = currentAmount / opportunity.effectivePrices[i];
            } else {
                // Продаємо base за quote
                orderAmount = currentAmount;
            }

            const orderRequest: OrderRequest = {
                exchange: opportunity.exchange,
                symbol,
                side: direction,
                amount: orderAmount,
                type: 'market'
            };

            logger.info({
                msg: `📊 Executing step ${i + 1}/${opportunity.path.length}`,
                symbol,
                side: direction,
                amount: orderAmount.toFixed(6)
            });

            try {
                const order = await this.executionService.executeOrder(orderRequest);
                executedOrders.push(order);

                // Чекаємо завершення ордера
                const completedOrder = await this.executionService.waitForOrderCompletion(
                    order.exchange,
                    order.id,
                    30000
                );

                // Оновлюємо currentAmount для наступного кроку
                if (direction === 'buy') {
                    currentAmount = completedOrder.filled;
                } else {
                    currentAmount = completedOrder.cost - completedOrder.fee.cost;
                }

                logger.info({
                    msg: `✅ Step ${i + 1} completed`,
                    filled: completedOrder.filled,
                    cost: completedOrder.cost,
                    fee: completedOrder.fee.cost,
                    currentAmount: currentAmount.toFixed(6)
                });

            } catch (error: any) {
                logger.error({
                    msg: `❌ Step ${i + 1} failed`,
                    symbol,
                    error: error.message
                });

                throw new Error(`Triangular execution failed at step ${i + 1}: ${error.message}`);
            }
        }

        return executedOrders;
    }

    private async captureTradeState(opportunity: TriangularOpportunity): Promise<TradeState> {
        const usdtBalance = this.balanceManager.getBalance(
            opportunity.exchange,
            'USDT'
        );

        return {
            timestamp: Date.now(),
            balances: [
                {
                    exchange: opportunity.exchange,
                    currency: 'USDT',
                    amount: usdtBalance?.free || 0
                }
            ],
            prices: opportunity.path.map((symbol, index) => ({
                exchange: opportunity.exchange,
                symbol,
                price: opportunity.effectivePrices[index]
            }))
        };
    }

    private calculateProfit(
        opportunity: TriangularOpportunity,
        orders: ExecutedOrder[]
    ): ProfitResult {
        if (orders.length !== opportunity.path.length) {
            throw new Error('Incomplete order execution');
        }

        const startAmount = opportunity.startAmount || 100;
        const lastOrder = orders[orders.length - 1];
        const endAmount = lastOrder.cost - lastOrder.fee.cost;

        const grossProfit = endAmount - startAmount;
        const totalFees = orders.reduce((sum, order) => sum + order.fee.cost, 0);
        const netProfit = grossProfit;

        const profitPercent = (netProfit / startAmount) * 100;

        const expectedSlippage = opportunity.slippage.total;
        const actualSlippage = orders.reduce((sum, order, index) => {
            const expectedPrice = opportunity.effectivePrices[index];
            const actualPrice = order.average || order.price || expectedPrice;
            return sum + Math.abs(actualPrice - expectedPrice);
        }, 0);

        return {
            grossProfit,
            netProfit,
            profitPercent,
            fees: {
                total: totalFees,
                breakdown: orders.map(order => ({
                    exchange: order.exchange,
                    amount: order.fee.cost
                }))
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
        logger.info('✅ TriangularStrategy cleaned up');
    }
}
