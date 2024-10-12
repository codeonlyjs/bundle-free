import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import express from 'express';

// Path to self
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Find the node_modules folder 
function find_node_modules()
{
    let dir = __dirname;
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

let node_modules = find_node_modules();

// Helper to escape a string for use in a regular expression
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Middleware for serving client side es6 module apps
export function bundleFree(options)
{
    if (process.env.NODE_ENV == "production")
    {
        console.error("WARNING: clientApp not intended to be used in production environments.");
    }

    // Create import map to be injected into served html files
    let importMap = {
        imports: {},
    };
    let rxModule = null;
    if (options.modules)
    {
        let prefix = options.prefix ?? "/";
        if (!prefix.endsWith("/"))
            prefix += "/";

        // Get the main file and add to the import map
        for (let m of options.modules)
        {
            let pkgDir = path.join(node_modules, m);
            let pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json")));
            importMap.imports[m] = `${prefix}${m}/${pkg.main ?? "index.js"}`;
        }

        // Generate a regexp to match and path that starts with the name of a module
        rxModule = new RegExp(`^\/?(?:${options.modules.map(m => escapeRegExp(m)).join("|")})(\/.*)?$`, "");
    }


    // Create a router
    let router = express.Router();

    // Handler to inject importmap into html files
    router.use(async (req, res, next) => {

        // See if path matches an exported module and if so
        // re-write the url to /node_modules/...
        if (rxModule)
        {
            let m = req.path.match(rxModule);
            if (m)
            {
                req.url = "/node_modules" + req.url;
            }
        }


        // Work out filename being requested
        let filename = req.path;
        if (filename == "/")
        {
            var originalUrl = url.parse(req.originalUrl);
            if (!originalUrl.pathname.endsWith("/"))
            {
                originalUrl.pathname += "/";
                let urlNew = url.format(originalUrl);
                return res.redirect(urlNew);
            }
            filename = "/index.html";
        }

        // If it's a html file, inject the importmap so `import ... from "bare-module-name"` works.
        if (filename.match(/(?:.htm|.html)$/i))
        {
            try
            {
                // Read the content
                let content = await fs.readFile(path.join(options.path, filename), "utf8");

                // Insert import map in the <head> block
                content = content.replace("<head>", `<head>\n<script type="importmap">\n${JSON.stringify(importMap, null, 4)}\n</script>\n`);

                // Send it
                res.send(content);
                return;
            }
            catch
            {
                // Probably file not found, pass it on
                // fall through and keep looking in other middlewares
            }
        }

        next();
    });

    // Serve the client app folder
    router.use(express.static(options.path));

    // Serve the node_modules folder
    router.use("/node_modules", express.static(node_modules));

    return router;
}
