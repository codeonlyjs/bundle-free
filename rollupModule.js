import { rollup } from 'rollup';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json';

export async function rollupModule(entryPoint, outputFile) {
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

