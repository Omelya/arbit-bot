import { config } from 'dotenv';
import { ExchangeConfig as ExchangeConfigType } from '../types';

config();

const generateExchangeConfig = (supportedExchanges: Map<string, { apiKey?: string, secret?: string, passphrase?: string }>): ExchangeConfigType[] => {
    const sandbox = process.env.TEST_MODE === 'true';
    const enabledCrossExchanges = process.env.CROSS_ENABLED_EXCHANGES ?? 'binance';
    const enabledTriangularExchanges = process.env.TRIANGULAR_ENABLED_EXCHANGES ?? 'bybit';

    const crossSetExchange = new Set(enabledCrossExchanges.split(','));
    const triangularSetExchange = new Set(enabledTriangularExchanges.split(','));

    let enabledExchanges: ExchangeConfigType[] = [];

    supportedExchanges.forEach((value, item) => {
        if (crossSetExchange.has(item) || triangularSetExchange.has(item)) {
            enabledExchanges.push({
                name: item,
                apiKey: value.apiKey,
                secret: value.secret,
                passphrase: value.passphrase ?? undefined,
                sandbox,
                triangular: triangularSetExchange.has(item),
                cross: crossSetExchange.has(item),
            });
        }
    });

    return enabledExchanges;
};

const SupportedExchanges = new Map([
    ['binance', { apiKey: process.env.BINANCE_API_KEY, secret: process.env.BINANCE_SECRET }],
    ['coinbase', { apiKey: process.env.COINBASE_API_KEY, secret: process.env.COINBASE_SECRET, passphrase: process.env.COINBASE_PASSPHRASE }],
    ['kraken', { apiKey: process.env.KRAKEN_API_KEY, secret: process.env.KRAKEN_SECRET }],
    ['okx', { apiKey: process.env.OKX_API_KEY, secret: process.env.OKX_SECRET, passphrase: process.env.OKX_PASSPHRASE }],
    ['bybit', { apiKey: process.env.BYBIT_API_KEY, secret: process.env.BYBIT_SECRET }],
]);

export const ExchangeConfig = {
    testMode: process.env.TEST_MODE === 'true',
    supportedExchange: SupportedExchanges,
    exchanges: generateExchangeConfig(SupportedExchanges),
};
