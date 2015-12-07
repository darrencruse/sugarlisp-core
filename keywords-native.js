/**
 * Keywords of the core SugarLisp language
 */

var reader = require('sugarlisp-core/reader'),
    sl = require('./types'),
    utils = require('./utils'),
    debug = require('debug')('sugarlisp:core:keywords:info'),
    trace = require('debug')('sugarlisp:core:keywords:trace');

exports["var"] = function(forms) {
    if (forms.length < 2) {
      forms.error("missing variable name for var?");
    }
    if (forms.length > 3) {
        this.indent += this.indentSize
    }
    this.transpileSubExpressions(forms)
    var transpiled = sl.transpiled()
    transpiled.push(sl.atom("var", {token:forms[0]}));
    transpiled.push(" ");

    for (var i = 1; i < forms.length; i = i + 2) {
        if (i > 1) {
            transpiled.push(",\n" + " ".repeat(this.indent))
        }
        var validName = /^[a-zA-Z_$][0-9a-zA-Z_$]*$/;
        if (!validName.test(sl.valueOf(forms[i]))) {
          sl.sourceOf(forms[i]).error("Invalid character in var name", forms[i]);
        }
        transpiled.push(forms[i]);
        if(i+1 < forms.length) {
          transpiled.push([' = ', forms[i + 1]])
        }
    }
    if (forms.length > 3) {
        this.indent -= this.indentSize
    }

    return transpiled;
}

exports["return"] = function(forms) {
    var transpiled = sl.transpiled("return");
    if(forms.length > 1) {
      transpiled.push(" ");
      transpiled.push(sl.isList(forms[1]) ? this.transpileExpression(forms[1]) : forms[1]);
    }
    return transpiled;
}

function handleFuncs(forms) {
    var transpiled = sl.transpiled();
    var fName, fArgs, fBody;

    if (forms.length < 2) {
      forms.error("missing arguments:  function declarations require an argument list and function body");
    }

    // fType = is this a regular "function",
    // a generator "function*",
    // an arrow function "=>"?
    var fType = sl.valueOf(forms[0]);

    if(sl.isList(forms[1])) {
        // an anonymous function
        fArgs = forms[1];
        fBody = forms.slice(2);
    }
    else if(!sl.isList(forms[1]) && sl.isList(forms[2])) {
        // a named function
        fName = forms[1];
        fArgs = forms[2];
        fBody = forms.slice(3);
    }
    else {
      forms.error("function declarations require an argument list and function body");
    }

    // Was the body wrapped in (begin..) ?
    // (e.g. the {} in arrow funcs like () => {} is translated to a (begin..))
    if(fBody.length > 0 &&
        sl.typeOf(fBody[0][0]) === 'symbol' &&
        fBody[0][0].value === "begin") {
      fBody = fBody[0]; // unwrap the body
      fBody.shift();    // remove "begin"
    }

    transpiled.push(sl.atom(fType === "function*" ? fType : "function"), {token:forms[0]});
    if(fName) {
      transpiled.push([" ", fName]);
    }
    transpiled.push("(");
    var transpiledArgs = sl.transpiledFromArray(fArgs);
    transpiledArgs.join(",");
    transpiled.push(transpiledArgs);

    var bodyCode = this.transpileExpressions(fBody);
    var bodyCodeStr = bodyCode.toString();

    // note we push bodyCode (not bodyCodeStr) to preserve line/col info
    transpiled.push([
        ") {",
        /^[\ \t]*\n/.test(bodyCodeStr) ? "" : "\n", bodyCode,
        /\n[\ \t]*$/.test(bodyCodeStr) ? "" : "\n",
        " ".repeat(this.indent), "}"])
    if(fType === "=>" && transpiled.toString().indexOf("this") !== -1) {
      // it's an arrow function using "this" - bind "this" since
      // arrow functions are lexically scoped - but not if it's an
      // object method ("this" is already the object in that case)
      if(!(forms.parent && sl.isList(forms.parent) &&
        sl.typeOf(forms.parent[0]) === 'symbol' && sl.valueOf(forms.parent[0]) === 'object'))
      {
        transpiled.push(".bind(this)");
      }
    }

    if(fName) {
      // our output has been really scrunched together
      // aid readability with a little white space
// THIS CAUSES SOME FORMATTING ISSUES IN SOME CASES     transpiled.unshift("\n");
      transpiled.push("\n");
      // and named functions don't terminate with semis:
      this.noSemiColon = true;
    }
    return transpiled;
}

