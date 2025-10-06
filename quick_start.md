# 🚀 Швидкий старт - Автоторгівля

## Крок 1: Підготовка API ключів

### Binance Testnet
1. Йдіть на https://testnet.binance.vision/
2. Створіть акаунт
3. Згенеруйте API ключі
4. Поповніть testnet баланс (безкоштовно)

### Bybit Testnet
1. Йдіть на https://testnet.bybit.com/
2. Створіть акаунт
3. Згенеруйте API ключі
4. Поповніть testnet баланс

## Крок 2: Налаштування .env

```bash
# Скопіюйте приклад
cp .env.example .env

# Відредагуйте .env
nano .env
```

Мінімальна конфігурація для тестування:

```env
# Exchange
TEST_MODE=true
CROSS_ENABLED_EXCHANGES=binance
TRIANGULAR_ENABLED_EXCHANGES=bybit

# Trading - ВИМКНЕНО для початку
TRADING_ENABLED=false
CROSS_TRADING_ENABLED=false
TRIANGULAR_TRADING_ENABLED=false

# API Keys (testnet)
BINANCE_API_KEY=your_testnet_key
BINANCE_SECRET=your_testnet_secret

BYBIT_API_KEY=your_testnet_key
BYBIT_SECRET=your_testnet_secret

# Conservative settings for testing
CROSS_MAX_POSITION_SIZE=10
TRIANGULAR_MAX_POSITION_SIZE=10
MAX_DAILY_LOSS=5
MAX_DAILY_TRADES=20
```

## Крок 3: Перший запуск (БЕЗ торгівлі)

```bash
# Встановити залежності
npm install

# Побудувати проект
npm run build

# Запустити в dev режимі
npm run dev
```

**Що очікувати:**
```
🔌 Connected to binance WebSocket
🔌 Connected to bybit WebSocket
🚀 Server running localhost:3000
⚙️ Auto-Trading Status { enabled: false, ... }
```

## Крок 4: Перевірка роботи

### 4.1 Перевірте API
```bash
# Здоров'я системи
curl http://localhost:3000/api/health

# Можливості арбітражу (повинні знаходитись)
curl http://localhost:3000/api/opportunities

# Ціни
curl http://localhost:3000/api/prices
```

### 4.2 Перевірте WebSocket
Відкрийте браузер: http://localhost:3000

Ви повинні бачити real-time оновлення можливостей.

## Крок 5: Тестування з малими сумами

Після успішної перевірки кроку 4:

```bash
# Зупиніть сервер (Ctrl+C)

# Відредагуйте .env
nano .env
```

Увімкніть торгівлю з мінімальними параметрами:

```env
TRADING_ENABLED=true
CROSS_TRADING_ENABLED=true

# Дуже малі суми для тестування
CROSS_MIN_PROFIT=1.0
CROSS_MAX_POSITION_SIZE=10
CROSS_MAX_CONCURRENT=1
MAX_DAILY_TRADES=5
```

```bash
# Перезапустіть
npm run dev
```

**Що очікувати:**
```
✅ AutoTradingService initialized
⚙️ Trading Configuration { enabled: true, crossExchange: true, ... }
🎯 Executing cross-exchange trade
✅ Cross-exchange trade completed
```

## Крок 6: Моніторинг

### Переглянути статистику
```bash
curl http://localhost:3000/api/trading/stats
```

Відповідь:
```json
{
  "success": true,
  "data": {
    "isRunning": true,
    "config": {
      "enabled": true,
      "crossExchange": true,
      "triangular": false
    },
    "risk": {
      "dailyTrades": 3,
      "dailyLoss": 0,
      "activeTrades": {
        "crossExchange": 0,
        "triangular": 0
      }
    },
    "transactions": {
      "total": 3,
      "completed": 3,
      "failed": 0,
      "totalProfit": 2.45
    }
  }
}
```

### Переглянути логи
```bash
# Real-time логи
tail -f logs/app.log

# Трейди
cat logs/trades/trades-2024-01-15.jsonl | jq

# Денний звіт
cat logs/trades/summary-2024-01-15.txt
```

## Крок 7: Поступове збільшення

Якщо все працює добре на testnet протягом кількох днів:

