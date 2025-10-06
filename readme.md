# ArbitBot - Auto Trading Setup Guide

## 🚀 Швидкий старт

### 1. Встановлення залежностей
```bash
npm install
```

### 2. Налаштування .env файлу
```bash
cp .env.example .env
```

Відредагуйте `.env` файл і додайте ваші API ключі від бірж:

```env
# ВАЖЛИВО: Спочатку тестуйте на sandbox/testnet!
TEST_MODE=true

# API ключі для бірж
BINANCE_API_KEY=your_api_key
BINANCE_SECRET=your_secret

BYBIT_API_KEY=your_api_key
BYBIT_SECRET=your_secret

# ... інші біржі
```

### 3. Початкове тестування (БЕЗ торгівлі)
```bash
# Запустити без автоторгівлі
TRADING_ENABLED=false npm run dev
```

Перевірте що:
- ✅ Всі біржі підключились
- ✅ Ціни оновлюються
- ✅ Order books завантажуються
- ✅ Можливості арбітражу знаходяться

### 4. Тестування на Sandbox/Testnet

**ОБОВ'ЯЗКОВО** спочатку тестувати на testnet:

```env
TEST_MODE=true
TRADING_ENABLED=true
CROSS_TRADING_ENABLED=true

# Встановіть малі значення для тестування
CROSS_MAX_POSITION_SIZE=10
MAX_DAILY_LOSS=5
MAX_DAILY_TRADES=10
```

### 5. Production (реальна торгівля)

⚠️ **ТІЛЬКИ після успішного тестування на testnet!**

```env
TEST_MODE=false
TRADING_ENABLED=true
CROSS_TRADING_ENABLED=true
TRIANGULAR_TRADING_ENABLED=true

# Реальні значення
CROSS_MAX_POSITION_SIZE=100
TRIANGULAR_MAX_POSITION_SIZE=100
MAX_DAILY_LOSS=50
MAX_DAILY_TRADES=100
```

## 📊 Конфігурація торгівлі

### Основні параметри

| Параметр | Опис | Рекомендоване значення |
|----------|------|------------------------|
| `TRADING_ENABLED` | Глобальне вмикання торгівлі | `false` (для початку) |
| `CROSS_TRADING_ENABLED` | Cross-exchange арбітраж | `true` |
| `TRIANGULAR_TRADING_ENABLED` | Triangular арбітраж | `true` |

### Cross-Exchange параметри

| Параметр | Опис | Рекомендоване значення |
|----------|------|------------------------|
| `CROSS_MIN_PROFIT` | Мінімальний прибуток (%) | `0.5` |
| `CROSS_MAX_POSITION_SIZE` | Макс. розмір позиції (USDT) | `100` |
| `CROSS_MAX_CONCURRENT` | Макс. одночасних трейдів | `3` |

### Triangular параметри

| Параметр | Опис | Рекомендоване значення |
|----------|------|------------------------|
| `TRIANGULAR_MIN_PROFIT` | Мінімальний прибуток (%) | `0.8` |
| `TRIANGULAR_MAX_POSITION_SIZE` | Макс. розмір позиції (USDT) | `100` |
| `TRIANGULAR_MAX_CONCURRENT` | Макс. одночасних трейдів | `2` |

### Risk Management

| Параметр | Опис | Рекомендоване значення |
|----------|------|------------------------|
| `MAX_DAILY_LOSS` | Макс. денний збиток (USDT) | `50` |
| `MAX_DAILY_TRADES` | Макс. кількість трейдів/день | `100` |
| `BLACKLISTED_SYMBOLS` | Заборонені символи | ` ` (порожньо) |
| `BLACKLISTED_EXCHANGES` | Заборонені біржі | ` ` (порожньо) |

## 🎮 API Endpoints для управління

### Вмикання/вимикання торгівлі

```bash
# Увімкнути торгівлю
curl -X POST http://localhost:3000/api/trading/enable

# Вимкнути торгівлю
curl -X POST http://localhost:3000/api/trading/disable

# Отримати статистику
curl http://localhost:3000/api/trading/stats
```

### Моніторинг

