// OpenTelemetry bootstrap. MUST be imported before any instrumented module so
// the auto-instrumentations can patch http/express/pg/nestjs at load time —
// hence the import at the very top of main.ts.
//
// Everything is driven by the standard OTEL_* environment variables; nothing is
// hardcoded. Set at least:
//   OTEL_EXPORTER_OTLP_ENDPOINT=https://alloy.gitnasr.com   (SDK appends /v1/{signal})
//   OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
//   OTEL_SERVICE_NAME=kakaw-backend
// Telemetry is disabled (SDK never starts) when no endpoint is configured, so
// local development stays quiet unless you opt in.
import { metrics } from '@opentelemetry/api';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { HostMetrics } from '@opentelemetry/host-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();

if (endpoint) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'kakaw-backend',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.1.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
        process.env.NODE_ENV ?? 'development',
    }),
    // Exporters read OTEL_EXPORTER_OTLP_ENDPOINT / _PROTOCOL / _HEADERS from env.
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem spans are extremely noisy and rarely useful.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // pino logs are shipped to OTLP automatically; keep trace-id injection.
        '@opentelemetry/instrumentation-pino': {},
      }),
    ],
  });

  sdk.start();

  // Process/runtime metrics (CPU, memory, event-loop, GC).
  new HostMetrics({ meterProvider: metrics.getMeterProvider() }).start();

  const shutdown = () => {
    void sdk
      .shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  // eslint-disable-next-line no-console
  console.log(`[telemetry] OpenTelemetry started → ${endpoint}`);
}
