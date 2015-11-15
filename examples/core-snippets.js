// Generated by SugarLisp v0.5
var square = function(n) {
  return (n * n);
};
console.log(square(10));

(function() {
  try {
    console.log("In try");
    return (function() {
      throw "In catch";
    })();

  } catch (e) {
    return (function(err) {
      console.log(err);
    })(e);
  }
})();

((typeof(window) === "undefined") ?
  console.log("Not Running on browser") :
  console.log("Running on browser"));

var arr = [
  1,
  2,
  3,
  4,
  5
];
console.log(arr[2]);

((1 !== 2) ?
  console.log("Nos are not equal") : undefined);

((Object.prototype.toString.call(console) === "[object Object]") ?
  console.log("console is an object") :
  console.log("console is not an object"));

((Object.prototype.toString.call(console) === "[object Array]") ?
  console.log("console is an array") :
  console.log("console is not an array"));
console.log((10 * 10));
var i = 2;
console.log((++i * ++i));
var _ = require('underscore');
[
  1,
  2,
  3
].forEach(function(elem, i, list) {
  console.log(elem);
});

(function(name, email, tel) {
  console.log(name);
  console.log(email);
})("John", "john@example.com", "555-555-5556");

(function() {
  console.log("testing do");
  console.log("test again");
})();

console.log(["Hello1", " world1"].join(''));
var arr = [
  1,
  2,
  3
];
var mtarr = [];
console.log("empty array is empty:", (0 === mtarr.length));
var re = /[a-zA-Z0-9]/
var obj = {
  first: "fred",
  last: "flintstone",
  friends: [
    "barney",
    "betty"
  ],
  toString: function() {
    return [this.first, " ", this.last].join('');
  }
};

console.log(obj.toString());
console.log('hello');
var todayDate = new Date();
console.log(new Date("October 13, 1975 11:13:00"));
var dayNum = todayDate.getDay();
var dayName = ((dayNum === 0) ?
  "sun" :
  ((dayNum === 1) ?
    "mon" :
    ((dayNum === 2) ?
      "tues" :
      ((dayNum === 3) ?
        "wed" :
        ((dayNum === 4) ?
          "thu" :
          ((dayNum === 5) ?
            "fri" :
            ((dayNum === 6) ?
              "sat" : undefined)))))));
console.log(dayName);
var wx = 5;
while ((wx != 0)) {
  --wx
};
for (var tx = 0; tx < 5; tx++) {
  console.log(tx)
};
var arr = [
  1,
  2,
  3
];
console.log("first is:", arr[0]);
console.log("rest is:", arr.slice(1, arr.length));
var arrComma = [
  1,
  2,
  3
];
var mtarr2 = [];
console.log("empty array is empty:", (0 === mtarr2.length));
var re = /[a-zA-Z0-9]/
var fn = function(x, y) {
  return (x / y);
};
var obj = {
  first: "fred",
  last: "flintstone",
  friends: [
    "barney",
    "betty"
  ],
  toString: function() {
    return [this.first, " ", this.last].join('');
  }
};
var objComma = {
  first: "fred",
  last: "flintstone",
  friends: [
    "barney",
    "betty"
  ],
  toString: function() {
    return [this.first, " ", this.last].join('');
  }
};

console.log((objComma.toString()));
console.log('hello');
var name = "fred";
var greeting = ['hello ', name].join('');
console.log(greeting);
var objAt = {
  first: "fred",
  last: "flintstone",
  toString: function() {
    return [this.first, " ", this.last].join('');
  },
  dump: function() {
    console.log(this.toString());
  }
};

(objAt.dump());
console.log("fred flintstone contains 'flint':", /flint/.test("fred flintstone"))
console.log("fred flintstone contains 'flint':", /flint/.test("fred flintstone"))
console.log((10 / 5));
(/[^\.]+\.[^\.]+/.test("filename.ext") ?
  console.log("regex correctly says 'filename.ext' has an extension") :
  console.log("regex incorrectly says 'filename.ext' has no extension"))
for (var x = 0; x < 5; x++) {
  (function() {
    console.log(x);
  })()
};
var arr = [
  1,
  2,
  3,
  4
];

arr.forEach(function(el) {
  console.log(el);
});

function Ubertest(x) {
  return (function() {
    this.x = x;

    function Test(x) {
      return (function() {
        this.x = x;

        var arr = [
          1,
          2,
          3
        ];
        return arr.forEach(function(el) {
          console.log(this.x, el);
        }.bind(this));
      }).call(this);
    }

    var arr = [
      'a',
      'b',
      'c'
    ];
    return arr.forEach(function(el) {
      return new Test([this.x, " ", el].join(''));
    }.bind(this));
  }).call(this);
}

new Ubertest("Uber");