1. **Збільште позиції:**
```env
CROSS_MAX_POSITION_SIZE=50
MAX_DAILY_TRADES=50
```

2. **Увімкніть triangular:**
```env
TRIANGULAR_TRADING_ENABLED=true
```

3. **Знизьте мінімальний profit** (більше можливостей):
```env
CROSS_MIN_PROFIT=0.5
TRIANGULAR_MIN_PROFIT=0.8
```

## Крок 8: Production (реальні гроші)

⚠️ **ТІЛЬКИ після успішного тестування протягом 1-2 тижнів!**

1. **Створіть production API ключі:**
    - Binance: https://www.binance.com/en/my/settings/api-management
    - Bybit: https://www.bybit.com/app/user/api-management
    - **ВАЖЛИВО**: Дозвольте тільки "Spot Trading", БЕЗ "Withdrawal"

2. **Оновіть .env:**
```env
# Вимкніть testnet
TEST_MODE=false

# Production API ключі
BINANCE_API_KEY=your_production_key
BINANCE_SECRET=your_production_secret

BYBIT_API_KEY=your_production_key
BYBIT_SECRET=your_production_secret

# Консервативні налаштування для початку
TRADING_ENABLED=true
CROSS_TRADING_ENABLED=true
TRIANGULAR_TRADING_ENABLED=false

CROSS_MIN_PROFIT=0.8
CROSS_MAX_POSITION_SIZE=50
CROSS_MAX_CONCURRENT=2
MAX_DAILY_LOSS=20
MAX_DAILY_TRADES=50
```

3. **Поповніть баланси:**
    - Мінімум $200-300 USDT на кожній біржі
    - Плюс мінімум $50-100 BTC і ETH

4. **Запустіть і моніторте:**
```bash
npm run build
npm start

# В іншому терміналі - моніторинг
watch -n 5 'curl -s http://localhost:3000/api/trading/stats | jq'
```

## ⚠️ Контрольний чеклист перед production

- [ ] Успішно протестовано на testnet 1-2 тижні
- [ ] Success rate >90% на testnet
- [ ] Середній час виконання <2 секунд
- [ ] API ключі мають тільки trading права (БЕЗ withdrawal)
- [ ] Налаштовано обмеження (MAX_DAILY_LOSS, MAX_POSITION_SIZE)
- [ ] Є достатній баланс на біржах
- [ ] Налаштовано моніторинг і алерти

## 🛟 Екстрена зупинка

Якщо щось пішло не так:

### Метод 1: API
```bash
curl -X POST http://localhost:3000/api/trading/disable
```

### Метод 2: Вимкнути в .env
```env
TRADING_ENABLED=false
```

### Метод 3: Зупинити сервер
```bash
# Ctrl+C або
pkill -f "node dist/server.js"
```

### Метод 4: Emergency stop (якщо досягнуто MAX_DAILY_LOSS)
Автоматично зупиниться, потрібен перезапуск

## 📊 Щоденна рутина

### Ранок (перед початком торгівлі)
```bash
# 1. Перевірити баланси
curl http://localhost:3000/api/prices | jq '.data.prices'

# 2. Перевірити статус
curl http://localhost:3000/api/health

# 3. Переглянути вчорашній звіт
cat logs/trades/summary-$(date -d yesterday +%Y-%m-%d).txt

# 4. Запустити якщо зупинено
npm start
```

### Протягом дня
```bash
# Кожні 2-4 години перевіряйте статистику
curl http://localhost:3000/api/trading/stats | jq

# Переглядайте логи на помилки
tail -100 logs/app.log | grep ERROR
```

### Вечір (після закриття торгівлі)
```bash
# 1. Згенерувати звіт
curl http://localhost:3000/api/trading/stats | jq

# 2. Переглянути денний звіт
cat logs/trades/summary-$(date +%Y-%m-%d).txt

# 3. Опціонально: зупинити на ніч
curl -X POST http://localhost:3000/api/trading/disable
```

## 🔧 Troubleshooting

### Проблема: Жодного трейду не виконується

**Діагностика:**
```bash
# 1. Перевірте чи увімкнена торгівля
curl http://localhost:3000/api/trading/stats | jq '.data.config'

# 2. Перевірте чи є можливості
curl http://localhost:3000/api/opportunities | jq '.data.opportunities | length'

# 3. Перевірте баланси
curl http://localhost:3000/api/prices
```

