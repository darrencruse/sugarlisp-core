
// Exercise the SugarLisp Reader
// note: this should be changed to be a proper test with pass/fail asserts

var reader = require('sugarlisp-core/reader');
var sl = require('sugarlisp-core/sl-types');

function testReader(msg, src) {
  console.log('* ' + msg + ' ' + src);
  // the .score filename below pulls in *only* sugarlisp core
  var formtree = reader.read_from_source(src, 'testReader.score');
  //console.log('lists:', JSON.stringify(formtree.toJSON()));
  console.log('\n' + sl.pprintSEXP(formtree.toJSON(),{omitTop: true, bareSymbols: true}) + '\n');
}

// lispyscript "core" syntax tests

testReader('a symbol:', 'sym');
testReader('a string:', '"str"');
testReader('a number:', '13');
testReader('a number:', '173.97');
testReader('a negative number:', '-13');
testReader('a negative number:', '-173.97');
testReader('nil:', 'nil');
testReader('null:', 'null');
testReader('true:', 'true');
testReader('false:', 'false');
testReader('a list of all atom types:', '(list "string1" \'string2\' 123 123.23 nil null true false)');
testReader('function:', '(var f (function (x y) (+ x y)))');
testReader('function:', '(var f (function (x y) (- x y)))');
testReader('< symbols (retest in html dialect)', '(var f (function (x y z) (if (< x y) x (if (<= x z) z))))');
testReader('lisp comment by itself:', '(\n; a comment\n)');
testReader('lisp comment in code:', '(do "hello"\n; a comment\n(+ 2 3))\n; another comment');
testReader('some javascript:', '(javascript "alert(\'hello\');")');
testReader('js comment by itself:', '(\n// a comment\n)');
testReader('js comments:', '(do "hello"\n// a comment\n(+ 2 3))\n// another comment');
testReader('js block comment one line:', '(do "hello"\n/* a comment */\n(+ 2 3))\n/* another comment */');
testReader('js block comment multi line:', '/*\n* multi line\n* comment */\n(do "hello" /* a \ncomment\n*/\n(+ 2 3))');
testReader('arrow function (prefix):', '(=> (x y) (+ x y))');

