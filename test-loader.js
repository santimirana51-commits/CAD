import { resolve as pathResolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const alias = {
  '@': pathResolve(dirname(fileURLToPath(import.meta.url)), 'src'),
  '@core': pathResolve(dirname(fileURLToPath(import.meta.url)), 'src/core'),
  '@agent': pathResolve(dirname(fileURLToPath(import.meta.url)), 'src/agent'),
  '@ui': pathResolve(dirname(fileURLToPath(import.meta.url)), 'src/ui'),
  '@shared': pathResolve(dirname(fileURLToPath(import.meta.url)), 'src/shared'),
  '@features': pathResolve(dirname(fileURLToPath(import.meta.url)), 'src/features'),
};

export async function resolve(specifier, context, nextResolve) {
  for (const [key, target] of Object.entries(alias)) {
    if (specifier === key || specifier.startsWith(key + '/')) {
      const rest = specifier.slice(key.length);
      const mapped = pathToFileURL(pathResolve(target + rest)).href;
      return nextResolve(mapped, context);
    }
  }
  return nextResolve(specifier, context);
}
