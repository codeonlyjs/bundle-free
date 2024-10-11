# Bundle Free

BundleFree is an ExpressJS middleware for using NPM packages client side without a bundler

Note: this is intended to be used during development only.  For production you should be using a bundler. 

## About

BundleFree lets you build client side ES6 module apps that reference NPM 
packages directly using their bare names (ie: no `/` prefix or `.js` suffix).

This means you can write your client side scripts and serve them directly
from your ExpressJS server without bundling, but in a manner that's still
compatible with bundling later for production distribution.

## The Problem

Without bundling, ES6 modules typically need to be referenced
on the client side as follows:

```js
import { * } from "/somefolder/somefile.js"
```

Note:

* The import path must start with a relative specifier (`.`, `/` etc...) because the browser requires this unless there's an import map, and 
* The import path must end with `.js` because web-servers don't typically append `.js` when serving static files.

To make NPM packages available client side, we could make the `node_modules` folder available using ExpressJS's static middleware:

```js
app.use("/node_modules", express.static(path.join(__dirname, "node_modules")));
```

and then reference them client side as:

```js
import { * } from "/node_modules/@toptensoftware/module1/index.js"
```

This works, but when it comes time to bundle for distribution, the bundler isn't going to understand import directives and prefers the bare name of the module:

```js
import { * } from "@toptensoftware/module1"
```

BundleFree lets you use the bare name even when running unbundled during development.


## Install

```
npm install --save @toptensoftware/bundle-free
```

## Usage

Suppose you have a client side ES6 app that's in the `./client` sub-folder
of your ExpressJS project. Also, assume the bundled version is
available in the `./client/dist` folder.

* For production we want to serve `./client/dist`.  

* For development we 
want to serve `./client`.

First, import the middleware:

```js
import { bundleFree } from '@toptensoftware/bundleFree.js';
```

Next, install the middleware as follows:

```js
if (process.env.NODE_ENV == "production")
{
    // Production, serve bundled app
    app.use(express.static(path.join(__dirname, "client/dist")));
}
else
{
    // Development, serve unbundled app
    app.use(bundleFree({

        // The location of the unbundled client app
        path: path.join(__dirname, "client"),

        // Modules to be made available to the unbundled app
        modules: [ 
            '@toptensoftware/module1',
            '@toptensoftware/module2'
        ]

    }));
}
```

Now, in your client side `.js` files you can directly reference any
modules listed in the `modules` option.

```js
// Client side script files can now import directly from the bare
// module name:
import { * } from '@toptensoftware/module1';
```

Also, other resources in those modules can be accessed directly

```html
<link href="@toptensoftware/module2/style.css" type="text/css" rel="stylesheet" />
```

## How it Works

The middleware works as follows:

1. Any url path that starts with the name of one of the specified modules is re-written
   with a `node_modules` prefix.

   eg:
       `/@toptensoftware/module1` 
       
    becomes `/node_modules/@toptensoftware/module1`

2. An import map is generated for all listed modules and injected to the top of any
   `.html` file served from the client app folder.

   This lets us use bare module names in the browser.

   eg:
        
    ```html
    <script type="importmap">
    {
        "imports": {
            "@toptensoftware/module1": "/@toptensoftware/module1/./main.js",
            "@toptensoftware/module2": "/@toptensoftware/module2/./index.js"
        }
    }
    </script>
    ```

    Note: the name of the `.js` file is determined from each modules's `package.json` file `main` setting.

3. All files in the client app folder are served using Express' static file middleware

4. All files in the `node_modules` folder are served using Express' static file middleware
   mounted under `/node_modules`

## Using Vite

[Vite](https://vite.dev/) is a fast, modern bundler that for simple cases doesn't even need a configuration file.

The following shows how to setup package.json to build and run development and production versions of an ExpressJS app with a client side app structure similar to that described above.

```json
{

    // Other stuff omitted

    "scripts": {
        "build": "cd client && vite build",
        "dev": "node server",
        "prod": "bash -c \"npm run build && NODE_ENV=production node server\""
    },

    "devDependencies": {
        "vite": "^5.4.8"
    }

}
```

(Note: `bash` is used for the production command because it supports setting the `NODE_ENV` variable on the command line.  If running on Windows you'll need `bash` on your path, or some other way to launch the server)

To build or run:

* `npm run build` - bundles the client app
* `npm run dev` - runs the dev server
* `npm run prod` - bundles the client app and runs production mode server