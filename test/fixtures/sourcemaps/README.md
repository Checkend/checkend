# Source map fixtures

`app.min.js` and `app.min.js.map` are the minified bundle of `src/cart.ts`, made once with
esbuild 0.28.2:

```sh
npx esbuild test/fixtures/sourcemaps/src/cart.ts --bundle --minify --sourcemap \
  --format=iife --global-name=shop --sources-content=true \
  --outfile=test/fixtures/sourcemaps/app.min.js
```

The files are committed, so the tests do not depend on esbuild. Make them again only when the
tests need a change, and update the positions in the tests.
