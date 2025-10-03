import WebSocket, { WebSocketServer } from 'ws';
import { WSMessage, ArbitrageOpportunity } from '../types';
import { EventEmitter } from 'events';
import {createChildLogger} from "../utils/logger";

const logger = createChildLogger(__filename);

export class WebSocketService extends EventEmitter {
    private wss: WebSocketServer;
    private clients: Set<WebSocket> = new Set();
    private readonly port: number;

    constructor(port: number = 8080) {
        super();
        this.port = port;
        this.wss = new WebSocketServer({ port });
        this.setupServer();
    }

    private setupServer(): void {
        this.wss.on('connection', (ws: WebSocket, request) => {
            logger.info(`🔌 Client connected from ${request.socket.remoteAddress}`);
            this.clients.add(ws);

            this.sendToClient(ws, {
                type: 'connection',
                data: { message: 'Connected to ArbitBot WebSocket' },
                timestamp: Date.now()
            });

            ws.on('message', (message: Buffer) => {
                try {
                    const data = JSON.parse(message.toString()) as WSMessage;
                    this.handleMessage(ws, data);
                } catch (error) {
                    logger.error({
                        msg: '❌ Invalid message format:',
                        error,
                    });

                    this.sendError(ws, 'Invalid message format');
                }
            });

            ws.on('close', (code: number, reason: Buffer) => {
                this.clients.delete(ws);
                logger.warn(`❌ Client disconnected: ${code} ${reason.toString()}`);
            });

            ws.on('error', (error: Error) => {
                logger.error({
                    msg: 'WebSocket error:',
                    error,
                });

                this.clients.delete(ws);
            });

            this.sendLatestData(ws);
        });

        logger.info(`🚀 WebSocket server running on port ${this.port}`);
    }

    private handleMessage(ws: WebSocket, message: WSMessage): void {
        switch (message.type) {
            case 'subscribe':
                this.handleSubscription(ws, message.data);
                break;
            case 'unsubscribe':
                this.handleUnsubscription(ws, message.data);
                break;
            case 'ping':
                this.sendToClient(ws, {
                    type: 'pong',
                    data: { timestamp: Date.now() },
                    timestamp: Date.now()
                });
                break;
            default:
                this.sendError(ws, `Unknown message type: ${message.type}`);
        }
    }

    private handleSubscription(ws: WebSocket, data: any): void {
        const { symbols, exchanges } = data;

        this.sendToClient(ws, {
            type: 'subscribed',
            data: { symbols, exchanges },
            timestamp: Date.now()
        });
    }

    private handleUnsubscription(ws: WebSocket, data: any): void {
        this.sendToClient(ws, {
            type: 'unsubscribed',
            data,
            timestamp: Date.now()
        });
    }

    private sendToClient(ws: WebSocket, message: WSMessage): void {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }

    private sendError(ws: WebSocket, error: string): void {
        this.sendToClient(ws, {
            type: 'error',
            data: { error },
            timestamp: Date.now()
        });
    }

    private async sendLatestData(ws: WebSocket): Promise<void> {
        try {
            // Тут можна підключити Redis або інший кеш
            // const latest = await this.redis.get('latest_opportunities');

            // Поки що відправляємо тестові дані
            this.sendToClient(ws, {
                type: 'initial_data',
                data: {
                    opportunities: [],
                    message: 'Initial data loaded'
                },
                timestamp: Date.now()
            });
        } catch (error) {
            logger.error({
                msg: 'Error sending latest data:',
                error,
            });
        }
    }

    public broadcast(type: string, data: any): void {
        const message: WSMessage = {
            type: type as any,
            data,
            timestamp: Date.now()
        };

        const messageString = JSON.stringify(message);
        let sentCount = 0;

        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageString);
                sentCount++;
            } else {
                this.clients.delete(client);
            }
        });

        if (sentCount > 0) {
            logger.info(`📡 Broadcast ${type} to ${sentCount} clients`);
        }
    }

    public broadcastOpportunity(opportunity: ArbitrageOpportunity): void {
        this.broadcast('arbitrage_opportunity', opportunity);
    }

    public broadcastPriceUpdate(priceData: any): void {
        this.broadcast('price_update', priceData);
    }

    public getClientCount(): number {
        return this.clients.size;
    }

    public close(): void {
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.close(1000, 'Server shutting down');
            }
        });
        this.wss.close();
    }
}
