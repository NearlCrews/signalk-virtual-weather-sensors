/**
 * Simple observability metrics for plugin health monitoring
 * Provides counters, gauges, and timing metrics without external dependencies
 */

/**
 * Metric types supported by the collector
 */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/**
 * Single metric data point
 */
interface MetricValue {
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

/**
 * Metric definition and current values
 */
interface Metric {
  name: string;
  type: MetricType;
  description: string;
  values: MetricValue[];
  sum?: number;
  count?: number;
}

/**
 * Metrics snapshot for reporting
 */
export interface MetricsSnapshot {
  readonly timestamp: string;
  readonly uptime: number;
  readonly metrics: ReadonlyArray<{
    readonly name: string;
    readonly type: MetricType;
    readonly description: string;
    readonly value: number;
    readonly labels?: Record<string, string>;
  }>;
}

/**
 * Histogram percentile result
 */
interface HistogramStats {
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  count: number;
}

/**
 * Simple metrics collector for observability
 * Tracks counters, gauges, and timing histograms
 */
export class MetricsCollector {
  private readonly metrics = new Map<string, Metric>();
  private readonly startTime = Date.now();
  private readonly maxHistogramSize = 1000; // Keep last 1000 values

  /**
   * Register a new counter metric
   * Counters only increase and are used for totals (requests, errors, etc.)
   */
  public registerCounter(name: string, description: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        name,
        type: 'counter',
        description,
        values: [{ value: 0, timestamp: Date.now() }],
      });
    }
  }

  /**
   * Increment a counter by the specified amount
   */
  public incrementCounter(name: string, amount = 1, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (metric && metric.type === 'counter') {
      const lastValue = metric.values[metric.values.length - 1]?.value ?? 0;
      const newValue: MetricValue = { value: lastValue + amount, timestamp: Date.now() };
      if (labels) {
        newValue.labels = labels;
      }
      metric.values = [newValue];
    }
  }

  /**
   * Register a new gauge metric
   * Gauges can go up and down (current temperature, active connections, etc.)
   */
  public registerGauge(name: string, description: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        name,
        type: 'gauge',
        description,
        values: [],
      });
    }
  }

  /**
   * Set the current value of a gauge
   */
  public setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (metric && metric.type === 'gauge') {
      const newValue: MetricValue = { value, timestamp: Date.now() };
      if (labels) {
        newValue.labels = labels;
      }
      metric.values = [newValue];
    }
  }

  /**
   * Register a histogram for timing measurements
   * Histograms track value distribution over time
   */
  public registerHistogram(name: string, description: string): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, {
        name,
        type: 'histogram',
        description,
        values: [],
        sum: 0,
        count: 0,
      });
    }
  }

  /**
   * Record a value in a histogram
   */
  public recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const metric = this.metrics.get(name);
    if (metric && metric.type === 'histogram') {
      const newValue: MetricValue = { value, timestamp: Date.now() };
      if (labels) {
        newValue.labels = labels;
      }
      metric.values.push(newValue);
      metric.sum = (metric.sum ?? 0) + value;
      metric.count = (metric.count ?? 0) + 1;

      // Trim to max size to prevent memory growth
      if (metric.values.length > this.maxHistogramSize) {
        const removed = metric.values.shift();
        if (removed) {
          metric.sum = (metric.sum ?? 0) - removed.value;
          metric.count = Math.max(0, (metric.count ?? 0) - 1);
        }
      }
    }
  }

  /**
   * Time a function execution and record to histogram
   */
  public async timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.recordHistogram(name, Date.now() - start);
    }
  }

  /**
   * Get histogram statistics
   */
  public getHistogramStats(name: string): HistogramStats | null {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== 'histogram' || metric.values.length === 0) {
      return null;
    }

    const values = metric.values.map((v) => v.value).sort((a, b) => a - b);
    const count = values.length;

    return {
      min: values[0] ?? 0,
      max: values[count - 1] ?? 0,
      mean: (metric.sum ?? 0) / count,
      p50: values[Math.floor(count * 0.5)] ?? 0,
      p95: values[Math.floor(count * 0.95)] ?? 0,
      p99: values[Math.floor(count * 0.99)] ?? 0,
      count,
    };
  }

  /**
   * Get current value of a metric
   */
  public getValue(name: string): number | null {
    const metric = this.metrics.get(name);
    if (!metric || metric.values.length === 0) {
      return null;
    }

    if (metric.type === 'histogram') {
      return metric.sum ?? 0;
    }

    return metric.values[metric.values.length - 1]?.value ?? null;
  }

  /**
   * Convert a metric to a snapshot entry
   * @private
   */
  private metricToSnapshotEntry(metric: Metric): {
    name: string;
    type: MetricType;
    description: string;
    value: number;
    labels?: Record<string, string>;
  } | null {
    const lastValue = metric.values[metric.values.length - 1];
    if (!lastValue) return null;

    const value =
      metric.type === 'histogram' ? (metric.sum ?? 0) / (metric.count ?? 1) : lastValue.value;

    const entry: {
      name: string;
      type: MetricType;
      description: string;
      value: number;
      labels?: Record<string, string>;
    } = {
      name: metric.name,
      type: metric.type,
      description: metric.description,
      value,
    };

    if (lastValue.labels) {
      entry.labels = lastValue.labels;
    }

    return entry;
  }

  /**
   * Get a snapshot of all metrics
   */
  public getSnapshot(): MetricsSnapshot {
    const metrics: Array<{
      name: string;
      type: MetricType;
      description: string;
      value: number;
      labels?: Record<string, string>;
    }> = [];

    for (const metric of this.metrics.values()) {
      if (metric.values.length === 0) continue;

      const entry = this.metricToSnapshotEntry(metric);
      if (entry) {
        metrics.push(entry);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      metrics,
    };
  }

  /**
   * Reset all metrics
   */
  public reset(): void {
    for (const metric of this.metrics.values()) {
      metric.values = metric.type === 'counter' ? [{ value: 0, timestamp: Date.now() }] : [];
      metric.sum = 0;
      metric.count = 0;
    }
  }

  /**
   * Get uptime in milliseconds
   */
  public getUptime(): number {
    return Date.now() - this.startTime;
  }
}

/**
 * Pre-configured metrics for the weather plugin
 */
export function createPluginMetrics(): MetricsCollector {
  const metrics = new MetricsCollector();

  // Counters
  metrics.registerCounter('weather_api_requests_total', 'Total weather API requests made');
  metrics.registerCounter('weather_api_errors_total', 'Total weather API errors');
  metrics.registerCounter('weather_updates_total', 'Total weather data updates processed');
  metrics.registerCounter('data_emissions_total', 'Total data emissions to Signal K');
  metrics.registerCounter('validation_errors_total', 'Total validation errors encountered');

  // Gauges
  metrics.registerGauge('location_cache_size', 'Current location cache size');
  metrics.registerGauge('current_temperature_kelvin', 'Current temperature in Kelvin');
  metrics.registerGauge('current_wind_speed_ms', 'Current wind speed in m/s');
  metrics.registerGauge('current_pressure_pa', 'Current pressure in Pascals');
  metrics.registerGauge('data_age_seconds', 'Age of current weather data in seconds');

  // Histograms
  metrics.registerHistogram('weather_update_duration_ms', 'Weather update processing time');
  metrics.registerHistogram('api_request_duration_ms', 'API request duration');
  metrics.registerHistogram('emission_duration_ms', 'Data emission duration');

  return metrics;
}