// named and anonymous functions
exports["function"] = handleFuncs;

// es6 generator functions
exports["function*"] = handleFuncs;

// es6 arrow functions
exports["=>"] = handleFuncs;

// es6 yield expressions
function handleYield(forms) {
    var yieldType = sl.valueOf(forms[0]); // "yield" or "yield*"
    if (forms.length != 2) {
      forms.error(yieldType + " expects a single expression");
    }
    this.indent += this.indentSize;
    this.transpileSubExpressions(forms);

    var transpiled = sl.transpiled();
    transpiled.push([yieldType, " ", forms[1]]);
    this.indent -= this.indentSize;
    return transpiled;
}

exports["yield"] = handleYield;
exports["yield*"] = handleYield;

exports["try"] = function(forms) {
    if (forms.length < 3) {
      forms.error("try requires one or more expressions followed by a catch expression");
    }
    var c = forms.pop(),
        ind = " ".repeat(this.indent),
        transpiled = sl.transpiled();

    transpiled.push(["(function() {\n" + ind +
           "try {\n", this.transpileExpressions(forms.slice(1)), "\n" +
           ind + "} catch (e) {\n" +
           ind + "return (", (sl.isList(c) ? this.transpileExpression(c) : c), ")(e);\n" +
           ind + "}\n" + ind + "})()"])

    return transpiled;
}

exports["throw"] = function(forms) {
    if (forms.length != 2)  {
      forms.error("missing target to be thrown");
    }
    var transpiled = sl.transpiled();

    transpiled.push(sl.isList(forms[1]) ? this.transpileExpression(forms[1]) : forms[1]);
    transpiled.unshift("(function(){throw ");
    transpiled.push(";})()");

    return transpiled;
}

/**
* transpile time "#if" condition for including/omitting code from the output
* note the expression in the condition is evaluated at *transpile time*
* Also #if (as with the other # directives) is paren free, taking two args:
* a condition in parens followed by the code to be transpiled or not (can
* be a single expression otherwise wrap in {}).  Note #if does not support
* an "else" (negate your condition with a second #if when you need an "else")
* TBD IS THE QUESTION OF SOURCE MAPS
* I.E. CAN SOURCE MAPS MAP TO THE FILE WITH THESE SECTIONS COLLAPSED AWAY?
* TO DO THAT IMPLIES I'VE ADJUSTED THE LINE NUMBERS
* (FOR THAT MATTER THEY CAN BE USED TO ELIMINATE JUST PART OF A LINE TOO)
* MAYBE SIMPLER WILL BE TO JUST BLANK OUT THE CODE NOT PASSED
* THRU, THEN LINE AND COLUMN NUMBERS DON'T HAVE TO BE ADJUSTED, EVEN IF IT
* LOOKS A LITTLE FUNNY.  MAYBE PART OF THE ANSWER IS TO DO WHAT I'M DOING NOW
* IF THEYRE NOT GENERATING SOURCE MAPS DO THE BLANKING IF THEY ARE.
*/
exports["#if"] = function(forms) {
    if (forms.length < 3) {
      forms.error("\"#if\" directive takes a condition and a body");
    }

    // eval javascript generated from the condition
    var cond = (sl.isList(forms[1]) ? this.transpileExpression(forms[1]) : forms[1])
    var condcode = cond.toString();
    var condPassed = this.evalJavascript(condcode);
    trace("#if", condcode, (condPassed ? "passed" : "failed"));
    if(!condPassed) {
      return reader.ignorable_form;
    }

    return this.transpileExpressions(forms.slice(2));
}

exports["get"] = function(forms) {
    if (forms.length != 3) {
      forms.error("get takes a key and object / index and array");
    }
    this.transpileSubExpressions(forms);
    return sl.transpiled([forms[2], "[", forms[1], "]"]);
}

