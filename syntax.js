var sl = require('./types'),
    reader = require('./reader'),
    rfuncs = require('./readfuncs'),
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
exports['#if'] = reader.parenfree(2, "#if");

// #include is just an alternative to lispyscript 1's
// original (include...), which remains available as well.
exports['#include'] = reader.parenfree(1, "include");

// #require is for requiring a module at read time (as opposed
// to run time).  It uses the require path as opposed to
// lispy's separate include path.
exports['#require'] = reader.parenfree(1, "#require");

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

// the dot operator for property lookup
/*
OLD ONE TO BE DELETED
exports['.'] = function(source) {
  var form;
  // Are we *already* in prefix position?
  if(!source.lastReadFormInList) {
    // yes - they're using the form (.y x)
    // (there's transpiler code that recognizes ".y" specially)
    var dotToken = source.skip_token('.');
    var dotPropToken = source.next_word_token();
    form = sl.atom('.' + dotPropToken.text, {token: dotToken});
  }
  else {
    // nope - swap (x . y) to (. x y)
    // (there's a "." keyword that generates js code x.y)
    form = reader.infixtoprefix(source, '.');
  }

  return form;
};
*/

// DELETE exports['.'] = reader.infix(1);

// the infix dot operator for property lookup
// note that we encourage use of infix dot since it's so familiar
// to javascript programmers i.e. (console.log "hello"), but for
// backward compatibility with lispyscript 1 (and other lisps
// which have similar constructs), this also accepts property prefix
// forms like e.g. (.log console "hello").  Since we normally consider
// . an infix operator though - to get the "property prefix" version
// you *must* omit the space between the "." and the property.  Which
// is to say "(.log console)" represents "console.log", but
// "(. log console)" (note the space after the dot) represents
// "log.console".
//
// lastly notice we leave infix "." as "." but we change dot property
// access to a different prefix "dotprop".  So console.log becomes
// (. console log) but .log console becomes (dotprop log console)


exports['.'] = reader.operator({
  prefix: reader.operator('prefix', 'unary', dotpropexpr, 5),
  infix: reader.infix(19)
});

function dotpropexpr(source, opSpec, dotOpForm) {
  var propertyNameToken = source.next_token();
  var objectForm = reader.read(source, opSpec.precedence);
  return sl.list('dotprop', propertyNameToken, objectForm);
}

/**
* A tree transformer that translates a dot property access i.e. like e.g.
*   (.log console ~message)
* but only *after* the operations with lower precedence levels have applied.
* i.e. in our example the "~" in "~message" is translated to (~ message)
* *before* we run, which ensure we windup (console.log <message>) not
* (console.log ~).  These issues become even more important in more complex
* examples consider e.g. "(.log console ~error.message)" where the precedence
* of both the "~" and "." come into play.
*
* note:  dot property access is mainly for backward compatibility. Feel free
*   to use infix dot instead i.e. (console.log ~error.message) is absolutely
*   fine in sugarlisp.
*/
function dotptransform(dotpropAtom) {
  var containingList = dotpropAtom.parent;
  if(containingList.length !== 3) {
    if(containingList.length > 3) {
      // they didn't use parens - make a new parenthesized list
      // from the dotprop property object part of the parent list
      var listPos = containingList.indexOf(dotpropAtom);
      var dotpropList = sl.list(dotpropAtom,
                              containingList[listPos + 1],
                              containingList[listPos + 2]);
      containingList.splice(listPos,3, dotpropList);
      dotpropList.parent = containingList;
    }
    else {
      dotpropAtom.error("dot property access requires a property and an object");
    }
  }
}

// DELETE exports['.'] = reader.infix(1);

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
  return rfuncs.read_delimited_list(source);
};
// read_delimited_list consumes the ending ")"
// so we don't expect it to be read thru the syntax table
exports[')'] = reader.unexpected;

// square bracketed arrays of data
exports['['] = function(source) {
  return rfuncs.read_array(source);
};
// end brackets are read as token via the function above
// (so they're not expected to be read via the syntax table)
exports[']'] = reader.unexpected;

// javascript object literals
exports['{'] = function(source) {
  return rfuncs.read_objectliteral_or_codeblock(source);
};
exports['}'] = reader.unexpected;

exports[':'] = reader.unexpected;

exports[','] = reader.unexpected;

