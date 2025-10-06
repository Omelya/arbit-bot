import { ArbitrageOpportunity } from './arbitrage';
import { TriangularOpportunity } from './triangular';

export type OpportunityType = 'cross-exchange' | 'triangular';

export interface TradeAttempt {
    id: string;
    opportunityId: string;
    opportunityType: OpportunityType;
    status: TradeStatus;
    orders: any[];
    preTradeState: TradeState;
    postTradeState?: TradeState;
    profit?: ProfitResult;
    error?: string;
    startTime: number;
    endTime?: number;
    executionTimeMs?: number;
}

export enum TradeStatus {
    VALIDATING = 'validating',
    APPROVED = 'approved',
    REJECTED = 'rejected',
    EXECUTING = 'executing',
    MONITORING = 'monitoring',
    COMPLETED = 'completed',
    FAILED = 'failed',
    PARTIAL = 'partial',
    ROLLED_BACK = 'rolled_back'
}

export interface TradeState {
    timestamp: number;
    balances: {
        exchange: string;
        currency: string;
        amount: number;
    }[];
    prices?: {
        exchange: string;
        symbol: string;
        price: number;
    }[];
}

export interface ProfitResult {
    grossProfit: number;
    netProfit: number;
    profitPercent: number;
    fees: {
        total: number;
        breakdown: {
            exchange: string;
            amount: number;
        }[];
    };
    slippage: {
        total: number;
        expected: number;
        actual: number;
    };
}

export interface RiskCheckResult {
    approved: boolean;
    reasons: string[];
    checks: {
        balanceCheck: boolean;
        positionSizeCheck: boolean;
        dailyLimitCheck: boolean;
        concurrentTradesCheck: boolean;
        blacklistCheck: boolean;
        minProfitCheck: boolean;
    };
}

export interface TradingConfig {
    enabled: boolean;

    crossExchange: {
        enabled: boolean;
        minProfitPercent: number;
        maxPositionSize: number;
        maxConcurrentTrades: number;
    };

    triangular: {
        enabled: boolean;
        minProfitPercent: number;
        maxPositionSize: number;
        maxConcurrentTrades: number;
    };

    riskManagement: {
        maxDailyLoss: number;
        maxDailyTrades: number;
        emergencyStop: boolean;
        blacklistedSymbols: string[];
        blacklistedExchanges: string[];
    };

    execution: {
        orderType: 'market' | 'limit';
        timeoutMs: number;
        retryAttempts: number;
        slippageTolerance: number;
    };
}

export interface TradeDecision {
    approved: boolean;
    opportunity: ArbitrageOpportunity | TriangularOpportunity;
    opportunityType: OpportunityType;
    reason?: string;
    priority: number;
    riskCheck: RiskCheckResult;
}

export interface Position {
    id: string;
    exchange: string;
    symbol: string;
    side: 'long' | 'short';
    amount: number;
    entryPrice: number;
    currentPrice?: number;
    unrealizedPnL?: number;
    openTime: number;
    closeTime?: number;
    status: 'open' | 'closed';
}