// (str...) evaluates to the js Array.join of each of it's expression arguments
// note that "+" can also be used to concenate strings
exports["str"] = function(forms) {
    if (forms.length < 2) {
      forms.error("missing arguments to \"str\"");
    }
    this.transpileSubExpressions(forms);
    var transpiled = sl.transpiledFromArray(forms.slice(1));
    transpiled.join(",");
    transpiled.unshift("[");
    transpiled.push("].join('')");

    return transpiled;
}

// (code...) is intended for use in code templates.
// it generates js code that transpiles code using an sl.transpiled list
exports["code"] = function(forms) {
    if (forms.length < 2) {
      forms.error("missing arguments to \"code\"");
    }

    var gencode = sl.transpiled();

    this.tabin();
    this.transpileSubExpressions(forms);

    var ctx = this;
    var leadin = "";
    forms.slice(1).forEach(function(form) {
      if (sl.typeOf(form) === 'symbol') {
        gencode.push(leadin + form.value);
        leadin = "";
      }
      else if (sl.typeOf(form) === 'string') {
        var codestr = sl.valueOfStr(form);
        var lines = codestr.split("\\n");
        lines.forEach(function(line, i) {
          var marginMarker = /^\s+(\.\.)[^.]/.exec(line);
          if(marginMarker) {
            var marginPos = marginMarker.index + marginMarker[0].length - 1;
            line = line.substring(marginPos);
          }
          if(i < lines.length-1) {
            gencode.push([leadin + '"' + line + '\\n"']);
            leadin = "\n" + ctx.margin();
          }
          else {
            gencode.push(leadin + '"' + line + '"');
            leadin = "";
          }
        });
      }
      else if (sl.isTranspiled(form)) {
        gencode.push(leadin + form.toString());
        leadin = "";
      }
      else {
        forms.error("unrecognized node type in \"code\": " + forms.toString());
      }
    });
    gencode.join(",");
    gencode.unshift("sl.transpiled([\n" + ctx.margin());
    gencode.push("])");
    this.tabout();

    return gencode;
}

exports["array"] = function(forms) {
    var transpiled = sl.transpiled()

    if (forms.length == 1) {
        transpiled.push("[]")
        return transpiled;
    }

    var ctx = this;
    ctx.tabin();
    this.transpileSubExpressions(forms);

    transpiled.push("[\n" + ctx.margin())
    forms.forEach(function(form, i) {
      if (i > 1) {
        transpiled.push(",\n" + ctx.margin())
      }
      if(i !== 0) {
        transpiled.push(form);
      }
    });
    ctx.tabout();
    transpiled.push("\n" + ctx.margin() + "]");

    return transpiled;
}

exports["object"] = function(forms) {
    var transpiled = sl.transpiled();

    if (forms.length == 1) {
        transpiled.push("{}");
        return transpiled;
    }

    this.indent += this.indentSize;
    this.transpileSubExpressions(forms);

    transpiled.push("{\n" + " ".repeat(this.indent));

    for (var i = 1; i < forms.length; i = i + 2) {
        if (i > 1) {
            transpiled.push(",\n" + " ".repeat(this.indent));
        }

        transpiled.push([forms[i].toString(), ': ', forms[i + 1]]);
    }

    this.indent -= this.indentSize;
    transpiled.push("\n" + " ".repeat((this.indent >= 0 ? this.indent : 0)) + "}");

    return transpiled;
}

exports["#include"] = function(forms) {
    if (forms.length != 2)  {
      forms.error("\"#include\" expects a single file name");
    }
    var filename = sl.stripQuotes(sl.valueOf(forms[1]));

    this.indent -= this.indentSize;

    var includedforms = reader.read_include_file(filename, sl.sourceOf(forms));
    var expanded = this.transpileExpressions(includedforms);
    this.indent += this.indentSize;

    this.noSemiColon = true;

    // some files e.g. macros files return no actual code...
    // (but if we return their forms we wind up with a blank line
    // in the generated code which looks odd)
    if(expanded && ((expanded.length && expanded.length > 0) ||
      (expanded.children && expanded.children.length > 0))) {
        // got some real content to return
        return expanded;
    }

    // nope - nothing real to return
    return reader.ignorable_form;
}