// templated strings with ${} escapes
// unlike es6 we let them work within all of ', ", or `
// if no ${} are used it winds up a simple string
// but when ${} are used the result is a (str...)
exports['\''] = function(source) {
  return rfuncs.read_template_string(source, "'", "'", ['str']);
};

exports['\"'] = function(source) {
  return rfuncs.read_template_string(source, '"', '"', ['str']);
};

// es6 template string literal
exports['`'] = function(source) {
  // a template string surrounded in backticks becomes (str...)
  return rfuncs.read_template_string(source, "`", "`", ['str']);
};

// arrow functions
// note precedence level less than "=" so e.g. "fn = (x) => x * x" works right
// also note this was originally just exports['=>'] = reader.infix(12.5);
// but the below was done to simplify the generated code and avoid one IIFE
// OLD exports['=>'] = reader.operator(arrowFnTransform, 7.5, 'infix', 'binary');
exports['=>'] = reader.operator('infix', 'binary', arrow2prefix, 7.5);

function arrow2prefix(source, opSpec, argsForm, arrowOpForm) {

  var fBody = reader.read(source, opSpec.precedence);
  if(sl.isList(fBody) && sl.valueOf(fBody[0]) === 'do') {
    fBody[0].value = "begin";
  }

  return sl.list(arrowOpForm, argsForm, fBody);
}

/*
DELETE
function(source, text) {
  var arrowToken = source.next_token(text);
  return sl.atom(text, {token: arrowToken, transform: {
            type: 'binary',
            fn: arrowFnTransform,
            precedence: 12.5
          }});
}
reader.registerDynamicTransform('binary', exports['.']);
*/

/*
OLD
function arrowFnTransform(arrowAtom, transformopts) {
  var containingList = arrowAtom.parent;
  var listPos = containingList.indexOf(arrowAtom);
  if(listPos + 1 < containingList.length) {
    var rhs = containingList[listPos + 1];
    if(sl.isList(rhs) && sl.valueOf(rhs[0]) === 'do') {
      rhs[0].value = "begin";
    }
  }
  else {
    arrowAtom.error("arrow function missing right hand side");
  }
  return reader.infix2prefix(arrowAtom, transformopts);
}
*/

// disambiguate / for div versus regexes
// see .e.g.
//   http://stackoverflow.com/questions/5519596/when-parsing-javascript-what-determines-the-meaning-of-a-slash
/*
DELETE
exports['/'] = function(source, text) {

  var slashyregex = function(source) {
    var matched;
    // note the "last token" chars are those used by jslint
console.log("IN SLASHYREGEX lastToken is:", source.lastToken.text);
    if (source.on("/") && (source.lastToken &&
        "(,=:[!&|?{};".indexOf(source.lastToken.text) !== -1))
    {
      matched = source.peek_delimited_token("/");
      if(matched) {
        matched = matched.text;
      }
    }
    return matched;
  };

  if(slashyregex(source)) {
    // desugar to core (regex ..)
    return sl.list("regex",
                  sl.addQuotes(sl.valueOf(rfuncs.read_delimited_text(source, "/", "/",
                    {includeDelimiters: false}))));
  }
  else {
    // this was just a plain old '/' by itself
    return reader.symbol(source, text);
  }
}
*/

// regexes in the form #/../
// this is a shorthand for (regex "(regex string)")
// note this is close to javascript's "/" regexes except for starting "#/"
// the initial "#" was added to avoid conflicts with "/"
// (the "#" is optional in scripty btw)
exports['#/'] = function(source, text) {
  // desugar to core (regex ..)
  return sl.list("regex",
                sl.addQuotes(sl.valueOf(rfuncs.read_delimited_text(source, "#/", "/",
                  {includeDelimiters: false}))));
}

// coffeescript style @ (alternative to "this.")
exports['@'] = function(source) {
  source.skip_text('@');
  var nextForm = reader.read(source);
  if(sl.isList(nextForm) && sl.typeOf(nextForm[0]) === 'symbol') {
    // this is losing the original line/col - need to correct
    nextForm[0] = sl.atom("this." + nextForm[0].value);
  }
  else if(sl.typeOf(nextForm) === 'symbol') {
    // this is losing the original line/col - need to correct
    nextForm = sl.atom("this." + nextForm.value);
  }
  else {
    source.error("@ must precede the name of some object member");
  }

  // we've read the next form and prefixed it with "this.":
  return nextForm;
}

