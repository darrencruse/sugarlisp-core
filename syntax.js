var sl = require('./sl-types'),
    reader = require('./reader'),
    utils = require('./utils'),
    ctx = require('./transpiler-context');

// float at start of source
exports['__core_float'] = {
  match: /-?[0-9][0-9.]+/g,
  // needs to go before standalone minus ("-")
  // and before integers (otherwise -10.5 would read as -10!!)
  priority: 90,
  read:
    function(source) {
      var token = source.next_token(/-?[0-9][0-9.]+/g);
      return sl.atom(parseFloat(token.text,10), {token: token});
    }
};

// integer at start of source
exports['__core_integer'] = {
  match: /-?[0-9]+/g,
  // needs to go before standalone minus ("-")
  priority: 80,
  read:
    function(source) {
      var token = source.next_token(/-?[0-9]+/g);
      return sl.atom(parseInt(token.text,10), {token: token});
    }
};

// core supports simple quoted strings
// (plus supports templated strings with ${} escapes)
function handleSimpleString(source, quoteChar) {
  return reader.read_delimited_text(source, quoteChar, quoteChar);
};
exports['\''] = handleSimpleString;
exports['\"'] = handleSimpleString;
exports['`'] = handleSimpleString;

exports["null"] = function(source) {
  return sl.atom(null, {token: source.next_token("null")});
};

exports["nil"] = function(source) {
  return sl.atom(null, {token: source.next_token("nil")});
},

exports["true"] = function(source) {
  return sl.atom(true, {token: source.next_token("true")});
};

exports["false"] = function(source) {
  return sl.atom(false, {token: source.next_token("false")});
};

// ellipses are used in macros and match patterns to match the "rest"
// we are using them es6 style meaning they prefix the argument name
exports['...'] = function(source) {
  // we just put it back together as a single atom:
  var ellipsisToken = source.skip_token('...');
  var argnameToken = source.next_word_token();
  return sl.atom('...' + argnameToken.text, {token: ellipsisToken});
};

// parenthesized list expressions
exports['('] = function(source) {
  return reader.read_delimited_list(source);
};
// read_delimited_list consumes the ending ")"
// so we don't expect it to be read thru the syntax table
exports[')'] = reader.unexpected;

exports[':'] = reader.unexpected;

exports[','] = reader.unexpected;

// '=' is an alias for 'set'
// (we treat 'get' and 'set' as our core commands for
// manipulating variables - everything else is syntax sugar)
exports['='] = reader.symbolAlias('set');

// arrow functions (in core only prefix though e.g. (=> (x) (* x x))
exports['=>'] = reader.symbol;

// method chaining
exports['->'] = reader.symbol;

// if? is the if expression (like a javascript ternary)
// note: unlike lisp, in sugarlisp plain "if" is a *statement*
exports['if?'] = reader.symbol;

// list-of is a list comprehension
exports["list-of"] = reader.symbol;

// '-' is a terminating char so declare these explicitly
exports['template-repeat-key'] = reader.symbol;
exports['template-repeat'] = reader.symbol;
exports['m-bind'] = reader.symbol;
exports['macro-export'] = reader.symbol;

// '#' is a terminating char so declare these explicitly
exports['#args-if'] = reader.symbol;
exports['#args-shift'] = reader.symbol;
exports['#args-second'] = reader.symbol;
exports['#args-rest'] = reader.symbol;
exports['#args-get'] = reader.symbol;
exports['#args-erase-head'] = reader.symbol;

exports['\\'] = reader.unexpected;

// compiler directives //////////////////////////////////////////////////

// use a dialect i.e. a "language extension"
// note: the main reason things like #use and #transpile are in the
//   syntax tables not the keyword ("transpile") tables is simply that
//   it's critical they take effect *early* in the transpile process
//   since they potentially effect even the read process.
exports['#use'] = function(source) {
  var useToken = source.skip_token('#use');
  var dialectName = reader.read(source);
  var dialect = reader.use_dialect(sl.valueOfStr(dialectName), source);

  // avoid blank lines in the output when no "on use code" is returned...
  if(dialect && dialect.onusecode && dialect.onusecode.length > 0 ||
    (dialect.onusecode &&
      dialect.onusecode.children && dialect.onusecode.children.length > 0)) {
      // they have some js code to insert at the point of #use
      // since we're a reader we'll return it as the (js..) form:
      var list = sl.list("js", dialect.onusecode);
      list.setOpening(useToken);
      return list;
  }

  // nope - nothing real to return
  // but there could be a "prelude" i.e. comments or whitespace
  // before the "#use" to passthru
  return reader.passthru_prelude(useToken);
};

// set/override transpile options
// these are the same options you can otherwise set on the command line
// note: this is esp. handy in atom preview where there's no command line
exports['#transpile'] = function(source) {
  source.skip_text('#transpile');
  // they're expected to give a json options object
  // if a lispy core file that means (object...) otherwise real json {...}
  var optforms = reader.read(source);
  if(Array.isArray(optforms) && optforms.length > 0 &&
    sl.typeOf(optforms[0]) === 'symbol' && sl.valueOf(optforms[0]) === 'object') {
    // set these into the transpile options all the files
    // get via the context module
    var options = ctx.evalExpression(optforms);
    utils.mergeOnto(ctx.options.transpile, options);
  }
  else {
    source.error("#transpile expects a json object as argument");
  }


  // nothing to generate we've done all that matters
  return reader.ignorable_form;
};

// they can put "#keyword" before a named function in their source
// file to make it available at compile time.  i.e. The function is
// called during compile much as macros are, but it receives and
// returns forms (just a built-in keyword function), and can use
// arbitrary code in creating those returned forms, unlike a macros
// which uses the quote/unquote declarative style.
exports["#keyword"] = function(source) {
  source.mark_rewind_point();
  source.skip_text('#keyword');
  // note that here we read through the reader, ensuring
  // that we get any enhancements to functions that may
  // exist in the active dialects
  var functionForm = reader.read(source);
  if(sl.isList(functionForm) &&
    sl.typeOf(functionForm[0]) === 'symbol' &&
    sl.valueOf(functionForm[0]) === "function" &&
    sl.typeOf(functionForm[1]) === 'symbol')
  {
    // this flag is recognized in the transpiler
    // as meaning this function will be eval'ed
    // and registered so it will work at compile
    // time just as if it had been a built-in
    // keyword.
    functionForm.__macrofn = true;
  }
  else {
    source.error("#keyword must precede a named function");
  }
  return functionForm;
}

// #if is for conditional code generation
exports['#if'] = reader.parenfree(2, {parenthesized: 1, bracketed: 2});

// #include is an alternative to lispyscript 1's original (include...)
exports['#include'] = reader.parenfree(1);

// #require is for requiring a module at read time (as opposed
// to run time).  It uses the require path as opposed to
// lispy's separate include path.
exports['#require'] = reader.parenfree(1);

// originally I had "?->" (thinking some macros are like e.g. num->string)
// the ">" caused trouble for the html dialect so it's been removed
// and the "-" causes trouble with pre and post decrement "--" so that's
// been removed too!!!
//exports.__nonterminatingchars = "?-";
exports.__nonterminatingchars = "?";

/**
* The default read function used when nothing in
* readtable or readrules matches the current token.
* (we just make a symbol from the next word)
*/
exports.__readdefault = reader.symbol;

/**
* The default read token function returns the
* textual token passed to readdefault.
*/
exports.__readdefaulttoken = function(source) {
  return source.next_word_token();
}
