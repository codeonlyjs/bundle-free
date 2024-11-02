import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json';
import { findNodeModulesRoot, tryUnlink, exists } from './utils.js';
import { getPackageExport } from './packageUtils.js';

// Work out the cache directory as both file path and a URL
let node_modules = findNodeModulesRoot();
let cache_dir = path.join(node_modules, "@toptensoftware", "bundle-free", "cache");
let cache_url = `node_modules/@toptensoftware/bundle-free/cache`;


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

export async function rollupModule(pkg, exportPath, exportWrapper)
{
    try
    {
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

        // Work out full path to the import file
        src_file = path.join(node_modules, pkg.name, src_file);

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


