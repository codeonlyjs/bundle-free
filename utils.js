import path from 'node:path';
import url from 'node:url';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

// Path to self
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Return self directory
export function thisDir()
{
    return __dirname;
}

// Find the node_modules folder 
export function findNodeModules()
{
    let dir = path.dirname(__dirname);
    while (true)
    {
        let node_modules = path.join(dir, "node_modules");
        if (existsSync(node_modules))
            return node_modules;
        let parentDir = path.dirname(dir);
        if (parentDir == dir)
        {
            throw new Error("Failed to locate node_modules");
        }
        dir = parentDir;
    }
}

// Helper to escape a string for use in a regular expression
export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// Try to unlink a file, ignore if can't
export async function tryUnlink(pathname)
{
    try
    {
        await fs.unlink(pathname);
    }
    catch
    {
        // don't care
    }
}