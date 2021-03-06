'use strict';

var defaults = require("./defaults")
  , html = require("html")
  , utils = require("./utils")
  , BlockCompiler = require("./block")
  , Walker = require("./walker").Walker;

/* # Asynchronous block compiler

 Unlike `BlockCompiler`, `AsyncCompiler` accepts callback
 which will be invoked once the computation is finished.

 Each block is computed in event queue.
 */
var AsyncCompiler
  = module.exports
  = exports
  = function(options) {

  this.options = utils.merge(defaults.options, options);

};

/* Async compiler operates through `render` which accepts
`text` to render and callback, which is invoked once
the rendering is over:

```
var asyncCompiler = new AsyncCompiler();
asyncCompiler.render(myText, function(err, html) {
  // Do something with rendered HTML
});
```
*/
AsyncCompiler.prototype.render = function(text, done) {
  var block = new BlockCompiler(this.options);
  var walk = new Walker(text);
  this.nextTick(block, walk, done);
};

AsyncCompiler.prototype.nextTick = function(blockCompiler, walk, done) {
  if (walk.hasCurrent()) {
    blockCompiler.emitBlock(walk);
    process.nextTick(this.nextTick.bind(this, blockCompiler, walk, done));
  } else {
    done(null, blockCompiler.outToString());
  }
};