```bash
# Статистика торгівлі
curl http://localhost:3000/api/trading/stats

# Risk manager stats
curl http://localhost:3000/api/stats
```

## 📝 Логи

### Локація логів

```
./logs/
├── app.log              # Загальні логи
└── trades/
    ├── trades-2024-01-15.jsonl   # Детальні логи трейдів
    └── summary-2024-01-15.txt    # Денний звіт
```

### Формат логів трейдів (JSONL)

Кожен трейд логується в окремий рядок у форматі JSON:

```json
{
  "id": "uuid",
  "opportunityId": "uuid",
  "opportunityType": "cross-exchange",
  "status": "completed",
  "orders": [...],
  "profit": {
    "netProfit": 1.25,
    "profitPercent": 1.25,
    "fees": {...}
  },
  "executionTimeMs": 1234
}
```

## ⚠️ Важливі примітки

### Безпека

1. **НІКОЛИ** не комітьте `.env` файл в git
2. **ЗАВЖДИ** починайте з `TEST_MODE=true`
3. **ОБОВ'ЯЗКОВО** тестуйте на testnet перед production
4. Використовуйте API ключі з обмеженими правами (тільки торгівля, без withdrawal)

### Мінімальні баланси

Переконайтесь що маєте достатньо коштів на біржах:

- **Cross-exchange**: Мінімум `CROSS_MAX_POSITION_SIZE * 2` на кожній біржі
- **Triangular**: Мінімум `TRIANGULAR_MAX_POSITION_SIZE` в USDT на Bybit

### Комісії бірж

Враховуйте комісії при налаштуванні `MIN_PROFIT`:

| Біржа | Maker | Taker |
|-------|-------|-------|
| Binance | 0.1% | 0.1% |
| Bybit | 0.1% | 0.1% |
| Coinbase | 0.4% | 0.6% |

## 🐛 Troubleshooting

### Торгівля не виконується

1. Перевірте `TRADING_ENABLED=true`
2. Перевірте достатність балансів
3. Перевірте логи на помилки
4. Перевірте чи не досягнуто денних лімітів

### Emergency Stop спрацював

```bash
# Перевірте причину
curl http://localhost:3000/api/trading/stats

# Скиньте emergency stop (якщо причина усунена)
# Потрібно буде додати endpoint або перезапустити
```

### Недостатньо балансу

```bash
# Перевірте баланси
curl http://localhost:3000/api/prices

# Поповніть баланси на біржах
# Або зменшіть MAX_POSITION_SIZE
```

## 📈 Моніторинг продуктивності

### Ключові метрики

- **Success Rate**: Повинен бути >90%
- **Average Execution Time**: <2000ms для cross-exchange, <3000ms для triangular
- **Daily Profit**: Відстежуйте щоденний прибуток
- **Slippage**: Має бути <1% для більшості трейдів

### WebSocket для real-time моніторингу

```javascript
const ws = new WebSocket('ws://localhost:8080');

ws.on('message', (data) => {
  const event = JSON.parse(data);
  
  if (event.type === 'trade_completed') {
    console.log('Trade completed:', event.data);
  }
  
  if (event.type === 'emergency_stop') {
    console.log('EMERGENCY STOP!', event.data);
  }
});
```

## 🔧 Розширені налаштування

### Додавання символів для торгівлі

Відредагуйте `src/server.ts`:

```typescript
this.exchangeManager!.createWebSockets([
    'BTC/USDT',
    'ETH/USDT',
    'YOUR/SYMBOL',  // Додайте тут
]);
```

### Додавання нових triangular paths

Відредагуйте `src/services/TriangularBybitService.ts`:

```typescript
private readonly paths: TriangularPath[] = [
    {
        symbols: ['BTC/USDT', 'ETH/BTC', 'ETH/USDT'],
        directions: ['buy', 'buy', 'sell'],
        minAmount: 100,
        description: 'USDT → BTC → ETH → USDT'
    },
    // Додайте новий path тут
];
```

## 📞 Support

Якщо виникли проблеми, перевірте:
1. Логи в `./logs/`
2. API endpoints статистики
3. Баланси на біржах
4. Правильність API ключів