**Можливі причини:**
- Trading disabled
- Недостатньо балансу
- MIN_PROFIT занадто високий
- Досягнуто денних лімітів
- Emergency stop active

**Рішення:**
```bash
# Знизити MIN_PROFIT
CROSS_MIN_PROFIT=0.3

# Або збільшити баланси на біржах
```

### Проблема: Багато failed trades

**Діагностика:**
```bash
# Перегляньте failed трейди
cat logs/trades/trades-$(date +%Y-%m-%d).jsonl | jq 'select(.status=="failed")'
```

**Можливі причини:**
- Недостатня ліквідність
- Надто повільне виконання
- Network issues
- Slippage занадто великий

**Рішення:**
```bash
# Збільшити мінімальний profit
CROSS_MIN_PROFIT=0.8

# Зменшити position size
CROSS_MAX_POSITION_SIZE=30

# Збільшити slippage tolerance
SLIPPAGE_TOLERANCE=0.8
```

### Проблема: Emergency stop спрацював

**Діагностика:**
```bash
curl http://localhost:3000/api/trading/stats | jq '.data.risk'
```

**Рішення:**
1. Проаналізуйте чому виникли збитки
2. Виправте налаштування
3. Перезапустіть сервер (emergency stop скинеться)

### Проблема: Біржа відключилась

**Логи покажуть:**
```
❌ Exchange binance failed to reconnect after maximum attempts
```

**Рішення:**
1. Перевірте інтернет з'єднання
2. Перевірте статус біржі (чи не maintenance)
3. Перезапустіть сервер

## 📈 Оптимізація після тижня роботи

### Аналіз продуктивності

```bash
# Переглянути всі трейди за тиждень
cat logs/trades/trades-*.jsonl | jq -s '
  {
    total: length,
    completed: [.[] | select(.status=="completed")] | length,
    avgProfit: [.[] | select(.status=="completed") | .profit.netProfit] | add / length,
    avgExecutionTime: [.[] | select(.status=="completed") | .executionTimeMs] | add / length
  }
'
```

### Якщо success rate >95% і стабільний profit:

1. **Збільшити position size:**
```env
CROSS_MAX_POSITION_SIZE=100
TRIANGULAR_MAX_POSITION_SIZE=100
```

2. **Збільшити concurrent trades:**
```env
CROSS_MAX_CONCURRENT=3
TRIANGULAR_MAX_CONCURRENT=2
```

3. **Знизити MIN_PROFIT:**
```env
CROSS_MIN_PROFIT=0.5
TRIANGULAR_MIN_PROFIT=0.7
```

### Якщо success rate <80%:

1. **Підвищити MIN_PROFIT:**
```env
CROSS_MIN_PROFIT=1.0
TRIANGULAR_MIN_PROFIT=1.2
```

2. **Зменшити position size:**
```env
CROSS_MAX_POSITION_SIZE=30
```

3. **Зменшити concurrent trades:**
```env
CROSS_MAX_CONCURRENT=1
```

## 💡 Поради

1. **Починайте малими сумами** - навіть на production, почніть з $50-100
2. **Моніторте щодня** - перші 2 тижні перевіряйте кожні 2-4 години
3. **Не жадібничайте** - краще стабільні 0.5% ніж ризиковані 2%
4. **Тримайте emergency fund** - завжди майте 20-30% балансу в резерві
5. **Ведіть журнал** - записуйте всі зміни конфігурації та їх результати

## 🎯 Очікувані результати

### Консервативні налаштування:
- Прибуток: 5-15% на місяць
- Success rate: 85-95%
- Трейдів на день: 10-30

### Агресивні налаштування:
- Прибуток: 15-30% на місяць
- Success rate: 70-85%
- Трейдів на день: 50-100
- ⚠️ Вищий ризик

## ✅ Готово!

Якщо дотримувались всіх кроків, ваш бот готовий до роботи.

**Пам'ятайте:**
- Починайте з testnet
- Використовуйте малі суми
- Моніторте регулярно
- Не панікуйте при збитках
- Вдосконалюйте налаштування поступово

Успішної торгівлі! 🚀📈