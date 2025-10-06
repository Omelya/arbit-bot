import { EventEmitter } from 'events';
import { createChildLogger } from '../../utils/logger';
import { ArbitrageOpportunity } from '../../types';
import { TriangularOpportunity } from '../../types/triangular';
import { TradeDecision, TradingConfig, OpportunityType } from '../../types/trading';
import { RiskManager } from '../RiskManager';

const logger = createChildLogger(__filename);

export class TradeDecisionEngine extends EventEmitter {
    private lastTradeTime: Map<string, number> = new Map();
    private readonly cooldownPeriod = 5000; // 5 seconds between trades on same symbol

    constructor(
        private config: TradingConfig,
        private riskManager: RiskManager
    ) {
        super();
    }

    public async evaluateOpportunity(
        opportunity: ArbitrageOpportunity | TriangularOpportunity,
        type: OpportunityType
    ): Promise<TradeDecision> {
        logger.debug({
            msg: '🔍 Evaluating opportunity',
            type,
            id: opportunity.id,
            profit: opportunity.profitPercent
        });

        // 1. Check if trading is enabled
        if (!this.config.enabled) {
            return this.createRejection(opportunity, type, 'Trading is disabled');
        }

        // 2. Check type-specific enabled flag
        const typeEnabled = type === 'cross-exchange'
            ? this.config.crossExchange.enabled
            : this.config.triangular.enabled;

        if (!typeEnabled) {
            return this.createRejection(opportunity, type, `${type} trading is disabled`);
        }

        // 3. Check cooldown period
        if (!this.checkCooldown(opportunity, type)) {
            return this.createRejection(opportunity, type, 'In cooldown period');
        }

        // 4. Perform risk check
        const riskCheck = await this.riskManager.checkOpportunity(opportunity, type);

        if (!riskCheck.approved) {
            return {
                approved: false,
                opportunity,
                opportunityType: type,
                reason: riskCheck.reasons.join('; '),
                priority: 0,
                riskCheck
            };
        }

        // 5. Calculate priority
        const priority = this.calculatePriority(opportunity, type);

        logger.info({
            msg: '✅ Opportunity approved',
            type,
            id: opportunity.id,
            profit: opportunity.profitPercent,
            priority
        });

        return {
            approved: true,
            opportunity,
            opportunityType: type,
            priority,
            riskCheck
        };
    }

    private checkCooldown(
        opportunity: ArbitrageOpportunity | TriangularOpportunity,
        type: OpportunityType
    ): boolean {
        const key = this.getCooldownKey(opportunity, type);
        const lastTrade = this.lastTradeTime.get(key);

        if (!lastTrade) {
            return true;
        }

        const elapsed = Date.now() - lastTrade;
        return elapsed >= this.cooldownPeriod;
    }

    public updateCooldown(
        opportunity: ArbitrageOpportunity | TriangularOpportunity,
        type: OpportunityType
    ): void {
        const key = this.getCooldownKey(opportunity, type);
        this.lastTradeTime.set(key, Date.now());

        logger.debug({
            msg: '⏱️ Cooldown updated',
            key,
            timestamp: Date.now()
        });
    }

    private getCooldownKey(
        opportunity: ArbitrageOpportunity | TriangularOpportunity,
        type: OpportunityType
    ): string {
        if (type === 'cross-exchange') {
            const opp = opportunity as ArbitrageOpportunity;
            return `cross:${opp.symbol}:${opp.buyExchange}:${opp.sellExchange}`;
        } else {
            const opp = opportunity as TriangularOpportunity;
            return `triangular:${opp.exchange}:${opp.path.join('-')}`;
        }
    }

    private calculatePriority(
        opportunity: ArbitrageOpportunity | TriangularOpportunity,
        type: OpportunityType
    ): number {
        let priority = 0;

        // 1. Profit weight (40%)
        const profitScore = Math.min(opportunity.profitPercent * 10, 40);
        priority += profitScore;

        // 2. Confidence weight (30%)
        const confidenceScore = (opportunity.confidence / 100) * 30;
        priority += confidenceScore;

        // 3. Execution time weight (20%) - faster is better
        if ('executionTime' in opportunity) {
            const timeScore = Math.max(0, 20 - (opportunity.executionTime / 100));
            priority += timeScore;
        } else {
            priority += 10; // Default for cross-exchange
        }

        // 4. Liquidity weight (10%)
        if ('liquidityScore' in opportunity) {
            const liquidityScore = (opportunity.liquidityScore / 100) * 10;
            priority += liquidityScore;
        } else {
            priority += 5; // Default for triangular
        }

        // 5. Type bonus
        if (type === 'cross-exchange') {
            priority += 5; // Cross-exchange slightly preferred (less risky)
        }

        return Number(priority.toFixed(2));
    }

    private createRejection(
        opportunity: ArbitrageOpportunity | TriangularOpportunity,
        type: OpportunityType,
        reason: string
    ): TradeDecision {
        return {
            approved: false,
            opportunity,
            opportunityType: type,
            reason,
            priority: 0,
            riskCheck: {
                approved: false,
                reasons: [reason],
                checks: {
                    balanceCheck: false,
                    positionSizeCheck: false,
                    dailyLimitCheck: false,
                    concurrentTradesCheck: false,
                    blacklistCheck: false,
                    minProfitCheck: false
                }
            }
        };
    }

    public cleanup(): void {
        this.lastTradeTime.clear();
        this.removeAllListeners();
        logger.info('✅ TradeDecisionEngine cleaned up');
    }
}