// #require requires a module during read time.
// works a little like #include but uses the module path
// instead of lispy's include path.
//  WAS AN EXPERIMENT IS IT STAYING?  ITS ODD IT JUST REQUIRES BUT
// DOESNT ASSIGN A HANDLE FOR THE REQUIRED MODULE?
exports["#require"] = function(forms) {
    if (forms.length != 2)  {
      forms.error("\"#require\" expects a single module");
    }
    var modulename = sl.valueOf(forms[1]);

    this.indent -= this.indentSize;
    var transpiled = require(modulename);

    this.noSemiColon = true;

    // nope - nothing real to return
    return reader.ignorable_form;
}

exports["regex"] = function(forms) {
    if (forms.length != 2)  {
      forms.error("\"regex\" expects a single string containing a regular expression");
    }
    this.noSemiColon = true;
    return '/' + sl.stripQuotes(sl.valueOf(forms[1])) + '/';
}

// "do" combines multiple expressions into one.
// it's implemented as a self invoking function
exports["do"] = function(forms) {
    // if statements are enabled
//    if(this.options.transpile.statements)
//    {
//      // then don't wrap in an IIFE (which is what our "begin" is for)
//      return exports["begin"].call(this, forms);
//    }

    // make a lispy function expression with the do args as it's body:
    var wrapperfn = sl.list(sl.atom("function"), sl.list())
    // slice(1) below = skip past "do"
    wrapperfn.pushFromArray(forms.slice(1));

    // convert that to javascript
    var transpiled = this.transpileExpression(wrapperfn);

    // wrap it in parens:
    transpiled.unshift('(');
    transpiled.push(')');

    // if it refers to "this" call it with *our* "this"
    if(transpiled.toString().indexOf("this") !== -1) {
      transpiled.push('.call(this)');
    }
    else {
      // otherwise call it simply
      transpiled.push('()');
    }

    return transpiled;
}

// "begin" is much like "do" except it simply
// generates the code for each expression without
// wrapping the result in an IIFE (as "do" does)
exports["begin"] = function(forms) {
    // slice(1) = get rid of "begin"
    return this.transpileExpressions(forms.slice(1), true);
}

/**
* binding assignment i.e.
*   feedback ##= feedbackmsg(score);
* For "reactor before" and:
*   feedback #= feedbackmsg(score);
* For "reactor after".
*
* These bind a "target" to some input "cells" via a "reactor
* function" (whose arguments are the cells), and keep the
* target up to date whenever the cells change, by calling
* the function automatically to get the new target value.
*
* These use the generic "#react" (see below) for their implementation.
*/
function handleBindingAssignment(forms) {
  var which = sl.valueOf(forms[0]);
  if (forms.length != 3)  {
    forms.error("Binding assignment expects lhs " + which + " rhs");
  }
  var target = forms[1];
  var reactor = forms[2];

  // extract the "cell" arguments
  // note: the expression may use a call to a named function e.g.:
  //   feedback #= feedbackmsg(score);
  // or might use an anonymous function e.g.:
  //   feedback #= function(score) {if?(score > 9) "You won!" else "Try again."};
  // or
  //   feedback #= (score) => {if?(score > 9) "You won!" else "Try again."};
  var cells;
  var invokereactorfn;
  if(sl.valueOf(reactor[0]) === "function" || sl.valueOf(reactor[0]) === "=>") {
    // grab the args from e.g. (function (score) {...})
    cells = reactor[1];

    // note here we must create a *call* to the anonymous function
    // also note the argument name(s) are assumed to *be* the cell variable names
    invokereactorfn = sl.list(reactor);
    invokereactorfn.pushFromArray(cells);
  }
  else {
    // slice just the args from e.g. (feedbackmsg score)
    cells = sl.listFromArray(reactor.slice(1));

    // note here the code provided was already a *call* which is what we need.
    // also note the argument name(s) are assumed to *be* the cell variable names
    invokereactorfn = reactor;
  }

  // We return an s-expression *form* (like a macro) not transpiled js
  // It uses #react to register code forms inserted (later) by the transpiler
  // it's like (#react after set (cell1, cell2) (set tgt (reactorfn cell1 cell2)))
  var registrar = sl.list("#react");
  registrar.push(which === "#=" ? "after" : "before");
  // the "mutators" set/++/+=/etc. are in the context to make them easy to change
  registrar.push(sl.listFromArray(this.mutators));
  registrar.push(cells);
  registrar.push(sl.list("set", target, invokereactorfn));

  return registrar;
}

