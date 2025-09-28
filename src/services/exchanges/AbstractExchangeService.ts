import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { ExchangePrice } from '../../types';

export abstract class AbstractExchangeService extends EventEmitter {
    protected abstract wsUrl: string;
    protected abstract name: string;
    protected ws: WebSocket | null = null;
    protected isConnected: boolean = false;
    protected reconnectAttempts: number = 0;
    protected maxReconnectAttempts: number = 5;
    protected reconnectDelay: number = 5000;

    protected abstract subscribeToSymbols(ws: WebSocket, symbols: string[]): void;

    protected abstract handlePriceUpdate(data: any): void;

    public async connectWebSockets(symbols: string[]): Promise<void> {
        if (this.isConnected) {
            console.log(`WebSocket for ${this.name} already connected`);
            return;
        }

        try {
            await this.createWSConnection(symbols);
        } catch (error) {
            console.error(`Failed to connect WebSocket for ${this.name}:`, error);
            throw error;
        }
    }

    public async disconnect(): Promise<void> {
        this.isConnected = false;
        this.reconnectAttempts = 0;

        if (this.ws) {
            this.ws.removeAllListeners();

            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }

            this.ws = null;
        }

        console.log(`🔌 Disconnected from ${this.name} WebSocket`);
    }

    public getConnectionStatus(): boolean {
        return this.isConnected;
    }

    private async createWSConnection(symbols: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.wsUrl);

                const connectionTimeout = setTimeout(() => {
                    if (this.ws) this.ws.terminate();

                    reject(new Error(`Connection timeout for ${this.name}`));
                }, 10000);

                this.ws.on('open', () => {
                    clearTimeout(connectionTimeout);
                    console.log(`🔌 Connected to ${this.name} WebSocket`);
                    this.isConnected = true;
                    this.reconnectAttempts = 0;

                    try {
                        this.subscribeToSymbols(this.ws!, symbols);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });

                this.ws.on('message', (data: Buffer) => {
                    try {
                        const parsed = JSON.parse(data.toString());
                        this.handlePriceUpdate(parsed);
                    } catch (error) {
                        console.error(`Error parsing message from ${this.name}:`, error);
                    }
                });

                this.ws.on('close', (code, reason) => {
                    clearTimeout(connectionTimeout);
                    this.isConnected = false;
                    console.log(`❌ Disconnected from ${this.name} WebSocket (Code: ${code}, Reason: ${reason?.toString()})`);

                    if (this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.scheduleReconnect(symbols);
                    } else {
                        console.error(`❌ Max reconnection attempts reached for ${this.name}`);
                        this.emit('maxReconnectAttemptsReached', this.name);
                    }
                });

                this.ws.on('error', (error) => {
                    clearTimeout(connectionTimeout);
                    console.error(`❌ WebSocket error for ${this.name}:`, error);

                    if (!this.isConnected) {
                        reject(error);
                    }
                });

                this.ws.on('ping', (data) => {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.pong(data);
                    }
                });

            } catch (error) {
                reject(error);
            }
        });
    }

    private scheduleReconnect(symbols: string[]): void {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

        console.log(`🔄 Scheduling reconnect for ${this.name} (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);

        setTimeout(async () => {
            try {
                await this.createWSConnection(symbols);
            } catch (error) {
                console.error(`❌ Reconnection failed for ${this.name}:`, error);
            }
        }, delay);
    }

    protected emitPriceUpdate(priceData: ExchangePrice): void {
        this.emit('priceUpdate', priceData);
    }

    protected validatePriceData(data: any): boolean {
        return data &&
            typeof data.price === 'number' &&
            !isNaN(data.price) &&
            data.price > 0 &&
            typeof data.symbol === 'string' &&
            data.symbol.length > 0;
    }
}
