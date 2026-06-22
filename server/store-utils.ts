import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
};

export const writeJsonFile = async (filePath: string, value: unknown) => {
  await fs.mkdir(dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};