exports['#='] = handleBindingAssignment;
exports['##='] = handleBindingAssignment;

/**
* #react registers code that gets inserted by the transpiler
* after/before a call that changes one the observed "cells".
*
* #react expects: when (fn1,...,fnM) (cell1,...,cellN) reactorcode
* where
*  when = "before" or "after"
*  (fn1,..., fnM) = the names of functions to insert code before or after (e.g. (set,++,*=))
*  (cell1,...,cellN) = observed cells i.e. the fn arguments we're reacting to changes in
*  reactorcode = code to be transpiled and run when a cell is modified with an fnX.
*/
function registerReactor(forms) {
  if (forms.length != 5)  {
    forms.error('#react expects: before/after, fnname, (observed cells), reactorcode');
  }

  // the word "before" or "after"
  var when = sl.valueOf(forms[1]);
  // a list of functions e.g. (set, ++, --)
  var cmds = forms[2];
  // a list of cells (arguments to the "cmds")
  var observed = forms[3];
  // code to inject when these cmds are invoked on these cells
  var reactorcode = this.transpileExpression(forms[4]);
// THIS DEBUG STATEMENT IS DUMPING THE WHOLE FORMS NEED TO PRETTY IT UP TO JUST THE NAMES
  debug('registering code to be run ' + when + ' one of "' + cmds + ' invoked on "' + observed + '"');

  // observed are the variables they need to declare as #cell
  // note: #cell is only done to encourage them to think of these
  //   variables as global to the file since we have no way to distinguish
  //   a reference to a variable in one scope from a variable with the same
  //   name in another (since we're a transpiler not an interpreter)
  var source = sl.sourceOf(forms);
  observed.forEach(function(cell) {
    var arg = sl.valueOf(cell);
    if(source.cells.indexOf(arg) === -1) {
      console.log('warning: reactor function observes "' + arg +
                    '" but "' + arg + '" is not a cell');
    }
  });

  // we store for each "cmd" an array of objects of the form:
  //   { of: [observed1, ..., observedN], insert: form }
  // where "observed" are first args for cmd (e.g. "(set observedX val)"), and
  // insert is the (already transpiled) js code to insert before/after
  cmds.forEach(function(cmdAtom) {
    var cmdName = sl.valueOf(cmdAtom);
    if(!source.bindingCode[when][cmdName]) {
      source.bindingCode[when][cmdName] = [];
    }
    source.bindingCode[when][cmdName].push({of: observed, insert: reactorcode});
  });

  // we expand to nothing our only job is to register the
  // code that the main transpiler injects when appropriate
  this.noSemiColon = true;
  return sl.transpiled();
}

exports['#react'] = registerReactor;

/**
* quote just returns the form inside it (as data)
*/
exports["quote"] = function(forms) {
  return forms[1];
};

// this is called initially with the expr *following* "quasiquote"
// then it recurses over the parsed forms
// note: this code was based on MAL see e.g.:
//  https://github.com/kanaka/mal/blob/master/process/guide.md
// and
//  https://raw.githubusercontent.com/kanaka/mal/master/js/stepA_mal.js

/* FROM MAL (DELETE)
// OLD
    if (!is_pair(ast)) {
        return [types._symbol("quote"), ast];
    } else if (ast[0].value === 'unquote') {
        return ast[1];
    } else if (is_pair(ast[0]) && ast[0][0].value === 'splice-unquote') {
        return [types._symbol("concat"),
                ast[0][1],
                quasiquote(ast.slice(1))];
    } else {
        return [types._symbol("cons"),
                quasiquote(ast[0]),
                quasiquote(ast.slice(1))];
    }
*/

function quasiquoter(forms) {
    if(sl.isAtom(forms)) {
      return sl.list("quote", forms);
    }
    else if(sl.isList(forms) && forms.length === 0) {
      return forms;
    }
    else if(forms[0].value === 'unquote') {
      return forms[1];
    }
    else if(sl.isList(forms) && forms.length === 1) {
      return quasiquoter(forms[0]);
    }
    else if(sl.isList(forms[0]) && forms[0][0].value === "splice-unquote") {
      return sl.list("concat",
              forms[0][1],
              quasiquoter(forms.slice(1)));
    }
    else {
      return new sl.list("cons",
              quasiquoter(forms[0]),
              quasiquoter(forms.slice(1)));
    }
}

