import { config } from './config.js';
import { atomicWriteJson, loadValidatedJson } from './persistence.js';
import { FundedAIAdmission, UsageSchema, emptyUsage } from './admission.js';

// Shares the backend's single-process deployment constraint. Kept separately
// from the trading database so legacy state cannot reset the spending budget.
const usagePath = `${config.dbPath}.ai-usage.json`;
export const fundedAI = new FundedAIAdmission(
  () => loadValidatedJson(usagePath, UsageSchema, emptyUsage()),
  usage => atomicWriteJson(usagePath, usage),
);
