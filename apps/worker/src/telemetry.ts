import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/, '');
const sdk = new NodeSDK({
  serviceName: 'neighbourhood-store-worker',
  ...(endpoint
    ? { traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }) }
    : { spanProcessors: [] }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();
process.once('beforeExit', () => {
  void sdk.shutdown();
});
