import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type Currency = 'USD' | 'EUR' | 'GBP' | 'INR' | 'CAD' | 'AUD' | 'JPY';

@Injectable()
export class ExchangeRateService {
  private baseCurrency: Currency;
  
  // Base exchange rates relative to USD (reference currency)
  // These rates represent: 1 USD = rate * targetCurrency
  // We use USD as reference because most exchange rate APIs use USD as base
  private baseRatesToUSD: Record<Currency, number> = {
    USD: 1.0,      // Reference currency
    EUR: 0.92,     // 1 USD = 0.92 EUR
    GBP: 0.79,     // 1 USD = 0.79 GBP
    INR: 83.0,     // 1 USD = 83 INR
    CAD: 1.35,     // 1 USD = 1.35 CAD
    AUD: 1.52,     // 1 USD = 1.52 AUD
    JPY: 150.0,    // 1 USD = 150 JPY
  };

  // Cached rates relative to current base currency
  // Will be populated by calculateExchangeRates()
  private exchangeRates: Record<Currency, number> = {} as Record<Currency, number>;

  constructor(private configService: ConfigService) {
    // Get base currency from environment variable, default to INR
    const envCurrency = this.configService.get<string>('BASE_CURRENCY', 'INR').toUpperCase();
    const validCurrencies: Currency[] = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY'];
    
    if (validCurrencies.includes(envCurrency as Currency)) {
      this.baseCurrency = envCurrency as Currency;
    } else {
      this.baseCurrency = 'INR';
    }
    
    // Calculate exchange rates relative to the base currency
    this.calculateExchangeRates();
    
    // TODO: Fetch exchange rates from API
    // Example: https://api.exchangerate-api.com/v4/latest/USD
    // Then convert to base currency rates
    this.loadExchangeRates();
  }

  /**
   * Calculate exchange rates relative to the current base currency
   * Converts from USD-based rates to base-currency-based rates
   */
  private calculateExchangeRates(): void {
    const baseRateInUSD = this.baseRatesToUSD[this.baseCurrency];
    
    if (!baseRateInUSD || baseRateInUSD === 0) {
      throw new Error(`Invalid base currency rate: ${this.baseCurrency}`);
    }
    
    // Initialize exchangeRates object
    this.exchangeRates = {} as Record<Currency, number>;
    
    // Calculate rates: 1 BASE = (1 USD / baseRateInUSD) * (targetRateInUSD / 1 USD)
    // Simplified: 1 BASE = targetRateInUSD / baseRateInUSD
    for (const [currency, rateInUSD] of Object.entries(this.baseRatesToUSD)) {
      const currencyKey = currency as Currency;
      if (currencyKey === this.baseCurrency) {
        this.exchangeRates[currencyKey] = 1.0;
      } else {
        // Convert: if 1 USD = baseRate BASE, and 1 USD = rateInUSD TARGET
        // Then: 1 BASE = rateInUSD / baseRate TARGET
        this.exchangeRates[currencyKey] = rateInUSD / baseRateInUSD;
      }
    }
    
    // Verify rates are not zero
    for (const [currency, rate] of Object.entries(this.exchangeRates)) {
      if (currency !== this.baseCurrency && rate === 0) {
        // Rate is zero - this will cause conversion errors
      }
    }
  }

  /**
   * Get the base currency
   */
  getBaseCurrency(): Currency {
    return this.baseCurrency;
  }

  /**
   * Get exchange rate from base currency to target currency
   * @param currency Target currency
   * @returns Exchange rate (e.g., 0.012 for USD means 1 BASE = 0.012 USD)
   */
  getExchangeRate(currency: Currency): number {
    if (currency === this.baseCurrency) {
      return 1.0;
    }
    const rate = this.exchangeRates[currency];
    if (rate === undefined || rate === null) {
      throw new Error(`Exchange rate not found for currency: ${currency}`);
    }
    return rate;
  }

  /**
   * Convert amount from base currency to target currency
   * @param amount Amount in base currency
   * @param targetCurrency Target currency
   * @returns Amount in target currency
   */
  convertToCurrency(amount: number, targetCurrency: Currency): number {
    if (targetCurrency === this.baseCurrency) {
      return amount;
    }
    const rate = this.getExchangeRate(targetCurrency);
    return amount * rate;
  }

  /**
   * Convert amount from source currency to target currency
   * @param amount Amount in source currency
   * @param sourceCurrency Source currency
   * @param targetCurrency Target currency
   * @returns Amount in target currency
   */
  convertBetweenCurrencies(
    amount: number,
    sourceCurrency: Currency,
    targetCurrency: Currency
  ): number {
    if (sourceCurrency === targetCurrency) {
      return amount;
    }

    // Convert to base currency first, then to target
    if (sourceCurrency !== this.baseCurrency) {
      // Convert from source to base (divide by source rate)
      const sourceRate = this.getExchangeRate(sourceCurrency);
      amount = amount / sourceRate;
    }

    // Convert from base to target
    if (targetCurrency !== this.baseCurrency) {
      const targetRate = this.getExchangeRate(targetCurrency);
      amount = amount * targetRate;
    }

    return amount;
  }

  /**
   * Load exchange rates from external API
   * This should be called periodically to keep rates updated
   */
  private async loadExchangeRates(): Promise<void> {
    try {
      // Fetch real-time exchange rates from exchangerate-api.com (free tier)
      const apiUrl = process.env.EXCHANGE_RATE_API_URL || 'https://api.exchangerate-api.com/v4/latest/USD';
      
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`Exchange rate API returned ${response.status}`);
      }
      
      const data = await response.json() as { rates?: Record<string, number> };
      
      // Update baseRatesToUSD with fetched rates
      if (data.rates) {
        this.baseRatesToUSD = {
          USD: 1.0,
          EUR: data.rates.EUR || this.baseRatesToUSD.EUR,
          GBP: data.rates.GBP || this.baseRatesToUSD.GBP,
          INR: data.rates.INR || this.baseRatesToUSD.INR,
          CAD: data.rates.CAD || this.baseRatesToUSD.CAD,
          AUD: data.rates.AUD || this.baseRatesToUSD.AUD,
          JPY: data.rates.JPY || this.baseRatesToUSD.JPY,
        };
        
        // Recalculate rates for current base currency
        this.calculateExchangeRates();
      }
    } catch (error) {
      // Error loading exchange rates - continue with static rates if API fails
      console.warn('Failed to fetch exchange rates from API, using static rates:', error);
    }
  }

  /**
   * Get all supported currencies
   */
  getSupportedCurrencies(): Currency[] {
    return Object.keys(this.exchangeRates) as Currency[];
  }
}

