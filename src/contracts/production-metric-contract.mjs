import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_PRODUCTION_METRIC_CONTRACT_PATH = path.resolve(
  __dirname,
  '../../contracts/production_metric_registry_v01.json'
);

export function loadProductionMetricContract(
  contractPath = DEFAULT_PRODUCTION_METRIC_CONTRACT_PATH
) {
  return JSON.parse(fs.readFileSync(contractPath, 'utf8'));
}

export const PRODUCTION_METRIC_CONTRACT = Object.freeze(loadProductionMetricContract());

const METRIC_BY_ID = new Map(
  PRODUCTION_METRIC_CONTRACT.metrics.map((metric) => [metric.metricId, metric])
);

const PRODUCER_BY_STAGE_ID = new Map(
  PRODUCTION_METRIC_CONTRACT.producers.map((producer) => [producer.producerStageId, producer])
);

export function getProductionMetric(metricId) {
  return METRIC_BY_ID.get(metricId) ?? null;
}

export function requireProductionMetric(metricId) {
  const metric = getProductionMetric(metricId);
  if (!metric) throw new Error(`Unknown authoritative production metric: ${metricId}`);
  return metric;
}

export function isAuthoritativeProductionMetric(metricId) {
  return METRIC_BY_ID.has(metricId);
}

export function listProductionMetrics({
  capabilityId = null,
  producerStageId = null,
  authorityLayer = null,
} = {}) {
  return PRODUCTION_METRIC_CONTRACT.metrics.filter((metric) => {
    if (capabilityId && metric.capabilityId !== capabilityId) return false;
    if (producerStageId && metric.producerStageId !== producerStageId) return false;
    if (authorityLayer && metric.authorityLayer !== authorityLayer) return false;
    return true;
  });
}

export function getProductionMetricIdsForCapability(capabilityId) {
  return listProductionMetrics({ capabilityId }).map((metric) => metric.metricId);
}

export function getProductionProducer(producerStageId) {
  return PRODUCER_BY_STAGE_ID.get(producerStageId) ?? null;
}

export function getProductionProducerForCapability(capabilityId) {
  return (
    PRODUCTION_METRIC_CONTRACT.producers.find(
      (producer) => producer.capabilityId === capabilityId
    ) ?? null
  );
}
