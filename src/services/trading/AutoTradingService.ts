import { EventEmitter } from 'events';
import { Exchange } from 'ccxt';
import { createChildLogger } from '../../utils/logger';
import { ArbitrageOpportunity } from '../../types';
import { TriangularOpportunity } from '../../types/triangular';
import { TradingConfig, TradeAttempt } from '../../types/trading';
import { BalanceManager } from './BalanceManager';
import { TradeExecutionService } from './TradeExecutionService';
import { RiskManager } from '../RiskManager';
import { TradeDecisionEngine } from './TradeDecisionEngine';
import { CrossExchangeStrategy } from './strategies/CrossExchangeStrategy';
import { TriangularStrategy } from './strategies/TriangularStrategy';
import { TransactionLogger } from '../TransactionLogger';

const logger = createChildLogger(__filename);

export class AutoTradingService extends EventEmitter {
    private readonly balanceManager: BalanceManager;
    private readonly executionService: TradeExecutionService;
    private readonly riskManager: RiskManager;
    private decisionEngine: TradeDecisionEngine;
    private crossStrategy: CrossExchangeStrategy;
    private triangularStrategy: TriangularStrategy;
    private transactionLogger: TransactionLogger;

    private isRunning: boolean = false;
    private processingQueue: Set<string> = new Set();

    constructor(
        private exchanges: Map<string, Exchange>,
        private config: TradingConfig
    ) {
        super();

        this.balanceManager = new BalanceManager(this.exchanges);
        this.executionService = new TradeExecutionService(this.exchanges);
        this.riskManager = new RiskManager(config, this.balanceManager);
        this.decisionEngine = new TradeDecisionEngine(config, this.riskManager);
        this.crossStrategy = new CrossExchangeStrategy(
            this.executionService,
            this.balanceManager,
            this.riskManager
        );
        this.triangularStrategy = new TriangularStrategy(
            this.executionService,
            this.balanceManager,
            this.riskManager
        );
        this.transactionLogger = new TransactionLogger();

        this.setupEventListeners();
    }

    public async initialize(): Promise<void> {
        logger.info('🚀 Initializing AutoTradingService...');

        await this.balanceManager.initialize();

        logger.info('✅ AutoTradingService initialized');
        logger.info({
            msg: '⚙️ Trading Configuration',
            enabled: this.config.enabled,
            crossExchange: this.config.crossExchange.enabled,
            triangular: this.config.triangular.enabled
        });

        this.isRunning = true;
        this.emit('initialized');
    }

    public async handleCrossExchangeOpportunity(
        opportunity: ArbitrageOpportunity
    ): Promise<void> {
        if (!this.isRunning || !this.config.enabled || !this.config.crossExchange.enabled) {
            return;
        }

        // Prevent duplicate processing
        if (this.processingQueue.has(opportunity.id)) {
            return;
        }

        this.processingQueue.add(opportunity.id);

        try {
            // Evaluate opportunity
            const decision = await this.decisionEngine.evaluateOpportunity(
                opportunity,
                'cross-exchange'
            );

            if (!decision.approved) {
                logger.debug({
                    msg: '⚠️ Cross-exchange opportunity rejected',
                    id: opportunity.id,
                    reason: decision.reason
                });
                return;
            }

            // Execute trade
            logger.info({
                msg: '🎯 Executing cross-exchange trade',
                id: opportunity.id,
                profit: opportunity.profitPercent,
                priority: decision.priority
            });

            const tradeAttempt = await this.crossStrategy.execute(opportunity);

            // Log transaction
            this.transactionLogger.logTrade(tradeAttempt);

            // Update cooldown
            this.decisionEngine.updateCooldown(opportunity, 'cross-exchange');

            // Emit event
            this.emit('tradeCompleted', tradeAttempt);

        } catch (error: any) {
            logger.error({
                msg: '❌ Error handling cross-exchange opportunity',
                id: opportunity.id,
                error: error.message
            });

            this.emit('tradeError', {
                opportunityId: opportunity.id,
                type: 'cross-exchange',
                error: error.message
            });

        } finally {
            this.processingQueue.delete(opportunity.id);
        }
    }

