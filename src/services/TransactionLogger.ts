import { EventEmitter } from 'events';
import { createChildLogger } from '../utils/logger';
import { TradeAttempt, TradeStatus } from '../types/trading';
import * as fs from 'fs/promises';
import * as path from 'path';

const logger = createChildLogger(__filename);

export class TransactionLogger extends EventEmitter {
    private trades: Map<string, TradeAttempt> = new Map();
    private readonly logsDir: string;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(logsDir: string = './logs/trades') {
        super();
        this.logsDir = logsDir;
        this.ensureLogsDirectory();
    }

    private async ensureLogsDirectory(): Promise<void> {
        try {
            await fs.mkdir(this.logsDir, { recursive: true });
        } catch (error) {
            logger.error({
                msg: 'Failed to create logs directory',
                error
            });
        }
    }

    public logTrade(trade: TradeAttempt): void {
        this.trades.set(trade.id, trade);

        // Async write to file (non-blocking)
        this.writeQueue = this.writeQueue.then(() => this.writeTradeToFile(trade));

        logger.info({
            msg: '📝 Trade logged',
            tradeId: trade.id,
            status: trade.status,
            type: trade.opportunityType
        });

        this.emit('tradeLogged', trade);
    }

    private async writeTradeToFile(trade: TradeAttempt): Promise<void> {
        try {
            const date = new Date().toISOString().split('T')[0];
            const filename = path.join(this.logsDir, `trades-${date}.jsonl`);

            const logEntry = JSON.stringify({
                ...trade,
                loggedAt: new Date().toISOString()
            }) + '\n';

            await fs.appendFile(filename, logEntry, 'utf-8');
        } catch (error) {
            logger.error({
                msg: 'Failed to write trade to file',
                tradeId: trade.id,
                error
            });
        }
    }

    public getTrade(tradeId: string): TradeAttempt | undefined {
        return this.trades.get(tradeId);
    }

    public getAllTrades(): TradeAttempt[] {
        return Array.from(this.trades.values());
    }

    public getTradesByStatus(status: TradeStatus): TradeAttempt[] {
        return Array.from(this.trades.values()).filter(t => t.status === status);
    }

    public getTradesByType(type: 'cross-exchange' | 'triangular'): TradeAttempt[] {
        return Array.from(this.trades.values()).filter(t => t.opportunityType === type);
    }

    public async generateDailySummary(): Promise<string> {
        const today = new Date().toISOString().split('T')[0];
        const todayTrades = Array.from(this.trades.values()).filter(trade => {
            const tradeDate = new Date(trade.startTime).toISOString().split('T')[0];
            return tradeDate === today;
        });

        const completed = todayTrades.filter(t => t.status === TradeStatus.COMPLETED);
        const failed = todayTrades.filter(t => t.status === TradeStatus.FAILED);
        const rejected = todayTrades.filter(t => t.status === TradeStatus.REJECTED);

        const totalProfit = completed.reduce((sum, t) => sum + (t.profit?.netProfit || 0), 0);
        const totalFees = completed.reduce((sum, t) => sum + (t.profit?.fees.total || 0), 0);

        const avgExecutionTime = completed.length > 0
            ? completed.reduce((sum, t) => sum + (t.executionTimeMs || 0), 0) / completed.length
            : 0;

        const summary = `
Daily Trading Summary - ${today}
${'='.repeat(50)}

Total Trades: ${todayTrades.length}
  ✅ Completed: ${completed.length}
  ❌ Failed: ${failed.length}
  ⚠️  Rejected: ${rejected.length}

Financial Summary:
  Total Profit: $${totalProfit.toFixed(2)}
  Total Fees: $${totalFees.toFixed(2)}
  Net Profit: $${(totalProfit - totalFees).toFixed(2)}

Performance:
  Average Execution Time: ${avgExecutionTime.toFixed(0)}ms
  Success Rate: ${todayTrades.length > 0 ? ((completed.length / todayTrades.length) * 100).toFixed(2) : 0}%

By Type:
  Cross-Exchange: ${todayTrades.filter(t => t.opportunityType === 'cross-exchange').length}
  Triangular: ${todayTrades.filter(t => t.opportunityType === 'triangular').length}
${'='.repeat(50)}
        `;

        // Write summary to file
        const summaryFile = path.join(this.logsDir, `summary-${today}.txt`);
        await fs.writeFile(summaryFile, summary, 'utf-8');

        logger.info({
            msg: '📊 Daily summary generated',
            date: today,
            totalTrades: todayTrades.length,
            profit: totalProfit.toFixed(2)
        });

        return summary;
    }

    public getStats() {
        const all = Array.from(this.trades.values());
        const completed = all.filter(t => t.status === TradeStatus.COMPLETED);

        return {
            total: all.length,
            completed: completed.length,
            failed: all.filter(t => t.status === TradeStatus.FAILED).length,
            rejected: all.filter(t => t.status === TradeStatus.REJECTED).length,
            totalProfit: completed.reduce((sum, t) => sum + (t.profit?.netProfit || 0), 0),
            totalFees: completed.reduce((sum, t) => sum + (t.profit?.fees.total || 0), 0),
            avgExecutionTime: completed.length > 0
                ? completed.reduce((sum, t) => sum + (t.executionTimeMs || 0), 0) / completed.length
                : 0,
            byType: {
                crossExchange: all.filter(t => t.opportunityType === 'cross-exchange').length,
                triangular: all.filter(t => t.opportunityType === 'triangular').length
            }
        };
    }

    public async cleanup(): Promise<void> {
        // Wait for all writes to complete
        await this.writeQueue;

        // Generate final summary
        await this.generateDailySummary();

        this.trades.clear();
        this.removeAllListeners();

        logger.info('✅ TransactionLogger cleaned up');
    }
}
