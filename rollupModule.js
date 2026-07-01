import { rollup } from "rollup";
import { nodeResolve } from "@rollup/plugin-node-resolve"
import polyfillNode from 'rollup-plugin-polyfill-node';
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";

// Rollup a module
export async function runRollup(entryPoint) 
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


        const { output } = await bundle.generate({ format: 'es' });
        return output[0].code;
 
	} 
    finally
    {
		await bundle?.close();
	}
}