// lispy quasiquoted list
// THIS STILL HAS WORK TO DO - IT'S REALLY JUST AN ALIAS FOR [] RIGHT NOW
//
// these use ` like a traditional lisp except they are bookended
// on both ends i.e. `(...)`.  It felt odd to do otherwise because
// all our other (string) quoting follows javascript conventions
// so has them on both ends.
//
// note we *only* support the quasiquoting of lists.
//
// since we also support es6 template string literals which use
// `` to quote them, the paren in `( distinguish a quasiquoted
// list *form* from a standard es6 template *string*.
//
// If people need to quote a *string* that starts with ( they
// should just use '(...)' or "(...)" instead.
//
exports['`('] = function(source) {
  return rfuncs.read_delimited_list(source, '`(', ')`', ["quasiquote"]);
};
exports[')`'] = reader.unexpected

// this may be temporary it's just an alias for arrays []
// (it should be just a normal quoted list - working on that)
exports['``('] = function(source) {
  return rfuncs.read_delimited_list(source, '``(', ')``', ["array"]);
};
exports[')``'] = reader.unexpected

// a js code template (javascript string with substitutions) is
// surrounded in triple double-quotes
exports['"""'] = function(source) {
  var forms = rfuncs.read_template_string(source, '"""', '"""', ['code']);
  // read_template_string converts to a normal string if there's only one:
  if(!sl.isList(forms)) {
    forms = sl.list('code', forms);
  }
  return forms;
};

// a lispy code template (lispy code with substitutions) is
// surrounded in triple single-quotes
exports["'''"] = function(source) {
  return rfuncs.read_delimited_list(source, "'''", "'''", ["codequasiquote"]);
};

// Gave unquotes an extra ~ for now while I get them working
// (so they wouldn't break the macros)
exports['~~'] = function(source) {
  source.skip_text('~~');
  return sl.list('unquote', reader.read(source));
};

exports['~~@'] = function(source) {
  source.skip_text('~~@');
  return sl.list('splice-unquote', reader.read(source));
};

// Make sure '~' and '~@' are read *with* what follows them
// i.e. "~arg", "~@list" should be read as single tokens not multiple
// note: javascript bitwise not "~" is not supported yet.
/*
exports['~'] = function(source) {
  var form;
  // a rest... style marker
  // if(source.on(/~@?(?:\.\.\.)?[_a-zA-Z]+[_a-zA-Z0-9]*(?:\.\.\.)?/g)) {
  //   var nextToken = source.next_token(/~@?(?:\.\.\.)?[_a-zA-Z]+[_a-zA-Z0-9]*(?:\.\.\.)?/g);
  //   form = sl.atom(nextToken);
  // }
  // // a regular marker with up to two (optional) sub-properties e.g. ~attr.elem.value
  // else if(source.on(/~@?[_a-zA-Z]+\.?[_a-zA-Z0-9]*\.?[_a-zA-Z0-9]*XXXX/g)) {
  //   var nextToken = source.next_token(/~@?[_a-zA-Z]+\.?[_a-zA-Z0-9]*\.?[_a-zA-Z0-9]*XXXX/g);
  //   form = sl.atom(nextToken);
  // }
  // else {
    // var nextToken = source.next_token('~');
    // form = sl.atom(nextToken);
  // }
/* DELETE THIS COMMENT
  var unquoteToken = source.next_token('~');
  form = sl.list(sl.atom(unquoteToken), reader.read(source, {noinfix: true}));

  return form;
}

exports['~@'] = function(source) {
  var splicingUnquoteToken = source.next_token('~@');
  return sl.list(sl.atom(splicingUnquoteToken), reader.read(source));
}
*/

exports['~'] = reader.prefix(19.5);
exports['~@'] = reader.prefix(19.5);

// although basic "word-style" (whitespace) delimiting
// works well in lispy core, declaring symbols explicitly
// avoids problems arising with the syntax sugar of lispy+
exports['!'] = reader.prefix(18, {assoc: "right"});
exports['->'] = reader.symbol;

// ++i and i++
exports['++'] = reader.operator({
  prefix: reader.prefix(17, {assoc:"right"}),
  postfix: reader.postfix(18, {altprefix: "post++"})
});