exports["quasiquote"] = function(forms) {
  return quasiquoter(forms.slice(1));
}

// given an item and a list, return a list with the first argument prepended
// note: this is prepends the item at *compile time*
exports["cons"] = function(forms) {
  if (forms.length != 3)  {
    forms.error("\"cons\" expects an item to prepend and a list");
  }
  var list = sl.list();
  list.push(forms[1]);
  // I got an item (not a list) as a second argument
  // (need to follow up - is that to be expected?)
  if(sl.isList(forms[2])) {
    forms[2].forEach(function(form) {
      list.push(form);
    })
  }
  else {
    list.push(forms[2]);
  }

  return list;
}

// given 0 or more lists returns new list that is a concatenation of all of them
// note: this concatenates the items at *compile time*
exports["concat"] = function(forms) {
  if (forms.length != 3 || !sl.isList(forms[2]))  {
    forms.error("\"cons\" expects an item to prepend and a list");
  }
  var newlist = sl.list();
  // slice(1) = skip over "concat"
  forms.slice(1).forEach(function(sublist) {
     if(sl.isList(sublist)) {
       sublist.forEach(function(sublistitem) {
         newlist.push(sublistitem);
       });
     }
     else {
       // they've included elements to concatenate
       console.log("warning:  concat received atoms but is only meant for lists");
       newlist.push(sublist);
     }
  })
  return newlist;
}

// codequasiquote is an alternative to the code """
// when you want to express generated code in
// lispy form instead of javascript
exports["codequasiquote"] = function(forms) {
  // transpile the quoted lispy code to javascript
  // (but placeholders e.g. ~obj pass thru in the javascript)
  var transpiledJsForms = this.transpileExpression(forms[1]);
  var transpiledJsStr = transpiledJsForms.toString();
  return transpiledJsStr;

  // change ~(expr) so they are es6 template style i.e. ${(expr)}
  // THIS REGEX WILL FAIL IF THERE'S NESTED PARENS INSIDE THE ~(expr)!!!! FIX!!
//  var codeStr = transpiledJsStr.replace(/\~\((.+)\)/g, '\$\{\($1\)\}');
//console.log("after 1:", codeStr);
  // change ~name so they are es6 template style i.e. ${name}
//  codeStr = codeStr.replace(/\~([a-zA-Z_]+[a-zA-Z0-9_\.]*)/g, '\${$1}');
//console.log("after 2:", codeStr);
  // now treating *that* as a code template string, transform it into javascript
  // generating sl.transpiled objects (as if they'd used """ themselves)
//  var codeForms = reader.read_from_source('"""' + codeStr + '"""',
//                    "codequasiquote.sl");
//  var result = this.transpileExpression(codeForms);
//console.log("codequasiquote result:", result.toString());
//  return result;
}

var handleCompOperator = function(forms) {
    if (forms.length < 3)  {
      forms.error(forms[0].value + " requires two or more arguments");
    }
    this.transpileSubExpressions(forms)
// DELETE = FOR US IS "SET"    if (forms[0].value == "=") forms[0] = "==="
// DELETE THIS IS CONFUSING NOW THAT WE ALSO SUPPORT ==, !==    if (forms[0].value == "!=") forms[0] = "!=="

    var op = forms[0];
    var transpiled = sl.transpiled()

    var argforms = forms.slice(1);
    for (i = 0; i < argforms.length - 1; i++)
        transpiled.push([argforms[i], " ", op, " ", argforms[i + 1]])

// to not lose token info our join can't be the standard Array.join
// the standard Array.join produces a string
// it also takes just a string to join between
// notice in the next function down we join with another list e.g.
// op.push([" ", arithAtom, " "]) is what is joined with.
// where again: we don't wnat token info from arithAtom lost becaus of this
    transpiled.join (' && ')

    // note the parens added here are critical when the generated
    // code has multiple chained conditions to get the associativity
    // right - i.e. without these we can generate things like
    //   true === typeof(var) === "undefined"
    // which will break when what we really needed was like
    //   true === (typeof(var) === "undefined")
    transpiled.unshift('(')
    transpiled.push(')')
    transpiled.callable = false;
    return transpiled;
}

