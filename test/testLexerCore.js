
// Exercise the SugarLisp Lexer
// note: this should be changed to be a proper test with pass/fail asserts

var lex = require('sugarlisp-core/lexer'),
    reader = require('sugarlisp-core/reader')
    sl = require('sugarlisp-core/sl-types');

function testLexer(msg, src) {
  console.log('* ' + msg + ' ' + src);
  var tokens = reader.nonlocal_tokens(src, 'testLexer.score');
  console.log(lex.formatTokenDump(tokens, lex.formatTokenSexp, "(tokens ", ")\n"));
}

// lispyscript "core" lexer tests

testLexer('a symbol:', 'sym');
testLexer('a string:', '"str"');
testLexer('a number:', '13');
testLexer('a number:', '173.97');
testLexer('a negative number:', '-13');
testLexer('a negative number:', '-173.97');
testLexer('nil:', 'nil');
testLexer('null:', 'null');
testLexer('true:', 'true');
testLexer('false:', 'false');
testLexer('a list of all atom types:', '(list "string1" \'string2\' 123 123.23 nil null true false)');
testLexer('function:', '(var f (function (x y) (+ x y)))');
testLexer('function:', '(var f (function (x y) (- x y)))');
testLexer('< symbols (retest in html dialect)', '(var f (function (x y z) (if (< x y) x (if (<= x z) z))))');
testLexer('lisp comment by itself:', '(\n; a comment\n)');
testLexer('lisp comment in code:', '(do "hello"\n; a comment\n(+ 2 3))\n; another comment');
testLexer('some javascript:', '(javascript "alert(\'hello\');")');
testLexer('js comment by itself:', '(\n// a comment\n)');
testLexer('js comments:', '(do "hello"\n// a comment\n(+ 2 3))\n// another comment');
testLexer('js block comment one line:', '(do "hello"\n/* a comment */\n(+ 2 3))\n/* another comment */');
testLexer('js block comment multi line:', '/*\n* multi line\n* comment */\n(do "hello" /* a \ncomment\n*/\n(+ 2 3))');
testLexer('arrow function (prefix):', '(=> (x y) (+ x y))');
