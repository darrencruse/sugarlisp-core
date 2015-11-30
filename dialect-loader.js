// The requires below are to satisfy browserify
//
// Though they do run on node as well, the list of requires
// below are so browserify's static analysis knows to
// include these modules in the browser-bundle.
//
// They also make these modules require-able in the "load"
// function (requires in browserify only work if it's seen
// through static analysis of the file requires).
//
// You can comment unneeded ones to make browser-bundle smaller, or
// you can add additional if you've written your own language
// extension modules you need added in browser-bundle.
//
// note:  this needs to be improved on? - could it maybe become a
//   sugarlisp file that uses macros to expand a shorter/sweeter
//   "configuration-like" syntax into the code below?

// the language extension "dialect" modules to be included in the browser-bundle
require("sugarlisp-core");
require("sugarlisp-match");
require("sugarlisp-match/matchexpr");
require("sugarlisp-html");
//require("sugarlisp-css");
require("sugarlisp-async");
require("sugarlisp-sugarscript");
require("sugarlisp-csp");

/**
* load the specified dialect for use in a sugar source file.
* note: by convention language extensions are named "sugarlisp-<dialectName>"
*/
exports.load = function(dialectName) {

  var dialect;

  try {
    // by convention language extensions are named e.g. sugarlisp-core,
    // sugarlisp-async, etc. (just to organize them all together in npm)
    dialect = require('sugarlisp-' + dialectName);
  }
  catch(e) {
    console.log('Error loading dialect:', dialectName);
    console.log(e.message);
    console.log(e.stack);
    throw e;
  }

  return dialect;
}
