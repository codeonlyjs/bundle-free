import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { tryUnlink } from './utils.js';
import { getPackageExport } from './packageUtils.js';
import { rollup } from "rollup";
import { nodeResolve } from "@rollup/plugin-node-resolve"
import polyfillNode from 'rollup-plugin-polyfill-node';
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

// Rollup a module
export async function runRollup(entryPoint, outputFile) 
{
	let bundle;
	try 
    {
		// create a bundle
		bundle = await rollup({
            input: entryPoint,
            plugins: [
                polyfillNode(),
                nodeResolve({ 
                    preferBuiltins: true,
                    mainFields: ['browser', 'module', 'main']
                }), 
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
// - exportPath - the path within the package to rollup
export async function rollupModule(module, exportPath, outputBundle)
{
    // Get the exported file
    let exportWrapper = false;
    let src_file = getPackageExport(module.package, exportPath, [ "import", "browser" ]);

    // Couldn't find ES6 entry-point, create one
    if (!src_file)
    {
        //exportWrapper = true;
        src_file = getPackageExport(module.package, exportPath, [ "require", "browser" ])
        if (src_file == null)
            return null;
    }

    // Work out full path to the import file
    src_file = path.resolve(path.join(module.location, src_file));

    // Create an export wrapper?
    let export_wrapper_file;
    if (exportWrapper)
    {
        // Create wrapper file
        export_wrapper_file = path.join(os.tmpdir(), `exports-wrapper.js`);
        let exports = await import("file://" + src_file);
        fs.writeFileSync(export_wrapper_file, `export { ${Object.keys(exports).filter(x => x != "module.exports").join(", ")} } from ${JSON.stringify(src_file)}`, "utf8");
        src_file = export_wrapper_file;
    }

    // Run rollup
    try
    {
        await runRollup(src_file, outputBundle);
    }
    finally
    {
        // Delete wrapper file
        if (export_wrapper_file)
            tryUnlink(export_wrapper_file);
    }
}


