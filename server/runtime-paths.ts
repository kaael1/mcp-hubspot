import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = here.endsWith(join('dist', 'server')) ? resolve(here, '..', '..') : resolve(here, '..');

export const getPackageRoot = () => packageRoot;
export const getDataDir = () => process.env.HUBSPOT_BROWSER_DATA_DIR || join(packageRoot, 'data');
export const getDataFilePath = (name: string) => join(getDataDir(), name);
