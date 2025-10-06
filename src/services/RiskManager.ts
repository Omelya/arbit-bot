import { EventEmitter } from 'events';
import { createChildLogger } from '../utils/logger';
import { ArbitrageOpportunity } from '../types';
import { TriangularOpportunity } from '../types/triangular';
import { RiskCheckResult, TradingConfig, OpportunityType } from '../types/trading';
import { BalanceManager } from './trading/BalanceManager';

const logger = createChildLogger(__filename);

export class RiskManager extends EventEmitter {
    private dailyTrades: number = 0;
    private dailyLoss: number = 0;
    private activeTrades: Map<OpportunityType, number> = new Map([
        ['cross-exchange', 0],
        ['triangular', 0]
    ]);
    private lastResetDate: string = '';

    constructor(
        private config: TradingConfig,
        private balanceManager: BalanceManager
    ) {
        super();
        this.resetDailyCounters();
    }

    public async checkOpportunity(
        opportunity: ArbitrageOpportunity | TriangularOpportunity,
        type: OpportunityType
    ): Promise<RiskCheckResult> {
        this.resetDailyCountersIfNeeded();

        const reasons: string[] = [];
        const checks = {
            balanceCheck: false,
            positionSizeCheck: false,
            dailyLimitCheck: false,
            concurrentTradesCheck: false,
            blacklistCheck: false,
            minProfitCheck: false
        };

        // 1. Check if trading is enabled
        if (!this.config.enabled) {
            reasons.push('Trading is globally disabled');
            return { approved: false, reasons, checks };
        }

        // 2. Check emergency stop
        if (this.config.riskManagement.emergencyStop) {
            reasons.push('Emergency stop is active');
            return { approved: false, reasons, checks };
        }

        // 3. Check if specific type is enabled
        const typeConfig = type === 'cross-exchange'
            ? this.config.crossExchange
            : this.config.triangular;

        if (!typeConfig.enabled) {
            reasons.push(`${type} trading is disabled`);
            return { approved: false, reasons, checks };
        }

        // 4. Check blacklists
        checks.blacklistCheck = this.checkBlacklists(opportunity, type);
        if (!checks.blacklistCheck) {
            reasons.push('Symbol or exchange is blacklisted');
        }

        // 5. Check minimum profit
        checks.minProfitCheck = this.checkMinProfit(opportunity, type);
        if (!checks.minProfitCheck) {
            reasons.push(`Profit ${opportunity.profitPercent.toFixed(2)}% below minimum ${typeConfig.minProfitPercent}%`);
        }

        // 6. Check balances
        checks.balanceCheck = await this.checkBalances(opportunity, type);
        if (!checks.balanceCheck) {
            reasons.push('Insufficient balance');
        }

        // 7. Check position size
        checks.positionSizeCheck = this.checkPositionSize(opportunity, type);
        if (!checks.positionSizeCheck) {
            reasons.push(`Position size exceeds maximum ${typeConfig.maxPositionSize}`);
        }

        // 8. Check concurrent trades
        checks.concurrentTradesCheck = this.checkConcurrentTrades(type);
        if (!checks.concurrentTradesCheck) {
            reasons.push(`Maximum concurrent ${type} trades reached (${typeConfig.maxConcurrentTrades})`);
        }

        // 9. Check daily limits
        checks.dailyLimitCheck = this.checkDailyLimits();
        if (!checks.dailyLimitCheck) {
            reasons.push('Daily trading limits reached');
        }

        const approved = Object.values(checks).every(check => check);

        if (approved) {
            logger.info({
                msg: '✅ Risk check passed',
                type,
                opportunityId: opportunity.id,
                profit: opportunity.profitPercent
            });
        } else {
            logger.warn({
                msg: '⚠️ Risk check failed',
                type,
                opportunityId: opportunity.id,
                reasons
            });
        }

        return { approved, reasons, checks };
    }

