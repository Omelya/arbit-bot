import { EventEmitter } from 'events';
import { createChildLogger } from '../../utils/logger';
import { Position } from '../../types/trading';
import * as crypto from 'node:crypto';

const logger = createChildLogger(__filename);

export class PositionManager extends EventEmitter {
    private positions: Map<string, Position> = new Map();
    private positionHistory: Position[] = [];

    constructor() {
        super();
    }

    public openPosition(
        exchange: string,
        symbol: string,
        side: 'long' | 'short',
        amount: number,
        entryPrice: number
    ): Position {
        const position: Position = {
            id: crypto.randomUUID(),
            exchange,
            symbol,
            side,
            amount,
            entryPrice,
            openTime: Date.now(),
            status: 'open'
        };

        this.positions.set(position.id, position);

        logger.info({
            msg: '📈 Position opened',
            id: position.id,
            exchange,
            symbol,
            side,
            amount,
            entryPrice
        });

        this.emit('positionOpened', position);

        return position;
    }

    public closePosition(
        positionId: string,
        exitPrice: number
    ): Position | null {
        const position = this.positions.get(positionId);

        if (!position) {
            logger.warn(`Position ${positionId} not found`);
            return null;
        }

        position.status = 'closed';
        position.closeTime = Date.now();
        position.currentPrice = exitPrice;

        // Calculate P&L
        const priceDiff = position.side === 'long'
            ? exitPrice - position.entryPrice
            : position.entryPrice - exitPrice;

        position.unrealizedPnL = priceDiff * position.amount;

        this.positions.delete(positionId);
        this.positionHistory.push(position);

        logger.info({
            msg: '📉 Position closed',
            id: position.id,
            pnl: position.unrealizedPnL?.toFixed(2),
            holdTime: position.closeTime - position.openTime
        });

        this.emit('positionClosed', position);

        return position;
    }

    public updatePosition(
        positionId: string,
        currentPrice: number
    ): Position | null {
        const position = this.positions.get(positionId);

        if (!position) {
            return null;
        }

        position.currentPrice = currentPrice;

        // Calculate unrealized P&L
        const priceDiff = position.side === 'long'
            ? currentPrice - position.entryPrice
            : position.entryPrice - currentPrice;

        position.unrealizedPnL = priceDiff * position.amount;

        this.emit('positionUpdated', position);

        return position;
    }

    public getPosition(positionId: string): Position | null {
        return this.positions.get(positionId) || null;
    }

    public getOpenPositions(): Position[] {
        return Array.from(this.positions.values());
    }

    public getPositionsByExchange(exchange: string): Position[] {
        return Array.from(this.positions.values()).filter(
            p => p.exchange === exchange
        );
    }

    public getPositionsBySymbol(symbol: string): Position[] {
        return Array.from(this.positions.values()).filter(
            p => p.symbol === symbol
        );
    }

    public getPositionHistory(): Position[] {
        return [...this.positionHistory];
    }

    public getTotalUnrealizedPnL(): number {
        return Array.from(this.positions.values()).reduce(
            (sum, pos) => sum + (pos.unrealizedPnL || 0),
            0
        );
    }

    public getTotalRealizedPnL(): number {
        return this.positionHistory.reduce(
            (sum, pos) => sum + (pos.unrealizedPnL || 0),
            0
        );
    }

    public getStats() {
        const openPositions = Array.from(this.positions.values());
        const closedPositions = this.positionHistory;

        const profitable = closedPositions.filter(p => (p.unrealizedPnL || 0) > 0);
        const unprofitable = closedPositions.filter(p => (p.unrealizedPnL || 0) <= 0);

        return {
            open: {
                count: openPositions.length,
                totalUnrealizedPnL: this.getTotalUnrealizedPnL(),
                byExchange: this.groupByExchange(openPositions),
                bySymbol: this.groupBySymbol(openPositions)
            },
            closed: {
                count: closedPositions.length,
                totalRealizedPnL: this.getTotalRealizedPnL(),
                profitable: profitable.length,
                unprofitable: unprofitable.length,
                winRate: closedPositions.length > 0
                    ? (profitable.length / closedPositions.length) * 100
                    : 0
            }
        };
    }

    private groupByExchange(positions: Position[]): Record<string, number> {
        return positions.reduce((acc, pos) => {
            acc[pos.exchange] = (acc[pos.exchange] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
    }

    private groupBySymbol(positions: Position[]): Record<string, number> {
        return positions.reduce((acc, pos) => {
            acc[pos.symbol] = (acc[pos.symbol] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
    }

    public cleanup(): void {
        // Force close all open positions (for cleanup only)
        const openPositions = Array.from(this.positions.values());

        openPositions.forEach(pos => {
            if (pos.currentPrice) {
                this.closePosition(pos.id, pos.currentPrice);
            }
        });

        this.positions.clear();
        this.removeAllListeners();

        logger.info('✅ PositionManager cleaned up');
    }
}
