import { createApp } from './app.js';
import { config } from './config.js';

createApp({ enableRateLimits: !config.rateLimitsDisabled }).listen(config.port, () => {
  console.log(`Home Budget API listening on http://localhost:${config.port}`);
});
