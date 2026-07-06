# Bundle Free

BundleFree is an ExpressJS middleware for use during development that:

* serves NPM packages to the browser without requiring a bundler or build 
  server - and does so in a manner that's compatible with bundling for production

* can use Rollup to convert CommonJS modules to ES6 for use client side

* provides an easy way to inject livereload scripts so that when files are 
  saved during development the browser automatically refreshes and updates

* injects a client script to displays prominent in-browser JavaScript error messages


Notes: 

* this is only intended to be used during development - for production you
  should still use a bundler. 

* this is not a really browserification tool and your mileage with modules
  not intended to be used in the browser might vary.


## Install

```
npm install --save codeonlyjs/bundle-free
```

## Usage

Suppose you have a client side ES6 app that's in the `./client` sub-folder
of your ExpressJS project. Also, assume the bundled version is
available in the `./client/dist` folder.

* For production we want to serve `./client/dist`.  

* For development we want to serve `./client`.

(Obviously, you can adjust paths to suit your project).

First, import the middleware:

```js
import { bundleFreeMiddleware } from '@codeonlyjs/bundle-free';
```

Next, "use" the middleware:

```js
if (process.env.NODE_ENV == "production")
{
    // Production, serve bundled app
    app.use(express.static(path.join(__dirname, "client/dist")));
}
else
{
    // Development, serve unbundled app
    app.use(bundleFreeMiddleWare({ /* options */}));

    // Development, serve unbundled app
    app.use(express.static(path.join(__dirname, "client")));
}
```

Now, in your client side `.js` files you can directly reference any
install npm modules.

```js
// Client side script files can now import directly from the bare
// module name:
import * from '@scoped/package1';
```


## Options

The following options are available:

* `baseDir` - an optional base directory - typically this will be the root directory of your project, defaults to the current working directory
* `autoDeps` - if true (the default) automatically follow the dependency chain of all referenced modules
* `modules` - an optional array of module overrides and settings
* `replace` - an optional array of string replacements on served files (see below)
* `rules` - an optional array of array of rewrite and redirect rules (see below)
* `moduleBaseUrl` - the URL in which modules are made available (defaults to `/modules`)
* `livereload` - allows injection of livereload script into html pages (see below)
* `inYaFace` - if true (false by default) injects a script into html pages to prominently display client side JavaScript errors.



## Module Options

You can specify additional modules, or modify options on automatically discovered modules using the `modules` options.

For each module entry, the following options are available:

* `"*"` - wild card string entry means serve all modules in the baseDir/package.json dependencies
* `name` - required the package name of the module
* `ignore` - if true, suppresses availability of this module client side
* `url` - if set, creates an entry in the generated import map, but doesn't nothing to serve this module
* `virtual` - specifies virtual module with contents specified by this property
* `location` - specifies the file location of this module (the path is relative to `options.baseDir`)
* `package` - an object that can be used to override settings in the modules `package.json` file.  This object is deep merged with the package.json contents.
* `rollup` - if true, forces the package to be bundled using rollup.
* `nodeps` - suppresses automatically serving the module's dependencies.

eg: serve all modules in package.json dependencies, except "@scope/module"

```
    options: {
        modules: [
            "*",            // Serve all project dependencies
            { 
                name: "@scope/module", 
                ignore: true 
            },
        ]
    }
```

eg: create a virtual module:

```
    options: {
        modules: [
            { 
                name: "customModule", 
                virtual: `export default function() { };` 
            },
        ]
    }
```

eg: force a package to be bundled using rollup:

```
    options: {
        modules: [
            { 
                name: "mycjsmodule", 
                rollup: true 
            },
        ]
    }
```



## String Replacements

Sometimes you might need to patch certain files during development:

eg: make a file reference absolute to root instead of relative to page URL (handy for
    when index is used as fallback for SPA applications)

```
    options: {
        replace: [
            { from: "./Main.js", to: "/Main.js", contentType: "text/html" }
        ]
    }
```

The following options are available:

* `from` - the string or regex to search for
* `to` - the string to replace with
* `contentType` - optional, string or regex, only replaces in served content matching this content type
* `url` - optional, string or regex, only replaces in served content matching this url

Note: string replacements should only ever be used during development - when used they install a filter
that captures output and applies the replacements when the output stream is ended.

Note: string replacements can be used on most text file types (including text, html, css etc...) but
many common binary file types are skipped and these replacements won't apply.



## Rewrite and Redirect Rules

The rules key can be used to specify rewrite and redirect rules:

```
    options: {
        rules: [
            { redirect: "/index.html", to: "/" },
            { rewrite: "/config.js", to: "/config.dev.js" }
        ]
    }
```

The following fields are available:

* `redirect` - a string or regex to match against the current URL and when matches invokes a redirect
* `rewrite` - a string or regex to match against the current URL and when matches invokes a URL rewrite
* `to` - what to redirect/rewrite to



## Live Reload Script

By setting the `livereload` to a truthy value, or an object with a `.port` setting bundle-free will 
automatically insert the script at the bottom of the page.

See [`livereload`](https://www.npmjs.com/package/livereload) for more.

(Note your server will still need to setup the livereload server, this option just injects the script
into served html pages).



## Prominent Error Display

Usually web-browsers are fairly quiet about JavaScript errors unless
you bring up the debugger/inspector and check in the console.

BundleFree includes an option `inYaFace` that when set to true injects
a script that watches for client side JavaScript errors and displays
a very prominent "in your face" error message.

