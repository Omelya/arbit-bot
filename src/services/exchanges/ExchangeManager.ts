import ccxt, {Exchange} from "ccxt";
import {ExchangeConfig, OrderBook} from "../../types";
import {BinanceService} from "./BinanceService";
import {AbstractExchangeService} from "./AbstractExchangeService";
import {KrakenService} from "./KrakenService";
import {CoinbaseService} from "./CoinbaseService";
import {OkxService} from "./OkxService";
import {BybitService} from "./BybitService";

export class ExchangeManager {
    private ccxtExchanges: Map<string, Exchange> = new Map();
    private exchangeServices: Map<string, AbstractExchangeService> = new Map();

    constructor(private configs: ExchangeConfig[]) {
        this.initializeExchanges();
        this.initializeServices();
    }

    public createWebSockets(symbols: string[]): void {
        this.exchangeServices.forEach(async (service, name) => {
            try {
                await service.connectWebSockets(symbols);
            } catch (error) {
                console.error(`Failed to connect WebSocket for ${name}:`, error);
            }
        });
    }

    public async fetchOrderBook(exchangeName: string, symbol: string): Promise<OrderBook | null> {
        const exchange = this.ccxtExchanges.get(exchangeName);

        if (!exchange) {
            console.warn(`Exchange ${exchangeName} not found`);
            return null;
        }

        try {
            const orderbook = await exchange.fetchOrderBook(symbol);
            return {
                symbol,
                bids: orderbook.bids as [number, number][],
                asks: orderbook.asks as [number, number][],
                timestamp: orderbook.timestamp || Date.now(),
                datetime: orderbook.datetime || new Date().toISOString()
            };
        } catch (error) {
            console.error(`Error fetching orderbook for ${symbol} on ${exchangeName}:`, error);
            return null;
        }
    }

    public getAllExchangeServices(): Map<string, AbstractExchangeService> {
        return new Map(this.exchangeServices);
    }

    public async cleanup(): Promise<void> {
        const cleanupPromises = Array.from(this.exchangeServices.values()).map(
            service => service.disconnect()
        );

        try {
            await Promise.all(cleanupPromises);
            console.log('✅ All exchange services cleaned up');
        } catch (error) {
            console.error('❌ Error during cleanup:', error);
        }
    }

    private initializeExchanges(): void {
        this.configs.forEach(config => {
            try {
                const ExchangeClass = ccxt[config.name as keyof typeof ccxt] as any;
                if (!ExchangeClass) {
                    console.warn(`❌ Exchange ${config.name} not supported by ccxt`);
                    return;
                }

                const exchange = new ExchangeClass({
                    apiKey: config.apiKey,
                    secret: config.secret,
                    password: config.passphrase,
                    sandbox: config.sandbox || false,
                    rateLimit: config.rateLimit || 1000,
                    enableRateLimit: true,
                    timeout: 30000,
                });

                this.ccxtExchanges.set(config.name, exchange);
                console.log(`✅ Initialized ccxt ${config.name} exchange`);
            } catch (error) {
                console.error(`❌ Failed to initialize ccxt ${config.name}:`, error);
            }
        });
    }

    private initializeServices(): void {
        const serviceMap: Record<string, new () => AbstractExchangeService> = {
            binance: BinanceService,
            kraken: KrakenService,
            coinbase: CoinbaseService,
            okx: OkxService,
            bybit: BybitService,
        };

        this.configs.forEach(config => {
            const ServiceClass = serviceMap[config.name];
            if (!ServiceClass) {
                console.warn(`❌ Service for ${config.name} not implemented`);
                return;
            }

            try {
                const service = new ServiceClass();
                this.exchangeServices.set(config.name, service);
                console.log(`✅ Initialized ${config.name} service`);
            } catch (error) {
                console.error(`❌ Failed to initialize ${config.name} service:`, error);
            }
        });
    }
}
