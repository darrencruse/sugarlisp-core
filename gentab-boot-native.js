/**
 * The foundational keywords needed for bootstrapping the compile
 * of a SugarLisp core file
 */

var macros = require('./macro-expander'),
    sl = require('./sl-types'),
    debug = require('debug')('sugarlisp:core:keywords:debug'),
    trace = require('debug')('sugarlisp:core:keywords:trace');
    match = require('sugarlisp-match/pattern-match');

/**
 * Compiled macro = Generate a macro (expanding) function
 *
 * This is a function which, when called later with a form tree,
 * expands the code using the macro definition's argument template
 * and expansion code template.
 *
 * note:  as with most Lisps, SugarLisp allows characters such as
 *  "?", "=", "->", etc. as part of the macro name.  To support that,
 *  only *anonymous* macro functions are generated.  This is because
 *  a property assigned to an anonymous function can have such
 *  characters, whereas in languages such as javascript a *named*
 *  function cannot.
 */
exports["macro"] = function(forms) {

    if (forms.length != 3 && forms.length != 4)  {
      forms.error("malformed expression:  \"macro\" takes an (optional) name, followed by argument list then body");
    }

    var mName, mArgs, mBody
    var pos = 1;

    if(sl.typeOf(forms[pos]) === 'symbol') {
      // a named macro
      mName = forms[1];
      pos++;
    }

    if(Array.isArray(forms[pos])) {
      // macro arguments
      mArgs = forms[2]
      pos++;
    }
    else {
      forms.error("\"macro\" takes an (optional) name, followed by argument list then body");
    }

    // macro body
    mBody = forms.slice(pos)

    var generated = sl.generated();
    generated.push(["function(forms) {\n"]);
    generated.push(["  var macrodef = ", sl.pprintJSON(forms.toJSON(), {}, 9), ";\n"]);
    generated.push( "  return this.macroexpand(forms, macrodef);\n");
    generated.push("}");
    //this.noSemiColon = true

    // named macros are available immediately in the file they're defined in:
    if(mName) {
      // this tells the transpiler to eval this code and register it as a keyword
      generated.__macrofn = true;
    }

    // an anonymous macro is only useful when compiling macros to
    // to code - return the code for this macro function so it can be
    // written to the output file.
    return generated
}

function inlineJs(forms) {
    if (forms.length != 2)  {
      forms.error("a single string containing javascript is required");
    }

// I THOUGHT I SHOULD ALLOW E.G. (js "console.log('hello ${name}')") BUT
// THIS IS NOT AS IT SEEMS - THIS WAS PRODUCING CODE THAT WOULD JOIN THOSE
// PARTS ('hello' and name) AT RUNTIME.  BUT OUR GOAL HERE WOULD BE THAT
// console.log IS GENERATED TO OUR OUTPUT CODE - YET ITS NOT AS SIMPLE AS
// EVALING IT EITHER - NOTE THAT name IS AN UNQUOTED SYMBOL IT CANT BE
// EVALED AT COMPILE TIME!!  MAYBE THIS IS WHERE QUOTE AND QUOTE WOULD
// HELP, OR MAYBE THERE'S ACTUALLY A DIFFERENT TEMPLATE STRING SYNTAX
// NEEDED JUST FOR OUTPUTTING CODE - THATS WHAT I WAS PLANNING BEFORE.
// ALSO NOTE - YOU'RE TALKING ABOUT TEMPLATE STRINGS HERE IN JS - BUT
// THIS IS CORE AND TEMPLATE STRINGS LIVE IN PLUS!!
    var code = (sl.typeOf(forms[1]) === 'string' ?
                sl.generated(sl.valueOfStr(forms[1])) :
                sl.typeOf(forms[1]) === 'symbol' ?
                  sl.generated(sl.valueOf(forms[1])) :
                  forms[1]);

    // leave these decisions in the hands of the inlined javascript:
// THE PROBLEM HERE IS THAT THIS NO SEMI NO NEWLINE STUFF IS AFFECTING OTHER STUFF
// ISN'T IT A DESIGN FLAW THAT THESE FLAGS AREN'T *ON* THE GENERATE CODE ITSELF
// THEN IT SHOULD BE THE JOB OF TRANSPILED.TOSTRING TO INTELLIGENTLY INSERT
// PUNCTUATION AND PRELUDES!!
//    this.noSemiColon = true;
//    this.noNewline = true;

    code.noSemiColon = true;
    return code;
}

// now support a shorter "js" variant (used e.g. in the async macros).
// WHETHER THIS STAYS IS TBD
exports["javascript"] = inlineJs;
exports["js"] = inlineJs;

// the no-op form exists for the sole reason of having something
// to hang whitespace or comments on when the form that follows
// doesn't generate any code.  These are scrubbed from the
// pretty-printed parse trees btw since they're ugly and don't
// add any value.

exports["nop"] = function(forms) {

    // intentionally not checking the number of args -
    // since people might might wish to stick "nop" at
    // the front of an expression to disable it
    this.noSemiColon = true;
    this.noNewline = true;
    return sl.generated();
}

/**
* export is just a convenience for exporting from a module
* A little shorter than using "set" and you can use a symbol
* without quotes (as opposed to a quoted string) if you like.
* note: this is here instead of in a macro file because
*   it's used to bootstrap the core "macros.slisp" file before
*   macros are actually working!
*/

exports["export"] = function(forms) {
  var macrodef = ["macro",
                    ["symbol", "value"],
                    ["set",
                      ["~",
                        ["js", "\"return symbol.toQuotedString();\""]], "exports",
                      ["~", "value"]]];
  return this.macroexpand(forms, macrodef);
};

/*
 * set started as compiled sugarlisp code, but got pulled in
 * here to avoid some chicken-and-egg issues
 */
function handleSet(setFnName) {
  return function() {
    var args = Array.prototype.slice.call(arguments);
    return match(args, function(when) {
      when([
          function(sym) {
            return sym.value === setFnName;
          },
          match.var("key", match.any),
          match.var("arrayname", match.any),
          match.var("valexpr", match.any)
        ],
        function(vars) {
          return (function(key, arrayname, valexpr) {
            return sl.generated([
              this.x(arrayname), "[", this.x(key), "] = ", this.x(valexpr)
            ]);
          }).call(this, vars["key"], vars["arrayname"], vars["valexpr"]);
        }, this);
      when([
          function(sym) {
            return sym.value === setFnName;
          },
          match.var("varexpr", match.any),
          match.var("valexpr", match.any)
        ],
        function(vars) {
          return (function(varexpr, valexpr) {
            return sl.generated([
              this.x(varexpr), " = ", this.x(valexpr)
            ]);
          }).call(this, vars["varexpr"], vars["valexpr"]);
        }, this);
      when([
          match.var("any", match.lsdefault)
        ],
        function(vars) {
          return (function(any) {
            return this.error('invalid arguments for ' + setFnName);
          }).call(this, vars["any"]);
        }, this);
    }, this)
  };
}

// lispy (set var val)
exports["set"] = handleSet("set");
// and let (= var val) work the same as (set var val)...
exports["="] = handleSet("=");