    public async handleTriangularOpportunity(
        opportunity: TriangularOpportunity
    ): Promise<void> {
        if (!this.isRunning || !this.config.enabled || !this.config.triangular.enabled) {
            return;
        }

        // Prevent duplicate processing
        if (this.processingQueue.has(opportunity.id)) {
            return;
        }

        this.processingQueue.add(opportunity.id);

        try {
            // Evaluate opportunity
            const decision = await this.decisionEngine.evaluateOpportunity(
                opportunity,
                'triangular'
            );

            if (!decision.approved) {
                logger.debug({
                    msg: '⚠️ Triangular opportunity rejected',
                    id: opportunity.id,
                    reason: decision.reason
                });
                return;
            }

            // Execute trade
            logger.info({
                msg: '🔺 Executing triangular trade',
                id: opportunity.id,
                profit: opportunity.profitPercent,
                priority: decision.priority
            });

            const tradeAttempt = await this.triangularStrategy.execute(opportunity);

            // Log transaction
            this.transactionLogger.logTrade(tradeAttempt);

            // Update cooldown
            this.decisionEngine.updateCooldown(opportunity, 'triangular');

            // Emit event
            this.emit('tradeCompleted', tradeAttempt);

        } catch (error: any) {
            logger.error({
                msg: '❌ Error handling triangular opportunity',
                id: opportunity.id,
                error: error.message
            });

            this.emit('tradeError', {
                opportunityId: opportunity.id,
                type: 'triangular',
                error: error.message
            });

        } finally {
            this.processingQueue.delete(opportunity.id);
        }
    }

    private setupEventListeners(): void {
        // Balance events
        this.balanceManager.on('balanceUpdated', (exchange, balances) => {
            this.emit('balanceUpdated', { exchange, balances });
        });

        // Risk manager events
        this.riskManager.on('emergencyStop', (data) => {
            logger.error('🚨 EMERGENCY STOP TRIGGERED');
            this.emit('emergencyStop', data);
        });

        // Strategy events
        this.crossStrategy.on('tradeCompleted', (trade: TradeAttempt) => {
            logger.info({
                msg: '✅ Cross-exchange trade completed',
                tradeId: trade.id,
                profit: trade.profit?.netProfit
            });
        });

        this.triangularStrategy.on('tradeCompleted', (trade: TradeAttempt) => {
            logger.info({
                msg: '✅ Triangular trade completed',
                tradeId: trade.id,
                profit: trade.profit?.netProfit
            });
        });
    }

    public getStats() {
        return {
            isRunning: this.isRunning,
            config: {
                enabled: this.config.enabled,
                crossExchange: this.config.crossExchange.enabled,
                triangular: this.config.triangular.enabled
            },
            risk: this.riskManager.getStats(),
            balances: this.balanceManager.getAllBalances(),
            transactions: this.transactionLogger.getStats(),
            processingQueue: this.processingQueue.size,
        };
    }

    public enableTrading(): void {
        this.config.enabled = true;
        logger.info('✅ Trading enabled');
        this.emit('tradingEnabled');
    }

    public disableTrading(): void {
        this.config.enabled = false;
        logger.warn('⚠️ Trading disabled');
        this.emit('tradingDisabled');
    }

    public enableCrossExchange(): void {
        this.config.crossExchange.enabled = true;
        logger.info('✅ Cross-exchange trading enabled');
    }

    public disableCrossExchange(): void {
        this.config.crossExchange.enabled = false;
        logger.warn('⚠️ Cross-exchange trading disabled');
    }

    public enableTriangular(): void {
        this.config.triangular.enabled = true;
        logger.info('✅ Triangular trading enabled');
    }

    public disableTriangular(): void {
        this.config.triangular.enabled = false;
        logger.warn('⚠️ Triangular trading disabled');
    }

    public async cleanup(): Promise<void> {
        logger.info('🧹 Cleaning up AutoTradingService...');

        this.isRunning = false;

        await this.balanceManager.cleanup();
        await this.executionService.cleanup();
        this.riskManager.cleanup();
        this.decisionEngine.cleanup();
        this.crossStrategy.cleanup();
        this.triangularStrategy.cleanup();
        await this.transactionLogger.cleanup();

        this.removeAllListeners();

        logger.info('✅ AutoTradingService cleaned up');
    }
}