    private checkBlacklists(
        opportunity: ArbitrageOpportunity | TriangularOpportunity,
        type: OpportunityType
    ): boolean {
        const blacklistedSymbols = this.config.riskManagement.blacklistedSymbols;
        const blacklistedExchanges = this.config.riskManagement.blacklistedExchanges;

        if (type === 'cross-exchange') {
            const opp = opportunity as ArbitrageOpportunity;

            if (blacklistedSymbols.includes(opp.symbol)) return false;
            if (blacklistedExchanges.includes(opp.buyExchange)) return false;
            if (blacklistedExchanges.includes(opp.sellExchange)) return false;
        } else {
            const opp = opportunity as TriangularOpportunity;

            if (opp.path.some(symbol => blacklistedSymbols.includes(symbol))) return false;
            if (blacklistedExchanges.includes(opp.exchange)) return false;
        }

        return true;
    }

    private checkMinProfit(
        opportunity: ArbitrageOpportunity | TriangularOpportunity,
        type: OpportunityType
    ): boolean {
        const typeConfig = type === 'cross-exchange'
            ? this.config.crossExchange
            : this.config.triangular;

        return opportunity.profitPercent >= typeConfig.minProfitPercent;
    }

    private async checkBalances(
        opportunity: ArbitrageOpportunity | TriangularOpportunity,
        type: OpportunityType
    ): Promise<boolean> {
        if (type === 'cross-exchange') {
            return this.checkCrossExchangeBalances(opportunity as ArbitrageOpportunity);
        } else {
            return this.checkTriangularBalances(opportunity as TriangularOpportunity);
        }
    }

    private checkCrossExchangeBalances(opp: ArbitrageOpportunity): boolean {
        const [baseCurrency, quoteCurrency] = opp.symbol.split('/');

        // Для покупки потрібна quote currency (наприклад USDT)
        const buyAmount = opp.recommendedTradeSize || this.config.crossExchange.maxPositionSize;
        const hasBuyBalance = this.balanceManager.hasAvailableBalance(
            opp.buyExchange,
            quoteCurrency,
            buyAmount
        );

        if (!hasBuyBalance) {
            logger.warn(`Insufficient ${quoteCurrency} on ${opp.buyExchange}`);
            return false;
        }

        // Для продажу потрібна base currency (наприклад BTC)
        const sellAmount = buyAmount / opp.buyPrice;
        const hasSellBalance = this.balanceManager.hasAvailableBalance(
            opp.sellExchange,
            baseCurrency,
            sellAmount
        );

        if (!hasSellBalance) {
            logger.warn(`Insufficient ${baseCurrency} on ${opp.sellExchange}`);
            return false;
        }

        return true;
    }

    private checkTriangularBalances(opp: TriangularOpportunity): boolean {
        // Для triangular потрібен тільки стартовий баланс в USDT
        const startAmount = opp.startAmount || this.config.triangular.maxPositionSize;

        return this.balanceManager.hasAvailableBalance(
            opp.exchange,
            'USDT',
            startAmount
        );
    }

    private checkPositionSize(
        opportunity: ArbitrageOpportunity | TriangularOpportunity,
        type: OpportunityType
    ): boolean {
        const typeConfig = type === 'cross-exchange'
            ? this.config.crossExchange
            : this.config.triangular;

        if (type === 'cross-exchange') {
            const opp = opportunity as ArbitrageOpportunity;
            const positionSize = opp.recommendedTradeSize || 0;
            return positionSize <= typeConfig.maxPositionSize;
        } else {
            const opp = opportunity as TriangularOpportunity;
            const positionSize = opp.startAmount || 0;
            return positionSize <= typeConfig.maxPositionSize;
        }
    }

    private checkConcurrentTrades(type: OpportunityType): boolean {
        const typeConfig = type === 'cross-exchange'
            ? this.config.crossExchange
            : this.config.triangular;

        const activeTrades = this.activeTrades.get(type) || 0;
        return activeTrades < typeConfig.maxConcurrentTrades;
    }

    private checkDailyLimits(): boolean {
        if (this.dailyTrades >= this.config.riskManagement.maxDailyTrades) {
            logger.warn(`Daily trade limit reached: ${this.dailyTrades}/${this.config.riskManagement.maxDailyTrades}`);
            return false;
        }

        if (this.dailyLoss >= this.config.riskManagement.maxDailyLoss) {
            logger.warn(`Daily loss limit reached: ${this.dailyLoss}/${this.config.riskManagement.maxDailyLoss}`);
            this.triggerEmergencyStop();
            return false;
        }

        return true;
    }