// --i and i--
exports['--'] = reader.operator({
  prefix: reader.prefix(17, {assoc:"right"}),
  postfix: reader.postfix(18, {altprefix: "post--"})
});

// '-' is a terminating char so declare these explicitly
exports['template-repeat-key'] = reader.symbol;
exports['template-repeat'] = reader.symbol;
exports['m-bind'] = reader.symbol;
exports['macro-export'] = reader.symbol;

// '#' is a terminating char so declare these explicitly
exports['#args-if'] = reader.symbol;
exports['#args-shift'] = reader.symbol;
exports['#args-second'] = reader.symbol;

// variable_ is a paren free var -
//  this is really just a helper function,
//  it's used by #cell below as well as
//  by "var" in scripty
// NO LONGER USING THIS IN SCRIPTY NOW THAT I SUPPORT multiple
// COMMA SEPARATED VARS - NEED TO SEE IF IT MAKES SENSE TO MERGE
// THEM TOGETHER NOT SURE YET

exports['variable_'] = function(source, text) {
  var varToken = source.next_token(text);
  var varNameToken = source.next_token();
  var varNameSym = sl.atom(varNameToken);

// SEEING IF I CAN SIMPLIFY THIS BACK TO ALLOWING SIMPLE ARRAYS
// MY THOUGHT WAS SIMPLY THAT IMMEDIATELY UPON THE
// READER RECEIVING THE RETURN VALUE FROM CALLING THESE
// SYNTAX FUNCTIONS IT CHECKS IF IT'S GOT AN ARRAY RATHER
// THAN A lists.List TYPE, AND IF SO IT CALLS lists.fromArray()
// TO PROMOTE THE ARRAY TO A LIST.  AS PART OF THAT IT
// IS ALSO GOING TO HAVE TO PROMOTE ALL THE PRIMITIVES TO
// BEING WRAPPED - *IF* I NEED TO ALSO IMMEDIATELY SET
// PARENTS TOO.  BUT IS THAT NEEDED?  COULD I GET BY
// WITH SAYING PARENTS ARE ONLY AVAILABLE IN THE keyword
// FUNCTIONS NOT THE READER FUNCTIONS?  BUT I DO USE PARENTS
// TO FIND SURROUNDING LOCAL DIALECTS RIGHT?  IF THERE any
// WAY THIS COULD HAVE WORKED DIFFERENTLY?  WHAT IF I'D done
// THE "ENVIRONMENT" IDEA LIKE AN INTERPRETER WOULD?  COULD
// THE "DIALECTS" HAVE BEEN TREATED LIKE A VAR IN THE "ENVIRONMENT"
// *INSTEAD* OF ON THE "FORMS"??
  var list = sl.list(sl.atom("var", {token: varToken}), sl.atom(varNameToken));
  // if(source.on('=')) {
  //   // it's got an initializer
  //   source.skip_text('=');
  //   list.push(reader.read(source));
  // }
  // else {
  //   list.push("undefined");
  // }

  return list;
};

// cells can cause reactions when their values change
// a cell can be declared via:
//
//    #cell name
// or
//    #cell name = val
//
// (note right now you can only declare one variable per #cell statement)
exports['#cell'] = function(source, text) {
  // #cell is like "var" except it records the var as observable
  // so start by making a normal "var" form list i.e. (var varname...)
  var varForm = exports["variable_"](source, text);

  // since sugarlisp doesn't pay attention to the scope of
  // the var statements it transpiles, #cell variable names are
  // considered global to the source file - this list is what's
  // checked by #before/#after to confirm the variable is a cell:
  var varname = sl.valueOf(varForm[1]);
  if(source.cells.indexOf(varname) === -1) {
    source.cells.push(varname);
  }

  // return the var form so a "var" statement winds up in the output code
  return varForm;
};

// binding assignment works with bindable vars
// invoke the reactor function "after" with #=
// (this is the version I assume would most often be used)
exports['#='] = reader.infix(7, {altprefix: "#afterset"});
// invoke the reactor function "before" with ##=
exports['##='] = reader.infix(7, {altprefix: "#beforeset"});

exports['\\'] = reader.unexpected;

// originally I had "?->" (thinking some macros are like e.g. num->string)
// the ">" caused trouble for the html dialect so it's been removed
exports.__nonterminatingchars = "?-";

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
