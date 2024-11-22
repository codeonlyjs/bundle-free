import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { tryUnlink, exists } from './utils.js';
import { getPackageExport } from './packageUtils.js';

let rollup;
let nodeResolve;
let commonjs;
let json;

// Delay load rollup and plugins.
async function tryLoadRollup()
{
    // Already loaded?
    if (rollup)
        return;

    rollup = (await import('rollup')).rollup;
    nodeResolve = (await import('@rollup/plugin-node-resolve')).nodeResolve;
    commonjs = (await import('@rollup/plugin-commonjs')).default;
    json = (await import('@rollup/plugin-json')).default;
}

// Rollup a module
async function runRollup(entryPoint, outputFile) {
	let bundle;
	try 
    {
		// create a bundle
		bundle = await rollup({
            input: entryPoint,
            plugins: [
                nodeResolve(), 
                json(),
                commonjs()
            ],
        });

        // Write it
        await bundle.write({
            file: outputFile,
            format: "es",
        });
	} 
    finally
    {
		await bundle?.close();
	}
}

// rollup a CJS module to make it available as an ES6 module
// - options - bundle-free options
// - pkg - the package to rollup
// - exportPath - the path within the package to rollup
// - exportWrapper - whether to generate an export wrapper that
//   exports all the symbols as ES6 exports.
export async function rollupModule(options, pkg, exportPath, exportWrapper)
{
    try
    {
        // Work out the cache directory as both a file path and a URL
        let cache_dir = path.join(options.node_modules, "@codeonlyjs", "bundle-free", "cache");
        let cache_url = `node_modules/@codeonlyjs/bundle-free/cache`;

        // Get the exported file
        let src_file = getPackageExport(pkg, exportPath, exportWrapper ? [ "require" ] : [ "import" ]);
        if (!src_file)
            return null;

        // Work out cache file
        let cache_file = crypto
            .createHash('sha256')
            .update(`${pkg.name}/${pkg.version}/${src_file}`)
            .digest('hex') + ".js";
        let cache_path = path.join(cache_dir, cache_file);
            
        // Quit if already exists
        if (await exists(cache_path))
            return cache_url + "/" + cache_file;

        // Make sure the cache folder exists
        if (!await exists(cache_dir))
            await fs.mkdir(cache_dir, { recursive: true });

        // Load rollup
        await tryLoadRollup();

        // Work out full path to the import file
        src_file = path.join(options.node_modules, pkg.name, src_file);

        // Create an export wrapper?
        let export_wrapper_file;
        if (exportWrapper)
        {
            // Create wrapper file
            let export_wrapper_file = path.join(cache_dir, `exports-${cache_file}`);
            let exports = await import("file://" + src_file);
            await fs.writeFile(exports_wrapper_file, `export { ${Object.keys(exports).join(",")} } from ${JSON.stringify(src_file)}`, "utf8");
            src_file = export_wrapper_file;
        }

        // Run rollup
        try
        {
            await runRollup(src_file, cache_path);
        }
        finally
        {
            if (export_wrapper_file)
                tryUnlink(export_wrapper_file);
        }

        return cache_url + "/" + cache_file;
    }
    catch (err)
    {
        console.error(err.message);
        return null;
    }
}