var handleArithOperator = function(forms) {
    if (forms.length < 3)  {
      forms.error("binary operator requires two or more arguments");
    }
    this.transpileSubExpressions(forms)

    var arithAtom = forms[0];
    var op = sl.transpiled()
    op.push([" ", arithAtom, " "])

    var transpiled = new sl.transpiledFromArray(forms.slice(1));
    transpiled.join(op)

    if(!arithAtom.noparens) {
      transpiled.unshift("(")
      transpiled.push(")")
    }
    transpiled.callable = false;
    return transpiled;
}

var handleBinaryOperator = function(forms) {
    if (forms.length !== 3)  {
      forms.error(forms[0].value + " requires two arguments");
    }
    return handleArithOperator.call(this, forms);
}

// Handle a unary operator e.g. i++, --i, etc.
// We're using a convention that prefix unary such as --i comes through as "--",
// but postfix unary like i-- comes through as "post--"
var handleUnaryOperator = function(forms) {
    var opName = sl.valueOf(forms[0]);
    if (forms.length < 2)  {
      forms.error("missing argument for unary operator: " + opName);
    }

    this.transpileSubExpressions(forms)
    var transpiled = sl.transpiled();
    var postPrefix = "post";
    if(opName.indexOf(postPrefix) === 0) {
      transpiled.push([sl.valueOf(forms[1]),opName.substring(postPrefix.length)]);
    }
    else {
      transpiled.push([forms[0], sl.valueOf(forms[1])]);
    }
    transpiled.callable = false;
    return transpiled;
}

// Minus is unique in that it can be a unary minus
var handleMinusOperator = function(forms) {
    if (forms.length < 2)  {
      forms.error("missing argument for operator");
    }
    if(forms.length > 2) {
      // it's a normal binary (or more) minus
      return handleArithOperator.call(this, forms);
    }

    // it's a unary minus
    this.transpileSubExpressions(forms)
    var transpiled = sl.transpiled()
    transpiled.push(["-", sl.valueOf(forms[1])]);
    transpiled.callable = false;
    return transpiled;
}

var handleLogicalOperator = handleArithOperator

// lispyscript 1 used "=" for comparisons, but this has been changed we
// *only* use "=" for assignment. lispyscript 1 also promoted "!="
// to "!==" in the generated code but we do not (now what they see is what
// they get!).
exports['=='] = handleCompOperator;
exports['==='] = handleCompOperator;
exports['!='] = handleCompOperator;
exports['!=='] = handleCompOperator;

// and a bunch more
exports["+"] = handleArithOperator;
exports["-"] = handleMinusOperator;
exports["*"] = handleArithOperator;
exports["/"] = handleArithOperator;
exports["%"] = handleArithOperator;
exports["+="] = handleBinaryOperator;
exports["-="] = handleBinaryOperator;
exports["*="] = handleBinaryOperator;
exports["/="] = handleBinaryOperator;
exports["%="] = handleBinaryOperator;
exports[">>"] = handleBinaryOperator;
exports[">>="] = handleBinaryOperator;
exports[">>>"] = handleBinaryOperator;
exports[">>>="] = handleBinaryOperator;
exports["<<"] = handleBinaryOperator;
exports["<<="] = handleBinaryOperator;
exports[">"] = handleCompOperator;
exports[">="] = handleCompOperator;
exports["<"] = handleCompOperator;
exports["<="] = handleCompOperator;
exports["||"] = handleLogicalOperator;
exports["&&"] = handleLogicalOperator;

exports["++"] = handleUnaryOperator;
exports["post++"] = handleUnaryOperator;
exports["--"] = handleUnaryOperator;
exports["post--"] = handleUnaryOperator;

exports["!"] = function(forms) {
    if (forms.length != 2) {
      forms.error("\"!\" expects a single expression");
    }
    this.transpileSubExpressions(forms)
    var result = sl.transpiled("(!" + forms[1] + ")");
    result.callable = false;
    return result;
}
