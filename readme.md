# Bundle Free

BundleFree is an ExpressJS middleware that lets you, during development, 
use NPM packages in front-end web clients without a bundler but in a manner
that's compatible with bundling for production.

## About

BundleFree lets you build client side ES6 module apps that reference NPM 
packages directly using their bare names (ie: no `/` prefix or `.js` suffix).

This means you can write your client side scripts and serve them directly
from your ExpressJS server without needing to run a bundler.

Notes: 

* this is only intended to be used during development. For production you
  should still use a bundler. 

* this is not a browserification tool and only works for NPM packages designed
  to work in browsers in the first place.


## The Problem

Without bundling, ES6 modules typically need to be referenced
on the client side as follows:

```js
import * from "/somefolder/somefile.js"
```

Note:

* The import path must start with a relative specifier (`.`, `/` etc...) - the browser requires this unless there's an import map, and 
* The import path must end with `.js` because web-servers don't typically append `.js` when serving static files.

To make NPM packages available client side, we could make the `node_modules` folder available using ExpressJS's static middleware:

```js
app.use("/node_modules", express.static(path.join(__dirname, "node_modules")));
```

and then reference them client side as:

```js
import * from "/node_modules/@toptensoftware/module1/index.js"
```

This works, but when it comes time to bundle for distribution, the bundler isn't going to understand import directives and prefers the bare name of the module:

```js
import * from "@toptensoftware/module1"
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

* For development we want to serve `./client`.

(Obviously, you can adjust paths to suit your project).

First, import the middleware:

```js
import { bundleFree } from '@toptensoftware/bundle-free.js';
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
    app.use(bundleFree({

        // The location of the unbundled client app
        path: path.join(__dirname, "client"),

        // Modules to be made available to the unbundled app
        modules: [ 
            '@toptensoftware/codeonly',
            '@toptensoftware/framework'
        ],

    }));
}
```

Now, in your client side `.js` files you can directly reference any
modules listed in the `modules` option.

```js
// Client side script files can now import directly from the bare
// module name:
import * from '@toptensoftware/module1';
```

Also, other resources in those modules can be accessed directly

```html
<link href="@toptensoftware/module2/style.css" type="text/css" rel="stylesheet" />
```

## Mounting in a sub-folder

To mount the app on a public sub-path include a `prefix` setting in the options.

```js
    app.use(bundleFree({

        // The location of the unbundled client app
        path: path.join(__dirname, "client"),

        // Include prefix on the generated import map
        prefix: "/myapp"

        // Modules to be made available to the unbundled app
        modules: [ 
            '@toptensoftware/module1',
            '@toptensoftware/module2'
        ]

    }));
```

## Single Page Apps

For single page apps that use the browser history API for navigation need to serve 
the main `index.html` file for any URL that doesn't match a file in the client 
directory.  (This allows the single-page app to handle full URL's client side such 
as when refreshing the page in the browser).

eg: if the page `http://somesite.com/myapp/products/productname` should be handled by 
    the single page app at `/myapp/index.html`

To support this, set the `spa` property to true:

```js
    app.use(bundleFree({

        // The location of the unbundled client app
        path: path.join(__dirname, "client"),

        // Include prefix on the generated import map
        prefix: "/myapp"

        // Serve URLs that don't match a file as index.html
        spa: true;

        // Modules to be made available to the unbundled app
        modules: [ 
            '@toptensoftware/module1',
            '@toptensoftware/module2'
        ]

    }));
```

Since you probably want this same behaviour for the production release, you can use
bundle-free without the module remapping:

```js
    app.use(bundleFree({
        path: path.join(__dirname, "client/dist"),
        spa: true,
        prefix: "/myapp",
    }));
```

Finally, if the `/myapp/index.html` file references relative files you'll probably
want to make them absolute too (otherwise they won't work in sub-path urls).

eg: suppose `index.html` references `./main.js`, this won't work for a single page 
app url at `/myapp/sub/sub/page` because `/myapp/sub/sub/main.js` doesn't exist.

We can't just use an absolute URL in the index.html file because then the
bundler won't find it.

Use the `replace` option to work around this:

```js
    replace: [
        { from: "./main.js", to: "/myapp/main.js" }
    ],
```

`from` can be a string or regular expression.

## How it Works

The middleware works as follows:

1. An import map is generated for all listed modules and injected to the top of any
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

    Also anything in the .html file that starts with a module name is prefixed with `/node_modules`.

2. All files in the client app folder are served using Express' static file middleware.

3. All files in the `node_modules` folder are served using Express' static file
   middleware mounted under `/node_modules` (so re-written URLs from step 1 above
   are served)


## Complete Example

Here's a complete example that supports production, development, single-page app
mode and is mounted in a sub-path prefix:

```js
if (process.env.NODE_ENV == "production")
{
    app.use(bundleFree({
        path: path.join(__dirname, "client/dist"),
        spa: true,
        prefix: "/myapp",
    }));
}
else
{
    app.use(bundleFree({
        path: path.join(__dirname, "client"),
        spa: true,
        prefix: "/myapp",
        modules: [ 
            '@toptensoftware/module1',
            '@toptensoftware/module1'
        ],
        replace: [
            { from: "./main.js", to: "/app/main.js" }
        ],
    }));
}
```


## Using Vite

[Vite](https://vite.dev/) is a fast, modern bundler that for simple cases doesn't even need a configuration file.

The following shows how to setup `package.json` to build and run development and production versions of an ExpressJS app with a client side app structure similar to that described above.

* `npm run build` - bundles the client app
* `npm run dev` - runs the dev server
* `npm run prod` - bundles the client app and runs production mode server

```json
{

    // Other stuff omitted

    "scripts": {
        "build": "cd client && vite build --base=/myapp/",
        "dev": "node server",
        "prod": "bash -c \"npm run build && NODE_ENV=production node server\""
    },

    "devDependencies": {
        "vite": "^5.4.8"
    }

}
```

(Note: `bash` is used for the production command because it supports setting the `NODE_ENV` variable on the command line.  If running on Windows you'll need `bash` on your path, or some other way to launch the server)