    public incrementActiveTrades(type: OpportunityType): void {
        const current = this.activeTrades.get(type) || 0;
        this.activeTrades.set(type, current + 1);

        this.emit('activeTradesChanged', {
            type,
            count: current + 1
        });
    }

    public decrementActiveTrades(type: OpportunityType): void {
        const current = this.activeTrades.get(type) || 0;
        this.activeTrades.set(type, Math.max(0, current - 1));

        this.emit('activeTradesChanged', {
            type,
            count: Math.max(0, current - 1)
        });
    }

    public recordTrade(profitLoss: number): void {
        this.dailyTrades++;

        if (profitLoss < 0) {
            this.dailyLoss += Math.abs(profitLoss);
        }

        this.emit('tradeRecorded', {
            dailyTrades: this.dailyTrades,
            dailyLoss: this.dailyLoss,
            profitLoss
        });

        logger.info({
            msg: '📊 Trade recorded',
            dailyTrades: this.dailyTrades,
            dailyLoss: this.dailyLoss.toFixed(2),
            profitLoss: profitLoss.toFixed(2)
        });
    }

    public triggerEmergencyStop(): void {
        this.config.riskManagement.emergencyStop = true;

        this.emit('emergencyStop', {
            reason: 'Daily loss limit exceeded',
            dailyLoss: this.dailyLoss
        });

        logger.error({
            msg: '🚨 EMERGENCY STOP TRIGGERED',
            dailyLoss: this.dailyLoss,
            maxDailyLoss: this.config.riskManagement.maxDailyLoss
        });
    }

    public disableEmergencyStop(): void {
        this.config.riskManagement.emergencyStop = false;
        logger.info('✅ Emergency stop disabled');
    }

    public addToBlacklist(symbol?: string, exchange?: string): void {
        if (symbol && !this.config.riskManagement.blacklistedSymbols.includes(symbol)) {
            this.config.riskManagement.blacklistedSymbols.push(symbol);
            logger.warn(`⚫ Added ${symbol} to blacklist`);
        }

        if (exchange && !this.config.riskManagement.blacklistedExchanges.includes(exchange)) {
            this.config.riskManagement.blacklistedExchanges.push(exchange);
            logger.warn(`⚫ Added ${exchange} to blacklist`);
        }

        this.emit('blacklistUpdated', {
            symbols: this.config.riskManagement.blacklistedSymbols,
            exchanges: this.config.riskManagement.blacklistedExchanges
        });
    }

    public removeFromBlacklist(symbol?: string, exchange?: string): void {
        if (symbol) {
            this.config.riskManagement.blacklistedSymbols =
                this.config.riskManagement.blacklistedSymbols.filter(s => s !== symbol);
            logger.info(`✅ Removed ${symbol} from blacklist`);
        }

        if (exchange) {
            this.config.riskManagement.blacklistedExchanges =
                this.config.riskManagement.blacklistedExchanges.filter(e => e !== exchange);
            logger.info(`✅ Removed ${exchange} from blacklist`);
        }

        this.emit('blacklistUpdated', {
            symbols: this.config.riskManagement.blacklistedSymbols,
            exchanges: this.config.riskManagement.blacklistedExchanges
        });
    }

    private resetDailyCountersIfNeeded(): void {
        const today = new Date().toISOString().split('T')[0];

        if (this.lastResetDate !== today) {
            this.resetDailyCounters();
            this.lastResetDate = today;
            logger.info('🔄 Daily counters reset');
        }
    }

    private resetDailyCounters(): void {
        this.dailyTrades = 0;
        this.dailyLoss = 0;
        this.lastResetDate = new Date().toISOString().split('T')[0];
    }

    public getStats() {
        return {
            dailyTrades: this.dailyTrades,
            dailyLoss: this.dailyLoss,
            activeTrades: {
                crossExchange: this.activeTrades.get('cross-exchange') || 0,
                triangular: this.activeTrades.get('triangular') || 0
            },
            emergencyStop: this.config.riskManagement.emergencyStop,
            blacklists: {
                symbols: this.config.riskManagement.blacklistedSymbols,
                exchanges: this.config.riskManagement.blacklistedExchanges
            }
        };
    }

    public cleanup(): void {
        this.removeAllListeners();
        logger.info('✅ RiskManager cleaned up');
    }
}
