import { Logger } from 'millennium';

const PLUGIN_NAME = 'External Data Sources';
const PREFIX = `[${PLUGIN_NAME}]`;

/**
 * Millennium's logger writes to the Steam developer console (CEF DevTools).
 * Starlight routes the plugin's own `console.error` calls to Millennium's
 * plugin console instead, so failures would otherwise be invisible in DevTools.
 */
const devtools = new Logger(PLUGIN_NAME);

/** Plugin diagnostics; errors reach both Millennium's plugin console and DevTools. */
export const log = {
  info: (message: string, ...details: unknown[]) => devtools.log(message, ...details),
  debug: (message: string, ...details: unknown[]) => devtools.debug(message, ...details),
  error(message: string, ...details: unknown[]) {
    console.error(`${PREFIX} ${message}`, ...details);
    devtools.error(message, ...details);
  },
};
