import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { init, parse } from 'es-module-lexer';

// Helper to escape a string for use in a regular expression
export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function ensureRegExp(stringOrRegex)
{
    if (typeof(stringOrRegex) === "string")
        return new RegExp(escapeRegExp(stringOrRegex), "g");
    else
        return string;
}

// Convert a URL pattern with * wildcards in to a regexp
export function patternToRegex(pattern)
{
    return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, (m) => {
        if (m == '*')
            return `(.*)`;
        else
            return m;
    })}$`);
}

// Check if a pathname exists
export function exists(pathname)
{
    return fs.stat(pathname)
                .then(() => true)
                .catch(() => false);
}

// Get the package file for a module
export function readPackageFile(folder)
{
    try
    {
        return JSON.parse(readFileSync(path.join(folder, "package.json")));
    }
    catch (err)
    {
        if (err.code == "ENOENT")
            return null;
        throw err;
    }
}


// Check if an ES6 module has a default export
export async function doesEs6ModuleHaveDefaultExport(filePath) {
  await init;
  const source = await fs.readFile(filePath, 'utf8');
  const [, exports] = parse(source);

  // Only catches locally-declared "export default" or explicit
  // "export { default } from './x.js'" re-exports.
  // "export * from './x.js'" is correctly excluded — it never
  // carries default, per spec.
  return exports.some(e => e.n === 'default');
}